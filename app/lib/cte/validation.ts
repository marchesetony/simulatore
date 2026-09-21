import type {
  CteCommercialTerms,
  CteContract,
  CteDeclaredComponent,
  CteEconomicDuration,
  CteExpiry,
  CteExitFee,
  CteFeeComponent,
  CteCapacityMarketScheduleEntry,
  CteDispatchingReference,
  CteLossReference,
  CtePunResolutionRule,
  CteLossTreatment,
  CteLossSemantics,
  CteOffer,
  CtePassThroughComponent,
  CtePrice,
  CteSupplier,
  ElectricityCteContract,
  GasCteContract,
} from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertDatePeriod, assertEffectivePeriod, assertVersionMetadata, EnergyContractValidationError } from "../energy/validation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertApprovalMetadata } from "../energy/validation.ts";
import type { ApprovalMetadata, DatePeriod, VoltageLevel } from "../energy/types";

const fail = (code: string): never => { throw new EnergyContractValidationError(code); };
const record = (value: unknown, code: string): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);
const nonEmpty = (value: unknown, code: string): string => typeof value === "string" && value.trim() ? value as string : fail(code);
const enumValue = <T extends string>(value: unknown, values: readonly T[], code: string): T => typeof value === "string" && values.includes(value as T) ? value as T : fail(code);
const finite = (value: unknown, code: string): number => typeof value === "number" && Number.isFinite(value) ? value : fail(code);
const nonNegative = (value: unknown, code: string): number => finite(value, code) >= 0 ? value as number : fail(code);
const positive = (value: unknown, code: string): number => finite(value, code) > 0 ? value as number : fail(code);
const lossTreatment = (value: unknown, code: string): CteLossTreatment => enumValue(value, ["NET_OF_LOSSES", "GROSS_OF_LOSSES", "OFFICIAL_REFERENCE", "INCLUDED", "EXCLUDED", "NOT_DECLARED"], code);

function assertOfficialReference(value: unknown, code: string): void {
  const item = record(value, code);
  enumValue(item.authority, ["ARERA", "TERNA", "ARERA_TERNA"], code);
  nonEmpty(item.document, code);
  nonEmpty(item.sourceEvidence, code);
  if (item.table !== undefined) nonEmpty(item.table, code);
  if (item.column !== undefined) nonEmpty(item.column, code);
  if (item.article !== undefined) nonEmpty(item.article, code);
}

function assertPunRule(value: unknown): asserts value is CtePunResolutionRule {
  const item = record(value, "CTE_PUN_RULE_INVALID");
  if (item.index !== "PUN" || item.resolution !== "MONTHLY_ARITHMETIC_MEAN" || item.periodBasis !== "CALENDAR_MONTH" || item.application !== "PER_TIME_BAND" || item.spreadApplication !== "ADD_TO_INDEXED_UNIT_PRICE") fail("CTE_PUN_RULE_INVALID");
  if (!Array.isArray(item.timeBands) || item.timeBands.length === 0) fail("CTE_PUN_RULE_INVALID");
  (item.timeBands as readonly unknown[]).forEach((band) => enumValue(band, ["MONO", "F1", "F2", "F3", "F23"], "CTE_PUN_RULE_INVALID"));
  if (new Set(item.timeBands as readonly unknown[]).size !== (item.timeBands as readonly unknown[]).length) fail("CTE_PUN_RULE_INVALID");
  if (typeof item.effectiveFrom !== "string" || typeof item.effectiveTo !== "string") fail("CTE_PUN_RULE_INVALID");
  assertEffectivePeriod({ effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo }, "CTE_PUN_RULE_INVALID");
  nonEmpty(item.sourceEvidence, "CTE_PUN_RULE_INVALID");
}

