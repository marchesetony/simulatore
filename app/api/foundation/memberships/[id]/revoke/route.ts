import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { revokeMembership } from "../../../../../lib/foundation/memberships";
import { membershipId, membershipRepository, principalFoundationActor, membershipFromStored } from "../../../../../lib/foundation/lifecycle";
import { recordMutationAudit } from "../../../../../lib/auth/mutation-audit";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function denied(code: string, status: number): Response { return NextResponse.json({ error: { code, message: "Membership revocation denied" } }, { status, headers: HEADERS }); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); const { id } = await context.params; const body = await request.json() as Record<string, unknown>; if (!Number.isSafeInteger(body.expectedVersion)) return denied("MEMBERSHIP_REQUEST_INVALID", 422); const repositories = runtimeRepositories(); const result = await revokeMembership(membershipRepository(repositories), { actor: principalFoundationActor(principal).context, tenantId: principal.tenantId as never, membershipId: membershipId(id), expectedVersion: body.expectedVersion as number, now: new Date().toISOString() as never }); const record = await repositories.foundationMemberships.get(principal.tenantId, id); if (!record) return denied("MEMBERSHIP_NOT_FOUND", 404); membershipFromStored(record); await recordMutationAudit({ principal, action: "MEMBERSHIP_REVOKED", resourceType: "MEMBERSHIP", resourceId: result.id, targetUserId: result.userId }); return NextResponse.json({ membership: { ...record.payload, version: record.version } }, { headers: HEADERS }); }
  catch (error) { return denied(error instanceof Error ? error.message : "MEMBERSHIP_OPERATION_FAILED", 409); }
}
