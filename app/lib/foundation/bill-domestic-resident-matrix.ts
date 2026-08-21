import type { BillSupplyProfile } from "../ingestion/bill-supply-profile.ts";
import type { StructuredBillEconomicChargeLine, StructuredBillExtendedFact } from "../ingestion/structured-bill.ts";
import type { RegulatoryValueRecord } from "./regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { referenceDomainOf, type ReferenceDomain } from "./regulatory-domains.ts";

export const ARERA_DOMESTIC_TARIFF_SOURCE = "https://www.arera.it/area-operatori/prezzi-e-tariffe/tariffe-trasmissione-distribuzione-e-misura-clienti-domestici";
export const ARERA_DISPATCHING_SOURCE = "https://www.arera.it/area-operatori/prezzi-e-tariffe/corrispettivi-per-gli-utenti-del-dispacciamento";
export const TERNA_CORRISPETTIVI_SOURCE = "https://dati.terna.it/corrispettivi";
export const GME_OFFICIAL_HOST = "gme.mercatoelettrico.org";

export type MatrixAuthority = "ARERA" | "TERNA" | "GME" | "CONTRACT";
export type BillEvidence = "PRESENT_EXACT" | "PRESENT_AGGREGATED" | "NOT_IDENTIFIED";
export type ReferenceStatus = "AVAILABLE" | "REFERENCE_MISSING" | "NOT_PUBLISHED_AS_SEPARATE_REFERENCE" | "NOT_APPLICABLE";
export type MatrixAuditability = "COMPARABLE" | "NOT_COMPARABLE" | "CONTRACT_REQUIRED" | "DOCUMENT_DETAIL_REQUIRED" | "REFERENCE_MISSING" | "NOT_PUBLISHED_AS_SEPARATE_REFERENCE";
export type CoverageStatus = "VERIFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE";
export type BillAuditability = "COMPLETE" | "PARTIAL" | "CONTRACT_REQUIRED" | "DOCUMENT_DETAIL_REQUIRED" | "NOT_AUDITABLE";

export type ExpectedComponentCode =
  | "NETWORK_FIXED" | "METERING_FIXED" | "NETWORK_POWER" | "NETWORK_ENERGY" | "TRANSMISSION_ENERGY"
  | "ASOS" | "ARIM" | "UC3" | "UC6"
  | "DISPATCHING" | "DISPATCHING_TOTAL" | "DISPATCHING_UPLIFT" | "DISPATCHING_ESSENTIAL_UNITS" | "DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION" | "DISPATCHING_TERNA_OPERATION"
  | "DISPATCHING_EXTRAORDINARY_MODULATION" | "DISPATCHING_WIND_COMPENSATION" | "DISPATCHING_OTHER_ITEMS"
  | "CAPACITY_MARKET" | "CAPACITY_MARKET_PEAK" | "CAPACITY_MARKET_OFF_PEAK"
  | "GME_PUN_F1" | "GME_PUN_F2" | "GME_PUN_F3";

export interface MatrixSourceValue {
  readonly officialIdentifier: string;
  readonly sourceReference: string;
  readonly sourceOriginalValue: number | null;
  readonly sourceOriginalUnit: string | null;
  readonly normalizedValue: number | null;
  readonly normalizedUnit: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly applicationBasis: string;
  readonly customerScope: string;
  readonly sourceSha256: string | null;
  readonly referenceDomain?: ReferenceDomain | null;
}

export interface ExpectedComponent {
  readonly code: ExpectedComponentCode;
  readonly authority: MatrixAuthority;
  readonly officialName: string;
  readonly applicability: string;
  readonly applicationBasis: string;
  readonly reference: string;
  readonly billEvidence: BillEvidence;
  readonly referenceStatus: ReferenceStatus;
  readonly auditability: MatrixAuditability;
  readonly sourceValue: MatrixSourceValue | null;
  readonly calculatedBy: "ARERA" | "TERNA" | "GME" | null;
  readonly publishedBy: "ARERA" | "TERNA" | "GME" | null;
  readonly periodicity: "ANNUAL" | "QUARTERLY" | "MONTHLY" | null;
  readonly contractPassThroughRequired: boolean;
  readonly contributingReferences: readonly string[];
  readonly notComparableReason: string | null;
}