function assertCapacityMarketSchedule(value: unknown): asserts value is readonly CteCapacityMarketScheduleEntry[] {
  if (!Array.isArray(value) || value.length === 0) fail("CTE_CAPACITY_SCHEDULE_INVALID");
  const keys = new Set<string>();
  (value as readonly unknown[]).forEach((candidate) => {
    const item = record(candidate, "CTE_CAPACITY_SCHEDULE_INVALID");
    if (item.voltageScope !== undefined) enumValue(item.voltageScope, ["LV", "MV", "HV", "EHV"], "CTE_CAPACITY_SCHEDULE_INVALID");
    enumValue(item.timeClass, ["ALL", "PEAK", "CAPACITY_MARKET_LIBERO"], "CTE_CAPACITY_SCHEDULE_INVALID");
    nonNegative(item.value, "CTE_CAPACITY_SCHEDULE_INVALID");
    if (item.unit !== "EUR_PER_KWH") fail("CTE_CAPACITY_SCHEDULE_INVALID");
    const mode = enumValue(item.mode, ["OFFICIAL_PASS_THROUGH", "FIXED_VALUE"], "CTE_CAPACITY_SCHEDULE_INVALID");
    if (typeof item.effectiveFrom !== "string" || typeof item.effectiveTo !== "string") fail("CTE_CAPACITY_SCHEDULE_INVALID");
    assertEffectivePeriod({ effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo }, "CTE_CAPACITY_SCHEDULE_INVALID");
    lossTreatment(item.lossTreatment, "CTE_CAPACITY_SCHEDULE_INVALID");
    if (mode === "OFFICIAL_PASS_THROUGH") {
      if (item.officialReference === undefined) fail("CTE_CAPACITY_REFERENCE_REQUIRED");
      assertOfficialReference(item.officialReference, "CTE_CAPACITY_REFERENCE_INVALID");
    } else if (item.officialReference !== undefined) assertOfficialReference(item.officialReference, "CTE_CAPACITY_REFERENCE_INVALID");
    nonEmpty(item.sourceEvidence, "CTE_CAPACITY_SCHEDULE_INVALID");
    const key = `${item.voltageScope ?? "ANY"}|${item.timeClass}|${item.effectiveFrom}|${item.effectiveTo}`;
    if (keys.has(key)) fail("CTE_CAPACITY_SCHEDULE_DUPLICATE");
    keys.add(key);
  });
}

function assertDispatchingReference(value: unknown): asserts value is CteDispatchingReference {
  const item = record(value, "CTE_DISPATCHING_REFERENCE_INVALID");
  if (item.mode !== "OFFICIAL_PASS_THROUGH") fail("CTE_DISPATCHING_REFERENCE_INVALID");
  assertOfficialReference(item.reference, "CTE_DISPATCHING_REFERENCE_INVALID");
  nonEmpty(item.formula, "CTE_DISPATCHING_REFERENCE_INVALID");
  if (item.lossTreatment !== "OFFICIAL_REFERENCE") fail("CTE_DISPATCHING_REFERENCE_INVALID");
  if (item.snapshotValue !== undefined) nonNegative(item.snapshotValue, "CTE_DISPATCHING_REFERENCE_INVALID");
  if (item.snapshotUnit !== undefined && item.snapshotUnit !== "EUR_PER_KWH") fail("CTE_DISPATCHING_REFERENCE_INVALID");
  if (typeof item.effectiveFrom !== "string" || typeof item.effectiveTo !== "string") fail("CTE_DISPATCHING_REFERENCE_INVALID");
  assertEffectivePeriod({ effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo }, "CTE_DISPATCHING_REFERENCE_INVALID");
  nonEmpty(item.sourceEvidence, "CTE_DISPATCHING_REFERENCE_INVALID");
}

function assertLossReference(value: unknown): asserts value is CteLossReference {
  const item = record(value, "CTE_LOSS_REFERENCE_INVALID");
  if (item.lossMode !== "OFFICIAL_REFERENCE") fail("CTE_LOSS_REFERENCE_INVALID");
  assertOfficialReference(item.reference, "CTE_LOSS_REFERENCE_INVALID");
  if (!Array.isArray(item.applicationTargets) || item.applicationTargets.length === 0) fail("CTE_LOSS_REFERENCE_INVALID");
  (item.applicationTargets as readonly unknown[]).forEach((target) => enumValue(target, ["DISPATCHING", "ENERGY_INDEX", "SPREAD", "COMMERCIALIZATION_FEE", "IMBALANCE", "CAPACITY_MARKET"], "CTE_LOSS_REFERENCE_INVALID"));
  nonEmpty(item.sourceEvidence, "CTE_LOSS_REFERENCE_INVALID");
}

function assertSupplier(value: unknown): asserts value is CteSupplier {
  const item = record(value, "CTE_SUPPLIER_INVALID");
  nonEmpty(item.supplierId, "CTE_SUPPLIER_INVALID");
  nonEmpty(item.name, "CTE_SUPPLIER_INVALID");
}

