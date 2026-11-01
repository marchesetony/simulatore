import assert from "node:assert/strict";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (1/11, screenshot "Partite escluse dal confronto: Altre partite - Addebito CTS-Corrispettivo Tariffario Specifico:
// 42,46 €"): "se è una voce che compare nella fattura deve essere inserita come costo". The CTS is billed by the distributor
// whoever the seller is: it is in the network spend of both columns, no longer excluded, and moves nothing between offers.
const line = (classification, group, amount, description) => ({ classification, group, amount, description, rawDescription: description, unit: "kWh", unitPrice: null, rawUnitPrice: "", rawValue: "", aggregate: false, includedInReconciliation: true });
const components = [
  line("ENERGY_PRICE", "ENERGY_PRICE", "300,00", "Componente energia"),
  line("NETWORK", "REGULATED_NETWORK", "80,00", "Quota energia trasporto"),
  line("ALTRE_PARTITE", "OTHER_ITEMS", "42,46", "Altre partite - Addebito CTS-Corrispettivo Tariffario Specifico"),
];
const totals = { sellerEnergyTotal: 300, sellerCommercializationTotal: 0, sellerOtherTotal: 0, regulatedNetworkTotal: 80, systemChargesTotal: 0, taxTotal: null };
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 280, analysis: { components, totals }, domestic: false, validUntil: null, offerComponents: [{ category: "ENERGY", sign: "CHARGE", amount: { amount: 280 }, label: "Energia" }] });
assert.deepEqual(receipt.excluded, []);
const network = receipt.rows.find((row) => row.key === "NETWORK");
assert.equal(network.current, 122.46);
assert.equal(network.offer, 122.46);
assert.ok(network.details.some((item) => /CTS/.test(item.label) && item.current === 42.46 && item.offer === 42.46));
assert.equal(receipt.currentTotal, 422.46);
assert.equal(receipt.savings, 20);
console.log("receipt CTS included ok");
