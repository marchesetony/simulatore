// Tony (24/11/2026, "PERMESSI GERARCHICI E ANALISI BOLLETTE", Modulo A): the company administrator changes role and
// responsabile of people already created (e.g. assigns a sub-agente to another agente). Server-side checks: own company
// only, never on oneself, never to or from administrator, responsabile above, people below stay below, no cycles; login
// role, membership permissions, account and chain change together or not at all; the change is audited.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeAccountLevel, createAccount, createCompany, listTeam, setAccountStatus } from "../app/lib/access/service.ts";
import { LocalAccessDirectory } from "../app/lib/access/local-directory.ts";
import { PLATFORM_TENANT_ID } from "../app/lib/access/types.ts";

const at = "2026-11-24T08:00:00.000Z";
function memoryRepository() {
  const rows = new Map();
  const key = (tenantId, recordId) => `${tenantId}|${recordId}`;
  return {
    rows,
    async get(tenantId, recordId) { return structuredClone(rows.get(key(tenantId, recordId)) ?? null); },
    async list(tenantId) { return [...rows.values()].filter((row) => row.tenantId === tenantId).map((row) => structuredClone(row)); },
    async put({ tenantId, recordId, payload, expectedVersion, now = at }) {
      const existing = rows.get(key(tenantId, recordId));
      if ((existing?.version ?? undefined) !== expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      const row = { schemaVersion: 1, tenantId, recordId, payload: structuredClone(payload), version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };
      rows.set(key(tenantId, recordId), row); return structuredClone(row);
    },
    async delete({ tenantId, recordId, expectedVersion }) {
      const existing = rows.get(key(tenantId, recordId));
      if (!existing || existing.version !== expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT");
      rows.delete(key(tenantId, recordId));
    },
  };
}
const principal = (userId, tenantId, role) => ({ userId, tenantId, role, sessionId: `session_${userId.slice(5)}`, issuedAt: at, expiresAt: "2026-11-24T16:00:00.000Z", source: "VERIFIED_SESSION" });

const logins = memoryRepository();
const directory = new LocalAccessDirectory(logins);
const stores = { companies: memoryRepository(), accounts: memoryRepository(), memberships: memoryRepository(), orgChain: memoryRepository(), directory };
const owner = principal("user_tony", PLATFORM_TENANT_ID, "ADMIN");
const { company, admin } = await createCompany(stores, owner, { name: "Sintetica Uno", admin: { displayName: "Admin Uno", email: "admin@uno.test", password: "Sintetica2026" } }, at);
const other = await createCompany(stores, owner, { name: "Sintetica Due", admin: { displayName: "Admin Due", email: "admin@due.test", password: "Sintetica2026" } }, at);
const tenantId = company.tenantId;
const boss = principal(admin.userId, tenantId, "ADMIN");
const make = (displayName, level, parentUserId) => createAccount(stores, boss, { displayName, email: `${displayName.toLowerCase().replace(/\s+/g, ".")}@uno.test`, level, password: "Sintetica2026", ...(parentUserId ? { parentUserId } : {}) }, at);
const director = await make("Dir Uno", "DIRETTORE");
const agentA = await make("Agente A", "AGENTE", director.userId);
const agentB = await make("Agente B", "AGENTE", director.userId);
const sub = await make("Sub Uno", "SUB_AGENTE", agentA.userId);

const team = async () => new Map((await listTeam(stores, boss)).map((item) => [item.userId, item]));
const membership = async (userId) => (await stores.memberships.get(tenantId, `membership_${userId.slice(5)}`)).payload;
const loginRole = async (userId) => (await logins.list(PLATFORM_TENANT_ID)).find((row) => row.payload.userId === userId).payload.memberships.find((item) => item.tenantId === tenantId).role;
const snapshot = async () => JSON.stringify([[...stores.accounts.rows.values()], [...stores.memberships.rows.values()], [...stores.orgChain.rows.values()], [...logins.rows.values()].map((row) => row.payload.memberships)]);

// 1. Assign the sub-agente to another agente: same role, new responsabile.
let now = await team();
const moved = await changeAccountLevel(stores, boss, { userId: sub.userId, level: "SUB_AGENTE", parentUserId: agentB.userId, expectedVersion: now.get(sub.userId).version }, at);
assert.equal(moved.account.level, "SUB_AGENTE");
assert.equal((await team()).get(sub.userId).parentUserId, agentB.userId);
console.log("ASSIGN_SUB_AGENT=PASS");

// 2. Promotion: role, permissions, login role, account and chain change together.
now = await team();
await changeAccountLevel(stores, boss, { userId: sub.userId, level: "AREA_MANAGER", parentUserId: director.userId, expectedVersion: now.get(sub.userId).version }, at);
now = await team();
assert.equal(now.get(sub.userId).level, "AREA_MANAGER");
assert.equal(now.get(sub.userId).chainLevel, "AREA_MANAGER");
assert.equal((await membership(sub.userId)).role, "SALES_MANAGER");
assert.equal(await loginRole(sub.userId), "ANALYST", "open sessions issued as VIEWER no longer match the membership role");
// Back down: sub-agente under agente A, permissions narrowed again.
await changeAccountLevel(stores, boss, { userId: sub.userId, level: "SUB_AGENTE", parentUserId: agentA.userId, expectedVersion: now.get(sub.userId).version }, at);
assert.equal((await membership(sub.userId)).role, "SALES_OPERATOR");
assert.equal(await loginRole(sub.userId), "VIEWER");
console.log("ROLE_CHANGE_CONSISTENT=PASS");

// 3. Refusals: nothing is written.
const before = await snapshot();
now = await team();
const version = (userId) => now.get(userId).version;
const refuse = async (who, body, code) => { await assert.rejects(() => changeAccountLevel(stores, who, body, at), new RegExp(code)); assert.equal(await snapshot(), before, `${code}: nothing written`); };
// Since "RIPRISTINO GESTIONE GERARCHICA" (24/11) a director manages agenti and sub-agenti of the branch, never higher levels.
await refuse(principal(director.userId, tenantId, "ANALYST"), { userId: agentA.userId, level: "AREA_MANAGER", expectedVersion: version(agentA.userId) }, "ACCESS_LEVEL_NOT_ALLOWED");
await refuse(principal(agentA.userId, tenantId, "VIEWER"), { userId: agentA.userId, level: "DIRETTORE", expectedVersion: version(agentA.userId) }, "ACCESS_SELF_EDIT_DENIED");
await refuse(principal(other.admin.userId, other.company.tenantId, "ADMIN"), { tenantId, userId: agentA.userId, level: "DIRETTORE", expectedVersion: version(agentA.userId) }, "ACCESS_DENIED");
await refuse(principal(other.admin.userId, other.company.tenantId, "ADMIN"), { userId: agentA.userId, level: "DIRETTORE", expectedVersion: version(agentA.userId) }, "ACCESS_USER_NOT_FOUND");
await refuse(boss, { userId: admin.userId, level: "DIRETTORE", expectedVersion: version(admin.userId) }, "ACCESS_SELF_EDIT_DENIED");
await refuse(boss, { userId: agentA.userId, level: "AMMINISTRATORE", expectedVersion: version(agentA.userId) }, "ACCESS_LEVEL_CHANGE_ADMIN");
await refuse(boss, { userId: agentA.userId, level: "DIRETTORE", parentUserId: sub.userId, expectedVersion: version(agentA.userId) }, "ACCESS_PARENT_LEVEL_INVALID");
await refuse(boss, { userId: director.userId, level: "AGENTE", expectedVersion: version(director.userId) }, "ACCESS_CHILDREN_LEVEL_CONFLICT");
await refuse(boss, { userId: agentA.userId, level: "AGENTE", parentUserId: sub.userId, expectedVersion: version(agentA.userId) }, "ACCESS_PARENT_LEVEL_INVALID");
await refuse(boss, { userId: agentA.userId, level: "AREA_MANAGER", expectedVersion: version(agentA.userId) + 1 }, "PERSISTENCE_VERSION_CONFLICT");
console.log("REFUSALS_WRITE_NOTHING=PASS");

// 4. A suspended person is reactivated before any role change.
const suspended = await setAccountStatus(stores, boss, { userId: agentB.userId, status: "SUSPENDED", expectedVersion: version(agentB.userId) }, at);
now = await team();
await assert.rejects(() => changeAccountLevel(stores, boss, { userId: agentB.userId, level: "AREA_MANAGER", expectedVersion: now.get(agentB.userId).version }, at), /ACCESS_USER_SUSPENDED/);
assert.equal(suspended.status, "SUSPENDED");
console.log("SUSPENDED_BLOCKED=PASS");

// 5. A failure after the first write restores chain and membership.
now = await team();
const beforeFailure = await snapshot();
const failing = { ...stores, directory: { ...directory, loginFor: directory.loginFor.bind(directory), setMembership: async () => { throw new Error("ACCESS_DIRECTORY_UNAVAILABLE"); } } };
await assert.rejects(() => changeAccountLevel(failing, boss, { userId: agentA.userId, level: "AREA_MANAGER", parentUserId: director.userId, expectedVersion: now.get(agentA.userId).version }, at), /ACCESS_DIRECTORY_UNAVAILABLE/);
const after = JSON.parse(await snapshot()); const was = JSON.parse(beforeFailure);
const payloads = (rows) => rows.map((row) => row.payload);
assert.deepEqual(payloads(after[0]), payloads(was[0]), "account unchanged");
assert.deepEqual(payloads(after[1]).map(({ updatedAt, ...rest }) => rest), payloads(was[1]).map(({ updatedAt, ...rest }) => rest), "membership restored");
assert.deepEqual(payloads(after[2]), payloads(was[2]), "chain restored");
console.log("ROLLBACK=PASS");

// 6. Route, audit and session: server-side authority, audited change, sessions checked against the membership role.
const route = readFileSync(new URL("../app/api/access/team/route.ts", import.meta.url), "utf8");
// Since "RIPRISTINO GESTIONE GERARCHICA" (24/11) the route lets every role in and teamAuthority decides (access-branch-management).
assert.match(route, /export async function PATCH[\s\S]*requireRequestAccess\(request, "OPERATE"\)[\s\S]*"level" in body \? accountLevelResponse/);
assert.match(readFileSync(new URL("../app/lib/access/service.ts", import.meta.url), "utf8"), /export async function changeAccountLevel[\s\S]{0,400}const authority = await teamAuthority\(stores, principal, body\.tenantId\);/);
assert.match(readFileSync(new URL("../app/lib/access/api.ts", import.meta.url), "utf8"), /action: "ACCOUNT_ROLE_CHANGED"[^\n]*from: result\.previousLevel, to: result\.account\.level/);
assert.match(readFileSync(new URL("../app/lib/production/supabase.ts", import.meta.url), "utf8"), /membership\.status !== "ACTIVE" \|\| membership\.role !== session\.role\) return null/);
console.log("ROUTE_AUDIT_SESSION=PASS");
console.log("access-role-change: ok");
