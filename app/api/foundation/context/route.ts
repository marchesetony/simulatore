import { AuthenticationError } from "../../../lib/auth/errors";
import { requestPrincipal } from "../../../lib/auth/request";
import type { AuthenticatedPrincipal } from "../../../lib/auth/types";
import { readinessReport, type ReadinessReport } from "../../../lib/readiness";

export const runtime = "nodejs";

const CORRELATION_ID = "foundation-context";
const noStoreHeaders = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" };

type ContextFailure = "AUTH_CONFIGURATION_INVALID" | "AUTH_ADAPTER_UNAVAILABLE" | "AUTH_AUDIT_UNAVAILABLE" | "AUTHENTICATION_REQUIRED" | "AUTHENTICATION_EXPIRED" | "AUTHENTICATION_INVALID" | "AUTHORIZATION_DENIED";

function safeFailure(error: unknown): { readonly code: ContextFailure; readonly status: number; readonly state: "UNAUTHENTICATED" | "UNAVAILABLE" } {
  if (error instanceof AuthenticationError) {
    const code = error.code === "AUTH_CONFIGURATION_INVALID" || error.code === "AUTH_ADAPTER_UNAVAILABLE" || error.code === "AUTH_AUDIT_UNAVAILABLE"
      ? error.code
      : error.code === "AUTHENTICATION_REQUIRED" || error.code === "AUTHENTICATION_EXPIRED" || error.code === "AUTHENTICATION_INVALID"
        ? error.code
        : error.code === "AUTHORIZATION_DENIED"
          ? error.code
          : "AUTHENTICATION_INVALID";
    return { code, status: code === "AUTH_CONFIGURATION_INVALID" || code === "AUTH_ADAPTER_UNAVAILABLE" || code === "AUTH_AUDIT_UNAVAILABLE" ? 503 : code === "AUTHORIZATION_DENIED" ? 403 : 401, state: code === "AUTH_CONFIGURATION_INVALID" || code === "AUTH_ADAPTER_UNAVAILABLE" || code === "AUTH_AUDIT_UNAVAILABLE" ? "UNAVAILABLE" : "UNAUTHENTICATED" };
  }
  if (error instanceof Error && error.message.startsWith("AUTH_CONFIGURATION_INVALID")) return { code: "AUTH_CONFIGURATION_INVALID", status: 503, state: "UNAVAILABLE" };
  return { code: "AUTHENTICATION_INVALID", status: 401, state: "UNAUTHENTICATED" };
}

function safeReadiness(readiness: ReadinessReport): ReadinessReport {
  return {
    application: readiness.application,
    runtimeMode: readiness.runtimeMode,
    authAdapterConfigured: readiness.authAdapterConfigured,
    persistenceAdapterConfigured: readiness.persistenceAdapterConfigured,
    readiness: readiness.readiness,
    schemaCompatibility: readiness.schemaCompatibility,
    timestamp: readiness.timestamp,
  };
}

function authenticatedResponse(principal: AuthenticatedPrincipal, readiness: ReadinessReport): Response {
  return Response.json({
    authenticated: true,
    authenticationState: "AUTHENTICATED",
    principalId: principal.userId,
    role: principal.role,
    tenantId: principal.tenantId,
    authSource: principal.source,
    runtimeMode: readiness.runtimeMode,
    readiness: safeReadiness(readiness),
  }, { headers: noStoreHeaders });
}

export async function GET(request: Request): Promise<Response> {
  const readiness = readinessReport();
  if (readiness.runtimeMode === "invalid") {
    return Response.json({
      authenticated: false,
      authenticationState: "UNAVAILABLE",
      runtimeMode: "invalid",
      readiness: safeReadiness(readiness),
      error: { code: "AUTH_CONFIGURATION_INVALID", message: "Contesto di sessione non disponibile", correlationId: CORRELATION_ID },
    }, { status: 503, headers: noStoreHeaders });
  }
  try {
    const principal = await requestPrincipal(request, "READ");
    if ((readiness.runtimeMode === "local" && principal.source !== "LOCAL_SYNTHETIC") || (readiness.runtimeMode === "production" && principal.source !== "VERIFIED_SESSION")) throw new Error("AUTHENTICATION_INVALID");
    return authenticatedResponse(principal, readiness);
  } catch (error) {
    const failure = safeFailure(error);
    return Response.json({
      authenticated: false,
      authenticationState: failure.state,
      runtimeMode: readiness.runtimeMode,
      readiness: safeReadiness(readiness),
      error: { code: failure.code, message: "Contesto di sessione non disponibile", correlationId: CORRELATION_ID },
    }, { status: failure.status, headers: noStoreHeaders });
  }
}
