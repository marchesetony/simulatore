import assert from "node:assert/strict";

import { billVatRate, buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

const line = (classification, amount, description = "", extra = {}) => ({ classification, amount, description, rawDescription: description, unitPrice: null, rawUnitPrice: "", rawValue: "", aggregate: false, ...extra });
const totals = { sellerEnergyTotal: 80, sellerCommercializationTotal: 12, sellerOtherTotal: 8, regulatedNetworkTotal: 30, systemChargesTotal: 10, taxTotal: 20 };

// 1. The VAT rate printed on the bill wins; otherwise it is implied by the amounts.
assert.equal(billVatRate({ components: [line("IVA", "14,00", "IVA 10%")], totals }), 0.1);
assert.equal(billVatRate({ components: [line("IVA", "31,24"), line("ACCISE", "2,00")], totals }), 0.22);
assert.equal(billVatRate({ components: [line("IVA", "3,00")], totals }), null, "an implausible ratio is not a rate");

// 2. Only the supply cost changes; VAT follows it, transport, system charges and excise stay the same.
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 80, analysis: { components: [line("IVA", "14,00", "IVA 10%")], totals }, domestic: true, validUntil: "2026-11-30" });
assert.equal(receipt.status, "COMPLETE");
assert.deepEqual(receipt.rows.map((row) => [row.key, row.current, row.offer]), [["ENERGY", 100, 80], ["NETWORK", 30, 30], ["SYSTEM", 10, 10], ["TAXES", 20, 18]]);
assert.equal(receipt.currentTotal, 160);
assert.equal(receipt.offerTotal, 138);
assert.equal(receipt.savings, 22);
assert.equal(receipt.savingsPercent, 13.8);
assert.equal(receipt.vatRateEstimated, false);
assert.equal(receipt.validUntil, "2026-11-30");

// 3. A dearer offer shows a negative saving rather than hiding it.
const dearer = buildQuoteReceipt({ vector: "GAS", offerSupplyCost: 120, analysis: { components: [], totals }, domestic: false, validUntil: null });
assert.equal(dearer.vatRate, 0.22); assert.equal(dearer.vatRateEstimated, true);
assert.equal(dearer.rows[0].label, "Spesa per la materia gas naturale");
assert.equal(dearer.savings, -24.4);

// 4. Without the bill's supply cost there is nothing to compare against.
const offerOnly = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 50, analysis: { components: [], totals: { ...totals, sellerEnergyTotal: null, sellerCommercializationTotal: null, sellerOtherTotal: null } }, domestic: true, validUntil: "2026-12-31" });
assert.equal(offerOnly.status, "OFFER_ONLY"); assert.equal(offerOnly.savings, null); assert.equal(offerOnly.rows[0].offer, 50);

// 5. Without taxes on the bill both totals are compared net of taxes.
const netOfTax = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 90, analysis: { components: [], totals: { ...totals, taxTotal: null } }, domestic: true, validUntil: null });
assert.equal(netOfTax.taxesIncluded, false); assert.equal(netOfTax.currentTotal, 140); assert.equal(netOfTax.offerTotal, 130);

console.log("quote receipt smoke passed");
