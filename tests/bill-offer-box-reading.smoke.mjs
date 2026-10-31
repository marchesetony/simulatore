import assert from "node:assert/strict";
import { mapBillCoreToStructuredBill, mergeBillCoreAndAnalyst } from "../app/lib/ingestion/bill-two-stage.ts";
import { BILL_WIRE_FIELD_NAMES } from "../app/lib/ingestion/bill-wire.ts";
import { analystOfferField, normalizeAnalystFactCode } from "../app/lib/ingestion/bill-extended-contract.ts";
import { readableTextItems } from "../app/lib/ingestion/document-numeric-evidence.ts";
import { withDocumentOfferBox } from "../app/lib/ingestion/structured-bill.ts";
import { keepOfferBox } from "../app/lib/ingestion/anthropic-bill-sdk.ts";
import { readFileSync } from "node:fs";

// Tony (31/10, bolletta sintetica BPower): "ma che cazzo dici, guarda la bolletta". The box dell'offerta prints offer name and
// code, Tipologia Offerta VARIABILE, Indice di riferimento PUN, decorrenza and scadenza of the economic conditions and the
// contract "a tempo indeterminato"; the simulator showed every row as not indicated. Synthetic values, no customer data.

// 1. Facts named by the reader in its own words are placed, not thrown away as UNKNOWN.
for (const [code, label, expected] of [
  ["DATA_DECORRENZA_CONDIZIONI_ECONOMICHE", "", "ECONOMIC_CONDITIONS_START_DATE"],
  ["ECONOMIC_CONDITIONS_EFFECTIVE_DATE", "", "ECONOMIC_CONDITIONS_START_DATE"],
  ["SCADENZA_CONDIZIONI_TECNICO_ECONOMICHE", "", "ECONOMIC_EXPIRY"],
  ["ECONOMIC_CONDITIONS_END_DATE", "", "ECONOMIC_EXPIRY"],
  ["DATA_SCADENZA_DEL_CONTRATTO", "", "CONTRACT_EXPIRY"],
  ["TIPOLOGIA_OFFERTA", "", "PRICE_MECHANISM_RAW"],
  ["OFFER_TYPE", "", "PRICE_MECHANISM_RAW"],
  ["TIPOLOGIA_PREZZO", "", "PRICE_TIME_STRUCTURE_RAW"],
  ["INDICE_DI_RIFERIMENTO", "", "INDEX_NAME"],
  ["REFERENCE_INDEX", "", "INDEX_NAME"],
  ["BOX_FIELD_7", "Data decorrenza condizioni economiche", "ECONOMIC_CONDITIONS_START_DATE"],
  ["ECONOMIC_EXPIRY", "", "ECONOMIC_EXPIRY"],
  ["SCADENZA_BONUS_SOCIALE", "", "UNKNOWN"],
  ["TOTALE_SPESA_DOVUTA_PER_L_OFFERTA", "", "UNKNOWN"],
  ["ONERI_DI_RECESSO_ANTICIPATO", "", "UNKNOWN"],
]) assert.equal(normalizeAnalystFactCode(code, label), expected, `${code} ${label}`);
assert.equal(analystOfferField("Denominazione commerciale offerta"), "offerName");
assert.equal(analystOfferField("CODICE_OFFERTA"), "offerCode");
assert.equal(analystOfferField("PRICE_F1"), null);

// 2. The second reading's offer name fills the core field the first reading left empty; its box facts are kept.
const found = (value) => ({ value: String(value), status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });
const wire = { schemaVersion: 1 };
for (const name of BILL_WIRE_FIELD_NAMES) wire[name] = name === "vector" ? found("EE") : name === "customerType" ? found("RESIDENTIAL") : name === "voltageLevel" ? found("LV") : name === "billingPeriod" ? found("01/08/2026 - 30/09/2026") : name === "pod" ? found("IT001E00000000") : name === "supplier" ? found("Venditore Test") : missing();
delete wire.customerId;
const core = mapBillCoreToStructuredBill(wire);
assert.notEqual(core.offerName.status, "FOUND");
const item = (code, label, value) => ({ kind: "FACT", code, label, value, unit: "", quantity: "", unitPrice: "", amount: "", period: "", status: "FOUND" });
const merged = mergeBillCoreAndAnalyst(core, { schemaVersion: "1", items: [
  item("DENOMINAZIONE_COMMERCIALE_OFFERTA", "Denominazione commerciale offerta", "OFFERTA TEST CASA"),
  item("CODICE_OFFERTA", "Codice offerta", "000TEST01"),
  item("DATA_DECORRENZA_CONDIZIONI_ECONOMICHE", "Data decorrenza condizioni economiche", "01/05/2026"),
  item("SCADENZA_CONDIZIONI_TECNICO_ECONOMICHE", "Scadenza condizioni tecnico economiche", "30/04/2027"),
  item("TIPOLOGIA_OFFERTA", "Tipologia Offerta", "VARIABILE"),
  item("INDICE_DI_RIFERIMENTO", "Indice di riferimento", "PUN"),
] });
assert.equal(merged.offerName.value, "OFFERTA TEST CASA");
assert.equal(merged.offerCode.value, "000TEST01");
const fact = (bill, code) => bill.extendedFacts.find((entry) => entry.code === code)?.value;
assert.equal(fact(merged, "ECONOMIC_CONDITIONS_START_DATE"), "01/05/2026");
assert.equal(fact(merged, "ECONOMIC_EXPIRY"), "30/04/2027");
assert.equal(fact(merged, "PRICE_MECHANISM_RAW"), "VARIABILE");
assert.equal(fact(merged, "INDEX_NAME"), "PUN");
// The review re-reads the charges; a second reading without the box keeps the box of the first.
const reviewed = keepOfferBox({ ...core, extendedFacts: [] }, merged);
assert.equal(fact(reviewed, "ECONOMIC_EXPIRY"), "30/04/2027");
assert.equal(reviewed.offerName.value, "OFFERTA TEST CASA");

