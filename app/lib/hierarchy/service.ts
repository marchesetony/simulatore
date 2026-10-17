// Commercial chain of command: Azienda > Direttore > Area Manager > Agente.
// Each level can only narrow what the level above allows; the effective limits
// of a node are the intersection of every limit on its path from the company.
import type { AuthenticatedPrincipal, CanonicalProductRole } from "../auth/types";
import type { DeletableTenantRecordRepository, FoundationMembershipRecord, TenantRecord, TenantRecordRepository } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { foundationRoleToCanonical, legacyAuthRoleToCanonical } from "../auth/roles.ts";
import type { CommercialLimits, CteAssignment, CteAssignmentScope, CteAssignmentView, LimitCustomerCategory, LimitVector, OrgLevel, OrgNode, OrgNodeView } from "./types";

export type OrgChainRepository = DeletableTenantRecordRepository<OrgNode>;
export type CteAssignmentRepository = TenantRecordRepository<CteAssignment>;

export const ORG_LEVELS: readonly OrgLevel[] = ["AZIENDA", "DIRETTORE", "AREA_MANAGER", "AGENTE"];
const VECTORS: readonly LimitVector[] = ["EE", "GAS"];
const CATEGORIES: readonly LimitCustomerCategory[] = ["RESIDENTIAL", "NON_RESIDENTIAL"];
const SCOPES: readonly CteAssignmentScope[] = ["ALL", "BRANCHES"];
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIST = 500;

export const UNRESTRICTED_LIMITS: CommercialLimits = Object.freeze({ vectors: null, customerCategories: null, excludedCteArchiveIds: [] });

function fail(code: string): never { throw new Error(code); }
function rank(level: OrgLevel): number { return ORG_LEVELS.indexOf(level); }
function assertId(value: unknown, code: string): asserts value is string { if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(code); }
function validDate(value: unknown): value is string { return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }

export function orgNodeRecordId(tenantId: string, userId: string): string { return deterministicRecordId("org-chain", tenantId, userId); }
export function cteAssignmentRecordId(tenantId: string, archiveId: string): string { return deterministicRecordId("cte-assignment", tenantId, archiveId); }

function subset<T extends string>(value: unknown, allowed: readonly T[], code: string): readonly T[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => !allowed.includes(item as T))) fail(code);
  const unique = allowed.filter((item) => (value as unknown[]).includes(item));
  if (unique.length === 0) fail(code);
  return unique;
}

export function validateLimits(value: unknown): CommercialLimits {
  if (value === undefined || value === null) return UNRESTRICTED_LIMITS;
  if (typeof value !== "object" || Array.isArray(value)) fail("ORG_LIMITS_INVALID");
  const item = value as Record<string, unknown>;
  const excluded = item.excludedCteArchiveIds ?? [];
  if (!Array.isArray(excluded) || excluded.length > MAX_LIST) fail("ORG_LIMITS_INVALID");
  for (const archiveId of excluded) assertId(archiveId, "ORG_LIMITS_INVALID");
  return { vectors: subset(item.vectors, VECTORS, "ORG_LIMITS_INVALID"), customerCategories: subset(item.customerCategories, CATEGORIES, "ORG_LIMITS_INVALID"), excludedCteArchiveIds: [...new Set(excluded as string[])].sort() };
}

export function validateOrgNode(value: unknown): OrgNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("ORG_NODE_INVALID");
  const item = value as Record<string, unknown>;
  assertId(item.userId, "ORG_NODE_INVALID");
  if (!ORG_LEVELS.includes(item.level as OrgLevel)) fail("ORG_LEVEL_INVALID");
  const level = item.level as OrgLevel;
  const parentUserId = item.parentUserId ?? null;
  if (parentUserId !== null) assertId(parentUserId, "ORG_PARENT_INVALID");
  if (level === "AZIENDA" ? parentUserId !== null : parentUserId === null) fail("ORG_PARENT_INVALID");
  if (parentUserId === item.userId) fail("ORG_PARENT_INVALID");
  const displayName = item.displayName ?? null;
  if (displayName !== null && (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > 120 || /[\u0000-\u001f\u007f<>]/.test(displayName))) fail("ORG_DISPLAY_NAME_INVALID");
  assertId(item.updatedBy, "ORG_NODE_INVALID");
  return { userId: item.userId, level, parentUserId: parentUserId as string | null, displayName: displayName === null ? null : (displayName as string).trim(), limits: validateLimits(item.limits), updatedBy: item.updatedBy };
}

