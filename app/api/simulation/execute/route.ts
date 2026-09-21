import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { recordRuntimeAudit } from "../../../lib/persistence/audit";
import { calculateApprovedOffer, type CalculationDependencies } from "../../../lib/calculation/engine";
import { ProductionRegulatoryPersistenceBridge } from "../../../lib/regulatory-bridge";
import { ProductionCteRegulatoryRuntimeResolver } from "../../../lib/calculation/regulatory-runtime-resolvers";
import { resolveTrustedElectricityContextFromSourceBill } from "../../../lib/calculation/source-bill-context";
import { resolveBillDrivenExecution, BillDrivenSimulationError, NO_STORE_HEADERS, type BillDrivenExecutionInput } from "../../../lib/calculation/bill-driven";
import { markEligibilityOverrideUsed } from "../../../lib/eligibility/override";

export const runtime = "nodejs";

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new BillDrivenSimulationError(code);
  return value.trim();
}

function executionInput(value: unknown): BillDrivenExecutionInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BillDrivenSimulationError("SIMULATION_REQUEST_INVALID");
  const item = value as Record<string, unknown>;
  const forbidden = ["vector", "customerCategory", "residency", "voltageLevel", "consumption", "supplyPeriod", "sourceBill", "baseline", "f1", "f2", "f3", "smc"];
  if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(item, key))) throw new BillDrivenSimulationError("MANUAL_SIMULATION_INPUT_FORBIDDEN");
  const taxTreatment = item.taxTreatment;
  if (taxTreatment !== "INCLUDED" && taxTreatment !== "EXCLUDED" && taxTreatment !== "NOT_APPLICABLE") throw new BillDrivenSimulationError("TAX_TREATMENT_INVALID");
  const calculationDate = text(item.calculationDate, "CALCULATION_DATE_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calculationDate) || !Number.isFinite(Date.parse(`${calculationDate}T00:00:00.000Z`))) throw new BillDrivenSimulationError("CALCULATION_DATE_INVALID");
  const eligibilityOverrideId = item.eligibilityOverrideId === undefined ? undefined : text(item.eligibilityOverrideId, "OVERRIDE_ID_REQUIRED");
  return { billId: text(item.billId, "SOURCE_BILL_ID_REQUIRED"), billVersionId: text(item.billVersionId, "SOURCE_BILL_VERSION_REQUIRED"), cteId: text(item.cteId, "CTE_ID_REQUIRED"), cteVersionId: text(item.cteVersionId, "CTE_VERSION_REQUIRED"), taxTreatment, calculationDate, ...(eligibilityOverrideId ? { eligibilityOverrideId } : {}) };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "WRITE");
    let body: unknown;
    try { body = await request.json(); } catch { throw new BillDrivenSimulationError("SIMULATION_REQUEST_INVALID"); }
    const input = executionInput(body);
    const repositories = runtimeRepositories();
    const resolved = await resolveBillDrivenExecution(principal, repositories, input);
    let dependencies: CalculationDependencies | undefined;
    if (resolved.simulation.vector === "EE") {
      const trustedElectricityContext = await resolveTrustedElectricityContextFromSourceBill(repositories.billRepository, principal.tenantId, resolved.simulation);
      if (!trustedElectricityContext) throw new BillDrivenSimulationError("REGULATORY_TRUST_CONTEXT_REQUIRED");
      const regulatoryBridge = new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains);
      dependencies = { trustedElectricityContext, regulatoryBridge, regulatoryRuntimeResolver: new ProductionCteRegulatoryRuntimeResolver(regulatoryBridge), regulatoryRefreshState: repositories.regulatoryRefreshState };
    }
    const result = await calculateApprovedOffer(repositories.cteArchiveRepository, repositories.marketArchiveRepository, resolved.simulation, resolved.cte.record.archiveId, dependencies);
    if (result.tenantId !== resolved.binding.tenantId || result.normalizedInput.sourceBill?.billId !== resolved.binding.billId || result.normalizedInput.sourceBill?.version !== resolved.binding.billVersionId || result.sourceCte.versionId !== resolved.binding.selectedCteVersionId) throw new BillDrivenSimulationError("SIMULATION_SOURCE_BINDING_INVALID");
    await repositories.calculationResults.put({ tenantId: principal.tenantId, recordId: result.calculationId, payload: { calculationId: result.calculationId, fingerprint: result.fingerprint, result }, idempotencyKey: result.fingerprint });
    if (resolved.binding.eligibilityOverride) await markEligibilityOverrideUsed(principal, repositories, resolved.binding.eligibilityOverride.overrideId, input.calculationDate);
    await recordRuntimeAudit({ principal, action: "BILL_DRIVEN_CALCULATION", resourceType: "CALCULATION", resourceId: result.calculationId, outcome: "ALLOWED", correlationId: "simulation-bill-driven-v1", metadata: { ...resolved.binding } });
    return Response.json({ result, sourceBinding: resolved.binding }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const code = error instanceof BillDrivenSimulationError ? error.code : error instanceof Error ? error.message : "SIMULATION_EXECUTION_FAILED";
    const status = code.startsWith("AUTHENTICATION") ? 401 : code.includes("DENIED") ? 403 : code.endsWith("NOT_FOUND") ? 404 : code.includes("MISSING") || code.includes("INCOMPATIBLE") || code.includes("EXPIRED") || code.includes("MISMATCH") || code.includes("FORBIDDEN") ? 409 : 400;
    return Response.json({ error: { code, message: code === "SOURCE_BILL_DATA_INSUFFICIENT" ? "Dati insufficienti per la simulazione" : code === "CTE_NOT_COMPATIBLE" ? "Nessuna CTE compatibile disponibile" : "Bill-driven simulation denied" } }, { status, headers: NO_STORE_HEADERS });
  }
}
