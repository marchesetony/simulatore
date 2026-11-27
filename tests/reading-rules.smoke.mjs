import assert from "node:assert/strict";
import { normativeGuidance } from "../app/lib/normative/archive.ts";
import { READING_RULES, readingRulesGuidance } from "../app/lib/reading/rules.ts";

// Tony (1/11): "leggi e fissa le regole per la lettura delle bollette e delle cte". Every reading rule he gave lives in one
// rulebook, and both AI readers (bill and CTE) receive it with every document through normativeGuidance.
const bill = normativeGuidance("BILL");
const cte = normativeGuidance("CTE");
assert.match(bill, /Regole di lettura delle bollette/);
assert.match(cte, /Regole di lettura delle CTE/);

const byId = new Map(READING_RULES.map((rule) => [rule.id, rule]));
assert.equal(byId.size, READING_RULES.length, "rule ids are unique");
for (const id of ["READ_EVERYTHING", "PRINTED_ONLY", "BILL_OFFER_BOX", "BILL_QUOTA_TOTALS", "BILL_SELLER_NAMES", "BILL_TOTAL", "CTE_VERSION", "CTE_SCHEDA", "CTE_CDISPD"]) {
  assert.ok(byId.has(id), `rule ${id} exists`);
}
for (const rule of READING_RULES) {
  assert.ok(rule.text.length > 10 && rule.origin.startsWith("Tony"), `${rule.id} has a text and Tony's origin`);
  if (rule.uses.includes("BILL")) assert.ok(bill.includes(rule.text), `${rule.id} reaches the bill reader`);
  else assert.ok(!bill.includes(rule.text), `${rule.id} stays out of the bill reader`);
  if (rule.uses.includes("CTE")) assert.ok(cte.includes(rule.text), `${rule.id} reaches the CTE reader`);
  else assert.ok(!cte.includes(rule.text), `${rule.id} stays out of the CTE reader`);
}
assert.match(readingRulesGuidance("BILL"), /Box dell'offerta/);
assert.match(readingRulesGuidance("CTE"), /ESVFL01, ESVFL02/);
console.log("reading rules ok");