export function validateCteAssignment(value: unknown): CteAssignment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("CTE_ASSIGNMENT_INVALID");
  const item = value as Record<string, unknown>;
  assertId(item.archiveId, "CTE_ASSIGNMENT_INVALID");
  if (!validDate(item.validFrom)) fail("CTE_ASSIGNMENT_VALIDITY_INVALID");
  const validTo = item.validTo ?? null;
  if (validTo !== null && (!validDate(validTo) || validTo < item.validFrom)) fail("CTE_ASSIGNMENT_VALIDITY_INVALID");
  if (!SCOPES.includes(item.scope as CteAssignmentScope)) fail("CTE_ASSIGNMENT_SCOPE_INVALID");
  const assignees = item.assigneeUserIds ?? [];
  if (!Array.isArray(assignees) || assignees.length > MAX_LIST) fail("CTE_ASSIGNMENT_INVALID");
  for (const userId of assignees) assertId(userId, "CTE_ASSIGNMENT_INVALID");
  const unique = [...new Set(assignees as string[])].sort();
  if (item.scope === "BRANCHES" ? unique.length === 0 : unique.length > 0) fail("CTE_ASSIGNMENT_SCOPE_INVALID");
  assertId(item.assignedBy, "CTE_ASSIGNMENT_INVALID");
  return { archiveId: item.archiveId, validFrom: item.validFrom as string, validTo: validTo as string | null, scope: item.scope as CteAssignmentScope, assigneeUserIds: unique, assignedBy: item.assignedBy };
}

// ---------------------------------------------------------------------------
// Chain index and limit arithmetic

export interface OrgChainIndex {
  readonly nodes: ReadonlyMap<string, TenantRecord<OrgNode>>;
}

export function buildOrgChainIndex(records: readonly TenantRecord<OrgNode>[]): OrgChainIndex {
  const nodes = new Map<string, TenantRecord<OrgNode>>();
  for (const record of records) { const node = validateOrgNode(record.payload); nodes.set(node.userId, { ...record, payload: node }); }
  return { nodes };
}

/** Ancestors from the direct parent up to the company. */
export function ancestorUserIds(index: OrgChainIndex, userId: string): readonly string[] {
  const path: string[] = [];
  const seen = new Set<string>([userId]);
  let parent = index.nodes.get(userId)?.payload.parentUserId ?? null;
  while (parent !== null) {
    if (seen.has(parent)) fail("ORG_CHAIN_CYCLE");
    seen.add(parent); path.push(parent);
    parent = index.nodes.get(parent)?.payload.parentUserId ?? null;
  }
  return path;
}

export function childUserIds(index: OrgChainIndex, userId: string): readonly string[] {
  return [...index.nodes.values()].filter((record) => record.payload.parentUserId === userId).map((record) => record.payload.userId).sort();
}

/** The node and everybody below it. */
export function subtreeUserIds(index: OrgChainIndex, userId: string): ReadonlySet<string> {
  const result = new Set<string>();
  const queue = [userId];
  while (queue.length) { const next = queue.shift() as string; if (result.has(next)) continue; result.add(next); queue.push(...childUserIds(index, next)); }
  return result;
}

function intersect<T extends string>(left: readonly T[] | null, right: readonly T[] | null): readonly T[] | null {
  if (left === null) return right;
  if (right === null) return left;
  return left.filter((item) => right.includes(item));
}

export function combineLimits(outer: CommercialLimits, inner: CommercialLimits): CommercialLimits {
  return { vectors: intersect(outer.vectors, inner.vectors), customerCategories: intersect(outer.customerCategories, inner.customerCategories), excludedCteArchiveIds: [...new Set([...outer.excludedCteArchiveIds, ...inner.excludedCteArchiveIds])].sort() };
}

export function effectiveLimits(index: OrgChainIndex, userId: string): CommercialLimits {
  if (!index.nodes.has(userId)) return UNRESTRICTED_LIMITS;
  return [userId, ...ancestorUserIds(index, userId)].reverse().reduce((limits, id) => combineLimits(limits, index.nodes.get(id)?.payload.limits ?? UNRESTRICTED_LIMITS), UNRESTRICTED_LIMITS);
}

// `null` on the child inherits the parent's value, so only explicit values can overreach.
function within<T extends string>(child: readonly T[] | null, parent: readonly T[] | null): boolean {
  if (parent === null || child === null) return true;
  return child.every((item) => parent.includes(item));
}

/** A level may only add restrictions: it can never allow what the level above forbids. */
export function assertLimitsWithin(limits: CommercialLimits, parentEffective: CommercialLimits): void {
  if (!within(limits.vectors, parentEffective.vectors) || !within(limits.customerCategories, parentEffective.customerCategories)) fail("ORG_LIMITS_EXCEED_PARENT");
}

