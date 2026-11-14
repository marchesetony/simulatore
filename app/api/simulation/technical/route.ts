import { jsonBody } from "../../../lib/archive/api";
import { requestPrincipal } from "../../../lib/auth/request";
import { calculationError } from "../../../lib/calculation/api";
import { calculateApprovedOffer, type CalculationDependencies } from "../../../lib/calculation/engine";
import { resolveTrustedElectricityContextWithReason } from "../../../lib/calculation/source-bill-context";
import { ProductionRegulatoryPersistenceBridge } from "../../../lib/regulatory-bridge";
import { ProductionCteRegulatoryRuntimeResolver } from "../../../lib/calculation/regulatory-runtime-resolvers";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { NO_STORE_HEADERS } from "../../../lib/calculation/bill-driven";
import { runTechnicalDerogation } from "../../../lib/calculation/technical-derogation";
import type { TaxInclusionState } from "../../../lib/energy/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Tony (14/11/2026): the Direttore's technical simulation in derogation of the annual consumption threshold. The engine and
// its dependencies are the ones of /api/calculation; unlike it, the result is never saved.
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const body = await jsonBody(request);
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const input = { billId: text(body.billId), billVersionId: text(body.billVersionId), archiveId: text(body.archiveId), cteVersionId: text(body.cteVersionId), taxTreatment: (body.taxTreatment === "INCLUDED" || body.taxTreatment === "NOT_APPLICABLE" ? body.taxTreatment : "EXCLUDED") as TaxInclusionState, calculationDate: new Date().toISOString().slice(0, 10) };
    const result = await runTechnicalDerogation(principal, repositories, input, async (simulation, cteId) => {
      let dependencies: CalculationDependencies | undefined;
      if (simulation.vector === "EE" && simulation.sourceBill) {
        const { context: trustedElectricityContext, reason, currentOffer, billPeakEnergy } = await resolveTrustedElectricityContextWithReason(repositories.billRepository, tenantId, simulation);
        const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains, { readArchiveOncePerRequest: true });
        dependencies = { ...(trustedElectricityContext ? { trustedElectricityContext } : {}), ...(reason ? { regulatedUnavailableReason: reason } : {}), ...(currentOffer ? { currentOffer } : {}), ...(billPeakEnergy ? { billPeakEnergy } : {}), regulatoryBridge, regulatoryRuntimeResolver: new ProductionCteRegulatoryRuntimeResolver(regulatoryBridge), regulatoryRefreshState: repositories.regulatoryRefreshState };
      }
      return calculateApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, simulation, cteId, dependencies);
    });
    return Response.json({ result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const response = calculationError(error);
    const code = error instanceof Error ? error.message : "";
    return code === "TECHNICAL_DEROGATION_DENIED" ? Response.json({ error: { code, message: "Technical simulation denied" } }, { status: 403, headers: NO_STORE_HEADERS }) : response;
  }
}