function assertOffer(value: unknown): asserts value is CteOffer {
  const item = record(value, "CTE_OFFER_INVALID");
  nonEmpty(item.offerId, "CTE_OFFER_INVALID");
  nonEmpty(item.name, "CTE_OFFER_INVALID");
  nonEmpty(item.code, "CTE_OFFER_INVALID");
}

function assertPrice(value: unknown, unit: CtePrice["unit"]): asserts value is CtePrice {
  const item = record(value, "CTE_PRICE_INVALID");
  positive(item.amount, "CTE_PRICE_INVALID");
  if (item.currency !== "EUR" || item.unit !== unit) fail("CTE_PRICE_UNIT_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "CTE_TAX_TREATMENT_INVALID");
  if (item.lossTreatment !== undefined) lossTreatment(item.lossTreatment, "CTE_LOSS_TREATMENT_INVALID");
}

function assertFee(value: unknown): asserts value is CteFeeComponent {
  const item = record(value, "CTE_FEE_INVALID");
  nonEmpty(item.feeId, "CTE_FEE_INVALID");
  nonEmpty(item.label, "CTE_FEE_INVALID");
  nonNegative(item.amount, "CTE_FEE_INVALID");
  if (item.currency !== "EUR") fail("CURRENCY_INVALID");
  enumValue(item.unit, ["EUR_PER_KWH", "EUR_PER_SMC", "EUR_PER_POD", "EUR_PER_MONTH", "EUR_PER_YEAR", "EUR_PER_CONTRACT"], "CTE_FEE_UNIT_INVALID");
  if (item.period !== undefined) enumValue(item.period, ["MONTH", "YEAR", "CONTRACT"], "CTE_FEE_PERIOD_INVALID");
  if (item.monthlyEquivalent !== undefined) {
    const monthly = nonNegative(item.monthlyEquivalent, "CTE_MONTHLY_EQUIVALENT_INVALID");
    if (item.unit !== "EUR_PER_POD" || item.period !== "YEAR" || Math.abs(monthly - (Number(item.amount) / 12)) > 0.000001) fail("CTE_MONTHLY_EQUIVALENT_INVALID");
  }
  if (item.unit === "EUR_PER_POD" && item.period !== "YEAR" && item.period !== "MONTH") fail("CTE_FIXED_FEE_CANONICAL_INVALID");
  if (item.unit === "EUR_PER_POD" && item.period === "YEAR" && item.monthlyEquivalent === undefined) fail("CTE_FIXED_FEE_CANONICAL_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "CTE_TAX_TREATMENT_INVALID");
  if (item.lossTreatment !== undefined) lossTreatment(item.lossTreatment, "CTE_LOSS_TREATMENT_INVALID");
}

function assertEconomicDuration(value: unknown): asserts value is CteEconomicDuration {
  const item = record(value, "CTE_ECONOMIC_DURATION_INVALID");
  const duration = nonNegative(item.value, "CTE_ECONOMIC_DURATION_INVALID");
  if (!Number.isInteger(duration) || duration <= 0 || item.unit !== "MONTHS") fail("CTE_ECONOMIC_DURATION_INVALID");
  nonEmpty(item.sourceText, "CTE_ECONOMIC_DURATION_INVALID");
}

function assertLossSemantics(value: unknown): asserts value is CteLossSemantics {
  const item = record(value, "CTE_LOSS_SEMANTICS_INVALID");
  if (item.present !== true) fail("CTE_LOSS_SEMANTICS_INVALID");
  nonEmpty(item.rawText, "CTE_LOSS_SEMANTICS_INVALID");
  enumValue(item.appliesTo, ["SPREAD", "ENERGY_PRICE", "NETWORK_LOSSES", "UNSPECIFIED"], "CTE_LOSS_SEMANTICS_INVALID");
  nonEmpty(item.provenance, "CTE_LOSS_SEMANTICS_INVALID");
}

function assertExitFee(value: unknown): asserts value is CteExitFee {
  const item = record(value, "CTE_EXIT_FEE_INVALID");
  nonNegative(item.amount, "CTE_EXIT_FEE_INVALID");
  if (item.currency !== "EUR") fail("CTE_EXIT_FEE_INVALID");
  if (item.condition !== "EARLY_EXIT_BEFORE_DURATION") fail("CTE_EXIT_FEE_INVALID");
  assertEconomicDuration(item.durationReference);
  nonEmpty(item.sourceText, "CTE_EXIT_FEE_INVALID");
}

function assertPassThroughComponent(value: unknown, validity?: DatePeriod): asserts value is CtePassThroughComponent {
  const item = record(value, "CTE_PASS_THROUGH_INVALID");
  nonEmpty(item.componentId, "CTE_PASS_THROUGH_INVALID");
  enumValue(item.kind, ["DISPATCHING", "CAPACITY_MARKET", "OTHER_CONTRACTUAL_PASS_THROUGH"], "CTE_PASS_THROUGH_INVALID");
  const declarationState = enumValue(item.declarationState, ["EXPLICIT_COMPONENT", "INCLUDED_IN_ENERGY_PRICE", "NOT_APPLICABLE", "NOT_DECLARED", "EXTERNAL_PASS_THROUGH"], "CTE_PASS_THROUGH_INVALID");
  if (typeof item.effectiveFrom !== "string" || typeof item.effectiveTo !== "string") fail("CTE_PASS_THROUGH_PERIOD_INVALID");
  const effectiveFrom = item.effectiveFrom as string;
  const effectiveTo = item.effectiveTo as string;
  assertEffectivePeriod({ effectiveFrom, effectiveTo }, "CTE_PASS_THROUGH_PERIOD_INVALID");
  if (validity && (effectiveFrom < validity.periodStart || effectiveTo > validity.periodEnd)) fail("CTE_PASS_THROUGH_PERIOD_OUTSIDE_CTE");
  const hasFee = Object.prototype.hasOwnProperty.call(item, "fee");
  const hasExternalReference = Object.prototype.hasOwnProperty.call(item, "externalReference");
  if (item.documentPresence !== undefined) enumValue(item.documentPresence, ["DOCUMENT_STATED", "NOT_STATED"], "CTE_PASS_THROUGH_DOCUMENT_PRESENCE_INVALID");
  if (item.amountStatus !== undefined) enumValue(item.amountStatus, ["DECLARED", "NOT_DECLARED"], "CTE_PASS_THROUGH_AMOUNT_STATUS_INVALID");
  if (item.sourceText !== undefined) nonEmpty(item.sourceText, "CTE_PASS_THROUGH_SOURCE_INVALID");
  if (item.componentId === "CDISPD" && item.amountStatus === "DECLARED" && declarationState !== "EXPLICIT_COMPONENT") fail("CTE_CDISPD_AMOUNT_INVALID");
  if (declarationState === "EXPLICIT_COMPONENT") {
    if (!hasFee || hasExternalReference) fail("CTE_PASS_THROUGH_DECLARATION_INVALID");
    assertFee(item.fee);
    if (item.fee.unit !== "EUR_PER_KWH" && item.fee.unit !== "EUR_PER_MONTH") fail("CTE_PASS_THROUGH_UNIT_INVALID");
    if (item.fee.taxTreatment !== "EXCLUDED") fail("CTE_PASS_THROUGH_TAX_INVALID");
  } else if (declarationState === "EXTERNAL_PASS_THROUGH") {
    if (hasFee || !hasExternalReference || typeof item.externalReference !== "string" || !item.externalReference.trim()) fail("CTE_PASS_THROUGH_DECLARATION_INVALID");
  } else if (hasFee || hasExternalReference) fail("CTE_PASS_THROUGH_DECLARATION_INVALID");
}

export function assertPassThroughComponents(value: unknown, validity?: DatePeriod): asserts value is readonly CtePassThroughComponent[] {
  if (!Array.isArray(value)) fail("CTE_PASS_THROUGH_INVALID");
  const components = (value as readonly unknown[]).map((candidate: unknown) => { assertPassThroughComponent(candidate, validity); return candidate; }) as CtePassThroughComponent[];
  const componentIds = new Set<string>();
  for (const component of components) {
    if (componentIds.has(component.componentId)) fail("CTE_PASS_THROUGH_DUPLICATE");
    componentIds.add(component.componentId);
  }
  const previousByKind = new Map<CtePassThroughComponent["kind"], CtePassThroughComponent>();
  for (const component of [...components].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.effectiveTo.localeCompare(right.effectiveTo))) {
    // Provider-native components whose semantic kind is not declared are independent
    // document statements; their shared CTE validity period is not a duplicate fee.
    if (component.kind === "OTHER_CONTRACTUAL_PASS_THROUGH") continue;
    const previous = previousByKind.get(component.kind);
    if (previous && component.effectiveFrom < previous.effectiveTo) fail("CTE_PASS_THROUGH_OVERLAP");
    previousByKind.set(component.kind, component);
  }
}

function assertDeclaredComponent(value: unknown): asserts value is CteDeclaredComponent {
  const item = record(value, "CTE_COMPONENT_INVALID");
  const status = enumValue(item.status, ["DECLARED", "NOT_DECLARED"], "CTE_COMPONENT_INVALID");
  if (status === "DECLARED") assertFee(item.component);
  else enumValue(item.reason, ["NOT_PROVIDED", "NOT_APPLICABLE"], "CTE_COMPONENT_INVALID");
}

function assertCommercialTerms(value: unknown): asserts value is CteCommercialTerms {
  const item = record(value, "CTE_COMMERCIAL_TERMS_INVALID");
  const feeIds = new Set<string>();
  for (const field of ["fixedFees", "variableFees", "oneOffFees", "commercialDiscounts"] as const) {
    if (!Array.isArray(item[field])) fail("CTE_COMMERCIAL_TERMS_INVALID");
    (item[field] as readonly unknown[]).forEach((candidate: unknown) => {
      assertFee(candidate);
      const feeId = (candidate as CteFeeComponent).feeId;
      if (feeIds.has(feeId)) fail("CTE_FEE_DUPLICATE");
      feeIds.add(feeId);
    });
  }
  assertDeclaredComponent(item.imbalance);
  if (item.economicDuration !== undefined) assertEconomicDuration(item.economicDuration);
  if (item.lossSemantics !== undefined) assertLossSemantics(item.lossSemantics);
  if (item.exitFee !== undefined) assertExitFee(item.exitFee);
  if (item.exitFee !== undefined && Array.isArray(item.oneOffFees) && item.oneOffFees.length > 0) fail("CTE_EXIT_FEE_DUPLICATE");
  if (item.punRule !== undefined) assertPunRule(item.punRule);
  if (item.capacityMarketSchedule !== undefined) assertCapacityMarketSchedule(item.capacityMarketSchedule);
  if (item.dispatchingReference !== undefined) assertDispatchingReference(item.dispatchingReference);
  if (item.lossReference !== undefined) assertLossReference(item.lossReference);
}

function assertExpiry(value: unknown): asserts value is CteExpiry {
  const item = record(value, "CTE_EXPIRY_INVALID");
  const status = enumValue(item.status, ["EXPIRES_ON", "NO_EXPIRY_DECLARED"], "CTE_EXPIRY_INVALID");
  if (status === "EXPIRES_ON") {
    const date = nonEmpty(item.date, "CTE_EXPIRY_INVALID");
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) fail("CTE_EXPIRY_INVALID");
  } else if (item.reason !== "NOT_PROVIDED") fail("CTE_EXPIRY_INVALID");
}