// ---------------------------------------------------------------------------
// Actor

export interface HierarchyActor {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: CanonicalProductRole;
}

function activeMembership(memberships: readonly FoundationMembershipRecord[], tenantId: string, userId: string): FoundationMembershipRecord | null {
  return memberships.find((record) => record.tenantId === tenantId && record.userId === userId && record.status === "ACTIVE") ?? null;
}

export function hierarchyActor(principal: Pick<AuthenticatedPrincipal, "userId" | "tenantId" | "role">, memberships: readonly FoundationMembershipRecord[]): HierarchyActor {
  const membership = activeMembership(memberships, principal.tenantId, principal.userId);
  return { userId: principal.userId, tenantId: principal.tenantId, role: membership ? foundationRoleToCanonical(membership.role) : legacyAuthRoleToCanonical(principal.role) };
}

function membershipFitsLevel(membership: FoundationMembershipRecord, level: OrgLevel): boolean {
  if (level === "AZIENDA") return foundationRoleToCanonical(membership.role) === "SUPER_ADMIN";
  if (level === "AGENTE") return membership.role === "SALES_OPERATOR";
  return membership.role === "SALES_MANAGER";
}

function nodeView(index: OrgChainIndex, record: TenantRecord<OrgNode>): OrgNodeView {
  return { ...record.payload, version: record.version, updatedAt: record.updatedAt, effectiveLimits: effectiveLimits(index, record.payload.userId), ancestorUserIds: ancestorUserIds(index, record.payload.userId) };
}

/** Company admins see the whole chain; everybody else sees their own path up and their branch down. */
export function visibleOrgNodes(index: OrgChainIndex, actor: HierarchyActor): readonly OrgNodeView[] {
  const visible = actor.role === "SUPER_ADMIN" ? new Set(index.nodes.keys()) : new Set([...ancestorUserIds(index, actor.userId), ...subtreeUserIds(index, actor.userId)]);
  return [...index.nodes.values()].filter((record) => visible.has(record.payload.userId)).sort((left, right) => rank(left.payload.level) - rank(right.payload.level) || left.payload.userId.localeCompare(right.payload.userId)).map((record) => nodeView(index, record));
}

/** Who may change the node of `targetUserId` and hang it under `parentUserId`. */
function assertEditAuthority(index: OrgChainIndex, actor: HierarchyActor, targetUserId: string, parentUserId: string | null): void {
  if (actor.role === "SUPER_ADMIN") return;
  if (actor.userId === targetUserId) fail("ORG_SELF_EDIT_DENIED");
  if (!index.nodes.has(actor.userId)) fail("ORG_SCOPE_DENIED");
  const branch = subtreeUserIds(index, actor.userId);
  if (index.nodes.has(targetUserId) && !branch.has(targetUserId)) fail("ORG_SCOPE_DENIED");
  if (parentUserId === null || !branch.has(parentUserId)) fail("ORG_SCOPE_DENIED");
}

export interface SaveOrgNodeInput {
  readonly userId: unknown;
  readonly level: unknown;
  readonly parentUserId?: unknown;
  readonly displayName?: unknown;
  readonly limits?: unknown;
  readonly expectedVersion?: unknown;
}

export interface HierarchyStores {
  readonly orgChain: OrgChainRepository;
  readonly memberships: readonly FoundationMembershipRecord[];
}

function expectedVersionOf(value: unknown, exists: boolean, prefix: string): number | undefined {
  if (value === undefined || value === null) { if (exists) fail(`${prefix}_VERSION_REQUIRED`); return undefined; }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(`${prefix}_VERSION_INVALID`);
  return value;
}

function conflict(error: unknown, code: string): never {
  if (error instanceof Error && error.message === "PERSISTENCE_VERSION_CONFLICT") fail(code);
  throw error;
}

