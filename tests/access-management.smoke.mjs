import assert from "node:assert/strict";

import { canManageTeam, changeOwnPassword, companyTenantId, createAccount, createCompany, isPlatformOwner, listCompanies, listTeam, setAccountStatus } from "../app/lib/access/service.ts";
import { LocalAccessDirectory } from "../app/lib/access/local-directory.ts";
import { PLATFORM_TENANT_ID } from "../app/lib/access/types.ts";
import { validateMembershipRecord } from "../app/lib/foundation/memberships.ts";

const at = "2026-10-18T08:00:00.000Z";

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
function principal(userId, tenantId, role) { return { userId, tenantId, role, sessionId: `session_${userId.slice(5)}`, issuedAt: at, expiresAt: "2026-10-18T16:00:00.000Z", source: "VERIFIED_SESSION" }; }

const directory = new LocalAccessDirectory(memoryRepository());
const stores = { companies: memoryRepository(), accounts: memoryRepository(), memberships: memoryRepository(), directory };
const owner = principal("user_tony", PLATFORM_TENANT_ID, "ADMIN");

assert.equal(isPlatformOwner(owner), true);
assert.equal(canManageTeam(owner), false);
assert.equal(companyTenantId("Lumenica Energia S.r.l."), "tenant_lumenica-energia-s-r-l");
assert.equal(companyTenantId("Città Gas & Luce"), "tenant_citta-gas-luce");
assert.throws(() => companyTenantId("Piattaforma"), /ACCESS_COMPANY_NAME_INVALID/);

// 1. The platform owner creates a company together with its administrator.
const lumenica = await createCompany(stores, owner, { name: "Lumenica Energia Demo", admin: { displayName: "Giulia Rossi", email: "Giulia@Lumenica.test", password: "Provvisoria2026" } }, at);
assert.equal(lumenica.company.tenantId, "tenant_lumenica-energia-demo");
assert.equal(lumenica.admin.email, "giulia@lumenica.test");
assert.equal(lumenica.admin.level, "AMMINISTRATORE");
const adminMembership = (await stores.memberships.list(lumenica.company.tenantId))[0];
assert.equal(adminMembership.payload.role, "TENANT_ADMIN");
validateMembershipRecord({ ...adminMembership.payload, version: adminMembership.version });
await assert.rejects(() => createCompany(stores, owner, { name: "Lumenica Energia Demo", admin: { displayName: "Altro", email: "altro@lumenica.test", password: "Provvisoria2026" } }), /ACCESS_COMPANY_EXISTS/);
await assert.rejects(() => createCompany(stores, owner, { name: "Weak", admin: { displayName: "Debole", email: "debole@weak.test", password: "corta1" } }), /ACCESS_PASSWORD_WEAK/);
await assert.rejects(() => createCompany(stores, owner, { name: "Doppia", admin: { displayName: "Doppia", email: "giulia@lumenica.test", password: "Provvisoria2026" } }), /ACCESS_EMAIL_TAKEN/);
assert.equal((await stores.companies.list(PLATFORM_TENANT_ID)).length, 1, "failed provisioning leaves no company behind");

// 2. Company administrators build their own team; nobody else can.
const giulia = principal(lumenica.admin.userId, lumenica.company.tenantId, "ADMIN");
assert.equal(canManageTeam(giulia), true);
const direttore = await createAccount(stores, giulia, { displayName: "Marco Bianchi", email: "marco@lumenica.test", level: "DIRETTORE", password: "Direttore2026" }, at);
const agente = await createAccount(stores, giulia, { displayName: "Sara Verdi", email: "sara@lumenica.test", level: "AGENTE", password: "AgenteSara26" }, at);
assert.equal((await stores.memberships.get(lumenica.company.tenantId, `membership_${agente.userId.slice(5)}`)).payload.role, "SALES_OPERATOR");
await assert.rejects(() => createAccount(stores, giulia, { tenantId: "tenant_altra", displayName: "Fuori", email: "fuori@x.test", level: "AGENTE", password: "Fuori2026xx" }), /ACCESS_DENIED/);
await assert.rejects(() => createAccount(stores, principal(direttore.userId, lumenica.company.tenantId, "ANALYST"), { displayName: "No", email: "no@x.test", level: "AGENTE", password: "Nonpuoi2026" }), /ACCESS_DENIED/);
await assert.rejects(() => listTeam(stores, principal(agente.userId, lumenica.company.tenantId, "VIEWER")), /ACCESS_DENIED/);
await assert.rejects(() => createCompany(stores, giulia, { name: "Abusiva", admin: { displayName: "X", email: "x@x.test", password: "Abusiva2026" } }), /ACCESS_DENIED/);
assert.deepEqual((await listTeam(stores, giulia)).map((item) => item.displayName), ["Giulia Rossi", "Marco Bianchi", "Sara Verdi"]);

// 3. The platform owner sees every company and can also add people to one.
await createAccount(stores, owner, { tenantId: lumenica.company.tenantId, displayName: "Secondo Admin", email: "admin2@lumenica.test", level: "AMMINISTRATORE", password: "Secondo2026x" }, at);
await assert.rejects(() => createAccount(stores, owner, { tenantId: "tenant_inesistente", displayName: "X", email: "y@x.test", level: "AGENTE", password: "Inesiste2026" }), /ACCESS_COMPANY_NOT_FOUND/);
assert.equal((await listCompanies(stores, owner))[0].accounts.length, 4);

// 4. Suspension reaches the login directory and the membership the chain reads.
const saraRecord = (await listTeam(stores, giulia)).find((item) => item.userId === agente.userId);
await assert.rejects(() => setAccountStatus(stores, giulia, { userId: giulia.userId, status: "SUSPENDED", expectedVersion: 1 }), /ACCESS_SELF_EDIT_DENIED/);
await assert.rejects(() => setAccountStatus(stores, giulia, { userId: agente.userId, status: "SUSPENDED", expectedVersion: saraRecord.version + 1 }), /PERSISTENCE_VERSION_CONFLICT/);
const suspended = await setAccountStatus(stores, giulia, { userId: agente.userId, status: "SUSPENDED", expectedVersion: saraRecord.version }, at);
assert.equal(suspended.status, "SUSPENDED");
assert.equal((await stores.memberships.get(lumenica.company.tenantId, `membership_${agente.userId.slice(5)}`)).payload.status, "SUSPENDED");

// 5. Everyone changes their own password, proving the current one.
const sara = principal(agente.userId, lumenica.company.tenantId, "VIEWER");
await assert.rejects(() => changeOwnPassword(stores, sara, { currentPassword: "sbagliata", newPassword: "NuovaSara2026" }), /ACCESS_PASSWORD_INCORRECT/);
await assert.rejects(() => changeOwnPassword(stores, sara, { currentPassword: "AgenteSara26", newPassword: "AgenteSara26" }), /ACCESS_PASSWORD_UNCHANGED/);
await changeOwnPassword(stores, sara, { currentPassword: "AgenteSara26", newPassword: "NuovaSara2026" });
assert.equal(await directory.verifyPassword("sara@lumenica.test", "AgenteSara26"), null);
assert.ok(await directory.verifyPassword("sara@lumenica.test", "NuovaSara2026"));

console.log("access management smoke passed");
