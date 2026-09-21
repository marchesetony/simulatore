import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { prepareApprovedOffer, calculatePreparedOffer, evaluateContractualPassThrough } from "../app/lib/calculation/engine.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";

const tenant = "tenant_bta6-pass-through";
const fee = (feeId, amount, unit = "EUR_PER_KWH") => ({ feeId, label: feeId, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const pass = (kind, declarationState, effectiveFrom = "2026-01-01", effectiveTo = "2026-03-01", options = {}) => ({ componentId: `${kind}-${declarationState}-${effectiveFrom}`, kind, declarationState, effectiveFrom, effectiveTo, ...(declarationState === "EXPLICIT_COMPONENT" ? { fee: fee(options.feeId ?? `${kind}-fee`, options.amount ?? 0.01, options.unit ?? "EUR_PER_KWH") } : {}), ...(declarationState === "EXTERNAL_PASS_THROUGH" ? { externalReference: options.externalReference ?? "approved-cte:external" } : {}) });
const baseContract = (components, eligibility = { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] }) => {
  const id = `cte-${Math.random().toString(16).slice(2)}`;
  return {
  ...structuredClone(syntheticElectricityCte),
  tenantId: tenant,
  recordId: id,
  cteId: id,
  supplier: { supplierId: `${id}-supplier`, name: `${id} Supplier` },
  offer: { offerId: `${id}-offer`, name: `${id} Offer`, code: `${id}-CODE` },
  approval: { status: "APPROVED", reviewer: "smoke", reviewedAt: "2026-01-01T00:00:00.000Z", decisionId: "approval" },
  eligibility,
  pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.1, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
  commercialTerms: { fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [], ...(components === undefined ? {} : { passThroughComponents: components }) },
  };
};
const request = (overrides = {}) => parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 600, f2: 300, f3: 100 }, ...overrides }, tenant);
const bta6Context = { vector: "EE", contractedPowerKw: 10, availablePowerKw: 12, supplyUseCategory: "NON_DOMESTIC", domesticResidenceStatus: "NOT_APPLICABLE", voltageLevel: "LV", regulatoryCustomerScope: "NON_DOMESTIC_BT_BTA6", regulatoryPowerBasisKw: 10, regulatoryPowerBasisKind: "CONTRACTED_POWER" };

assert.equal(evaluateContractualPassThrough({ passThroughComponents: undefined }, { periodStart: "2026-01-01", periodEnd: "2026-02-01" }).completeness, "PARTIAL");
assert.equal(evaluateContractualPassThrough({ passThroughComponents: [pass("DISPATCHING", "NOT_DECLARED"), pass("CAPACITY_MARKET", "EXTERNAL_PASS_THROUGH")] }, { periodStart: "2026-01-01", periodEnd: "2026-02-01" }).completeness, "PARTIAL");
assert.equal(evaluateContractualPassThrough({ passThroughComponents: [pass("DISPATCHING", "INCLUDED_IN_ENERGY_PRICE"), pass("CAPACITY_MARKET", "NOT_APPLICABLE")] }, { periodStart: "2026-01-01", periodEnd: "2026-02-01" }).completeness, "COMPLETE");
assert.equal(evaluateContractualPassThrough({ passThroughComponents: [pass("OTHER_CONTRACTUAL_PASS_THROUGH", "EXPLICIT_COMPONENT")] }, { periodStart: "2026-01-01", periodEnd: "2026-02-01" }).completeness, "PARTIAL");

