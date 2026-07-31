export const ARCHIVE_CORRELATION_ID = "cte-market-archive-v1";

export function archiveError(error: unknown, fallback = "ARCHIVE_REQUEST_INVALID"): Response {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : fallback;
  const status = code === "TENANT_ACCESS_DENIED" ? 403 : code.endsWith("NOT_FOUND") ? 404 : code.includes("ALREADY") || code.includes("DUPLICATE") || code.includes("OVERLAP") ? 409 : 400;
  return Response.json({ error: { code, message: "Archive request denied", correlationId: ARCHIVE_CORRELATION_ID } }, { status });
}

export function localTenant(request: Request): string {
  if (process.env.FOUNDATION_LOCAL_DEV !== "true") throw new Error("TENANT_ACCESS_DENIED");
  const tenantId = request.headers.get("x-foundation-tenant-id");
  if (!tenantId || !/^tenant_[a-z0-9-]+$/.test(tenantId)) throw new Error("TENANT_ACCESS_DENIED");
  return tenantId;
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new Error("INVALID_JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVALID_JSON");
  return value as Record<string, unknown>;
}