function assertBase(value: unknown): Record<string, unknown> {
  assertVersionMetadata(value);
  const item = value as unknown as Record<string, unknown>;
  if (item.recordType !== "CTE") fail("RECORD_TYPE_INVALID");
  nonEmpty(item.cteId, "CTE_ID_INVALID");
  assertSupplier(item.supplier);
  assertOffer(item.offer);
  assertDatePeriod(item.validity, "CTE_VALIDITY_INVALID");
  assertEffectivePeriod({ effectiveFrom: (item.validity as Record<string, unknown>).periodStart, effectiveTo: (item.validity as Record<string, unknown>).periodEnd }, "CTE_VALIDITY_INVALID");
  assertExpiry(item.expiry);
  const validity = item.validity as DatePeriod;
  const expiry = item.expiry as CteExpiry;
  if (expiry.status === "EXPIRES_ON" && (expiry.date < validity.periodStart || expiry.date > validity.periodEnd)) fail("CTE_EXPIRY_OUTSIDE_VALIDITY");
  if (item.currency !== "EUR") fail("CURRENCY_INVALID");
  enumValue(item.taxTreatment, ["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"], "CTE_TAX_TREATMENT_INVALID");
  assertCommercialTerms(item.commercialTerms);
  const commercialTerms = item.commercialTerms as unknown as Record<string, unknown>;
  if (commercialTerms.passThroughComponents !== undefined) assertPassThroughComponents(commercialTerms.passThroughComponents, item.validity as DatePeriod);
  assertApprovalMetadata(item.approval as ApprovalMetadata);
  return item;
}