export interface MatrixCoverage {
  readonly ARERA_NETWORK_SOURCE_COVERAGE: CoverageStatus;
  readonly ARERA_NETWORK_BILL_AUDITABILITY: BillAuditability;
  readonly ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE: CoverageStatus;
  readonly ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY: BillAuditability;
  readonly DISPATCHING_SOURCE_COVERAGE: CoverageStatus;
  readonly DISPATCHING_BILL_AUDITABILITY: BillAuditability;
  readonly CAPACITY_MARKET_SOURCE_COVERAGE: CoverageStatus;
  readonly CAPACITY_MARKET_BILL_AUDITABILITY: BillAuditability;
  readonly GME_SOURCE_COVERAGE: CoverageStatus;
  readonly GME_BILL_AUDITABILITY: BillAuditability;
  readonly ARERA_NETWORK_COVERAGE: CoverageStatus;
  readonly ARERA_SYSTEM_CHARGES_COVERAGE: CoverageStatus;
  readonly TERNA_DISPATCHING_COVERAGE: CoverageStatus;
  readonly TERNA_CAPACITY_MARKET_COVERAGE: CoverageStatus;
  readonly GME_MARKET_COVERAGE: CoverageStatus;
  readonly CONTRACT_COVERAGE: CoverageStatus | "CONTRACT_REQUIRED";
  readonly TAX_COVERAGE: CoverageStatus;
}

export interface GmeMatrixReference {
  readonly month: string;
  readonly f1: number | null;
  readonly f2: number | null;
  readonly f3: number | null;
  readonly unit: string;
  readonly sourceReference: string | null;
  readonly officialIdentifier: string;
}

export interface DomesticResidentMatrix {
  readonly profileResolved: boolean;
  readonly scope: "DOMESTIC_RESIDENT_BT" | "DOMESTIC_RESIDENT_SCOPE_PENDING_VOLTAGE" | "NOT_APPLICABLE";
  readonly components: readonly ExpectedComponent[];
  readonly coverage: MatrixCoverage;
  readonly counts: {
    readonly expected: number;
    readonly presentExact: number;
    readonly presentAggregated: number;
    readonly notIdentified: number;
    readonly comparable: number;
    readonly contractRequired: number;
    readonly documentDetailRequired: number;
    readonly referenceMissing: number;
  };
  readonly areraNetworkReferenceCount: number;
  readonly areraSystemChargeReferenceCount: number;
  readonly ternaDispatchingReferenceCount: number;
  readonly ternaCapacityReferenceCount: number;
  readonly areraExpectedReferenceCount: number;
  readonly areraAvailableReferenceCount: number;
  readonly areraMissingReferenceCount: number;
  readonly areraMissingReferenceCodes: readonly string[];
  readonly dispatchingReferenceCount: number;
  readonly capacityMarketReferenceCount: number;
  readonly pun: {
    readonly source: readonly { readonly band: "F1" | "F2" | "F3"; readonly sourceValue: number | null; readonly sourceUnit: string | null; readonly displayValue: number | null; readonly displayUnit: "EUR/KWH" | null }[];
    readonly appliedSourceValue: number | null;
    readonly appliedSourceUnit: string | null;
    readonly appliedDisplayValue: number | null;
    readonly appliedDisplayUnit: "EUR/KWH" | null;
    readonly appliedUnitStatus: "RESOLVED" | "UNRESOLVED";
  };
}

export interface DomesticResidentMatrixInput {
  readonly profile: BillSupplyProfile | null;
  readonly billingPeriod: { readonly from: string; readonly to: string };
  readonly chargeLines: readonly StructuredBillEconomicChargeLine[];
  readonly extendedFacts: readonly StructuredBillExtendedFact[];
  readonly regulatoryReferences: readonly RegulatoryValueRecord[];
  readonly gmeReferences: readonly GmeMatrixReference[];
  readonly contractAvailable: boolean;
}

export type PhantomComponentStatus = "OFFICIAL_REFERENCE_AVAILABLE" | "OFFICIAL_REFERENCE_NOT_SEPARATE" | "NOT_APPLICABLE" | "SOURCE_DISCOVERY_REQUIRED";
export type PhantomComponentAssessment = { readonly code: string; readonly status: PhantomComponentStatus; readonly evidence: string };

