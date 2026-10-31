import assert from "node:assert/strict";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";
import { completeSupplyProfile } from "../app/lib/ingestion/supply-profile-completion.ts";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";

// Tony (29/10, fattura dettagliata BPower BE Family Casa Protetta, settembre 2026, 390 kWh): "credo che stiamo regredendo".
// The detailed bill prints no voltage, supply use, residence, contracted power or IVA amount.

// 1. What the bill proves fills the supply profile: bonus sociale = resident household, billed 6 kW, so BT.
const found = (value) => ({ value, status: "FOUND", confidence: 0.99, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const evidence = { customerType: notFound(), customerTaxIdentifier: notFound(), extendedFacts: [], powerKw: found(6), economicChargeLines: [
  { code: "OTHER", description: "Oneri di sistema (quote variabili)", quantity: "390", unit: "kWh", unitPrice: "0,033154", amount: "12,93", periodRaw: "" },
  { code: "OTHER", description: "Bonus sociale disagio economico", quantity: "1", unit: "POD/mese", unitPrice: "-12", amount: "-12,00", periodRaw: "" },
] };
const profile = completeSupplyProfile(buildBillSupplyProfile([]), evidence);
const context = buildTrustedElectricitySupplyContext(profile);
assert.equal(context.regulatoryCustomerScope, "DOMESTIC_RESIDENT_BT");
assert.equal(context.voltageLevel, "LV");
assert.equal(context.contractedPowerKw, 6);
// A value read on the bill is never replaced.
const read = buildBillSupplyProfile([{ code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Non residente", status: "FOUND" }, { code: "SUPPLY_USE_CATEGORY_RAW", value: "Domestico", status: "FOUND" }]);
assert.equal(completeSupplyProfile(read, evidence).domesticResidenceStatus.normalizedValue, "NON_RESIDENT");

// 2. The receipt: commercializzazione per kWh is not the PCV; with the household spread it is compared, with sbilanciamento,
//    on the energy line; the bill's IVA (10% printed per line, no amount) is computed like the offer's.
const line = (classification, group, amount, description, unit = "kWh") => ({ classification, group, amount, description, rawDescription: description, unit, unitPrice: null, rawUnitPrice: "", rawValue: "", aggregate: false, includedInReconciliation: true });
const components = [
  line("ENERGY_PRICE", "ENERGY_PRICE", "88,77", "Energia Attiva"),
  line("NETWORK_LOSS_CHARGE", "ENERGY_PRICE", "8,88", "Perdite di rete"),
  line("CAPACITY_MARKET_SELLER_CHARGE", "CAPACITY_MARKET", "4,37", "Corrispettivo mercato capacità"),
  line("DISPATCHING_SELLER_CHARGE", "DISPATCHING_OR_PASS_THROUGH", "4,50", "Dispacciamento"),
  line("COMMERCIALIZATION_FIXED_FEE", "COMMERCIALIZATION", "1,90", "Commercializzazione"),
  line("BALANCING_CHARGE", "OTHER_SELLER_CHARGES", "2,38", "Sbilanciamento"),
  line("PCV", "COMMERCIALIZATION", "13,00", "QF", "POD/mese"),
  line("ACCISE", "TAXES", "8,85", "Imposte Erariali"),
];
const totals = { sellerEnergyTotal: 110.8, sellerCommercializationTotal: 13, sellerOtherTotal: 0, regulatedNetworkTotal: 19.53, systemChargesTotal: 12.93, taxTotal: 8.85 };
const offer = [
  { category: "ENERGY", sign: "CHARGE", amount: { amount: 92.67 }, label: "Energia" },
  { category: "NETWORK_LOSSES", sign: "CHARGE", amount: { amount: 8.1 }, label: "Perdite di rete" },
  { category: "FIXED_FEE", sign: "CHARGE", amount: { amount: 13 }, label: "PCV", formulaInputs: { feeUnit: "EUR_PER_MONTH" } },
];
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 113.77, analysis: { components, totals }, domestic: true, validUntil: null, offerComponents: offer, householdSpread: true });
const energy = receipt.rows.find((row) => row.key === "ENERGY");
const detail = (key) => energy.details.find((item) => item.key === key);
assert.equal(detail("PCV").current, 13);
assert.equal(detail("ENERGY").current, 93.05);
assert.match(detail("ENERGY").label, /commercializzazione e sbilanciamento/);
assert.equal(detail("IMBALANCE"), undefined);
const taxes = receipt.rows.find((row) => row.key === "TAXES");
assert.equal(taxes.current, 25.36);
assert.equal(taxes.details.find((item) => item.key === "VAT").current, 16.51);
console.log("bpower detailed household bill ok");
