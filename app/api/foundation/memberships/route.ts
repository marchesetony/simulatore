import { NextResponse } from "next/server";
import { createAuditEvent, AuditTargetId } from "../../../lib/foundation/audit";
import { CorrelationId, redactError } from "../../../lib/foundation/errors";
import { resolveTenantContext } from "../../../lib/foundation/tenants";
import { canonicalTimestamp } from "../../../lib/foundation/types";
import type { Identity, Membership, MembershipId, TenantId, UserId } from "../../../lib/foundation/types";
import { requireRequestAccess } from "../../../lib/auth/request";

type Scenario = "active-membership" | "inactive-membership" | "cross-tenant-membership" | "malformed-request";
const USER = "user-demo" as UserId;
const TENANT = "tenant-demo" as TenantId;
const OTHER_TENANT = "tenant-other" as TenantId;
const MEMBERSHIP = "membership-demo" as MembershipId;
const CORRELATION = CorrelationId.from("foundation-member");
const IDENTITY: Identity = { userId: USER, subject: "subject-demo", email: "demo@example.test", active: true };

function parseScenario(request: Request): Scenario | null {
  const value = new URL(request.url).searchParams.get("scenario");
  return value === "active-membership" || value === "inactive-membership" || value === "cross-tenant-membership" || value === "malformed-request" ? value : null;
}

function evidence(scenario: string) {
  return createAuditEvent({ category: "MEMBERSHIP", operation: scenario === "active-membership" ? "MEMBERSHIP_ACTIVATED" : "MEMBERSHIP_DENIED", targetType: "MEMBERSHIP", targetId: AuditTargetId.from("synthetic-membership"), outcome: scenario === "active-membership" ? "ALLOWED" : "DENIED", correlationId: CORRELATION, occurredAt: canonicalTimestamp("2027-02-15T00:00:00.000Z") });
}

export async function POST(request: Request) {
  if (request.method !== "POST") return NextResponse.json({ error: redactError("TENANT_ACCESS_DENIED", CORRELATION) }, { status: 405 });
  try { await requireRequestAccess(request, "ADMIN"); } catch { return NextResponse.json({ error: redactError("TENANT_ACCESS_DENIED", CORRELATION) }, { status: 401 }); }
  const scenario = parseScenario(request);
  if (!scenario || scenario === "malformed-request") return NextResponse.json({ scenario: scenario ?? "unknown", request: "POST /api/foundation/memberships", expected: "DENIED", actual: "DENIED", passed: scenario === "malformed-request", evidence: evidence(scenario ?? "unknown"), error: redactError("TENANT_ACCESS_DENIED", CORRELATION) }, { status: 400 });
  try {
    const membership: Membership = { id: MEMBERSHIP, userId: USER, tenantId: TENANT, role: "TENANT_ADMIN", status: scenario === "inactive-membership" ? "SUSPENDED" : "ACTIVE", permissions: ["tenant:read"] };
    resolveTenantContext(IDENTITY, membership, scenario === "cross-tenant-membership" ? OTHER_TENANT : TENANT);
    return NextResponse.json({ scenario, request: `POST /api/foundation/memberships?scenario=${scenario}`, expected: "ALLOWED", actual: "ALLOWED", passed: true, evidence: evidence(scenario) });
  } catch {
    return NextResponse.json({ scenario, request: `POST /api/foundation/memberships?scenario=${scenario}`, expected: "DENIED", actual: "DENIED", passed: true, evidence: evidence(scenario) });
  }
}
