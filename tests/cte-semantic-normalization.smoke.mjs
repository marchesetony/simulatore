import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { parseAnthropicCteResponse } from "../app/lib/cte/anthropic.ts";
import { buildAuthoritativeCteContract, normalizeCteReview, tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { validateCteContract } from "../app/lib/cte/validation.ts";
import { LocalFilesystemRepository } from "../app/lib/persistence/local.ts";

const field = (path, value, sourceText = typeof value === "string" ? value : "document evidence") => ({ path, value, confidence: 0.98, sourcePage: 1, sourceText, status: value === null ? "NOT_FOUND" : "CONFIRMED" });
const passThrough = {
  componentId: "CDISPD", kind: "DISPATCHING", declarationState: "NOT_DECLARED", effectiveFrom: "2026-04-01", effectiveTo: "2026-12-31",
  documentPresence: "DOCUMENT_STATED", amountStatus: "NOT_DECLARED", sourceText: "CDISPD secondo articolo 48 del TIV",
};
const economicDuration = { value: 12, unit: "MONTHS", sourceText: "12 mesi dalla decorrenza della fornitura" };
const lossSemantics = { present: true, rawText: "0,03 €/kWh lordo delle perdite di rete", appliesTo: "SPREAD", provenance: "Condizioni economiche, pagina 2" };
const exitFee = { amount: 69, currency: "EUR", condition: "EARLY_EXIT_BEFORE_DURATION", durationReference: economicDuration, sourceText: "Oneri di recesso anticipato di € 69 prima dei 12 mesi" };
const fields = [
  field("supplier.name", "BPower Energia S.p.A."), field("supplier.supplierId", "01867000851", "P.IVA: 01867000851"), field("offer.name", "BE FAMILY CASA PROTETTA"), field("offer.code", "CASA-PROTETTA"),
  field("validity.periodStart", "2026-04-01"), field("validity.periodEnd", "2026-12-31"), field("eligibility.customerTypes", "Clienti domestici"), field("eligibility.voltageLevels", "BT"),
  field("pricing.mode", "Prezzo indicizzato al PUN"), field("pricing.reference", "PUN Index GME"), field("pricing.spread.amount", "0,03 €/kWh"), field("currency", "EUR"), field("taxTreatment", "IVA e imposte escluse"),
  field("commercialTerms.fixedFees", "156 €/POD/anno; 13 €/mese", "Totale corrispettivi fissi 156 €/POD/anno, fatturato in quote mensili pari a 13 €/mese"),
  field("commercialTerms.variableFees", "PUN Index GME + 0,03 €/kWh"), field("commercialTerms.passThroughComponents", [passThrough], "CDISPD secondo articolo 48 del TIV"),
  field("commercialTerms.economicDuration", economicDuration), field("commercialTerms.lossSemantics", lossSemantics), field("commercialTerms.exitFee", exitFee),
];
assert.equal(parseAnthropicCteResponse({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "extract_cte", input: { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("commercialTerms.economicDuration", economicDuration), field("commercialTerms.lossSemantics", lossSemantics), field("commercialTerms.exitFee", exitFee)], extractionNotes: [] } }] }).fields.length, 3);
const extraction = normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields, extractionNotes: [] }, "tenant_fix9");
const record = { ingestionId: "cte-fix9-synthetic", documentId: "cte-document-fix9", tenantId: "tenant_fix9", documentType: extraction.documentType, vector: extraction.vector, fields: extraction.fields };
const contract = buildAuthoritativeCteContract(record);
validateCteContract(contract);

const monthlyFixedFeeContract = structuredClone(contract);
monthlyFixedFeeContract.commercialTerms.fixedFees = [{ ...monthlyFixedFeeContract.commercialTerms.fixedFees[0], amount: 13, period: "MONTH", monthlyEquivalent: undefined }];
validateCteContract(monthlyFixedFeeContract);

