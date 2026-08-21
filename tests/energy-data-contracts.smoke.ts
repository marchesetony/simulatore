import assert from "node:assert/strict";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { syntheticElectricityBill, syntheticElectricityCustomerSupply, syntheticElectricityPun, syntheticGasBill, syntheticGasCustomerSupply, syntheticGasPsv } from "../app/lib/energy/synthetic-fixtures.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateBillContract, validateCustomerSupplyRecord } from "../app/lib/energy/validation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateGasMonthlyPsv, validateElectricityMonthlyPun } from "../app/lib/energy/market-data.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toCalculationReadyOffer } from "../app/lib/cte/calculation-ready.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateCteContract, validateElectricityCte, validateGasCte } from "../app/lib/cte/validation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import * as energyExports from "../app/lib/energy/index.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import * as cteExports from "../app/lib/cte/index.ts";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] extends object ? Mutable<T[Key]> : T[Key] };
const clone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
const failsWith = (operation: () => unknown, code: string): void => assert.throws(operation, (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  return candidate.code === code || candidate.message === code;
});

assert.equal(typeof energyExports.validateBillContract, "function");
assert.equal(typeof energyExports.validateMonthlyMarketData, "function");
assert.equal(typeof cteExports.validateCteContract, "function");
assert.equal(typeof cteExports.toCalculationReadyOffer, "function");

validateCustomerSupplyRecord(syntheticElectricityCustomerSupply);
validateCustomerSupplyRecord(syntheticGasCustomerSupply);
validateBillContract(syntheticElectricityBill);
validateBillContract(syntheticGasBill);
validateElectricityMonthlyPun(syntheticElectricityPun);
validateGasMonthlyPsv(syntheticGasPsv);
const monthlyOnlyMarket = clone(syntheticElectricityPun);
delete monthlyOnlyMarket.f1;
delete monthlyOnlyMarket.f2;
delete monthlyOnlyMarket.f3;
monthlyOnlyMarket.monthly = { value: 100, currency: "EUR", unit: "EUR_PER_MWH" };
validateElectricityMonthlyPun(monthlyOnlyMarket);
console.log("MONTHLY_ONLY_MARKET_MODEL_TEST=PASS");
const emptyMarket = clone(syntheticElectricityPun);
delete emptyMarket.f1;
delete emptyMarket.f2;
delete emptyMarket.f3;
failsWith(() => validateElectricityMonthlyPun(emptyMarket), "MARKET_VALUES_MISSING");
console.log("EMPTY_MARKET_VALUES_REJECTED=PASS");
console.log("BANDED_MARKET_MODEL_TEST=PASS");
validateElectricityCte(syntheticElectricityCte);
validateGasCte(syntheticGasCte);
validateCteContract(syntheticElectricityCte);
validateCteContract(syntheticGasCte);

const eeReady = toCalculationReadyOffer(syntheticElectricityCte);
const gasReady = toCalculationReadyOffer(syntheticGasCte);
assert.equal(eeReady.vector, "EE");
assert.equal(gasReady.vector, "GAS");
assert.equal(eeReady.pricing.reference, "PUN");
assert.equal(gasReady.pricing.reference, "PSV");
assert.equal(eeReady.fixedFees[0].unit, "EUR_PER_MONTH");
assert.equal(gasReady.imbalance.status, "DECLARED");
assert.equal(eeReady.sourceCteVersion, "1");
assert.equal(eeReady.approval.status, "APPROVED");

const unavailableCoefficient = clone(syntheticGasBill);
unavailableCoefficient.consumption.correctionCoefficient = { status: "UNAVAILABLE", reason: "NOT_PROVIDED" };
validateBillContract(unavailableCoefficient);
const ambiguousZero = clone(syntheticGasBill);
// @ts-expect-error intentional invalid fixture mutation.
ambiguousZero.consumption.correctionCoefficient = null;
failsWith(() => validateBillContract(ambiguousZero), "CORRECTION_COEFFICIENT_INVALID");

const eeTotalMismatch = clone(syntheticElectricityBill);
// @ts-expect-error intentional invalid fixture mutation.
eeTotalMismatch.consumption.total.value = 2499;
failsWith(() => validateBillContract(eeTotalMismatch), "CONSUMPTION_TOTAL_MISMATCH");

const gasWithVoltage = clone(syntheticGasCustomerSupply);
// @ts-expect-error intentional mixed-schema fixture mutation.
gasWithVoltage.supply.voltageLevel = "LV";
failsWith(() => validateCustomerSupplyRecord(gasWithVoltage), "GAS_SCHEMA_MIXED");

const eeWithGasPdrSupply = clone(syntheticElectricityCustomerSupply);
// @ts-expect-error intentional mixed-schema fixture mutation.
eeWithGasPdrSupply.supply.pdr = "12345678901234";
failsWith(() => validateCustomerSupplyRecord(eeWithGasPdrSupply), "EE_SCHEMA_MIXED");

const eeWithGasPdr = clone(syntheticElectricityBill);
// @ts-expect-error intentional mixed-schema fixture mutation.
eeWithGasPdr.supply.pdr = "12345678901234";
failsWith(() => validateBillContract(eeWithGasPdr), "EE_SCHEMA_MIXED");

const eeWithGasConsumption = clone(syntheticElectricityBill);
// @ts-expect-error intentional mixed-schema fixture mutation.
eeWithGasConsumption.consumption.smc = { status: "KNOWN", unit: "SMC", value: 1 };
failsWith(() => validateBillContract(eeWithGasConsumption), "EE_SCHEMA_MIXED");

