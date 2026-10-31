import assert from "node:assert/strict";
import { completeSupplyProfile } from "../app/lib/ingestion/supply-profile-completion.ts";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";

// Tony (30/10, Duferco FLEX BUSINESS, agosto 2026, 22 kW impegnati e disponibili): "ecco la bolletta leggi bene". The bill
// prints "Massima 22,00 kW" beside the contract, but the network and oneri quota potenza is billed on 13,4 kW, the power
// drawn in the month: no limiter, so by TIT art. 1 the potenza impegnata is the monthly maximum. The simulator billed 22 kW
// (rete quota potenza 60,37 € against 36,77 €). Values are test values shaped like that bill, no customer data.
const fact = (code, value) => ({ code, value, status: "FOUND" });
const facts = [
  fact("SUPPLY_USE_CATEGORY_RAW", "Altri usi"),
  fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Non applicabile"),
  fact("VOLTAGE_CLASS_RAW", "BT"),
  fact("POWER_COMMITTED", "22,00 kW"),
  fact("POWER_AVAILABLE", "22,00 kW"),
  fact("POWER_MAXIMUM_DRAWN", "22,00 kW"),
];
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const evidence = (lines) => ({ customerType: notFound(), customerTaxIdentifier: notFound(), extendedFacts: facts, powerKw: notFound(), economicChargeLines: lines });
const line = (description, quantity, unit, unitPrice, amount) => ({ code: "OTHER", description, quantity, unit, unitPrice, amount, periodRaw: "" });
const billed = [
  line("Quota potenza", "13,4 kW per 1 mese", "€/kW", "4,266418", "57,17"),
  line("ASOS quota potenza", "13.4", "€/kW", "1,234700", "16,54"),
  line("ASOS quota energia", "741", "€/kWh", "0,031875", "23,62"),
];
const profile = completeSupplyProfile(buildBillSupplyProfile(facts), evidence(billed));
const context = buildTrustedElectricitySupplyContext(profile);
assert.equal(context.regulatoryCustomerScope, "NON_DOMESTIC_BT_BTA6");
assert.equal(context.regulatoryPowerBasisKind, "MONTHLY_MAX_DRAWN");
assert.equal(context.regulatoryPowerBasisKw, 13.4);
assert.equal(context.contractedPowerKw, 22);
// A supply billed on its committed power (limiter fitted) keeps the committed power.
const limited = buildTrustedElectricitySupplyContext(completeSupplyProfile(buildBillSupplyProfile(facts), evidence([line("Quota potenza", "22 kW", "€/kW", "2,74", "60,37")])));
assert.equal(limited.regulatoryPowerBasisKind, "CONTRACTUAL_COMMITTED");
assert.equal(limited.regulatoryPowerBasisKw, 22);
console.log("BTA6_MAX_DRAWN_FROM_BILLED_KW=PASS");
