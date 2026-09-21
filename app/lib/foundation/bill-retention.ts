import type { AuditSink, BillDocument, BillRepository, DocumentStoragePort } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { transitionBillLifecycle } from "./real-bill.ts";

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
