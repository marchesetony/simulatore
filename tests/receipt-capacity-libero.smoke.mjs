import assert from "node:assert/strict";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11, bolletta Be Smart, "ma potrebbe essere già incluso nella parte iniziale, verifica"): the bill's "Mercato della
// capacità" of 41,32 € already bills the regulated charge plus the CTE's Capacity Market libero (0,0032 + 0,0075 €/kWh, ×1,1
// losses). The libero is compared inside that line, never added to the energy price.
const line = (classification, group, amount, description, unit = "kWh") => ({ classification, group, amount, description, rawDescription: description, unit, unitPrice: null, rawUnitPrice: "", rawValue: "", aggregate: false, includedInReconciliation: true });
const components = [
  line("ENERGY_PRICE", "ENERGY_PRICE", "400,00", "Componente energia"),
  line("CAPACITY_MARKET_SELLER_CHARGE", "CAPACITY_MARKET", "41,32", "Mercato della capacità"),
];
const totals = { sellerEnergyTotal: 441.32, sellerCommercializationTotal: 0, sellerOtherTotal: 0, regulatedNetworkTotal: 0, systemChargesTotal: 0, taxTotal: 0 };
const offer = [
  { category: "ENERGY", sign: "CHARGE", amount: { amount: 410 }, label: "Energia" },
  { category: "CAPACITY_MARKET", sign: "CHARGE", amount: { amount: 12.36 }, label: "Mercato della capacità" },
  { category: "CAPACITY_MARKET", sign: "CHARGE", amount: { amount: 28.97 }, label: "Capacity market libero", formulaInputs: { source: "CTE_STATED_VALUE" } },
];
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 451.33, analysis: { components, totals }, domestic: true, validUntil: null, offerComponents: offer });
const details = receipt.rows.flatMap((row) => row.details ?? []);
const libero = details.find((item) => item.key === "CAPACITY_CTE");
assert.ok(libero, JSON.stringify(details.map((item) => [item.key, item.label])));
assert.match(libero.currentNote ?? "", /compreso nel mercato della capacità/);
assert.equal(libero.difference, null);
const capacity = details.find((item) => item.key === "CAPACITY");
assert.equal(capacity.current, 41.32);
assert.equal(capacity.difference, Math.round((12.36 + 28.97 - 41.32) * 100) / 100);
const energy = details.find((item) => item.key === "ENERGY");
assert.doesNotMatch(energy.label, /capacity market libero/i);
assert.equal(energy.difference, 10);
console.log("receipt capacity libero ok");