const NETWORK_CODES: readonly ExpectedComponentCode[] = ["NETWORK_FIXED", "METERING_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "TRANSMISSION_ENERGY"];
const SYSTEM_CODES: readonly ExpectedComponentCode[] = ["ASOS", "ARIM", "UC3", "UC6"];
const TERNA_DISPATCHING_CODES: readonly ExpectedComponentCode[] = ["DISPATCHING_TOTAL", "DISPATCHING_UPLIFT", "DISPATCHING_ESSENTIAL_UNITS", "DISPATCHING_TERNA_OPERATION", "DISPATCHING_EXTRAORDINARY_MODULATION", "DISPATCHING_WIND_COMPENSATION", "DISPATCHING_OTHER_ITEMS"];
const PUN_CODES: readonly ExpectedComponentCode[] = ["GME_PUN_F1", "GME_PUN_F2", "GME_PUN_F3"];

function sourceFromRecord(record: RegulatoryValueRecord | null): MatrixSourceValue | null {
  return record ? {
    officialIdentifier: record.officialIdentifier, sourceReference: record.sourceReference,
    sourceOriginalValue: record.originalValue, sourceOriginalUnit: record.originalUnit,
    normalizedValue: record.normalizedValue, normalizedUnit: record.normalizedUnit,
    effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo,
    applicationBasis: record.applicationBasis, customerScope: record.customerScope,
    sourceSha256: record.sourceSha256,
    referenceDomain: referenceDomainOf(record),
  } : null;
}

function fieldPresent(facts: readonly StructuredBillExtendedFact[], code: string): boolean {
  return facts.some((fact) => fact.code === code && fact.status === "FOUND" && fact.value.trim() !== "");
}

function lineFor(lines: readonly StructuredBillEconomicChargeLine[], codes: readonly string[]): StructuredBillEconomicChargeLine | undefined {
  return lines.find((line) => codes.includes(line.code) && line.status === "FOUND");
}

function recordFor(records: readonly RegulatoryValueRecord[], code: string, scope: string): RegulatoryValueRecord | null {
  const values = records.filter((record) => record.componentCode === code && (record.customerScope === scope || record.customerScope === "DOMESTIC_BT"));
  return values.length ? values.sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom))[0] : null;
}

function recordForPeriod(records: readonly RegulatoryValueRecord[], code: string, scope: string, instant: string): RegulatoryValueRecord | null {
  const at = Date.parse(instant);
  return records.find((record) => record.componentCode === code && (record.customerScope === scope || record.customerScope === "DOMESTIC_BT" || record.customerScope === "ALL_ELECTRICITY") && Date.parse(record.effectiveFrom) <= at && (record.effectiveTo === null || at < Date.parse(record.effectiveTo))) ?? null;
}

function normalizedVoltage(profile: BillSupplyProfile | null): string | null {
  const value = profile?.voltageClass.normalizedValue?.toUpperCase() ?? null;
  return value === "BT" ? "BT" : value === "LV" ? "LV" : null;
}

function toEurPerKwh(value: number): number {
  return Math.round((value / 1000) * 1_000_000_000_000) / 1_000_000_000_000;
}

function expectedApplicability(scope: DomesticResidentMatrix["scope"]): string {
  return scope === "DOMESTIC_RESIDENT_BT" ? scope : "DOMESTIC_RESIDENT_SCOPE_PENDING_VOLTAGE";
}

function baseComponent(input: {
  code: ExpectedComponentCode; authority: MatrixAuthority; officialName: string; applicability: string; applicationBasis: string; reference: string;
  billEvidence: BillEvidence; referenceStatus: ReferenceStatus; auditability: MatrixAuditability; sourceValue?: MatrixSourceValue | null;
  calculatedBy?: ExpectedComponent["calculatedBy"]; publishedBy?: ExpectedComponent["publishedBy"]; periodicity?: ExpectedComponent["periodicity"];
  contractPassThroughRequired?: boolean; contributingReferences?: readonly string[]; notComparableReason?: string | null;
}): ExpectedComponent {
  return {
    code: input.code, authority: input.authority, officialName: input.officialName, applicability: input.applicability,
    applicationBasis: input.applicationBasis, reference: input.reference, billEvidence: input.billEvidence,
    referenceStatus: input.referenceStatus, auditability: input.auditability, sourceValue: input.sourceValue ?? null,
    calculatedBy: input.calculatedBy ?? null, publishedBy: input.publishedBy ?? null, periodicity: input.periodicity ?? null,
    contractPassThroughRequired: input.contractPassThroughRequired ?? false, contributingReferences: input.contributingReferences ?? [],
    notComparableReason: input.notComparableReason ?? null,
  };
}

