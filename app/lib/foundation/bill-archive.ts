import type { AuthenticatedPrincipal } from "../auth/types";
import type { BillDocument, BillRepository, DocumentStoragePort, PublicBillDocument } from "./real-bill.ts";
import type { BillArchiveRow, BillBulkResult } from "../ui/bill-archive-month";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toPublicApprovedDocument, toPublicDocument } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { competenceMonths, documentKindOf, monthOf } from "../ui/bill-archive-month.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { supplyPeriodAdmission } from "../calculation/quote-window.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billDeleteDecision, proposalsFromBill } from "./bill-delete.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deleteBillPermanently } from "./bill-retention.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";

/**
 * Tony (20/11/2026, "AVVIO FASE 2: ARCHIVIO BOLLETTE"). Server side of the company bill archive:
 * - one row per invoice, built from the stored reading only (null where nothing was read);
 * - deletion of one bill or of a selection, each bill decided on its own (tenant, commercial branch, linked proposals);
 * - a deleted bill takes with it its fattura di dettaglio, its stored PDFs and the records derived from it (calculations,
 *   comparisons and CTE forcings of that bill), so nothing is left pointing to a bill that no longer exists;
 * - the mandatory audit is written before anything is deleted; the audit trail itself is never deleted.
 */

const FAILED_STATUSES = new Set(["FAILED", "OCR_PROVIDER_REQUIRED", "PROVIDER_NOT_CONFIGURED"]);

function text(value: string | null | undefined): string | null { const trimmed = typeof value === "string" ? value.trim() : ""; return trimmed ? trimmed : null; }

/** dd/mm/yyyy dates printed in the period as read, as ISO dates, first and last. */
function printedPeriod(raw: string | null | undefined): { readonly start: string | null; readonly end: string | null } {
  const dates = [...String(raw ?? "").matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g)].map((match) => `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`).filter((iso) => Number.isFinite(Date.parse(iso)));
  return { start: dates[0] ?? null, end: dates.at(-1) ?? null };
}

function publicView(document: BillDocument): PublicBillDocument | null {
  try { return (document.currentApprovedVersionId ? toPublicApprovedDocument(document) : null) ?? toPublicDocument(document); } catch { return null; }
}

/** The kind recognized when the bill was read (current approved version, else the working one). */
function storedDocumentType(document: BillDocument): string | null {
  const version = document.versions.find((item) => item.versionId === (document.currentApprovedVersionId ?? document.currentVersionId));
  return version?.structuredBill?.documentType ?? null;
}

/** The archive row of one bill: what was read, nothing more. */
export function billArchiveRow(document: BillDocument, linkedProposals: number, today: string): BillArchiveRow {
  const view = publicView(document);
  const normalized = view?.normalized ?? null;
  const printed = printedPeriod(view?.fields.billingPeriod?.value ?? null);
  const periodStart = text(normalized?.billingPeriod.periodStart) ?? printed.start;
  const periodEnd = text(normalized?.billingPeriod.periodEnd) ?? printed.end;
  const failed = view ? FAILED_STATUSES.has(view.status) : true;
  return {
    id: document.id,
    customerName: text(normalized?.customer.name) ?? text(view?.fields.customerName?.value),
    pod: text(normalized?.supply.reference) ?? text(view?.fields.pod?.value),
    supplier: text(normalized?.currentSupplier) ?? text(view?.fields.supplier?.value),
    invoiceNumber: text(view?.analystReview?.receipt?.invoiceNumber?.value ?? null),
    periodStart,
    periodEnd,
    archiveMonth: monthOf(periodEnd),
    competenceMonths: competenceMonths(periodStart, periodEnd),
    totalAmount: text(view?.fields.totalAmount?.value),
    readingState: document.currentApprovedVersionId ? "APPROVED" : failed ? "READ_FAILED" : "TO_COMPLETE",
    documentKind: documentKindOf(storedDocumentType(document), Boolean(document.detailDocument)),
    // Same rule as the simulation (quote-window.ts), only shown: the archive never hides or deletes a bill for its age.
    simulable: supplyPeriodAdmission({ periodStart, periodEnd }, today).admitted,
    linkedProposals,
    uploadedAt: document.createdAt,
  };
}

type Deletable = { readonly list: (tenantId: string) => Promise<readonly { readonly recordId: string; readonly tenantId: string; readonly version: number; readonly payload: unknown }[]>; readonly delete?: (input: { readonly tenantId: string; readonly recordId: string; readonly expectedVersion?: number }) => Promise<void> };

export interface BillArchiveRepositories {
  readonly billRepository: BillRepository;
  readonly documentStorage: DocumentStoragePort;
  readonly proposals: Pick<Deletable, "list">;
  readonly calculationResults: Deletable;
  readonly comparisonResults: Deletable;
  readonly eligibilityOverrides?: Deletable;
}

function sourceBillId(payload: unknown): string | null {
  const result = (payload as { readonly result?: { readonly normalizedInput?: { readonly sourceBill?: { readonly billId?: unknown } } } } | null)?.result;
  const id = result?.normalizedInput?.sourceBill?.billId;
  return typeof id === "string" ? id : null;
}

