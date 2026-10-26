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

// 6. ARERA scontrino dell'energia (Tony, 26/10): the same totals split into quota per consumi, quota fissa, quota potenza,
//    excise and VAT, each with the CTE-minus-bill difference; regulated lines stay the bill's, only the seller's part changes.
const supply = (group, classification, amount, unit, description = "") => ({ ...line(classification, amount, description, { unit, rawUnit: unit }), group, includedInReconciliation: true });
const scontrinoTotals = { sellerEnergyTotal: 80, sellerCommercializationTotal: 15, sellerOtherTotal: null, regulatedNetworkTotal: 30, systemChargesTotal: 10, taxTotal: 20 };
const scontrinoLines = [
  supply("ENERGY_PRICE", "ENERGY_INDEX", "80,00", "€/kWh", "Prezzo energia"), supply("COMMERCIALIZATION", "PCV", "15,00", "€/mese", "Quota fissa vendita"),
  supply("REGULATED_NETWORK", "ARERA_NETWORK", "12,00", "€/kWh", "Quota energia trasporto"), supply("REGULATED_NETWORK", "ARERA_NETWORK", "8,00", "€/mese", "Quota fissa trasporto"), supply("REGULATED_NETWORK", "ARERA_NETWORK", "10,00", "€/kW/mese", "Quota potenza"),
  supply("SYSTEM_CHARGES", "ARERA_SYSTEM_CHARGES", "10,00", "€/kWh", "ASOS e ARIM"),
  { ...line("ACCISE", "5,00", "Accisa"), group: "TAX" }, { ...line("IVA", "15,00", "IVA 10%"), group: "TAX" },
];
const offerComponents = [
  { category: "ENERGY", sign: "CHARGE", amount: { amount: 70 } },
  { category: "FIXED_FEE", sign: "CHARGE", amount: { amount: 15 }, formulaInputs: { feeUnit: "EUR_PER_MONTH" } },
  { category: "FIXED_FEE", sign: "CHARGE", amount: { amount: 3 }, formulaInputs: { feeUnit: "EUR_PER_YEAR" } },
];
const scontrino = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: scontrinoTotals }, domestic: true, validUntil: null, offerComponents });
assert.deepEqual(scontrino.quotas.map((row) => [row.key, row.current, row.offer, row.difference]), [
  ["CONSUMPTION", 102, 92, -10], ["FIXED", 23, 26, 3], ["POWER", 10, 10, 0], ["EXCISE", 5, 5, 0], ["VAT", 15, 14.3, -0.7],
]);
assert.equal(scontrino.quotas[1].currentSeller, 15); assert.equal(scontrino.quotas[1].offerSeller, 18, "the yearly Flex fee sits in the quota fissa");
const quotaTotal = scontrino.quotas.reduce((sum, row) => sum + row.current, 0);
assert.equal(Math.round(quotaTotal * 100) / 100, scontrino.currentTotal, "the quotas add up to the bill total");
assert.equal(Math.round(scontrino.quotas.reduce((sum, row) => sum + row.offer, 0) * 100) / 100, scontrino.offerTotal);
// A bill line without a unit is not dropped: it shows as "Altre voci" so the totals still match.
const unplaced = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines.filter((item) => item.description !== "Quota potenza"), totals: scontrinoTotals }, domestic: true, validUntil: null, offerComponents });
assert.deepEqual(unplaced.quotas.find((row) => row.key === "OTHER")?.current, 10);

console.log("quote receipt smoke passed");
