import assert from "node:assert/strict";

import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculatePreparedOffer } from "../app/lib/calculation/engine.ts";
import { tisTable4LossCoefficient } from "../app/lib/calculation/network-losses.ts";
import { ProductionCteRegulatoryRuntimeResolver } from "../app/lib/calculation/regulatory-runtime-resolvers.ts";

// Tony (15/11/2026, "Correzione perdite e Capacity Market"): the Capacity Market 0,003423 €/kWh of 338/2026 had been read as
// a 0,34% loss factor. Decisions: (1) the regulated capacity charge (TIV 34.8 bis), published net of losses, is grossed up
// once by the BT 10% of TIS Tabella 4; (2) a Capacity Market libero stated "al lordo delle perdite" is not grossed up again;
// (3) the two stay separate. Losses apply to dispatching, imbalance and commercialization only as the CTE states for each
// price, never to PUN or spread the formula does not name, with the values of the billed month. Synthetic data only, shaped
// on the Be Relax 06.25 wording (October 2026, 10 kWh BT).
const tenant = "tenant_network-losses-capacity";
const request = ({ sourceBill = true, calculationDate = "2026-11-14", periodStart = "2026-10-01", periodEnd = "2026-11-01", voltageLevel = "LV" } = {}) => parseSimulationRequest({
  schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate, supplyPeriod: { periodStart, periodEnd },
  customerCategory: "NON_RESIDENTIAL", voltageLevel, currency: "EUR", taxTreatment: "EXCLUDED",
  consumption: { basis: "PERIOD", unit: "KWH", f1: 3, f2: 4, f3: 3 }, ...(sourceBill ? { sourceBill: { billId: "bill-synthetic", version: "v1" } } : {}),
}, tenant);
const fee = (feeId, label, amount, unit, lossTreatment) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED", ...(lossTreatment ? { lossTreatment } : {}) });
const reference = { authority: "ARERA_TERNA", document: "TIS", article: "Art. 24" };
const lossReference = { lossMode: "OFFICIAL_REFERENCE", reference: { authority: "ARERA_TERNA", document: "TIS", table: "Tabella 4", column: "A" }, applicationTargets: ["DISPATCHING", "IMBALANCE", "COMMERCIALIZATION_FEE"], sourceEvidence: "incrementati del fattore ... Tabella 4, colonna A" };
const prepared = () => {
  const value = preparedOffer();
  value.version.contract.commercialTerms = { lossReference, dispatchingReference: value.offer.dispatchingReference, capacityMarketSchedule: value.offer.capacityMarketSchedule };
  return value;
};
const preparedOffer = () => ({
  record: { archiveId: "archive-relax", cteId: "cte-relax" },
  version: { versionId: "version-relax", contract: { tenantId: tenant, vector: "EE", version: "1", supplier: { name: "Fornitore sintetico" }, offer: { code: "RELAX-SYN", name: "Relax sintetica" }, commercialTerms: { lossReference } } },
  offer: {
    schemaVersion: 1, tenantId: tenant, sourceCteId: "cte-relax", sourceCteVersion: "1", approval: { status: "APPROVED" }, offerId: "offer-relax", supplierId: "syn", offerCode: "RELAX-SYN", offerName: "Relax sintetica",
    currency: "EUR", taxTreatment: "EXCLUDED", validity: { periodStart: "2025-11-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" }, vector: "EE",
    pricing: { mode: "INDEXED", reference: "PUN", spread: { amount: 0.025, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" } },
    fixedFees: [fee("pcv", "Quote fisse", 15, "EUR_PER_MONTH")],
    // The CTE calls it "Commercializzazione", the archive row only "Quote variabili": the price's own "al netto delle
    // perdite" decides, not the label.
    variableFees: [fee("relax-variable", "Quote variabili", 0.003, "EUR_PER_KWH", "NET_OF_LOSSES")],
    imbalance: { status: "DECLARED", component: fee("relax-imbalance", "Sbilanciamento", 0.005, "EUR_PER_KWH", "NET_OF_LOSSES") },
    oneOffFees: [], commercialDiscounts: [],
    dispatchingReference: { mode: "OFFICIAL_PASS_THROUGH", reference, formula: "Corrispettivo Art. 24 TIS con fattore perdite Tabella 4 colonna A TIS", lossTreatment: "OFFICIAL_REFERENCE", snapshotValue: 0.01155, snapshotUnit: "EUR_PER_KWH", effectiveFrom: "2025-11-01", effectiveTo: "2026-12-31", sourceEvidence: "attualmente pari a 0,01155 Eur/kWh" },
    lossReference,
    capacityMarketSchedule: [
      { voltageScope: "LV", timeClass: "ALL", value: 0.00559, unit: "EUR_PER_KWH", mode: "OFFICIAL_PASS_THROUGH", effectiveFrom: "2025-11-01", effectiveTo: "2026-12-31", lossTreatment: "NOT_DECLARED", officialReference: { authority: "ARERA", document: "TIV", article: "comma 34.8 bis" }, sourceEvidence: "attualmente pari a 0,00559 Eur/kWh in bassa tensione" },
      { timeClass: "CAPACITY_MARKET_LIBERO", value: 0.007, unit: "EUR_PER_KWH", mode: "FIXED_VALUE", effectiveFrom: "2025-11-01", effectiveTo: "2026-12-31", lossTreatment: "GROSS_OF_LOSSES", sourceEvidence: "Capacity Market libero pari a 0,007 Eur/kWh al lordo delle perdite di rete" },
    ],
  },
  markets: [{ month: "2026-10", record: { vector: "EE", f1: { value: 233.39 }, f2: { value: 252.14 }, f3: { value: 215.88 } } }],
});
// The archive of the synthetic tenant: Terna TIDE Q4 2026 and the ARERA capacity values of 338/2026 (art. 4.1), both
// published net of losses. Runtime lookups are recorded to check the date they are asked for.
const tide = { componentCode: "DISPATCHING_TOTAL", regulatoryVariant: "TIDE", customerScope: "NON_DOMESTIC_BT", normalizedUnit: "EUR/KWH", normalizedValue: 0.009888, effectiveFrom: "2026-10-01", effectiveTo: "2027-01-01", officialIdentifier: "TERNA_TIDE_2026Q4", sourceReference: "https://www.terna.it/", retrievedAt: "2026-10-02T00:00:00.000Z" };
const capacity = (month, value) => ({ componentCode: "CAPACITY_MARKET", customerScope: "ALL_ELECTRICITY", normalizedUnit: "EUR/KWH", normalizedValue: value, effectiveFrom: `${month}-01`, effectiveTo: null, officialIdentifier: `338/2026/R/eel:art.4.1:${month}`, sourceReference: "https://www.arera.it/", retrievedAt: "2026-10-02T00:00:00.000Z" });
const stored = [tide, capacity("2026-10", 0.003423), capacity("2026-11", 0.003423), capacity("2026-12", 0.009243)];
const asked = [];
const deps = (resolver = { resolveDispatching: async (input) => { asked.push(input.effectiveAt); return null; }, resolveCapacity: async (input) => { asked.push(input.effectiveAt); return null; }, resolveLoss: async () => null }) => ({ regulatoryRuntimeResolver: resolver, regulatoryBridge: { list: async () => stored } });
const line = (result, predicate) => result.components.filter(predicate);
const amountOf = (result, predicate) => line(result, predicate).map((component) => component.amount.amount);
const quote = await calculatePreparedOffer(request(), prepared(), deps());

// TIS Tabella 4 colonna A, BT, October 2026: 10% (117/2022/R/eel, confirmed for 2026 by 430/2025/R/eel).
const coefficient = tisTable4LossCoefficient("LV", "2026-10-01", "2026-11-01");
assert.equal(coefficient?.percent, 10);
assert.equal(coefficient?.kind, "NETWORK_LOSS_PERCENTAGE");
assert.match(coefficient?.source ?? "", /117\/2022/);
assert.equal(tisTable4LossCoefficient("MV", "2026-10-01", "2026-11-01")?.percent, 3.8);
// A period the verified table does not cover has no coefficient (never a guessed one).
assert.equal(tisTable4LossCoefficient("LV", "2026-12-01", "2027-02-01"), null);
assert.equal(tisTable4LossCoefficient("LV", "2022-12-01", "2023-01-01"), null);

// Regulated capacity, net of losses: grossed up once. 0,003423 x 1,10 x 10 kWh = 0,0377 -> 0,04.
const regulatedCapacity = line(quote, (component) => component.formulaInputs?.capacityNature === "REGULATED");
assert.equal(regulatedCapacity.length, 1);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
near(regulatedCapacity[0].formulaInputs.officialRate, 0.003423);
assert.equal(regulatedCapacity[0].formulaInputs.feeRate, 0.003765);
assert.equal(regulatedCapacity[0].formulaInputs.lossPercent, 10);
assert.equal(regulatedCapacity[0].amount.amount, 0.04);
// Capacity Market libero "al lordo delle perdite": no further losses. 0,007 x 10 kWh = 0,07; kept apart from the regulated one.
const libero = line(quote, (component) => component.formulaInputs?.capacityNature === "CONTRACTUAL");
assert.equal(libero.length, 1);
assert.equal(libero[0].formulaInputs.feeRate, 0.007);
assert.equal(libero[0].formulaInputs.lossFactor, 0);
assert.equal(libero[0].formulaInputs.lossTreatment, "GROSS_OF_LOSSES");
assert.equal(libero[0].amount.amount, 0.07);
assert.equal(line(quote, (component) => component.formulaInputs?.kind === "CAPACITY_MARKET").length, 2, "no duplicate capacity line");

// Dispatching: Terna TIDE Q4 2026 x 1,10 because the CTE increases it by the Tabella 4 factor. 0,0108768 x 10 = 0,11.
const dispatching = line(quote, (component) => component.formulaInputs?.kind === "DISPATCHING");
assert.equal(dispatching.length, 1);
near(dispatching[0].formulaInputs.officialRate, 0.009888);
assert.equal(dispatching[0].formulaInputs.feeRate, 0.010877);
assert.equal(dispatching[0].amount.amount, 0.11);
// Imbalance 0,005 "al netto delle perdite": x 1,10 = 0,055 -> 0,06 (half up on the exact amount, no intermediate rounding).
assert.deepEqual(amountOf(quote, (component) => component.category === "IMBALANCE"), [0.06]);
assert.equal(line(quote, (component) => component.category === "IMBALANCE")[0].formulaInputs.lossPercent, 10);
// Commercialization 0,003 "al netto delle perdite", whatever its label: x 1,10 = 0,033 -> 0,03, with the 10% recorded.
const commercialization = line(quote, (component) => component.formulaInputs?.feeId === "relax-variable")[0];
assert.equal(commercialization.formulaInputs.lossPercent, 10);
assert.equal(commercialization.formulaInputs.feeRate, 0.003, "the CTE's original price is kept");
assert.equal(commercialization.amount.amount, 0.03);
// A seller price stated "al lordo delle perdite" is never grossed up.
const grossFees = prepared(); grossFees.offer.imbalance.component.lossTreatment = "GROSS_OF_LOSSES"; grossFees.offer.variableFees[0].lossTreatment = "GROSS_OF_LOSSES";
const grossFeesQuote = await calculatePreparedOffer(request(), grossFees, deps());
assert.equal(line(grossFeesQuote, (component) => component.category === "IMBALANCE")[0].formulaInputs.lossFactor, undefined);
assert.equal(line(grossFeesQuote, (component) => component.formulaInputs?.feeId === "relax-variable")[0].formulaInputs.lossFactor, undefined);

// PUN and spread: the CTE does not state losses on them, so there is no losses line. 2,61 of energy only.
assert.deepEqual(amountOf(quote, (component) => component.formulaInputs?.kind === "LOSSES"), []);
assert.deepEqual(amountOf(quote, (component) => component.category === "ENERGY"), [0.78, 1.11, 0.72]);
// Only when the CTE names the index are its losses priced: 2,35637 € of PUN x 10% = 0,24.
const indexed = prepared(); indexed.offer.lossReference = { ...lossReference, applicationTargets: [...lossReference.applicationTargets, "ENERGY_INDEX"] };
const indexedLosses = line(await calculatePreparedOffer(request(), indexed, deps()), (component) => component.formulaInputs?.kind === "LOSSES");
assert.deepEqual(indexedLosses.map((component) => component.amount.amount), [0.24]);
assert.equal(indexedLosses[0].formulaInputs.spreadIncluded, false);

// Total of the seller side: 2,61 + 15 + 0,03 + 0,06 + 0,11 + 0,07 + 0,04 = 17,92.
assert.equal(quote.totalCommercialCost.amount, 17.92);

// Values of the billed month, never of the calculation day: the same October bill calculated on 20 January 2027 still uses
// TIDE Q4 2026, 0,3423 c€/kWh of October and the 2026 Tabella 4; the runtime archive is asked for the billed period.
asked.length = 0;
const late = await calculatePreparedOffer(request({ calculationDate: "2027-01-20" }), prepared(), deps());
assert.ok(asked.length > 0 && asked.every((date) => date === "2026-10-01"), asked.join(","));
assert.equal(late.totalCommercialCost.amount, 17.92);
near(line(late, (component) => component.formulaInputs?.capacityNature === "REGULATED")[0].formulaInputs.officialRate, 0.003423);
// A December bill takes December's 0,9243 c€/kWh: 0,009243 x 1,10 x 10 = 0,10.
const december = await calculatePreparedOffer(request({ periodStart: "2026-12-01", periodEnd: "2027-01-01" }), prepared(), deps());
assert.equal(line(december, (component) => component.formulaInputs?.capacityNature === "REGULATED")[0].amount.amount, 0.1);
// A runtime value valid only from a later date than the billed period is not used for it.
const laterValue = { kind: "CAPACITY_MARKET", value: 0.05, unit: "EUR/KWH", authority: "ARERA", officialIdentifier: "LATER", sourceReference: "https://www.arera.it/", effectiveFrom: "2026-11-01", effectiveTo: null, recordId: "later", recordVersion: "1", provenance: { sourceSha256: "a".repeat(64), checksum: "c", applicationBasis: "al netto delle perdite" } };
const laterQuote = await calculatePreparedOffer(request(), prepared(), deps({ resolveDispatching: async () => null, resolveCapacity: async () => laterValue, resolveLoss: async () => null }));
near(line(laterQuote, (component) => component.formulaInputs?.capacityNature === "REGULATED")[0].formulaInputs.officialRate, 0.003423);

// No €/kWh charge is a loss percentage: the production resolver returns no loss factor even for the Capacity Market record
// whose basis says "al netto delle perdite TIS tabella 4", and a €/kWh value handed as runtime loss is ignored.
const capacityRecord = { id: "arera_capacity", vector: "EE", tenantId: tenant, authority: "ARERA", sourceType: "OFFICIAL_PROVVEDIMENTO", componentCode: "CAPACITY_MARKET", customerScope: "ALL_ELECTRICITY", referenceDomain: "CAPACITY_MARKET", normalizedUnit: "EUR/KWH", normalizedValue: 0.003423, officialIdentifier: "338/2026/R/eel:art.4.1:2026-10", applicationBasis: "commi 34.8, 41.9 e 48.9 (BT fino a 55 kW), al netto delle perdite TIS tabella 4", effectiveFrom: "2026-10-01", effectiveTo: "2026-11-01" };
const productionResolver = new ProductionCteRegulatoryRuntimeResolver({ list: async () => [capacityRecord] });
assert.equal(await productionResolver.resolveLoss({ tenantId: tenant, effectiveAt: "2026-10-01", customerScope: "NON_DOMESTIC_BT", voltageLevel: "LV" }, lossReference.reference), null);
const monetaryLoss = { ...laterValue, kind: "LOSS_FACTOR", value: 0.003423, effectiveFrom: "2026-10-01" };
const runtimeOfFake = { resolveDispatching: async () => null, resolveCapacity: async () => null, resolveLoss: async () => monetaryLoss };
const monetaryQuote = await calculatePreparedOffer(request(), prepared(), deps(runtimeOfFake));
assert.equal(monetaryQuote.totalCommercialCost.amount, 17.92);
assert.ok(monetaryQuote.components.every((component) => component.formulaInputs?.lossFactor === undefined || component.formulaInputs.lossFactor === 0 || component.formulaInputs.lossFactor === 0.1), "only the 10% coefficient");

// Without a verified Tabella 4 coefficient for the period, the charges that need one are not priced and say why.
const unverifiedPeriod = await calculatePreparedOffer(request({ periodStart: "2027-01-01", periodEnd: "2027-02-01" }), (() => { const offer = prepared(); offer.offer.validity = { periodStart: "2025-11-01", periodEnd: "2027-12-31" }; offer.offer.dispatchingReference.effectiveTo = "2027-12-31"; offer.offer.capacityMarketSchedule.forEach((entry) => { entry.effectiveTo = "2027-12-31"; }); offer.markets = [{ month: "2027-01", record: { vector: "EE", f1: { value: 100 }, f2: { value: 100 }, f3: { value: 100 } } }]; return offer; })(), { ...deps(), regulatoryBridge: { list: async () => [...stored, { ...tide, effectiveFrom: "2027-01-01", effectiveTo: "2027-04-01" }, capacity("2027-01", 0.005)] } });
assert.ok(unverifiedPeriod.warnings.includes("OFFICIAL_VALUE_MISSING:LOSSES:TIS_TABLE_4_NOT_VERIFIED_FOR_PERIOD"), unverifiedPeriod.warnings.join(","));
assert.ok(unverifiedPeriod.warnings.includes("OFFICIAL_VALUE_MISSING:DISPATCHING:LOSS_COEFFICIENT_UNAVAILABLE"), unverifiedPeriod.warnings.join(","));
assert.ok(unverifiedPeriod.warnings.includes("OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:LOSS_COEFFICIENT_UNAVAILABLE"), unverifiedPeriod.warnings.join(","));
assert.equal(line(unverifiedPeriod, (component) => component.formulaInputs?.capacityNature === "REGULATED").length, 0);

// Ordinary simulations (no source bill): no pass-through is added and a CTE referring to Tabella 4 is not blocked.
const official = (kind, value) => ({ ...laterValue, kind, value, effectiveFrom: "2026-10-01" });
const ordinary = await calculatePreparedOffer(request({ sourceBill: false }), prepared(), deps({ resolveDispatching: async () => official("DISPATCHING", 0.009888), resolveCapacity: async () => official("CAPACITY_MARKET", 0.003423), resolveLoss: async () => null }));
assert.equal(line(ordinary, (component) => String(component.formulaId).startsWith("CTE_PASS_THROUGH")).length, 0);
assert.equal(ordinary.totalCommercialCost.amount, 2.61 + 15 + 0.03 + 0.05);
console.log("NETWORK_LOSSES_CAPACITY=PASS");