/** The records derived from a bill: calculations and comparisons computed on it, CTE forcings granted for it. */
export async function billDerivedRecords(repositories: BillArchiveRepositories, tenantId: string, billId: string): Promise<{ readonly calculations: readonly string[]; readonly comparisons: readonly string[]; readonly overrides: readonly string[] }> {
  const of = async (repository: Deletable | undefined, matches: (payload: unknown) => boolean) => repository ? (await repository.list(tenantId)).filter((record) => record.tenantId === tenantId && matches(record.payload)).map((record) => record.recordId) : [];
  return {
    calculations: await of(repositories.calculationResults, (payload) => sourceBillId(payload) === billId),
    comparisons: await of(repositories.comparisonResults, (payload) => sourceBillId(payload) === billId),
    overrides: await of(repositories.eligibilityOverrides, (payload) => (payload as { readonly billId?: unknown } | null)?.billId === billId),
  };
}

async function removeRecords(repository: Deletable | undefined, tenantId: string, ids: readonly string[]): Promise<void> {
  if (!ids.length || !repository) return;
  if (typeof repository.delete !== "function") throw new Error("BILL_DERIVED_DELETE_UNAVAILABLE");
  const current = new Map((await repository.list(tenantId)).map((record) => [record.recordId, record.version]));
  for (const recordId of ids) {
    if (!current.has(recordId)) continue;
    try { await repository.delete({ tenantId, recordId, expectedVersion: current.get(recordId) }); }
    catch (error) { if (!/NOT_FOUND/.test(error instanceof Error ? error.message : String(error))) throw error; }
  }
}

/**
 * Deletes one bill the caller already decided may go (billDeleteDecision ALLOWED). Order: mandatory audit, derived records,
 * then the bill with its PDFs (sintetica and dettaglio, deleteBillPermanently). If the audit cannot be written nothing is
 * deleted. If a later step fails the bill record is still there, a NOT_COMPLETED audit event says so and the same deletion
 * can be repeated: every step skips what is already gone.
 */
export async function deleteArchivedBill(principal: AuthenticatedPrincipal, repositories: BillArchiveRepositories, document: BillDocument, correlationId: string): Promise<void> {
  const tenantId = principal.tenantId;
  const derived = await billDerivedRecords(repositories, tenantId, document.id);
  const audit = { principal, action: "BILL_DELETED_BY_USER", resourceType: "BILL", resourceId: document.id, outcome: "ALLOWED" as const, correlationId, metadata: { withDetail: Boolean(document.detailDocument), derivedCalculations: derived.calculations.length, derivedComparisons: derived.comparisons.length, derivedOverrides: derived.overrides.length } };
  await recordRuntimeAudit(audit);
  try {
    await removeRecords(repositories.comparisonResults, tenantId, derived.comparisons);
    await removeRecords(repositories.calculationResults, tenantId, derived.calculations);
    await removeRecords(repositories.eligibilityOverrides, tenantId, derived.overrides);
    await deleteBillPermanently({ tenantId, documentId: document.id, repositories: { bills: repositories.billRepository, storage: repositories.documentStorage, audit: { async record() { /* the deletion was audited above */ } } } });
  } catch (error) {
    await recordRuntimeAudit({ ...audit, action: "BILL_DELETE_NOT_COMPLETED", outcome: "DENIED" }).catch(() => undefined);
    throw error;
  }
}

export interface BillDeleteScope {
  /** The bill as the user may see it (commercial branch), null when outside it. */
  readonly inScope: (id: string) => Promise<BillDocument | null>;
}

/**
 * Deletes a selection: every id is read with the user's tenant only (an id of another company is "not found" and nothing
 * about it is revealed), checked against the commercial branch and the linked proposals, and deleted on its own; one bill
 * that fails does not stop the others. Returns the real outcome of each.
 */
export async function deleteBillSelection(principal: AuthenticatedPrincipal, repositories: BillArchiveRepositories, scope: BillDeleteScope, ids: readonly string[], correlationId: string): Promise<readonly BillBulkResult[]> {
  const proposals = await repositories.proposals.list(principal.tenantId) as Parameters<typeof proposalsFromBill>[0];
  const results: BillBulkResult[] = [];
  for (const id of ids) {
    try {
      const stored = await repositories.billRepository.get(principal.tenantId, id);
      const document = stored ? await scope.inScope(id) : null;
      const linkedProposals = document ? proposalsFromBill(proposals, principal.tenantId, document.id) : 0;
      const decision = billDeleteDecision({ tenantId: principal.tenantId, stored, inScope: document !== null, linkedProposals });
      if (decision.outcome !== "ALLOWED" || !document) { results.push({ id, outcome: decision.outcome === "ALLOWED" ? "NOT_FOUND" : decision.outcome, ...(decision.linkedProposals ? { linkedProposals: decision.linkedProposals } : {}) }); continue; }
      await deleteArchivedBill(principal, repositories, document, correlationId);
      results.push({ id, outcome: "DELETED" });
    } catch {
      results.push({ id, outcome: "NOT_COMPLETED" });
    }
  }
  return results;
}

/** The ids of a deletion request: 1 to `limit` distinct, well-formed ids; anything else is refused as a whole. */
export function parseDeleteSelection(body: unknown, limit: number): readonly string[] {
  const value = body as { readonly ids?: unknown; readonly confirmed?: unknown } | null;
  if (!value || value.confirmed !== true) throw new Error("BILL_DELETE_CONFIRMATION_REQUIRED");
  if (!Array.isArray(value.ids) || !value.ids.length) throw new Error("BILL_DELETE_SELECTION_INVALID");
  if (value.ids.length > limit) throw new Error("BILL_DELETE_SELECTION_TOO_LARGE");
  const ids = value.ids.map((id) => typeof id === "string" ? id.trim() : "");
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error("BILL_DELETE_SELECTION_INVALID");
  return [...new Set(ids)];
}
