import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
import type { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
import type { CteCapacityMarketScheduleEntry, CteContract, CteOfficialReference, CteDispatchingReference, CteLossReference } from "../cte/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveCapacityMarketSchedule, type CalculationTimeClass } from "../cte/calculation-contract.ts";
import type { VoltageLevel } from "../energy/types.ts";

export type CteRuntimeReferenceKind = "DISPATCHING" | "CAPACITY_MARKET" | "LOSS_FACTOR";

export interface RegulatoryRuntimeResolutionInput {
  readonly tenantId: string;
  readonly effectiveAt: string;
  readonly customerScope: RegulatoryValueRecord["customerScope"];
  readonly voltageLevel: VoltageLevel;
  readonly timeClass?: CalculationTimeClass;
}

export interface ResolvedOfficialRuntimeValue {
  readonly kind: CteRuntimeReferenceKind;
  readonly value: number;
  readonly unit: string;
  readonly authority: RegulatoryValueRecord["authority"];
  readonly officialIdentifier: string;
  readonly sourceReference: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordId: string;
  readonly recordVersion: string;
  readonly provenance: {
    readonly sourceSha256: string;
    readonly checksum: string;
    readonly applicationBasis: string;
  };
}

export interface CteRegulatoryRuntimeResolver {
  resolveDispatching(input: RegulatoryRuntimeResolutionInput, reference: CteDispatchingReference["reference"]): Promise<ResolvedOfficialRuntimeValue | null>;
  resolveCapacity(input: RegulatoryRuntimeResolutionInput, entry: CteCapacityMarketScheduleEntry): Promise<ResolvedOfficialRuntimeValue | null>;
  resolveLoss(input: RegulatoryRuntimeResolutionInput, reference: CteLossReference["reference"]): Promise<ResolvedOfficialRuntimeValue | null>;
}

export interface CteRuntimeResolution {
  readonly dispatching: ResolvedOfficialRuntimeValue | null;
  readonly capacityMarket: ResolvedOfficialRuntimeValue | null;
  readonly loss: ResolvedOfficialRuntimeValue | null;
  readonly blockers: readonly string[];
  readonly ready: boolean;
}

function authorityAllowed(reference: CteOfficialReference, record: RegulatoryValueRecord): boolean {
  return reference.authority === "ARERA_TERNA" || reference.authority === record.authority;
}

function normalizedReferenceText(reference: CteOfficialReference): string {
  return [reference.document, reference.table, reference.column, reference.article].filter((item): item is string => typeof item === "string" && item.trim() !== "").join(" ").toLowerCase();
}

function officialReferenceMatches(reference: CteOfficialReference, record: RegulatoryValueRecord, domain: "DISPATCHING" | "CAPACITY_MARKET" | "LOSS_FACTOR"): boolean {
  if (!["OFFICIAL_ATTACHMENT", "OFFICIAL_WEB_PAGE", "OFFICIAL_PROVVEDIMENTO"].includes(record.sourceType)) return false;
  if (!authorityAllowed(reference, record)) return false;
  if (domain !== "LOSS_FACTOR" && record.referenceDomain !== domain) return false;
  if (domain === "LOSS_FACTOR") {
    const text = `${record.officialIdentifier} ${record.officialName ?? ""} ${record.applicationBasis}`.toLowerCase();
    return /loss|perdit|tabella\s*4/.test(text) && /tis/.test(text);
  }
  const requested = normalizedReferenceText(reference);
  const recordText = `${record.officialIdentifier} ${record.officialName ?? ""} ${record.applicationBasis} ${record.sourceReference}`.toLowerCase();
  const meaningfulTokens = requested.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !["art", "del", "col", "comma"].includes(token));
  return meaningfulTokens.length === 0 || meaningfulTokens.some((token) => recordText.includes(token));
}

function toResolved(kind: CteRuntimeReferenceKind, record: RegulatoryValueRecord): ResolvedOfficialRuntimeValue {
  return {
    kind,
    value: record.normalizedValue,
    unit: record.normalizedUnit,
    authority: record.authority,
    officialIdentifier: record.officialIdentifier,
    sourceReference: record.sourceReference,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    recordId: record.id,
    recordVersion: record.version,
    provenance: { sourceSha256: record.sourceSha256, checksum: record.checksum, applicationBasis: record.applicationBasis },
  };
}

async function uniqueMatch(
  bridge: Pick<ProductionRegulatoryPersistenceBridge, "list">,
  input: RegulatoryRuntimeResolutionInput,
  reference: CteOfficialReference,
  kind: CteRuntimeReferenceKind,
  domain: "DISPATCHING" | "CAPACITY_MARKET" | "LOSS_FACTOR",
  componentCode?: RegulatoryValueRecord["componentCode"],
): Promise<ResolvedOfficialRuntimeValue | null> {
  const records = await bridge.list(input.tenantId, {
    ...(componentCode === undefined ? {} : { componentCode }),
    ...(domain === "LOSS_FACTOR" ? {} : { customerScope: input.customerScope }),
    normalizedUnit: "EUR/KWH",
    effectiveAt: input.effectiveAt,
  });
  const matches = records.filter((record) => officialReferenceMatches(reference, record, domain));
  if (matches.length > 1) throw new Error(`REGULATORY_RUNTIME_AMBIGUOUS:${kind}`);
  return matches[0] ? toResolved(kind, matches[0]) : null;
}

