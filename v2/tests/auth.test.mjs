import test from "node:test";
import assert from "node:assert/strict";
import { login, authorizedSession } from "../modules/auth/service.ts";
import { resolveAccess, authorize } from "../modules/auth/access.ts";
import { verifySession } from "../modules/auth/session.ts";
import { canonicalRole } from "../modules/auth/schema.ts";
import { AuthError } from "../core/errors/auth-error.ts";
import { fixture, assignment, credentials } from "./fixtures.mjs";

test("valid login persists only a hash and verifies the resulting session", async () => {
  const { deps, stored } = fixture();
  const result = await login(credentials, deps);
  assert.equal(result.kind, "AUTHENTICATED");
  assert.equal(stored.size, 1);
  assert.ok(!JSON.stringify([...stored.values()]).includes(result.token));
  assert.equal((await verifySession(result.token, deps.sessions, deps.access)).tenantId, "tenant_test");
});

for (const role of ["PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"]) {
  test(`${role}: canonical role with explicit scope and active assignment`, async () => {
    const { deps, rows } = fixture([assignment(role)]);
    const principal = await resolveAccess(deps.access, "provider-user");
    assert.equal(principal.role, role);
    assert.equal(principal.scope, role === "PLATFORM_OWNER" ? "PLATFORM" : "TENANT");
    assert.equal("tenantId" in principal, role !== "PLATFORM_OWNER");
    assert.equal((await login(credentials, deps)).kind, "AUTHENTICATED");
    rows[0].status = "SUSPENDED";
    assert.equal((await login(credentials, deps)).kind, "AUTHENTICATION_FAILED");
  });
}

for (const role of ["PRODUCT_OWNER", "ADMIN", "ANALYST", "VIEWER"]) {
  test(`${role}: rejected without conversion, including unmigrated V1 rows`, async () => {
    assert.throws(() => canonicalRole(role), { code: "LEGACY_ROLE_REQUIRES_REVIEW" });
    const { deps } = fixture([assignment(role)]);
    assert.equal((await login(credentials, deps)).kind, "ACCESS_CONFIGURATION_INVALID");
    deps.access.assignments = async () => [];
    deps.access.legacyRoles = async () => [role];
    assert.equal((await login(credentials, deps)).kind, "ACCESS_CONFIGURATION_INVALID");
  });
}

test("wrong credentials and unavailable provider are distinct; no session is created", async () => {
  const { deps, stored } = fixture();
  deps.provider.verify = async () => { throw new AuthError("INVALID_CREDENTIALS"); };
  assert.equal((await login(credentials, deps)).kind, "AUTHENTICATION_FAILED");
  deps.provider.verify = async () => { throw new Error("raw provider detail"); };
  assert.deepEqual(await login(credentials, deps), { kind: "AUTHENTICATION_UNAVAILABLE" });
  assert.equal(stored.size, 0);
});

test("unresolved tenant, inactive identity, incorrect membership identity deny access", async () => {
  for (const change of [
    f => { f.deps.access.tenantActive = async () => false; },
    f => { f.deps.access.identity = async () => null; },
    f => { f.rows[0].user_id = "someone_else"; },
    f => { f.rows[0].tenant_id = null; },
  ]) {
    const f = fixture(); change(f);
    assert.notEqual((await login(credentials, f.deps)).kind, "AUTHENTICATED");
    assert.equal(f.stored.size, 0);
  }
});

test("multiple assignments require selection without creating a session", async () => {
  const { deps, stored } = fixture([assignment(), { ...assignment(), id: "second" }]);
  assert.equal((await login(credentials, deps)).kind, "TENANT_SELECTION_REQUIRED");
  assert.equal(stored.size, 0);
});

test("session creation failure or missing readback cannot authenticate", async () => {
  for (const fail of [true, false]) {
    const { deps } = fixture();
    deps.sessions.insert = async () => { if (fail) throw new Error("database unavailable"); };
    assert.equal((await login(credentials, deps)).kind, "AUTHENTICATION_UNAVAILABLE");
  }
});

