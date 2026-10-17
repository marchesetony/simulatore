import type { AuthenticatedPrincipal } from "../auth/types";
import type { RuntimeRepositories } from "../persistence/adapter";
import type { BillDocument } from "../foundation/real-bill";
import type { BillVisibilityScope } from "../foundation/bill-visibility";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billInScope, billVisibilityScope } from "../foundation/bill-visibility.ts";

type ScopeRepositories = Pick<RuntimeRepositories, "billRepository" | "foundationMemberships"> & { readonly orgChain?: RuntimeRepositories["orgChain"] };
interface ScopedProposal { readonly sourceBill?: { readonly billId: string } }

export interface ProposalScope {
  readonly scope: BillVisibilityScope;
  readonly bills: ReadonlyMap<string, BillDocument>;
}

/** Proposals follow the bill they were built from: agents see their own, managers their branch, the company everything. */
export async function proposalScope(principal: AuthenticatedPrincipal, repositories: ScopeRepositories): Promise<ProposalScope> {
  const scope = await billVisibilityScope(principal, repositories);
  const documents = scope.role === "SUPER_ADMIN" ? [] : await repositories.billRepository.list(principal.tenantId);
  return { scope, bills: new Map(documents.filter((document) => billInScope(document, scope)).map((document) => [document.id, document])) };
}

export function proposalInScope(access: ProposalScope, proposal: ScopedProposal): boolean {
  if (access.scope.role === "SUPER_ADMIN") return true;
  const billId = proposal.sourceBill?.billId;
  // Proposals without a source bill predate the bill-driven flow; only managers keep seeing them.
  if (!billId) return access.scope.role === "ADMIN";
  return access.bills.has(billId);
}

export async function assertProposalInScope(principal: AuthenticatedPrincipal, repositories: ScopeRepositories, proposal: ScopedProposal): Promise<void> {
  if (!proposalInScope(await proposalScope(principal, repositories), proposal)) throw new Error("PROPOSAL_NOT_FOUND");
}
