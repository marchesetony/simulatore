// Tony (24/11/2026, "RIPRISTINO GESTIONE GERARCHICA"): besides the administrator, every responsabile manages the people of
// their own branch, only at the levels below theirs: direttore and area manager → agenti and sub-agenti of the branch; agente
// → only their sub-agenti; sub-agente → nobody. Never oneself, superiors or other branches; other companies never.
// Every refusal writes nothing; every allowed operation is audited by the routes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeAccountLevel, createAccount, createCompany, listTeam, setAccountStatus, teamAuthority } from "../app/lib/access/service.ts";
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
const { company, admin } = await createCompany(stores, owner, { name: "Ramo Uno", admin: { displayName: "Admin Uno", email: "admin@uno.test", password: "Sintetica2026" } }, at);
const other = await createCompany(stores, owner, { name: "Ramo Due", admin: { displayName: "Admin Due", email: "admin@due.test", password: "Sintetica2026" } }, at);
const tenantId = company.tenantId;
const boss = principal(admin.userId, tenantId, "ADMIN");
let n = 0;
const create = (who, level, parentUserId, tenant) => createAccount(stores, who, { displayName: `Persona ${++n}`, email: `p${n}@uno.test`, level, password: "Sintetica2026", ...(parentUserId ? { parentUserId } : {}), ...(tenant ? { tenantId: tenant } : {}) }, at);
const dirA = await create(boss, "DIRETTORE");
const dirB = await create(boss, "DIRETTORE");
const areaA = await create(boss, "AREA_MANAGER", dirA.userId);
const agentA = await create(boss, "AGENTE", areaA.userId);
const agentB = await create(boss, "AGENTE", dirB.userId);
const subA = await create(boss, "SUB_AGENTE", agentA.userId);
const subB = await create(boss, "SUB_AGENTE", agentB.userId);
const otherDir = await createAccount(stores, principal(other.admin.userId, other.company.tenantId, "ADMIN"), { displayName: "Dir Due", email: "dir@due.test", level: "DIRETTORE", password: "Sintetica2026" }, at);
const as = (account) => principal(account.userId, tenantId, { DIRETTORE: "ANALYST", AREA_MANAGER: "ANALYST", AGENTE: "VIEWER", SUB_AGENTE: "VIEWER" }[account.level]);
const snapshot = async () => JSON.stringify([[...stores.accounts.rows.values()], [...stores.memberships.rows.values()], [...stores.orgChain.rows.values()], [...logins.rows.values()].map((row) => row.payload)]);
const versions = async () => new Map((await listTeam(stores, boss)).map((item) => [item.userId, item.version]));
const refuse = async (label, action, code) => { const before = await snapshot(); await assert.rejects(action, new RegExp(code), label); assert.equal(await snapshot(), before, `${label}: nothing written`); };

// 1. Roles: what each level may manage.
assert.deepEqual((await teamAuthority(stores, boss)).scope, "COMPANY");
assert.deepEqual((await teamAuthority(stores, as(dirA))).levels, ["AGENTE", "SUB_AGENTE"]);
assert.deepEqual((await teamAuthority(stores, as(areaA))).levels, ["AGENTE", "SUB_AGENTE"]);
assert.deepEqual((await teamAuthority(stores, as(agentA))).levels, ["SUB_AGENTE"]);
await assert.rejects(() => teamAuthority(stores, as(subA)), /ACCESS_DENIED/, "a sub-agente manages nobody");
await assert.rejects(() => teamAuthority(stores, { ...as(agentA), role: "ANALYST" }), /ACCESS_DENIED/, "an agente's session with a higher role is not trusted");
await assert.rejects(() => teamAuthority(stores, as(dirA), other.company.tenantId), /ACCESS_DENIED/, "another company");
console.log("ROLES=PASS");

