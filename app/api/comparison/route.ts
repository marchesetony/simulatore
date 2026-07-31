import { jsonBody, localTenant } from "../../lib/archive/api";
import { calculationError } from "../../lib/calculation/api";
import { parseSimulationRequest } from "../../lib/calculation/input";
import { LocalCteArchiveRepository } from "../../lib/cte/archive/repository";
import { LocalMarketArchiveRepository } from "../../lib/market/repository";
import { compareApprovedOffers } from "../../lib/comparison/service";

export const runtime = "nodejs";
const cteRepository = new LocalCteArchiveRepository();
const marketRepository = new LocalMarketArchiveRepository();

export async function POST(request: Request): Promise<Response> {
  try {
    const tenantId = localTenant(request);
    const body = await jsonBody(request);
    const simulation = parseSimulationRequest(body.simulation ?? body, tenantId);
    const result = await compareApprovedOffers(cteRepository, marketRepository, simulation);
    return Response.json({ result });
  } catch (error) { return calculationError(error); }
}
