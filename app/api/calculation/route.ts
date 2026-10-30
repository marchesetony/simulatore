import { jsonBody } from "../../lib/archive/api";
import { requestPrincipal } from "../../lib/auth/request";
import { calculationError } from "../../lib/calculation/api";
import { calculateApprovedOffer, type CalculationDependencies } from "../../lib/calculation/engine";
import { resolveTrustedElectricityContextWithReason } from "../../lib/calculation/source-bill-context";
import { ProductionRegulatoryPersistenceBridge } from "../../lib/regulatory-bridge";
import { ProductionCteRegulatoryRuntimeResolver } from "../../lib/calculation/regulatory-runtime-resolvers";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";
import { resolveBillDrivenExecution, BillDrivenSimulationError } from "../../lib/calculation/bill-driven";
import { markEligibilityOverrideUsed } from "../../lib/eligibility/override";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const body = await jsonBody(request);
    if (typeof body.archiveId !== "string" || body.archiveId.trim().length === 0) throw new Error("CTE_ARCHIVE_ID_REQUIRED");
    const source = body.sourceBill;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("SOURCE_BILL_REQUIRED");
    const sourceRecord = source as Record<string, unknown>;
    const calculationDate = typeof body.calculationDate === "string" ? body.calculationDate : new Date().toISOString().slice(0, 10);
    const resolved = await resolveBillDrivenExecution(principal, repositories, { billId: typeof sourceRecord.billId === "string" ? sourceRecord.billId : "", billVersionId: typeof sourceRecord.version === "string" ? sourceRecord.version : "", cteId: body.archiveId, cteVersionId: typeof body.cteVersionId === "string" ? body.cteVersionId : "", taxTreatment: body.taxTreatment === "INCLUDED" || body.taxTreatment === "NOT_APPLICABLE" ? body.taxTreatment : "EXCLUDED", calculationDate });
    const simulation = resolved.simulation;
    let dependencies: CalculationDependencies | undefined;
    if (simulation.vector === "EE" && simulation.sourceBill) {
      const { context: trustedElectricityContext, reason, currentOffer } = await resolveTrustedElectricityContextWithReason(repositories.billRepository, tenantId, simulation);
      // Without the bill\'s technical readings the quote runs on commercial costs only (regulated charges skipped).
      const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains, { readArchiveOncePerRequest: true });
      dependencies = { ...(trustedElectricityContext ? { trustedElectricityContext } : {}), ...(reason ? { regulatedUnavailableReason: reason } : {}), ...(currentOffer ? { currentOffer } : {}), regulatoryBridge, regulatoryRuntimeResolver: new ProductionCteRegulatoryRuntimeResolver(regulatoryBridge), regulatoryRefreshState: repositories.regulatoryRefreshState };
    }
    const result = await calculateApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, simulation, resolved.binding.selectedCteId, dependencies);
    if (result.normalizedInput.sourceBill?.billId !== resolved.binding.billId || result.normalizedInput.sourceBill.version !== resolved.binding.billVersionId || result.sourceCte.versionId !== resolved.binding.selectedCteVersionId) throw new BillDrivenSimulationError("SIMULATION_SOURCE_BINDING_INVALID");
    await repositories.calculationResults.put({ tenantId, recordId: result.calculationId, payload: { calculationId: result.calculationId, fingerprint: result.fingerprint, result }, idempotencyKey: result.fingerprint });
    if (resolved.binding.eligibilityOverride) await markEligibilityOverrideUsed(principal, repositories, resolved.binding.eligibilityOverride.overrideId, calculationDate);
    await recordRuntimeAudit({ principal, action: "CALCULATION", resourceType: "CALCULATION", resourceId: result.calculationId, outcome: "ALLOWED", correlationId: "calculation-v1", metadata: { fingerprint: result.fingerprint } });
    return Response.json({ result });
  } catch (error) { return calculationError(error); }
}
