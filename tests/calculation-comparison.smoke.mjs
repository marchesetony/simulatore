import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { syntheticElectricityPun, syntheticGasPsv } from "../app/lib/energy/synthetic-fixtures.ts";
import { createMarketArchive, queryApprovedHistoricalMarketData } from "../app/lib/market/service.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { atomicWriteJson, readJsonFile } from "../app/lib/archive/atomic.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { compareApprovedOffers } from "../app/lib/comparison/service.ts";

const tenant = "tenant_calculation-smoke";
const otherTenant = "tenant_other-smoke";
const approval = { status: "APPROVED", reviewer: "smoke-reviewer", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "smoke-approval" };
const fee = (feeId, label, amount, unit) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const price = (amount, unit) => ({ amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const nextMonth = (month) => { const [year, number] = month.split("-").map(Number); return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10); };

function cte(kind, id, options = {}) {
  const base = structuredClone(kind === "EE" ? syntheticElectricityCte : syntheticGasCte);
  const unit = kind === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC";
  const pricing = options.pricing ?? (kind === "EE"
    ? { mode: "FIXED", reference: "NONE", fixedPrice: price(0.2, unit), spread: { status: "DECLARED", component: fee(`${id}-spread`, "Spread", 0.01, unit) } }
    : { mode: "FIXED", reference: "NONE", fixedPrice: price(0.5, unit), spread: { status: "DECLARED", component: fee(`${id}-spread`, "Spread", 0.02, unit) } });
  const imbalance = options.imbalance ?? { status: "DECLARED", component: fee(`${id}-imbalance`, "Imbalance", kind === "EE" ? 0.002 : 0.003, unit) };
  return {
    ...base,
    recordId: id,
    cteId: id,
    tenantId: options.tenantId ?? tenant,
    approval: options.approval ?? approval,
    supplier: { supplierId: `${id}-supplier`, name: options.supplierName ?? `${id} Supplier` },
    offer: { offerId: `${id}-offer`, name: `${id} Offer`, code: options.offerCode ?? `${id}-CODE` },
    validity: options.validity ?? { periodStart: "2026-01-01", periodEnd: "2027-01-01" },
    expiry: options.expiry ?? { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
    eligibility: options.eligibility ?? (kind === "EE" ? { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] } : { customerTypes: ["NON_RESIDENTIAL"] }),
    pricing,
    commercialTerms: {
      fixedFees: options.fixedFees ?? [fee(`${id}-fixed`, "Fixed monthly fee", kind === "EE" ? 4 : 5, "EUR_PER_MONTH")],
      variableFees: options.variableFees ?? [fee(`${id}-variable`, "Variable fee", kind === "EE" ? 0.003 : 0.004, unit)],
      imbalance,
      oneOffFees: options.oneOffFees ?? [fee(`${id}-oneoff`, "Activation", 2, "EUR_PER_CONTRACT")],
      commercialDiscounts: options.discounts ?? [fee(`${id}-discount`, "Discount", kind === "EE" ? 0.001 : 0.002, unit)],
    },
  };
}

function pun(month, id = `pun-${month}`) {
  return { ...structuredClone(syntheticElectricityPun), tenantId: tenant, recordId: id, version: "1", month, effectiveFrom: `${month}-01`, effectiveTo: nextMonth(month), publicationDate: nextMonth(month), approval };
}
function psv(month, id = `psv-${month}`) {
  return { ...structuredClone(syntheticGasPsv), tenantId: tenant, recordId: id, version: "1", month, effectiveFrom: `${month}-01`, effectiveTo: nextMonth(month), publicationDate: nextMonth(month), approval };
}
async function addMarket(repository, record) { return createMarketArchive(repository, { tenantId: tenant, record, now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" }); }
function eeRequest(overrides = {}) {
  return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 }, ...overrides }, tenant);
}
function gasRequest(overrides = {}) {
  return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "GAS", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: true, value: 1.02 } }, ...overrides }, tenant);
}

