import { jsonBody, localTenant } from "../../lib/archive/api";
import { calculationError } from "../../lib/calculation/api";
import { calculateApprovedOffer } from "../../lib/calculation/engine";
import { parseSimulationRequest } from "../../lib/calculation/input";
import { LocalCteArchiveRepository } from "../../lib/cte/archive/repository";
import { LocalMarketArchiveRepository } from "../../lib/market/repository";

export const runtime = "nodejs";
const cteRepository = new LocalCteArchiveRepository();
const marketRepository = new LocalMarketArchiveRepository();

export async function POST(request: Request): Promise<Response> {
  try {
    const tenantId = localTenant(request);
    const body = await jsonBody(request);
    if (typeof body.archiveId !== "string" || body.archiveId.trim().length === 0) throw new Error("CTE_ARCHIVE_ID_REQUIRED");
    const simulation = parseSimulationRequest(body.simulation ?? body, tenantId);
    const result = await calculateApprovedOffer(cteRepository, marketRepository, simulation, body.archiveId);
    return Response.json({ result });
  } catch (error) { return calculationError(error); }
}
