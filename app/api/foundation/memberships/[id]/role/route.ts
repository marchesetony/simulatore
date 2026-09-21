import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { changeMembershipRole } from "../../../../../lib/foundation/memberships";
import { membershipId, membershipRepository, principalFoundationActor, membershipFromStored } from "../../../../../lib/foundation/lifecycle";
import type { Role } from "../../../../../lib/foundation/types";
import { recordMutationAudit } from "../../../../../lib/auth/mutation-audit";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const ROLES: readonly Role[] = ["PRODUCT_OWNER", "PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"];
function denied(code: string, status: number): Response { return NextResponse.json({ error: { code, message: "Membership role mutation denied" } }, { status, headers: HEADERS }); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); const { id } = await context.params; const body = await request.json() as Record<string, unknown>; if (typeof body.role !== "string" || !ROLES.includes(body.role as Role) || !Number.isSafeInteger(body.expectedVersion)) return denied("MEMBERSHIP_REQUEST_INVALID", 422); const repositories = runtimeRepositories(); const result = await changeMembershipRole(membershipRepository(repositories), { actor: principalFoundationActor(principal).context, tenantId: principal.tenantId as never, membershipId: membershipId(id), expectedVersion: body.expectedVersion as number, role: body.role as Role, now: new Date().toISOString() as never }); const record = await repositories.foundationMemberships.get(principal.tenantId, id); if (!record) return denied("MEMBERSHIP_NOT_FOUND", 404); membershipFromStored(record); await recordMutationAudit({ principal, action: "MEMBERSHIP_ROLE_CHANGED", resourceType: "MEMBERSHIP", resourceId: result.id, targetUserId: result.userId, metadata: { role: result.role } }); return NextResponse.json({ membership: { ...record.payload, version: record.version, role: result.role } }, { headers: HEADERS }); }
  catch (error) { return denied(error instanceof Error ? error.message : "MEMBERSHIP_OPERATION_FAILED", 409); }
}