function networkComponents(input: DomesticResidentMatrixInput, scope: DomesticResidentMatrix["scope"]): ExpectedComponent[] {
  const aggregate = lineFor(input.chargeLines, ["NETWORK_SYSTEM", "NETWORK_FIXED"]);
  const power = lineFor(input.chargeLines, ["POWER_CHARGE", "NETWORK_POWER"]);
  const aggregateEvidence: BillEvidence = aggregate ? "PRESENT_AGGREGATED" : "NOT_IDENTIFIED";
  const powerEvidence: BillEvidence = power ? "PRESENT_EXACT" : "NOT_IDENTIFIED";
  const auditFor = (evidence: BillEvidence): MatrixAuditability => evidence === "PRESENT_AGGREGATED" ? "DOCUMENT_DETAIL_REQUIRED" : scope === "DOMESTIC_RESIDENT_BT" ? "COMPARABLE" : "NOT_COMPARABLE";
  const common = { applicability: expectedApplicability(scope), authority: "ARERA" as const, calculatedBy: "ARERA" as const, publishedBy: "ARERA" as const, periodicity: "ANNUAL" as const, reference: ARERA_DOMESTIC_TARIFF_SOURCE };
  const record = (...codes: RegulatoryValueRecord["componentCode"][]): RegulatoryValueRecord | null => {
    const aliases: Partial<Record<RegulatoryValueRecord["componentCode"], RegulatoryValueRecord["componentCode"][]>> = { S1_TOTAL: ["NETWORK_FIXED", "S1_TOTAL"], S1_MEASURE: ["METERING_FIXED", "S1_MEASURE"], S2_POWER: ["NETWORK_POWER", "S2_POWER"], S3_ENERGY_TRANSMISSION: ["TRANSMISSION_ENERGY", "NETWORK_ENERGY", "S3_ENERGY_TRANSMISSION"] };
    return codes.flatMap((code) => aliases[code] ?? [code]).map((code) => recordFor(input.regulatoryReferences, code, "DOMESTIC_BT")).find((item): item is RegulatoryValueRecord => item !== null) ?? null;
  };
  const component = (args: { code: ExpectedComponentCode; officialName: string; applicationBasis: string; recordCode: RegulatoryValueRecord["componentCode"]; evidence: BillEvidence; contributingReferences?: readonly string[] }): ExpectedComponent => {
    const source = record(args.recordCode);
    return baseComponent({ ...common, code: args.code, officialName: args.officialName, applicationBasis: args.applicationBasis, billEvidence: args.evidence, referenceStatus: source ? "AVAILABLE" : "REFERENCE_MISSING", auditability: source ? auditFor(args.evidence) : "REFERENCE_MISSING", sourceValue: sourceFromRecord(source), contributingReferences: args.contributingReferences ?? [], notComparableReason: source ? (args.evidence === "PRESENT_AGGREGATED" ? "AGGREGATED_BILL_LINE" : scope !== "DOMESTIC_RESIDENT_BT" ? "VOLTAGE_CLASS_UNRESOLVED" : null) : "REFERENCE_MISSING" });
  };
  return [
    component({ ...common, code: "NETWORK_FIXED", officialName: "Componente s1 — totale quota fissa", applicationBasis: "Quota fissa per punto di prelievo per anno", recordCode: "S1_TOTAL", evidence: aggregateEvidence, contributingReferences: aggregate ? ["NETWORK_SYSTEM", "NETWORK_FIXED"] : [] }),
    component({ ...common, code: "METERING_FIXED", officialName: "Componente s1 — di cui misura", applicationBasis: "Quota fissa di misura per punto di prelievo per anno", recordCode: "S1_MEASURE", evidence: aggregateEvidence, contributingReferences: aggregate ? ["NETWORK_SYSTEM", "NETWORK_FIXED"] : [] }),
    component({ ...common, code: "NETWORK_POWER", officialName: "Componente s2 — quota potenza", applicationBasis: "Quota potenza per kW per anno", recordCode: "S2_POWER", evidence: powerEvidence }),
    component({ ...common, code: "NETWORK_ENERGY", officialName: "Componente s3 — quota energia di rete", applicationBasis: "Quota energia della rete", recordCode: "S3_ENERGY_TRANSMISSION", evidence: aggregateEvidence, contributingReferences: aggregate ? ["NETWORK_SYSTEM"] : [] }),
    component({ ...common, code: "TRANSMISSION_ENERGY", officialName: "Componente s3 — trasmissione", applicationBasis: "Quota energia per trasmissione", recordCode: "S3_ENERGY_TRANSMISSION", evidence: aggregateEvidence, contributingReferences: aggregate ? ["NETWORK_SYSTEM"] : [] }),
  ];
}

function systemComponents(input: DomesticResidentMatrixInput, scope: DomesticResidentMatrix["scope"]): ExpectedComponent[] {
  const common = { applicability: expectedApplicability(scope), authority: "ARERA" as const, calculatedBy: "ARERA" as const, publishedBy: "ARERA" as const, periodicity: "QUARTERLY" as const, reference: "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com-TABELLE.xlsx" };
  return SYSTEM_CODES.map((code) => {
    const record = recordForPeriod(input.regulatoryReferences, code, "DOMESTIC_RESIDENT_BT", input.billingPeriod.from);
    const evidence = lineFor(input.chargeLines, [code]) ? "PRESENT_EXACT" : "NOT_IDENTIFIED";
    return baseComponent({ ...common, code, officialName: `Oneri generali di sistema ${code}`, applicationBasis: `Valore ufficiale ${code} per utenza domestica residente BT`, billEvidence: evidence, referenceStatus: record ? "AVAILABLE" : "REFERENCE_MISSING", auditability: evidence === "NOT_IDENTIFIED" ? "DOCUMENT_DETAIL_REQUIRED" : scope === "DOMESTIC_RESIDENT_BT" && record ? "COMPARABLE" : "NOT_COMPARABLE", sourceValue: sourceFromRecord(record), notComparableReason: !record ? "REFERENCE_MISSING" : evidence === "NOT_IDENTIFIED" ? "BILL_LINE_NOT_IDENTIFIED" : scope !== "DOMESTIC_RESIDENT_BT" ? "VOLTAGE_CLASS_UNRESOLVED" : null });
  });
}

