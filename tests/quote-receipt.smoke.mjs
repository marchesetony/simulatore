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
// Voci di spesa named as in the bill from 1/4/2026, delibera 386/2025 (Tony, 29/10).
assert.equal(dearer.rows[0].label, "Spesa per la vendita di gas naturale");
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
// 7. Charges aggregated in a quota are still listed one by one (Tony, 26/10): dispatching, capacity and imbalance each get
//    their own bill/CTE line, and a charge only one side has reads as missing on the other instead of disappearing.
const detailed = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 95, domestic: false, validUntil: null, analysis: { totals: { ...scontrinoTotals, sellerEnergyTotal: 70, sellerOtherTotal: 10 }, components: [
  supply("ENERGY_PRICE", "ENERGY_INDEX", "70,00", "€/kWh", "Prezzo energia"), supply("DISPATCHING_OR_PASS_THROUGH", "DISPATCHING_SELLER_CHARGE", "6,00", "€/kWh", "Dispacciamento"),
  supply("CAPACITY_MARKET", "CAPACITY_MARKET_SELLER_CHARGE", "4,00", "€/kWh", "Corrispettivo capacity market"), supply("COMMERCIALIZATION", "PCV", "15,00", "€/mese", "Quota fissa vendita"),
] }, offerComponents: [
  { category: "ENERGY", sign: "CHARGE", amount: { amount: 66 } },
  { category: "VARIABLE_FEE", sign: "CHARGE", label: "Pass-through contrattuale DISPATCHING", formulaInputs: { kind: "DISPATCHING", feeUnit: "EUR_PER_KWH" }, amount: { amount: 6 } },
  { category: "IMBALANCE", sign: "CHARGE", label: "Sbilanciamento", formulaInputs: { feeUnit: "EUR_PER_KWH" }, amount: { amount: 5 } },
  { category: "FIXED_FEE", sign: "CHARGE", label: "Quota fissa business", formulaInputs: { feeUnit: "EUR_PER_MONTH" }, amount: { amount: 15 } },
  { category: "FIXED_FEE", sign: "CHARGE", label: "Opzione Flex pari a 36 €/anno", formulaInputs: { feeUnit: "EUR_PER_YEAR" }, amount: { amount: 3 } },
] });
assert.deepEqual(detailed.quotas[0].details.map((item) => [item.key, item.current, item.offer, item.difference]), [["ENERGY", 70, 66, -4], ["DISPATCHING", 6, 6, 0], ["CAPACITY", 4, null, -4], ["IMBALANCE", null, 5, 5]]);
assert.deepEqual(detailed.quotas[1].details.map((item) => [item.key, item.current, item.offer]), [["PCV", 15, 15], ["OPTIONS", null, 3]]);
// 8. Order asked by Tony (26/10): materia energia, trasporto, oneri di sistema, imposte (accise e IVA) aggregated first,
//    then each charge they contain; the details of a section add up to the section.
assert.deepEqual(detailed.rows.map((row) => row.key), ["ENERGY", "NETWORK", "SYSTEM", "TAXES"]);
assert.deepEqual(detailed.rows[0].details.map((item) => [item.key, item.current, item.offer]), [["ENERGY", 70, 66], ["DISPATCHING", 6, 6], ["CAPACITY", 4, null], ["IMBALANCE", null, 5], ["PCV", 15, 15], ["OPTIONS", null, 3]]);
assert.equal(detailed.rows[0].details.reduce((sum, item) => sum + (item.offer ?? 0), 0), detailed.rows[0].offer);
assert.deepEqual(scontrino.rows[1].details.map((item) => [item.key, item.current, item.offer]), [["CONSUMPTION", 12, 12], ["FIXED", 8, 8], ["POWER", 10, 10]]);
assert.deepEqual(scontrino.rows[3].details.map((item) => [item.label, item.current, item.offer]), [["Accise", 5, 5], ["IVA", 15, 14.3]]);
assert.equal(scontrino.rows[3].label, "Imposte (accise e IVA)");

