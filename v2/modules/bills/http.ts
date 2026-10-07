import "server-only";
import { SESSION_COOKIE } from "../auth/http";
import { AuthError } from "../../core/errors/auth-error";
import { loginFailure } from "../auth/service";
import { BillError } from "./types";
import { billRuntime } from "./runtime";

export const MAX_BILL_BODY_BYTES = 131072;
const headers = { "Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown): Response {
  const code = error instanceof BillError ? error.code : error instanceof AuthError &&
    loginFailure(error).kind !== "AUTHENTICATION_UNAVAILABLE" ? "DENIED" : "UNAVAILABLE";
  const status = { INVALID_INPUT: 400, DENIED: 403, NOT_FOUND: 404, UNAVAILABLE: 503 }[code];
  const messages = { INVALID_INPUT: "Controlla i dati: formato, importi, periodi o consumi non validi.",
    DENIED: "Accesso non consentito.", NOT_FOUND: "Documento o fornitura non disponibile.",
    UNAVAILABLE: "Archivio bollette non disponibile. Nessun salvataggio confermato." };
  return Response.json({ message: messages[code] }, { status, headers });
}
async function body(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new BillError("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new BillError("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BILL_BODY_BYTES) { await reader.cancel(); throw new BillError("INVALID_INPUT"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new BillError("INVALID_INPUT"); }
  finally { reader.releaseLock(); }
}
export async function billsHttp(request: Request, resource: "bills" | "supplies" = "bills",
  id?: string, createRuntime = billRuntime): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "targetTenantId") || query.getAll("targetTenantId").length > 1) throw new BillError("INVALID_INPUT");
    const target = query.get("targetTenantId") ?? undefined;
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(`${SESSION_COOKIE}=`));
    if (cookies.length !== 1) throw new BillError("DENIED");
    const token = cookies[0].slice(SESSION_COOKIE.length + 1);
    const { service, origin } = createRuntime();
    if (request.method === "GET") {
      const result = resource === "supplies" ? id ? await service.getSupply(token, id, target) : await service.listSupplies(token, target) :
        id ? await service.get(token, id, target) : await service.list(token, target);
      return Response.json(result, { headers });
    }
    if (!(request.method === "POST" && !id) && !(request.method === "PUT" && id && resource === "bills")) {
      return new Response(null, { status: 405, headers });
    }
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new BillError("DENIED");
    const payload = await body(request);
    const result = resource === "supplies" ? await service.createSupply(token, payload, target) :
      id ? await service.update(token, id, payload, target) : await service.create(token, payload, target);
    return Response.json(result, { status: request.method === "POST" ? 201 : 200, headers });
  } catch (error) { return failure(error); }
}
