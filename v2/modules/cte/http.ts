import "server-only";
import { SESSION_COOKIE } from "../auth/http";
import { AuthError } from "../../core/errors/auth-error";
import { loginFailure } from "../auth/service";
import { CteError } from "./types";
import { cteRuntime } from "./runtime";
export const MAX_BODY_BYTES = 131072;
const headers = { "Cache-Control": "no-store, private", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown): Response { const code = error instanceof CteError ? error.code : error instanceof AuthError && loginFailure(error).kind !== "AUTHENTICATION_UNAVAILABLE" ? "DENIED" : "UNAVAILABLE";
  const statuses: Record<string, number> = { INVALID_INPUT: 400, DENIED: 403, NOT_FOUND: 404, UNAVAILABLE: 503, OVERLAPPING_VALIDITY: 409 }; const status = statuses[code] ?? 503;
  const messages = { INVALID_INPUT: "Dati CTE non validi.", DENIED: "Accesso non consentito.", NOT_FOUND: "Versione CTE non disponibile.", UNAVAILABLE: "Archivio CTE non disponibile. Nessun salvataggio confermato.", OVERLAPPING_VALIDITY: "Validità sovrapposta: nessuna versione salvata." };
  return Response.json({ message: messages[code as keyof typeof messages] ?? messages.UNAVAILABLE }, { status: status ?? 503, headers }); }
async function body(request: Request): Promise<unknown> { if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new CteError("INVALID_INPUT"); const text = await request.text(); if (text.length > MAX_BODY_BYTES) throw new CteError("INVALID_INPUT"); try { return JSON.parse(text); } catch { throw new CteError("INVALID_INPUT"); } }
export async function cteHttp(request: Request, id: string | undefined, createRuntime = cteRuntime): Promise<Response> { try {
    const query = new URL(request.url).searchParams; if ([...query.keys()].some(key => key !== "targetTenantId") || query.getAll("targetTenantId").length > 1) throw new CteError("INVALID_INPUT"); const target = query.get("targetTenantId") ?? undefined;
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`)); if (cookies.length !== 1) throw new CteError("DENIED");
    const { service, origin } = createRuntime(); const token = cookies[0].slice(SESSION_COOKIE.length + 1);
    if (request.method === "GET") return Response.json(id ? await service.get(token, id, target) : await service.list(token, target), { headers });
    if (request.method !== "POST" || id || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 405, headers });
    return Response.json(await service.createVersion(token, await body(request), target), { status: 201, headers });
  } catch (error) { return failure(error); } }
