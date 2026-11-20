import assert from "node:assert/strict";
import { normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";

// Tony (31/10, B Relax Gas 003888GSVML03…BRELAXGAS: "errore"). The reader filled "Livelli tensione" on a gas CTE and the
// whole reading was refused (campi non previsti per GAS). Now the field is dropped with a note and the rest is kept;
// a field read twice keeps its first reading.
const field = (path, value) => ({ path, value, confidence: 0.9, sourcePage: 1, sourceText: typeof value === "string" ? value : null, status: "CONFIRMED" });
const read = normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "GAS", extractionNotes: [], fields: [
  field("supplier.name", "BPower Energia S.p.A."), field("offer.name", "B Relax Gas"), field("offer.name", "B Relax Gas bis"),
  field("eligibility.voltageLevels", "bassa pressione"), field("pricing.reference", "PSV"),
] }, "tenant_a");
const byPath = new Map(read.fields.map((item) => [item.path, item]));
assert.equal(byPath.get("offer.name").value, "B Relax Gas");
assert.equal(byPath.get("supplier.name").value, "BPower Energia S.p.A.");
assert.equal(byPath.has("eligibility.voltageLevels"), false);
assert.match(read.extractionNotes.join(" "), /eligibility\.voltageLevels/);
console.log("cte gas foreign fields ok");
