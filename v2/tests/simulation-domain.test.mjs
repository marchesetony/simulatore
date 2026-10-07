import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../modules/simulations/engine.ts";
import { simulationInput } from "../modules/simulations/schema.ts";
import { consumption } from "./bill-fixtures.mjs";
import { snapshot, terms, indexed, market, profile, period, rate, feeTerms } from "./simulation-fixtures.mjs";
const blocked = (input, reason) => { const r = calculate(input); assert.equal(r.status, "BLOCKED"); assert.equal(r.blockReason, reason); assert.equal(r.candidate, null); };

test("fixed candidate 200 kWh times 0.2 = 4000 cents, commercial scope only", () => {
  const r = calculate(snapshot()); assert.equal(r.scope, "COMMERCIAL_ONLY"); assert.equal(r.candidate.commercialTotalCents, 4000);
  assert.deepEqual(r.candidate.components, [{ kind: "ENERGY", ...period, band: "TOTAL", amountCents: 4000 }]);
});
test("repeated calculation is deterministic and leaves input untouched", () => {
  const input = snapshot(), saved = structuredClone(input); assert.deepEqual(calculate(input), calculate(input)); assert.deepEqual(input, saved);
});
test("negative consumption rejected", () => {
  assert.throws(() => calculate(snapshot({ consumptionProfile: [consumption("TOTAL", "-1")] })), { code: "INVALID_INPUT" });
});
test("missing consumption differs from known zero", () => {
  blocked(snapshot({ consumptionProfile: [consumption("TOTAL", null)] }), "MISSING_CONSUMPTION");
  assert.equal(calculate(snapshot({ consumptionProfile: [consumption("TOTAL", "0")] })).candidate.commercialTotalCents, 0);
});
test("TOTAL feeds fixed without inventing bands", () => {
  const input = snapshot({ consumptionProfile: [consumption("TOTAL", "200")] });
  assert.equal(calculate(input).candidate.commercialTotalCents, 4000); assert.equal(input.consumptionProfile.length, 1);
  blocked({ ...input, candidateCommercialTerms: indexed(), marketSnapshot: market() }, "MISSING_CONSUMPTION");
});
test("complete homogeneous bands derive total, incomplete bands cannot", () => {
  assert.equal(calculate(snapshot()).candidate.commercialTotalCents, 4000);
  blocked(snapshot({ consumptionProfile: profile().slice(0, 2) }), "MISSING_CONSUMPTION");
});
test("contradictory known TOTAL and bands rejected", () => {
  assert.throws(() => calculate(snapshot({ consumptionProfile: [...profile(), consumption("TOTAL", "201")] })), { code: "INVALID_INPUT" });
});
test("duplicate semantic consumption is ambiguous", () => {
  blocked(snapshot({ consumptionProfile: [...profile(), profile()[0]] }), "AMBIGUOUS_CONSUMPTION");
});
test("overlapping consumption periods block instead of summing", () => {
  blocked(snapshot({ consumptionProfile: [consumption("TOTAL", "10", { periodEnd: "2026-07-20" }), consumption("TOTAL", "20", { periodStart: "2026-07-15" })] }), "AMBIGUOUS_CONSUMPTION");
});
test("inverted calculation period rejects", () => {
  assert.throws(() => calculate(snapshot({ calculationPeriod: { periodStart: "2026-07-31", periodEnd: "2026-07-01" } })), { code: "INVALID_INPUT" });
});
test("consumption period incompatible with calculation blocks", () => {
  blocked(snapshot({ consumptionProfile: [consumption("TOTAL", "200", { periodStart: "2026-07-02" })] }), "INCOMPATIBLE_PERIOD");
});
test("inclusive single day supported without daily proration", () => {
  const oneDay = { periodStart: "2026-07-01", periodEnd: "2026-07-01" };
  assert.equal(calculate(snapshot({ calculationPeriod: oneDay, consumptionProfile: [consumption("TOTAL", "1", oneDay)] })).candidate.commercialTotalCents, 20);
});
test("known incompatible unit blocks and unknown enum rejects", () => {
  blocked(snapshot({ candidateCommercialTerms: terms({ fixedPrice: rate("12", "EUR_PER_YEAR") }) }), "UNKNOWN_UNIT");
  assert.throws(() => calculate(snapshot({ candidateCommercialTerms: terms({ fixedPrice: rate("12", "EUR_PER_KW") }) })), { code: "INVALID_INPUT" });
});
test("duplicate fee role blocks regardless of different economic amounts", () => {
  const t = feeTerms("COMMERCIALIZATION", "4", "EUR_PER_MONTH");
  blocked(snapshot({ candidateCommercialTerms: { ...t, fees: [...t.fees, { ...t.fees[0], amount: "5" }] } }), "AMBIGUOUS_COMPONENT");
});
test("missing applicable fee is not zero", () => {
  blocked(snapshot({ candidateCommercialTerms: feeTerms("COMMERCIALIZATION", null, "EUR_PER_MONTH") }), "MISSING_COMMERCIAL_COMPONENT");
  assert.equal(calculate(snapshot({ candidateCommercialTerms: feeTerms("COMMERCIALIZATION", "0", "EUR_PER_MONTH") })).candidate.commercialTotalCents, 4000);
});
test("missing fee applicability does not silently omit cost", () => {
  blocked(snapshot({ candidateCommercialTerms: terms({ fees: [] }) }), "MISSING_COMMERCIAL_COMPONENT");
  const t = terms(); t.fees[0].applicability = "UNKNOWN";
  blocked(snapshot({ candidateCommercialTerms: t }), "MISSING_COMMERCIAL_COMPONENT");
});
for (const kind of ["OTHER_VARIABLE", "ONE_OFF", "DISCOUNT"]) test(`${kind} applicability cannot prove distinct scope or event`, () => {
  blocked(snapshot({ candidateCommercialTerms: feeTerms(kind, "1", "EUR_PER_CONTRACT") }), "AMBIGUOUS_COMPONENT");
});
for (const kind of ["NETWORK", "VAT", "LOSSES", "CAPACITY_MARKET"]) test(`${kind} cannot enter commercial component model`, () => {
  const t = terms(); t.fees[0].kind = kind;
  assert.throws(() => calculate(snapshot({ candidateCommercialTerms: t })), { code: "INVALID_INPUT" });
});
test("fixed monthly and annual fee use only explicit whole months", () => {
  for (const [amount, unit] of [["4", "EUR_PER_MONTH"], ["48", "EUR_PER_YEAR"]]) {
    assert.equal(calculate(snapshot({ candidateCommercialTerms: feeTerms("COMMERCIALIZATION", amount, unit) })).candidate.commercialTotalCents, 4400);
  }
});
test("partial month fixed fee blocked, no invented daily rate", () => {
  const p = { ...period, periodEnd: "2026-07-15" };
  blocked(snapshot({ calculationPeriod: p, consumptionProfile: [consumption("TOTAL", "10", p)], candidateCommercialTerms: feeTerms("COMMERCIALIZATION", "4", "EUR_PER_MONTH") }), "INCOMPATIBLE_PERIOD");
});
test("fixed candidate imbalance without spread blocks instead of producing a total", () => {
  blocked(snapshot({ candidateCommercialTerms: feeTerms("IMBALANCE", "0.002", "EUR_PER_KWH") }), "AMBIGUOUS_COMPONENT");
});
test("round half-up per component; sum of rounded components", () => {
  const r = calculate(snapshot({ consumptionProfile: [consumption("TOTAL", "1")], candidateCommercialTerms: terms({ fixedPrice: rate("0.005"), spread: rate("0.005") }) }));
  assert.deepEqual(r.candidate.components.map(row => row.amountCents), [1, 1]); assert.equal(r.candidate.commercialTotalCents, 2);
});
test("exact decimal multiplication avoids binary floating point", () => {
  const r = calculate(snapshot({ consumptionProfile: [consumption("TOTAL", "0.1")], candidateCommercialTerms: terms({ fixedPrice: rate("0.1") }) }));
  assert.equal(r.candidate.commercialTotalCents, 1);
});
test("indexed uses PUN per band /1000 plus spread", () => {
  const r = calculate(snapshot({ candidateCommercialTerms: indexed(), marketSnapshot: market() }));
  assert.equal(r.candidate.commercialTotalCents, 2200); assert.deepEqual(r.candidate.components.map(row => row.amountCents), [1100, 550, 550]);
});
test("missing market month blocks", () => {
  blocked(snapshot({ candidateCommercialTerms: indexed(), marketSnapshot: market("2026-06") }), "MISSING_MARKET_DATA");
});
test("missing required PUN band blocks even when its consumption is zero", () => {
  const m = market(); m.values.pop();
  blocked(snapshot({ candidateCommercialTerms: indexed(), marketSnapshot: m, consumptionProfile: profile().map(row => row.band === "F3" ? { ...row, energyKwh: "0" } : row) }), "MISSING_MARKET_DATA");
});
test("market null values never become zero", () => {
  const m = market(); m.values[0].value = null;
  blocked(snapshot({ candidateCommercialTerms: indexed(), marketSnapshot: m }), "MISSING_MARKET_DATA");
});
test("duplicate market band/version ambiguous", () => {
  const m = market(); m.values.push({ ...m.values[0], versionReference: "v2" });
  blocked(snapshot({ candidateCommercialTerms: indexed(), marketSnapshot: m }), "AMBIGUOUS_MARKET_DATA");
});
test("multi-month needs every market month and monthly consumption", () => {
  const p = { ...period, periodEnd: "2026-08-31" }, t = { ...indexed(), ...p };
  const input = snapshot({ calculationPeriod: p, candidateCommercialTerms: t, marketSnapshot: market(), consumptionProfile: [...profile(),
    ...profile().map(row => ({ ...row, periodStart: "2026-08-01", periodEnd: "2026-08-31" }))] });
  blocked(input, "MISSING_MARKET_DATA");
  input.marketSnapshot.values.push(...market("2026-08").values);
  assert.equal(calculate(input).candidate.commercialTotalCents, 4400);
  blocked({ ...input, consumptionProfile: profile().map(row => ({ ...row, ...p })) }, "INCOMPATIBLE_PERIOD");
});
test("negative PUN retained with signed rounding and no invented floor", () => {
  const m = market(); m.values = m.values.map(row => ({ ...row, value: "-100" }));
  const r = calculate(snapshot({ candidateCommercialTerms: indexed(), marketSnapshot: m }));
  assert.equal(r.candidate.commercialTotalCents, -1800);
});
test("candidate succeeds without current terms; savings null", () => {
  const r = calculate(snapshot()); assert.equal(r.status, "CALCULATED"); assert.equal(r.current, null);
  assert.deepEqual(r.comparison, { status: "NOT_AVAILABLE", reason: "MISSING_CURRENT_TERMS", savingAmountCents: null, savingPercentage: null });
});
test("homogeneous comparison calculates positive saving and percentage", () => {
  const r = calculate(snapshot({ currentCommercialTerms: terms({ fixedPrice: rate("0.25") }) }));
  assert.equal(r.comparison.status, "COMPARABLE"); assert.equal(r.current.commercialTotalCents, 5000);
  assert.equal(r.comparison.savingAmountCents, 1000); assert.equal(r.comparison.savingPercentage, "20.00");
});
test("more expensive candidate preserves negative saving", () => {
  const r = calculate(snapshot({ currentCommercialTerms: terms({ fixedPrice: rate("0.1") }) }));
  assert.equal(r.comparison.savingAmountCents, -2000); assert.equal(r.comparison.savingPercentage, "-100.00");
});
test("zero current has no percentage", () => {
  const r = calculate(snapshot({ currentCommercialTerms: terms({ fixedPrice: rate("0") }) }));
  assert.equal(r.comparison.status, "COMPARABLE"); assert.equal(r.comparison.savingAmountCents, -4000); assert.equal(r.comparison.savingPercentage, null);
});
test("negative current has no percentage", () => {
  const m = market(); m.values = m.values.map(row => ({ ...row, value: "-100" }));
  const r = calculate(snapshot({ currentCommercialTerms: indexed(), marketSnapshot: m }));
  assert.equal(r.current.commercialTotalCents, -1800); assert.equal(r.comparison.savingPercentage, null);
});
test("percentage deterministic two decimal places, no monetary tolerance", () => {
  const input = snapshot({ candidateCommercialTerms: terms({ fixedPrice: rate("0.2") }), currentCommercialTerms: terms({ fixedPrice: rate("0.3") }) });
  assert.equal(calculate(input).comparison.savingPercentage, "33.33"); assert.deepEqual(calculate(input), calculate(input));
});
test("incompatible current blocks comparison only", () => {
  const r = calculate(snapshot({ currentCommercialTerms: terms({ periodEnd: "2026-07-20" }) }));
  assert.equal(r.status, "CALCULATED"); assert.equal(r.comparison.reason, "INCOMPATIBLE_PERIOD"); assert.equal(r.comparison.savingAmountCents, null);
});
test("no candidate terms blocks with structured reason", () => blocked(snapshot({ candidateCommercialTerms: null }), "MISSING_CANDIDATE_TERMS"));
test("no annual projection: a one-month input only charges one month", () => {
  const r = calculate(snapshot({ candidateCommercialTerms: feeTerms("COMMERCIALIZATION", "4", "EUR_PER_MONTH") }));
  assert.equal(r.candidate.commercialTotalCents, 4400); assert.equal("annualSaving" in r, false); assert.equal("annualCost" in r, false);
});
test("unsafe monetary output blocks", () => {
  blocked(snapshot({ consumptionProfile: [consumption("TOTAL", "999999999.999")], candidateCommercialTerms: terms({ fixedPrice: rate("999999999.999999") }) }), "AMOUNT_OUT_OF_RANGE");
});
test("strict nested schema rejects unknown fields and tax-inclusive terms", () => {
  assert.throws(() => calculate(snapshot({ candidateCommercialTerms: { ...terms(), taxTreatment: "INCLUDED" } })), { code: "INVALID_INPUT" });
  assert.throws(() => calculate(snapshot({ candidateCommercialTerms: { ...terms(), total: 1 } })), { code: "INVALID_INPUT" });
  assert.throws(() => simulationInput({ ...snapshot(), result: {} }), { code: "INVALID_INPUT" });
});
