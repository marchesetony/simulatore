import assert from "node:assert/strict";

const originalEnv = { ...process.env };
const tenantId = `tenant_auth-role-${Date.now()}`;
const adminUserId = `user_auth-role-admin-${Date.now()}`;
const recipientUserId = `user_auth-role-recipient-${Date.now()}`;
Object.assign(process.env, {
  APP_RUNTIME_MODE: "local",
  FOUNDATION_LOCAL_DEV: "true",
  AUTH_ADAPTER: "local",
  PERSISTENCE_ADAPTER: "filesystem",
  FOUNDATION_LOCAL_TENANT_ID: tenantId,
  FOUNDATION_LOCAL_USER_ID: adminUserId,
  FOUNDATION_LOCAL_ROLE: "ADMIN",
});

try {
  const { readRuntimeConfig } = await import("../app/lib/auth/config.ts");
  const roles = await import("../app/lib/auth/roles.ts");
  const { permissionsForMembershipRole, changeMembershipRole, createMembership } = await import("../app/lib/foundation/memberships.ts");
  const { resolveTenantContext } = await import("../app/lib/foundation/tenants.ts");
  const { runtimeRepositories } = await import("../app/lib/persistence/adapter.ts");

  assert.deepEqual(roles.CANONICAL_PRODUCT_ROLES, ["SUPER_ADMIN", "ADMIN", "AGENT"]);
  assert.equal(roles.legacyAuthRoleToCanonical("ADMIN"), "SUPER_ADMIN");
  assert.equal(roles.legacyAuthRoleToCanonical("ANALYST"), "ADMIN");
  assert.equal(roles.legacyAuthRoleToCanonical("VIEWER"), "AGENT");
  assert.equal(roles.foundationRoleToCanonical("PRODUCT_OWNER"), "SUPER_ADMIN");
  assert.equal(roles.foundationRoleToCanonical("PLATFORM_OWNER"), "SUPER_ADMIN");
  assert.equal(roles.foundationRoleToCanonical("TENANT_ADMIN"), "SUPER_ADMIN");
  assert.equal(roles.foundationRoleToCanonical("SALES_MANAGER"), "ADMIN");
  assert.equal(roles.foundationRoleToCanonical("SALES_OPERATOR"), "AGENT");
  assert.equal(readRuntimeConfig({ FOUNDATION_LOCAL_DEV: "true" }).valid, false);
  assert.equal(readRuntimeConfig({ APP_RUNTIME_MODE: "production", FOUNDATION_LOCAL_DEV: "true", AUTH_ADAPTER: "server-session", PERSISTENCE_ADAPTER: "provider" }).valid, false);

  class MemoryMembershipRepository {
    records = new Map();
    async get(_tenant, id) { return this.records.get(id) ?? null; }
    async list() { return [...this.records.values()]; }
    async append({ record }) { if (this.records.has(record.id)) throw new Error("MEMBERSHIP_ALREADY_EXISTS"); this.records.set(record.id, structuredClone(record)); return structuredClone(record); }
    async put({ record, expectedVersion }) { const current = this.records.get(record.id); if (!current || current.version !== expectedVersion) throw new Error("MEMBERSHIP_VERSION_CONFLICT"); this.records.set(record.id, structuredClone(record)); return structuredClone(record); }
  }
  const repository = new MemoryMembershipRepository();
  const now = "2026-09-21T10:00:00.000Z";
  const adminIdentity = { userId: "user_foundation-admin", subject: "session_test", email: "admin@example.invalid", active: true };
  const adminMembership = { id: "membership_foundation-admin", userId: adminIdentity.userId, tenantId, role: "SALES_MANAGER", status: "ACTIVE", permissions: ["membership:manage"], };
  const adminContext = resolveTenantContext(adminIdentity, adminMembership, tenantId);
  await assert.rejects(() => createMembership(repository, { actor: adminContext, identity: { userId: "user_target-super", subject: "target", email: "target@example.invalid", active: true }, membershipId: "membership_target-super", tenantId, role: "PLATFORM_OWNER", permissions: permissionsForMembershipRole("PLATFORM_OWNER"), now }), /ROLE_ESCALATION_DENIED/);
  await assert.rejects(() => createMembership(repository, { actor: adminContext, identity: adminIdentity, membershipId: "membership_self-super", tenantId, role: "PLATFORM_OWNER", permissions: permissionsForMembershipRole("PLATFORM_OWNER"), now }), /ROLE_ESCALATION_DENIED/);
  const agentIdentity = { userId: "user_foundation-agent", subject: "session_agent", email: "agent@example.invalid", active: true };
  const agentContext = resolveTenantContext(agentIdentity, { id: "membership_foundation-agent", userId: agentIdentity.userId, tenantId, role: "SALES_OPERATOR", status: "ACTIVE", permissions: ["membership:manage"] }, tenantId);
  await assert.rejects(() => createMembership(repository, { actor: agentContext, identity: { userId: "user_target-admin", subject: "target", email: "target@example.invalid", active: true }, membershipId: "membership_target-admin", tenantId, role: "SALES_MANAGER", permissions: permissionsForMembershipRole("SALES_MANAGER"), now }), /ROLE_ESCALATION_DENIED/);
  await assert.rejects(() => createMembership(repository, { actor: adminContext, identity: { userId: "user_cross-tenant", subject: "target", email: "target@example.invalid", active: true }, membershipId: "membership_cross-tenant", tenantId: "tenant_other", role: "SALES_OPERATOR", permissions: permissionsForMembershipRole("SALES_OPERATOR"), now }), /(?:CROSS_TENANT_DENIED|AUTHORIZATION_DENIED:TENANT_MISMATCH)/);
  repository.records.set("membership_self-demotion", { id: "membership_self-demotion", userId: adminIdentity.userId, tenantId, role: "PLATFORM_OWNER", status: "ACTIVE", permissions: permissionsForMembershipRole("PLATFORM_OWNER"), version: 1, createdAt: now, updatedAt: now });
  const superAdminContext = resolveTenantContext({ ...adminIdentity, userId: adminIdentity.userId }, { id: "membership_runtime-admin", userId: adminIdentity.userId, tenantId, role: "PLATFORM_OWNER", status: "ACTIVE", permissions: permissionsForMembershipRole("PLATFORM_OWNER") }, tenantId);
  await assert.rejects(() => changeMembershipRole(repository, { actor: superAdminContext, tenantId, membershipId: "membership_self-demotion", expectedVersion: 1, role: "SALES_MANAGER", now }), /SELF_DEMOTION_LOCKOUT_DENIED/);

  const { POST: createInvitation } = await import("../app/api/foundation/invitations/route.ts");
  const { POST: acceptInvitation } = await import("../app/api/foundation/invitations/[id]/accept/route.ts");
  const { POST: revokeInvitation } = await import("../app/api/foundation/invitations/[id]/revoke/route.ts");
  const { GET: listMemberships } = await import("../app/api/foundation/memberships/route.ts");
  const { PATCH: changeRole } = await import("../app/api/foundation/memberships/[id]/role/route.ts");
  const { POST: revokeMembership } = await import("../app/api/foundation/memberships/[id]/revoke/route.ts");

  const request = (method, body) => new Request("http://localhost", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const invitationResponse = await createInvitation(request("POST", { recipientUserId, recipientEmail: "recipient@example.invalid", role: "SALES_OPERATOR" }), {});
  assert.equal(invitationResponse.status, 201);
  const invitationPayload = await invitationResponse.json();
  assert.equal(typeof invitationPayload.token, "string");
  const invitationId = invitationPayload.invitation.id;

  process.env.FOUNDATION_LOCAL_USER_ID = recipientUserId;
  process.env.FOUNDATION_LOCAL_ROLE = "VIEWER";
  const acceptedResponse = await acceptInvitation(request("POST", { token: invitationPayload.token }), { params: Promise.resolve({ id: invitationId }) });
  assert.equal(acceptedResponse.status, 200);
  const acceptedPayload = await acceptedResponse.json();
  const membershipId = acceptedPayload.membership.id;

  process.env.FOUNDATION_LOCAL_USER_ID = adminUserId;
  process.env.FOUNDATION_LOCAL_ROLE = "ADMIN";
  assert.equal((await listMemberships(request("GET"))).status, 200);
  const changedResponse = await changeRole(request("PATCH", { role: "SALES_MANAGER", expectedVersion: 1 }), { params: Promise.resolve({ id: membershipId }) });
  assert.equal(changedResponse.status, 200);
  const changedPayload = await changedResponse.json();
  assert.equal(changedPayload.membership.role, "SALES_MANAGER");
  const revokedMembershipResponse = await revokeMembership(request("POST", { expectedVersion: changedPayload.membership.version }), { params: Promise.resolve({ id: membershipId }) });
  assert.equal(revokedMembershipResponse.status, 200);

  const secondInvitationResponse = await createInvitation(request("POST", { recipientUserId: `user_auth-role-revoke-${Date.now()}`, recipientEmail: "revoke@example.invalid", role: "SALES_OPERATOR" }), {});
  assert.equal(secondInvitationResponse.status, 201);
  const secondInvitation = await secondInvitationResponse.json();
  const revokedInvitationResponse = await revokeInvitation(request("POST"), { params: Promise.resolve({ id: secondInvitation.invitation.id }) });
  assert.equal(revokedInvitationResponse.status, 200);

  const auditRecords = await runtimeRepositories().auditEvents.list(tenantId);
  const auditActions = new Set(auditRecords.map((record) => record.payload.action));
  for (const action of ["INVITATION_CREATED", "INVITATION_ACCEPTED", "MEMBERSHIP_CREATED", "MEMBERSHIP_ROLE_CHANGED", "MEMBERSHIP_REVOKED", "INVITATION_REVOKED"]) assert.equal(auditActions.has(action), true, action);
  assert.equal(auditRecords.some((record) => JSON.stringify(record.payload).includes(invitationPayload.token)), false);

  console.log("AUTH_ROLE_SECURITY_RUNTIME=PASS");
  console.log("ROLE_ESCALATION_TESTS=PASS");
  console.log("TENANT_ISOLATION_TESTS=PASS");
  console.log("INVITATION_ENDPOINT_RUNTIME_TESTS=PASS");
  console.log("MEMBERSHIP_ENDPOINT_RUNTIME_TESTS=PASS");
  console.log("AUDIT_EVENTS_TESTED=PASS");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
}
