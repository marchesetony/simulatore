import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../../../lib/auth/request";
import { runtimeRepositories } from "../../../../../lib/persistence/adapter";
import { acceptInvitation } from "../../../../../lib/foundation/invitations";
import { canonicalTimestamp } from "../../../../../lib/foundation/types";
import { invitationFromStored, membershipFromStored, permissionsForFoundationRole } from "../../../../../lib/foundation/lifecycle";
import { recordMutationAudit } from "../../../../../lib/auth/mutation-audit";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function denied(code: string, status: number): Response { return NextResponse.json({ error: { code, message: "Invitation acceptance denied" } }, { status, headers: HEADERS }); }
async function tokenDigest(request: Request): Promise<string> { try { const value = await request.json() as unknown; if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).token !== "string") throw new Error(); const token = (value as Record<string, unknown>).token as string; if (token.length < 32) throw new Error(); return createHash("sha256").update(token, "utf8").digest("hex"); } catch { throw new Error("INVITATION_TOKEN_INVALID"); } }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const principal = await requireRequestAccess(request, "READ"); const { id } = await context.params; const repositories = runtimeRepositories(); const record = await repositories.foundationInvitations.get(principal.tenantId, id); if (!record || record.payload.recipientUserId !== principal.userId) return denied("INVITATION_NOT_FOUND", 404);
    const digest = await tokenDigest(request); if (digest !== record.payload.tokenDigest) return denied("INVITATION_DENIED", 403); const now = canonicalTimestamp(new Date().toISOString()); const current = invitationFromStored(record, now); const membershipId = `membership_${id}`;
    const existingMembership = await repositories.foundationMemberships.get(principal.tenantId, membershipId);
    if (current.status === "ACCEPTED" && existingMembership) return NextResponse.json({ invitation: { id, status: current.status, version: record.version }, membership: { ...existingMembership.payload, version: existingMembership.version } }, { headers: HEADERS });
    const accepted = acceptInvitation(current, record.payload.recipientEmail, principal.tenantId as never, digest, now); if (existingMembership) return denied("MEMBERSHIP_ALREADY_EXISTS", 409);
    const membership = await repositories.foundationMemberships.append({ tenantId: principal.tenantId, recordId: membershipId, payload: { id: membershipId, userId: principal.userId, tenantId: principal.tenantId, role: accepted.role, status: "ACTIVE", permissions: permissionsForFoundationRole(accepted.role), createdAt: now, updatedAt: now }, now });
    const savedInvitation = await repositories.foundationInvitations.put({ tenantId: principal.tenantId, recordId: id, payload: { ...record.payload, status: "ACCEPTED", acceptedAt: now }, expectedVersion: record.version, now }); membershipFromStored(membership);
    await recordMutationAudit({ principal, action: "MEMBERSHIP_CREATED", resourceType: "MEMBERSHIP", resourceId: membershipId, targetUserId: principal.userId, metadata: { role: accepted.role } });
    await recordMutationAudit({ principal, action: "INVITATION_ACCEPTED", resourceType: "INVITATION", resourceId: id, targetUserId: principal.userId, metadata: { role: accepted.role } });
    return NextResponse.json({ invitation: { id, status: savedInvitation.payload.status, version: savedInvitation.version }, membership: { ...membership.payload, version: membership.version } }, { headers: HEADERS });
  } catch (error) { const code = error instanceof Error ? error.message : "INVITATION_DENIED"; return denied(code === "INVITATION_TOKEN_INVALID" ? code : "INVITATION_DENIED", code === "INVITATION_TOKEN_INVALID" ? 422 : 403); }
}
