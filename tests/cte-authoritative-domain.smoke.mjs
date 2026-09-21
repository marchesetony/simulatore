import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAuthoritativeCteContract, tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { toCalculationReadyOffer } from "../app/lib/cte/calculation-ready.ts";
import { createCteArchive, toPublicCteApprovedArchiveDetail } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { validateCteContract } from "../app/lib/cte/validation.ts";

const field = (path, value, sourceText = String(value), status = "CONFIRMED") => ({ path, value, confidence: 0.99, sourcePage: 2, sourceText, status });
const passThrough = { componentId: "CDISPD", kind: "OTHER_CONTRACTUAL_PASS_THROUGH", declarationState: "NOT_DECLARED", effectiveFrom: "2026-04-01", effectiveTo: "2026-12-31", documentPresence: "DOCUMENT_STATED", amountStatus: "NOT_DECLARED", sourceText: "CDISPD secondo ARERA/TIV" };
const duration = { value: 12, unit: "MONTHS", sourceText: "12 mesi dalla decorrenza della fornitura" };
const loss = { present: true, rawText: "0,03 €/kWh lordo delle perdite di rete", appliesTo: "SPREAD", provenance: "Condizioni economiche, pagina 2" };
const fields = [
  field("supplier.name", "BPower Energia S.p.A."), field("supplier.supplierId", "Partita IVA 01867000851"), field("offer.name", "Casa Protetta"), field("offer.code", "CASA-PROTETTA"),
  field("validity.periodStart", "01/04/2026"), field("validity.periodEnd", "31/12/2026"), field("expiry.date", "31/12/2026"), field("eligibility.customerTypes", "Clienti domestici"), field("eligibility.voltageLevels", "BT"),
  field("pricing.mode", "Prezzo fisso"), field("pricing.fixedPrice.amount", "0,12 €/kWh"), field("currency", "EUR"), field("taxTreatment", "IVA e imposte escluse"),
  field("commercialTerms.fixedFees", "156 €/POD/anno; 13 €/mese", "Totale quota fissa 156 €/POD/anno, fatturata in quote mensili pari a 13 €/mese"),
  field("commercialTerms.variableFees", null, null, "NOT_FOUND"), field("commercialTerms.imbalance", null, null, "NOT_FOUND"), field("commercialTerms.oneOffFees", null, null, "NOT_FOUND"), field("commercialTerms.commercialDiscounts", null, null, "NOT_FOUND"),
  field("commercialTerms.passThroughComponents", [passThrough]), field("commercialTerms.economicDuration", duration), field("commercialTerms.lossSemantics", loss), field("commercialTerms.exitFee", { amount: 69, currency: "EUR", condition: "EARLY_EXIT_BEFORE_DURATION", durationReference: duration, sourceText: "69 EUR prima dei 12 mesi" }),
];
const input = { ingestionId: "cte-domain-fixed", documentId: "doc-domain-fixed", tenantId: "tenant_domain", vector: "EE", documentType: "CTE", fields };
const result = tryBuildAuthoritativeCteContract(input);
assert.equal(result.errorCode, null, JSON.stringify(result));
const contract = result.contract ?? buildAuthoritativeCteContract(input);
assert.equal(contract.pricing.mode, "FIXED");
assert.equal(contract.pricing.fixedPrice.amount, 0.12);
assert.equal(contract.pricing.reference, "NONE");
assert.equal(contract.commercialTerms.fixedFees[0].amount, 156);
assert.equal(contract.commercialTerms.fixedFees[0].period, "YEAR");
assert.equal(contract.commercialTerms.fixedFees[0].monthlyEquivalent, 13);
assert.equal(contract.commercialTerms.economicDuration.value, 12);
assert.equal(contract.commercialTerms.lossSemantics.rawText, loss.rawText);
assert.equal(contract.commercialTerms.exitFee.amount, 69);
assert.equal(contract.commercialTerms.passThroughComponents[0].componentId, "CDISPD");

const approved = { ...structuredClone(contract), approval: { status: "APPROVED", reviewer: "fixture-reviewer", reviewedAt: "2026-04-01T00:00:00.000Z", decisionId: "fixture-decision" } };
validateCteContract(approved);
const ready = toCalculationReadyOffer(approved);
assert.deepEqual(ready.economicDuration, contract.commercialTerms.economicDuration);
assert.deepEqual(ready.lossSemantics, contract.commercialTerms.lossSemantics);
assert.deepEqual(ready.exitFee, contract.commercialTerms.exitFee);

const root = await mkdtemp(path.join(os.tmpdir(), "cte-authoritative-domain-"));
try {
  const repository = new LocalCteArchiveRepository(root);
  const archive = await createCteArchive(repository, { tenantId: approved.tenantId, contract: approved, now: "2026-04-01T00:00:00.000Z", actor: "fixture-import" });
  const detail = toPublicCteApprovedArchiveDetail(archive);
  assert.ok(detail);
  assert.equal(detail.contract.pricing.mode, "FIXED");
  assert.equal(detail.contract.pricing.fixedPrice.amount, 0.12);
  assert.equal(detail.contract.commercialTerms.fixedFees[0].period, "YEAR");
  assert.equal(detail.contract.commercialTerms.fixedFees[0].monthlyEquivalent, 13);
  assert.equal(detail.contract.commercialTerms.economicDuration.value, 12);
  assert.equal(detail.contract.commercialTerms.lossSemantics.rawText, loss.rawText);
  assert.equal(detail.contract.commercialTerms.exitFee.amount, 69);
  assert.equal(detail.contract.commercialTerms.passThroughComponents[0].componentId, "CDISPD");

  const expired = { ...structuredClone(approved), recordId: "cte-domain-expired", cteId: "cte-domain-expired", expiry: { status: "EXPIRES_ON", date: "2026-06-30" }, validity: { periodStart: "2026-01-01", periodEnd: "2026-12-31" } };
  await assert.rejects(() => createCteArchive(repository, { tenantId: expired.tenantId, contract: expired, now: "2026-07-01T00:00:00.000Z", actor: "fixture-import" }), /CTE_EXPIRED/);
  assert.throws(() => validateCteContract({ ...approved, expiry: { status: "EXPIRES_ON", date: "2027-01-01" } }), /CTE_EXPIRY_OUTSIDE_VALIDITY/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("cte authoritative domain smoke: ok (fixed pricing, approved FIX-9 projection, and expiry guards)");
