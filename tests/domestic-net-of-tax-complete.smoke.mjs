import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { calculateRegulatedEeSubset } from "../app/lib/calculation/regulated-ee.ts";
import { DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS } from "../app/lib/calculation/types.ts";
import { buildComparisonResult, comparisonCostOf } from "../app/lib/comparison/service.ts";
import { calculationPayloadForFingerprint, assertCalculationResult, fingerprint } from "../app/lib/proposal/integrity.ts";
import { generateProposal } from "../app/lib/proposal/service.ts";
import { exportCsv, exportHtml, exportJson } from "../app/lib/export/serialization.ts";
import { EE_FISCAL_EXCLUSION_NOTICE } from "../app/lib/calculation/economic-scope.ts";

const tenant = "tenant_domestic-complete-smoke";
const COMPLETE = "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE";
const PARTIAL = "COMMERCIAL_PLUS_REGULATED_PARTIAL";
const approval = { status: "APPROVED", reviewer: "complete-smoke", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "complete-smoke-approval" };
const price = (amount) => ({ amount, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" });

function request(overrides = {}) {
  return parseSimulationRequest({
    schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15",
    supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED",
    consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 }, ...overrides,
  }, tenant);
}

function cte(id) {
  const base = structuredClone(syntheticElectricityCte);
  return {
    ...base, recordId: id, cteId: id, tenantId: tenant, approval,
    supplier: { supplierId: `${id}-supplier`, name: id }, offer: { offerId: `${id}-offer`, name: id, code: `${id}-CODE` },
    eligibility: { customerTypes: ["RESIDENTIAL"], voltageLevels: ["LV"] },
    pricing: { mode: "FIXED", reference: "NONE", fixedPrice: price(0.2), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
    commercialTerms: { fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [] },
  };
}

const money = (minorUnits) => ({ amount: minorUnits / 100, minorUnits, currency: "EUR" });
function reFingerprint(result) {
  const next = fingerprint(calculationPayloadForFingerprint(result));
  return { ...result, calculationId: `calc_${next.slice(0, 32)}`, fingerprint: next };
}
function scoped(result, costScope, includedComponents, regulatedMinorUnits = includedComponents.length * 100) {
  const regulatedComponents = includedComponents.map((component, index) => ({ componentId: `regulated:test:${component}:${index}`, category: "REGULATED_ENERGY", label: component, sign: "CHARGE", amount: money(100), formulaId: "REGULATED_TEST_RATE_TIMES_KWH", formulaInputs: { component } }));
  return reFingerprint({
    ...result, components: [...result.components, ...regulatedComponents], totalRegulatedSubsetCost: money(regulatedMinorUnits), totalCommercialPlusRegulatedSubsetCost: money(result.totalCommercialCost.minorUnits + regulatedMinorUnits), costScope, regulatedComponentsIncluded: includedComponents, savingsVsBaseline: null, warnings: [],
  });
}
function selectedOffer(calculation) { return { archiveId: calculation.sourceCte.archiveId, cteId: calculation.sourceCte.cteId, versionId: calculation.sourceCte.versionId, version: calculation.sourceCte.version, supplier: calculation.sourceCte.supplier, offerCode: calculation.sourceCte.offerCode }; }
function proposalRequest(calculation, extra = {}) { return { schemaVersion: 1, tenantId: tenant, sourceType: "CALCULATION", calculation, selectedOffer: selectedOffer(calculation), customer: { customerId: "domestic-complete-customer", category: "RESIDENTIAL" }, supply: { supplyId: "domestic-complete-supply", pod: "POD-COMPLETE", voltageLevel: "LV" }, proposalIssueDate: "2026-01-16", offerValidity: { periodStart: "2026-01-01", periodEnd: "2026-12-31" }, requestedExportFormat: "JSON", ...extra }; }

const root = await mkdtemp(path.join(os.tmpdir(), "domestic-net-of-tax-complete-"));
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const archive = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("complete-offer"), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const commercial = await calculateApprovedOffer(cteRepository, { async list() { return []; } }, request(), archive.archiveId);
  const complete = scoped(commercial, COMPLETE, [...DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS]);
  assertCalculationResult(complete, tenant);
  assert.equal(complete.costScope, COMPLETE);
  assert.deepEqual(complete.regulatedComponentsIncluded, [...DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS]);
  assert.equal(complete.totalCommercialCost.minorUnits, commercial.totalCommercialCost.minorUnits);
  assert.equal(complete.totalCommercialPlusRegulatedSubsetCost.minorUnits, commercial.totalCommercialCost.minorUnits + 900);
  assert.equal(comparisonCostOf(complete).comparisonCost.minorUnits, complete.totalCommercialPlusRegulatedSubsetCost.minorUnits);
  assert.equal(complete.taxTreatment, "EXCLUDED");
  console.log("DOMESTIC_COMPLETE_SCOPE_AND_MONEY_INVARIANT=PASS");

  const partial = scoped(commercial, PARTIAL, ["UC3_ENERGY"]);
  assert.throws(() => buildComparisonResult(request(), [complete, partial]), /COMPARISON_INCOMPATIBLE/);
  const secondComplete = reFingerprint({ ...complete, sourceCte: { ...complete.sourceCte, archiveId: "complete-offer-2", cteId: "complete-offer-2", supplier: "complete-offer-2", offerCode: "complete-offer-2-CODE" } });
  const comparison = buildComparisonResult(request(), [complete, secondComplete]);
  assert.equal(comparison.comparisonCostBasis, COMPLETE);
  assert.equal(comparison.ranking.length, 2);
  assert.equal(comparison.ranking[0].comparisonCostBasis, COMPLETE);
  console.log("COMPLETE_PARTIAL_GUARD_AND_COMPLETE_RANKING=PASS");

  const clientClaimedCompleteBaseline = request({ baseline: { totalCommercialCost: 999, comparisonCost: 100, costScope: COMPLETE, currency: "EUR", taxTreatment: "EXCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } });
  assert.equal(clientClaimedCompleteBaseline.baseline.costScope, undefined);
  assert.equal(clientClaimedCompleteBaseline.baseline.comparisonCost, undefined);
  const clientClaimedComplete = scoped({ ...commercial, normalizedInput: clientClaimedCompleteBaseline }, COMPLETE, [...DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS]);
  assert.equal(clientClaimedComplete.savingsVsBaseline, null);
  const unknownBaseline = reFingerprint({ ...scoped({ ...commercial, normalizedInput: request({ baseline: { totalCommercialCost: 999, currency: "EUR", taxTreatment: "EXCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } }) }, COMPLETE, [...DOMESTIC_NET_OF_TAX_COMPLETE_COMPONENTS]), warnings: ["BASELINE_COST_SCOPE_MISMATCH"] });
  assert.equal(unknownBaseline.savingsVsBaseline, null);
  assert.ok(unknownBaseline.warnings.includes("BASELINE_COST_SCOPE_MISMATCH"));
  assert.throws(() => parseSimulationRequest({ ...request(), baseline: { totalCommercialCost: 100, currency: "EUR", taxTreatment: "INCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } }, tenant), /BASELINE_INCOMPATIBLE/);
  console.log("UNTRUSTED_COMPLETE_BASELINE_FAILS_CLOSED=PASS");

  const proposal = generateProposal(proposalRequest(complete), tenant);
  assert.equal(proposal.costScope, COMPLETE);
  assert.equal(proposal.comparisonCost.minorUnits, complete.totalCommercialPlusRegulatedSubsetCost.minorUnits);
  assert.equal(proposal.commercialCost.minorUnits, complete.totalCommercialCost.minorUnits);
  assert.deepEqual(proposal.notCalculated, ["VAT", "EXCISE", "OTHER_APPLICABLE_TAXES_OR_FISCAL_COMPONENTS"]);
  assert.equal(proposal.disclaimer, EE_FISCAL_EXCLUSION_NOTICE);
  assert.ok(exportJson(proposal, tenant).body.includes(COMPLETE));
  assert.ok(exportCsv(proposal, tenant).body.includes(COMPLETE));
  assert.ok(exportHtml(proposal, tenant).body.includes(COMPLETE));
  assert.ok(exportHtml(proposal, tenant).body.includes(EE_FISCAL_EXCLUSION_NOTICE));
  console.log("PROPOSAL_COMPLETE_SCOPE_AND_EXPORTS=PASS");

  const nonResident = scoped({ ...commercial, normalizedInput: parseSimulationRequest({ ...request(), customerCategory: "NON_RESIDENTIAL", residency: undefined }, tenant), customerCategory: "NON_RESIDENTIAL" }, PARTIAL, ["UC3_ENERGY"]);
  assert.notEqual(nonResident.costScope, COMPLETE);
  assert.equal(nonResident.costScope, PARTIAL);
  const missingCdispdRequest = request({ sourceBill: { billId: "bill", version: "version" } });
  const trustedContext = { vector: "EE", contractedPowerKw: 3, availablePowerKw: 4, supplyUseCategory: "DOMESTIC", domesticResidenceStatus: "RESIDENT", voltageLevel: "LV", regulatoryCustomerScope: "DOMESTIC_RESIDENT_BT" };
  await assert.rejects(() => calculateRegulatedEeSubset(missingCdispdRequest, { trustedElectricityContext: trustedContext, regulatoryBridge: { async list() { return []; } } }), /REGULATORY_TIMELINE_GAP/);
  console.log("BTA6_NOT_PROMOTED_AND_MISSING_TIMELINE_FAIL_CLOSED=PASS");
  console.log("domestic-net-of-tax-complete smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
