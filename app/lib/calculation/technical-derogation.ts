import type { AuthenticatedPrincipal } from "../auth/types";
import type { TaxInclusionState } from "../energy/types";
import type { CalculationResult, SimulationRequest } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { annualConsumptionDetailOf, BillDrivenSimulationError, prepareBillDrivenSimulation, requestFromContext, type BillDrivenRepositories } from "./bill-driven.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { parseSimulationRequest } from "./input.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildOrgChainIndex, membershipPayloads } from "../hierarchy/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { provenanceOf, regulatedCompleteness, technicalTaxes, type ComponentProvenance, type RegulatedCompleteness, type TrustedAsos } from "./technical-quadrature.ts";
import type { ElectricityTaxResult } from "./electricity-taxes";

// Tony (14/11/2026, "Simulazione tecnica in deroga"): the company's Direttore may run a technical simulation with a CTE the
// company assigned and approved that the annual consumption threshold leaves out (Be Relax >1.500 kWh/anno on a customer
// estimated at 192 kWh/anno). Only that threshold is set aside; the CTE stays excluded from ordinary quotes, the engine is
// the usual one, the result is never stored (so no comparison, proposal, sending or approval can start from it) and every
// run is audited.

export const TECHNICAL_DEROGATION_BANNER = "SIMULAZIONE TECNICA FUORI DAI REQUISITI CTE — NON VALIDA COME PROPOSTA COMMERCIALE" as const;
export const TECHNICAL_DEROGATION_REQUIREMENT = "CONSUMPTION_THRESHOLD_MISMATCH" as const;

const fail = (code: string): never => { throw new BillDrivenSimulationError(code); };

/**
 * The company's Direttore, checked on the server: signed in as a manager (ANALYST), with an active SALES_MANAGER membership in
 * this company, and placed in the company's chain at level DIRETTORE right below the company. Only the company administrator
 * can set that level (hierarchy/service.ts saveOrgNode): an Area Manager or an agent cannot give it to themselves.
 */
export async function isCompanyDirector(principal: AuthenticatedPrincipal, repositories: Pick<BillDrivenRepositories, "foundationMemberships" | "orgChain">): Promise<boolean> {
  if (principal.role !== "ANALYST" || !repositories.orgChain) return false;
  const membership = (await membershipPayloads(repositories, principal.tenantId)).find((record) => record.tenantId === principal.tenantId && record.userId === principal.userId && record.status === "ACTIVE");
  if (membership?.role !== "SALES_MANAGER") return false;
  const nodes = (await repositories.orgChain.list(principal.tenantId)).filter((record) => record.tenantId === principal.tenantId);
  const index = buildOrgChainIndex(nodes);
  const node = index.nodes.get(principal.userId)?.payload;
  if (node?.level !== "DIRETTORE" || !node.parentUserId) return false;
  return index.nodes.get(node.parentUserId)?.payload.level === "AZIENDA";
}

export interface TechnicalDerogationInput {
  readonly billId: string;
  readonly billVersionId: string;
  readonly archiveId: string;
  readonly cteVersionId: string;
  readonly taxTreatment: TaxInclusionState;
  readonly calculationDate: string;
  /** Server-side reference date of the quote window; never taken from the client. */
  readonly today?: string;
}

