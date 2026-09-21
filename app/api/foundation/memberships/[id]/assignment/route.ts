import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { assignMembershipManager } from "../../../../../lib/foundation/memberships";
import { membershipId, membershipRepository, principalFoundationActor } from "../../../../../lib/foundation/lifecycle";
import { recordMutationAudit } from "../../../../../lib/auth/mutation-audit";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function denied(code: string, status = 409): Response { return NextResponse.json({ error: { code, message: "Membership assignment denied" } }, { status, headers: HEADERS }); }

async function mutate(request: Request, context: { params: Promise<{ id: string }> }, managerUserId: string | null, expectedVersion: number): Promise<Response> {
  try {
    const principal = await requireRequestAccess(request, "ADMIN");
    const { id } = await context.params;
    const repositories = runtimeRepositories();
    const result = await assignMembershipManager(membershipRepository(repositories), { actor: principalFoundationActor(principal).context, tenantId: principal.tenantId as never, membershipId: membershipId(id), expectedVersion, managerUserId: managerUserId as never, now: new Date().toISOString() as never });
    await recordMutationAudit({ principal, action: "MEMBERSHIP_ASSIGNMENT_CHANGED", resourceType: "MEMBERSHIP", resourceId: result.id, targetUserId: result.userId, metadata: { managerUserId: result.managerUserId ?? null } });
    return NextResponse.json({ assignment: { membershipId: result.id, assignedUserId: result.userId, managerUserId: result.managerUserId ?? null, version: result.version } }, { headers: HEADERS });
  } catch (error) { return denied(error instanceof Error ? error.message : "ASSIGNMENT_OPERATION_FAILED"); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const body = await request.json() as Record<string, unknown>; if (typeof body.managerUserId !== "string" || body.managerUserId.trim().length === 0 || !Number.isSafeInteger(body.expectedVersion)) return denied("ASSIGNMENT_REQUEST_INVALID", 422); return mutate(request, context, body.managerUserId, body.expectedVersion as number); }
  catch { return denied("ASSIGNMENT_REQUEST_INVALID", 422); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const body = await request.json() as Record<string, unknown>; if (!Number.isSafeInteger(body.expectedVersion)) return denied("ASSIGNMENT_REQUEST_INVALID", 422); return mutate(request, context, null, body.expectedVersion as number); }
  catch { return denied("ASSIGNMENT_REQUEST_INVALID", 422); }
}
