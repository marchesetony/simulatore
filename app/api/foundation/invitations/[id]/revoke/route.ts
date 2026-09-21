import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { invitationFromStored, invitationPayload } from "../../../../../lib/foundation/lifecycle";
import { revokeInvitation } from "../../../../../lib/foundation/invitations";
import { canonicalTimestamp } from "../../../../../lib/foundation/types";
import { recordMutationAudit } from "../../../../../lib/auth/mutation-audit";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function denied(code: string, status: number): Response { return NextResponse.json({ error: { code, message: "Invitation operation denied" } }, { status, headers: HEADERS }); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const principal = await requireRequestAccess(request, "ADMIN"); const { id } = await context.params; const repositories = runtimeRepositories(); const record = await repositories.foundationInvitations.get(principal.tenantId, id); if (!record) return denied("INVITATION_NOT_FOUND", 404);
    const now = canonicalTimestamp(new Date().toISOString()); const current = invitationFromStored(record, now); if (current.status === "REVOKED") return NextResponse.json({ invitation: { id, status: "REVOKED", version: record.version } }, { headers: HEADERS });
    const next = revokeInvitation(current, now); const saved = await repositories.foundationInvitations.put({ tenantId: principal.tenantId, recordId: id, payload: invitationPayload(next, record.payload.recipientUserId, record.payload.createdBy), expectedVersion: record.version, now });
    await recordMutationAudit({ principal, action: "INVITATION_REVOKED", resourceType: "INVITATION", resourceId: id, targetUserId: record.payload.recipientUserId });
    return NextResponse.json({ invitation: { id, status: saved.payload.status, version: saved.version } }, { headers: HEADERS });
  } catch (error) { return denied(error instanceof Error ? error.message : "INVITATION_OPERATION_FAILED", 409); }
}
