import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { electricityTaxes } from "../app/lib/calculation/electricity-taxes.ts";
import { provenanceOf, regulatedCompleteness, technicalTaxes, BTA1_5_REQUIRED_COMPONENTS } from "../app/lib/calculation/technical-quadrature.ts";
import { buildCurrentBillEconomicAnalysis } from "../app/lib/foundation/bill-economic-analysis.ts";
import { technicalScontrino } from "../app/lib/quote/technical-scontrino.ts";

// Tony (15/11/2026, "Completamento quadratura economica autonoma"): the technical simulation computes its own excise and VAT,
// checks rete e oneri BTA1-5 component by component, says whether the ASOS class is documented or assumed, and never uses
// the bill's taxes. Control case: the real engine output for bill BPower 071808E (October 2026, 10 kWh, 1,5 kW BT altri usi)
// on CTE Be Relax 06.25, read-only from the stored comparison (tests/fixtures, no customer data).
const engine = JSON.parse(readFileSync(new URL("./fixtures/technical-071808E-engine-result.json", import.meta.url), "utf8"));
const period = engine.supplyPeriod;

// 1. Fiscal rules (D.Lgs. 504/1995 art. 52 and Allegato I; D.P.R. 633/1972).
const business = { domestic: false, resident: null, committedPowerKw: 1.5, periodStart: "2026-10-01", periodEnd: "2026-11-01" };
const october = electricityTaxes({ ...business, totalKwh: 10, taxableSupply: 28.56 });
assert.equal(october.status, "DETERMINED");
assert.equal(october.excise.amount, 0.13, "10 kWh x 0,0125 €/kWh = 0,125 → 0,13 (half up)");
assert.deepEqual(october.excise.lines, [{ label: "primi 200.000 kWh del mese", kwh: 10, rate: 0.0125, amount: 0.13 }]);
assert.deepEqual([october.vat.rate, october.vat.base, october.vat.amount], [0.22, 28.69, 6.31], "IVA 22% on supply 28,56 + excise 0,13");
assert.equal(october.totalTaxes, 6.44);
assert.ok(october.assumptions.some((text) => /22%.*dichiarazione/.test(text)), "the 22% for a business is said to rest on the missing 10% declaration");
const tiered = electricityTaxes({ ...business, totalKwh: 250_000, taxableSupply: 50_000 });
assert.equal(tiered.excise.amount, 2875, "200.000 x 0,0125 + 50.000 x 0,0075");
const huge = electricityTaxes({ ...business, totalKwh: 1_500_000, taxableSupply: 200_000 });
assert.equal(huge.excise.amount, 7320, "above 1.200.000 kWh/month: 200.000 x 0,0125 + 4.820 fixed");
const twoMonths = { ...business, periodStart: "2026-09-01", periodEnd: "2026-11-01" };
assert.equal(electricityTaxes({ ...twoMonths, totalKwh: 300_000, taxableSupply: 60_000 }).status, "NOT_DETERMINABLE", "monthly tiers need each month's kWh");
assert.equal(electricityTaxes({ ...twoMonths, totalKwh: 300_000, monthlyKwh: [150_000, 150_000], taxableSupply: 60_000 }).excise.amount, 3750, "two months each in the first tier");
assert.equal(electricityTaxes({ ...twoMonths, totalKwh: 20, taxableSupply: 60 }).excise.amount, 0.25, "a period wholly in the first tier needs no monthly split");
const home = { domestic: true, periodStart: "2026-10-01", periodEnd: "2026-11-01", totalKwh: 200, taxableSupply: 50 };
const nonResident = electricityTaxes({ ...home, resident: false, committedPowerKw: 3 });
assert.deepEqual([nonResident.excise.amount, nonResident.vat.rate, nonResident.vat.amount], [4.54, 0.1, 5.45], "home: 200 x 0,0227; VAT 10% on 54,54");
assert.equal(electricityTaxes({ ...home, resident: true, committedPowerKw: 4.5 }).excise.amount, 4.54, "resident above 3 kW: no exemption");
assert.match(electricityTaxes({ ...home, resident: true, committedPowerKw: 3 }).reasons.join(), /esenzione dell'abitazione di residenza fino a 3 kW/, "the residence exemption is not invented");
assert.match(electricityTaxes({ ...home, resident: null, committedPowerKw: 3 }).reasons.join(), /residenza non indicata/);
assert.match(electricityTaxes({ ...home, resident: false, committedPowerKw: null }).reasons.join(), /potenza impegnata non letta/);
const later = electricityTaxes({ ...business, periodStart: "2027-01-01", periodEnd: "2027-02-01", totalKwh: 10, taxableSupply: 28 });
assert.equal(later.status, "NOT_DETERMINABLE");
assert.match(later.reasons.join(), /aliquote di accisa non verificate/, "rates not checked for 2027 are not assumed");
const noBase = electricityTaxes({ ...business, totalKwh: 10, taxableSupply: null });
assert.deepEqual([noBase.status, noBase.excise.amount, noBase.vat, noBase.totalTaxes], ["NOT_DETERMINABLE", 0.13, null, null], "excise alone, no VAT without the whole taxable amount");
assert.equal(electricityTaxes({ ...business, totalKwh: 10, taxableSupply: 28.56, declaredVatRate: 0.1 }).vat.amount, 2.87, "a documented 10% is applied as declared");

// 2. Rete e oneri BTA1-5: complete only when the 15 mandatory components cover the whole period.
assert.equal(BTA1_5_REQUIRED_COMPONENTS.length, 15);
const assumed = regulatedCompleteness({ ...engine, supplyPeriod: period, asos: { asosClass: "UNKNOWN", temporalStatus: "UNKNOWN" } });
assert.deepEqual([assumed.status, assumed.basis, assumed.tariffClass, assumed.checked.length, assumed.missing], ["COMPLETE", "BTA1_5_COMPONENTS", "BTA1", 15, []], "071808E: the engine's PARTIAL scope hides a complete BTA1 set");
assert.deepEqual([assumed.asos.class, assumed.asos.basis], ["0", "ASSUMED_CLASS_0"]);
assert.match(assumed.asos.note, /classe ASOS 0 ipotizzata/);
assert.equal(regulatedCompleteness({ ...engine, supplyPeriod: period, asos: null }).asos.basis, "ASSUMED_CLASS_0", "no trusted context: assumed");
assert.equal(regulatedCompleteness({ ...engine, supplyPeriod: period, asos: { asosClass: "ASOS_CLASS_0", temporalStatus: "VALID" } }).asos.basis, "DOCUMENTED");
const wrongClass = regulatedCompleteness({ ...engine, supplyPeriod: period, asos: { asosClass: "ASOS_CLASS_2", temporalStatus: "VALID" } });
assert.equal(wrongClass.status, "INCOMPLETE", "a documented class the engine did not apply");
const without = (formulaId) => engine.components.filter((item) => item.formulaId !== formulaId);
const noArim = regulatedCompleteness({ ...engine, components: without("REGULATED_BTA1_5_ARIM_POWER_RATE_TIMES_COMMITTED_KW_TIME"), supplyPeriod: period, asos: null });
assert.deepEqual([noArim.status, noArim.missing], ["INCOMPLETE", ["ARIM quota potenza: non calcolata"]]);
const gap = engine.components.map((item) => item.formulaId === "REGULATED_TRANSMISSION_RATE_TIMES_KWH" ? { ...item, formulaInputs: { ...item.formulaInputs, segmentEnd: "2026-10-20T00:00:00.000Z" } } : item);
assert.deepEqual(regulatedCompleteness({ ...engine, components: gap, supplyPeriod: period, asos: null }).missing, ["trasmissione: non copre tutto il periodo"]);
assert.equal(regulatedCompleteness({ ...engine, warnings: [...engine.warnings, "OFFICIAL_VALUE_MISSING:REGULATED:ASOS"], supplyPeriod: period, asos: null }).status, "INCOMPLETE");
assert.equal(regulatedCompleteness({ ...engine, costScope: "COMMERCIAL_ONLY", supplyPeriod: period, asos: null }).status, "INCOMPLETE");
assert.equal(regulatedCompleteness({ ...engine, warnings: ["SOURCE_BILL_REFERENCE_RECORDED"], supplyPeriod: period, asos: null }).status, "INCOMPLETE", "not every partial scope becomes complete: only the checked BTA1-5 path");
assert.equal(regulatedCompleteness({ ...engine, warnings: [...engine.warnings, "BTA6_ASOS_EXCLUDED_CLASS_UNKNOWN"], supplyPeriod: period, asos: null }).status, "INCOMPLETE");

// 3. Provenance of each line.
const kinds = Object.fromEntries(engine.components.map((item) => [item.label, provenanceOf(item, "ASSUMED_CLASS_0").kinds.join("+")]));
assert.equal(kinds["Energia EE indicizzata F1 2026-10"], "GME+CTE");
assert.equal(kinds["Quote fisse"], "CTE");
assert.equal(kinds["Quote variabili"], "CTE+TIS");
assert.equal(kinds["Dispacciamento"], "TERNA+TIS");
assert.equal(kinds["Capacity market libero (da CTE)"], "CTE");
assert.equal(kinds["Mercato della capacità"], "ARERA+TIS");
assert.equal(kinds["BTA1 quota misura regolata"], "ARERA");
assert.equal(kinds["BTA1 ASOS quota energia regolata"], "ARERA+IPOTESI", "the assumed ASOS class is marked on its lines");
assert.equal(provenanceOf(engine.components.at(-1), "DOCUMENTED").kinds.join("+"), "ARERA");

// 4. The simulation's taxes and total on the real data.
const taxes = technicalTaxes({ vector: "EE", taxTreatment: "EXCLUDED", domestic: false, resident: null, committedPowerKw: 1.5, supplyPeriod: period, bands: { f1: 3, f2: 4, f3: 3 }, monthlyProfile: null, warnings: engine.warnings, regulated: assumed, totalNetOfTaxes: engine.totalCommercialPlusRegulatedSubsetCost });
assert.deepEqual([taxes.status, taxes.excise.amount, taxes.vat.amount, taxes.totalTaxes], ["DETERMINED", 0.13, 6.31, 6.44]);
const totals = { netOfTaxes: 28.56, taxes: 6.44, withTaxes: 35 };
const incompleteTaxes = technicalTaxes({ vector: "EE", taxTreatment: "EXCLUDED", domestic: false, resident: null, committedPowerKw: 1.5, supplyPeriod: period, bands: { f1: 3, f2: 4, f3: 3 }, monthlyProfile: null, warnings: engine.warnings, regulated: noArim, totalNetOfTaxes: 28.56 });
assert.deepEqual([incompleteTaxes.status, incompleteTaxes.vat], ["NOT_DETERMINABLE", null], "no VAT on an incomplete supply cost");
assert.equal(technicalTaxes({ vector: "GAS", taxTreatment: "EXCLUDED", domestic: false, resident: null, committedPowerKw: null, supplyPeriod: period, bands: null, warnings: [], regulated: assumed, totalNetOfTaxes: 10 }).status, "NOT_DETERMINABLE");

// 5. Independence from the bill: the bill as read (aggregate "Accise e IVA" 6,44, total 35,00), then the same bill with only
// its taxes and total changed. Consumption, use and contract data stay the same.
const line = (description, amount, unit = null, quantity = null, code = null, unitPrice = null) => ({ code, description, amount, quantity, unitPrice, unit, period: null });
// The lines as the reader stored them for 071808E (codes and amounts of economicChargeLines, page 2).
const billOf = (taxLine, total) => buildCurrentBillEconomicAnalysis([
  line("Quota per consumi", "3,42 €", "kWh", "10", "OTHER_CHARGE", "0,342"),
  line("Quota per consumi - di cui spesa per la vendita di energia elettrica", "2,92 €", "€/kWh", null, "OTHER_CHARGE", "0,292000"),
  line("Quota per consumi - di cui spesa per la rete e gli oneri generali di sistema", "0,50 €", "€/kWh", null, "NETWORK_SYSTEM", "0,050000"),
  line("Quota fissa", "18,74 €", "mese", "1", "OTHER_CHARGE", "18,74"),
  line("Quota fissa - di cui spesa per la vendita di energia elettrica", "15,00 €", "€/mese", null, "OTHER_CHARGE", "15,00"),
  line("Quota fissa - di cui spesa per la rete e gli oneri generali di sistema", "3,74 €", "€/mese", null, "NETWORK_SYSTEM", "3,74"),
  line("Quota potenza", "6,40 €", "kW", "1,5", "OTHER_CHARGE", "4,266667"),
  line("Quota potenza - di cui spesa per la rete e gli oneri generali di sistema", "6,40 €", "€/kW/mese", null, "NETWORK_SYSTEM", "4,266667"),
  ...taxLine,
  line("Totale bolletta", total, null, null, "BILL_TOTAL"),
], total.replace(" €", ""));
const result = { ...engine, components: engine.components.map((item) => ({ ...item, provenance: provenanceOf(item, "ASSUMED_CLASS_0") })), regulatedCompleteness: assumed, taxes, totals };
const base = { vector: "EE", domestic: false, quantity: 10, months: 1, powerKw: 1.5, result };
const real = technicalScontrino({ ...base, analysis: billOf([line("Accise e IVA", "6,44 €", null, null, "TAX_SUBTOTAL")], "35,00 €") });
const altered = technicalScontrino({ ...base, analysis: billOf([line("Imposta erariale di consumo (accise)", "0,90 €", "€/kWh", "10", "ACCISE", "0,09"), line("IVA 22%", "9,99 €", null, null, "IVA")], "39,45 €") });
const separate = technicalScontrino({ ...base, analysis: billOf([line("Imposta erariale di consumo (accise)", "0,13 €", "€/kWh", "10", "ACCISE", "0,0125"), line("IVA 22%", "6,31 €", null, null, "IVA")], "35,00 €") });
const alone = technicalScontrino({ ...base, analysis: null });
for (const [name, scontrino] of [["altered", altered], ["separate", separate], ["no bill", alone]]) {
  assert.deepEqual(scontrino.offerLines, real.offerLines, `${name}: the simulation column does not move with the bill`);
  assert.deepEqual(scontrino.offerReceipt.quotas, real.offerReceipt.quotas, `${name}: same simulation quotas`);
  assert.equal(scontrino.offerTotal, 35);
}
assert.equal(real.receipt.status, "COMPLETE");
assert.equal(real.billTotal, 35);
assert.equal(real.offerTotal, 35, "28,56 + accise 0,13 + IVA 6,31, all computed");
assert.deepEqual([real.complete, real.difference, real.differencePercent, real.missing], [true, 0, 0, []]);
assert.deepEqual([altered.billTotal, altered.complete, altered.difference, altered.differencePercent], [39.45, true, -4.45, -11.3], "only the bill moves: the difference follows the bill");
const offerTax = (scontrino, label) => scontrino.offerLines.find((item) => item.label === label);
assert.deepEqual([offerTax(real, "Accise e IVA").amount, offerTax(real, "di cui accise").amount, offerTax(real, "di cui IVA").amount, offerTax(real, "di cui IVA").price], [6.44, 0.13, 6.31, "22%"]);
const row = (scontrino, label) => scontrino.rows.find((item) => item.label === label);
assert.deepEqual([row(real, "Accise e IVA").bill.amount, row(real, "Accise e IVA").offer.amount], [6.44, 6.44]);
assert.equal(row(real, "accise e IVA non separate in fattura").offer, null, "the bill prints one aggregate tax line: said on its side only");
assert.deepEqual([row(altered, "di cui accise").bill.amount, row(altered, "di cui accise").offer.amount], [0.9, 0.13]);
assert.ok(real.assumptions.some((text) => /ASOS 0 ipotizzata/.test(text)) && real.assumptions.some((text) => /22%/.test(text)), "the ASOS and VAT hypotheses are explicit");
// The code path: no bill tax quota reaches the simulation column.
const source = readFileSync(new URL("../app/lib/quote/technical-scontrino.ts", import.meta.url), "utf8");
assert.match(source, /buildQuoteReceipt\(\{ \.\.\.common, analysis: null \}\)/);
assert.match(source, /filter\(\(item\) => !TAX_QUOTAS\.includes\(item\.key\)\)/);

// 6. Missing data: no difference and no definitive total.
const noTaxes = technicalScontrino({ ...base, result: { ...result, taxes: later, totals: { netOfTaxes: 28.56, taxes: null, withTaxes: null } }, analysis: billOf([line("Accise e IVA", "6,44 €", null, null, "TAX_SUBTOTAL")], "35,00 €") });
assert.deepEqual([noTaxes.complete, noTaxes.difference, noTaxes.offerTotal], [false, null, 28.56]);
assert.equal(noTaxes.offerLines.find((item) => item.kind === "total").label, "Totale imposte escluse");
assert.equal(noTaxes.rows.find((item) => item.kind === "total").label, "Totale", "two totals of a different kind share no label");
assert.deepEqual(noTaxes.rows.find((item) => item.label === "tipo di totale").offer.price, "Totale imposte escluse");
assert.ok(noTaxes.missing.some((text) => /aliquote di accisa non verificate/.test(text)));
const partialNetwork = technicalScontrino({ ...base, result: { ...result, regulatedCompleteness: noArim, taxes: incompleteTaxes, totals: { netOfTaxes: 28.56, taxes: null, withTaxes: null } }, analysis: billOf([line("Accise e IVA", "6,44 €", null, null, "TAX_SUBTOTAL")], "35,00 €") });
assert.deepEqual([partialNetwork.complete, partialNetwork.difference], [false, null]);
assert.equal(partialNetwork.offerLines.find((item) => item.kind === "total").label, "Totale parziale della simulazione (voci non determinate)");
assert.ok(partialNetwork.missing.includes("rete e oneri ARERA, ARIM quota potenza: non calcolata"));
const untaxedBill = technicalScontrino({ ...base, analysis: billOf([], "28,56 €") });
assert.deepEqual([untaxedBill.taxesIncluded, untaxedBill.offerTaxesDetermined, untaxedBill.complete, untaxedBill.difference, untaxedBill.offerTotal], [false, true, false, null, 35], "a bill without taxes: the simulation keeps its own, no difference");
assert.equal(untaxedBill.rows.find((item) => item.kind === "total").label, "Totale");
const missingDispatching = technicalScontrino({ ...base, result: { ...result, warnings: [...engine.warnings, "OFFICIAL_VALUE_MISSING:DISPATCHING:LOSS_COEFFICIENT_UNAVAILABLE"] }, analysis: billOf([line("Accise e IVA", "6,44 €", null, null, "TAX_SUBTOTAL")], "35,00 €") });
assert.deepEqual([missingDispatching.complete, missingDispatching.difference], [false, null]);
console.log("TECHNICAL_QUADRATURE_AUTONOMA=PASS");