const root = await mkdtemp(path.join(os.tmpdir(), "bta6-pass-through-"));
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  const explicit = [pass("DISPATCHING", "EXPLICIT_COMPONENT", "2026-01-01", "2026-03-01", { amount: 0.01 }), pass("CAPACITY_MARKET", "EXPLICIT_COMPONENT", "2026-01-01", "2026-03-01", { amount: 0.02 })];
  const archive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract(explicit), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const prepared = await prepareApprovedOffer(cteRepository, marketRepository, request(), archive.archiveId);
  const result = await calculatePreparedOffer(request(), prepared, { trustedElectricityContext: bta6Context });
  assert.equal(result.components.filter((component) => component.formulaId === "CONTRACTUAL_PASS_THROUGH_ENERGY_RATE_TIMES_KWH").length, 2);
  assert.equal(result.components.filter((component) => component.formulaId === "CONTRACTUAL_PASS_THROUGH_ENERGY_RATE_TIMES_KWH").reduce((sum, component) => sum + component.amount.minorUnits, 0), 3000);
  assert.equal(result.totalCommercialCost.minorUnits, 13000);
  assert.equal(result.totalRegulatedSubsetCost, null);
  assert.equal(result.contractualPassThroughCompleteness, "COMPLETE");
  assert.equal(result.bta6NetOfTaxCompleteCandidate, false);
  assert.equal(result.components.some((component) => component.category === "REGULATED_ENERGY" && component.label.includes("DISPATCHING")), false);

  const monthlyComponents = [pass("DISPATCHING", "EXPLICIT_COMPONENT", "2026-01-01", "2026-02-01", { amount: 0.01 }), pass("DISPATCHING", "EXPLICIT_COMPONENT", "2026-02-01", "2026-03-01", { amount: 0.02 }), pass("CAPACITY_MARKET", "INCLUDED_IN_ENERGY_PRICE", "2026-01-01", "2026-03-01")];
  const monthlyArchive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract(monthlyComponents), now: "2026-01-03T00:00:00.000Z", actor: "SMOKE" });
  const twoMonthRequest = request({ supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-03-01" }, consumption: { basis: "PERIOD", unit: "KWH", f1: 1000, f2: 500, f3: 500, monthlyProfile: [{ month: "2026-01", f1: 500, f2: 250, f3: 250 }, { month: "2026-02", f1: 500, f2: 250, f3: 250 }] } });
  const monthlyPrepared = await prepareApprovedOffer(cteRepository, marketRepository, twoMonthRequest, monthlyArchive.archiveId);
  const monthlyResult = await calculatePreparedOffer(twoMonthRequest, monthlyPrepared, { trustedElectricityContext: bta6Context });
  assert.equal(monthlyResult.components.filter((component) => component.formulaId === "CONTRACTUAL_PASS_THROUGH_ENERGY_RATE_TIMES_KWH").reduce((sum, component) => sum + component.amount.minorUnits, 0), 3000);
  await assert.rejects(() => calculatePreparedOffer({ ...twoMonthRequest, consumption: { ...twoMonthRequest.consumption, monthlyProfile: undefined } }, monthlyPrepared, { trustedElectricityContext: bta6Context }), /CONTRACTUAL_PASS_THROUGH_PROFILE_REQUIRED/);

  const includedArchive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract([pass("DISPATCHING", "INCLUDED_IN_ENERGY_PRICE"), pass("CAPACITY_MARKET", "NOT_APPLICABLE")]), now: "2026-01-04T00:00:00.000Z", actor: "SMOKE" });
  const includedPrepared = await prepareApprovedOffer(cteRepository, marketRepository, request(), includedArchive.archiveId);
  const includedResult = await calculatePreparedOffer(request(), includedPrepared, { trustedElectricityContext: bta6Context });
  assert.equal(includedResult.components.some((component) => component.formulaId.startsWith("CONTRACTUAL_PASS_THROUGH_")), false);
  assert.equal(includedResult.contractualPassThroughCompleteness, "COMPLETE");

  const monthlyFeeArchive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract([pass("DISPATCHING", "EXPLICIT_COMPONENT", "2026-01-01", "2026-03-01", { amount: 0.5, unit: "EUR_PER_MONTH" }), pass("CAPACITY_MARKET", "NOT_APPLICABLE")]), now: "2026-01-04T12:00:00.000Z", actor: "SMOKE" });
  const monthlyFeePrepared = await prepareApprovedOffer(cteRepository, marketRepository, twoMonthRequest, monthlyFeeArchive.archiveId);
  const monthlyFeeResult = await calculatePreparedOffer(twoMonthRequest, monthlyFeePrepared, { trustedElectricityContext: bta6Context });
  const monthlyFee = monthlyFeeResult.components.find((component) => component.formulaId === "CONTRACTUAL_PASS_THROUGH_MONTHLY_RATE_TIMES_MONTHS");
  assert.equal(monthlyFee?.amount.minorUnits, 100);

  const legacyArchive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract(undefined), now: "2026-01-05T00:00:00.000Z", actor: "SMOKE" });
  const legacyPrepared = await prepareApprovedOffer(cteRepository, marketRepository, request(), legacyArchive.archiveId);
  const legacyResult = await calculatePreparedOffer(request(), legacyPrepared, { trustedElectricityContext: bta6Context });
  assert.equal(legacyResult.contractualPassThroughCompleteness, "PARTIAL");
  assert.equal(legacyResult.bta6NetOfTaxCompleteCandidate, false);

  const domesticRequest = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "RESIDENTIAL", residency: "RESIDENT", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 } }, tenant);
  const domesticArchive = await createCteArchive(cteRepository, { tenantId: tenant, contract: baseContract(explicit, { customerTypes: ["RESIDENTIAL"], voltageLevels: ["LV"] }), now: "2026-01-06T00:00:00.000Z", actor: "SMOKE" });
  const domesticPrepared = await prepareApprovedOffer(cteRepository, marketRepository, domesticRequest, domesticArchive.archiveId);
  const domesticResult = await calculatePreparedOffer(domesticRequest, domesticPrepared, { trustedElectricityContext: { ...bta6Context, regulatoryCustomerScope: "DOMESTIC_RESIDENT_BT", domesticResidenceStatus: "RESIDENT", supplyUseCategory: "DOMESTIC" } });
  assert.equal(domesticResult.components.some((component) => component.formulaId.startsWith("CONTRACTUAL_PASS_THROUGH_")), false);
  assert.equal(domesticResult.contractualPassThroughCompleteness, undefined);
  console.log("BTA6_EXPLICIT_DISPATCH_CAPACITY_COST=PASS");
  console.log("BTA6_INCLUDED_AND_NOT_APPLICABLE_ZERO_EXTRA=PASS");
  console.log("BTA6_NOT_DECLARED_EXTERNAL_PARTIAL=PASS");
  console.log("BTA6_MULTI_PERIOD_PROFILE_REQUIRED=PASS");
  console.log("BTA6_MONTHLY_FEE_MONTH_ALIGNED=PASS");
  console.log("BTA6_COMPONENTS_COMMERCIAL_NOT_REGULATED=PASS");
  console.log("BTA6_CANDIDATE_SERVER_DERIVED=PASS");
  console.log("LEGACY_CTE_BTA6_PARTIAL=PASS");
  console.log("DOMESTIC_CDISPD_PATH_UNCHANGED=PASS");
} finally {
  await rm(root, { recursive: true, force: true });
}
