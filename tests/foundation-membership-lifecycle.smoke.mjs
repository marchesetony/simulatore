import assert from "node:assert/strict";
import { changeMembershipRole, createMembership, reactivateMembership, revokeMembership, suspendMembership } from "../app/lib/foundation/memberships.ts";
import { resolveTenantContext } from "../app/lib/foundation/tenants.ts";
import { canonicalTimestamp } from "../app/lib/foundation/types.ts";

const tenant = "tenant_membership-lifecycle";
const otherTenant = "tenant_other-membership";
const at = (value) => canonicalTimestamp(value);
const actor = resolveTenantContext(
  { userId: "user_admin", subject: "subject-admin", email: "admin@example.test", active: true },
  { id: "membership-admin", userId: "user_admin", tenantId: tenant, role: "TENANT_ADMIN", status: "ACTIVE", permissions: ["membership:manage", "membership:read", "tenant:read"] },
  tenant,
);

class MemoryMembershipRepository {
  records = new Map();
  async get(tenantId, membershipId) { return this.records.get(`${tenantId}:${membershipId}`) ?? null; }
  async list(tenantId) { return [...this.records.values()].filter((record) => record.tenantId === tenantId); }
  async append({ record }) { const key = `${record.tenantId}:${record.id}`; if (this.records.has(key)) throw new Error("MEMBERSHIP_ALREADY_EXISTS"); this.records.set(key, structuredClone(record)); return structuredClone(record); }
  async put({ record, expectedVersion }) { const key = `${record.tenantId}:${record.id}`; const current = this.records.get(key); if (!current || current.version !== expectedVersion) throw new Error("MEMBERSHIP_VERSION_CONFLICT"); this.records.set(key, structuredClone(record)); return structuredClone(record); }
}

const repository = new MemoryMembershipRepository();
const member = await createMembership(repository, { actor, identity: { userId: "user_member", subject: "subject-member", email: "member@example.test", active: true }, membershipId: "membership-member", tenantId: tenant, role: "SALES_OPERATOR", permissions: ["document:read"], now: at("2026-09-15T10:00:00.000Z") });
assert.equal(member.version, 1);
assert.deepEqual(await repository.list(tenant), [member]);

const changed = await changeMembershipRole(repository, { actor, tenantId: tenant, membershipId: member.id, expectedVersion: 1, role: "SALES_MANAGER", now: at("2026-09-15T10:01:00.000Z") });
assert.equal(changed.role, "SALES_MANAGER");
assert.deepEqual(changed.permissions, ["tenant:read", "membership:read", "customer:read", "customer:manage", "document:read", "document:manage"]);
assert.equal(changed.permissions[0], "tenant:read");
assert.equal(changed.version, 2);
await assert.rejects(() => changeMembershipRole(repository, { actor, tenantId: tenant, membershipId: member.id, expectedVersion: 1, role: "TENANT_ADMIN", now: at("2026-09-15T10:02:00.000Z") }), /MEMBERSHIP_VERSION_CONFLICT/);
await assert.rejects(() => changeMembershipRole(repository, { actor, tenantId: otherTenant, membershipId: member.id, expectedVersion: 2, role: "TENANT_ADMIN", now: at("2026-09-15T10:02:00.000Z") }), /AUTHORIZATION_DENIED:TENANT_MISMATCH/);

const suspended = await suspendMembership(repository, { actor, tenantId: tenant, membershipId: member.id, expectedVersion: 2, now: at("2026-09-15T10:03:00.000Z") });
assert.equal(suspended.status, "SUSPENDED");
const active = await reactivateMembership(repository, { actor, tenantId: tenant, membershipId: member.id, expectedVersion: 3, now: at("2026-09-15T10:04:00.000Z") });
assert.equal(active.status, "ACTIVE");
const revoked = await revokeMembership(repository, { actor, tenantId: tenant, membershipId: member.id, expectedVersion: 4, now: at("2026-09-15T10:05:00.000Z") });
assert.equal(revoked.status, "DEACTIVATED");
assert.equal(revoked.revokedAt, revoked.updatedAt);
await assert.rejects(() => reactivateMembership(repository, { actor, tenantId: tenant, membershipId: member.id, expectedVersion: 5, now: at("2026-09-15T10:06:00.000Z") }), /MEMBERSHIP_DEACTIVATED_IMMUTABLE/);

const viewer = resolveTenantContext(
  { userId: "user_viewer", subject: "subject-viewer", email: "viewer@example.test", active: true },
  { id: "membership-viewer", userId: "user_viewer", tenantId: tenant, role: "SALES_OPERATOR", status: "ACTIVE", permissions: ["tenant:read"] },
  tenant,
);
await assert.rejects(() => changeMembershipRole(repository, { actor: viewer, tenantId: tenant, membershipId: member.id, expectedVersion: 5, role: "TENANT_ADMIN", now: at("2026-09-15T10:07:00.000Z") }), /AUTHORIZATION_DENIED:PERMISSION_MISSING/);

console.log("FOUNDATION_MEMBERSHIP_LIFECYCLE_SMOKE=OK");
