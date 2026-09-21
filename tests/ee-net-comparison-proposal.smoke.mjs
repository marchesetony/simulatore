import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { calculationPayloadForFingerprint, fingerprint } from "../app/lib/proposal/integrity.ts";
import { buildComparisonResult, comparisonCostOf } from "../app/lib/comparison/service.ts";
import { generateProposal } from "../app/lib/proposal/service.ts";
import { exportCsv, exportHtml, exportJson } from "../app/lib/export/serialization.ts";
import { EE_FISCAL_EXCLUSION_NOTICE } from "../app/lib/calculation/economic-scope.ts";

const tenant = "tenant_ee-net-scope-smoke";
const approval = { status: "APPROVED", reviewer: "ee-net-scope", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "ee-net-scope-approval" };
const price = (amount, unit, taxTreatment = "EXCLUDED") => ({ amount, currency: "EUR", unit, taxTreatment });
function cte(kind, id, amount, taxTreatment = "EXCLUDED") {
  const base = structuredClone(kind === "EE" ? syntheticElectricityCte : syntheticGasCte);
  const unit = kind === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC";
  return { ...base, recordId: id, cteId: id, tenantId: tenant, approval, supplier: { supplierId: `${id}-supplier`, name: id }, offer: { offerId: `${id}-offer`, name: id, code: `${id}-CODE` }, eligibility: kind === "EE" ? { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] } : { customerTypes: ["NON_RESIDENTIAL"] }, pricing: { mode: "FIXED", reference: "NONE", fixedPrice: price(amount, unit, taxTreatment), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } }, commercialTerms: { fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [] } };
}
function request(overrides = {}) { return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 }, ...overrides }, tenant); }
function money(minorUnits) { return { amount: minorUnits / 100, minorUnits, currency: "EUR" }; }
function reFingerprint(result) { const nextFingerprint = fingerprint(calculationPayloadForFingerprint(result)); return { ...result, calculationId: `calc_${nextFingerprint.slice(0, 32)}`, fingerprint: nextFingerprint }; }
function withRegulated(result, regulatedMinorUnits, includedComponents = ["UC3_ENERGY"]) {
  const component = { componentId: `regulated:test:${result.sourceCte.archiveId}`, category: "REGULATED_ENERGY", label: "Regulated test subset", sign: "CHARGE", amount: money(regulatedMinorUnits), formulaId: "REGULATED_TEST_RATE_TIMES_KWH", formulaInputs: { componentCode: "UC3" } };
  return reFingerprint({ ...result, components: [...result.components, component], totalRegulatedSubsetCost: money(regulatedMinorUnits), totalCommercialPlusRegulatedSubsetCost: money(result.totalCommercialCost.minorUnits + regulatedMinorUnits), costScope: "COMMERCIAL_PLUS_REGULATED_PARTIAL", regulatedComponentsIncluded: includedComponents, savingsVsBaseline: null, warnings: ["REGULATED_SUBSET_PARTIAL_TEST", ...(result.normalizedInput.baseline ? ["BASELINE_COST_SCOPE_MISMATCH"] : [])] });
}
function selectedOffer(calculation) { return { archiveId: calculation.sourceCte.archiveId, cteId: calculation.sourceCte.cteId, versionId: calculation.sourceCte.versionId, version: calculation.sourceCte.version, supplier: calculation.sourceCte.supplier, offerCode: calculation.sourceCte.offerCode }; }
function proposalRequest(calculation) { return { schemaVersion: 1, tenantId: tenant, sourceType: "CALCULATION", calculation, selectedOffer: selectedOffer(calculation), customer: { customerId: "customer-ee-net", category: calculation.customerCategory }, supply: { supplyId: "supply-ee-net", pod: "POD-EE-NET", voltageLevel: calculation.voltageLevel }, proposalIssueDate: "2026-01-16", offerValidity: { periodStart: "2026-01-01", periodEnd: "2026-12-31" }, requestedExportFormat: "JSON" }; }

