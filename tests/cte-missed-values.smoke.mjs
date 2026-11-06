import assert from "node:assert/strict";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { cteMissedValues, cteReadingReviewPrompt, betterCteReading } from "../app/lib/cte/reading-review.ts";

// Tony (1/11, "verifica le cte che ti allego, non puo essere che la azienda protetta costi meno della bsmile"): Azienda
// Protetta prints spread 0,025 and Capacity Market libero 0,007 €/kWh (Be Smile 0,02 and 0,0075): it costs more per kWh.
// A reading that drops the capacity libero makes it cheaper. The verifier now lists every seller charge the CTE prints that
// the reading does not hold, and asks for it. Informative values ("attualmente pari a", PUN of the last 12 months) are not
// charges. Synthetic text with the same structure as the CTE.
const text = [
  "I valori mostrati di seguito si riferiscono al valore massimo del PUN raggiunto negli ultimi 12 mesi, con riferimento al mese di settembre 2026 0,20635 Eur/kWh in F1.",
  "• il corrispettivo fisso d'acquisto, bloccato per tutta la durata dell'offerta, pari a 0,025 Eur/kWh.",
  "• Quota fissa business pari a 15 €/mese;",
  "• Commercializzazione pari a 0,003 €/kWh al netto delle perdite di rete;",
  "• Sbilanciamento pari a 0,005 €/kWh al netto delle perdite di rete.",
  "È prevista l'applicazione dei corrispettivi di dispacciamento attualmente pari a 0,01155 Eur/kWh , e del Corrispettivo mercato capacità attualmente pari a 0,01349 Eur/kWh in bassa tensione e pari a 0,0032 Eur/kWh nelle ore di picco.",
  "È inoltre prevista l'applicazione del corrispettivo Capacity Market libero pari a 0,007 Eur/kWh al lordo delle perdite di rete.",
].join(" ");
const reading = (extra = []) => ({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [
  { path: "pricing.spread.amount", value: 0.025 }, { path: "commercialTerms.fixedFees", value: [{ amount: 15, unit: "EUR_PER_MONTH" }] },
  { path: "commercialTerms.variableFees", value: [{ name: "Commercializzazione", amount: 0.003 }, { name: "Sbilanciamento", amount: 0.005 }, ...extra] },
] });
const missed = cteMissedValues(reading(), text);
assert.equal(missed.length, 1, `only the capacity libero is missing: ${JSON.stringify(missed)}`);
assert.match(missed[0], /Capacity Market libero pari a 0,007/);
assert.deepEqual(cteMissedValues(reading([{ name: "Capacity Market libero", amount: 0.007 }]), text), [], "complete reading: nothing missed");
assert.match(cteReadingReviewPrompt(reading(), [], missed), /<corrispettivi_non_letti>[\s\S]*0,007/);
assert.ok(betterCteReading(reading(), [], reading([{ name: "Capacity Market libero", amount: 0.007 }]), [], missed, []), "the reading that adds the missed charge is kept");
assert.equal(cteMissedValues(reading(), null).length, 0, "no text layer: no claim");
console.log("CTE_MISSED_VALUES=PASS");
