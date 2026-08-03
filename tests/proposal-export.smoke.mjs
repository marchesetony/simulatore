import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { syntheticElectricityPun, syntheticGasPsv } from "../app/lib/energy/synthetic-fixtures.ts";
import { createMarketArchive } from "../app/lib/market/service.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { compareApprovedOffers } from "../app/lib/comparison/service.ts";
import { generateProposal } from "../app/lib/proposal/service.ts";
import { exportCsv, exportHtml, exportJson } from "../app/lib/export/serialization.ts";

const tenant = "tenant_proposal-smoke";
const approval = { status: "APPROVED", reviewer: "proposal-smoke", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "proposal-smoke-approval" };
const fee = (feeId, label, amount, unit) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const price = (amount, unit) => ({ amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
function cte(kind, id, options = {}) {
  const base = structuredClone(kind === "EE" ? syntheticElectricityCte : syntheticGasCte);
  const unit = kind === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC";
  return { ...base, recordId: id, cteId: id, tenantId: tenant, approval: options.approval ?? approval, supplier: { supplierId: `${id}-supplier`, name: options.supplierName ?? id }, offer: { offerId: `${id}-offer`, name: id, code: options.offerCode ?? `${id}-CODE` }, eligibility: kind === "EE" ? { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] } : { customerTypes: ["NON_RESIDENTIAL"] }, pricing: options.pricing ?? { mode: "FIXED", reference: "NONE", fixedPrice: price(kind === "EE" ? 0.2 : 0.5, unit), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } }, commercialTerms: { fixedFees: [], variableFees: [fee(`${id}-variable`, "Variable", kind === "EE" ? 0.003 : 0.004, unit)], imbalance: { status: "DECLARED", component: fee(`${id}-imbalance`, "Imbalance", 0.002, unit) }, oneOffFees: [], commercialDiscounts: [fee(`${id}-discount`, "Discount <test>", 0.001, unit)] } };
}
function pun() { return { ...structuredClone(syntheticElectricityPun), tenantId: tenant, recordId: "pun-proposal-2026-01", month: "2026-01", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", publicationDate: "2026-02-01", approval }; }
function psv() { return { ...structuredClone(syntheticGasPsv), tenantId: tenant, recordId: "psv-proposal-2026-01", month: "2026-01", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", publicationDate: "2026-02-01", approval }; }
function eeRequest(extra = {}) { return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 }, ...extra }, tenant); }
function gasRequest() { return parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "GAS", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: true, value: 1.02 } } }, tenant); }
function selectedOffer(calculation) { return { archiveId: calculation.sourceCte.archiveId, cteId: calculation.sourceCte.cteId, versionId: calculation.sourceCte.versionId, version: calculation.sourceCte.version, supplier: calculation.sourceCte.supplier, offerCode: calculation.sourceCte.offerCode }; }
function proposalRequest(calculation, extra = {}) { return { schemaVersion: 1, tenantId: tenant, sourceType: "CALCULATION", calculation, selectedOffer: selectedOffer(calculation), customer: { customerId: "customer-<1>", category: calculation.customerCategory, displayName: "Cliente <Test> & Co" }, supply: { supplyId: "supply-1", pod: "POD-<1>", voltageLevel: calculation.voltageLevel }, proposalIssueDate: "2026-01-16", offerValidity: { periodStart: "2026-01-01", periodEnd: "2026-12-31" }, commercialNotes: "Nota <non trusted>,\ncon testo", requestedExportFormat: "JSON", ...extra }; }