// 2. Branch: each sees and manages only their branch; superiors, other branches and other companies stay out.
const seen = async (who) => (await listTeam(stores, who)).map((item) => item.userId).sort();
assert.deepEqual(await seen(as(dirA)), [dirA.userId, areaA.userId, agentA.userId, subA.userId].sort());
assert.deepEqual(await seen(as(agentA)), [agentA.userId, subA.userId].sort());
const dirView = new Map((await listTeam(stores, as(dirA))).map((item) => [item.userId, item.manageable]));
assert.deepEqual([dirView.get(dirA.userId), dirView.get(areaA.userId), dirView.get(agentA.userId), dirView.get(subA.userId)], [false, false, true, true], "never oneself, never an equal level");
await assert.rejects(() => listTeam(stores, as(subA)), /ACCESS_DENIED/);
let v = await versions();
await refuse("suspend another branch", () => setAccountStatus(stores, as(dirA), { userId: agentB.userId, status: "SUSPENDED", expectedVersion: v.get(agentB.userId) }, at), "ACCESS_SCOPE_DENIED");
await refuse("suspend a superior", () => setAccountStatus(stores, as(agentA), { userId: areaA.userId, status: "SUSPENDED", expectedVersion: v.get(areaA.userId) }, at), "ACCESS_SCOPE_DENIED");
await refuse("suspend oneself", () => setAccountStatus(stores, as(dirA), { userId: dirA.userId, status: "SUSPENDED", expectedVersion: v.get(dirA.userId) }, at), "ACCESS_SELF_EDIT_DENIED");
await refuse("suspend the administrator", () => setAccountStatus(stores, as(dirA), { userId: admin.userId, status: "SUSPENDED", expectedVersion: v.get(admin.userId) }, at), "ACCESS_SCOPE_DENIED");
await refuse("an agente on another agente's sub-agente", () => setAccountStatus(stores, as(agentA), { userId: subB.userId, status: "SUSPENDED", expectedVersion: v.get(subB.userId) }, at), "ACCESS_SCOPE_DENIED");
await refuse("another company's director", () => setAccountStatus(stores, as(dirA), { userId: otherDir.userId, status: "SUSPENDED", expectedVersion: 1, tenantId: other.company.tenantId }, at), "ACCESS_DENIED");
console.log("BRANCH=PASS");

// 3. Creation: only lower levels, only inside the branch, under the manager by default.
const newAgent = await create(as(dirA), "AGENTE");
assert.equal((await listTeam(stores, boss)).find((item) => item.userId === newAgent.userId).parentUserId, dirA.userId, "under the director by default");
const newSub = await create(as(agentA), "SUB_AGENTE");
assert.equal((await listTeam(stores, boss)).find((item) => item.userId === newSub.userId).parentUserId, agentA.userId, "under the agente by default");
const deepSub = await create(as(dirA), "SUB_AGENTE", agentA.userId);
assert.equal((await listTeam(stores, boss)).find((item) => item.userId === deepSub.userId).parentUserId, agentA.userId);
const loginCount = async () => (await logins.list(PLATFORM_TENANT_ID)).length;
for (const [label, who, level, parent, code] of [
  ["director creates a director", as(dirA), "DIRETTORE", undefined, "ACCESS_LEVEL_NOT_ALLOWED"],
  ["director creates an area manager", as(dirA), "AREA_MANAGER", undefined, "ACCESS_LEVEL_NOT_ALLOWED"],
  ["director creates an administrator", as(dirA), "AMMINISTRATORE", undefined, "ACCESS_LEVEL_NOT_ALLOWED"],
  ["agente creates an agente", as(agentA), "AGENTE", undefined, "ACCESS_LEVEL_NOT_ALLOWED"],
  ["director places under another branch", as(dirA), "AGENTE", dirB.userId, "ACCESS_SCOPE_DENIED"],
  ["agente places under another agente", as(agentA), "SUB_AGENTE", agentB.userId, "ACCESS_SCOPE_DENIED"],
  ["sub-agente creates", as(subA), "SUB_AGENTE", undefined, "ACCESS_DENIED"],
]) { const logins0 = await loginCount(); await refuse(label, () => create(who, level, parent), code); assert.equal(await loginCount(), logins0, `${label}: no login created`); }
console.log("CREATION=PASS");

