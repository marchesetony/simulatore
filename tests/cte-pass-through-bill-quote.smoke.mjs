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
console.log("CTE_PASS_THROUGH_BILL_QUOTE=PASS");