/** What the screen shows: no calculation id or fingerprint, so nothing can refer to it as a commercial calculation. */
export interface TechnicalDerogationResult {
  readonly technical: true;
  readonly banner: typeof TECHNICAL_DEROGATION_BANNER;
  readonly derogatedRequirement: typeof TECHNICAL_DEROGATION_REQUIREMENT;
  readonly billId: string;
  readonly billVersionId: string;
  readonly cte: { readonly archiveId: string; readonly versionId: string; readonly supplier: string; readonly offerName: string; readonly offerCode: string; readonly consumptionRequirement: string | null };
  readonly annualConsumption: { readonly value: number | null; readonly status: string; readonly source: string | null };
  readonly supplyPeriod: CalculationResult["supplyPeriod"];
  readonly taxTreatment: TaxInclusionState;
  /** Each priced line with its formula and inputs (rates, quantities, units: no customer data), so the screen can build the
   *  ARERA scontrino and the analytical detail with the builders of the ordinary quotes (Tony 15/11/2026). */
  readonly components: readonly { readonly label: string; readonly category: string; readonly sign: "CHARGE" | "DISCOUNT"; readonly amount: number; readonly formulaId: string; readonly formulaInputs: CalculationResult["components"][number]["formulaInputs"]; readonly provenance: ComponentProvenance }[];
  readonly totalCommercialCost: number;
  readonly totalCommercialPlusRegulatedSubsetCost: number | null;
  readonly costScope: CalculationResult["costScope"];
  readonly warnings: readonly string[];
  /** Tony (15/11/2026, quadratura autonoma): rete e oneri checked component by component, with the ASOS class basis. */
  readonly regulatedCompleteness: RegulatedCompleteness;
  /** Excise and VAT computed from the law on the simulated consumption and amounts, never from the bill's taxes. */
  readonly taxes: ElectricityTaxResult;
  /** Net of taxes, taxes and total with taxes of the simulation; the total only when everything is determined. */
  readonly totals: { readonly netOfTaxes: number | null; readonly taxes: number | null; readonly withTaxes: number | null };
}

/** The engine's result, with the ASOS class of the trusted supply context it priced on when the caller has it. */
export type TechnicalCalculation = CalculationResult | { readonly result: CalculationResult; readonly asos: TrustedAsos | null };
export type TechnicalCalculator = (simulation: SimulationRequest, cteId: string) => Promise<TechnicalCalculation>;

