import { jsonBody } from "../../lib/archive/api";
import { requestPrincipal } from "../../lib/auth/request";
import { calculationError } from "../../lib/calculation/api";
import { resolveTrustedElectricityContextFromSourceBill } from "../../lib/calculation/source-bill-context";
import { ProductionRegulatoryPersistenceBridge } from "../../lib/regulatory-bridge";
import { ProductionCteRegulatoryRuntimeResolver } from "../../lib/calculation/regulatory-runtime-resolvers";
import { compareApprovedOffers } from "../../lib/comparison/service";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../lib/persistence/audit";
import { prepareBillDrivenSimulation, resolveBillDrivenExecution } from "../../lib/calculation/bill-driven";
import { markEligibilityOverrideUsed } from "../../lib/eligibility/override";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    const tenantId = principal.tenantId;
    const repositories = runtimeRepositories();
    const body = await jsonBody(request);
    const source = body.sourceBill;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("SOURCE_BILL_REQUIRED");
    const sourceRecord = source as Record<string, unknown>;
    const billId = typeof sourceRecord.billId === "string" ? sourceRecord.billId : "";
    const prepared = await prepareBillDrivenSimulation(principal, repositories, billId);
    const requestedCteId = typeof body.cteId === "string" ? body.cteId : null;
    const candidate = requestedCteId
      ? prepared.candidates.find((item) => (item.archiveId === requestedCteId || item.cteId === requestedCteId) && (item.finalStatus === "ELIGIBLE" || item.finalStatus === "ELIGIBLE_BY_OVERRIDE"))
      : prepared.candidates.find((item) => item.finalStatus === "ELIGIBLE");
    if (!candidate || !candidate.cteVersionId) throw new Error("CTE_NOT_COMPATIBLE");
    const requestedCteVersionId = typeof body.cteVersionId === "string" ? body.cteVersionId : candidate.cteVersionId;
    const requestedOverrideId = typeof body.eligibilityOverrideId === "string" ? body.eligibilityOverrideId : undefined;
    const resolved = await resolveBillDrivenExecution(principal, repositories, { billId, billVersionId: typeof sourceRecord.version === "string" ? sourceRecord.version : "", cteId: candidate.archiveId, cteVersionId: requestedCteVersionId, taxTreatment: "EXCLUDED", calculationDate: new Date().toISOString().slice(0, 10), ...(requestedOverrideId ? { eligibilityOverrideId: requestedOverrideId } : {}) });
    const parsedSimulation = resolved.simulation;
    let dependencies;
    if (parsedSimulation.vector === "EE" && parsedSimulation.sourceBill) {
      const trustedElectricityContext = await resolveTrustedElectricityContextFromSourceBill(repositories.billRepository, tenantId, parsedSimulation);
      if (!trustedElectricityContext) throw new Error("REGULATORY_TRUST_CONTEXT_REQUIRED");
      const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains);
      dependencies = { trustedElectricityContext, regulatoryBridge, regulatoryRuntimeResolver: new ProductionCteRegulatoryRuntimeResolver(regulatoryBridge), regulatoryRefreshState: repositories.regulatoryRefreshState };
    }
    const result = await compareApprovedOffers(repositories.cteArchiveRepository, repositories.marketArchiveRepository, parsedSimulation, dependencies);
    await repositories.comparisonResults.put({ tenantId, recordId: result.comparisonId, payload: { comparisonId: result.comparisonId, fingerprint: result.fingerprint, result }, idempotencyKey: result.fingerprint });
    if (resolved.binding.eligibilityOverride) await markEligibilityOverrideUsed(principal, repositories, resolved.binding.eligibilityOverride.overrideId, new Date().toISOString().slice(0, 10));
    await recordRuntimeAudit({ principal, action: "COMPARISON", resourceType: "COMPARISON", resourceId: result.comparisonId, outcome: "ALLOWED", correlationId: "comparison-v1", metadata: { fingerprint: result.fingerprint } });
    return Response.json({ result });
  } catch (error) { return calculationError(error); }
}