// 4. Change of responsabile and role inside the branch only.
v = await versions();
await changeAccountLevel(stores, as(dirA), { userId: subA.userId, level: "SUB_AGENTE", parentUserId: newAgent.userId, expectedVersion: v.get(subA.userId) }, at);
assert.equal((await listTeam(stores, boss)).find((item) => item.userId === subA.userId).parentUserId, newAgent.userId, "sub-agente moved to another agente of the branch");
v = await versions();
await changeAccountLevel(stores, as(dirA), { userId: deepSub.userId, level: "AGENTE", parentUserId: dirA.userId, expectedVersion: v.get(deepSub.userId) }, at);
assert.equal((await listTeam(stores, boss)).find((item) => item.userId === deepSub.userId).level, "AGENTE", "sub-agente promoted to agente by the director");
v = await versions();
await refuse("promote to area manager", () => changeAccountLevel(stores, as(dirA), { userId: newAgent.userId, level: "AREA_MANAGER", parentUserId: dirA.userId, expectedVersion: v.get(newAgent.userId) }, at), "ACCESS_LEVEL_NOT_ALLOWED");
await refuse("move into another branch", () => changeAccountLevel(stores, as(dirA), { userId: newAgent.userId, level: "AGENTE", parentUserId: dirB.userId, expectedVersion: v.get(newAgent.userId) }, at), "ACCESS_SCOPE_DENIED");
await refuse("change an equal level", () => changeAccountLevel(stores, as(dirA), { userId: areaA.userId, level: "AGENTE", parentUserId: dirA.userId, expectedVersion: v.get(areaA.userId) }, at), "ACCESS_SCOPE_DENIED");
await refuse("agente promotes their sub-agente", () => changeAccountLevel(stores, as(agentA), { userId: newSub.userId, level: "AGENTE", parentUserId: agentA.userId, expectedVersion: v.get(newSub.userId) }, at), "ACCESS_LEVEL_NOT_ALLOWED");
await refuse("agente changes oneself", () => changeAccountLevel(stores, as(agentA), { userId: agentA.userId, level: "SUB_AGENTE", expectedVersion: v.get(agentA.userId) }, at), "ACCESS_SELF_EDIT_DENIED");
await refuse("agente takes another agente's sub-agente", () => changeAccountLevel(stores, as(agentA), { userId: subB.userId, level: "SUB_AGENTE", parentUserId: agentA.userId, expectedVersion: v.get(subB.userId) }, at), "ACCESS_SCOPE_DENIED");
console.log("RESPONSABILE=PASS");

// 5. Suspension inside the branch, and a suspended manager manages nobody.
v = await versions();
assert.equal((await setAccountStatus(stores, as(agentA), { userId: newSub.userId, status: "SUSPENDED", expectedVersion: v.get(newSub.userId) }, at)).status, "SUSPENDED");
v = await versions();
assert.equal((await setAccountStatus(stores, as(dirA), { userId: newSub.userId, status: "ACTIVE", expectedVersion: v.get(newSub.userId) }, at)).status, "ACTIVE");
v = await versions();
await setAccountStatus(stores, boss, { userId: agentA.userId, status: "SUSPENDED", expectedVersion: v.get(agentA.userId) }, at);
await assert.rejects(() => teamAuthority(stores, as(agentA)), /ACCESS_DENIED/, "suspended manager");
console.log("SUSPENSION=PASS");

// 6. Routes, audit and screens follow the server.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const route = read("app/api/access/team/route.ts");
assert.equal((route.match(/requireRequestAccess\(request, "OPERATE"\)/g) ?? []).length, 3);
const service = read("app/lib/access/service.ts");
for (const fn of ["createAccount", "listTeam", "setAccountStatus", "changeAccountLevel"]) assert.match(service, new RegExp(`export async function ${fn}[\\s\\S]{0,400}const authority = await teamAuthority\\(stores, principal`), `${fn} goes through teamAuthority`);
const api = read("app/lib/access/api.ts");
for (const action of ["ACCOUNT_CREATED", "ACCOUNT_SUSPENDED", "ACCOUNT_ROLE_CHANGED"]) assert.match(api, new RegExp(`${action}[^\\n]*byRole: principal\\.role`), `${action} audited`);
const shell = read("app/components/OperationalShell.tsx");
assert.match(shell, /id === "access" && branchManager/);
assert.match(shell, /result\.teamScope === "BRANCH" && Boolean\(result\.manageableLevels\?\.length\)/);
const panel = read("app/components/AccessPanel.tsx");
assert.match(panel, /account\.manageable !== false/, "no commands on people the server does not let manage");
assert.match(panel, /levels=\{authority\.levels\}/, "only the levels the server allows");
console.log("ROUTES_AUDIT_SCREENS=PASS");
console.log("access-branch-management: ok");
