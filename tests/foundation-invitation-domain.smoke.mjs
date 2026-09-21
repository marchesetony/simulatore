import assert from "node:assert/strict";
import { acceptInvitation, expireInvitation, invitationStatus, issueInvitation, revokeInvitation } from "../app/lib/foundation/invitations.ts";
import { canonicalTimestamp } from "../app/lib/foundation/types.ts";

const issuedAt = canonicalTimestamp("2026-09-15T10:00:00.000Z");
const beforeIssued = canonicalTimestamp("2026-09-15T09:59:59.999Z");
const activeNow = canonicalTimestamp("2026-09-15T10:01:00.000Z");
const expiredNow = canonicalTimestamp("2026-10-15T10:00:00.000Z");
const expiresAt = canonicalTimestamp("2026-10-15T10:00:00.000Z");

const invitation = issueInvitation({
  id: "invitation-domain-test",
  tenantId: "tenant_foundation",
  recipientEmail: " Member@Example.Test ",
  role: "TENANT_ADMIN",
  tokenDigest: "digest-domain-test",
  issuedAt,
  expiresAt,
});
assert.equal(invitation.recipientEmail, "member@example.test");
assert.equal(invitation.status, "PENDING");
assert.equal(invitationStatus(invitation, activeNow), "PENDING");

const accepted = acceptInvitation(invitation, "MEMBER@example.test", "tenant_foundation", "digest-domain-test", activeNow);
assert.equal(accepted.status, "ACCEPTED");
assert.equal(accepted.acceptedAt, activeNow);
assert.throws(() => acceptInvitation(accepted, "member@example.test", "tenant_foundation", "digest-domain-test", activeNow), /INVITATION_DENIED/);

const expired = expireInvitation(invitation, expiredNow);
assert.equal(expired.status, "EXPIRED");
assert.throws(() => acceptInvitation(expired, "member@example.test", "tenant_foundation", "digest-domain-test", expiredNow), /INVITATION_DENIED/);
assert.throws(() => revokeInvitation(expired, expiredNow), /INVITATION_ALREADY_EXPIRED/);

const revoked = revokeInvitation(invitation, activeNow);
assert.equal(revoked.status, "REVOKED");
assert.equal(revoked.revokedAt, activeNow);
assert.throws(() => revokeInvitation(revoked, activeNow), /INVITATION_ALREADY_REVOKED/);

assert.throws(() => acceptInvitation(invitation, "member@example.test", "tenant_other", "digest-domain-test", activeNow), /INVITATION_DENIED/);
assert.throws(() => issueInvitation({ ...invitation, role: "INVALID" }), /INVITATION_INVALID/);
assert.throws(() => acceptInvitation({ ...invitation, status: "ACCEPTED" }, "member@example.test", "tenant_foundation", "digest-domain-test", activeNow), /INVITATION_DENIED/);
assert.throws(() => acceptInvitation(invitation, "member@example.test", "tenant_foundation", "digest-domain-test", beforeIssued), /INVITATION_DENIED/);

console.log("FOUNDATION_INVITATION_DOMAIN_SMOKE=OK");