// Kept as a compatibility helper for callers that import the pre-domain matrix shape.
// The builder below deliberately uses actualDomainComponents instead.
function ternaComponents(input: DomesticResidentMatrixInput): ExpectedComponent[] { // eslint-disable-line @typescript-eslint/no-unused-vars
  const dispatchingFact = fieldPresent(input.extendedFacts, "DISPATCHING");
  const capacityFact = fieldPresent(input.extendedFacts, "CAPACITY_MARKET");
  const make = (code: ExpectedComponentCode, evidence: BillEvidence, group: "DISPATCHING" | "CAPACITY_MARKET"): ExpectedComponent => {
    const officialName = code.replaceAll("_", " ");
    const record = recordForPeriod(input.regulatoryReferences, code, "DOMESTIC_RESIDENT_BT", "2026-07-01");
    const available = record !== null;
    const missingReference: ReferenceStatus = group === "DISPATCHING" ? "REFERENCE_MISSING" : "NOT_PUBLISHED_AS_SEPARATE_REFERENCE";
    return baseComponent({
      code, authority: "TERNA", officialName, applicability: "EE — valore upstream per BRP", applicationBasis: "Corrispettivo applicato da TERNA ai BRP; traslazione al cliente libero solo se prevista dal contratto", reference: group === "DISPATCHING" ? TERNA_CORRISPETTIVI_SOURCE : TERNA_CORRISPETTIVI_SOURCE,
      billEvidence: evidence, referenceStatus: available ? "AVAILABLE" : missingReference, auditability: available ? "CONTRACT_REQUIRED" : evidence === "PRESENT_EXACT" ? "CONTRACT_REQUIRED" : missingReference, sourceValue: sourceFromRecord(record), calculatedBy: "TERNA", publishedBy: "TERNA", periodicity: "QUARTERLY", contractPassThroughRequired: true,
      notComparableReason: evidence === "PRESENT_EXACT" ? "CONTRACT_REFERENCE_REQUIRED" : available ? "CONTRACT_REFERENCE_REQUIRED" : missingReference,
    });
  };
  return [
    make("DISPATCHING_TOTAL", dispatchingFact ? "PRESENT_EXACT" : "NOT_IDENTIFIED", "DISPATCHING"),
    ...TERNA_DISPATCHING_CODES.slice(1).map((code) => make(code, "NOT_IDENTIFIED", "DISPATCHING")),
    make("CAPACITY_MARKET", capacityFact ? "PRESENT_EXACT" : "NOT_IDENTIFIED", "CAPACITY_MARKET"),
    make("CAPACITY_MARKET_PEAK", "NOT_IDENTIFIED", "CAPACITY_MARKET"),
    make("CAPACITY_MARKET_OFF_PEAK", "NOT_IDENTIFIED", "CAPACITY_MARKET"),
  ];
}

