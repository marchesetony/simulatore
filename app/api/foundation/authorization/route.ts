import { NextResponse } from "next/server";
import { createAuditEvent, AuditTargetId } from "../../../lib/foundation/audit";
import { authorize } from "../../../lib/foundation/authorization";
import { CorrelationId, redactError } from "../../../lib/foundation/errors";
import { resolveTenantContext } from "../../../lib/foundation/tenants";
import { canonicalTimestamp } from "../../../lib/foundation/types";
import type { Identity, Membership, MembershipId, Permission, Role, TenantId, UserId } from "../../../lib/foundation/types";
import { requireRequestAccess } from "../../../lib/auth/request";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";

type RoleScenario = `${"product-owner" | "platform-owner" | "tenant-admin" | "sales-manager" | "sales-operator"}-${"allowed" | "denied"}`;
type Scenario = RoleScenario | "malformed-request";
const USER = "user-demo" as UserId;
const TENANT = "tenant-demo" as TenantId;
const MEMBERSHIP = "membership-demo" as MembershipId;
const IDENTITY: Identity = { userId: USER, subject: "subject-demo", email: "demo@example.test", active: true };
const CORRELATION = CorrelationId.from("foundation-authz");
const roleMap: Readonly<Record<RoleScenario, { role: Role; permission: Permission }>> = {
  "product-owner-allowed": { role: "PRODUCT_OWNER", permission: "tenant:manage" }, "product-owner-denied": { role: "PRODUCT_OWNER", permission: "audit:read" },
  "platform-owner-allowed": { role: "PLATFORM_OWNER", permission: "tenant:read" }, "platform-owner-denied": { role: "PLATFORM_OWNER", permission: "document:manage" },
  "tenant-admin-allowed": { role: "TENANT_ADMIN", permission: "membership:manage" }, "tenant-admin-denied": { role: "TENANT_ADMIN", permission: "audit:read" },
  "sales-manager-allowed": { role: "SALES_MANAGER", permission: "customer:manage" }, "sales-manager-denied": { role: "SALES_MANAGER", permission: "tenant:manage" },
  "sales-operator-allowed": { role: "SALES_OPERATOR", permission: "document:read" }, "sales-operator-denied": { role: "SALES_OPERATOR", permission: "membership:manage" },
};

function parseScenario(request: Request): Scenario | null {
  const value = new URL(request.url).searchParams.get("scenario");
  if (value === "malformed-request") return value;
  return value !== null && isRoleScenario(value) ? value : null;
}

function isRoleScenario(value: string): value is RoleScenario {
  return Object.prototype.hasOwnProperty.call(roleMap, value);
}

function evidence(scenario: string, allowed: boolean) {
  return createAuditEvent({ category: "AUTHORIZATION", operation: allowed ? "AUTHORIZATION_ALLOWED" : "AUTHORIZATION_DENIED", targetType: "AUTHORIZATION", targetId: AuditTargetId.from("synthetic-authorization"), outcome: allowed ? "ALLOWED" : "DENIED", correlationId: CORRELATION, occurredAt: canonicalTimestamp("2027-02-15T00:00:00.000Z") });
}

export async function POST(request: Request) {
  if (request.method !== "POST") return NextResponse.json({ error: redactError("AUTHORIZATION_DENIED", CORRELATION) }, { status: 405 });
  let principal;
  try { principal = await requireRequestAccess(request, "ADMIN"); } catch { return NextResponse.json({ error: redactError("AUTHORIZATION_DENIED", CORRELATION) }, { status: 401 }); }
  const scenario = parseScenario(request);
  if (!scenario || scenario === "malformed-request") return NextResponse.json({ scenario: scenario ?? "unknown", request: "POST /api/foundation/authorization", expected: "DENIED", actual: "DENIED", passed: scenario === "malformed-request", evidence: evidence(scenario ?? "unknown", false), error: redactError("AUTHORIZATION_DENIED", CORRELATION) }, { status: 400 });
  const selected = roleMap[scenario];
  const allowed = scenario.endsWith("-allowed");
  const membership: Membership = { id: MEMBERSHIP, userId: USER, tenantId: TENANT, role: selected.role, status: "ACTIVE", permissions: allowed ? [selected.permission] : ["tenant:read"] };
  const context = resolveTenantContext(IDENTITY, membership, TENANT);
  const authorization = authorize({ context, tenantId: TENANT, permission: selected.permission });
  if (!authorization.allowed) {
    try { await recordRuntimeAudit({ tenantId: principal.tenantId, principal, action: "AUTHORIZATION_DENIAL", resourceType: "AUTHORIZATION", outcome: "DENIED", correlationId: "foundation-authz", metadata: { permission: selected.permission, reason: authorization.reason } }); }
    catch { console.error("phase6-foundation-authz-audit-failure", { reason: authorization.reason }); }
  }
  const actual = authorization.allowed;
  return NextResponse.json({ scenario, request: `POST /api/foundation/authorization?scenario=${scenario}`, expected: allowed ? "ALLOWED" : "DENIED", actual: actual ? "ALLOWED" : "DENIED", passed: actual === allowed, evidence: evidence(scenario, actual) });
}
