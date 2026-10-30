import assert from "node:assert/strict";

import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculatePreparedOffer } from "../app/lib/calculation/engine.ts";

// Tony (26/10): "sulla CTE mancano tutti i costi, hai messo solo spread". On a competitor bill the CTE's dispatching and
// capacity market charges are priced: the official value when resolved, else the value the CTE states ("attualmente pari a").
const tenant = "tenant_cte-pass-through-bill-quote";
const request = (sourceBill) => parseSimulationRequest({
  schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-09-15", supplyPeriod: { periodStart: "2026-09-01", periodEnd: "2026-10-01" },
  customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED",
  consumption: { basis: "PERIOD", unit: "KWH", f1: 500, f2: 300, f3: 200 }, ...(sourceBill ? { sourceBill: { billId: "bill-1", version: "v1" } } : {}),
}, tenant);
const reference = { authority: "ARERA_TERNA", document: "TIS", article: "24" };
const prepared = {
  record: { archiveId: "archive-pt", cteId: "cte-pt" },
  version: { versionId: "version-pt", contract: { tenantId: tenant, vector: "EE", version: "1", supplier: { name: "BPower" }, commercialTerms: {} } },
  offer: {
    schemaVersion: 1, tenantId: tenant, sourceCteId: "cte-pt", sourceCteVersion: "1", approval: { status: "APPROVED" }, offerId: "offer-pt", supplierId: "bpower", offerCode: "BESPECIAL26", offerName: "Be Special",
    currency: "EUR", taxTreatment: "EXCLUDED", validity: { periodStart: "2026-08-03", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
    fixedFees: [], variableFees: [], imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" }, oneOffFees: [], commercialDiscounts: [], vector: "EE",
    pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.1, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
    dispatchingReference: { mode: "OFFICIAL_PASS_THROUGH", reference, formula: "Art. 24 TIS", lossTreatment: "OFFICIAL_REFERENCE", snapshotValue: 0.01155, snapshotUnit: "EUR_PER_KWH", effectiveFrom: "2026-08-03", effectiveTo: "2027-01-01", sourceEvidence: "attualmente pari a 0,01155 Eur/kWh" },
    capacityMarketSchedule: [
      { voltageScope: "LV", timeClass: "ALL", value: 0.01349, unit: "EUR_PER_KWH", mode: "OFFICIAL_PASS_THROUGH", effectiveFrom: "2026-08-03", effectiveTo: "2027-01-01", lossTreatment: "NOT_DECLARED", sourceEvidence: "0,01349 Eur/kWh in bassa tensione" },
      { voltageScope: "MV", timeClass: "ALL", value: 0.065, unit: "EUR_PER_KWH", mode: "OFFICIAL_PASS_THROUGH", effectiveFrom: "2026-08-03", effectiveTo: "2027-01-01", lossTreatment: "NOT_DECLARED", sourceEvidence: "media tensione" },
      { timeClass: "CAPACITY_MARKET_LIBERO", value: 0.005, unit: "EUR_PER_KWH", mode: "FIXED_VALUE", effectiveFrom: "2026-08-03", effectiveTo: "2027-01-01", lossTreatment: "NOT_DECLARED", sourceEvidence: "Capacity Market libero 0,005" },
    ],
  },
  markets: [],
};
// Base di calcolo approvata da Tony (26/10): dispacciamento e capacity solo dai valori ufficiali ARERA/Terna del periodo,
// maggiorati delle perdite (TIS Tabella 4: BT 10%); il valore scritto nella CTE serve solo da controllo.
prepared.version.contract.commercialTerms = { dispatchingReference: prepared.offer.dispatchingReference, capacityMarketSchedule: prepared.offer.capacityMarketSchedule };
const officialValue = (kind, value) => ({ kind, value, unit: "EUR/KWH", authority: "ARERA", officialIdentifier: `official-${kind}`, sourceReference: "https://www.arera.it/", effectiveFrom: "2026-07-01", effectiveTo: null, recordId: kind, recordVersion: "1", provenance: { sourceSha256: "a".repeat(64), checksum: "c", applicationBasis: "test" } });
const resolver = (dispatching, capacity) => ({ resolveDispatching: async () => dispatching === null ? null : officialValue("DISPATCHING", dispatching), resolveCapacity: async () => capacity === null ? null : officialValue("CAPACITY_MARKET", capacity), resolveLoss: async () => null });
const context = (availablePowerKw) => ({ vector: "EE", contractedPowerKw: availablePowerKw, availablePowerKw, supplyUseCategory: "NON_DOMESTIC", domesticResidenceStatus: "NOT_APPLICABLE", voltageLevel: "LV", regulatoryCustomerScope: "NON_DOMESTIC_BT", asosClass: "UNKNOWN", energyIntensiveStatus: "UNKNOWN", asosClassTemporalStatus: "UNKNOWN" });
const deps = (dispatching, capacity, power) => ({ regulatoryRuntimeResolver: resolver(dispatching, capacity), regulatoryBridge: { list: async () => [] }, ...(power === undefined ? {} : { trustedElectricityContext: context(power) }) });
const quote = await calculatePreparedOffer(request(true), prepared, deps(0.0105, 0.004275, 30));
const byKind = (result, kind) => result.components.filter((component) => component.formulaInputs?.kind === kind).map((component) => component.amount.amount);
// 1.000 kWh: dispatching 0,0105 x 1,10 = 11,55; capacity BT up to 55 kW 0,004275 x 1,10 = 4,70; Capacity Market libero is the CTE's own charge, 5.
assert.deepEqual(byKind(quote, "DISPATCHING"), [11.55]);
assert.deepEqual(byKind(quote, "CAPACITY_MARKET"), [5, 4.7]);
// Losses: 1.000 kWh x 0,1 EUR x 10% = 10 EUR, always present (Tony, 26/10).
assert.deepEqual(byKind(quote, "LOSSES"), [10], "BT standard losses 10% of the energy cost");
assert.equal(quote.totalCommercialCost.amount, 100 + 10 + 11.55 + 5 + 4.7);
// The stub has no ARERA tables for business BT: only that reason remains, so the receipt can say why (Tony, 27/10).
assert.deepEqual(quote.warnings.filter((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING")), ["OFFICIAL_VALUE_MISSING:REGULATED:SCOPE_UNREGISTERED_NON_DOMESTIC_BT"]);
// Without official values nothing is estimated from the CTE's "attualmente pari a": the reason goes in the warnings.
const noOfficial = await calculatePreparedOffer(request(true), prepared, deps(null, null, 30));
// Tony (28/10): "il valore terna lo abbiamo ... controlla": with no archive value, customers other than households take
// Terna's TIDE dispatching total of the quarter: 3° trimestre 2026 1,0501 c€/kWh x 1,10 x 1.000 kWh = 11,55.
assert.deepEqual(byKind(noOfficial, "DISPATCHING"), [11.55]);
assert.ok(!noOfficial.warnings.includes("OFFICIAL_VALUE_MISSING:DISPATCHING:OFFICIAL_VALUE_MISSING"));
// Tony (27/10, bolletta BPower): with no archive value, BT up to 55 kW takes the monthly value ARERA fixes in the TIV
// quarterly update: settembre 2026 0,3197 c€/kWh (219/2026/R/eel art. 4.1) x 1,10 x 1.000 kWh = 3,52.
assert.deepEqual(byKind(noOfficial, "CAPACITY_MARKET"), [5, 3.52]);
assert.ok(!noOfficial.warnings.includes("OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:OFFICIAL_VALUE_MISSING"));
// BT above 55 kW: the charge needs the kWh in Terna's peak hours, which the bill quote does not have yet.
const large = await calculatePreparedOffer(request(true), prepared, deps(0.0105, 0.004275, 98));
assert.deepEqual(byKind(large, "CAPACITY_MARKET"), [5]);
assert.ok(large.warnings.includes("OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:PEAK_HOUR_KWH_MISSING"));
// Unknown available power on a BT supply: the 55 kW rule cannot be applied.
const unknown = await calculatePreparedOffer(request(true), prepared, deps(0.0105, 0.004275));
assert.ok(unknown.warnings.includes("OFFICIAL_VALUE_MISSING:CAPACITY_MARKET:AVAILABLE_POWER_MISSING"));
// Capacity Market libero "al lordo delle perdite di rete" is applied to the energy plus losses: 0,005 x 1,10.
const gross = structuredClone(prepared);
gross.offer.capacityMarketSchedule[2].lossTreatment = "GROSS_OF_LOSSES";
const grossQuote = await calculatePreparedOffer(request(true), gross, deps(0.0105, 0.004275, 30));
assert.deepEqual(byKind(grossQuote, "CAPACITY_MARKET"), [5.5, 4.7]);
// MT supply: TIS Tabella 4 colonna A gives 3,8%.
const mvRequest = parseSimulationRequest({ ...JSON.parse(JSON.stringify(request(true))), voltageLevel: "MV" }, tenant);
const mv = await calculatePreparedOffer(mvRequest, structuredClone(prepared)).catch((error) => error);
assert.ok(!(mv instanceof Error), String(mv?.message)); assert.deepEqual(byKind(mv, "LOSSES"), [3.8]);
// Outside a bill quote the engine behaves as before: no CTE pass-through is added.
const plainPrepared = structuredClone(prepared); plainPrepared.version.contract.commercialTerms = {};
const plain = await calculatePreparedOffer(request(false), plainPrepared);
assert.equal(plain.totalCommercialCost.amount, 100);
// Tony (27/10, screenshot): every CTE failed with REGULATORY_TIMELINE_GAP once the BTA6 context was read. A missing ARERA
// value never blocks the quote: it is priced without the ARERA tables and the warning names the missing table.
const bta6Context = { ...context(85), contractedPowerKw: 85, regulatoryCustomerScope: "NON_DOMESTIC_BT_BTA6", regulatoryPowerBasisKind: "MONTHLY_MAX_DRAWN", regulatoryPowerBasisKw: 151.8, asosClass: "ASOS_CLASS_0", asosClassTemporalStatus: "VALID" };
const gap = await calculatePreparedOffer(request(true), prepared, { ...deps(0.0105, 0.004275, undefined), trustedElectricityContext: bta6Context });
assert.equal(gap.totalRegulatedSubsetCost, null);
assert.ok(gap.warnings.some((warning) => /^OFFICIAL_VALUE_MISSING:REGULATED:TIMELINE_(GAP|OVERLAP)_.+_NON_DOMESTIC_BT_BTA6$|^OFFICIAL_VALUE_MISSING:REGULATED:ASOS_CLASS_UNKNOWN_/.test(warning)), gap.warnings.join(","));
// Tony (28/10, BPower Be FIX RELAX 26 microbus): the archived CTE says nothing on dispatching and capacity ("la CTE in
// archivio non indica come si applica"), yet the bill charges them. Regulated charges apply unless the CTE includes them.
const silent = structuredClone(prepared);
delete silent.offer.dispatchingReference; delete silent.offer.capacityMarketSchedule; silent.version.contract.commercialTerms = {};
const silentQuote = await calculatePreparedOffer(request(true), silent, deps(null, null, 6));
assert.deepEqual(byKind(silentQuote, "DISPATCHING"), [11.55]);
// ARERA TIV 219/2026 art. 4.1, settembre 2026: 0,3197 c€/kWh x 1,10 x 1.000 kWh = 3,52.
assert.deepEqual(byKind(silentQuote, "CAPACITY_MARKET"), [3.52]);
assert.ok(!silentQuote.warnings.some((warning) => /CTE_REFERENCE_MISSING/.test(warning)), silentQuote.warnings.join(","));
const includedOffer = structuredClone(silent);
includedOffer.offer.passThroughComponents = ["DISPATCHING", "CAPACITY_MARKET"].map((kind) => ({ componentId: `pt-${kind}`, kind, effectiveFrom: "2026-08-03", effectiveTo: "2027-01-01", declarationState: "INCLUDED_IN_ENERGY_PRICE" }));
const includedQuote = await calculatePreparedOffer(request(true), includedOffer, deps(null, null, 6));
assert.deepEqual(byKind(includedQuote, "DISPATCHING"), []); assert.deepEqual(byKind(includedQuote, "CAPACITY_MARKET"), []);
// Tony (28/10): the BPower Family CTEs (Casa Protetta, Porta un amico, Fast 26) say nothing about imbalance and were left
// out. A CTE silent on imbalance charges none apart, so it is calculated with no imbalance line.
const imbalanceSilent = structuredClone(prepared); imbalanceSilent.offer.imbalance = { status: "NOT_DECLARED", reason: "NOT_PROVIDED" };
const imbalanceSilentQuote = await calculatePreparedOffer(request(true), imbalanceSilent, deps(0.0105, 0.004275, 3));
assert.equal(imbalanceSilentQuote.components.filter((component) => component.category === "IMBALANCE").length, 0);
// Tony (28/10, BE Family Casa Protetta): "spread ... riportato in tabella al lordo delle perdite di rete". The losses are
// applied to the PUN alone: 1.000 kWh at PUN 100 €/MWh is 100 € of index, 10 € of losses, whatever the spread.
const indexedLoss = (lossTreatment) => { const offer = structuredClone(prepared); offer.offer.pricing = { mode: "INDEXED", reference: "PUN", spread: { amount: 0.03, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED", ...(lossTreatment ? { lossTreatment } : {}) } }; offer.markets = [{ month: "2026-09", record: { vector: "EE", f1: { value: 100 }, f2: { value: 100 }, f3: { value: 100 } } }]; return offer; };
const lossOf = async (offer) => Number((await calculatePreparedOffer(request(true), offer, deps(0.0105, 0.004275, 3))).components.find((component) => component.formulaInputs?.kind === "LOSSES")?.amount.amount);
assert.equal(await lossOf(indexedLoss("GROSS_OF_LOSSES")), 10);
assert.equal(await lossOf(indexedLoss()), 13);
// Tony (29/10): "nello spread del consumer deve esserci dentro anche sbilanciamento e commercializzazione" (delibera
// 386/2025/R/com, Codice di condotta commerciale art. 5.1.a: corrispettivi "al lordo delle perdite di rete"). A household
// offer from 1 April 2026 has its losses on the PUN alone even when the reading did not mark the spread as gross.
const household = { ...context(3), supplyUseCategory: "DOMESTIC", domesticResidenceStatus: "NON_RESIDENT", regulatoryCustomerScope: "DOMESTIC_NON_RESIDENT_BT" };
const householdLoss = await calculatePreparedOffer(request(true), indexedLoss(), { ...deps(0.0105, 0.004275, 3), trustedElectricityContext: household });
assert.equal(Number(householdLoss.components.find((component) => component.formulaInputs?.kind === "LOSSES")?.amount.amount), 10);
// Tony (29/10): "lo spread 0,03 è comprensivo di quello che prevede la norma". Imbalance or commercialization read apart in
// a household CTE from 1 April 2026 is inside the spread, never a second charge.
const feeOf = (feeId, label, amount) => ({ feeId, label, amount, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" });
const householdExtras = indexedLoss(); householdExtras.offer.imbalance = { status: "DECLARED", component: feeOf("imb", "Sbilanciamento", 0.002) }; householdExtras.offer.variableFees = [feeOf("com", "Commercializzazione", 0.003)];
const householdExtrasQuote = await calculatePreparedOffer(request(true), householdExtras, { ...deps(0.0105, 0.004275, 3), trustedElectricityContext: household });
assert.equal(householdExtrasQuote.components.some((component) => component.category === "IMBALANCE" || /Commercializzazione/.test(component.label)), false);
const businessExtrasQuote = await calculatePreparedOffer(request(true), householdExtras, deps(0.0105, 0.004275, 3));
assert.equal(businessExtrasQuote.components.some((component) => component.category === "IMBALANCE"), true, "businesses keep their imbalance");
// Tony (29/10, BPower BE SPECIAL 26: imbalance billed on kWh x 1,10), choosing "solo se la CTE lo dice": imbalance takes
// the losses only when the CTE names it among the loss targets.
const imbalanceAmount = (quote) => Number(quote.components.find((component) => component.category === "IMBALANCE")?.amount.amount);
const plainImbalance = imbalanceAmount(businessExtrasQuote);
const statedLosses = structuredClone(householdExtras); statedLosses.offer.lossReference = { ...(statedLosses.offer.lossReference ?? {}), applicationTargets: ["ENERGY_INDEX", "SPREAD", "IMBALANCE"] };
const statedQuote = await calculatePreparedOffer(request(true), statedLosses, deps(0.0105, 0.004275, 3));
assert.equal(imbalanceAmount(statedQuote), Math.round(plainImbalance * 1.1 * 100) / 100, "imbalance on kWh with losses when the CTE says so");
console.log("CTE_PASS_THROUGH_BILL_QUOTE=PASS");
// Tony (30/10, AZIENDA PROTETTA: "credo ci siano errori ancora"): the CTE fixes only its own Capacity Market libero and
// says nothing on the regulated charge, so that applies as on a silent CTE: libero 5 + ARERA TIV 219/2026 art. 4.1,
// settembre 2026 0,3197 c€/kWh x 1,10 x 1.000 kWh = 3,52.
const ownOnly = structuredClone(prepared);
ownOnly.offer.capacityMarketSchedule = [prepared.offer.capacityMarketSchedule[2]];
ownOnly.version.contract.commercialTerms = { dispatchingReference: prepared.offer.dispatchingReference, capacityMarketSchedule: ownOnly.offer.capacityMarketSchedule };
const ownOnlyQuote = await calculatePreparedOffer(request(true), ownOnly, deps(0.0105, 0.004275, 3));
assert.deepEqual(byKind(ownOnlyQuote, "CAPACITY_MARKET"), [5, 3.52]);
assert.ok(!ownOnlyQuote.warnings.some((warning) => /CAPACITY_MARKET:CTE_REFERENCE_MISSING/.test(warning)), ownOnlyQuote.warnings.join(","));
