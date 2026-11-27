import assert from "node:assert/strict";
import { normalizeCteReview, tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";

// Tony (31/10, AZIENDA PROTETTA and Be Smile 11.25): "aggiungi un direttore generale, che orchestra e corregge. ancora gli
// stessi errori, cazzo non si può avere sempre lo stesso errore". The director fills what the CTE states and the reading
// left empty or wrong: "VARIABLE" is an indexed price, the commercializzazione read as 0,00 is 0,003 €/kWh.
// And: "il trattamento fiscale può variare in base al cliente e non deve essere specificato nella cte, si desume dal tipo
// di cliente": it never blocks approval.
const f = (path, value, sourceText = typeof value === "string" ? value : null, status = "CONFIRMED") => ({ path, value, sourceText, status, confidence: 0.9, sourcePage: 1 });
const fields = [
  f("supplier.name", "BPower Energia S.p.A."), f("offer.name", "Be Smile 11.25"), f("offer.code", "003888ESVFL04XXXXXXXXXXXSMIL1125"),
  f("validity.periodStart", "06/11/2025"), f("validity.periodEnd", "31/12/2026"), f("eligibility.customerTypes", "Clienti Finali Non Domestici Altri Usi"),
  f("eligibility.voltageLevels", "bassa o media tensione"), f("pricing.mode", "VARIABLE"), f("pricing.reference", "PUN"),
  f("pricing.spread.amount", "0,02 €/kWh"), f("commercialTerms.fixedFees", "Quota fissa business pari a 15 €/mese"),
  f("commercialTerms.variableFees", "0,00 €/kWh", "Costo per potenza impegnata 0,00 €/kW"),
  f("commercialTerms.imbalance", "0,005 €/kWh", "Sbilanciamento pari a 0,005 €/kWh al netto delle perdite di rete"),
  f("currency", "EUR", "Oltre ai prezzi: Commercializzazione pari a 0,003 €/kWh al netto delle perdite di rete"),
  f("taxTreatment", null, null, "NOT_FOUND"),
];
const review = normalizeCteReview({ vector: "EE", fields });
const all = new Map([...review.commercialFields, ...review.notFoundFields].map((field) => [field.fieldKey, field]));
assert.equal(all.get("pricing.mode").normalizedValue, "Indicizzata");
assert.equal(all.get("commercialTerms.variableFees").normalizedValue, 0.003);
assert.deepEqual(review.approvalGate.blockers.map((blocker) => blocker.fieldKey), []);
// "al netto di IVA e/o imposte" anywhere in the CTE is read as prices without taxes.
const withNet = normalizeCteReview({ vector: "EE", fields: [...fields.slice(0, -1), f("taxTreatment", null, null, "NOT_FOUND"), f("commercialTerms.additionalServices", "Tutti i corrispettivi indicati sono da intendersi al netto di IVA e/o imposte")] });
assert.equal(new Map(withNet.commercialFields.map((field) => [field.fieldKey, field])).get("taxTreatment").normalizedValue, "IVA e imposte escluse");
assert.equal(normalizeCteReview({ vector: "EE", fields: [...fields.slice(0, -1), f("taxTreatment", "Escluse imposte e tasse")] }).commercialFields.find((field) => field.fieldKey === "taxTreatment").normalizedValue, "IVA e imposte escluse");
const built = tryBuildAuthoritativeCteContract({ ingestionId: "cte-ing-smile", documentId: "doc-smile", tenantId: "tenant_a", documentType: "CTE", vector: "EE", fields });
assert.equal(built.contract?.pricing.mode, "INDEXED", JSON.stringify(built.validationPaths ?? built.errorCode));
assert.equal(built.contract.taxTreatment, "EXCLUDED");
console.log("cte director corrections ok");
