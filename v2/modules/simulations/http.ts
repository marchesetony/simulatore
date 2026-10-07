import "server-only";
import { SESSION_COOKIE } from "../auth/http";
import { AuthError } from "../../core/errors/auth-error";
import { loginFailure } from "../auth/service";
import { SimulationError } from "./types";
import { simulationRuntime } from "./runtime";

export const MAX_BODY_BYTES = 131072;
const headers = { "Cache-Control": "no-store, private", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown): Response {
  const code = error instanceof SimulationError ? error.code : error instanceof AuthError &&
    loginFailure(error).kind !== "AUTHENTICATION_UNAVAILABLE" ? "DENIED" : "UNAVAILABLE";
  const status = { INVALID_INPUT: 400, DENIED: 403, NOT_FOUND: 404, UNAVAILABLE: 503 }[code];
  const messages = { INVALID_INPUT: "Dati non validi: controlla campi, unità, importi e periodi.", DENIED: "Accesso non consentito.",
    NOT_FOUND: "Simulazione o fonte non disponibile.", UNAVAILABLE: "Archivio simulazioni non disponibile. Nessun salvataggio confermato." };
  return Response.json({ message: messages[code] }, { status, headers });
}
async function body(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new SimulationError("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new SimulationError("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new SimulationError("INVALID_INPUT"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new SimulationError("INVALID_INPUT"); }
  finally { reader.releaseLock(); }
}
export async function simulationsHttp(request: Request, id?: string, createRuntime = simulationRuntime): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "targetTenantId") || query.getAll("targetTenantId").length > 1) throw new SimulationError("INVALID_INPUT");
    const target = query.get("targetTenantId") ?? undefined;
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (cookies.length !== 1) throw new SimulationError("DENIED");
    const token = cookies[0].slice(SESSION_COOKIE.length + 1), { service, origin } = createRuntime();
    if (request.method === "GET") return Response.json(id ? await service.get(token, id, target) : await service.list(token, target), { headers });
    if (request.method !== "POST" || id) return new Response(null, { status: 405, headers });
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new SimulationError("DENIED");
    return Response.json(await service.create(token, await body(request), target), { status: 201, headers });
  } catch (error) { return failure(error); }
}