console.log("quote receipt smoke passed");
// 9. "Sono verificati sui valori ARERA e Terna?" (Tony, 26/10): each regulated section says whether the bill's charges were
//    checked against the official values of the period, and never claims a check that did not happen.
const { regulatedVerification } = await import("../app/lib/quote/receipt.ts");
const auditLine = (code, category, auditStatus, differenceAmount = 0, notComparableReason = "NONE") => ({ code, category, auditStatus, differenceAmount, notComparableReason, description: code });
const audit = { lines: [auditLine("NETWORK_ENERGY", "REGULATED_ARERA", "MATCH"), auditLine("NETWORK_POWER", "REGULATED_ARERA", "ROUNDING_DIFFERENCE"), auditLine("ASOS", "REGULATED_ARERA", "OVERCHARGE", 1.2), auditLine("ARIM", "REGULATED_ARERA", "MATCH"), auditLine("DISPATCHING", "DISPATCHING", "REGULATORY_SOURCE_MISSING", 0, "REGULATORY_SOURCE_MISSING")] };
assert.deepEqual(regulatedVerification(audit, "NETWORK"), { status: "VERIFIED", checked: 2, difference: 0, reason: null });
assert.equal(regulatedVerification(audit, "SYSTEM_CHARGES").status, "DIFFERENCE");
assert.equal(regulatedVerification(audit, "SYSTEM_CHARGES").difference, 1.2);
assert.deepEqual(regulatedVerification(audit, "DISPATCHING"), { status: "NOT_VERIFIABLE", checked: 0, difference: 0, reason: "manca il valore ufficiale del periodo in archivio" });
assert.equal(regulatedVerification(audit, "CAPACITY_MARKET").status, "NOT_AVAILABLE");
assert.equal(regulatedVerification(null, "NETWORK").reason, "verifica non eseguita per questa bolletta");
// Product rule (Tony, 26/10): excise and VAT are not verified, the same excise and VAT apply to the new offer.
console.log("quote receipt regulated verification passed");

// 10. A company with a reduced VAT rate (Tony, 26/10): the agent can apply another rate to the new offer; excise stays the bill's.
const reduced = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: scontrinoTotals }, domestic: false, validUntil: null, offerComponents, offerVatRate: 0.1 });
assert.equal(reduced.vatRate, 0.1); assert.equal(reduced.billVatRate, 0.1);
assert.equal(reduced.offerTotal, scontrino.offerTotal, "choosing the bill's own rate changes nothing");
const higher = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: scontrinoTotals }, domestic: false, validUntil: null, offerComponents, offerVatRate: 0.22 });
// Taxable base 88 + 30 + 10 + 5 excise = 133: VAT 22% = 29,26, taxes = 5 + 29,26.
assert.equal(higher.rows[3].offer, 34.26);
assert.deepEqual(higher.rows[3].details.map((item) => [item.label, item.current, item.offer]), [["Accise", 5, 5], ["IVA", 15, 29.26]]);
assert.equal(higher.vatRate, 0.22); assert.equal(higher.billVatRate, 0.1); assert.equal(higher.vatRateEstimated, false);
console.log("quote receipt vat choice passed");

// 11. Tony (26/10): "non possono esistere voci non verificate, anche se aggregate ... non è detto che la bolletta e la
//     simulazione debbano essere uguali". The simulated column's transport and system charges are the official ARERA
//     amounts the engine computed on the same consumption, and the bill's aggregates (quota energia, fissa, potenza)
//     are checked against them, never just copied across.
const regulatedComponent = (category, componentCode, amount) => ({ category, sign: "CHARGE", label: componentCode, amount: { amount }, formulaInputs: { componentCode } });
const officialComponents = [
  ...offerComponents,
  regulatedComponent("REGULATED_ENERGY", "NETWORK_ENERGY", 6), regulatedComponent("REGULATED_ENERGY", "TRANSMISSION_ENERGY", 5),
  regulatedComponent("REGULATED_FIXED", "NETWORK_FIXED", 8), regulatedComponent("REGULATED_POWER", "NETWORK_POWER", 10),
  regulatedComponent("REGULATED_ENERGY", "ARIM", 2), regulatedComponent("REGULATED_ENERGY", "ASOS", 8),
];
const official = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: scontrinoTotals }, domestic: true, validUntil: null, offerComponents: officialComponents });
assert.deepEqual(official.rows.map((row) => [row.key, row.current, row.offer]), [["ENERGY", 95, 88], ["NETWORK", 30, 29], ["SYSTEM", 10, 10], ["TAXES", 20, 19.2]]);
assert.deepEqual(official.officialCheck.NETWORK, { status: "DIFFERENCE", official: 29, difference: 1, reason: null }, "the bill charges 1 EUR more than ARERA");
assert.equal(official.officialCheck.SYSTEM.status, "VERIFIED");
assert.deepEqual(official.rows[1].details.map((item) => [item.key, item.current, item.offer]), [["CONSUMPTION", 12, 11], ["FIXED", 8, 8], ["POWER", 10, 10]]);
assert.deepEqual(official.rows[0].details.map((item) => item.key), ["ENERGY", "PCV"], "regulated components never land in the materia energia");
assert.equal(official.offerTotal, 146.2);
assert.equal(Math.round(official.quotas.reduce((sum, row) => sum + row.offer, 0) * 100) / 100, official.offerTotal, "the quotas add up to the simulated total");
// Without official values the bill's amounts are carried over and the receipt says why they are not verified.
assert.equal(scontrino.officialCheck.NETWORK.status, "NOT_AVAILABLE");
assert.equal(scontrino.officialCheck.NETWORK.reason, "valori ufficiali ARERA del periodo non calcolati per questa fornitura");
console.log("quote receipt official regulated check passed");