function punComponents(input: DomesticResidentMatrixInput, scope: DomesticResidentMatrix["scope"]): { components: ExpectedComponent[]; pun: DomesticResidentMatrix["pun"] } {
  const reference = input.gmeReferences[0] ?? null;
  const values = { F1: reference?.f1 ?? null, F2: reference?.f2 ?? null, F3: reference?.f3 ?? null } as const;
  const bands = (Object.keys(values) as (keyof typeof values)[]).map((band) => {
    const sourceValue = values[band];
    const sourceUnit = sourceValue === null ? null : reference?.unit ?? null;
    const displayValue = sourceValue === null ? null : sourceUnit === "EUR/MWH" || sourceUnit === "EUR_PER_MWH" ? toEurPerKwh(sourceValue) : sourceUnit === "EUR/KWH" || sourceUnit === "EUR_PER_KWH" ? sourceValue : null;
    return { band, sourceValue, sourceUnit, displayValue, displayUnit: displayValue === null ? null : "EUR/KWH" as const };
  });
  const fact = input.extendedFacts.find((item) => ["PUN_F1", "PUN_F2", "PUN_F3", "PUN_SINGLE"].includes(item.code) && item.status === "FOUND");
  const appliedSourceValue = fact ? Number(fact.value.replace(/\./g, "").replace(",", ".")) : null;
  const appliedSourceUnit = fact?.unit?.toUpperCase() ?? null;
  const appliedDisplayValue = appliedSourceValue === null ? null : appliedSourceUnit === "EUR/MWH" ? toEurPerKwh(appliedSourceValue) : appliedSourceUnit === "EUR/KWH" ? appliedSourceValue : null;
  const pun = { source: bands, appliedSourceValue, appliedSourceUnit, appliedDisplayValue, appliedDisplayUnit: appliedDisplayValue === null ? null : "EUR/KWH" as const, appliedUnitStatus: appliedDisplayValue === null ? "UNRESOLVED" as const : "RESOLVED" as const };
  const components = PUN_CODES.map((code, index) => {
    const band = bands[index];
    const evidence = fieldPresent(input.extendedFacts, `PUN_F${index + 1}`) ? "PRESENT_EXACT" : "NOT_IDENTIFIED";
    const available = band.sourceValue !== null && band.displayValue !== null;
    return baseComponent({ code, authority: "GME", officialName: `PUN GME ${band.band}`, applicability: "EE — periodo bolletta", applicationBasis: "Prezzo medio ufficiale GME per fascia", reference: reference?.sourceReference ?? "GME_ARCHIVE_REFERENCE_MISSING", billEvidence: evidence, referenceStatus: available ? "AVAILABLE" : "REFERENCE_MISSING", auditability: available && evidence === "PRESENT_EXACT" ? "COMPARABLE" : "NOT_COMPARABLE", sourceValue: available ? { officialIdentifier: reference?.officialIdentifier ?? "GME", sourceReference: reference?.sourceReference ?? "", sourceOriginalValue: band.sourceValue, sourceOriginalUnit: band.sourceUnit, normalizedValue: band.displayValue, normalizedUnit: band.displayUnit, effectiveFrom: `${input.billingPeriod.from.slice(0, 7)}-01`, effectiveTo: input.billingPeriod.to, applicationBasis: "Prezzo medio ufficiale GME per fascia", customerScope: "EE", sourceSha256: null } : null, calculatedBy: "GME", publishedBy: "GME", periodicity: "MONTHLY", notComparableReason: !available ? "REFERENCE_MISSING" : evidence !== "PRESENT_EXACT" ? "BILL_PUN_NOT_IDENTIFIED" : scope !== "DOMESTIC_RESIDENT_BT" ? null : null });
  });
  return { components, pun };
}

function applicableDomainRecords(input: DomesticResidentMatrixInput, domain: ReferenceDomain): RegulatoryValueRecord[] {
  const at = Date.parse(input.billingPeriod.from);
  const unique = new Map<string, RegulatoryValueRecord>();
  for (const record of input.regulatoryReferences) {
    if (referenceDomainOf(record) !== domain || Date.parse(record.effectiveFrom) > at || (record.effectiveTo !== null && at >= Date.parse(record.effectiveTo))) continue;
    if (!unique.has(record.componentCode)) unique.set(record.componentCode, record);
  }
  return [...unique.values()];
}

function actualDomainComponents(input: DomesticResidentMatrixInput, domain: ReferenceDomain): ExpectedComponent[] {
  return applicableDomainRecords(input, domain).map((record) => {
    const code = record.componentCode as ExpectedComponentCode;
    const evidence: BillEvidence = lineFor(input.chargeLines, [record.componentCode]) ? "PRESENT_EXACT" : "NOT_IDENTIFIED";
    return baseComponent({
      code, authority: record.authority, officialName: record.officialName ?? record.componentCode,
      applicability: "EE official reference applicable to billing period", applicationBasis: record.applicationBasis,
      reference: record.sourceReference, billEvidence: evidence, referenceStatus: "AVAILABLE", auditability: "CONTRACT_REQUIRED",
      sourceValue: sourceFromRecord(record), calculatedBy: record.calculatedBy === "ARERA" || record.calculatedBy === "TERNA" ? record.calculatedBy : record.authority, publishedBy: record.publishedBy === "ARERA" || record.publishedBy === "TERNA" ? record.publishedBy : record.authority,
      periodicity: "QUARTERLY", contractPassThroughRequired: true, notComparableReason: "CONTRACT_REFERENCE_REQUIRED",
    });
  });
}

function sourceCoverage(items: readonly ExpectedComponent[]): CoverageStatus {
  if (!items.length) return "MISSING";
  if (items.every((item) => item.referenceStatus === "AVAILABLE")) return "VERIFIED";
  if (items.some((item) => item.referenceStatus === "AVAILABLE")) return "PARTIAL";
  return "MISSING";
}