export async function runTechnicalDerogation(principal: AuthenticatedPrincipal, repositories: BillDrivenRepositories, input: TechnicalDerogationInput, calculate: TechnicalCalculator): Promise<TechnicalDerogationResult> {
  // The CTEs a Direttore may use are the ones the company assigned to them: without the chain stores nothing is derogable.
  if (!repositories.orgChain || !repositories.cteAssignments || !(await isCompanyDirector(principal, repositories))) {
    await audit(principal, input, "DENIED", "TECHNICAL_DEROGATION_DENIED");
    fail("TECHNICAL_DEROGATION_DENIED");
  }
  // Same tenant-scoped preparation as an ordinary quote: approved bill version in the operator's scope, assigned approved CTEs.
  const prepared = await prepareBillDrivenSimulation(principal, repositories, input.billId, input.taxTreatment, input.calculationDate, input.today);
  if (prepared.context.billVersionId !== input.billVersionId) fail("SOURCE_BILL_VERSION_MISMATCH");
  const candidate = prepared.candidates.find((item) => item.archiveId === input.archiveId);
  if (!candidate || candidate.cteVersionId !== input.cteVersionId) fail("TECHNICAL_DEROGATION_CTE_UNAVAILABLE");
  const found = candidate!;
  // Usable in an ordinary quote: nothing to derogate.
  if (found.finalStatus === "ELIGIBLE" || found.finalStatus === "ELIGIBLE_BY_OVERRIDE") fail("TECHNICAL_DEROGATION_NOT_NEEDED");
  // Only the annual consumption threshold: a blocked, inactive, expired or unreviewed CTE, or one left out for any other
  // reason as well (customer type, voltage, condominium), cannot be simulated this way.
  const codes = found.reasonCodes ?? [];
  if (found.finalStatus !== "NOT_ELIGIBLE" || found.calculationReadiness !== "READY" || codes.length !== 1 || codes[0] !== TECHNICAL_DEROGATION_REQUIREMENT) fail("TECHNICAL_DEROGATION_REQUIREMENT_NOT_DEROGABLE");
  const simulation = parseSimulationRequest(requestFromContext(prepared.context, input.taxTreatment, input.calculationDate), principal.tenantId);
  const calculation = await calculate(simulation, found.cteId);
  const result = "result" in calculation ? calculation.result : calculation;
  const trustedAsos = "result" in calculation ? calculation.asos : null;
  if (result.tenantId !== principal.tenantId || result.normalizedInput.sourceBill?.billId !== input.billId || result.normalizedInput.sourceBill.version !== input.billVersionId || result.sourceCte.versionId !== input.cteVersionId) fail("SIMULATION_SOURCE_BINDING_INVALID");
  await audit(principal, input, "ALLOWED");
  const annual = annualConsumptionDetailOf(prepared.context);
  const components = result.components.map((component) => ({ label: component.label, category: component.category, sign: component.sign, amount: component.amount.amount, formulaId: component.formulaId, formulaInputs: component.formulaInputs }));
  const regulated = regulatedCompleteness({ costScope: result.costScope, warnings: result.warnings, components, supplyPeriod: result.supplyPeriod, asos: trustedAsos });
  const netOfTaxes = result.totalCommercialPlusRegulatedSubsetCost?.amount ?? null;
  const consumption = result.normalizedInput.consumption as { readonly f1?: number | null; readonly f2?: number | null; readonly f3?: number | null };
  const bands = result.vector === "EE" && [consumption.f1, consumption.f2, consumption.f3].every((value) => typeof value === "number" && Number.isFinite(value)) ? { f1: consumption.f1 as number, f2: consumption.f2 as number, f3: consumption.f3 as number } : null;
  const taxes = technicalTaxes({ vector: result.vector, taxTreatment: result.taxTreatment, domestic: prepared.context.classification.domestic, resident: prepared.context.classification.resident, committedPowerKw: prepared.context.supply.contractedPowerKw, supplyPeriod: result.supplyPeriod, bands, monthlyProfile: prepared.context.consumption.monthlyProfile, warnings: result.warnings, regulated, totalNetOfTaxes: netOfTaxes });
  const withTaxes = taxes.status === "DETERMINED" && netOfTaxes !== null && taxes.totalTaxes !== null ? Math.round((netOfTaxes + taxes.totalTaxes) * 100) / 100 : null;
  return {
    technical: true, banner: TECHNICAL_DEROGATION_BANNER, derogatedRequirement: TECHNICAL_DEROGATION_REQUIREMENT,
    billId: input.billId, billVersionId: input.billVersionId,
    cte: { archiveId: found.archiveId, versionId: input.cteVersionId, supplier: found.supplier, offerName: found.offer.name, offerCode: found.offer.code, consumptionRequirement: found.scope?.consumption ?? null },
    annualConsumption: { value: annual.value, status: annual.status, source: annual.source },
    supplyPeriod: result.supplyPeriod, taxTreatment: result.taxTreatment,
    components: components.map((component) => ({ ...component, provenance: provenanceOf(component, regulated.asos.basis) })),
    totalCommercialCost: result.totalCommercialCost.amount,
    totalCommercialPlusRegulatedSubsetCost: result.totalCommercialPlusRegulatedSubsetCost?.amount ?? null,
    costScope: result.costScope, warnings: result.warnings,
    regulatedCompleteness: regulated, taxes, totals: { netOfTaxes, taxes: taxes.totalTaxes, withTaxes },
  };
}

// Who, which CTE, which requirement, which bill and when (the audit adds the user and the time): no customer data.
async function audit(principal: AuthenticatedPrincipal, input: TechnicalDerogationInput, outcome: "ALLOWED" | "DENIED", reason?: string): Promise<void> {
  const id = (value: string) => /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : "invalid";
  await recordRuntimeAudit({ principal, action: "TECHNICAL_DEROGATION_SIMULATION", resourceType: "BILL", resourceId: id(input.billId), outcome, correlationId: "technical-derogation-v1", metadata: { billVersionId: id(input.billVersionId), archiveId: id(input.archiveId), cteVersionId: id(input.cteVersionId), derogatedRequirement: TECHNICAL_DEROGATION_REQUIREMENT, ...(reason ? { reason } : {}) } });
}
