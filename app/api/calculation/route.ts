import { jsonBody } from "../../lib/archive/api";
import { requestPrincipal } from "../../lib/auth/request";
import { calculationError } from "../../lib/calculation/api";
import { calculateApprovedOffer, type CalculationDependencies } from "../../lib/calculation/engine";
import { parseSimulationRequest } from "../../lib/calculation/input";
import { resolveTrustedElectricityContextFromSourceBill } from "../../lib/calculation/source-bill-context";
import { ProductionRegulatoryPersistenceBridge } from "../../lib/regulatory-bridge";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const body = await jsonBody(request);
    if (typeof body.archiveId !== "string" || body.archiveId.trim().length === 0) throw new Error("CTE_ARCHIVE_ID_REQUIRED");
    const simulation = parseSimulationRequest(body.simulation ?? body, tenantId);
    let dependencies: CalculationDependencies | undefined;
    if (simulation.vector === "EE" && simulation.sourceBill) {
      const trustedElectricityContext = await resolveTrustedElectricityContextFromSourceBill(repositories.billRepository, tenantId, simulation);
      if (!trustedElectricityContext) throw new Error("REGULATORY_TRUST_CONTEXT_REQUIRED");
      dependencies = { trustedElectricityContext, regulatoryBridge: new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains) };
    }
    const result = await calculateApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, simulation, body.archiveId, dependencies);
    await repositories.calculationResults.put({ tenantId, recordId: result.calculationId, payload: { calculationId: result.calculationId, fingerprint: result.fingerprint, result }, idempotencyKey: result.fingerprint });
    await recordRuntimeAudit({ principal, action: "CALCULATION", resourceType: "CALCULATION", resourceId: result.calculationId, outcome: "ALLOWED", correlationId: "calculation-v1", metadata: { fingerprint: result.fingerprint } });
    return Response.json({ result });
  } catch (error) { return calculationError(error); }
}
