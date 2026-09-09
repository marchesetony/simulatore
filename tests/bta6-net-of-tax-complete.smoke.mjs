import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRegulatoryValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { calculatePreparedOffer, prepareApprovedOffer } from "../app/lib/calculation/engine.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { buildComparisonResult } from "../app/lib/comparison/service.ts";
import { generateProposal } from "../app/lib/proposal/service.ts";
import { exportCsv, exportHtml, exportJson } from "../app/lib/export/serialization.ts";

const tenant = "tenant_bta6-complete-4d2";
const period = { periodStart: "2026-07-01", periodEnd: "2026-08-01" };
const sourceBill = { billId: "bill-bta6-complete", version: "bill-version-1" };
const fee = (feeId, amount, unit = "EUR_PER_KWH") => ({ feeId, label: feeId, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const pass = (kind, declarationState, options = {}) => ({ componentId: options.componentId ?? `${kind}-${declarationState}`, kind, declarationState, effectiveFrom: options.effectiveFrom ?? "2026-01-01", effectiveTo: options.effectiveTo ?? "2027-01-01", ...(declarationState === "EXPLICIT_COMPONENT" ? { fee: fee(options.feeId ?? `${kind}-fee`, options.amount ?? 0.01, options.unit ?? "EUR_PER_KWH") } : {}), ...(declarationState === "EXTERNAL_PASS_THROUGH" ? { externalReference: options.externalReference ?? "approved-cte:external" } : {}) });
const baseContract = (id, passThroughComponents, customerTypes = ["NON_RESIDENTIAL"]) => ({
  ...structuredClone(syntheticElectricityCte), tenantId: tenant, recordId: id, cteId: id,
  supplier: { supplierId: `${id}-supplier`, name: id }, offer: { offerId: `${id}-offer`, name: id, code: `${id}-CODE` },
  approval: { status: "APPROVED", reviewer: "4d2-smoke", reviewedAt: "2026-07-01T00:00:00.000Z", decisionId: `${id}-approval` },
  eligibility: { customerTypes, voltageLevels: ["LV"] },
  pricing: { mode: "FIXED", reference: "NONE", fixedPrice: fee(`${id}-energy`, 0.2), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
  commercialTerms: { fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [], ...(passThroughComponents === undefined ? {} : { passThroughComponents }) },
});
const request = (overrides = {}) => parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-07-15", supplyPeriod: period, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", sourceBill, consumption: { basis: "PERIOD", unit: "KWH", f1: 600, f2: 300, f3: 100 }, ...overrides }, tenant);
const context = (overrides = {}) => ({ vector: "EE", contractedPowerKw: 20, availablePowerKw: 30, supplyUseCategory: "NON_DOMESTIC", domesticResidenceStatus: "NOT_APPLICABLE", voltageLevel: "LV", regulatoryCustomerScope: "NON_DOMESTIC_BT_BTA6", regulatoryPowerBasisKind: "CONTRACTUAL_COMMITTED", regulatoryPowerBasisKw: 20, asosClass: "ASOS_CLASS_1", asosClassTemporalStatus: "VALID", energyIntensiveStatus: "ENERGY_INTENSIVE", ...overrides });
const sourceReference = "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com-TABELLE.xlsx";
const sourceSha256 = "d".repeat(64);
const regulatory = (componentCode, normalizedUnit, normalizedValue, regulatoryVariant) => createRegulatoryValue({ tenantId: tenant, sourceType: "OFFICIAL_ATTACHMENT", sourceReference, officialIdentifier: "227/2026/R/com", publicationDate: "2026-06-25", retrievedAt: "2026-09-09T00:00:00Z", effectiveFrom: "2026-01-01", effectiveTo: null, componentCode, customerScope: "NON_DOMESTIC_BT_BTA6", ...(regulatoryVariant === undefined ? {} : { regulatoryVariant }), originalValue: normalizedValue, originalUnit: normalizedUnit, applicationBasis: "BTA6 complete 4D2 fixture", sourceSha256 });
const regulatoryRecords = [
  regulatory("NETWORK_FIXED", "EUR/POD/YEAR", 5), regulatory("NETWORK_POWER", "EUR/KW/YEAR", 10), regulatory("NETWORK_ENERGY", "EUR/KWH", 0.00066), regulatory("METERING_FIXED", "EUR/POD/YEAR", 19.6826), regulatory("TRANSMISSION_ENERGY", "EUR/KWH", 0.0119),
  regulatory("UC3", "EUR/KWH", 0.00276), regulatory("UC6", "EUR/KWH", 0.00007), regulatory("UC6", "EUR/POD/YEAR", 1.68), regulatory("ARIM", "EUR/POD/YEAR", 3.0276), regulatory("ARIM", "EUR/KW/YEAR", 3.4524), regulatory("ARIM", "EUR/KWH", 0.001614),
  regulatory("ASOS", "EUR/POD/YEAR", 1.5948, "ASOS_CLASS_1"), regulatory("ASOS", "EUR/KW/YEAR", 1.8192, "ASOS_CLASS_1"), regulatory("ASOS", "EUR/KWH", 0.005533, "ASOS_CLASS_1"),
];
const regulatoryBridge = { list: async (_tenant, query) => regulatoryRecords.filter((record) => record.componentCode === query.componentCode && record.customerScope === query.customerScope && record.normalizedUnit === query.normalizedUnit && (query.regulatoryVariant === undefined || record.regulatoryVariant === query.regulatoryVariant)) };
const selectedOffer = (calculation) => ({ archiveId: calculation.sourceCte.archiveId, cteId: calculation.sourceCte.cteId, versionId: calculation.sourceCte.versionId, version: calculation.sourceCte.version, supplier: calculation.sourceCte.supplier, offerCode: calculation.sourceCte.offerCode });
const proposalRequest = (calculation) => ({ schemaVersion: 1, tenantId: tenant, sourceType: "CALCULATION", calculation, selectedOffer: selectedOffer(calculation), customer: { customerId: "bta6-customer", category: "NON_RESIDENTIAL" }, supply: { supplyId: "bta6-supply", pod: "POD-BTA6", voltageLevel: "LV" }, proposalIssueDate: "2026-07-16", offerValidity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, requestedExportFormat: "JSON" });

const root = await mkdtemp(path.join(os.tmpdir(), "bta6-net-complete-"));
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = { async list() { return []; } };
  const calculate = async (id, components, trustedContext = context()) => {
    const archive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract(id, components), now: "2026-07-01T00:00:00.000Z", actor: "4D2_SMOKE" });
    const prepared = await prepareApprovedOffer(cteRepository, marketRepository, request(), archive.archiveId);
    return calculatePreparedOffer(request(), prepared, { trustedElectricityContext: trustedContext, regulatoryBridge });
  };
  const completeA = await calculate("complete-a", [pass("DISPATCHING", "EXPLICIT_COMPONENT", { amount: 0.01 }), pass("CAPACITY_MARKET", "INCLUDED_IN_ENERGY_PRICE")]);
  assert.equal(completeA.bta6NetOfTaxCompleteCandidate, true);
  assert.equal(completeA.costScope, "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE");
  assert.equal(completeA.contractualPassThroughCompleteness, "COMPLETE");
  assert.equal(completeA.totalCommercialCost.minorUnits, 21000);
  assert.equal(completeA.totalRegulatedSubsetCost?.minorUnits, completeA.totalCommercialPlusRegulatedSubsetCost?.minorUnits - completeA.totalCommercialCost.minorUnits);
  assert.equal(completeA.components.filter((component) => component.formulaId === "CONTRACTUAL_PASS_THROUGH_ENERGY_RATE_TIMES_KWH").length, 1);
  assert.equal(completeA.contractualPassThroughStates.find((state) => state.kind === "CAPACITY_MARKET")?.state, "RESOLVED_INCLUDED");
  assert.equal(completeA.warnings.some((warning) => warning.startsWith("REGULATED_SUBSET_PARTIAL_")), false);
  console.log("BTA6_COMPLETE_ECONOMIC_QA=PASS");

  const completeB = await calculate("complete-b", [pass("DISPATCHING", "INCLUDED_IN_ENERGY_PRICE"), pass("CAPACITY_MARKET", "EXPLICIT_COMPONENT", { amount: 0.02 })]);
  assert.equal(completeB.bta6NetOfTaxCompleteCandidate, true);
  assert.equal(completeB.costScope, completeA.costScope);
  assert.equal(completeB.totalRegulatedSubsetCost?.minorUnits, completeA.totalRegulatedSubsetCost?.minorUnits);
  assert.doesNotThrow(() => buildComparisonResult(request(), [completeA, completeB]));
  console.log("BTA6_COMPLETE_CROSS_STRUCTURE_COMPARISON=PASS");

  const partialDispatch = await calculate("partial-dispatch", [pass("DISPATCHING", "EXPLICIT_COMPONENT"), pass("CAPACITY_MARKET", "NOT_DECLARED")]);
  const partialCapacity = await calculate("partial-capacity", [pass("DISPATCHING", "NOT_DECLARED"), pass("CAPACITY_MARKET", "EXPLICIT_COMPONENT")]);
  assert.equal(partialDispatch.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  assert.equal(partialCapacity.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  assert.throws(() => buildComparisonResult(request(), [partialDispatch, partialCapacity]), /COMPARISON_INCOMPATIBLE/);
  console.log("BTA6_PARTIAL_ASYMMETRIC_COVERAGE_BLOCKED=PASS");

  const external = await calculate("external", [pass("DISPATCHING", "EXPLICIT_COMPONENT"), pass("CAPACITY_MARKET", "EXTERNAL_PASS_THROUGH")]);
  assert.equal(external.bta6NetOfTaxCompleteCandidate, false);
  assert.equal(external.contractualPassThroughStates.find((state) => state.kind === "CAPACITY_MARKET")?.state, "UNRESOLVED_EXTERNAL");
  assert.equal(external.components.some((component) => component.componentId.includes("CAPACITY_MARKET")), false);
  const externalProposal = generateProposal(proposalRequest(external), tenant);
  assert.ok(externalProposal.notCalculated.includes("CONTRACTUAL_CAPACITY_MARKET_NOT_QUANTIFIED"));
  assert.equal(externalProposal.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  console.log("BTA6_EXTERNAL_UNRESOLVED_FAILS_COMPLETE=PASS");

  const unknownAsos = await calculate("unknown-asos", [pass("DISPATCHING", "INCLUDED_IN_ENERGY_PRICE"), pass("CAPACITY_MARKET", "NOT_APPLICABLE")], context({ asosClass: "UNKNOWN", energyIntensiveStatus: "UNKNOWN" }));
  assert.equal(unknownAsos.bta6NetOfTaxCompleteCandidate, false);
  assert.equal(unknownAsos.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  console.log("BTA6_ASOS_UNKNOWN_STILL_PARTIAL=PASS");

  const legacy = await calculate("legacy", undefined);
  assert.equal(legacy.bta6NetOfTaxCompleteCandidate, false);
  assert.equal(legacy.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  assert.equal(legacy.contractualPassThroughStates.filter((state) => state.kind === "DISPATCHING" || state.kind === "CAPACITY_MARKET").every((state) => state.state === "UNRESOLVED_NOT_DECLARED"), true);
  console.log("LEGACY_BTA6_STILL_PARTIAL=PASS");

  const proposal = generateProposal(proposalRequest(completeA), tenant);
  assert.equal(proposal.costScope, "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE");
  assert.equal(proposal.contractualPassThrough?.bta6NetOfTaxComplete, true);
  assert.equal(proposal.contractualPassThrough?.completeness, "COMPLETE");
  assert.deepEqual(proposal.notCalculated, ["VAT", "EXCISE", "OTHER_APPLICABLE_TAXES_OR_FISCAL_COMPONENTS"]);
  const json = exportJson(proposal, tenant).body;
  const csv = exportCsv(proposal, tenant).body;
  const html = exportHtml(proposal, tenant).body;
  assert.ok(json.includes("contractualPassThrough"));
  assert.ok(csv.includes("contractualPassThroughCompleteness") && csv.includes("RESOLVED_EXPLICIT"));
  assert.ok(html.includes("Contractual pass-through") && html.includes("CAPACITY_MARKET") && html.includes("RESOLVED_INCLUDED"));
  console.log("BTA6_COMPLETE_PROPOSAL_EXPORT=PASS");
  console.log("BTA6_COMPLETE_NOT_CALCULATED_FISCAL_ONLY=PASS");
  console.log("BTA6_NET_OF_TAX_COMPLETE_SMOKE=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
