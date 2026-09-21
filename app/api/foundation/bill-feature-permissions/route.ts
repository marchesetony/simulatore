import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { billVisibilityScope } from "../../../lib/foundation/bill-visibility";
import { BILL_FEATURES, isBillFeature, isBillFeatureTargetType, permissionPayload, permissionRecordId, resolveBillFeaturePermissions, type BillFeature, type BillFeatureTargetType } from "../../../lib/foundation/bill-feature-permissions";

export const runtime = "nodejs";

const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const roleForMembership = (role: string): "SUPER_ADMIN" | "ADMIN" | "AGENT" | null => role === "PRODUCT_OWNER" || role === "PLATFORM_OWNER" || role === "TENANT_ADMIN" ? "SUPER_ADMIN" : role === "SALES_MANAGER" ? "ADMIN" : role === "SALES_OPERATOR" ? "AGENT" : null;

function response(body: unknown, status = 200): Response { return Response.json(body, { status, headers: HEADERS }); }
function error(code: string, status: number): Response { return response({ error: { code, message: "Operazione permessi funzionalità bolletta negata" } }, status); }

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    const memberships = await repositories.foundationMemberships.list(principal.tenantId);
    const scope = await billVisibilityScope(principal, repositories);
    const effective = await resolveBillFeaturePermissions(principal, repositories, scope);
    const rules = scope.role === "SUPER_ADMIN" ? (await repositories.billFeaturePermissions.list(principal.tenantId)).map((record) => ({ ...record.payload, version: record.version })) : [];
    const targets = scope.role === "SUPER_ADMIN" ? memberships.map((record) => record.payload).filter((membership) => membership.status === "ACTIVE").flatMap((membership) => {
      const role = roleForMembership(membership.role);
      return role === "ADMIN" || role === "AGENT" ? [{ targetType: "USER" as const, targetId: membership.userId, label: membership.userId, role }] : [];
    }) : [];
    const groupIds = scope.role === "SUPER_ADMIN" ? [...new Set(memberships.flatMap((record) => record.payload.groupIds ?? []))].sort() : [];
    return response({ role: effective.role, effective, features: BILL_FEATURES, rules, targets, groups: groupIds.map((groupId) => ({ targetType: "GROUP", targetId: groupId, label: groupId })) });
  } catch {
    return error("BILL_FEATURE_PERMISSION_READ_DENIED", 403);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const repositories = runtimeRepositories();
    const scope = await billVisibilityScope(principal, repositories);
    if (scope.role !== "SUPER_ADMIN") return error("SUPER_ADMIN_ONLY_PERMISSION_MANAGEMENT", 403);
    const body = await request.json() as Record<string, unknown>;
    const feature = body.feature;
    const targetType = body.targetType;
    const targetId = body.targetId;
    const enabled = body.enabled;
    if (!isBillFeature(feature) || !isBillFeatureTargetType(targetType) || typeof targetId !== "string" || targetId.length < 1 || targetId.length > 160 || typeof enabled !== "boolean") return error("BILL_FEATURE_PERMISSION_REQUEST_INVALID", 422);
    const memberships = (await repositories.foundationMemberships.list(principal.tenantId)).map((record) => record.payload).filter((membership) => membership.status === "ACTIVE");
    if (targetType === "USER") {
      const target = memberships.find((membership) => membership.userId === targetId);
      if (!target || !["SALES_MANAGER", "SALES_OPERATOR"].includes(target.role)) return error("BILL_FEATURE_PERMISSION_TARGET_INVALID", 422);
    } else {
      const knownGroups = new Set(memberships.flatMap((membership) => membership.groupIds ?? []));
      if (!/^group_[a-z0-9_-]+$/.test(targetId) || !knownGroups.has(targetId)) return error("BILL_FEATURE_PERMISSION_GROUP_INVALID", 422);
    }
    const recordId = permissionRecordId(principal.tenantId, feature, targetType, targetId);
    const previous = await repositories.billFeaturePermissions.get(principal.tenantId, recordId);
    const changedAt = new Date().toISOString();
    const payload = permissionPayload({ tenantId: principal.tenantId, feature: feature as BillFeature, targetType: targetType as BillFeatureTargetType, targetId, enabled, changedByUserId: principal.userId, changedAt });
    const saved = previous
      ? await repositories.billFeaturePermissions.put({ tenantId: principal.tenantId, recordId, payload, expectedVersion: previous.version, now: changedAt })
      : await repositories.billFeaturePermissions.append({ tenantId: principal.tenantId, recordId, payload, now: changedAt });
    await recordRuntimeAudit({
      tenantId: principal.tenantId,
      principal,
      action: enabled ? "BILL_FEATURE_PERMISSION_ENABLED" : "BILL_FEATURE_PERMISSION_DISABLED",
      resourceType: "BILL_FEATURE_PERMISSION",
      resourceId: recordId,
      outcome: "ALLOWED",
      correlationId: "bill-feature-governance",
      metadata: { feature, targetType, targetId, changedBy: principal.userId, changedAt, previousValue: previous?.payload.enabled ?? null, newValue: enabled },
    });
    return response({ permission: { ...saved.payload, version: saved.version } });
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("BILL_FEATURE_PERMISSION_REQUEST_INVALID", 422);
    return error("BILL_FEATURE_PERMISSION_WRITE_DENIED", 403);
  }
}