// 12. Base di calcolo approvata da Tony (26/10).
//  - A charge priced only from official values (dispatching, capacity) whose value is missing keeps its line with the reason.
//  - Reactive energy is an ARERA charge of the customer's plant: the same in both columns, under transport.
//  - Prior-period adjustments and the other "altre partite" are listed apart, out of the comparison.
//  - The official check allows only cent rounding: 0,01 EUR per component.
const other = (amount, description) => ({ ...line("ALTRE_PARTITE", amount, description), group: "OTHER_ITEMS", includedInReconciliation: true });
const based = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: [...scontrinoLines, other("13,95", "Energia reattiva"), other("7,58", "Ricalcoli mesi precedenti")], totals: scontrinoTotals }, domestic: true, validUntil: null, offerComponents: officialComponents, warnings: ["OFFICIAL_VALUE_MISSING:DISPATCHING:OFFICIAL_VALUE_MISSING", "OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:PEAK_HOUR_KWH_MISSING"] });
const dispatchingLine = based.rows[0].details.find((item) => item.key === "DISPATCHING");
assert.equal(dispatchingLine.offer, null); assert.equal(dispatchingLine.difference, null);
assert.equal(dispatchingLine.missingReason, "valore ufficiale ARERA/Terna del periodo non in archivio");
assert.equal(based.rows[0].details.find((item) => item.key === "CAPACITY").missingReason, "servono i kWh prelevati nelle ore di picco Terna");
assert.deepEqual([based.rows[1].current, based.rows[1].offer], [43.95, 42.95], "reactive energy 13,95 on both sides; the rest is the official transport");
assert.deepEqual(based.rows[1].details.find((item) => item.key === "REACTIVE"), { key: "REACTIVE", label: "Energia reattiva", current: 13.95, offer: 13.95, difference: 0 });
assert.equal(based.officialCheck.NETWORK.difference, 1, "the check compares transport without the reactive energy");
assert.deepEqual(based.excluded, [{ label: "Ricalcoli mesi precedenti", amount: 7.58 }]);
const rounding = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: { ...scontrinoTotals, systemChargesTotal: 10.02 } }, domestic: true, validUntil: null, offerComponents: officialComponents });
assert.equal(rounding.officialCheck.SYSTEM.status, "VERIFIED", "2 components (ARIM, ASOS): up to 0,02 EUR of rounding");
const beyond = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: { ...scontrinoTotals, systemChargesTotal: 10.03 } }, domestic: true, validUntil: null, offerComponents: officialComponents });
assert.equal(beyond.officialCheck.SYSTEM.status, "DIFFERENCE");
// 13. Tony (27/10): "ancora non si vedono i dati arera e terna". The receipt names what stopped the ARERA tables and
// keeps the CTE's own Capacity Market libero apart from the official capacity charge, whose reason must stay visible.
const why = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: scontrinoTotals }, domestic: true, validUntil: null, offerComponents: [{ category: "VARIABLE_FEE", sign: "CHARGE", label: "Capacity market libero (da CTE)", amount: { amount: 5 }, formulaInputs: { kind: "CAPACITY_MARKET", source: "CTE_STATED_VALUE" } }], warnings: ["OFFICIAL_VALUE_MISSING:REGULATED:SCOPE_UNREGISTERED_NON_DOMESTIC_BT", "OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:PEAK_HOUR_KWH_MISSING", "OFFICIAL_VALUE_MISSING:DISPATCHING:CTE_REFERENCE_MISSING"] });
assert.equal(why.officialCheck.NETWORK.reason, "tabelle ARERA non ancora caricate per questa tipologia di fornitura (NON_DOMESTIC_BT)");
assert.equal(why.rows[0].details.find((item) => item.key === "CAPACITY_CTE").offer, 5);
assert.equal(why.rows[0].details.find((item) => item.key === "CAPACITY").missingReason, "servono i kWh prelevati nelle ore di picco Terna");
assert.equal(why.rows[0].details.find((item) => item.key === "DISPATCHING").missingReason, "la CTE in archivio non indica come si applica: va riletta la CTE");
const powerWhy = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 88, analysis: { components: scontrinoLines, totals: scontrinoTotals }, domestic: true, validUntil: null, warnings: ["OFFICIAL_VALUE_MISSING:REGULATED:AVAILABLE_POWER_MISSING"] });
assert.equal(powerWhy.officialCheck.SYSTEM.reason, "potenza impegnata/disponibile non letta in bolletta (AVAILABLE_POWER_MISSING)");
console.log("quote receipt calculation base passed");