const root = await mkdtemp(path.join(os.tmpdir(), "calculation-comparison-")).catch((error) => { throw error; });
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  await addMarket(marketRepository, pun("2026-01"));
  await addMarket(marketRepository, pun("2026-02"));
  await addMarket(marketRepository, psv("2026-01"));
  await addMarket(marketRepository, psv("2026-02"));

  const fixedEe = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-ee-fixed"), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const indexedEe = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-ee-indexed", { pricing: { mode: "INDEXED", reference: "PUN", spread: price(0.01, "EUR_PER_KWH") } }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const fixedGas = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("GAS", "cte-gas-fixed"), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const indexedGas = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("GAS", "cte-gas-indexed", { pricing: { mode: "INDEXED", reference: "PSV", spread: price(0.08, "EUR_PER_SMC") } }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });

  const fixedEeResult = await calculateApprovedOffer(cteRepository, marketRepository, eeRequest(), fixedEe.archiveId);
  assert.equal(fixedEeResult.vector, "EE");
  assert.equal(fixedEeResult.totalCommercialCost.currency, "EUR");
  assert.ok(fixedEeResult.components.some((component) => component.formulaId === "EE_FIXED_PRICE_TIMES_KWH"));
  assert.deepEqual(fixedEeResult, await calculateApprovedOffer(cteRepository, marketRepository, eeRequest(), fixedEe.archiveId), "calculation must be reproducible");

  const indexedEeRequest = eeRequest({ supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-03-01" }, consumption: { basis: "PERIOD", unit: "KWH", f1: 300, f2: 100, f3: 100, monthlyProfile: [{ month: "2026-01", f1: 150, f2: 50, f3: 25 }, { month: "2026-02", f1: 150, f2: 50, f3: 75 }] } });
  const indexedEeResult = await calculateApprovedOffer(cteRepository, marketRepository, indexedEeRequest, indexedEe.archiveId);
  assert.equal(indexedEeResult.marketData.length, 2);
  assert.equal(indexedEeResult.components.filter((component) => component.formulaId === "EE_PUN_MWH_TO_KWH_PLUS_SPREAD").length, 6);

  const fixedGasResult = await calculateApprovedOffer(cteRepository, marketRepository, gasRequest(), fixedGas.archiveId);
  assert.ok(fixedGasResult.components.some((component) => component.formulaId === "GAS_FIXED_PRICE_TIMES_SMC"));
  const indexedGasRequest = gasRequest({ supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-03-01" }, consumption: { basis: "PERIOD", unit: "SMC", smc: 100, monthlyProfile: [{ month: "2026-01", smc: 60 }, { month: "2026-02", smc: 40 }], correctionCoefficient: { required: true, value: 1.02 } } });
  const indexedGasResult = await calculateApprovedOffer(cteRepository, marketRepository, indexedGasRequest, indexedGas.archiveId);
  assert.equal(indexedGasResult.marketData.length, 2);
  assert.equal(indexedGasResult.components.filter((component) => component.formulaId === "GAS_PSV_PLUS_SPREAD_TIMES_SMC").length, 2);

  assert.throws(() => parseSimulationRequest({ ...eeRequest(), tenantId: otherTenant }, tenant), /TENANT_MISMATCH/);
  assert.equal(await cteRepository.get(otherTenant, fixedEe.archiveId), null);
  assert.throws(() => parseSimulationRequest({ ...eeRequest(), vector: "GAS", voltageLevel: undefined, consumption: { basis: "PERIOD", unit: "KWH", f1: 1, f2: 0, f3: 0 } }, tenant), /UNIT_MISMATCH|CONSUMPTION_INVALID/);
  await assert.rejects(() => calculateApprovedOffer(cteRepository, marketRepository, eeRequest(), indexedGas.archiveId), /VECTOR_MISMATCH/);
  await assert.rejects(() => calculateApprovedOffer(cteRepository, new LocalMarketArchiveRepository(path.join(root, "missing-market")), indexedEeRequest, indexedEe.archiveId), /MARKET_DATA_MISSING/);
  assert.throws(() => gasRequest({ consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: true } } }), /CORRECTION_COEFFICIENT_REQUIRED/);
  assert.throws(() => eeRequest({ consumption: { basis: "PERIOD", unit: "KWH", f1: 0.1, f2: 0.2, f3: 0.3, monthlyProfile: [{ month: "2026-01", f1: 0.1, f2: 0.2, f3: 0.2 }] } }), /PROFILE_TOTAL_MISMATCH/);

  await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-ee-tie-a", { pricing: { mode: "FIXED", reference: "NONE", fixedPrice: price(0.2, "EUR_PER_KWH"), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } }, fixedFees: [], variableFees: [], oneOffFees: [], discounts: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, supplierName: "Tie A", offerCode: "TIE-A" }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-ee-tie-b", { pricing: { mode: "FIXED", reference: "NONE", fixedPrice: price(0.2, "EUR_PER_KWH"), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } }, fixedFees: [], variableFees: [], oneOffFees: [], discounts: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, supplierName: "Tie B", offerCode: "TIE-B" }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const draft = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-ee-draft", { approval: { status: "DRAFT", reason: "PENDING" }, supplierName: "Draft", offerCode: "DRAFT" }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const voltage = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-ee-mv", { eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["MV"] }, supplierName: "MV only", offerCode: "MV" }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const comparison = await compareApprovedOffers(cteRepository, marketRepository, eeRequest());
  assert.ok(comparison.results.length >= 3);
  assert.ok(comparison.excludedOffers.some((offer) => offer.archiveId === draft.archiveId && offer.code === "CTE_NOT_APPROVED"));
  assert.ok(comparison.excludedOffers.some((offer) => offer.archiveId === voltage.archiveId && offer.code === "VOLTAGE_NOT_ELIGIBLE"));
  const tieRanks = comparison.ranking.filter((entry) => entry.offerCode === "TIE-A" || entry.offerCode === "TIE-B");
  assert.equal(tieRanks.length, 2);
  assert.equal(tieRanks[0].rank, tieRanks[1].rank);
  assert.equal(tieRanks[0].tieGroup, tieRanks[1].tieGroup);

  const immutable = structuredClone(await cteRepository.get(tenant, fixedEe.archiveId));
  immutable.history[0].reason = "tampered";
  await assert.rejects(() => cteRepository.save(immutable), /ARCHIVE_HISTORY_IMMUTABLE/);
  await assert.rejects(() => createMarketArchive(marketRepository, { tenantId: tenant, record: { ...pun("2026-01", "pun-conflicting"), version: "1" }, now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" }), /MARKET_APPROVED_DUPLICATE/);
  const historical = await queryApprovedHistoricalMarketData(marketRepository, tenant, "2026-02-15", "EE");
  assert.equal(historical[0].month, "2026-02");

  const atomicFile = path.join(root, "atomic", "data.json");
  await atomicWriteJson(atomicFile, { stable: true });
  await writeFile(`${atomicFile}.${process.pid}.${Date.now()}.tmp`, "interrupted", "utf8");
  assert.deepEqual(await readJsonFile(atomicFile, {}), { stable: true });
  console.log("calculation-comparison smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
