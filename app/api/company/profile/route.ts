import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { COMPANY_PROFILE_RECORD_ID, emptyCompanyProfile, parseCompanyProfile } from "../../../lib/company/profile";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private" };

/** The company's own name, data and logo printed on its proposals (Tony, 31/10). */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const record = await runtimeRepositories().companyProfiles.get(principal.tenantId, COMPANY_PROFILE_RECORD_ID);
    return Response.json({ profile: record?.payload ?? emptyCompanyProfile(), version: record?.version ?? null }, { headers: HEADERS });
  } catch { return Response.json({ error: { code: "COMPANY_PROFILE_UNAVAILABLE", message: "Dati aziendali non disponibili" } }, { status: 403, headers: HEADERS }); }
}

export async function PUT(request: Request): Promise<Response> {
  let principal;
  try { principal = await requestPrincipal(request, "ADMIN"); } catch { return Response.json({ error: { code: "TENANT_ACCESS_DENIED", message: "Solo l'amministratore modifica i dati aziendali" } }, { status: 403, headers: HEADERS }); }
  try {
    const body = await request.json() as unknown;
    const profile = parseCompanyProfile(body, new Date().toISOString());
    const repository = runtimeRepositories().companyProfiles;
    const current = await repository.get(principal.tenantId, COMPANY_PROFILE_RECORD_ID);
    const saved = await repository.put({ tenantId: principal.tenantId, recordId: COMPANY_PROFILE_RECORD_ID, payload: profile, ...(current ? { expectedVersion: current.version } : {}) });
    return Response.json({ profile: saved.payload, version: saved.version }, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error && /^COMPANY_[A-Z_]+$/.test(error.message) ? error.message : "COMPANY_PROFILE_INVALID";
    const message = code === "COMPANY_LOGO_TOO_LARGE" ? "Logo troppo grande" : code === "COMPANY_PROFILE_TOO_LONG" ? "Un campo è troppo lungo" : "Dati aziendali non validi";
    return Response.json({ error: { code, message } }, { status: 400, headers: HEADERS });
  }
}
