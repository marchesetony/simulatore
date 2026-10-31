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
import { exportPdf } from "../app/lib/export/pdf.ts";
import { renderReceiptProposal } from "../app/lib/export/receipt-pdf.ts";
import { fallbackPresentation, parseProposalPresentation, presentationMatches } from "../app/lib/proposal/presentation.ts";
import { COMPANY_LOGO_MAX_BYTES, jpegSize, parseCompanyProfile } from "../app/lib/company/profile.ts";
import { EE_FISCAL_EXCLUSION_NOTICE } from "../app/lib/calculation/economic-scope.ts";

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
  assert.equal(fixedProposal.disclaimer, EE_FISCAL_EXCLUSION_NOTICE);
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
  const pdf = exportPdf(fixedProposal, tenant);
  assert.equal(json.contentType, "application/json; charset=utf-8");
  assert.equal(json.body, exportJson(fixedProposal, tenant).body);
  assert.match(csv.body.split("\r\n")[0], /^rowType,proposalId,tenantId,vector,/);
  assert.match(csv.body, /Discount <test>/);
  assert.match(csv.body, /"Nota <non trusted>, con testo"/);
  assert.match(html.body, /&lt;Test&gt;/);
  assert.doesNotMatch(html.body, /<script|https?:\/\//i);
  assert.ok(html.body.includes(EE_FISCAL_EXCLUSION_NOTICE));
  assert.match(json.filename, /^commercial-proposal-proposal_[a-f0-9]{32}\.json$/);
  assert.equal(pdf.contentType, "application/pdf");
  assert.match(pdf.filename, /^commercial-proposal-proposal_[a-f0-9]{32}\.pdf$/);
  assert.ok(pdf.body instanceof Uint8Array);
  const pdfText = Buffer.from(pdf.body).toString("latin1");
  const normalizedPdfText = pdfText.replace(/\s+/g, " ");
  assert.ok(pdfText.startsWith("%PDF-1.4"));
  assert.ok(pdfText.includes("Commercial proposal"));
  assert.ok(pdfText.includes(fixedProposal.proposalId));
  assert.ok(pdfText.includes(fixedProposal.selectedOffer.supplier));
  assert.ok(normalizedPdfText.includes("I valori indicati sono calcolati al netto"));
  assert.ok(normalizedPdfText.includes("Tali importi non sono inclusi nella simulazione"));
  assert.ok(normalizedPdfText.includes("confronto"));
  assert.ok(normalizedPdfText.includes("delle offerte."));
  assert.deepEqual(pdf.body, exportPdf(fixedProposal, tenant).body);

  // Tony (31/10): "l'offerta deve essere formulata come una bolletta come lo scontrino elettrico, con logo dell'azienda dati
  // aziendali percentuale e importo di risparmio annuale e mensile, oltre al nome della cte utilizzata e a uno specchietto che
  // paragona l'offerta alla bolletta che è stata simulata" + "in lingua italiana".
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegSize(jpeg), { width: 64, height: 32, components: 3 });
  assert.equal(jpegSize(Buffer.from("not a jpeg")), null);
  const profile = parseCompanyProfile({ name: "  Energia   Demo S.r.l. ", address: "Via Roma 1, Milano", vatNumber: "IT00000000000", phone: "02 000000", email: "info@example.test", website: "example.test", logo: "data:image/jpeg;base64," + jpeg.toString("base64") }, "2026-10-31T00:00:00.000Z");
  assert.equal(profile.name, "Energia Demo S.r.l.");
  assert.throws(() => parseCompanyProfile({ logo: "data:image/png;base64,AAAA" }, "x"), /COMPANY_LOGO_INVALID/);
  assert.throws(() => parseCompanyProfile({ logo: "data:image/jpeg;base64," + Buffer.alloc(COMPANY_LOGO_MAX_BYTES + 10, 0xff).toString("base64") }, "x"), /COMPANY_LOGO_TOO_LARGE/);
  assert.throws(() => parseCompanyProfile({ name: "x".repeat(500) }, "x"), /COMPANY_PROFILE_TOO_LONG/);
  const screen = parseProposalPresentation({
    customerName: "Cliente prova", supplyLabel: "POD IT001E000000", billSupplier: "Fornitore attuale", billOfferName: "Offerta attuale",
    offerSupplier: fixedProposal.selectedOffer.supplier, offerName: "Offerta Luce Prova", offerCode: fixedProposal.selectedOffer.offerCode,
    periodLabel: "01/09/2026 - 30/09/2026", consumptionLabel: "1.000 kWh", taxesIncluded: false, sameOffer: false,
    currentTotal: 250, offerTotal: 200, savings: 50, savingsPercent: 20, annualSaving: 600, annualCurrent: 3000, annualBasisLabel: "12 mesi",
    validUntil: "2026-12-31", rows: [{ label: "Spesa per la materia energia", current: 180, offer: 130, difference: -50, detail: false }],
    comparison: [{ label: "Prezzo energia", bill: "0,180 €/kWh", offer: "PUN + 0,020 €/kWh" }], excluded: [],
  });
  assert.equal(presentationMatches(screen, fixedProposal), true);
  assert.equal(presentationMatches({ ...screen, offerSupplier: "Altro fornitore" }, fixedProposal), false);
  assert.throws(() => parseProposalPresentation({ currentTotal: "tanto" }), /PROPOSAL_PRESENTATION_INVALID/);
  const receipt = Buffer.from(renderReceiptProposal(fixedProposal, screen, profile)).toString("latin1");
  assert.ok(receipt.startsWith("%PDF-1.4"));
  const plain = receipt.replace(/\\([()\\])/g, "$1").toUpperCase();
  for (const expected of ["PROPOSTA COMMERCIALE", "Energia Demo S.r.l.", "IT00000000000", "Offerta Luce Prova", "Scontrino dell'energia", "Risparmio annuo", "Risparmio mensile", "Confronto tra l'offerta e la bolletta simulata", "Bolletta attuale", "Nuova offerta"]) assert.ok(plain.includes(expected.toUpperCase()), expected);
  assert.ok(receipt.includes("/Subtype /Image") && receipt.includes("/DCTDecode"), "logo embedded");
  assert.ok(!/Commercial proposal|Savings|Offer/.test(receipt.replace(/Offerta/g, "")), "only Italian text");
  const fallback = Buffer.from(renderReceiptProposal(fixedProposal, fallbackPresentation(fixedProposal), null)).toString("latin1");
  assert.ok(fallback.includes("PROPOSTA COMMERCIALE") && !fallback.includes("/DCTDecode"));

  assert.throws(() => generateProposal(proposalRequest({ ...fixedCalculation, fingerprint: "altered" }), tenant), /CALCULATION_FINGERPRINT_MISMATCH/);
  assert.throws(() => generateProposal({ ...proposalRequest(fixedCalculation), selectedOffer: { ...selectedOffer(fixedCalculation), version: "wrong" } }, tenant), /PROPOSAL_OFFER_MISMATCH/);
  assert.throws(() => generateProposal(proposalRequest(fixedCalculation), "tenant_other"), /TENANT_MISMATCH/);
  assert.throws(() => generateProposal({ ...proposalRequest(fixedCalculation), sourceType: "COMPARISON", comparison: { ...comparison, results: [], ranking: [] }, selectedCalculationId: fixedCalculation.calculationId }, tenant), /PROPOSAL_OFFER_EXCLUDED|COMPARISON_FINGERPRINT_MISMATCH|COMPARISON_COST_BASIS_INVALID/);
  assert.equal(await cteRepository.get(tenant, draft.archiveId) !== null, true);
  console.log("proposal-export smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