function capacityComponentCode(entry: CteCapacityMarketScheduleEntry): RegulatoryValueRecord["componentCode"] {
  return entry.timeClass === "PEAK" ? "CAPACITY_MARKET_PEAK" : "CAPACITY_MARKET_OFF_PEAK";
}

export class ProductionCteRegulatoryRuntimeResolver implements CteRegulatoryRuntimeResolver {
  private readonly bridge: Pick<ProductionRegulatoryPersistenceBridge, "list">;

  constructor(bridge: Pick<ProductionRegulatoryPersistenceBridge, "list">) { this.bridge = bridge; }

  resolveDispatching(input: RegulatoryRuntimeResolutionInput, reference: CteDispatchingReference["reference"]): Promise<ResolvedOfficialRuntimeValue | null> {
    return uniqueMatch(this.bridge, input, reference, "DISPATCHING", "DISPATCHING", "DISPATCHING_TOTAL");
  }

  resolveCapacity(input: RegulatoryRuntimeResolutionInput, entry: CteCapacityMarketScheduleEntry): Promise<ResolvedOfficialRuntimeValue | null> {
    if (entry.mode === "FIXED_VALUE" || !entry.officialReference) return Promise.resolve(null);
    return uniqueMatch(this.bridge, input, entry.officialReference, "CAPACITY_MARKET", "CAPACITY_MARKET", capacityComponentCode(entry));
  }

  resolveLoss(input: RegulatoryRuntimeResolutionInput, reference: CteLossReference["reference"]): Promise<ResolvedOfficialRuntimeValue | null> {
    return uniqueMatch(this.bridge, input, reference, "LOSS_FACTOR", "LOSS_FACTOR");
  }
}

export async function resolveCteRegulatoryRuntime(
  contract: Pick<CteContract, "tenantId" | "vector" | "commercialTerms">,
  input: RegulatoryRuntimeResolutionInput,
  resolver: CteRegulatoryRuntimeResolver | undefined,
): Promise<CteRuntimeResolution> {
  if (contract.vector !== "EE") return { dispatching: null, capacityMarket: null, loss: null, blockers: [], ready: true };
  if (!resolver) {
    const blockers = [
      ...(contract.commercialTerms.dispatchingReference ? ["DISPATCHING_REGULATORY_RESOLVER_REQUIRED"] : []),
      ...((contract.commercialTerms.capacityMarketSchedule ?? []).some((entry) => entry.mode === "OFFICIAL_PASS_THROUGH") ? ["CAPACITY_MARKET_REGULATORY_RESOLVER_REQUIRED"] : []),
      ...(contract.commercialTerms.lossReference ? ["LOSS_REGULATORY_RESOLVER_REQUIRED"] : []),
    ];
    return { dispatching: null, capacityMarket: null, loss: null, blockers, ready: blockers.length === 0 };
  }

  const dispatching = contract.commercialTerms.dispatchingReference
    ? await resolver.resolveDispatching(input, contract.commercialTerms.dispatchingReference.reference)
    : null;
  const selectedCapacity = contract.commercialTerms.capacityMarketSchedule?.length
    ? resolveCapacityMarketSchedule(contract.commercialTerms.capacityMarketSchedule, { voltageScope: input.voltageLevel, effectiveAt: input.effectiveAt, ...(input.timeClass === undefined ? {} : { timeClass: input.timeClass }) })
    : null;
  const capacityMarket = selectedCapacity && selectedCapacity.mode === "OFFICIAL_PASS_THROUGH"
    ? await resolver.resolveCapacity(input, selectedCapacity)
    : null;
  const loss = contract.commercialTerms.lossReference
    ? await resolver.resolveLoss(input, contract.commercialTerms.lossReference.reference)
    : null;
  const blockers = [
    ...(contract.commercialTerms.dispatchingReference && !dispatching ? ["DISPATCHING_REGULATORY_VALUE_MISSING"] : []),
    ...(selectedCapacity?.mode === "OFFICIAL_PASS_THROUGH" && !capacityMarket ? ["CAPACITY_MARKET_REGULATORY_VALUE_MISSING"] : []),
    ...(contract.commercialTerms.lossReference && !loss ? ["LOSS_REGULATORY_VALUE_MISSING"] : []),
  ];
  return { dispatching, capacityMarket, loss, blockers, ready: blockers.length === 0 };
}
