import type { AuditSink, BillDocument, BillRepository, DocumentStoragePort } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toPublicBillSummary, transitionBillLifecycle } from "./real-bill.ts";

export interface BillRetentionRepositories {
  readonly bills: BillRepository;
  readonly storage: DocumentStoragePort;
  readonly audit: AuditSink;
}

export interface BillRetentionRunResult {
  readonly tenantId: string;
  readonly scanned: number;
  readonly scheduled: number;
  readonly deleted: number;
  readonly unchanged: number;
  readonly failed: number;
}

function validTenant(tenantId: string): void {
  if (!/^tenant_[a-z0-9-]+$/.test(tenantId)) throw new Error("TENANT_ACCESS_DENIED");
}

async function persist(repository: BillRepository, next: BillDocument, previous: BillDocument): Promise<void> {
  const version = previous.versions.find((candidate) => candidate.versionId === previous.currentVersionId);
  if (!version) throw new Error("BILL_CURRENT_VERSION_MISSING");
  await repository.saveIfCurrentVersion(next, previous.currentVersionId, version);
}

async function audit(auditSink: AuditSink, tenantId: string, documentId: string, outcome: "ALLOWED" | "FAILED"): Promise<void> {
  await auditSink.record({ type: "LIFECYCLE", tenantId, documentId, outcome });
}

export async function runBillRetention(input: {
  readonly tenantId: string;
  readonly repositories: BillRetentionRepositories;
  readonly now: string;
  readonly actorId?: string;
}): Promise<BillRetentionRunResult> {
  validTenant(input.tenantId);
  if (!Number.isFinite(Date.parse(input.now))) throw new Error("BILL_LIFECYCLE_TIMESTAMP_INVALID");
  const actorId = input.actorId ?? "SYSTEM_BILL_RETENTION";
  const records = await input.repositories.bills.list(input.tenantId);
  let scheduled = 0;
  let deleted = 0;
  let failed = 0;
  let processed = 0;
  for (const previous of records) {
    if (previous.tenantId !== input.tenantId) throw new Error("TENANT_ACCESS_DENIED");
    const due = previous.retention.deletionDueAt !== null && Date.parse(input.now) >= Date.parse(previous.retention.deletionDueAt);
    if (!due || (previous.lifecycleState !== "ARCHIVED" && previous.lifecycleState !== "SCHEDULED_DELETION")) continue;
    try {
      let current = previous;
      if (current.lifecycleState === "ARCHIVED") {
        await audit(input.repositories.audit, input.tenantId, current.id, "ALLOWED");
        current = transitionBillLifecycle({ document: current, tenantId: input.tenantId, expectedLifecycleVersion: current.lifecycleVersion, toState: "SCHEDULED_DELETION", at: input.now, actorId, reason: "RETENTION_DUE" });
        await persist(input.repositories.bills, current, previous);
        scheduled += 1;
      }
      await audit(input.repositories.audit, input.tenantId, current.id, "ALLOWED");
      await input.repositories.storage.remove(input.tenantId, current.id);
      const deletionAt = new Date(Date.parse(input.now) + 1000).toISOString();
      const deletedDocument = transitionBillLifecycle({ document: current, tenantId: input.tenantId, expectedLifecycleVersion: current.lifecycleVersion, toState: "DELETED", at: deletionAt, actorId, reason: "RETENTION_EXECUTED" });
      await persist(input.repositories.bills, deletedDocument, current);
      deleted += 1;
      processed += 1;
    } catch {
      failed += 1;
      try { await audit(input.repositories.audit, input.tenantId, previous.id, "FAILED"); } catch { /* fail closed: no further mutation */ }
    }
  }
  return { tenantId: input.tenantId, scanned: records.length, scheduled, deleted, unchanged: records.length - processed - failed, failed };
}

// Tony (31/10): "serve un tasto cancella le bollette, e le bollette con date superiori a 5 mesi devono essere eliminati in
// automatico". A deleted bill is removed for good (record and PDF): the stored lifecycle is left untouched so the
// production code reading the same database never meets a state it does not know.
export const BILL_MAX_AGE_MONTHS = 5;

/** The bill's own date: end of the billing period it covers, else the upload date. */
export function billReferenceDate(document: BillDocument): string {
  let periodEnd: string | null = null;
  try { periodEnd = toPublicBillSummary(document)?.period.periodEnd ?? null; } catch { periodEnd = null; }
  if (periodEnd && Number.isFinite(Date.parse(periodEnd))) return periodEnd;
  // The period as read ("01/08/2026 - 30/09/2026"): its last date.
  const version = document.versions.find((candidate) => candidate.versionId === (document.currentApprovedVersionId ?? document.currentVersionId));
  const dates = [...String(version?.fields.billingPeriod?.value ?? "").matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g)];
  const last = dates.at(-1);
  if (last) { const iso = `${last[3]}-${last[2].padStart(2, "0")}-${last[1].padStart(2, "0")}`; if (Number.isFinite(Date.parse(iso))) return iso; }
  return document.createdAt;
}

/** True when the bill's date is more than five calendar months before now. */
export function billTooOld(document: BillDocument, now: string): boolean {
  const limit = new Date(now);
  if (!Number.isFinite(limit.getTime())) return false;
  limit.setUTCMonth(limit.getUTCMonth() - BILL_MAX_AGE_MONTHS);
  return Date.parse(billReferenceDate(document)) < limit.getTime();
}

export async function deleteBillPermanently(input: { readonly tenantId: string; readonly documentId: string; readonly repositories: BillRetentionRepositories }): Promise<void> {
  validTenant(input.tenantId);
  if (!input.repositories.bills.delete) throw new Error("BILL_DELETE_UNAVAILABLE");
  try { await input.repositories.storage.remove(input.tenantId, input.documentId); } catch (error) {
    if (!/NOT_FOUND|ENOENT/.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  await input.repositories.bills.delete(input.tenantId, input.documentId);
  await audit(input.repositories.audit, input.tenantId, input.documentId, "ALLOWED");
}

export async function purgeOldBills(input: { readonly tenantId: string; readonly repositories: BillRetentionRepositories; readonly now: string }): Promise<{ readonly scanned: number; readonly deleted: number; readonly failed: number }> {
  validTenant(input.tenantId);
  const records = await input.repositories.bills.list(input.tenantId);
  let deleted = 0; let failed = 0;
  for (const document of records) {
    if (document.tenantId !== input.tenantId || !billTooOld(document, input.now)) continue;
    try { await deleteBillPermanently({ tenantId: input.tenantId, documentId: document.id, repositories: input.repositories }); deleted += 1; }
    catch { failed += 1; }
  }
  return { scanned: records.length, deleted, failed };
}