function assertCustomerTypes(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) fail("CTE_ELIGIBILITY_INVALID");
  const values = (value as readonly unknown[]).map((candidate: unknown) => enumValue(candidate, ["RESIDENTIAL", "NON_RESIDENTIAL"], "CTE_ELIGIBILITY_INVALID"));
  if (new Set(values).size !== values.length) fail("CTE_ELIGIBILITY_INVALID");
}

function assertAnnualConsumptionRule(value: unknown): void {
  const item = record(value, "CTE_ANNUAL_CONSUMPTION_RULE_INVALID");
  enumValue(item.operator, [">", ">=", "<", "<=", "="], "CTE_ANNUAL_CONSUMPTION_RULE_INVALID");
  positive(item.value, "CTE_ANNUAL_CONSUMPTION_RULE_INVALID");
  enumValue(item.unit, ["KWH_PER_YEAR", "SMC_PER_YEAR"], "CTE_ANNUAL_CONSUMPTION_RULE_INVALID");
  nonEmpty(item.sourceEvidence, "CTE_ANNUAL_CONSUMPTION_RULE_INVALID");
}

function assertCustomerScopes(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) fail("CTE_CUSTOMER_SCOPES_INVALID");
  const allowed = ["DOMESTIC_BT", "DOMESTIC_RESIDENT_BT", "DOMESTIC_NON_RESIDENT_BT", "NON_DOMESTIC_BT", "NON_DOMESTIC_OTHER_USE", "NON_DOMESTIC_BT_BTA6", "ALL_ELECTRICITY", "DOMESTIC_GAS", "NON_DOMESTIC_GAS", "ALL_GAS"] as const;
  const values = (value as readonly unknown[]).map((candidate) => enumValue(candidate, allowed, "CTE_CUSTOMER_SCOPES_INVALID"));
  if (new Set(values).size !== values.length) fail("CTE_CUSTOMER_SCOPES_INVALID");
}

