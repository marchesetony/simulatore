import "server-only";
import { AuthError } from "../../core/errors/auth-error";
import { authorizedSession, login, loginFailure } from "./service";
import type { AuthDependencies } from "./service";
import type { LoginResult } from "./types";

export const SESSION_COOKIE = "__Host-v2-auth";
const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=Strict";
const messages = {
  AUTHENTICATION_FAILED: "Accesso non consentito. Verifica le credenziali o contatta l’amministratore.",
  AUTHENTICATION_UNAVAILABLE: "Accesso temporaneamente non disponibile. Riprova più tardi.",
  TENANT_SELECTION_REQUIRED: "L’accesso richiede una verifica dell’amministratore.",
  ACCESS_CONFIGURATION_INVALID: "L’accesso richiede una verifica dell’amministratore.",
} as const;

export function loginResponse(result: LoginResult): Response {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (result.kind === "AUTHENTICATED") {
    headers.set("Set-Cookie", `${SESSION_COOKIE}=${result.token}; ${cookieFlags}; Expires=${new Date(result.expiresAt).toUTCString()}`);
    return Response.json({ authenticated: true }, { headers });
  }
  headers.set("Set-Cookie", `${SESSION_COOKIE}=; ${cookieFlags}; Max-Age=0`);
  const status = result.kind === "AUTHENTICATION_UNAVAILABLE" ? 503 :
    result.kind === "AUTHENTICATION_FAILED" ? 401 : 403;
  return Response.json({ authenticated: false, message: messages[result.kind] }, { status, headers });
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.match(/^application\/json(?:;|$)/i)) throw new AuthError("INVALID_CREDENTIALS");
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("INVALID_CREDENTIALS");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new AuthError("INVALID_CREDENTIALS"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new AuthError("INVALID_CREDENTIALS"); }
  finally { reader.releaseLock(); }
}

export async function handleLogin(request: Request, origin: string, deps: AuthDependencies): Promise<Response> {
  try {
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new AuthError("INVALID_CREDENTIALS");
    }
    return loginResponse(await login(await readBody(request), deps));
  } catch (error) { return loginResponse(loginFailure(error)); }
}

export async function handleSession(request: Request, deps: AuthDependencies): Promise<Response> {
  try {
    const matches = (request.headers.get("cookie") ?? "").split(";")
      .map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`));
    if (matches.length !== 1) throw new AuthError("SESSION_INVALID");
    const token = matches[0].slice(SESSION_COOKIE.length + 1);
    if (!await authorizedSession(token, deps, "auth:session")) throw new AuthError("ACCESS_DENIED");
    return Response.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return loginResponse(loginFailure(error)); }
}