const root = await mkdtemp(path.join(os.tmpdir(), "proposal-export-") );
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  await createMarketArchive(marketRepository, { tenantId: tenant, record: pun(), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  await createMarketArchive(marketRepository, { tenantId: tenant, record: psv(), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const fixed = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-proposal-fixed"), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const indexed = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-proposal-indexed", { pricing: { mode: "INDEXED", reference: "PUN", spread: price(0.01, "EUR_PER_KWH") } }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-proposal-tie", { supplierName: "tie-supplier", offerCode: "TIE", }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const gas = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("GAS", "cte-proposal-gas", { pricing: { mode: "INDEXED", reference: "PSV", spread: price(0.08, "EUR_PER_SMC") } }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const draft = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-proposal-draft", { approval: { status: "DRAFT", reason: "PENDING" } }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const fixedCalculation = await calculateApprovedOffer(cteRepository, marketRepository, eeRequest(), fixed.archiveId);
  const indexedCalculation = await calculateApprovedOffer(cteRepository, marketRepository, eeRequest({ consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 } }), indexed.archiveId);
  const gasCalculation = await calculateApprovedOffer(cteRepository, marketRepository, gasRequest(), gas.archiveId);
  const baselineCalculation = await calculateApprovedOffer(cteRepository, marketRepository, eeRequest({ baseline: { totalCommercialCost: 100, currency: "EUR", taxTreatment: "EXCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } }), fixed.archiveId);

  const fixedProposal = generateProposal(proposalRequest(fixedCalculation), tenant);
  assert.deepEqual(fixedProposal, generateProposal(proposalRequest(fixedCalculation), tenant));
  assert.equal(fixedProposal.baseline, null);
  assert.match(fixedProposal.disclaimer, /Network charges/);
  assert.equal(fixedProposal.marketData.length, 0);
  const indexedProposal = generateProposal(proposalRequest(indexedCalculation), tenant);
  assert.equal(indexedProposal.marketData[0].index, "PUN");
  const gasProposal = generateProposal({ ...proposalRequest(gasCalculation), customer: { customerId: "customer-gas", category: "NON_RESIDENTIAL" }, supply: { supplyId: "supply-gas", pdr: "PDR-1" } }, tenant);
  assert.equal(gasProposal.vector, "GAS");
  assert.equal(gasProposal.units.consumption, "SMC");
  const baselineProposal = generateProposal(proposalRequest(baselineCalculation), tenant);
  assert.ok(baselineProposal.baseline);
  assert.ok(baselineProposal.savings);

  const comparison = await compareApprovedOffers(cteRepository, marketRepository, eeRequest());
  const selected = comparison.results.find((result) => result.sourceCte.archiveId === indexed.archiveId);
  assert.ok(selected);
  const comparisonProposal = generateProposal({ ...proposalRequest(selected, { sourceType: "COMPARISON", comparison, selectedCalculationId: selected.calculationId, requestedExportFormat: "HTML" }), sourceType: "COMPARISON", comparison, selectedCalculationId: selected.calculationId }, tenant);
  assert.equal(comparisonProposal.selectedResult.calculationId, selected.calculationId);
  assert.ok(comparisonProposal.selectedResult.rankingPosition !== null);
  assert.ok(comparison.ranking.some((entry) => entry.tieGroup));

  const json = exportJson(fixedProposal, tenant);
  const csv = exportCsv(fixedProposal, tenant);
  const html = exportHtml(fixedProposal, tenant);
  assert.equal(json.contentType, "application/json; charset=utf-8");
  assert.equal(json.body, exportJson(fixedProposal, tenant).body);
  assert.match(csv.body.split("\r\n")[0], /^rowType,proposalId,tenantId,vector,/);
  assert.match(csv.body, /Discount <test>/);
  assert.match(csv.body, /"Nota <non trusted>, con testo"/);
  assert.match(html.body, /&lt;Test&gt;/);
  assert.doesNotMatch(html.body, /<script|https?:\/\//i);
  assert.match(html.body, /Network charges/);
  assert.match(json.filename, /^commercial-proposal-proposal_[a-f0-9]{32}\.json$/);

  assert.throws(() => generateProposal(proposalRequest({ ...fixedCalculation, fingerprint: "altered" }), tenant), /CALCULATION_FINGERPRINT_MISMATCH/);
  assert.throws(() => generateProposal({ ...proposalRequest(fixedCalculation), selectedOffer: { ...selectedOffer(fixedCalculation), version: "wrong" } }, tenant), /PROPOSAL_OFFER_MISMATCH/);
  assert.throws(() => generateProposal(proposalRequest(fixedCalculation), "tenant_other"), /TENANT_MISMATCH/);
  assert.throws(() => generateProposal({ ...proposalRequest(fixedCalculation), sourceType: "COMPARISON", comparison: { ...comparison, results: [], ranking: [] }, selectedCalculationId: fixedCalculation.calculationId }, tenant), /PROPOSAL_OFFER_EXCLUDED|COMPARISON_FINGERPRINT_MISMATCH/);
  assert.equal(await cteRepository.get(tenant, draft.archiveId) !== null, true);
  console.log("proposal-export smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
