export const CALCULATION_CORRELATION_ID = "calculation-comparison-engine-v1";

export function calculationError(error: unknown, fallback = "CALCULATION_REQUEST_INVALID"): Response {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : fallback;
  const status = code === "TENANT_ACCESS_DENIED" ? 403 : code.endsWith("NOT_FOUND") ? 404 : code.includes("INCOMPATIBLE") || code.includes("MISSING") ? 409 : 400;
  return Response.json({ error: { code, message: "Calculation request denied", correlationId: CALCULATION_CORRELATION_ID } }, { status });
}