// 3. A PDF written one letter per text item is read back as words; a wide gap is another column.
const EM = { i: 0.222, l: 0.222, f: 0.278, t: 0.278, r: 0.333, m: 0.833, ":": 0.278, " ": 0.278, T: 0.611, O: 0.778, C: 0.722, D: 0.722, N: 0.722, R: 0.722, F: 0.611, L: 0.556, I: 0.278 };
const em = (char) => EM[char] ?? (/[A-Z]/.test(char) ? 0.667 : 0.556);
const letters = (text, x, y, size = 14.6) => { const out = []; for (const char of text) { if (char !== " ") out.push({ text: char, page: 1, x, y }); x += em(char) * size; } return out; };
const items = readableTextItems([
  ...letters("Denominazione commerciale offerta:", 40, 100), ...letters("Codice offerta:", 500, 100),
  ...letters("OFFERTA TEST CASA", 40, 118), ...letters("000TEST01", 500, 118),
  ...letters("Tipologia Offerta: VARIABILE", 40, 136),
]);
assert.deepEqual(items.map((entry) => entry.text), ["Denominazione commerciale offerta:", "Codice offerta:", "OFFERTA TEST CASA", "000TEST01", "Tipologia Offerta: VARIABILE"]);
// Normal PDFs (words per item) are left as they are.
const words = Array.from({ length: 30 }, (_, index) => ({ text: `parola${index}`, page: 1, x: index * 50, y: 10 }));
assert.deepEqual(readableTextItems(words), words);

// 4. What the PDF prints in the box fills the facts the AI left out, and never replaces what it read.
const box = { offerType: "VARIABILE", priceStructure: "offerta per fasce orarie di prezzo", indexName: "PUN", economicConditionsStart: "01/05/2026", economicConditionsExpiry: "30/04/2027", contractExpiry: "a tempo indeterminato", spread: "0,020000 €/kWh" };
const filled = withDocumentOfferBox({ ...core, extendedFacts: [{ code: "INDEX_NAME", value: "PUN Index GME", status: "FOUND" }, { code: "ECONOMIC_EXPIRY", value: "NOT_FOUND", status: "NOT_FOUND" }] }, box);
assert.equal(fact(filled, "INDEX_NAME"), "PUN Index GME");
assert.equal(filled.extendedFacts.filter((entry) => entry.code === "ECONOMIC_EXPIRY").length, 1);
assert.equal(fact(filled, "ECONOMIC_EXPIRY"), "30/04/2027");
assert.equal(fact(filled, "PRICE_MECHANISM_RAW"), "VARIABILE");
assert.equal(fact(filled, "CONTRACT_EXPIRY"), "a tempo indeterminato");
assert.equal(withDocumentOfferBox(core, null).documentOfferBox, null);

// 5. The bill screen: index + spread in the box is indexed; a failed second reading is not called a detailed invoice;
//    a raw "NOT_FOUND" is never shown as the expiry.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /function indexedFromBox\(/);
assert.match(flow, /\|\| indexedFromBox\(bill\)/);
assert.match(flow, /analystExtractionStatus === "FAILED"\) return false/);
assert.match(flow, /!\/\^NOT_FOUND\$\/i\.test\(value\.trim\(\)\)/);
assert.match(flow, /const text = \[factSeen\(bill, "PRICE_TIME_STRUCTURE_RAW"\)/, "a fasce read even when marked to review");
console.log("bill offer box reading ok");
