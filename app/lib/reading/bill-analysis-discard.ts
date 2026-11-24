import type { BillDocument } from "../foundation/real-bill";
import type { TenantRecordRepository } from "../persistence/types";
import type { BillLinkRecord } from "../customers/model";
import { billDerivedRecords, type BillArchiveRepositories } from "../foundation/bill-archive";
import { proposalsFromBill } from "../foundation/bill-delete";

/**
 * Tony (24/11/2026, "AUTORIZZAZIONE MODULI A + B", vincolo obbligatorio): stopping or cancelling an analysis may remove only
 * the bill that same analysis has just created, and only while it is exactly as read: never approved or corrected, with no
 * fattura di dettaglio, no simulation or calculation, no forced eligibility, no proposal and no link to a customer.
 * Anything else (or a check that cannot be read) keeps the bill.
 */
export async function analysisBillDiscardable(repositories: BillArchiveRepositories & { readonly customerBillLinks?: TenantRecordRepository<BillLinkRecord> }, tenantId: string, document: BillDocument): Promise<boolean> {
  try {
    if (document.tenantId !== tenantId) return false;
    if (document.currentApprovedVersionId !== null || document.versions.length !== 1 || document.approvals.length !== 0 || document.detailDocument) return false;
    if (proposalsFromBill(await repositories.proposals.list(tenantId) as Parameters<typeof proposalsFromBill>[0], tenantId, document.id) > 0) return false;
    const derived = await billDerivedRecords(repositories, tenantId, document.id);
    if (derived.calculations.length || derived.comparisons.length || derived.overrides.length) return false;
    if (!repositories.customerBillLinks) return false;
    const links = await repositories.customerBillLinks.list(tenantId);
    return !links.some((record) => record.payload.billId === document.id);
  } catch {
    return false;
  }
}
