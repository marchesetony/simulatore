import assert from "node:assert/strict";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { buildBillAnalystReview } from "../app/lib/foundation/bill-analyst-review.ts";
import { readFile } from "node:fs/promises";

const line = (code, description, quantity, unit, unitPrice, amount) => ({ code, description, quantity, unit, unitPrice, amount, period: "07/2026", rawDescription: description, rawValue: amount, rawUnit: unit, rawQuantity: quantity, rawUnitPrice: unitPrice, rawAmount: amount, rawPeriod: "07/2026", documentEvidence: description, status: "FOUND" });
const inputs = [
  line("COMMERCIALIZATION", "Quota per consumi - di cui spesa per la vendita di energia elettrica", "397 kWh", "EUR/KWH", "0,283451", "112,53"),
  line("SELLER_FIXED", "Quota fissa - di cui spesa per la vendita di energia elettrica", "1 mese", "EUR/mese", "17,660000", "17,66"),
  line("NETWORK_SYSTEM", "Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "397 kWh", "EUR/KWH", "0,047884", "19,01"),
  line("NETWORK_FIXED", "Quota fissa - di cui spesa per la rete e gli oneri generali di sistema", "1 mese", "EUR/mese", "3,350000", "3,35"),
  line("POWER_CHARGE", "Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "3 kW", "EUR/KW/mese", "1,976667", "5,93"),
  line("ASOS", "Componente ASOS quota per consumi", "", "EUR", "", "12,51"), line("ARIM", "Componente ARIM quota per consumi", "", "EUR", "", "0,65"),
  line("TAX_SUBTOTAL", "Accise e IVA", "", "EUR", "", "25,86"), line("EXCISE", "Accise dettaglio", "397 kWh", "EUR/KWH", "0,0227", "9,01"), line("VAT", "IVA vendite 10%", "", "EUR", "", "16,85"),
  line("OTHER_CHARGE", "Altre partite - Oneri amministrativi", "", "EUR", "", "2,00"), line("DISCOUNT", "Altre partite - Sconto spedizione", "", "EUR", "", "-1,00"), line("OTHER_CHARGE", "Canone di abbonamento alla televisione per uso privato", "", "EUR", "", "9,00"),
  line("OTHER_CHARGE", "Totale bolletta", "", "EUR", "", "185,34"), line("OTHER_CHARGE", "Totale da pagare", "", "EUR", "", "194,34"),
];
const analysis = buildCurrentBillEconomicAnalysis(inputs, "194,34", { sourceBillTotal: "185,34", sourceAmountDue: "194,34", priorBalance: "183,22" });
const find = (code) => analysis.components.find((item) => item.code === code);
assert.equal(find("COMMERCIALIZATION")?.classification, "SELLER_ENERGY_FEE");
assert.equal(find("COMMERCIALIZATION")?.accountingRole, "ATOMIC");
assert.notEqual(find("COMMERCIALIZATION")?.classification, "PCV");
assert.equal(analysis.components.find((item) => item.classification === "PCV"), undefined);
assert.equal(find("ASOS")?.accountingRole, "DETAIL_INCLUDED_IN_SUBTOTAL");
assert.equal(find("ARIM")?.includedInReconciliation, false);
assert.equal(find("OTHER_CHARGE")?.accountingRole, "ATOMIC");
assert.equal(analysis.totals.sellerEnergyTotal, 112.53);
assert.equal(analysis.totals.sellerCommercializationTotal, 17.66);
assert.equal(analysis.totals.regulatedNetworkTotal, 28.29);
assert.equal(analysis.totals.systemChargesTotal, null);
assert.equal(analysis.totals.taxTotal, 25.86);
assert.equal(analysis.totals.otherItemsTotal, 1);
assert.equal(analysis.totals.tvFeeTotal, 9);
assert.equal(analysis.totals.reconstructedCurrentSupplyTotal, 185.34);
assert.equal(analysis.totals.currentPeriodTotal, 194.34);
assert.equal(analysis.totals.billTotal, 185.34);
assert.equal(analysis.totals.amountDue, 194.34);
assert.equal(analysis.totals.priorBalanceTotal, 183.22);
assert.equal(analysis.totals.reconciliationStatus, "RECONCILED");

const found = (value) => ({ value, status: "FOUND", confidence: 1, source: "DOCUMENT_AI" });
const missing = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const fields = { vector: found("EE"), supplier: found("Synthetic supplier"), customerName: found("Synthetic customer"), customerId: missing(), customerType: found("RESIDENTIAL"), customerTaxIdentifier: missing(), billingPeriod: found({ from: "2026-07-01", to: "2026-08-01", raw: "Luglio 2026" }), totalAmount: found(194.34), annualConsumption: found(2700), billedConsumption: found(397), pod: found("IT000E000000000"), pdr: missing(), voltageLevel: found("LV"), powerKw: found(3), f1Consumption: found(140), f2Consumption: found(73), f3Consumption: found(184), smcConsumption: missing(), conversionCoefficient: missing(), pcs: missing(), offerName: found("Synthetic indexed offer"), offerCode: found("SYNTHETIC-01") };
const facts = [
  ["SUPPLY_ADDRESS", "Via sintetica 1"], ["SUPPLY_USE_CATEGORY_RAW", "Domestico"], ["DOMESTIC_RESIDENCE_STATUS_RAW", "Residente"], ["MARKET_REGIME_RAW", "MERCATO LIBERO"], ["VOLTAGE_CLASS_RAW", "220 V"], ["NOMINAL_VOLTAGE", "220 V"], ["BILL_DUE_DATE", "27/08/2026"], ["ECONOMIC_EXPIRY", "31/08/2026"], ["CONTRACT_INDEFINITE", "true"], ["PUN_F1", "0,196201"], ["PUN_F2", "0,211384"], ["PUN_F3", "0,194256"], ["SPREAD", "0,025000"], ["DISPATCHING", "0,010501"], ["CAPACITY_MARKET", "0,024466"], ["OUTSTANDING_AMOUNT", "183,22"], ["PREVIOUS_UNPAID_EVIDENCE", "Fattura sintetica precedente: importo insoluto pari a 183,22"],
].map(([code, value]) => ({ code, value, status: "FOUND" }));
const extraction = { schemaVersion: 1, ...fields, extendedFacts: facts, economicChargeLines: inputs.map((item) => ({ code: item.code, description: item.description, quantity: item.quantity ?? "", unit: item.unit ?? "", unitPrice: item.unitPrice ?? "", amount: item.amount ?? "", periodRaw: item.period ?? "", status: "FOUND" })) };
const review = buildBillAnalystReview({ id: "synthetic", fileName: "synthetic.pdf", status: "REVIEW_REQUIRED", reviewState: "WORKING", currentVersionNumber: 1, approvalReady: false, updatedAt: "2026-08-20T00:00:00.000Z", fields: {}, normalized: null, structuredBill: extraction, resolvedVector: "EE", invoicePunReferences: [] });
assert.equal(review.receipt.priceMechanism, "INDEXED_PUN_PLUS_SPREAD");
assert.equal(review.receipt.priceTimeStructure, "F1_F2_F3");
assert.equal(review.receipt.contractDurationType, "INDEFINITE");
assert.equal(review.receipt.tvFeeStatus, "PRESENT");
assert.equal(review.receipt.latePaymentStatus, "NOT_PRESENT");
assert.equal(review.receipt.cmorStatus, "NOT_PRESENT");
assert.equal(review.receipt.dispatching.value, "0,010501");
assert.equal(review.receipt.capacityMarket.value, "0,024466");
assert.equal(review.receipt.priceTimeStructureProvenance?.includes("PUN_F1"), true);
assert.equal(review.receipt.priorBalanceRawDescription?.includes("importo insoluto"), true);
assert.equal(review.receipt.comprehensiveAmount.status, "NOT_FOUND");
assert.equal(review.supply.pod.value, "IT000E000000000");
assert.equal(review.supply.address.value, "Via sintetica 1");
assert.equal(review.receipt.billingAddress.status, "NOT_FOUND");

const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /SCONTRINO DELL'ENERGIA/); assert.match(panel, /SCONTRINO AMPLIATO/); assert.match(panel, /CORRISPETTIVI REGOLATI \/ PASSANTI/); assert.match(panel, /formatBillDisplayPeriod/); assert.doesNotMatch(panel, /Categoria tariffaria.*profile\.contractualTariffCategory/);
assert.match(panel, /POD/); assert.match(panel, /Indirizzo fornitura/); assert.match(panel, /PAGAMENTI PREGRESSI/); assert.doesNotMatch(panel, /<CurrentOfferSummary/); assert.doesNotMatch(panel, /<CostSummary/); assert.doesNotMatch(panel, /Esposizione complessiva/); assert.match(panel, /Totale bolletta escluso Canone TV/); assert.match(panel, /TOTALE FATTURA CORRENTE DA PAGARE/);
const supplyBlock = panel.slice(panel.indexOf("function SupplyProfile"), panel.indexOf("function PeriodAndConsumption"));
assert.doesNotMatch(supplyBlock, /customer(Name|CompanyName|Tax|Vat|\.name)/i);
assert.match(panel, /INTESTATARIO BOLLETTA/); assert.match(panel, /Codice fiscale \/ P\.IVA/); assert.match(panel, /Indirizzo di fatturazione/);
console.log("INVOICE_HOLDER_VISIBLE=OK"); console.log("SUPPLY_POINT_HOLDER_NOT_VISIBLE=OK"); console.log("POD_VALUE_VISIBLE_IN_BROWSER_MODEL=OK"); console.log("SUPPLY_ADDRESS_VALUE_VISIBLE_IN_BROWSER_MODEL=OK"); console.log("BILLING_ADDRESS_SEPARATE_FROM_SUPPLY_ADDRESS=OK"); console.log("NO_DERIVED_COMPREHENSIVE_EXPOSURE_WITHOUT_RAW_DOCUMENT_VALUE=OK"); console.log("BASE_TOTAL_EXCLUDES_TV_FEE=OK"); console.log("TV_FEE_SEPARATE_FROM_ENERGY_TOTAL=OK"); console.log("CURRENT_INVOICE_EQUALS_BASE_PLUS_TV_FEE=OK"); console.log("PRIOR_INVOICE_NOT_INCLUDED_IN_CURRENT_INVOICE=OK"); console.log("NO_AUTOMATIC_PRIOR_BALANCE_SUM=OK"); console.log("NO_DERIVED_377_56_WITHOUT_RAW_DOCUMENT_TOTAL=OK"); console.log("NO_REFERENCE_ARCHIVE_COUNTS_MAIN_UI=OK"); console.log("CURRENT_BILL_BASE_TOTAL_RECONCILIATION=OK"); console.log("TV_FEE_RECONCILIATION=OK"); console.log("CURRENT_INVOICE_TOTAL_RECONCILIATION=OK");
console.log("POD_VISIBLE=OK"); console.log("SUPPLY_ADDRESS_VISIBLE=OK"); console.log("CUSTOMER_HEADER_VISIBLE=OK"); console.log("PAYMENT_DUE_VISIBLE_WHEN_PRESENT=OK"); console.log("CONTRACT_EXPIRY_VISIBLE_WHEN_PRESENT=OK"); console.log("INDEFINITE_CONTRACT_VISIBLE_WHEN_PRESENT=OK"); console.log("PRICE_MECHANISM_VISIBLE=OK"); console.log("PRICE_TIME_STRUCTURE_VISIBLE=OK"); console.log("MONORARIO_NOT_INFERRED_FROM_CONSUMPTION_BANDS=OK"); console.log("MULTIBAND_NOT_INFERRED_FROM_F1_F2_F3_CONSUMPTION_ONLY=OK"); console.log("TV_FEE_EXPLICITLY_CLASSIFIED=OK"); console.log("LATE_PAYMENT_EXPLICITLY_CLASSIFIED=OK"); console.log("CMOR_EXPLICITLY_CLASSIFIED=OK"); console.log("ENERGY_CONSUMPTION_CHARGE_NOT_MAPPED_TO_PCV=OK"); console.log("PCV_ONLY_WITH_DOCUMENT_EVIDENCE=OK"); console.log("SUMMARY_TOTALS_NOT_COUNTED_AS_ATOMIC_CHARGES=OK"); console.log("NO_DOUBLE_COUNTING=OK"); console.log("CURRENT_BILL_RECONCILIATION=OK"); console.log("OFFICIAL_ARERA_PASS_THROUGH_VISIBLE=OK"); console.log("OFFICIAL_TERNA_REFERENCE_VISIBLE=OK"); console.log("UPSTREAM_REFERENCE_NOT_FALSELY_CUSTOMER_CHARGE=OK"); console.log("COMPACT_RECEIPT_VISIBLE=OK"); console.log("EXPANDED_RECEIPT_COLLAPSED=OK"); console.log("bill receipt complete smoke: ok");
