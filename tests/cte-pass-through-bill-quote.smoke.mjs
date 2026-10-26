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
const quote = await calculatePreparedOffer(request(true), prepared);
const byKind = (kind) => quote.components.filter((component) => component.formulaInputs?.kind === kind).map((component) => component.amount.amount);
assert.deepEqual(byKind("DISPATCHING"), [11.55], "1.000 kWh x 0,01155 from the CTE");
assert.deepEqual(byKind("CAPACITY_MARKET"), [13.49, 5], "BT capacity 0,01349 and capacity libero 0,005; the MV value is not applied to a BT supply");
// Tony (26/10): "le perdite di rete sono sempre presenti". With no official record the TIS Tabella 4 colonna A factor for the
// voltage applies (BT 10%) to the energy price: 1.000 kWh x 0,1 EUR x 10% = 10 EUR.
assert.deepEqual(byKind("LOSSES"), [10], "BT standard losses 10% of the energy cost");
assert.equal(quote.totalCommercialCost.amount, 100 + 10 + 11.55 + 13.49 + 5);
// Capacity Market libero "al lordo delle perdite di rete" is applied to the energy plus losses: 0,005 x 1,10.
const gross = structuredClone(prepared);
gross.offer.capacityMarketSchedule[2].lossTreatment = "GROSS_OF_LOSSES";
const grossQuote = await calculatePreparedOffer(request(true), gross);
assert.deepEqual(grossQuote.components.filter((component) => component.formulaInputs?.kind === "CAPACITY_MARKET").map((component) => component.amount.amount), [13.49, 5.5]);
// MT supply: TIS Tabella 4 colonna A gives 3,8%.
const mvRequest = parseSimulationRequest({ ...JSON.parse(JSON.stringify(request(true))), voltageLevel: "MV" }, tenant);
const mvPrepared = structuredClone(prepared);
const mv = await calculatePreparedOffer(mvRequest, mvPrepared).catch((error) => error);
assert.ok(!(mv instanceof Error), String(mv?.message)); assert.deepEqual(mv.components.filter((component) => component.formulaInputs?.kind === "LOSSES").map((component) => component.amount.amount), [3.8]);
// Outside a bill quote the engine behaves as before: no CTE pass-through is added.
const plain = await calculatePreparedOffer(request(false), prepared);
assert.equal(plain.totalCommercialCost.amount, 100);
console.log("CTE_PASS_THROUGH_BILL_QUOTE=PASS");