const root = await mkdtemp(path.join(os.tmpdir(), "ee-net-scope-"));
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const a = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "offer-a", 0.10), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const b = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "offer-b", 0.20), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const gross = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "offer-gross", 0.20, "INCLUDED"), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const aCommercial = await calculateApprovedOffer(cteRepository, { async list() { return []; } }, request(), a.archiveId);
  const bCommercial = await calculateApprovedOffer(cteRepository, { async list() { return []; } }, request(), b.archiveId);
  assert.equal(aCommercial.taxTreatment, "EXCLUDED");
  assert.equal(comparisonCostOf(aCommercial).comparisonCostBasis, "COMMERCIAL_ONLY");
  await assert.rejects(() => calculateApprovedOffer(cteRepository, { async list() { return []; } }, request(), gross.archiveId), /TAX_TREATMENT_INCOMPATIBLE/);
  const extraFiscalRequest = parseSimulationRequest({ ...request(), exciseTaxTreatment: "TAXABLE", vatTreatment: "QUALIFIED_BUSINESS_REDUCED", comparisonCost: money(1) }, tenant);
  assert.equal(Object.prototype.hasOwnProperty.call(extraFiscalRequest, "exciseTaxTreatment"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(extraFiscalRequest, "comparisonCost"), false);
  assert.throws(() => parseSimulationRequest({ ...request(), baseline: { totalCommercialCost: 100, currency: "EUR", taxTreatment: "INCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } }, tenant), /BASELINE_INCOMPATIBLE/);

  const partialA = withRegulated(aCommercial, 5000);
  const partialB = withRegulated(bCommercial, 100);
  const comparison = buildComparisonResult(request(), [partialA, partialB]);
  assert.equal(comparison.comparisonCostBasis, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  assert.equal(comparison.taxTreatment, "EXCLUDED");
  assert.equal(comparison.fiscalExclusionNotice, EE_FISCAL_EXCLUSION_NOTICE);
  assert.equal(comparison.ranking[0].calculationId, partialB.calculationId, "ranking must use comparison cost, not commercial cost");
  assert.equal(comparison.ranking[0].comparisonCost.minorUnits, partialB.totalCommercialPlusRegulatedSubsetCost.minorUnits);
  assert.equal(comparison.ranking[0].comparisonCostBasis, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  assert.deepEqual(comparison.ranking[0].regulatedComponentsIncluded, ["UC3_ENERGY"]);
  const tie = reFingerprint({ ...partialB, sourceCte: { ...partialB.sourceCte, archiveId: "offer-tie", cteId: "offer-tie", supplier: "offer-tie", offerCode: "offer-tie-CODE" } });
  const tieComparison = buildComparisonResult(request(), [partialB, tie]);
  assert.equal(tieComparison.ranking[0].rank, tieComparison.ranking[1].rank);
  assert.equal(tieComparison.ranking[0].tieGroup, tieComparison.ranking[1].tieGroup);
  assert.throws(() => buildComparisonResult(request(), [partialA, bCommercial]), /COMPARISON_INCOMPATIBLE/);
  assert.throws(() => buildComparisonResult(request(), [partialA, withRegulated(bCommercial, 100, ["UC6_ENERGY"])]), /COMPARISON_INCOMPATIBLE/);
  console.log("EE_PARTIAL_REGULATED_COMPARISON=PASS");
  console.log("COMPARISON_COST_RANKING_AND_TIE=PASS");
  console.log("MIXED_COMPLETENESS_FAIL_CLOSED=PASS");

  const baselinePartial = withRegulated(await calculateApprovedOffer(cteRepository, { async list() { return []; } }, request({ baseline: { totalCommercialCost: 100, currency: "EUR", taxTreatment: "EXCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } }), a.archiveId), 5000);
  assert.equal(baselinePartial.savingsVsBaseline, null);
  assert.ok(baselinePartial.warnings.includes("BASELINE_COST_SCOPE_MISMATCH"));
  const proposal = generateProposal(proposalRequest(partialA), tenant);
  assert.equal(proposal.comparisonCost.minorUnits, partialA.totalCommercialPlusRegulatedSubsetCost.minorUnits);
  assert.equal(proposal.commercialCost.minorUnits, partialA.totalCommercialCost.minorUnits);
  assert.equal(proposal.costScope, "COMMERCIAL_PLUS_REGULATED_PARTIAL");
  assert.deepEqual(proposal.regulatedComponentsIncluded, ["UC3_ENERGY"]);
  assert.equal(proposal.disclaimer, EE_FISCAL_EXCLUSION_NOTICE);
  assert.ok(proposal.notCalculated.includes("VAT"));
  assert.ok(proposal.notCalculated.includes("EXCISE"));
  assert.ok(proposal.notCalculated.includes("OTHER_APPLICABLE_TAXES_OR_FISCAL_COMPONENTS"));
  assert.ok(proposal.notCalculated.includes("REGULATED_COMPONENTS_NOT_INCLUDED_IN_CURRENT_SCOPE"));
  assert.equal(proposal.notCalculated.includes("REGULATED_CHARGES"), false);
  const json = exportJson(proposal, tenant);
  const csv = exportCsv(proposal, tenant);
  const html = exportHtml(proposal, tenant);
  assert.ok(json.body.includes(EE_FISCAL_EXCLUSION_NOTICE));
  assert.ok(csv.body.includes(EE_FISCAL_EXCLUSION_NOTICE));
  assert.ok(html.body.includes(EE_FISCAL_EXCLUSION_NOTICE));
  assert.throws(() => exportJson({ ...proposal, comparisonCost: money(1) }, tenant), /PROPOSAL_FINGERPRINT_MISMATCH|PROPOSAL_SNAPSHOT_INVALID/);
  console.log("PROPOSAL_COST_SCOPE_AND_DISCLAIMER=PASS");
  console.log("JSON_CSV_HTML_DISCLAIMER=PASS");
  console.log("BASELINE_COST_MISMATCH_FAIL_CLOSED=PASS");

  const gas = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("GAS", "gas-offer", 0.50), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const gasRequest = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "GAS", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: false } } }, tenant);
  const gasResult = await calculateApprovedOffer(cteRepository, { async list() { return []; } }, gasRequest, gas.archiveId);
  assert.equal(gasResult.vector, "GAS");
  assert.equal(comparisonCostOf(gasResult).comparisonCostBasis, "COMMERCIAL_ONLY");
  console.log("GAS_UNCHANGED=PASS");
  console.log("ee-net-comparison-proposal smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
