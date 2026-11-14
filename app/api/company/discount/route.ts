import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { callerCanManageDiscount } from "../../../lib/hierarchy/api";
import { COMMERCIAL_DISCOUNT_RECORD_ID, emptyCommercialDiscount, parseCommercialDiscount } from "../../../lib/company/discount";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private" };

/**
 * The company's commercial discount (Tony, 1/11). Every quote applies it, so every operator reads the policy; only the
 * administrator and whom they authorize down the chain see the box and change it.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const [record, canManage] = await Promise.all([runtimeRepositories().commercialDiscounts.get(principal.tenantId, COMMERCIAL_DISCOUNT_RECORD_ID).catch(() => null), callerCanManageDiscount(principal).catch(() => false)]);
    const policy = record?.payload ?? emptyCommercialDiscount();
    return Response.json({ policy: { enabled: policy.enabled, maxGapPercent: policy.maxGapPercent, targetSavingPercent: policy.targetSavingPercent }, canManage, version: canManage ? record?.version ?? null : null }, { headers: HEADERS });
  } catch { return Response.json({ error: { code: "COMMERCIAL_DISCOUNT_UNAVAILABLE", message: "Sconto commerciale non disponibile" } }, { status: 403, headers: HEADERS }); }
}

export async function PUT(request: Request): Promise<Response> {
  let principal;
  try { principal = await requestPrincipal(request, "OPERATE"); if (!await callerCanManageDiscount(principal)) throw new Error("DENIED"); } catch { return Response.json({ error: { code: "COMMERCIAL_DISCOUNT_DENIED", message: "Solo l'amministratore e chi lui autorizza modificano lo sconto commerciale" } }, { status: 403, headers: HEADERS }); }
  try {
    const body = await request.json() as unknown;
    const policy = parseCommercialDiscount(body, new Date().toISOString(), principal.userId);
    const repository = runtimeRepositories().commercialDiscounts;
    const current = await repository.get(principal.tenantId, COMMERCIAL_DISCOUNT_RECORD_ID);
    const saved = await repository.put({ tenantId: principal.tenantId, recordId: COMMERCIAL_DISCOUNT_RECORD_ID, payload: policy, ...(current ? { expectedVersion: current.version } : {}) });
    return Response.json({ policy: saved.payload, canManage: true, version: saved.version }, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error && /^COMMERCIAL_DISCOUNT_[A-Z_]+$/.test(error.message) ? error.message : "COMMERCIAL_DISCOUNT_INVALID";
    const message = code === "COMMERCIAL_DISCOUNT_PERCENT_INVALID" ? "Le percentuali vanno da 0 a 30, e la soglia deve essere maggiore di 0" : "Sconto commerciale non valido";
    return Response.json({ error: { code, message } }, { status: 400, headers: HEADERS });
  }
}