function assertCanonicalEligibilityScope(value: unknown): void {
  const item = record(value, "CTE_ELIGIBILITY_INVALID");
  if (item.allowedCustomerTypes !== undefined) {
    if (!Array.isArray(item.allowedCustomerTypes) || item.allowedCustomerTypes.length === 0) fail("CTE_ALLOWED_CUSTOMER_TYPES_INVALID");
    const values = (item.allowedCustomerTypes as readonly unknown[]).map((candidate) => enumValue(candidate, ["CONSUMER", "BUSINESS", "BOTH", "NOT_DECLARED"], "CTE_ALLOWED_CUSTOMER_TYPES_INVALID"));
    if (new Set(values).size !== values.length) fail("CTE_ALLOWED_CUSTOMER_TYPES_INVALID");
    if (values.includes("BOTH") && values.length > 1) fail("CTE_ALLOWED_CUSTOMER_TYPES_INVALID");
  }
  if (item.allowedSupplyUses !== undefined) {
    if (!Array.isArray(item.allowedSupplyUses) || item.allowedSupplyUses.length === 0) fail("CTE_ALLOWED_SUPPLY_USES_INVALID");
    const values = (item.allowedSupplyUses as readonly unknown[]).map((candidate) => enumValue(candidate, ["DOMESTIC", "OTHER_USE", "PUBLIC_LIGHTING", "EV_CHARGING", "OTHER", "NOT_DECLARED"], "CTE_ALLOWED_SUPPLY_USES_INVALID"));
    if (new Set(values).size !== values.length) fail("CTE_ALLOWED_SUPPLY_USES_INVALID");
  }
  if (item.allowedLegalForms !== undefined) {
    if (!Array.isArray(item.allowedLegalForms) || item.allowedLegalForms.length === 0) fail("CTE_ALLOWED_LEGAL_FORMS_INVALID");
    const values = (item.allowedLegalForms as readonly unknown[]).map((candidate) => enumValue(candidate, ["NATURAL_PERSON", "LEGAL_PERSON", "PROFESSIONAL", "ENTERPRISE", "PUBLIC_BODY", "OTHER", "NOT_DECLARED"], "CTE_ALLOWED_LEGAL_FORMS_INVALID"));
    if (new Set(values).size !== values.length) fail("CTE_ALLOWED_LEGAL_FORMS_INVALID");
  }
  if (item.allowedIdentifierTypes !== undefined) {
    if (!Array.isArray(item.allowedIdentifierTypes) || item.allowedIdentifierTypes.length === 0) fail("CTE_ALLOWED_IDENTIFIER_TYPES_INVALID");
    const values = (item.allowedIdentifierTypes as readonly unknown[]).map((candidate) => enumValue(candidate, ["TAX_CODE", "VAT", "OTHER", "NOT_DECLARED"], "CTE_ALLOWED_IDENTIFIER_TYPES_INVALID"));
    if (new Set(values).size !== values.length) fail("CTE_ALLOWED_IDENTIFIER_TYPES_INVALID");
  }
}