function billAuditability(items: readonly ExpectedComponent[]): BillAuditability {
  if (!items.length) return "NOT_AUDITABLE";
  if (items.some((item) => item.billEvidence === "PRESENT_AGGREGATED")) return "DOCUMENT_DETAIL_REQUIRED";
  if (items.some((item) => item.auditability === "CONTRACT_REQUIRED")) return "CONTRACT_REQUIRED";
  if (items.every((item) => item.auditability === "COMPARABLE")) return "COMPLETE";
  if (items.some((item) => item.auditability === "COMPARABLE")) return "PARTIAL";
  return "NOT_AUDITABLE";
}

function coverage(components: readonly ExpectedComponent[], contractAvailable: boolean): MatrixCoverage {
  const group = (codes: readonly ExpectedComponentCode[]): ExpectedComponent[] => components.filter((component) => codes.includes(component.code));
  const network = group(NETWORK_CODES);
  const system = group(SYSTEM_CODES);
  const dispatching = components.filter((component) => component.sourceValue?.referenceDomain === "DISPATCHING");
  const capacity = components.filter((component) => component.sourceValue?.referenceDomain === "CAPACITY_MARKET");
  const gme = group(PUN_CODES);
  const networkSource = sourceCoverage(network), systemSource = sourceCoverage(system), dispatchingSource = sourceCoverage(dispatching), capacitySource = sourceCoverage(capacity), gmeSource = sourceCoverage(gme);
  return {
    ARERA_NETWORK_SOURCE_COVERAGE: networkSource, ARERA_NETWORK_BILL_AUDITABILITY: billAuditability(network),
    ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE: systemSource, ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY: billAuditability(system),
    DISPATCHING_SOURCE_COVERAGE: dispatchingSource, DISPATCHING_BILL_AUDITABILITY: billAuditability(dispatching),
    CAPACITY_MARKET_SOURCE_COVERAGE: capacitySource, CAPACITY_MARKET_BILL_AUDITABILITY: billAuditability(capacity),
    GME_SOURCE_COVERAGE: gmeSource, GME_BILL_AUDITABILITY: billAuditability(gme),
    ARERA_NETWORK_COVERAGE: networkSource, ARERA_SYSTEM_CHARGES_COVERAGE: systemSource,
    TERNA_DISPATCHING_COVERAGE: dispatchingSource, TERNA_CAPACITY_MARKET_COVERAGE: capacitySource,
    GME_MARKET_COVERAGE: gmeSource, CONTRACT_COVERAGE: contractAvailable ? "VERIFIED" : "CONTRACT_REQUIRED", TAX_COVERAGE: "MISSING",
  };
}

export function buildDomesticResidentMatrix(input: DomesticResidentMatrixInput): DomesticResidentMatrix {
  const profile = input.profile;
  const profileResolved = profile?.supplyUseCategory.normalizedValue === "DOMESTIC" && profile.domesticResidenceStatus.normalizedValue === "RESIDENT";
  const voltage = normalizedVoltage(profile);
  const scope = !profileResolved ? "NOT_APPLICABLE" : voltage ? "DOMESTIC_RESIDENT_BT" : "DOMESTIC_RESIDENT_SCOPE_PENDING_VOLTAGE";
  const network = networkComponents(input, scope);
  const system = systemComponents(input, scope);
  // Expected upstream components are derived from the official records actually
  // applicable to the period; catalog names alone do not create phantom rows.
  const terna = [...actualDomainComponents(input, "DISPATCHING"), ...actualDomainComponents(input, "CAPACITY_MARKET")];
  const gme = punComponents(input, scope);
  const components = [...network, ...system, ...terna, ...gme.components];
  const count = (predicate: (component: ExpectedComponent) => boolean): number => components.filter(predicate).length;
  const counts = {
    expected: components.length,
    presentExact: count((component) => component.billEvidence === "PRESENT_EXACT"),
    presentAggregated: count((component) => component.billEvidence === "PRESENT_AGGREGATED"),
    notIdentified: count((component) => component.billEvidence === "NOT_IDENTIFIED"),
    comparable: count((component) => component.auditability === "COMPARABLE"),
    contractRequired: count((component) => component.auditability === "CONTRACT_REQUIRED" || component.notComparableReason === "CONTRACT_REFERENCE_REQUIRED"),
    documentDetailRequired: count((component) => component.auditability === "DOCUMENT_DETAIL_REQUIRED"),
    referenceMissing: count((component) => component.referenceStatus === "REFERENCE_MISSING"),
  };
  const areraExpected = [...network, ...system];
  const areraMissingCodes = areraExpected.filter((item) => item.referenceStatus !== "AVAILABLE").map((item) => item.code);
  const applicableDispatching = input.regulatoryReferences.filter((record) => referenceDomainOf(record) === "DISPATCHING");
  const applicableCapacity = input.regulatoryReferences.filter((record) => referenceDomainOf(record) === "CAPACITY_MARKET");
  return {
    profileResolved, scope, components, counts,
    coverage: coverage(components, input.contractAvailable),
    areraNetworkReferenceCount: input.regulatoryReferences.filter((record) => referenceDomainOf(record) === "NETWORK").length,
    areraSystemChargeReferenceCount: input.regulatoryReferences.filter((record) => ["ASOS", "ARIM", "UC3", "UC6"].includes(record.componentCode)).length,
    ternaDispatchingReferenceCount: applicableDispatching.length,
    ternaCapacityReferenceCount: applicableCapacity.length,
    areraExpectedReferenceCount: areraExpected.length,
    areraAvailableReferenceCount: areraExpected.filter((item) => item.referenceStatus === "AVAILABLE").length,
    areraMissingReferenceCount: areraMissingCodes.length,
    areraMissingReferenceCodes: areraMissingCodes,
    dispatchingReferenceCount: applicableDispatching.length,
    capacityMarketReferenceCount: applicableCapacity.length,
    pun: gme.pun,
  };
}

