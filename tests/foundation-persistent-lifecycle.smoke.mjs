import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { issueInvitation, acceptInvitation, revokeInvitation } from "../app/lib/foundation/invitations.ts";
import { changeMembershipRole, revokeMembership } from "../app/lib/foundation/memberships.ts";
import { canonicalTimestamp } from "../app/lib/foundation/types.ts";
import { resolveTenantContext } from "../app/lib/foundation/tenants.ts";
import { invitationFromStored, invitationPayload, membershipFromStored, membershipRepository, permissionsForFoundationRole } from "../app/lib/foundation/lifecycle.ts";

const tenant = "tenant_roundtrip";
const otherTenant = "tenant_other";
const user = "user_invited";
const actorId = "user_admin";
const at = (value) => canonicalTimestamp(value);
const permissions = permissionsForFoundationRole("PLATFORM_OWNER");
const actor = { userId: actorId, subject: "subject-admin", email: "admin@example.test", active: true };
const actorMembership = { id: "membership-admin", userId: actorId, tenantId: tenant, role: "PLATFORM_OWNER", status: "ACTIVE", permissions };
const context = resolveTenantContext(actor, actorMembership, tenant);

const root = await mkdtemp(path.join(tmpdir(), "foundation-persistent-lifecycle-"));
try {
  const adapter = new LocalFilesystemAdapter(root);
  const foundationInvitations = adapter.collection("foundation-invitations");
  const foundationMemberships = adapter.collection("foundation-memberships");
  const repositories = { foundationInvitations, foundationMemberships };
  const issuedAt = at("2026-09-15T10:00:00.000Z");
  const expiresAt = at("2026-09-22T10:00:00.000Z");
  const invitation = issueInvitation({ id: "invitation-roundtrip", tenantId: tenant, recipientEmail: "member@example.test", role: "TENANT_ADMIN", tokenDigest: "digest-roundtrip", issuedAt, expiresAt });
  const pending = await foundationInvitations.append({ tenantId: tenant, recordId: invitation.id, payload: invitationPayload(invitation, user, actorId), now: issuedAt });
  assert.equal(invitationFromStored(pending, at("2026-09-15T10:01:00.000Z")).status, "PENDING");
  assert.equal((await foundationInvitations.get(otherTenant, invitation.id)), null);
  console.log("INVITATION_READBACK_PENDING=PASS");

  const accepted = acceptInvitation(invitationFromStored(pending, at("2026-09-15T10:02:00.000Z")), "member@example.test", tenant, "digest-roundtrip", at("2026-09-15T10:02:00.000Z"));
  const membershipId = "membership-invitation-roundtrip";
  const membership = await foundationMemberships.append({ tenantId: tenant, recordId: membershipId, payload: { id: membershipId, userId: user, tenantId: tenant, role: accepted.role, status: "ACTIVE", permissions: permissionsForFoundationRole(accepted.role), createdAt: accepted.acceptedAt, updatedAt: accepted.acceptedAt }, now: accepted.acceptedAt });
  const acceptedStored = await foundationInvitations.put({ tenantId: tenant, recordId: invitation.id, payload: invitationPayload(accepted, user, actorId), expectedVersion: pending.version, now: accepted.acceptedAt });
  assert.equal(invitationFromStored(acceptedStored, accepted.acceptedAt).status, "ACCEPTED");
  assert.equal(membershipFromStored(membership).userId, user);
  console.log("INVITATION_ACCEPT_MEMBERSHIP_CREATED=PASS");
  assert.throws(() => acceptInvitation(invitationFromStored(acceptedStored, at("2026-09-15T10:03:00.000Z")), "member@example.test", tenant, "digest-roundtrip", at("2026-09-15T10:03:00.000Z")), /INVITATION_DENIED/);
  console.log("REPEAT_ACCEPT_CONFLICT=PASS");

  const revokedBase = issueInvitation({ id: "invitation-revoked", tenantId: tenant, recipientEmail: "member@example.test", role: "SALES_OPERATOR", tokenDigest: "digest-revoked", issuedAt, expiresAt });
  const revokedPending = await foundationInvitations.append({ tenantId: tenant, recordId: revokedBase.id, payload: invitationPayload(revokedBase, user, actorId), now: issuedAt });
  const revoked = revokeInvitation(invitationFromStored(revokedPending, at("2026-09-15T10:04:00.000Z")), at("2026-09-15T10:04:00.000Z"));
  const revokedStored = await foundationInvitations.put({ tenantId: tenant, recordId: revokedBase.id, payload: invitationPayload(revoked, user, actorId), expectedVersion: revokedPending.version, now: revoked.revokedAt });
  assert.throws(() => acceptInvitation(invitationFromStored(revokedStored, at("2026-09-15T10:05:00.000Z")), "member@example.test", tenant, "digest-revoked", at("2026-09-15T10:05:00.000Z")), /INVITATION_DENIED/);
  console.log("REVOKED_INVITE_ACCEPTANCE_DENIED=PASS");

  const repo = membershipRepository(repositories);
  const changed = await changeMembershipRole(repo, { actor: context, tenantId: tenant, membershipId: membershipId, expectedVersion: membership.version, role: "SALES_MANAGER", now: at("2026-09-15T10:06:00.000Z") });
  assert.equal(changed.role, "SALES_MANAGER");
  assert.equal((await foundationMemberships.get(tenant, membershipId)).payload.role, "SALES_MANAGER");
  console.log("ROLE_CHANGE_READBACK=PASS");
  await assert.rejects(() => changeMembershipRole(repo, { actor: context, tenantId: otherTenant, membershipId, expectedVersion: changed.version, role: "PRODUCT_OWNER", now: at("2026-09-15T10:07:00.000Z") }), /AUTHORIZATION_DENIED:TENANT_MISMATCH/);
  console.log("CROSS_TENANT_ROLE_MUTATION_DENIED=PASS");
  await assert.rejects(() => foundationMemberships.append({ tenantId: tenant, recordId: membershipId, payload: membership.payload, now: at("2026-09-15T10:08:00.000Z") }), /PERSISTENCE_APPEND_ONLY_CONFLICT/);
  console.log("DUPLICATE_MEMBERSHIP_DENIED=PASS");
  const revokedMembership = await revokeMembership(repo, { actor: context, tenantId: tenant, membershipId, expectedVersion: changed.version, now: at("2026-09-15T10:09:00.000Z") });
  assert.equal(revokedMembership.status, "DEACTIVATED");
  assert.equal((await foundationMemberships.get(tenant, membershipId)).payload.status, "DEACTIVATED");
  console.log("MEMBERSHIP_REVOKE_READBACK=PASS");
  console.log("FOUNDATION_PERSISTENT_LIFECYCLE_SMOKE=OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
