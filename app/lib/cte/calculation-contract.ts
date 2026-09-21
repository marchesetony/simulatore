import type { CteCapacityMarketScheduleEntry, CteDispatchingReference, CteLossReference, CtePunResolutionRule, CteContract } from "./types";
import type { VoltageLevel } from "../energy/types";

export type CalculationTimeClass = "ALL" | "PEAK" | "CAPACITY_MARKET_LIBERO";

export interface CapacityMarketSelectionInput {
  readonly voltageScope: VoltageLevel;
  readonly effectiveAt: string;
  readonly timeClass?: CalculationTimeClass;
}

export interface OfficialValueResolutionContext {
  readonly effectiveAt: string;
  readonly source: string;
}

export type OfficialValueResolver = (reference: CteDispatchingReference["reference"] | CteLossReference["reference"], context: OfficialValueResolutionContext) => number | null | Promise<number | null>;

export class CteCalculationContractError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "CteCalculationContractError"; this.code = code; }
}

const fail = (code: string): never => { throw new CteCalculationContractError(code); };

function activeAt(from: string, to: string, at: string): boolean { return from <= at && at < to; }

function matchingCapacityEntries(schedule: readonly CteCapacityMarketScheduleEntry[], input: CapacityMarketSelectionInput): readonly CteCapacityMarketScheduleEntry[] {
  const active = schedule.filter((entry) => activeAt(entry.effectiveFrom, entry.effectiveTo, input.effectiveAt) && (entry.voltageScope === undefined || entry.voltageScope === input.voltageScope));
  if (input.timeClass === undefined) return active.filter((entry) => entry.timeClass === "ALL");
  const exact = active.filter((entry) => entry.timeClass === input.timeClass);
  if (exact.length > 0) return exact;
  return active.filter((entry) => entry.timeClass === "ALL");
}

/** Resolves one and only one capacity entry; ambiguity is deliberately fail-closed. */
export function resolveCapacityMarketSchedule(schedule: readonly CteCapacityMarketScheduleEntry[], input: CapacityMarketSelectionInput): CteCapacityMarketScheduleEntry {
  const matches = matchingCapacityEntries(schedule, input);
  if (matches.length !== 1) return fail(matches.length === 0 ? "CAPACITY_MARKET_VALUE_MISSING" : "CAPACITY_MARKET_SCHEDULE_AMBIGUOUS");
  return matches[0];
}

export function assertPunRuleForCalculation(rule: CtePunResolutionRule | undefined, effectiveAt: string, band: "MONO" | "F1" | "F2" | "F3" | "F23"): void {
  if (!rule) return fail("PUN_RULE_MISSING");
  if (!activeAt(rule.effectiveFrom, rule.effectiveTo, effectiveAt)) return fail("PUN_RULE_OUT_OF_PERIOD");
  if (!rule.timeBands.includes(band)) return fail("PUN_TIME_BAND_UNSUPPORTED");
}

export async function resolveOfficialContractValue(resolver: OfficialValueResolver | undefined, reference: CteDispatchingReference["reference"] | CteLossReference["reference"], context: OfficialValueResolutionContext): Promise<number> {
  if (!resolver) return fail("REGULATORY_VALUE_RESOLVER_REQUIRED");
  const value = await resolver(reference, context);
  if (value === null || !Number.isFinite(value)) return fail("REGULATORY_VALUE_MISSING");
  return value;
}

export interface CalculationContractReadiness {
  readonly modelReady: "YES" | "NO";
  readonly regulatoryDataReady: "YES" | "NO";
  readonly calculationReady: "YES" | "NO";
  readonly customerScopeReady: "YES" | "NO";
  readonly capacityNativeModelReady: "YES" | "NO";
  readonly punRuleModelReady: "YES" | "NO";
  readonly capacityRuntimeResolutionReady: "YES" | "NO";
  readonly lossRuntimeResolutionReady: "YES" | "NO";
  readonly dispatchRuntimeResolutionReady: "YES" | "NO";
  readonly doubleCountProtectionReady: "YES";
  readonly blockers: readonly string[];
}

export function assessCalculationContract(contract: CteContract, options: { readonly regulatoryValueResolver?: OfficialValueResolver } = {}): CalculationContractReadiness {
  const blockers: string[] = [];
  const customerScopeReady = contract.eligibility.customerScopes?.includes("NON_DOMESTIC_OTHER_USE") ? "YES" : "NO";
  if (customerScopeReady === "NO") blockers.push("CUSTOMER_SCOPE_EXACT_ENUM_MISSING");
  const capacityNativeModelReady = contract.vector === "EE" && (contract.commercialTerms.capacityMarketSchedule?.length ?? 0) > 0 ? "YES" : "NO";
  if (capacityNativeModelReady === "NO") blockers.push("CAPACITY_MARKET_SCHEDULE_MISSING");
  const punRuleModelReady = contract.vector !== "EE" || (contract.pricing.mode !== "INDEXED" ? true : contract.commercialTerms.punRule !== undefined);
  if (!punRuleModelReady) blockers.push("PUN_RULE_MISSING");
  const capacityRequiresResolution = (contract.commercialTerms.capacityMarketSchedule ?? []).some((entry) => entry.mode === "OFFICIAL_PASS_THROUGH" && entry.officialReference !== undefined);
  const capacityRuntimeResolutionReady = !capacityRequiresResolution || options.regulatoryValueResolver !== undefined ? "YES" : "NO";
  if (capacityRuntimeResolutionReady === "NO") blockers.push("CAPACITY_MARKET_REGULATORY_RESOLVER_MISSING");
  const dispatchRuntimeResolutionReady = contract.commercialTerms.dispatchingReference === undefined || options.regulatoryValueResolver !== undefined ? "YES" : "NO";
  if (dispatchRuntimeResolutionReady === "NO") blockers.push("DISPATCHING_REGULATORY_RESOLVER_MISSING");
  const lossRuntimeResolutionReady = contract.commercialTerms.lossReference === undefined || options.regulatoryValueResolver !== undefined ? "YES" : "NO";
  if (lossRuntimeResolutionReady === "NO") blockers.push("LOSS_REGULATORY_RESOLVER_MISSING");
  const modelReady = customerScopeReady === "YES" && capacityNativeModelReady === "YES" && punRuleModelReady ? "YES" : "NO";
  const regulatoryDataReady = options.regulatoryValueResolver === undefined && (contract.commercialTerms.dispatchingReference !== undefined || contract.commercialTerms.lossReference !== undefined || capacityRequiresResolution) ? "NO" : "YES";
  const calculationReady = modelReady === "YES" && regulatoryDataReady === "YES" && capacityRuntimeResolutionReady === "YES" && lossRuntimeResolutionReady === "YES" && dispatchRuntimeResolutionReady === "YES" ? "YES" : "NO";
  return { modelReady, regulatoryDataReady, calculationReady, customerScopeReady, capacityNativeModelReady, punRuleModelReady: punRuleModelReady ? "YES" : "NO", capacityRuntimeResolutionReady, lossRuntimeResolutionReady, dispatchRuntimeResolutionReady, doubleCountProtectionReady: "YES", blockers };
}
