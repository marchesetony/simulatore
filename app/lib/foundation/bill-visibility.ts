import type { AuthenticatedPrincipal } from "../auth/types.ts";
import type { RuntimeRepositories } from "../persistence/adapter.ts";
import type { FoundationMembershipRecord } from "../persistence/types.ts";
import type { BillDocument } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { foundationRoleToCanonical, legacyAuthRoleToCanonical } from "../auth/roles.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateMembershipRecord } from "./memberships.ts";

export type BillHierarchyRole = "SUPER_ADMIN" | "ADMIN" | "AGENT";

export interface BillVisibilityScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: BillHierarchyRole;
  readonly ownerUserIds: ReadonlySet<string>;
  readonly groupIds: ReadonlySet<string>;
}

function hierarchyRole(principal: Pick<AuthenticatedPrincipal, "role">): BillHierarchyRole {
  return legacyAuthRoleToCanonical(principal.role);
}

function foundationRole(role: FoundationMembershipRecord["role"]): BillHierarchyRole | null {
  return foundationRoleToCanonical(role);
}

export function buildBillVisibilityScope(principal: AuthenticatedPrincipal, records: readonly FoundationMembershipRecord[] = []): BillVisibilityScope {
  const membership = records
    .map((record) => validateMembershipRecord({ ...record, version: 1 }))
    .find((record) => record.userId === principal.userId && record.tenantId === principal.tenantId && record.status === "ACTIVE");
  const role = membership ? foundationRole(membership.role) ?? hierarchyRole(principal) : hierarchyRole(principal);
  const ownerUserIds = new Set<string>([principal.userId]);
  const ownMembership = records.find((record) => record.tenantId === principal.tenantId && record.userId === principal.userId && record.status === "ACTIVE");
  const groupIds = new Set<string>(ownMembership?.groupIds ?? []);
  if (role === "ADMIN") {
    for (const record of records) {
      if (record.tenantId === principal.tenantId && record.status === "ACTIVE" && record.role === "SALES_OPERATOR" && record.managerUserId === principal.userId) ownerUserIds.add(record.userId);
    }
  }
  return { tenantId: principal.tenantId, userId: principal.userId, role, ownerUserIds, groupIds };
}

export async function billVisibilityScope(principal: AuthenticatedPrincipal, repositories: Pick<RuntimeRepositories, "foundationMemberships">): Promise<BillVisibilityScope> {
  const records = await repositories.foundationMemberships.list(principal.tenantId);
  return buildBillVisibilityScope(principal, records.map((record) => ({ ...record.payload, version: record.version })));
}

export function billInScope(document: BillDocument, scope: BillVisibilityScope): boolean {
  if (document.tenantId !== scope.tenantId) return false;
  if (scope.role === "SUPER_ADMIN") return true;
  return typeof document.ownerUserId === "string" && scope.ownerUserIds.has(document.ownerUserId);
}

export async function listBillsInScope(principal: AuthenticatedPrincipal, repositories: Pick<RuntimeRepositories, "billRepository" | "foundationMemberships">): Promise<readonly BillDocument[]> {
  const scope = await billVisibilityScope(principal, repositories);
  const documents = await repositories.billRepository.list(scope.tenantId);
  return documents.filter((document) => billInScope(document, scope));
}

export async function getBillInScope(principal: AuthenticatedPrincipal, repositories: Pick<RuntimeRepositories, "billRepository" | "foundationMemberships">, billId: string): Promise<BillDocument | null> {
  const document = await repositories.billRepository.get(principal.tenantId, billId);
  if (!document) return null;
  const scope = await billVisibilityScope(principal, repositories);
  return billInScope(document, scope) ? document : null;
}

export const ASSIGNMENT_GUARDS = Object.freeze({
  create: "SUPER_ADMIN_ONLY",
  update: "SUPER_ADMIN_ONLY",
  revoke: "SUPER_ADMIN_ONLY",
});
