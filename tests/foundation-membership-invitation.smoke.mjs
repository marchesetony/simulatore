import assert from "node:assert/strict";
import { acceptInvitation, issueInvitation, revokeInvitation } from "../app/lib/foundation/invitations.ts";
import { resolveTenantContext } from "../app/lib/foundation/tenants.ts";
import { canonicalTimestamp } from "../app/lib/foundation/types.ts";

const issuedAt = canonicalTimestamp("2026-09-15T10:00:00.000Z");
const expiresAt = canonicalTimestamp("2026-10-15T10:00:00.000Z");
const now = canonicalTimestamp("2026-09-15T10:01:00.000Z");
const invitation = issueInvitation({ id: "invitation-foundation-test", tenantId: "tenant_foundation", recipientEmail: "member@example.test", role: "TENANT_ADMIN", tokenDigest: "digest-foundation-test", issuedAt, expiresAt });
const accepted = acceptInvitation(invitation, "member@example.test", "tenant_foundation", "digest-foundation-test", now);
assert.equal(accepted.status, "ACCEPTED");
assert.throws(() => acceptInvitation(accepted, "member@example.test", "tenant_foundation", "digest-foundation-test", now), /INVITATION_DENIED/);
assert.throws(() => acceptInvitation(invitation, "member@example.test", "tenant_other", "digest-foundation-test", now), /INVITATION_DENIED/);
assert.equal(revokeInvitation(invitation, now).status, "REVOKED");

const context = resolveTenantContext(
  { userId: "user_foundation", subject: "subject", email: "member@example.test", active: true },
  { id: "membership-foundation", userId: "user_foundation", tenantId: "tenant_foundation", role: "TENANT_ADMIN", status: "ACTIVE", permissions: ["tenant:read"] },
  "tenant_foundation",
);
assert.equal(context.isActive(), true);
assert.throws(() => resolveTenantContext(
  { userId: "user_foundation", subject: "subject", email: "member@example.test", active: true },
  { id: "membership-foundation", userId: "user_foundation", tenantId: "tenant_foundation", role: "TENANT_ADMIN", status: "ACTIVE", permissions: ["tenant:read"] },
  "tenant_other",
), /CROSS_TENANT_DENIED/);

console.log("FOUNDATION_MEMBERSHIP_INVITATION_SMOKE=OK");
