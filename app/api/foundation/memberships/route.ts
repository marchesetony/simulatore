import { NextResponse } from "next/server";
import { requireRequestAccess } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { membershipFromStored } from "../../../lib/foundation/lifecycle";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };
function response(error: string, status: number): Response { return NextResponse.json({ error: { code: error, message: "Membership operation denied" } }, { status, headers: HEADERS }); }
export async function GET(request: Request): Promise<Response> {
  try { const principal = await requireRequestAccess(request, "ADMIN"); const records = await runtimeRepositories().foundationMemberships.list(principal.tenantId); records.forEach(membershipFromStored); return NextResponse.json({ memberships: records.map((record) => ({ ...record.payload, version: record.version })) }, { headers: HEADERS }); }
  catch { return response("MEMBERSHIP_ACCESS_DENIED", 401); }
}
