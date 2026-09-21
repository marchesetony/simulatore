import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assignMembershipManager } from "../app/lib/foundation/memberships.ts";
import { resolveTenantContext } from "../app/lib/foundation/tenants.ts";
import { buildBillVisibilityScope, billInScope, getBillInScope, listBillsInScope } from "../app/lib/foundation/bill-visibility.ts";

const tenantA = "tenant_azienda-a";
const tenantB = "tenant_azienda-b";
const at = "2026-09-16T10:00:00.000Z";

function principal(userId, role, tenantId = tenantA) {
  return { userId, tenantId, role, sessionId: `session-${userId}`, issuedAt: at, expiresAt: "2026-09-16T11:00:00.000Z", source: "LOCAL_SYNTHETIC" };
}
function membership(id, userId, role, tenantId = tenantA, managerUserId) {
  return { id, userId, tenantId, role, status: "ACTIVE", permissions: role === "SALES_MANAGER" ? ["tenant:read", "membership:read", "customer:read", "customer:manage", "document:read", "document:manage"] : ["tenant:read", "customer:read", "document:read"], createdAt: at, updatedAt: at, ...(managerUserId ? { managerUserId } : {}) };
}
function bill(id, ownerUserId, tenantId = tenantA) { return { id, tenantId, ownerUserId }; }

const superAdmin = principal("SUPER_ADMIN_A", "ADMIN");
const adminNord = principal("ADMIN_NORD", "ANALYST");
const adminSud = principal("ADMIN_SUD", "ANALYST");
const agent1 = principal("AGENT_1", "VIEWER");
const agent2 = principal("AGENT_2", "VIEWER");
const agent3 = principal("AGENT_3", "VIEWER");
const agent4 = principal("AGENT_4", "VIEWER");
const memberships = [
  membership("m-super", "SUPER_ADMIN_A", "PLATFORM_OWNER"),
  membership("m-nord", "ADMIN_NORD", "SALES_MANAGER"),
  membership("m-sud", "ADMIN_SUD", "SALES_MANAGER"),
  membership("m-a1", "AGENT_1", "SALES_OPERATOR", tenantA, "ADMIN_NORD"),
  membership("m-a2", "AGENT_2", "SALES_OPERATOR", tenantA, "ADMIN_NORD"),
  membership("m-a3", "AGENT_3", "SALES_OPERATOR", tenantA, "ADMIN_SUD"),
  membership("m-a4", "AGENT_4", "SALES_OPERATOR"),
];
const bills = [
  bill("Bill_SA", "SUPER_ADMIN_A"),
  bill("Bill_ADMIN_NORD", "ADMIN_NORD"),
  bill("Bill_ADMIN_SUD", "ADMIN_SUD"),
  bill("Bill_AGENT_1", "AGENT_1"),
  bill("Bill_AGENT_2", "AGENT_2"),
  bill("Bill_AGENT_3", "AGENT_3"),
  bill("Bill_AGENT_4", "AGENT_4"),
  bill("Bill_Tenant_B", "OTHER_BILL_OWNER", tenantB),
  bill("Bill_Legacy_Unassigned", undefined),
];

class MemoryBills {
  async list(tenantId) { return bills.filter((item) => item.tenantId === tenantId); }
  async get(tenantId, id) { return bills.find((item) => item.tenantId === tenantId && item.id === id) ?? null; }
}
class MemoryMemberships {
  async list(tenantId) { return memberships.filter((item) => item.tenantId === tenantId).map((payload) => ({ schemaVersion: 1, recordId: payload.id, tenantId, version: 1, createdAt: at, updatedAt: at, payload })); }
}
const repositories = { billRepository: new MemoryBills(), foundationMemberships: new MemoryMemberships() };

const superScope = buildBillVisibilityScope(superAdmin, memberships);
assert.equal(superScope.role, "SUPER_ADMIN");
assert.deepEqual((await listBillsInScope(superAdmin, repositories)).map((item) => item.id), bills.filter((item) => item.tenantId === tenantA).map((item) => item.id));
assert.equal(billInScope(bills.find((item) => item.id === "Bill_Tenant_B"), superScope), false);

