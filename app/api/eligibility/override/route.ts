import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { authorizeEligibilityOverride, eligibilityOverrideUiState, rejectEligibilityOverride, requestEligibilityOverride } from "../../../lib/eligibility/override";
import { prepareBillDrivenSimulation } from "../../../lib/calculation/bill-driven";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private", "vary": "Cookie, Authorization", "x-content-type-options": "nosniff" } as const;
const text = (value: unknown, code: string): string => typeof value === "string" && value.trim() ? value.trim() : (() => { throw new Error(code); })();

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const url = new URL(request.url);
    const billId = text(url.searchParams.get("billId"), "BILL_ID_REQUIRED");
    const billVersionId = text(url.searchParams.get("billVersionId"), "BILL_VERSION_ID_REQUIRED");
    const result = await eligibilityOverrideUiState(principal, runtimeRepositories(), billId, billVersionId);
    return Response.json(result, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "OVERRIDE_STATE_UNAVAILABLE";
    const status = code.startsWith("AUTHENTICATION") ? 401 : code.includes("DENIED") || code.includes("TENANT") ? 403 : code.includes("NOT_FOUND") ? 404 : 409;
    return Response.json({ error: { code, message: "Eligibility override state unavailable" } }, { status, headers: HEADERS });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "authorize" || body.action === "reject" ? body.action : "request";
    const principal = await requestPrincipal(request, action === "request" ? "READ" : "WRITE");
    const repositories = runtimeRepositories();
    if (action === "authorize") {
      const result = await authorizeEligibilityOverride(principal, repositories, text(body.overrideId, "OVERRIDE_ID_REQUIRED"), undefined, text(body.reason, "OVERRIDE_REASON_REQUIRED"));
      return Response.json({ override: result }, { headers: HEADERS });
    }
    if (action === "reject") {
      const result = await rejectEligibilityOverride(principal, repositories, text(body.overrideId, "OVERRIDE_ID_REQUIRED"), text(body.reason, "OVERRIDE_REASON_REQUIRED"));
      return Response.json({ override: result }, { headers: HEADERS });
    }
    const billId = text(body.billId, "BILL_ID_REQUIRED");
    const billVersionId = text(body.billVersionId, "BILL_VERSION_ID_REQUIRED");
    const cteId = text(body.cteId, "CTE_ID_REQUIRED");
    const prepared = await prepareBillDrivenSimulation(principal, repositories, billId, undefined);
    const candidate = prepared.candidates.find((item) => item.cteId === cteId || item.archiveId === cteId);
    if (!candidate || candidate.finalStatus !== "NOT_ELIGIBLE" || !candidate.overrideRequestable || !candidate.reasonCodes?.length) throw new Error("OVERRIDE_NOT_REQUESTABLE");
    if (prepared.context.billVersionId !== billVersionId) throw new Error("SOURCE_BILL_VERSION_MISMATCH");
    const result = await requestEligibilityOverride(principal, repositories, {
      billId,
      billVersionId,
      cteId: candidate.cteId,
      reason: text(body.reason, "OVERRIDE_REASON_REQUIRED"),
      originalMismatchReasons: candidate.reasonCodes,
      ...(body.expiresAt === undefined ? {} : { expiresAt: text(body.expiresAt, "OVERRIDE_EXPIRY_INVALID") }),
      ...(body.oneShot === undefined ? {} : { oneShot: body.oneShot === true }),
      ...(body.simulationId === undefined ? {} : { simulationId: text(body.simulationId, "SIMULATION_ID_INVALID") }),
    });
    return Response.json({ override: result }, { status: 201, headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "OVERRIDE_REQUEST_FAILED";
    const status = code.startsWith("AUTHENTICATION") ? 401 : code.includes("DENIED") || code.includes("SELF_APPROVAL") || code.includes("TENANT") ? 403 : code.includes("NOT_FOUND") ? 404 : 409;
    return Response.json({ error: { code, message: "Eligibility override denied" } }, { status, headers: HEADERS });
  }
}