export function classifyPhantomComponents(regulatoryReferences: readonly RegulatoryValueRecord[], billingPeriod = "2026-07-01"): readonly PhantomComponentAssessment[] {
  const applicable = regulatoryReferences.filter((record) => Date.parse(record.effectiveFrom) <= Date.parse(billingPeriod) && (record.effectiveTo === null || Date.parse(billingPeriod) < Date.parse(record.effectiveTo)));
  const has = (code: string): boolean => applicable.some((record) => record.componentCode === code && referenceDomainOf(record) === "DISPATCHING");
  return [
    { code: "DISPATCHING_UPLIFT", status: has("DISPATCHING_UPLIFT") ? "OFFICIAL_REFERENCE_AVAILABLE" : "SOURCE_DISCOVERY_REQUIRED", evidence: "TERNA Q3 2026 dispatching publication was discovered; no applicable extracted uplift value is persisted." },
    { code: "DISPATCHING_ESSENTIAL_UNITS", status: has("DISPATCHING_ESSENTIAL_UNITS") ? "OFFICIAL_REFERENCE_AVAILABLE" : has("DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION") ? "OFFICIAL_REFERENCE_NOT_SEPARATE" : "SOURCE_DISCOVERY_REQUIRED", evidence: "The applicable ARERA 587/2025 record is the reintegration subcomponent, not a generic separate total." },
    { code: "DISPATCHING_TERNA_OPERATION", status: has("DISPATCHING_TERNA_OPERATION") ? "OFFICIAL_REFERENCE_AVAILABLE" : "SOURCE_DISCOVERY_REQUIRED", evidence: "ARERA 587/2025/R/eel publishes the Terna operating-cost component." },
    { code: "DISPATCHING_EXTRAORDINARY_MODULATION", status: has("DISPATCHING_EXTRAORDINARY_MODULATION") ? "OFFICIAL_REFERENCE_AVAILABLE" : "SOURCE_DISCOVERY_REQUIRED", evidence: "No applicable persisted value is available for this named TIDE component." },
    { code: "DISPATCHING_WIND_COMPENSATION", status: has("DISPATCHING_WIND_COMPENSATION") ? "OFFICIAL_REFERENCE_AVAILABLE" : "NOT_APPLICABLE", evidence: "No separate applicable official record exists in the July 2026 inventory." },
    { code: "DISPATCHING_OTHER_ITEMS", status: has("DISPATCHING_OTHER_ITEMS") ? "OFFICIAL_REFERENCE_AVAILABLE" : "NOT_APPLICABLE", evidence: "Other items are not an official separately published component." },
    { code: "CAPACITY_MARKET", status: "OFFICIAL_REFERENCE_NOT_SEPARATE", evidence: "The applicable Capacity Market publication contains the single off-peak value; no generic second reference is published." },
    { code: "CAPACITY_MARKET_PEAK", status: "OFFICIAL_REFERENCE_NOT_SEPARATE", evidence: "The applicable Capacity Market publication is explicitly for hours other than peak hours." },
    { code: "CAPACITY_MARKET_OFF_PEAK", status: applicable.some((record) => record.componentCode === "CAPACITY_MARKET_OFF_PEAK" && referenceDomainOf(record) === "CAPACITY_MARKET") ? "OFFICIAL_REFERENCE_AVAILABLE" : "SOURCE_DISCOVERY_REQUIRED", evidence: "TERNA_CAPACITY_MARKET_Q3_2026 is the official off-peak reference." },
  ];
}

export function isAllowedTernaReference(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && ["terna.it", "www.terna.it", "dati.terna.it"].includes(url.hostname.toLowerCase()); } catch { return false; }
}
