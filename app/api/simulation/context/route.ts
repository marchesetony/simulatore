import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { prepareBillDrivenSimulation, NO_STORE_HEADERS } from "../../../lib/calculation/bill-driven";
import { isCompanyDirector } from "../../../lib/calculation/technical-derogation";

export const runtime = "nodejs";
// The first quote on a new month may download the official GME/ARERA index.
export const maxDuration = 120;

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const url = new URL(request.url);
    const billId = url.searchParams.get("billId") ?? "";
    const taxTreatmentValue = url.searchParams.get("taxTreatment");
    if (taxTreatmentValue !== null && !["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"].includes(taxTreatmentValue)) throw new Error("TAX_TREATMENT_INVALID");
    const taxTreatment = taxTreatmentValue === "INCLUDED" || taxTreatmentValue === "EXCLUDED" || taxTreatmentValue === "NOT_APPLICABLE" ? taxTreatmentValue : undefined;
    const repositories = runtimeRepositories();
    const result = await prepareBillDrivenSimulation(principal, repositories, billId, taxTreatment);
    // Tony (14/11/2026): only the company's Direttore is offered the technical simulation in derogation.
    return Response.json({ ...result, canRunTechnicalDerogation: await isCompanyDirector(principal, repositories) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SIMULATION_CONTEXT_UNAVAILABLE";
    const status = code === "SOURCE_BILL_NOT_FOUND" ? 404 : code.startsWith("AUTHENTICATION") ? 401 : code.includes("DENIED") ? 403 : code.includes("MISSING") || code.includes("INCOMPATIBLE") ? 409 : 400;
    return Response.json({ error: { code, message: "Bill-driven simulation context unavailable" } }, { status, headers: NO_STORE_HEADERS });
  }
}
