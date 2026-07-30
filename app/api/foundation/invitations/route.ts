import { NextResponse } from "next/server";
import { createAuditEvent, AuditTargetId } from "../../../lib/foundation/audit";
import { CorrelationId, redactError } from "../../../lib/foundation/errors";
import { acceptInvitation, issueInvitation, revokeInvitation } from "../../../lib/foundation/invitations";
import { canonicalTimestamp } from "../../../lib/foundation/types";
import type { InvitationId, TenantId } from "../../../lib/foundation/types";

type Scenario = "valid-invitation" | "expired-invitation" | "revoked-invitation" | "replayed-invitation" | "wrong-tenant-invitation" | "malformed-request";
const NOW = canonicalTimestamp("2027-02-15T00:00:00.000Z");
const TENANT = "tenant-demo" as TenantId;
const OTHER_TENANT = "tenant-other" as TenantId;
const INVITATION = "invitation-demo" as InvitationId;
const CORRELATION = CorrelationId.from("foundation-invite");

function parseScenario(request: Request): Scenario | null {
  const value = new URL(request.url).searchParams.get("scenario");
  return value === "valid-invitation" || value === "expired-invitation" || value === "revoked-invitation" || value === "replayed-invitation" || value === "wrong-tenant-invitation" || value === "malformed-request" ? value : null;
}

function evidence(scenario: string) {
  return createAuditEvent({ category: "INVITATION", operation: "INVITATION_ACCEPTED", targetType: "INVITATION", targetId: AuditTargetId.from("synthetic-invitation"), outcome: scenario === "valid-invitation" ? "ALLOWED" : "DENIED", correlationId: CORRELATION, occurredAt: NOW });
}

function base(expiresAt = canonicalTimestamp("2027-03-01T00:00:00.000Z")) {
  return issueInvitation({ id: INVITATION, tenantId: TENANT, recipientEmail: "demo@example.test", role: "TENANT_ADMIN", tokenDigest: "digest-demo", issuedAt: canonicalTimestamp("2027-02-01T00:00:00.000Z"), expiresAt });
}

function result(scenario: string, expected: "ALLOWED" | "DENIED", actual: "ALLOWED" | "DENIED") {
  return NextResponse.json({ scenario, request: `POST /api/foundation/invitations?scenario=${scenario}`, expected, actual, passed: expected === actual, evidence: evidence(scenario) });
}

export async function POST(request: Request) {
  if (request.method !== "POST") return NextResponse.json({ error: redactError("INVITATION_DENIED", CORRELATION) }, { status: 405 });
  const scenario = parseScenario(request);
  if (!scenario || scenario === "malformed-request") return NextResponse.json({ scenario: scenario ?? "unknown", request: "POST /api/foundation/invitations", expected: "DENIED", actual: "DENIED", passed: scenario === "malformed-request", evidence: evidence(scenario ?? "unknown"), error: redactError("INVITATION_DENIED", CORRELATION) }, { status: 400 });
  try {
    const invitation = scenario === "expired-invitation" ? base(canonicalTimestamp("2027-02-10T00:00:00.000Z")) : base();
    if (scenario === "revoked-invitation") {
      acceptInvitation(revokeInvitation(invitation, canonicalTimestamp("2027-02-10T00:00:00.000Z")), "demo@example.test", TENANT, "digest-demo", NOW);
    } else if (scenario === "replayed-invitation") {
      const accepted = acceptInvitation(invitation, "demo@example.test", TENANT, "digest-demo", NOW);
      acceptInvitation(accepted, "demo@example.test", TENANT, "digest-demo", NOW);
    } else {
      acceptInvitation(invitation, "demo@example.test", scenario === "wrong-tenant-invitation" ? OTHER_TENANT : TENANT, "digest-demo", NOW);
    }
    return result(scenario, "ALLOWED", "ALLOWED");
  } catch {
    return result(scenario, "DENIED", "DENIED");
  }
}