export async function saveOrgNode(stores: HierarchyStores, actor: HierarchyActor, input: SaveOrgNodeInput, now?: string): Promise<OrgNodeView> {
  const node = validateOrgNode({ userId: input.userId, level: input.level, parentUserId: input.parentUserId ?? null, displayName: input.displayName ?? null, limits: input.limits, updatedBy: actor.userId });
  const index = buildOrgChainIndex(await stores.orgChain.list(actor.tenantId));
  const existing = index.nodes.get(node.userId) ?? null;
  const expectedVersion = expectedVersionOf(input.expectedVersion, existing !== null, "ORG");
  if (existing && existing.version !== expectedVersion) fail("ORG_VERSION_CONFLICT");
  assertEditAuthority(index, actor, node.userId, node.parentUserId);
  if (node.level === "AZIENDA" && actor.role !== "SUPER_ADMIN") fail("ORG_SCOPE_DENIED");

  const membership = activeMembership(stores.memberships, actor.tenantId, node.userId);
  if (!membership) fail("ORG_MEMBER_NOT_FOUND");
  if (!membershipFitsLevel(membership, node.level)) fail("ORG_LEVEL_ROLE_MISMATCH");

  let parentEffective = UNRESTRICTED_LIMITS;
  if (node.parentUserId !== null) {
    const parent = index.nodes.get(node.parentUserId);
    if (!parent || !activeMembership(stores.memberships, actor.tenantId, node.parentUserId)) fail("ORG_PARENT_NOT_FOUND");
    if (rank(parent.payload.level) >= rank(node.level)) fail("ORG_PARENT_LEVEL_INVALID");
    if (subtreeUserIds(index, node.userId).has(node.parentUserId)) fail("ORG_CHAIN_CYCLE");
    parentEffective = effectiveLimits(index, node.parentUserId);
  }
  for (const childId of childUserIds(index, node.userId)) {
    if (rank((index.nodes.get(childId) as TenantRecord<OrgNode>).payload.level) <= rank(node.level)) fail("ORG_CHILD_LEVEL_CONFLICT");
  }
  assertLimitsWithin(node.limits, parentEffective);

  try {
    const saved = await stores.orgChain.put({ tenantId: actor.tenantId, recordId: orgNodeRecordId(actor.tenantId, node.userId), payload: node, expectedVersion, now });
    const next = buildOrgChainIndex([...[...index.nodes.values()].filter((record) => record.payload.userId !== node.userId), saved]);
    return nodeView(next, next.nodes.get(node.userId) as TenantRecord<OrgNode>);
  } catch (error) { return conflict(error, "ORG_VERSION_CONFLICT"); }
}

export async function removeOrgNode(stores: HierarchyStores, actor: HierarchyActor, input: { readonly userId: unknown; readonly expectedVersion: unknown }): Promise<void> {
  assertId(input.userId, "ORG_NODE_INVALID");
  const index = buildOrgChainIndex(await stores.orgChain.list(actor.tenantId));
  const existing = index.nodes.get(input.userId);
  if (!existing) fail("ORG_NODE_NOT_FOUND");
  const expectedVersion = expectedVersionOf(input.expectedVersion, true, "ORG");
  if (existing.version !== expectedVersion) fail("ORG_VERSION_CONFLICT");
  assertEditAuthority(index, actor, input.userId, existing.payload.parentUserId);
  if (existing.payload.level === "AZIENDA" && actor.role !== "SUPER_ADMIN") fail("ORG_SCOPE_DENIED");
  if (childUserIds(index, input.userId).length > 0) fail("ORG_NODE_HAS_CHILDREN");
  try { await stores.orgChain.delete({ tenantId: actor.tenantId, recordId: existing.recordId, expectedVersion }); }
  catch (error) { conflict(error, "ORG_VERSION_CONFLICT"); }
}

// ---------------------------------------------------------------------------
// CTE assignment and usage

export interface SaveCteAssignmentInput {
  readonly archiveId: unknown;
  readonly validFrom: unknown;
  readonly validTo?: unknown;
  readonly scope: unknown;
  readonly assigneeUserIds?: unknown;
  readonly expectedVersion?: unknown;
}

export async function saveCteAssignment(stores: { readonly cteAssignments: CteAssignmentRepository; readonly orgChain: OrgChainRepository }, actor: HierarchyActor, knownArchiveIds: ReadonlySet<string>, input: SaveCteAssignmentInput, now?: string): Promise<CteAssignmentView> {
  if (actor.role !== "SUPER_ADMIN") fail("CTE_ASSIGNMENT_ADMIN_ONLY");
  const assignment = validateCteAssignment({ archiveId: input.archiveId, validFrom: input.validFrom, validTo: input.validTo ?? null, scope: input.scope, assigneeUserIds: input.assigneeUserIds ?? [], assignedBy: actor.userId });
  if (!knownArchiveIds.has(assignment.archiveId)) fail("CTE_ASSIGNMENT_CTE_NOT_FOUND");
  const index = buildOrgChainIndex(await stores.orgChain.list(actor.tenantId));
  if (assignment.assigneeUserIds.some((userId) => !index.nodes.has(userId))) fail("CTE_ASSIGNEE_NOT_IN_CHAIN");
  const recordId = cteAssignmentRecordId(actor.tenantId, assignment.archiveId);
  const existing = await stores.cteAssignments.get(actor.tenantId, recordId);
  const expectedVersion = expectedVersionOf(input.expectedVersion, existing !== null, "CTE_ASSIGNMENT");
  if (existing && existing.version !== expectedVersion) fail("CTE_ASSIGNMENT_VERSION_CONFLICT");
  try {
    const saved = await stores.cteAssignments.put({ tenantId: actor.tenantId, recordId, payload: assignment, expectedVersion, now });
    return { ...validateCteAssignment(saved.payload), version: saved.version, updatedAt: saved.updatedAt };
  } catch (error) { return conflict(error, "CTE_ASSIGNMENT_VERSION_CONFLICT"); }
}