test("tenant mismatch and missing permission denied; platform targets validated", async () => {
  const { deps, rows } = fixture();
  const result = await login(credentials, deps);
  assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT", "tenant_other"), false);
  rows[0].permissions = [];
  assert.equal(await authorizedSession(result.token, deps, "auth:session"), false);
  assert.equal((await login(credentials, deps)).kind, "AUTHENTICATION_FAILED");
  rows[0] = assignment("PLATFORM_OWNER");
  const platform = await resolveAccess(deps.access, "provider-user");
  assert.equal(await authorize(platform, "auth:session", "TENANT", deps.access, "tenant_other"), false);
  assert.equal(await authorize(platform, "auth:session", "TENANT", deps.access, "tenant_test"), true);
});

test("client role, scope, tenant, membership and permissions cannot elevate access", async () => {
  for (const field of ["role", "scope", "tenantId", "membership", "permissions"]) {
    const { deps, stored } = fixture();
    assert.equal((await login({ ...credentials, [field]: "PLATFORM_OWNER" }, deps)).kind, "AUTHENTICATION_FAILED");
    assert.equal(stored.size, 0);
  }
});

test("expired, revoked, malformed, future and deactivated sessions fail closed", async () => {
  for (const change of [
    row => { row.expiresAt = new Date(0).toISOString(); },
    row => { row.revokedAt = new Date().toISOString(); },
    row => { row.issuedAt = "invalid"; },
    row => { row.issuedAt = new Date(Date.now() + 60000).toISOString(); },
    row => { row.userId = "other"; },
  ]) {
    const { deps, stored } = fixture(); const result = await login(credentials, deps);
    change([...stored.values()][0]);
    await assert.rejects(() => verifySession(result.token, deps.sessions, deps.access));
  }
  const { deps, rows } = fixture(); const result = await login(credentials, deps);
  rows[0].status = "DEACTIVATED";
  await assert.rejects(() => verifySession(result.token, deps.sessions, deps.access));
  await assert.rejects(() => verifySession("forged", deps.sessions, deps.access));
});

test("unknown roles, empty assignments, scope inconsistencies deny by default", async () => {
  for (const rows of [[], [assignment("UNKNOWN")], [{ ...assignment(), scope: "PLATFORM" }],
    [{ ...assignment("PLATFORM_OWNER"), tenant_id: "tenant_test" }]]) {
    assert.notEqual((await login(credentials, fixture(rows).deps)).kind, "AUTHENTICATED");
  }
});

for (const role of ["TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"]) {
  test(`${role}: explicit tenant target is checked and cannot replace the verified principal`, async () => {
    const { deps, rows } = fixture([assignment(role)]);
    const result = await login(credentials, deps);
    assert.equal(result.kind, "AUTHENTICATED");
    const before = await verifySession(result.token, deps.sessions, deps.access);
    assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT", "tenant_test"), true);
    assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT", "tenant_other"), false);
    assert.equal(await authorizedSession(result.token, deps, "auth:session", undefined, "tenant_other"), false);
    assert.equal(await authorizedSession(result.token, deps, "auth:session", undefined, "tenant_test"), false);
    assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT"), false);
    assert.equal(await authorizedSession(result.token, deps, "auth:session"), true);
    assert.deepEqual(await verifySession(result.token, deps.sessions, deps.access), before);
    rows[0].permissions = ["auth:login"];
    assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT", "tenant_test"), false);
  });
}

test("PLATFORM_OWNER tenant operations require explicit scope and a validated target", async () => {
  const { deps } = fixture([assignment("PLATFORM_OWNER")]);
  const result = await login(credentials, deps);
  assert.equal(result.kind, "AUTHENTICATED");
  assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT", "tenant_test"), true);
  assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT", "tenant_other"), false);
  assert.equal(await authorizedSession(result.token, deps, "auth:session", "TENANT"), false);
  assert.equal(await authorizedSession(result.token, deps, "auth:session", undefined, "tenant_test"), false);
  assert.equal(await authorizedSession(result.token, deps, "auth:session", "PLATFORM", "tenant_test"), false);
  assert.equal(await authorizedSession(result.token, deps, "auth:session", "PLATFORM"), true);
  const principal = await verifySession(result.token, deps.sessions, deps.access);
  assert.equal(principal.scope, "PLATFORM");
  assert.equal("tenantId" in principal, false);
});
