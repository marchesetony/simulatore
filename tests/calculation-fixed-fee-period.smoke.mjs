import assert from "node:assert/strict";

import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculatePreparedOffer } from "../app/lib/calculation/engine.ts";

const tenant = "tenant_calculation-fixed-fee-period";

function request(overrides = {}) {
  return parseSimulationRequest({
    schemaVersion: 1,
    tenantId: tenant,
    vector: "EE",
    calculationDate: "2026-01-15",
    supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-04-01" },
    customerCategory: "NON_RESIDENTIAL",
    voltageLevel: "LV",
    currency: "EUR",
    taxTreatment: "EXCLUDED",
    consumption: {
      basis: "PERIOD",
      unit: "KWH",
      f1: 300,
      f2: 150,
      f3: 150,
      monthlyProfile: [
        { month: "2026-01", f1: 100, f2: 50, f3: 50 },
        { month: "2026-02", f1: 100, f2: 50, f3: 50 },
        { month: "2026-03", f1: 100, f2: 50, f3: 50 },
      ],
    },
    ...overrides,
  }, tenant);
}

function fee(amount, period, extra = {}) {
  return { feeId: `fixed-${period ?? "missing"}`, label: "Quota fissa", amount, currency: "EUR", unit: "EUR_PER_POD", ...(period === undefined ? {} : { period }), ...extra, taxTreatment: "EXCLUDED" };
}

function prepared(fixedFee) {
  return {
    record: { archiveId: "archive-fixed-fee", cteId: "cte-fixed-fee" },
    version: { versionId: "version-fixed-fee", contract: { version: "1", supplier: { name: "Synthetic supplier" } } },
    offer: {
      schemaVersion: 1,
      tenantId: tenant,
      sourceCteId: "cte-fixed-fee",
      sourceCteVersion: "1",
      approval: { status: "APPROVED" },
      offerId: "offer-fixed-fee",
      supplierId: "supplier-fixed-fee",
      offerCode: "FIXED-FEE",
      offerName: "Synthetic fixed fee",
      currency: "EUR",
      taxTreatment: "EXCLUDED",
      validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" },
      expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
      fixedFees: [fixedFee],
      variableFees: [],
      imbalance: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" },
      oneOffFees: [],
      commercialDiscounts: [],
      vector: "EE",
      pricing: {
        mode: "FIXED",
        reference: "NONE",
        fixedPrice: { amount: 0.1, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" },
        spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" },
      },
    },
    markets: [],
  };
}

function fixedComponent(result) {
  const components = result.components.filter((component) => component.category === "FIXED_FEE");
  assert.equal(components.length, 1, "monthlyEquivalent must not become a second billable component");
  return components[0];
}

const annual = await calculatePreparedOffer(request(), prepared(fee(156, "YEAR", { monthlyEquivalent: 13 })));
const annualComponent = fixedComponent(annual);
assert.equal(annualComponent.amount.amount, 39, "156 EUR/POD/year prorates to 39 EUR over three months");
assert.equal(annualComponent.formulaInputs.feePeriod, "YEAR");
assert.equal(annualComponent.formulaInputs.basisQuantity, 0.25);

const annualYear = await calculatePreparedOffer(request({
  supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2027-01-01" },
  consumption: { basis: "PERIOD", unit: "KWH", f1: 1200, f2: 600, f3: 600 },
}), prepared(fee(156, "YEAR", { monthlyEquivalent: 13 })));
assert.equal(fixedComponent(annualYear).amount.amount, 156, "annual fee remains 156 EUR over twelve months");

const sixMonths = await calculatePreparedOffer(request({
  supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-07-01" },
  consumption: { basis: "PERIOD", unit: "KWH", f1: 600, f2: 300, f3: 300 },
}), prepared(fee(156, "YEAR", { monthlyEquivalent: 13 })));
assert.equal(fixedComponent(sixMonths).amount.amount, 78, "annual fee prorates to 78 EUR over six months");

const monthly = await calculatePreparedOffer(request(), prepared(fee(13, "MONTH")));
const monthlyComponent = fixedComponent(monthly);
assert.equal(monthlyComponent.amount.amount, 39, "13 EUR/POD/month applies once per month");
assert.equal(monthlyComponent.formulaInputs.feePeriod, "MONTH");
assert.equal(monthlyComponent.formulaInputs.basisQuantity, 3);

const monthlyCanonical = await calculatePreparedOffer(request(), prepared(fee(13, "MONTH")));
assert.equal(monthlyCanonical.components.filter((component) => component.category === "FIXED_FEE").length, 1);

const oneMonth = await calculatePreparedOffer(request({
  supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" },
  consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 },
}), prepared(fee(156, "YEAR", { monthlyEquivalent: 13 })));
assert.equal(fixedComponent(oneMonth).amount.amount, 13, "annual fee prorates to its monthly equivalent for one month");

await assert.rejects(
  () => calculatePreparedOffer(request(), prepared(fee(156))),
  /FEE_PERIOD_REQUIRED/,
  "EUR_PER_POD without YEAR/MONTH must fail closed",
);

console.log("calculation fixed-fee period smoke: ok (EUR/POD year/month, monthly proration, derived equivalent not double-counted, missing period fail-closed)");
