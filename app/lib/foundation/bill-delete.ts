import type { BillDocument } from "./real-bill.ts";
import type { TenantRecord } from "../persistence/types.ts";

// Tony (10/11/2026): a deletion says what really happened to each document. Before, DELETE /api/bills/[id] answered
// "deleted" also for a bill that did not exist or that the user could not see, so the screen could not tell a deletion
// from a refusal. The server decides per document; the browser only reports the outcome.

export type BillDeleteOutcome = "DELETED" | "NOT_FOUND" | "FORBIDDEN" | "LINKED_TO_PROPOSALS";

export interface BillDeleteDecision {
  readonly outcome: Exclude<BillDeleteOutcome, "DELETED"> | "ALLOWED";
  readonly status: number;
  readonly code: string | null;
  readonly linkedProposals: number;
}

/**
 * `stored` is read with the user's tenant only, so a bill of another tenant is never found and answers like a missing one
 * (nothing about other tenants is revealed). `inScope` is the commercial-branch check (`getBillInScope`). A bill a proposal
 * was built from is kept: deleting it would hide that proposal from directors and agents (`proposalInScope`).
 */
export function billDeleteDecision(input: { readonly tenantId: string; readonly stored: Pick<BillDocument, "tenantId" | "lifecycleState"> | null; readonly inScope: boolean; readonly linkedProposals: number }): BillDeleteDecision {
  const { stored } = input;
  if (!stored || stored.tenantId !== input.tenantId || stored.lifecycleState === "DELETED") return { outcome: "NOT_FOUND", status: 404, code: "DOCUMENT_NOT_FOUND", linkedProposals: 0 };
  if (!input.inScope) return { outcome: "FORBIDDEN", status: 403, code: "BILL_DELETE_FORBIDDEN", linkedProposals: 0 };
  if (input.linkedProposals > 0) return { outcome: "LINKED_TO_PROPOSALS", status: 409, code: "BILL_LINKED_TO_PROPOSALS", linkedProposals: input.linkedProposals };
  return { outcome: "ALLOWED", status: 200, code: null, linkedProposals: 0 };
}

/** Proposals of the tenant built from this bill (`proposal.sourceBill.billId`). */
export function proposalsFromBill(records: readonly Pick<TenantRecord<{ readonly proposal: unknown }>, "tenantId" | "payload">[], tenantId: string, billId: string): number {
  return records.filter((record) => {
    if (record.tenantId !== tenantId) return false;
    const proposal = record.payload?.proposal;
    if (!proposal || typeof proposal !== "object") return false;
    const source = (proposal as { readonly sourceBill?: { readonly billId?: unknown } }).sourceBill;
    return typeof source?.billId === "string" && source.billId === billId;
  }).length;
}
