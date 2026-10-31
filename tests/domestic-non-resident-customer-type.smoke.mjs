import assert from "node:assert/strict";
import { customerTypeOf } from "../app/lib/ingestion/customer-type.ts";

// Tony (29/10): a "Domestico non residente" bill stopped at the offer choice with RESIDENCY_MISMATCH, because the reading
// returned customerType NON_RESIDENTIAL (the enum's name) with residency NON_RESIDENT. A domestic supply is a household.
const evidence = (customerType, facts) => ({ customerType: { status: "FOUND", value: customerType }, customerTaxIdentifier: { status: "NOT_FOUND", value: null }, extendedFacts: facts.map(([code, value]) => ({ code, value, status: "FOUND" })) });
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["SUPPLY_USE_RAW", "Domestico non residente"]])), "RESIDENTIAL");
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["DOMESTIC_RESIDENCE_RAW", "Uso domestico"], ["CUSTOMER_TYPE_RAW", "Cliente non residente"]])), "RESIDENTIAL");
// A business stays a business.
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["SUPPLY_USE_RAW", "Altri usi"]])), "NON_RESIDENTIAL");
assert.equal(customerTypeOf(evidence("NON_RESIDENTIAL", [["SUPPLY_USE_RAW", "Non domestico BTA3"]])), "NON_RESIDENTIAL");
assert.equal(customerTypeOf(evidence("RESIDENTIAL", [["SUPPLY_USE_RAW", "Domestico residente"]])), "RESIDENTIAL");
console.log("domestic non-resident customer type ok");

// Tony (29/10, bolletta BPower BE SPECIAL 26 dettagliata e sintetica): "Tipologia Prezzo: offerta per fasce orarie di
// prezzo", "Periodicità aggiornamento indice: MENSILE" is PUN by band, not hourly; "monorario" takes the monthly PUN.
const { billIndexStructure } = await import("../app/lib/market/bill-spread.ts");
const bill = (facts, lines = []) => ({ extendedFacts: facts.map(([code, value]) => ({ code, value, status: "FOUND" })), economicChargeLines: lines });
assert.equal(billIndexStructure(bill([["PRICE_TIME_STRUCTURE_RAW", "offerta per fasce orarie di prezzo"], ["INDEX_NAME", "PUN"]])), "BANDS");
assert.equal(billIndexStructure(bill([["PRICE_TIME_STRUCTURE_RAW", "Monorario"]])), "MONO");
assert.equal(billIndexStructure(bill([["PRICE_TIME_STRUCTURE_RAW", "PUN orario"]])), "HOURLY");
console.log("bill index structure ok");