const gasWithElectricityConsumption = clone(syntheticGasBill);
// @ts-expect-error intentional mixed-schema fixture mutation.
gasWithElectricityConsumption.consumption.f1 = { status: "KNOWN", unit: "KWH", value: 1 };
failsWith(() => validateBillContract(gasWithElectricityConsumption), "GAS_SCHEMA_MIXED");

const wrongUnit = clone(syntheticElectricityCustomerSupply);
// @ts-expect-error intentional invalid fixture mutation.
wrongUnit.annualConsumption.unit = "SMC";
failsWith(() => validateCustomerSupplyRecord(wrongUnit), "UNIT_MISMATCH");

const badPdr = clone(syntheticGasCustomerSupply);
badPdr.supply.pdr = "not-a-pdr";
failsWith(() => validateCustomerSupplyRecord(badPdr), "PDR_INVALID");

const badTenant = clone(syntheticGasCustomerSupply);
badTenant.tenantId = "tenant";
failsWith(() => validateCustomerSupplyRecord(badTenant), "TENANT_ID_INVALID");

const badPeriod = clone(syntheticElectricityCustomerSupply);
badPeriod.consumptionPeriods[0].periodEnd = "2025-12-31";
failsWith(() => validateCustomerSupplyRecord(badPeriod), "CONSUMPTION_PERIOD_INVALID");

const invalidPun = clone(syntheticElectricityPun);
// @ts-expect-error intentional invalid fixture mutation.
invalidPun.index = "PSV";
failsWith(() => validateElectricityMonthlyPun(invalidPun), "MARKET_VECTOR_INDEX_MISMATCH");

const mixedPsv = clone(syntheticGasPsv);
// @ts-expect-error intentional mixed-schema fixture mutation.
mixedPsv.f1 = { value: 1, currency: "EUR", unit: "EUR_PER_MWH" };
failsWith(() => validateGasMonthlyPsv(mixedPsv), "GAS_SCHEMA_MIXED");

const mixedPun = clone(syntheticElectricityPun);
// @ts-expect-error intentional mixed-schema fixture mutation.
mixedPun.value = { value: 1, currency: "EUR", unit: "EUR_PER_SMC" };
failsWith(() => validateElectricityMonthlyPun(mixedPun), "EE_SCHEMA_MIXED");

const badPublicationDate = clone(syntheticElectricityPun);
badPublicationDate.publicationDate = "2026-02-30";
failsWith(() => validateElectricityMonthlyPun(badPublicationDate), "PUBLICATION_DATE_INVALID");

const badMarketPeriod = clone(syntheticGasPsv);
badMarketPeriod.effectiveTo = "2026-06-30";
failsWith(() => validateGasMonthlyPsv(badMarketPeriod), "MARKET_PERIOD_MISMATCH");

const gasWithPun = clone(syntheticGasCte);
// @ts-expect-error intentional invalid fixture mutation.
gasWithPun.pricing.reference = "PUN";
failsWith(() => validateGasCte(gasWithPun), "GAS_REFERENCE_INVALID");

const eeWithGasEligibility = clone(syntheticElectricityCte);
eeWithGasEligibility.eligibility.voltageLevels = [];
failsWith(() => validateElectricityCte(eeWithGasEligibility), "CTE_VOLTAGE_ELIGIBILITY_INVALID");

const badExpiry = clone(syntheticGasCte);
badExpiry.expiry = { status: "EXPIRES_ON", date: "2026-02-30" };
failsWith(() => validateGasCte(badExpiry), "CTE_EXPIRY_INVALID");

const badSpread = clone(syntheticElectricityCte);
// @ts-expect-error intentional invalid fixture mutation.
badSpread.pricing.spread.amount = -1;
failsWith(() => validateElectricityCte(badSpread), "CTE_PRICE_INVALID");

const badFee = clone(syntheticElectricityCte);
badFee.commercialTerms.fixedFees[0].amount = -1;
failsWith(() => validateElectricityCte(badFee), "CTE_FEE_INVALID");

const duplicateFee = clone(syntheticElectricityCte);
duplicateFee.commercialTerms.variableFees[0].feeId = duplicateFee.commercialTerms.fixedFees[0].feeId;
failsWith(() => validateElectricityCte(duplicateFee), "CTE_FEE_DUPLICATE");

const badImbalance = clone(syntheticGasCte);
// @ts-expect-error intentional invalid fixture mutation.
badImbalance.commercialTerms.imbalance.component.amount = -1;
failsWith(() => validateGasCte(badImbalance), "CTE_FEE_INVALID");

const badDiscount = clone(syntheticElectricityCte);
badDiscount.commercialTerms.commercialDiscounts[0].amount = -1;
failsWith(() => validateElectricityCte(badDiscount), "CTE_FEE_INVALID");

const badCurrency = clone(syntheticGasCte);
// @ts-expect-error intentional invalid fixture mutation.
badCurrency.currency = "USD";
failsWith(() => validateGasCte(badCurrency), "CURRENCY_INVALID");

const badApproval = clone(syntheticElectricityCte);
badApproval.approval = { status: "APPROVED", reviewer: "", reviewedAt: "2026-07-30T09:00:00.000Z", decisionId: "decision" };
failsWith(() => validateElectricityCte(badApproval), "APPROVAL_METADATA_INVALID");

const unsupportedSchema = clone(syntheticGasBill);
// @ts-expect-error intentional invalid fixture mutation.
unsupportedSchema.schemaVersion = 2;
failsWith(() => validateBillContract(unsupportedSchema), "SCHEMA_VERSION_UNSUPPORTED");

const unapprovedOffer = clone(syntheticElectricityCte);
unapprovedOffer.approval = { status: "NEEDS_REVIEW", reason: "fixture requires review" };
failsWith(() => toCalculationReadyOffer(unapprovedOffer), "OFFER_NOT_APPROVED");

console.log("energy-data-contracts smoke tests passed");
