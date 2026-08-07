import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cteApprovalGate, normalizeCteReview } from "../app/lib/cte/review.ts";
import { statusLabel } from "../app/lib/ui/format.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";

const field = (path, value, status = "CONFIRMED", sourceText = `Evidenza ${path}`) => ({ path, value, status, confidence: status === "UNCERTAIN" ? 0.62 : 0.96, sourcePage: 1, sourceText });
const complete = [
  field("supplier.name", "BPower Energia S.p.A."), field("supplier.supplierId", "SUP-1"), field("offer.name", "Be Relax 06.25"), field("offer.code", "BR0625"),
  field("validity.periodStart", "01/11/2025"), field("validity.periodEnd", "31/12/2026"), field("eligibility.customerTypes", "Clienti non domestici, altri usi Business"),
  field("eligibility.voltageLevels", "bassa o media tensione"), field("pricing.mode", "Prezzo indicizzato"), field("pricing.reference", "PUN"), field("pricing.spread.amount", "0,025 \u20AC/kWh"), field("taxTreatment", "IVA e imposte escluse"),
];
const validCandidate = structuredClone(syntheticElectricityCte);
const ready = cteApprovalGate({ documentType: "CTE", vector: "EE", fields: [...complete, field("commercialTerms.commercialDiscounts", null, "NOT_FOUND")], candidate: validCandidate });
assert.equal(ready.approvalReady, true);
assert.ok(ready.optionalNotFound.includes("Sconti commerciali"));
const missing = cteApprovalGate({ documentType: "CTE", vector: "EE", fields: complete.filter((item) => item.path !== "supplier.supplierId"), candidate: validCandidate });
assert.equal(missing.approvalReady, false);
assert.ok(missing.blockers.some((item) => item.code === "REQUIRED_FIELD_MISSING" && item.label.toLowerCase().includes("fornitore")));
const uncertain = cteApprovalGate({ documentType: "CTE", vector: "EE", fields: complete.map((item) => item.path === "pricing.spread.amount" ? { ...item, status: "UNCERTAIN", confidence: 0.55 } : item), candidate: validCandidate });
assert.ok(uncertain.blockers.some((item) => item.code === "REQUIRED_FIELD_UNCERTAIN" && item.fieldKey === "pricing.spread.amount"));
const unclassified = cteApprovalGate({ documentType: "UNKNOWN", vector: "UNKNOWN", fields: [], candidate: null });
assert.ok(unclassified.blockers.some((item) => item.code === "CLASSIFICATION_UNCONFIRMED"));
assert.ok(unclassified.blockers.some((item) => item.code === "AUTHORITATIVE_CONTRACT_MISSING"));
const evidencePiva = normalizeCteReview({ vector: "EE", fields: [field("supplier.name", "BPower Energia S.p.A.", "CONFIRMED", "P. IVA: 01867000851"), ...complete.filter((item) => item.path !== "supplier.name" && item.path !== "supplier.supplierId")] });
assert.equal(evidencePiva.commercialFields.find((item) => item.fieldKey === "supplier.supplierId")?.normalizedValue, "01867000851");
const invalidPiva = normalizeCteReview({ vector: "EE", fields: [field("supplier.name", "BPower Energia S.p.A.", "CONFIRMED", "P.IVA: 12345")] });
assert.equal(invalidPiva.notFoundFields.find((item) => item.fieldKey === "supplier.supplierId")?.status, "NOT_FOUND");
const pivaGate = cteApprovalGate({ documentType: "CTE", vector: "EE", fields: evidencePiva.commercialFields.map((item) => ({ path: item.fieldKey, value: typeof item.normalizedValue === "string" || typeof item.normalizedValue === "number" ? item.normalizedValue : null, status: item.status, confidence: item.confidence, sourcePage: item.sourcePage, sourceText: item.sourceText })), candidate: validCandidate });
assert.equal(pivaGate.blockers.some((item) => item.fieldKey === "supplier.supplierId"), false);

const review = normalizeCteReview({ vector: "EE", fields: [field("commercialTerms.fixedFees", "15,00 \u20AC/mese al netto delle perdite di rete")] });
const fixed = review.commercialFields.find((item) => item.fieldKey === "commercialTerms.fixedFees");
assert.equal(fixed?.normalizedValue, 15);
assert.equal(fixed?.unit, "\u20AC/mese");
assert.deepEqual(fixed?.conditions, ["al netto delle perdite di rete"]);
assert.notEqual(fixed?.sourceText, String(fixed?.normalizedValue));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = await readFile(path.join(root, "app/components/CteIngestionPanel.tsx"), "utf8");
const reviewSource = await readFile(path.join(root, "app/lib/cte/review.ts"), "utf8");
assert.match(ui, /Mostra testo completo/);
assert.match(ui, /Approvazione non disponibile/);
assert.match(ui, /Non rilevato nel documento/);
assert.match(ui, /field\.unit/);
assert.match(ui, /Correggi/);
assert.match(ui, /Annulla/);
assert.match(ui, /useState/);
assert.doesNotMatch(ui, /[\u00C3\u00C2\u00E2]/);
assert.doesNotMatch(ui, /<(?:span|strong|p)[^>]*>\{field\.fieldKey\}/);
assert.match(reviewSource, /commercialTerms\.commercialDiscounts.*Sconti commerciali/);
assert.equal(statusLabel("REVIEW_REQUIRED"), "Revisione richiesta");
assert.equal(statusLabel("CONFIRMED"), "Confermato");
assert.equal(statusLabel("NOT_FOUND"), "Non rilevato");
assert.equal(statusLabel("FAILED"), "Non riuscito");
console.log("cte review approval smoke: ok (server gate, optional fields, uncertainty, source separation and responsive UI contracts; no provider call)");