export type CteUsability = "USABLE" | "NOT_YET_VALID" | "EXPIRED" | "EXCLUDED_BY_LIMITS" | "NOT_ASSIGNED";

export interface HierarchyAccess {
  readonly actor: HierarchyActor;
  readonly index: OrgChainIndex;
  readonly limits: CommercialLimits;
  readonly assignments: ReadonlyMap<string, CteAssignmentView>;
  readonly asOf: string;
}

export function buildHierarchyAccess(actor: HierarchyActor, nodes: readonly TenantRecord<OrgNode>[], assignments: readonly TenantRecord<CteAssignment>[], asOf: string): HierarchyAccess {
  if (!validDate(asOf)) fail("HIERARCHY_DATE_INVALID");
  const index = buildOrgChainIndex(nodes);
  const byArchive = new Map<string, CteAssignmentView>();
  for (const record of assignments) { const assignment = validateCteAssignment(record.payload); byArchive.set(assignment.archiveId, { ...assignment, version: record.version, updatedAt: record.updatedAt }); }
  return { actor, index, limits: effectiveLimits(index, actor.userId), assignments: byArchive, asOf };
}

export function cteUsability(access: HierarchyAccess, archiveId: string, vector?: LimitVector): CteUsability {
  const assignment = access.assignments.get(archiveId) ?? null;
  if (assignment && access.asOf < assignment.validFrom) return "NOT_YET_VALID";
  if (assignment && assignment.validTo !== null && access.asOf > assignment.validTo) return "EXPIRED";
  if (access.limits.excludedCteArchiveIds.includes(archiveId)) return "EXCLUDED_BY_LIMITS";
  if (vector !== undefined && access.limits.vectors !== null && !access.limits.vectors.includes(vector)) return "EXCLUDED_BY_LIMITS";
  if (access.actor.role === "SUPER_ADMIN" || assignment === null || assignment.scope === "ALL") return "USABLE";
  const path = new Set([access.actor.userId, ...ancestorUserIds(access.index, access.actor.userId)]);
  return assignment.assigneeUserIds.some((userId) => path.has(userId)) ? "USABLE" : "NOT_ASSIGNED";
}

export function assertSimulationWithinLimits(access: HierarchyAccess, vector: LimitVector, customerCategory: LimitCustomerCategory | null): void {
  if (access.limits.vectors !== null && !access.limits.vectors.includes(vector)) fail("HIERARCHY_VECTOR_NOT_ALLOWED");
  if (customerCategory !== null && access.limits.customerCategories !== null && !access.limits.customerCategories.includes(customerCategory)) fail("HIERARCHY_CUSTOMER_CATEGORY_NOT_ALLOWED");
}

export interface HierarchyRepositories {
  readonly foundationMemberships: TenantRecordRepository<FoundationMembershipRecord>;
  readonly orgChain: OrgChainRepository;
  readonly cteAssignments: CteAssignmentRepository;
}

export async function membershipPayloads(repositories: Pick<HierarchyRepositories, "foundationMemberships">, tenantId: string): Promise<readonly FoundationMembershipRecord[]> {
  return (await repositories.foundationMemberships.list(tenantId)).map((record) => record.payload);
}

export async function loadHierarchyAccess(principal: Pick<AuthenticatedPrincipal, "userId" | "tenantId" | "role">, repositories: HierarchyRepositories, asOf = new Date().toISOString().slice(0, 10)): Promise<HierarchyAccess> {
  const actor = hierarchyActor(principal, await membershipPayloads(repositories, principal.tenantId));
  const [nodes, assignments] = await Promise.all([repositories.orgChain.list(principal.tenantId), repositories.cteAssignments.list(principal.tenantId)]);
  return buildHierarchyAccess(actor, nodes, assignments, asOf);
}