assert.equal(contract.supplier.name, "BPower Energia S.p.A.");
assert.equal(contract.commercialTerms.fixedFees[0].amount, 156);
assert.equal(contract.commercialTerms.fixedFees[0].unit, "EUR_PER_POD");
assert.equal(contract.commercialTerms.fixedFees[0].period, "YEAR");
assert.equal(contract.commercialTerms.fixedFees[0].monthlyEquivalent, 13);
assert.equal(contract.commercialTerms.fixedFees.length, 1);
assert.equal(contract.commercialTerms.economicDuration.value, 12);
assert.equal(contract.commercialTerms.economicDuration.unit, "MONTHS");
assert.equal(contract.commercialTerms.lossSemantics.rawText, lossSemantics.rawText);
assert.equal(contract.commercialTerms.lossSemantics.appliesTo, "SPREAD");
assert.equal("lossFactor" in contract.commercialTerms.lossSemantics, false);
assert.equal(contract.commercialTerms.exitFee.amount, 69);
assert.equal(contract.commercialTerms.exitFee.condition, "EARLY_EXIT_BEFORE_DURATION");
assert.equal(contract.commercialTerms.oneOffFees.length, 0);
assert.equal(contract.commercialTerms.passThroughComponents[0].documentPresence, "DOCUMENT_STATED");
assert.equal(contract.commercialTerms.passThroughComponents[0].amountStatus, "NOT_DECLARED");

const review = normalizeCteReview({ vector: "EE", fields: extraction.fields });
assert.equal(review.notFoundFields.some((item) => item.fieldKey === "commercialTerms.economicDuration"), false);
assert.equal(review.approvalGate.blockers.some((item) => item.fieldKey === "supplier.supplierId"), false);

const wrongPair = fields.map((item) => item.path === "commercialTerms.fixedFees" ? { ...item, value: "156 €/POD/mese; 13 €/anno", sourceText: "156 €/POD/mese; 13 €/anno" } : item);
const wrongResult = tryBuildAuthoritativeCteContract({ ...record, fields: normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: wrongPair, extractionNotes: [] }, "tenant_fix9").fields });
assert.equal(wrongResult.contract, null);
assert.equal(wrongResult.errorCode, "CTE_AUTHORITATIVE_MAPPING_INVALID");

const absentDuration = normalizeCteReview({ vector: "EE", fields: extraction.fields.filter((item) => item.path !== "commercialTerms.economicDuration") });
assert.equal(absentDuration.notFoundFields.find((item) => item.fieldKey === "commercialTerms.economicDuration")?.status, "NOT_FOUND");

assert.throws(() => normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("commercialTerms.passThroughComponents", "scalar")], extractionNotes: [] }, "tenant_fix9"), /CTE_EXTRACTION_SCHEMA_INVALID/);
assert.doesNotThrow(() => normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("commercialTerms.economicDuration", null)], extractionNotes: [] }, "tenant_fix9"));
assert.throws(() => validateCteContract({ ...contract, commercialTerms: { ...contract.commercialTerms, passThroughComponents: [{ ...passThrough, amountStatus: "DECLARED" }] } }), /CTE_CDISPD_AMOUNT_INVALID/);

const root = await mkdtemp(path.join(os.tmpdir(), "cte-fix9-roundtrip-"));
const repository = new LocalFilesystemRepository(root, "cte-semantic-roundtrip");
await repository.append({ tenantId: "tenant_fix9", recordId: "semantic-contract", payload: contract, now: "2026-09-15T10:00:00.000Z" });
const readback = await repository.get("tenant_fix9", "semantic-contract");
assert.deepEqual(readback?.payload.commercialTerms.fixedFees[0], contract.commercialTerms.fixedFees[0]);
assert.deepEqual(readback?.payload.commercialTerms.economicDuration, contract.commercialTerms.economicDuration);
assert.deepEqual(readback?.payload.commercialTerms.lossSemantics, contract.commercialTerms.lossSemantics);
assert.deepEqual(readback?.payload.commercialTerms.exitFee, contract.commercialTerms.exitFee);
assert.deepEqual(readback?.payload.commercialTerms.passThroughComponents, contract.commercialTerms.passThroughComponents);

console.log("cte semantic normalization smoke: ok (typed semantics, fail-closed arrays, no double count, local round-trip)");
