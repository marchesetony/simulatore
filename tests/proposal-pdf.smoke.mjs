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
import { generateProposal } from "../app/lib/proposal/service.ts";
import { inflateSync } from "node:zlib";
import { exportPdf } from "../app/lib/export/pdf.ts";
import { SYNTHETIC_TENANT_BRANDING } from "../app/lib/branding/service.ts";

const tenant = "tenant_proposal-pdf-smoke";
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


const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Decodes every content stream and returns the hex-encoded Tj operands that the standard fonts write. */
function pageText(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  let content = "";
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const data = Buffer.from(match[1], "latin1");
    try { content += inflateSync(data).toString("latin1"); } catch { content += match[1]; }
  }
  return [...content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((item) => Buffer.from(item[1], "hex").toString("latin1")).join("\n");
}

const root = await mkdtemp(path.join(os.tmpdir(), "proposal-export-") );
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  await createMarketArchive(marketRepository, { tenantId: tenant, record: pun(), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  await createMarketArchive(marketRepository, { tenantId: tenant, record: psv(), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const fixed = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("EE", "cte-proposal-fixed"), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const gas = await createCteArchive(cteRepository, { tenantId: tenant, contract: cte("GAS", "cte-proposal-gas", { pricing: { mode: "INDEXED", reference: "PSV", spread: price(0.08, "EUR_PER_SMC") } }), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const gasCalculation = await calculateApprovedOffer(cteRepository, marketRepository, gasRequest(), gas.archiveId);
  const baselineCalculation = await calculateApprovedOffer(cteRepository, marketRepository, eeRequest({ baseline: { totalCommercialCost: 100, currency: "EUR", taxTreatment: "EXCLUDED", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" } } }), fixed.archiveId);

  const p = generateProposal(proposalRequest(baselineCalculation, { customer: { customerId: "cliente-001", category: "NON_RESIDENTIAL", displayName: "Bar Centrale di Mario Rossi" } }), tenant);
  const g = generateProposal({ ...proposalRequest(gasCalculation), customer: { customerId: "cliente-gas", category: "NON_RESIDENTIAL" }, supply: { supplyId: "supply-gas", pdr: "00881234567890" } }, tenant);
  for (const [label, proposal, service] of [["EE", p, "Energia elettrica"], ["GAS", g, "Gas naturale"]]) {
    const document = await exportPdf(proposal, tenant, SYNTHETIC_TENANT_BRANDING);
    assert.equal(document.format, "PDF");
    assert.equal(document.contentType, "application/pdf");
    assert.match(document.filename, /^proposta-[A-Za-z0-9_-]+\.pdf$/);
    assert.equal(Buffer.from(document.body.subarray(0, 5)).toString("latin1"), "%PDF-");
    const again = await exportPdf(proposal, tenant, SYNTHETIC_TENANT_BRANDING);
    assert.deepEqual(Buffer.from(again.body), Buffer.from(document.body), `${label}: PDF output must be deterministic`);
    const text = pageText(document.body);
    for (const expected of ["Lumenica Energia Demo S.r.l.", "Quota per consumi", "Quota fissa", "315/2024/R/com", service]) assert.ok(text.includes(expected), `${label}: missing ${expected}`);

    const withPng = await exportPdf(proposal, tenant, { ...SYNTHETIC_TENANT_BRANDING, logo: { contentType: "image/png", dataBase64: png.toString("base64"), byteLength: png.length } });
    assert.ok(Buffer.from(withPng.body).toString("latin1").includes("/Subtype /Image"), `${label}: PNG logo must be embedded`);
    const withWebp = await exportPdf(proposal, tenant, { ...SYNTHETIC_TENANT_BRANDING, logo: { contentType: "image/webp", dataBase64: "UklGRgAAAABXRUJQ", byteLength: 12 } });
    assert.ok(!Buffer.from(withWebp.body).toString("latin1").includes("/Subtype /Image"), `${label}: WebP logo is skipped in the PDF`);

    await assert.rejects(() => exportPdf({ ...proposal, proposalFingerprint: "0".repeat(64) }, tenant, null));
    await assert.rejects(() => exportPdf(proposal, "tenant_other", null));
  }
} finally { await rm(root, { recursive: true, force: true }); }

console.log("proposal pdf smoke passed");