const nordIds = (await listBillsInScope(adminNord, repositories)).map((item) => item.id).sort();
assert.deepEqual(nordIds, ["Bill_ADMIN_NORD", "Bill_AGENT_1", "Bill_AGENT_2"].sort());
assert.deepEqual((await listBillsInScope(adminSud, repositories)).map((item) => item.id).sort(), ["Bill_ADMIN_SUD", "Bill_AGENT_3"].sort());
assert.deepEqual((await listBillsInScope(agent1, repositories)).map((item) => item.id), ["Bill_AGENT_1"]);
assert.deepEqual((await listBillsInScope(agent2, repositories)).map((item) => item.id), ["Bill_AGENT_2"]);
assert.deepEqual((await listBillsInScope(agent3, repositories)).map((item) => item.id), ["Bill_AGENT_3"]);
assert.deepEqual((await listBillsInScope(agent4, repositories)).map((item) => item.id), ["Bill_AGENT_4"]);
assert.equal(await getBillInScope(agent1, repositories, "Bill_AGENT_2"), null);
assert.equal(await getBillInScope(adminNord, repositories, "Bill_AGENT_3"), null);
assert.equal(await getBillInScope(superAdmin, repositories, "Bill_Legacy_Unassigned") !== null, true);

const actor = resolveTenantContext(
  { userId: "SUPER_ADMIN_A", subject: "subject", email: "synthetic@example.test", active: true },
  { id: "actor-membership", userId: "SUPER_ADMIN_A", tenantId: tenantA, role: "PLATFORM_OWNER", status: "ACTIVE", permissions: ["membership:manage"] },
  tenantA,
);
class MemoryAssignmentRepository {
  constructor() { this.records = new Map(memberships.map((record) => [record.tenantId + record.id, { ...record, version: 1 }])); }
  async get(tenantId, id) { return this.records.get(tenantId + id) ?? null; }
  async list(tenantId) { return [...this.records.values()].filter((record) => record.tenantId === tenantId); }
  async put({ record, expectedVersion }) { const key = record.tenantId + record.id; const current = this.records.get(key); if (!current || current.version !== expectedVersion) throw new Error("MEMBERSHIP_VERSION_CONFLICT"); const next = { ...record, version: expectedVersion + 1 }; this.records.set(key, next); return next; }
  async append() { throw new Error("NOT_USED"); }
}
const assignments = new MemoryAssignmentRepository();
const assigned = await assignMembershipManager(assignments, { actor, tenantId: tenantA, membershipId: "m-a4", expectedVersion: 1, managerUserId: "ADMIN_NORD", now: at });
assert.equal(assigned.managerUserId, "ADMIN_NORD");
await assert.rejects(() => assignMembershipManager(assignments, { actor: resolveTenantContext({ userId: "ADMIN_NORD", subject: "s", email: "admin@example.test", active: true }, { id: "m-nord", userId: "ADMIN_NORD", tenantId: tenantA, role: "SALES_MANAGER", status: "ACTIVE", permissions: ["membership:manage"] }, tenantA), tenantId: tenantA, membershipId: "m-a4", expectedVersion: 2, managerUserId: "ADMIN_SUD", now: at }), /ASSIGNMENT_SUPER_ADMIN_ONLY/);
await assert.rejects(() => assignMembershipManager(assignments, { actor, tenantId: tenantA, membershipId: "m-a4", expectedVersion: 2, managerUserId: "UNKNOWN_ADMIN", now: at }), /ASSIGNMENT_MANAGER_INVALID/);

const routeSources = await Promise.all([
  readFile(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/bills/[id]/download/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/bills/[id]/retry/route.ts", import.meta.url), "utf8"),
]);
for (const source of routeSources) assert.match(source, /getBillInScope/);
const listSource = await readFile(new URL("../app/api/bills/route.ts", import.meta.url), "utf8");
assert.match(listSource, /billInScope/);
assert.match(listSource, /ownerUserId: principal\.userId/);
const assignmentSource = await readFile(new URL("../app/api/foundation/memberships/[id]/assignment/route.ts", import.meta.url), "utf8");
assert.match(assignmentSource, /assignMembershipManager/);
console.log("SUPER_ADMIN_ALL_TENANT_BILLS=PASS");
console.log("SUPER_ADMIN_CROSS_TENANT_DENIED=PASS");
console.log("ADMIN_ASSIGNED_USERS_VISIBLE=PASS");
console.log("ADMIN_OTHER_ADMIN_USERS_DENIED=PASS");
console.log("ADMIN_UNASSIGNED_USERS_DENIED=PASS");
console.log("AGENT_OWN_BILLS_VISIBLE=PASS");
console.log("AGENT_OTHER_USER_BILLS_DENIED=PASS");
console.log("AGENT_PRIVILEGE_ESCALATION_DENIED=PASS");
console.log("ADMIN_PRIVILEGE_ESCALATION_DENIED=PASS");
console.log("ASSIGNMENT_TAMPERING_DENIED=PASS");
console.log("BILL_HIERARCHY_TESTS=PASS");
