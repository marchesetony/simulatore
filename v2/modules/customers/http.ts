import "server-only";
import { authRuntime } from "../auth/runtime";
import { SupabaseHttp } from "../auth/supabase-http";
import { SESSION_COOKIE } from "../auth/http";
import { loginFailure } from "../auth/service";
import { CustomerService } from "./service";
import { SupabaseCustomerRepository } from "./repository";
import { CustomerError } from "./types";

function runtime() {
  const { config, dependencies } = authRuntime();
  return { origin: config.origin, service: new CustomerService(dependencies, new SupabaseCustomerRepository(new SupabaseHttp(config))) };
}
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown): Response {
  const code = error instanceof CustomerError ? error.code :
    loginFailure(error).kind === "AUTHENTICATION_UNAVAILABLE" ? "UNAVAILABLE" : "DENIED";
  const status = { INVALID_INPUT: 400, DENIED: 403, NOT_FOUND: 404, UNAVAILABLE: 503 }[code];
  const message = { INVALID_INPUT: "Controlla i dati inseriti.", DENIED: "Accesso non consentito.",
    NOT_FOUND: "Cliente non disponibile.", UNAVAILABLE: "Servizio clienti temporaneamente non disponibile." }[code];
  return Response.json({ message }, { status, headers });
}
async function body(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new CustomerError("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new CustomerError("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); throw new CustomerError("INVALID_INPUT"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new CustomerError("INVALID_INPUT"); }
  finally { reader.releaseLock(); }
}

export async function customersHttp(request: Request, id?: string, createRuntime = runtime): Promise<Response> {
  try {
    const { service, origin } = createRuntime();
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "targetTenantId") || query.getAll("targetTenantId").length > 1) {
      throw new CustomerError("INVALID_INPUT");
    }
    const target = query.get("targetTenantId") ?? undefined;
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim())
      .filter(s => s.startsWith(`${SESSION_COOKIE}=`));
    if (cookies.length !== 1) throw new CustomerError("DENIED");
    const token = cookies[0].slice(SESSION_COOKIE.length + 1);
    if (request.method === "GET") {
      return Response.json(id ? await service.get(token, id, target) : await service.list(token, target), { headers });
    }
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new CustomerError("DENIED");
    }
    const payload = await body(request);
    if (request.method === "POST" && !id) return Response.json(await service.create(token, payload, target), { status: 201, headers });
    if (request.method === "PUT" && id) return Response.json(await service.update(token, id, payload, target), { headers });
    return new Response(null, { status: 405, headers });
  } catch (error) { return failure(error); }
}
