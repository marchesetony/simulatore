import { requestTenant } from "../auth/request";
import type { AccessLevel } from "../auth/types";

export const ARCHIVE_CORRELATION_ID = "cte-market-archive-v1";

export function archiveError(error: unknown, fallback = "ARCHIVE_REQUEST_INVALID"): Response {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : fallback;
  const status = code === "AUTHENTICATION_REQUIRED" || code === "AUTHENTICATION_EXPIRED" || code === "AUTHENTICATION_INVALID" ? 401 : code === "TENANT_ACCESS_DENIED" || code === "TENANT_MISMATCH" || code === "AUTHORIZATION_DENIED" || code === "CTE_DIRECT_ARCHIVE_FORBIDDEN" ? 403 : code.endsWith("NOT_FOUND") ? 404 : code === "CTE_APPROVAL_NOT_READY" || code === "CTE_APPROVAL_BLOCKED" || code === "APPROVAL_METADATA_INVALID" ? 422 : code.includes("ALREADY") || code.includes("DUPLICATE") || code.includes("OVERLAP") || code.startsWith("CTE_COMMERCIAL_") || code === "CTE_RETENTION_NOT_DUE" || code === "CTE_NOT_APPROVED" || code === "CTE_VERSION_NOT_CURRENT" || code === "CTE_VERSION_NOT_APPROVABLE" || code === "CTE_VERSION_STALE" ? 409 : 400;
  return Response.json({ error: { code, message: "Archive request denied", correlationId: ARCHIVE_CORRELATION_ID } }, { status });
}

export async function localTenant(request: Request, access?: AccessLevel): Promise<string> { return requestTenant(request, access); }

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new Error("INVALID_JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVALID_JSON");
  return value as Record<string, unknown>;
}
