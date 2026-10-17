import assert from "node:assert/strict";

import { buildHierarchyAccess, cteUsability, assertSimulationWithinLimits, effectiveLimits, buildOrgChainIndex, hierarchyActor, removeOrgNode, saveCteAssignment, saveOrgNode, visibleOrgNodes } from "../app/lib/hierarchy/service.ts";
import { buildBillVisibilityScope } from "../app/lib/foundation/bill-visibility.ts";

const tenant = "tenant_catena-demo";
const at = "2026-10-01T09:00:00.000Z";

/** In-memory tenant record store with the same optimistic-version contract as the real adapters. */
function memoryRepository() {
  const rows = new Map();
  const key = (tenantId, recordId) => `${tenantId}|${recordId}`;
  return {
    async get(tenantId, recordId) { return structuredClone(rows.get(key(tenantId, recordId)) ?? null); },
    async list(tenantId) { return [...rows.values()].filter((row) => row.tenantId === tenantId).map((row) => structuredClone(row)); },
    async put({ tenantId, recordId, payload, expectedVersion, now = at }) {
      const existing = rows.get(key(tenantId, recordId));
      if ((existing?.version ?? undefined) !== expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      const row = { schemaVersion: 1, tenantId, recordId, payload: structuredClone(payload), version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };
      rows.set(key(tenantId, recordId), row); return structuredClone(row);
    },
    async append(input) { return this.put(input); },
    async delete({ tenantId, recordId, expectedVersion }) {
      const existing = rows.get(key(tenantId, recordId));
      if (!existing || existing.version !== expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      rows.delete(key(tenantId, recordId));
    },
  };
}

function membership(userId, role) { return { id: `membership_${userId}`, userId, tenantId: tenant, role, status: "ACTIVE", permissions: [], createdAt: at, updatedAt: at }; }
function principal(userId, role) { return { userId, tenantId: tenant, role, sessionId: `session_${userId}`, issuedAt: at, expiresAt: "2026-10-01T10:00:00.000Z", source: "LOCAL_SYNTHETIC" }; }

const memberships = [
  membership("user_azienda", "TENANT_ADMIN"),
  membership("user_direttore", "SALES_MANAGER"),
  membership("user_area-nord", "SALES_MANAGER"),
  membership("user_area-sud", "SALES_MANAGER"),
  membership("user_agente-1", "SALES_OPERATOR"),
  membership("user_agente-2", "SALES_OPERATOR"),
  membership("user_agente-sud", "SALES_OPERATOR"),
];
const actorOf = (userId, legacyRole = "VIEWER") => hierarchyActor(principal(userId, legacyRole), memberships);
const azienda = actorOf("user_azienda", "ADMIN");
const direttore = actorOf("user_direttore", "ANALYST");
const areaNord = actorOf("user_area-nord", "ANALYST");
const agente1 = actorOf("user_agente-1");

assert.equal(azienda.role, "SUPER_ADMIN");
assert.equal(direttore.role, "ADMIN");
assert.equal(agente1.role, "AGENT");

const orgChain = memoryRepository();
const cteAssignments = memoryRepository();
const stores = { orgChain, memberships };

// 1. The company builds the top of the chain.
await saveOrgNode(stores, azienda, { userId: "user_azienda", level: "AZIENDA", displayName: "Lumenica Energia Demo S.r.l." });
await saveOrgNode(stores, azienda, { userId: "user_direttore", level: "DIRETTORE", parentUserId: "user_azienda", displayName: "Direttore commerciale", limits: { vectors: ["EE", "GAS"], customerCategories: ["RESIDENTIAL", "NON_RESIDENTIAL"] } });

// 2. Role and level must agree, levels go strictly down, nobody edits themselves.
await assert.rejects(() => saveOrgNode(stores, azienda, { userId: "user_agente-1", level: "DIRETTORE", parentUserId: "user_azienda" }), /ORG_LEVEL_ROLE_MISMATCH/);
await assert.rejects(() => saveOrgNode(stores, azienda, { userId: "user_area-nord", level: "DIRETTORE", parentUserId: "user_direttore" }), /ORG_PARENT_LEVEL_INVALID/);
await assert.rejects(() => saveOrgNode(stores, direttore, { userId: "user_direttore", level: "DIRETTORE", parentUserId: "user_azienda", expectedVersion: 1 }), /ORG_SELF_EDIT_DENIED/);
await assert.rejects(() => saveOrgNode(stores, azienda, { userId: "user_ghost", level: "AGENTE", parentUserId: "user_direttore" }), /ORG_MEMBER_NOT_FOUND/);

// 3. The director narrows the north area to electricity only; it cannot widen beyond its own limits.
await saveOrgNode(stores, direttore, { userId: "user_area-nord", level: "AREA_MANAGER", parentUserId: "user_direttore", limits: { vectors: ["EE"] } });
await saveOrgNode(stores, direttore, { userId: "user_area-sud", level: "AREA_MANAGER", parentUserId: "user_direttore" });
await assert.rejects(() => saveOrgNode(stores, areaNord, { userId: "user_agente-1", level: "AGENTE", parentUserId: "user_area-nord", limits: { vectors: ["EE", "GAS"] } }), /ORG_LIMITS_EXCEED_PARENT/);
await saveOrgNode(stores, areaNord, { userId: "user_agente-1", level: "AGENTE", parentUserId: "user_area-nord", limits: { customerCategories: ["RESIDENTIAL"] } });
await saveOrgNode(stores, areaNord, { userId: "user_agente-2", level: "AGENTE", parentUserId: "user_area-nord" });
// An area manager cannot reach into another area.
await assert.rejects(() => saveOrgNode(stores, areaNord, { userId: "user_agente-sud", level: "AGENTE", parentUserId: "user_area-sud" }), /ORG_SCOPE_DENIED/);
await saveOrgNode(stores, direttore, { userId: "user_agente-sud", level: "AGENTE", parentUserId: "user_area-sud" });

const index = buildOrgChainIndex(await orgChain.list(tenant));
assert.deepEqual(effectiveLimits(index, "user_agente-1"), { vectors: ["EE"], customerCategories: ["RESIDENTIAL"], excludedCteArchiveIds: [] }, "limits accumulate down the chain");
assert.deepEqual(effectiveLimits(index, "user_agente-sud").vectors, ["EE", "GAS"]);

// 4. Visibility: an area manager sees its path up and its own branch, never the other area.
const seenByNord = visibleOrgNodes(index, areaNord).map((node) => node.userId);
assert.deepEqual(seenByNord.sort(), ["user_agente-1", "user_agente-2", "user_area-nord", "user_azienda", "user_direttore"]);
assert.equal(visibleOrgNodes(index, azienda).length, 7);

// 5. The company assigns CTEs with a validity window and a branch.
const known = new Set(["cte_luce-nord", "cte_gas-tutti", "cte_luce-tutti", "cte_scaduta"]);
await saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_luce-nord", validFrom: "2026-09-01", validTo: "2026-12-31", scope: "BRANCHES", assigneeUserIds: ["user_area-nord"] });
await saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_gas-tutti", validFrom: "2026-09-01", validTo: null, scope: "ALL" });
await saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_scaduta", validFrom: "2026-01-01", validTo: "2026-06-30", scope: "ALL" });
await assert.rejects(() => saveCteAssignment({ cteAssignments, orgChain }, direttore, known, { archiveId: "cte_luce-tutti", validFrom: "2026-09-01", scope: "ALL" }), /CTE_ASSIGNMENT_ADMIN_ONLY/);
await assert.rejects(() => saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_ignota", validFrom: "2026-09-01", scope: "ALL" }), /CTE_ASSIGNMENT_CTE_NOT_FOUND/);
await assert.rejects(() => saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_luce-tutti", validFrom: "2026-10-01", validTo: "2026-09-01", scope: "ALL" }), /CTE_ASSIGNMENT_VALIDITY_INVALID/);
await assert.rejects(() => saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_luce-tutti", validFrom: "2026-09-01", scope: "BRANCHES", assigneeUserIds: [] }), /CTE_ASSIGNMENT_SCOPE_INVALID/);
await assert.rejects(() => saveCteAssignment({ cteAssignments, orgChain }, azienda, known, { archiveId: "cte_luce-nord", validFrom: "2026-09-01", scope: "ALL" }), /CTE_ASSIGNMENT_VERSION_REQUIRED/);

const accessFor = async (actor, asOf = "2026-10-17") => buildHierarchyAccess(actor, await orgChain.list(tenant), await cteAssignments.list(tenant), asOf);
const forAgente1 = await accessFor(agente1);
const forAgenteSud = await accessFor(actorOf("user_agente-sud"));
assert.equal(cteUsability(forAgente1, "cte_luce-nord"), "USABLE", "inherited from the north branch");
assert.equal(cteUsability(forAgenteSud, "cte_luce-nord"), "NOT_ASSIGNED");
assert.equal(cteUsability(forAgenteSud, "cte_gas-tutti"), "USABLE");
assert.equal(cteUsability(forAgente1, "cte_gas-tutti", "GAS"), "EXCLUDED_BY_LIMITS", "the north branch sells electricity only");
assert.equal(cteUsability(forAgenteSud, "cte_scaduta"), "EXPIRED");
assert.equal(cteUsability(forAgenteSud, "cte_luce-tutti"), "USABLE", "a CTE without assignment stays available to everybody, as before");
assert.equal(cteUsability(await accessFor(agente1, "2026-08-31"), "cte_luce-nord"), "NOT_YET_VALID");
assert.equal(cteUsability(await accessFor(azienda), "cte_luce-nord"), "USABLE", "the company can always use its own CTEs inside the validity window");

// 6. Simulation limits: the north agent sells electricity to residential customers only.
assert.doesNotThrow(() => assertSimulationWithinLimits(forAgente1, "EE", "RESIDENTIAL"));
assert.throws(() => assertSimulationWithinLimits(forAgente1, "GAS", "RESIDENTIAL"), /HIERARCHY_VECTOR_NOT_ALLOWED/);
assert.throws(() => assertSimulationWithinLimits(forAgente1, "EE", "NON_RESIDENTIAL"), /HIERARCHY_CUSTOMER_CATEGORY_NOT_ALLOWED/);

// 7. A manager excludes a CTE for its branch; the exclusion reaches every agent below.
const nord = (await orgChain.list(tenant)).find((record) => record.payload.userId === "user_area-nord");
await saveOrgNode(stores, direttore, { userId: "user_area-nord", level: "AREA_MANAGER", parentUserId: "user_direttore", limits: { vectors: ["EE"], excludedCteArchiveIds: ["cte_gas-tutti"] }, expectedVersion: nord.version });
assert.equal(cteUsability(await accessFor(actorOf("user_agente-2")), "cte_gas-tutti"), "EXCLUDED_BY_LIMITS");
await assert.rejects(() => saveOrgNode(stores, direttore, { userId: "user_area-nord", level: "AREA_MANAGER", parentUserId: "user_direttore", expectedVersion: nord.version }), /ORG_VERSION_CONFLICT/);

// 8. Bills: a manager sees the whole branch below, not the other area.
const scope = buildBillVisibilityScope(principal("user_direttore", "ANALYST"), memberships, await orgChain.list(tenant));
assert.ok(scope.ownerUserIds.has("user_agente-1") && scope.ownerUserIds.has("user_agente-sud"));
const scopeNord = buildBillVisibilityScope(principal("user_area-nord", "ANALYST"), memberships, await orgChain.list(tenant));
assert.ok(scopeNord.ownerUserIds.has("user_agente-2") && !scopeNord.ownerUserIds.has("user_agente-sud"));

// 9. Removal: only leaves, and only by someone above.
await assert.rejects(() => removeOrgNode(stores, azienda, { userId: "user_area-sud", expectedVersion: 1 }), /ORG_NODE_HAS_CHILDREN/);
await assert.rejects(() => removeOrgNode(stores, areaNord, { userId: "user_agente-sud", expectedVersion: 1 }), /ORG_SCOPE_DENIED/);
await removeOrgNode(stores, actorOf("user_area-sud", "ANALYST"), { userId: "user_agente-sud", expectedVersion: 1 });
assert.equal((await orgChain.list(tenant)).length, 6);

console.log("hierarchy and CTE assignment smoke passed");
