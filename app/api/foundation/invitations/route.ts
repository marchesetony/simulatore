import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { issueInvitation } from "../../../lib/foundation/invitations";
import { canonicalTimestamp } from "../../../lib/foundation/types";
import type { InvitationId, Role, TenantId } from "../../../lib/foundation/types";
import type { FoundationInvitationRecord, TenantRecord } from "../../../lib/persistence/types";
import { invitationPayload } from "../../../lib/foundation/lifecycle";
import { canManageCanonicalRole, foundationRoleToCanonical, legacyAuthRoleToCanonical } from "../../../lib/auth/roles";
import { recordMutationAudit } from "../../../lib/auth/mutation-audit";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
const ROLES: readonly Role[] = ["PRODUCT_OWNER", "PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"];
function response(error: string, status: number): Response { return NextResponse.json({ error: { code: error, message: "Invitation operation denied" } }, { status, headers: HEADERS }); }
function bodyObject(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVITATION_REQUEST_INVALID"); return value as Record<string, unknown>; }
function digest(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }
function publicInvitation(record: TenantRecord<FoundationInvitationRecord>): Record<string, unknown> { const { tokenDigest: _tokenDigest, createdBy: _createdBy, ...safe } = record.payload; return { ...safe, version: record.version }; }

export async function GET(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); const records = await runtimeRepositories().foundationInvitations.list(principal.tenantId); return NextResponse.json({ invitations: records.map(publicInvitation) }, { headers: HEADERS }); }
  catch { return response("INVITATION_ACCESS_DENIED", 401); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requireRequestAccess(request, "ADMIN");
    const input = bodyObject(await request.json());
    const recipientUserId = typeof input.recipientUserId === "string" ? input.recipientUserId : "";
    const recipientEmail = typeof input.recipientEmail === "string" ? input.recipientEmail : "";
    const role = input.role;
    if (!/^user_[a-z0-9-]+$/.test(recipientUserId) || !recipientEmail.includes("@") || typeof role !== "string" || !ROLES.includes(role as Role)) return response("INVITATION_REQUEST_INVALID", 422);
    const issuedAt = canonicalTimestamp(new Date().toISOString());
    const expiresAt = typeof input.expiresAt === "string" ? canonicalTimestamp(input.expiresAt) : canonicalTimestamp(new Date(Date.parse(issuedAt) + 7 * 86400000).toISOString());
    const token = randomBytes(32).toString("base64url");
    const invitation = issueInvitation({ id: `invitation_${randomUUID()}` as InvitationId, tenantId: principal.tenantId as TenantId, recipientEmail, role: role as Role, tokenDigest: digest(token), issuedAt, expiresAt });
    if (!canManageCanonicalRole(legacyAuthRoleToCanonical(principal.role), foundationRoleToCanonical(invitation.role))) return response("ROLE_ESCALATION_DENIED", 403);
    const saved = await runtimeRepositories().foundationInvitations.append({ tenantId: principal.tenantId, recordId: invitation.id, payload: invitationPayload(invitation, recipientUserId, principal.userId), now: issuedAt });
    await recordMutationAudit({ principal, action: "INVITATION_CREATED", resourceType: "INVITATION", resourceId: invitation.id, targetUserId: recipientUserId, metadata: { role: invitation.role } });
    return NextResponse.json({ invitation: publicInvitation(saved), token }, { status: 201, headers: HEADERS });
  } catch (error) { return response(error instanceof Error && error.message === "INVITATION_REQUEST_INVALID" ? error.message : "INVITATION_OPERATION_FAILED", 422); }
}