function assertVoltageLevels(value: unknown): asserts value is readonly VoltageLevel[] {
  if (!Array.isArray(value) || value.length === 0) fail("CTE_VOLTAGE_ELIGIBILITY_INVALID");
  const values = (value as readonly unknown[]).map((candidate: unknown) => enumValue(candidate, ["LV", "MV", "HV", "EHV"], "CTE_VOLTAGE_ELIGIBILITY_INVALID"));
  if (new Set(values).size !== values.length) fail("CTE_VOLTAGE_ELIGIBILITY_INVALID");
}

function assertElectricityPricing(value: unknown): void {
  const item = record(value, "CTE_PRICING_INVALID");
  const mode = enumValue(item.mode, ["INDEXED", "FIXED"], "CTE_PRICING_INVALID");
  if (mode === "INDEXED") {
    if (item.reference !== "PUN") fail("EE_REFERENCE_INVALID");
    assertPrice(item.spread, "EUR_PER_KWH");
  } else {
    if (item.reference !== "NONE") fail("EE_REFERENCE_INVALID");
    assertPrice(item.fixedPrice, "EUR_PER_KWH");
    assertDeclaredComponent(item.spread);
  }
}

function assertGasPricing(value: unknown): void {
  const item = record(value, "CTE_PRICING_INVALID");
  const mode = enumValue(item.mode, ["INDEXED", "FIXED"], "CTE_PRICING_INVALID");
  if (mode === "INDEXED") {
    if (item.reference !== "PSV") fail("GAS_REFERENCE_INVALID");
    assertPrice(item.spread, "EUR_PER_SMC");
  } else {
    if (item.reference !== "NONE") fail("GAS_REFERENCE_INVALID");
    assertPrice(item.fixedPrice, "EUR_PER_SMC");
    assertDeclaredComponent(item.spread);
  }
}

export function validateElectricityCte(value: unknown): asserts value is ElectricityCteContract {
  const item = assertBase(value);
  if (item.vector !== "EE") fail("VECTOR_MISMATCH");
  const eligibility = record(item.eligibility, "CTE_ELIGIBILITY_INVALID");
  assertCustomerTypes(eligibility.customerTypes);
  if (eligibility.customerScopes !== undefined) assertCustomerScopes(eligibility.customerScopes);
  assertCanonicalEligibilityScope(eligibility);
  if (eligibility.annualConsumptionRule !== undefined) assertAnnualConsumptionRule(eligibility.annualConsumptionRule);
  assertVoltageLevels(eligibility.voltageLevels);
  assertElectricityPricing(item.pricing);
  if (Object.prototype.hasOwnProperty.call(item, "pdr")) fail("EE_SCHEMA_MIXED");
}

export function validateGasCte(value: unknown): asserts value is GasCteContract {
  const item = assertBase(value);
  if (item.vector !== "GAS") fail("VECTOR_MISMATCH");
  const eligibility = record(item.eligibility, "CTE_ELIGIBILITY_INVALID");
  assertCustomerTypes(eligibility.customerTypes);
  if (eligibility.customerScopes !== undefined) assertCustomerScopes(eligibility.customerScopes);
  assertCanonicalEligibilityScope(eligibility);
  if (eligibility.annualConsumptionRule !== undefined) assertAnnualConsumptionRule(eligibility.annualConsumptionRule);
  if (Object.prototype.hasOwnProperty.call(eligibility, "voltageLevels")) fail("GAS_SCHEMA_MIXED");
  assertGasPricing(item.pricing);
  if (Object.prototype.hasOwnProperty.call(item, "pod") || Object.prototype.hasOwnProperty.call(item, "voltageLevel")) fail("GAS_SCHEMA_MIXED");
}

export function validateCteContract(value: unknown): asserts value is CteContract {
  const item = record(value, "RECORD_INVALID");
  if (item.vector === "EE") validateElectricityCte(value);
  else if (item.vector === "GAS") validateGasCte(value);
  else fail("VECTOR_INVALID");
}
