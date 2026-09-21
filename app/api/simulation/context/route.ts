import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { prepareBillDrivenSimulation, NO_STORE_HEADERS } from "../../../lib/calculation/bill-driven";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const url = new URL(request.url);
    const billId = url.searchParams.get("billId") ?? "";
    const taxTreatmentValue = url.searchParams.get("taxTreatment");
    if (taxTreatmentValue !== null && !["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"].includes(taxTreatmentValue)) throw new Error("TAX_TREATMENT_INVALID");
    const taxTreatment = taxTreatmentValue === "INCLUDED" || taxTreatmentValue === "EXCLUDED" || taxTreatmentValue === "NOT_APPLICABLE" ? taxTreatmentValue : undefined;
    const result = await prepareBillDrivenSimulation(principal, runtimeRepositories(), billId, taxTreatment);
    return Response.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SIMULATION_CONTEXT_UNAVAILABLE";
    const status = code === "SOURCE_BILL_NOT_FOUND" ? 404 : code.startsWith("AUTHENTICATION") ? 401 : code.includes("DENIED") ? 403 : code.includes("MISSING") || code.includes("INCOMPATIBLE") ? 409 : 400;
    return Response.json({ error: { code, message: "Bill-driven simulation context unavailable" } }, { status, headers: NO_STORE_HEADERS });
  }
}
