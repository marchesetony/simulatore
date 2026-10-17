import type { AuthenticatedPrincipal } from "../auth/types";
import { AuthenticationError } from "../auth/errors";
import { runtimeRepositories } from "../persistence/adapter";
import { recordMutationAudit } from "../auth/mutation-audit";
import { currentApprovedCteVersion } from "../cte/archive/service";
import { buildHierarchyAccess, cteUsability, hierarchyActor, membershipPayloads, removeOrgNode, saveCteAssignment, saveOrgNode, subtreeUserIds, visibleOrgNodes } from "./service";

const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const LEVEL_FOR_ROLE: Readonly<Record<string, readonly string[]>> = { PRODUCT_OWNER: ["AZIENDA"], PLATFORM_OWNER: ["AZIENDA"], TENANT_ADMIN: ["AZIENDA"], SALES_MANAGER: ["DIRETTORE", "AREA_MANAGER"], SALES_OPERATOR: ["AGENTE"] };

function today(): string { return new Date().toISOString().slice(0, 10); }

async function context(principal: AuthenticatedPrincipal) {
  const repositories = runtimeRepositories();
  const memberships = await membershipPayloads(repositories, principal.tenantId);
  const actor = hierarchyActor(principal, memberships);
  return { repositories, memberships, actor };
}

/** The chain the caller may see, the people that can still be placed in it, and the caller's own limits. */
export async function hierarchyResponse(principal: AuthenticatedPrincipal): Promise<Response> {
  const { repositories, memberships, actor } = await context(principal);
  const [nodes, assignments] = await Promise.all([repositories.orgChain.list(principal.tenantId), repositories.cteAssignments.list(principal.tenantId)]);
  const access = buildHierarchyAccess(actor, nodes, assignments, today());
  const visible = visibleOrgNodes(access.index, actor);
  const placed = new Set(access.index.nodes.keys());
  const branch = access.index.nodes.has(actor.userId) ? subtreeUserIds(access.index, actor.userId) : new Set<string>();
  const members = memberships
    .filter((record) => record.tenantId === principal.tenantId && record.status === "ACTIVE")
    // Managers may place people who are not in the chain yet, below themselves.
    .filter((record) => actor.role === "SUPER_ADMIN" || branch.has(record.userId) || (!placed.has(record.userId) && (record.role === "SALES_OPERATOR" || record.role === "SALES_MANAGER")))
    .map((record) => ({ userId: record.userId, role: record.role, allowedLevels: LEVEL_FOR_ROLE[record.role] ?? [], placed: placed.has(record.userId) }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
  const own = access.index.nodes.get(actor.userId);
  return Response.json({ actor: { userId: actor.userId, role: actor.role, level: own?.payload.level ?? null, effectiveLimits: access.limits, canManageCompany: actor.role === "SUPER_ADMIN" }, nodes: visible, members }, { headers: HEADERS });
}

export async function saveOrgNodeResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  const { repositories, memberships, actor } = await context(principal);
  const node = await saveOrgNode({ orgChain: repositories.orgChain, memberships }, actor, { ...body, userId: body.userId, level: body.level });
  await recordMutationAudit({ principal, action: "ORG_CHAIN_NODE_SAVED", resourceType: "ORG_CHAIN", resourceId: node.userId, targetUserId: node.userId, metadata: { level: node.level, parentUserId: node.parentUserId ?? "NONE", version: node.version } });
  return Response.json({ node }, { headers: HEADERS });
}

export async function removeOrgNodeResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  const { repositories, memberships, actor } = await context(principal);
  await removeOrgNode({ orgChain: repositories.orgChain, memberships }, actor, { userId: body.userId, expectedVersion: body.expectedVersion });
  await recordMutationAudit({ principal, action: "ORG_CHAIN_NODE_REMOVED", resourceType: "ORG_CHAIN", resourceId: String(body.userId), targetUserId: String(body.userId), metadata: {} });
  return Response.json({ removed: true }, { headers: HEADERS });
}

function cteSummary(record: Awaited<ReturnType<ReturnType<typeof runtimeRepositories>["cteArchiveRepository"]["list"]>>[number]) {
  const version = currentApprovedCteVersion(record);
  const contract = version?.contract ?? record.versions[record.versions.length - 1]?.contract;
  return { archiveId: record.archiveId, cteId: record.cteId, vector: record.vector, supplier: contract?.supplier.name ?? null, offerName: contract?.offer.name ?? null, offerCode: contract?.offer.code ?? null, approved: version !== null };
}

/** Company admins get every CTE with its assignment; operators only the CTEs they may sell today. */
export async function cteAssignmentsResponse(principal: AuthenticatedPrincipal): Promise<Response> {
  const { repositories, actor } = await context(principal);
  const [records, nodes, assignments] = await Promise.all([repositories.cteArchiveRepository.list(principal.tenantId), repositories.orgChain.list(principal.tenantId), repositories.cteAssignments.list(principal.tenantId)]);
  const access = buildHierarchyAccess(actor, nodes, assignments, today());
  const ctes = records.map((record) => ({ ...cteSummary(record), assignment: actor.role === "SUPER_ADMIN" ? access.assignments.get(record.archiveId) ?? null : null, usability: cteUsability(access, record.archiveId, record.vector) }))
    .filter((item) => actor.role === "SUPER_ADMIN" || item.usability === "USABLE")
    .sort((left, right) => left.archiveId.localeCompare(right.archiveId));
  return Response.json({ asOf: access.asOf, canAssign: actor.role === "SUPER_ADMIN", ctes }, { headers: HEADERS });
}

export async function saveCteAssignmentResponse(principal: AuthenticatedPrincipal, body: Record<string, unknown>): Promise<Response> {
  const { repositories, actor } = await context(principal);
  const records = await repositories.cteArchiveRepository.list(principal.tenantId);
  const assignment = await saveCteAssignment({ cteAssignments: repositories.cteAssignments, orgChain: repositories.orgChain }, actor, new Set(records.map((record) => record.archiveId)), body as never);
  await recordMutationAudit({ principal, action: "CTE_ASSIGNMENT_SAVED", resourceType: "CTE_ASSIGNMENT", resourceId: assignment.archiveId, metadata: { scope: assignment.scope, assignees: assignment.assigneeUserIds.length, validFrom: assignment.validFrom, validTo: assignment.validTo ?? "OPEN", version: assignment.version } });
  return Response.json({ assignment }, { headers: HEADERS });
}

export function hierarchyError(error: unknown): Response {
  const code = error instanceof AuthenticationError ? error.code : error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "HIERARCHY_REQUEST_INVALID";
  const status = error instanceof AuthenticationError
    ? code === "AUTHORIZATION_DENIED" || code === "TENANT_MISMATCH" ? 403 : code.startsWith("AUTH_") ? 503 : 401
    : code.endsWith("_DENIED") || code.endsWith("_ADMIN_ONLY") ? 403
    : code.endsWith("_NOT_FOUND") ? 404
    : code.endsWith("_VERSION_CONFLICT") ? 409
    : code === "HIERARCHY_STORAGE_UNAVAILABLE" ? 503 : 422;
  return Response.json({ error: { code, message: "Hierarchy request denied" } }, { status, headers: HEADERS });
}
