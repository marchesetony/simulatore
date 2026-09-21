import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { listBillDrivenSources, NO_STORE_HEADERS } from "../../../lib/calculation/bill-driven";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const sources = await listBillDrivenSources(principal, runtimeRepositories());
    return Response.json({ documents: sources }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SIMULATION_BILL_LIST_UNAVAILABLE";
    const status = code === "SOURCE_BILL_NOT_FOUND" ? 404 : code.startsWith("AUTHENTICATION") ? 401 : code.includes("DENIED") ? 403 : 400;
    return Response.json({ error: { code, message: "Simulation bill sources unavailable" } }, { status, headers: NO_STORE_HEADERS });
  }
}
