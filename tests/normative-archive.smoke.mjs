import assert from "node:assert/strict";
import { NORMATIVE_RULES, NORMATIVE_SOURCES, normativeGuidance, normativeRules } from "../app/lib/normative/archive.ts";
import { ANTHROPIC_CTE_SYSTEM_PROMPT } from "../app/lib/cte/anthropic.ts";
import { ANALYST_STAGE_PROMPT } from "../app/lib/ingestion/bill-two-stage.ts";

// Archivio normativo (Tony, 29/10): "memorizza questi dati affinche l'AI possa utilizzarli per leggere le fatture e
// simulare le offerte", split between households and business.
const sources = new Set(NORMATIVE_SOURCES.map((source) => source.id));
for (const rule of NORMATIVE_RULES) assert.ok(sources.has(rule.source), `${rule.id} cites a known source`);
assert.equal(new Set(NORMATIVE_RULES.map((rule) => rule.id)).size, NORMATIVE_RULES.length, "rule ids are unique");

// 1. Households: a single spread with imbalance and commercialization inside, CDISPD apart (386/2025 art. 1).
const domestic = normativeRules("SIMULATION", "DOMESTIC").map((rule) => rule.id);
for (const id of ["DOMESTIC_EE_STRUCTURE", "DOMESTIC_EE_SPREAD", "DOMESTIC_EE_CDISPD", "LOSSES", "ANNUAL_COST"]) assert.ok(domestic.includes(id), id);
assert.ok(!domestic.includes("BUSINESS_EE_DISPATCHING"), "business dispatching is not a household rule");

// 2. Business: free charges, dispatching apart with losses (Codice art. 10.4, 555/2017 art. 18.1.c.ii).
const business = normativeRules("SIMULATION", "BUSINESS").map((rule) => rule.id);
for (const id of ["BUSINESS_EE_STRUCTURE", "BUSINESS_EE_DISPATCHING", "LOSSES"]) assert.ok(business.includes(id), id);
assert.ok(!business.includes("DOMESTIC_EE_SPREAD"), "the single spread is a household rule");

// 3. The AI reads bills and CTEs with these rules.
assert.ok(ANTHROPIC_CTE_SYSTEM_PROMPT.includes(normativeGuidance("CTE")), "CTE prompt carries the archive");
assert.ok(ANALYST_STAGE_PROMPT.includes(normativeGuidance("BILL")), "bill prompt carries the archive");
assert.match(normativeGuidance("CTE"), /sbilanciamento e commercializzazione sono dentro lo spread/);
assert.match(normativeGuidance("BILL"), /spesa per la tariffa per l'uso della rete/);
console.log("normative archive ok");
