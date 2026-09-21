import type { RegulatoryValueRecord } from "./regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { referenceDomainOf, type ReferenceDomain } from "./regulatory-domains.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeRegulatoryUnit } from "./arera-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveCustomerFacingCapacityMarketReference, type CapacityCustomerReference } from "./bill-capacity-market.ts";
import type { StructuredBillEconomicChargeLine, StructuredBillExtendedFact } from "../ingestion/structured-bill.ts";

export type RegulatedPassThroughOutcome = "COINCIDE" | "SCOSTAMENTO" | "PRESENTE_AGGREGATO" | "NON_CONFRONTABILE" | "NON_IDENTIFICATO_IN_BOLLETTA" | "RIFERIMENTO_UFFICIALE_NON_DISPONIBILE" | "NON_APPLICABILE";
export type RegulatedPassThroughStatus = "CONFORME" | "SUPERIORE_AL_RIFERIMENTO" | "INFERIORE_AL_RIFERIMENTO" | "PRESENTE_IN_VOCE_AGGREGATA" | "NON_CONFRONTABILE" | "NON_IDENTIFICATO_SEPARATAMENTE" | "NON_APPLICABILE" | "RIFERIMENTO_UFFICIALE_MANCANTE";
export type RegulatedPassThroughComparisonResult = "MATCH" | "CUSTOMER_OVERCHARGE" | "CUSTOMER_UNDERCHARGE" | null;
export type RegulatedPassThroughBillExposure = "SEPARATE" | "AGGREGATED" | "NOT_IDENTIFIED";
export type BillNonComparableReasonCode = "BILL_COMPONENT_NOT_IDENTIFIED" | "OFFICIAL_REFERENCE_MISSING" | "OFFICIAL_REFERENCE_NOT_PROJECTED" | "SEMANTIC_MISMATCH" | "UNIT_MISMATCH" | "PERIOD_MISMATCH" | "AGGREGATED_BILL_LINE" | "CONTRACT_SPECIFIC_COMPONENT" | "NOT_REGULATED_COMPONENT" | "INSUFFICIENT_EVIDENCE";
export type BillComponentSemanticCategory = "REGULATED_ARERA" | "REGULATED_TERNA" | "REGULATED_REFERENCE_NOT_AVAILABLE" | "REGULATED_NOT_SEMANTICALLY_EQUIVALENT" | "CONTRACTUAL_SELLER" | "FISCAL" | "OTHER_PARTY" | "UNKNOWN";

export type RegulatedPassThroughReference = {
  readonly authority: "ARERA" | "TERNA";
  readonly officialIdentifier: string;
  readonly sourceReference: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly originalValue: number;
  readonly originalUnit: string;
  readonly normalizedValue: number;
  readonly normalizedUnit: string;
  readonly applicationBasis: string;
  readonly regulatoryVariant?: string;
};

export type RegulatedPassThroughItem = {
  readonly code: string;
  readonly label: string;
  readonly semanticCategory: BillComponentSemanticCategory;
  readonly authority: "ARERA" | "TERNA" | "ARERA/TERNA";
  readonly referenceDomain: ReferenceDomain;
  readonly billValue: number | null;
  readonly billOriginalUnit: string | null;
  readonly billQuantity: number | null;
  readonly billAmount: number | null;
  readonly billExposure: RegulatedPassThroughBillExposure;
  readonly officialValue: number | null;
  readonly officialOriginalValue: number | null;
  readonly officialOriginalUnit: string | null;
  readonly officialUnit: string | null;
  readonly normalizedBillRate: number | null;
  readonly normalizedOfficialRate: number | null;
  readonly normalizedUnit: string | null;
  readonly unitRateDifference: number | null;
  readonly unitRateDifferencePercent: number | null;
  readonly estimatedAmountAtOfficialRate: number | null;
  readonly amountDifference: number | null;
  readonly sourceReference: string | null;
  readonly officialIdentifier: string | null;
  readonly effectivePeriod: { readonly from: string; readonly to: string | null } | null;
  readonly applicationBasis: string | null;
  readonly officialReferences: readonly RegulatedPassThroughReference[];
  readonly upstreamReferences: readonly RegulatedPassThroughReference[];
  readonly officialReferenceKind: "CUSTOMER_FACING" | "UPSTREAM" | "NONE";
  readonly outcome: RegulatedPassThroughOutcome;
  readonly status: RegulatedPassThroughStatus;
  readonly comparisonResult: RegulatedPassThroughComparisonResult;
  readonly comparable: boolean;
  readonly reason: string | null;
  readonly reasonCode: BillNonComparableReasonCode | null;
  readonly humanReason: string | null;
};

export type RegulatedPassThroughVerification = {
  readonly items: readonly RegulatedPassThroughItem[];
  readonly summary: {
    readonly regulatedPassThroughCount: number;
    readonly comparableCount: number;
    readonly matchingCount: number;
    readonly differentCount: number;
    readonly overReferenceCount: number;
    readonly underReferenceCount: number;
    readonly aggregatedCount: number;
    readonly nonComparableCount: number;
    readonly notIdentifiedCount: number;
    readonly officialReferenceMissingCount: number;
    readonly confirmedDifferenceAmount: number;
    readonly confirmedDifferenceCount: number;
    readonly confirmedOverchargeCount: number;
    readonly confirmedUnderchargeCount: number;
    readonly confirmedOverchargeAmount: number;
    readonly confirmedUnderchargeAmount: number;
    readonly netConfirmedDifferenceAmount: number;
  };
};

export type RegulatedPassThroughInput = {
  readonly billingPeriod: { readonly from: string; readonly to: string };
  readonly chargeLines: readonly StructuredBillEconomicChargeLine[];
  readonly extendedFacts: readonly StructuredBillExtendedFact[];
  readonly regulatoryReferences: readonly RegulatoryValueRecord[];
  readonly billedConsumptionKwh: number | null;
  readonly powerKw: number | null;
  readonly customerScope: string;
};

const CORE_CODES = ["NETWORK_FIXED", "METERING_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "TRANSMISSION_ENERGY", "ASOS", "ARIM", "UC3", "UC6"] as const;
const LABELS: Readonly<Record<string, string>> = {
  UC6_FIXED: "UC6 quota fissa", UC6_POWER: "UC6 quota potenza", UC6_ENERGY: "UC6 quota energia",
  NETWORK_FIXED: "Rete — quota fissa", METERING_FIXED: "Misura — quota fissa", NETWORK_POWER: "Rete — quota potenza",
  NETWORK_ENERGY: "Rete — quota energia", TRANSMISSION_ENERGY: "Trasmissione", ASOS: "ASOS", ARIM: "ARIM", UC3: "UC3", UC6: "UC6",
  DISPATCHING: "Dispacciamento", CAPACITY_MARKET: "Capacity Market",
};
const NETWORK_ALIASES: Readonly<Record<string, readonly string[]>> = {
  NETWORK_FIXED: ["NETWORK_FIXED", "S1_TOTAL", "NETWORK_SYSTEM"], METERING_FIXED: ["METERING_FIXED", "S1_MEASURE", "NETWORK_SYSTEM"], NETWORK_POWER: ["NETWORK_POWER", "S2_POWER", "POWER_CHARGE"],
  NETWORK_ENERGY: ["NETWORK_ENERGY", "S3_ENERGY_TRANSMISSION", "NETWORK_ENERGY_TOTAL", "NETWORK_SYSTEM"], TRANSMISSION_ENERGY: ["TRANSMISSION_ENERGY", "S3_ENERGY_TRANSMISSION", "NETWORK_ENERGY", "NETWORK_SYSTEM"],
  ASOS: ["ASOS"], ARIM: ["ARIM"], UC3: ["UC3"], UC6: ["UC6"], UC6_FIXED: ["UC6"], UC6_POWER: ["UC6"], UC6_ENERGY: ["UC6"],
};
const RATE_TOLERANCE = 0.000001;
const AMOUNT_TOLERANCE = 0.02;

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const compact = value.replace(/\s/g, "").replace(/[^0-9,.+-]/g, "");
  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function canonicalUnit(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().replace(/€/g, "EUR").replace(/\s/g, "").replace(/PER/g, "/").replace(/KW\/MESE/g, "KW/MONTH").replace(/POD\/MESE/g, "POD/MONTH").replace(/KW\/ANNO/g, "KW/YEAR").replace(/POD\/ANNO/g, "POD/YEAR");
}

function canonicalBillInputUnit(value: string | null | undefined): string | null {
  const unit = canonicalUnit(value);
  return unit ? unit.replace(/^EURO(?=\/|$)/, "EUR").replace(/^EUROCENT(?=\/|$)/, "CENT_EUR").replace(/\/MESE/g, "/MONTH").replace(/\/ANNO/g, "/YEAR") : null;
}

function applicable(record: RegulatoryValueRecord, period: string, scope: string): boolean {
  const at = Date.parse(period);
  const scopeOk = record.customerScope === scope || record.customerScope === "ALL_ELECTRICITY" || (["DOMESTIC_RESIDENT_BT", "DOMESTIC_NON_RESIDENT_BT"].includes(scope) && record.customerScope === "DOMESTIC_BT");
  return scopeOk && Date.parse(record.effectiveFrom) <= at && (record.effectiveTo === null || at < Date.parse(record.effectiveTo));
}

function customerFacingReferenceFor(records: readonly RegulatoryValueRecord[], domain: ReferenceDomain, componentCode: string, period: { readonly from: string; readonly to: string }, scope: string): RegulatoryValueRecord | null {
  return records
    .filter((record) => referenceDomainOf(record) === domain && record.componentCode === componentCode && applicable(record, period.from, scope))
    .sort((left, right) => {
      const leftScore = (left.customerScope === scope ? 100 : 0) + (left.effectiveFrom === period.from && left.effectiveTo === period.to ? 20 : 0) + (left.authority === "ARERA" ? 10 : 0) + (left.contractPassThroughRequired ? 5 : 0);
      const rightScore = (right.customerScope === scope ? 100 : 0) + (right.effectiveFrom === period.from && right.effectiveTo === period.to ? 20 : 0) + (right.authority === "ARERA" ? 10 : 0) + (right.contractPassThroughRequired ? 5 : 0);
      return rightScore - leftScore || Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
    })[0] ?? null;
}

function recordFor(records: readonly RegulatoryValueRecord[], codes: readonly string[], period: string, scope: string, normalizedUnit?: string, billLine: StructuredBillEconomicChargeLine | null = null): RegulatoryValueRecord | null {
  const matches = records.filter((record) => codes.includes(record.componentCode) && applicable(record, period, scope) && (!normalizedUnit || record.normalizedUnit === normalizedUnit));
  if (codes.includes("ASOS") && normalizedUnit && billLine && matches.length > 0) {
    const billValue = numeric(billLine.unitPrice);
    const billUnit = canonicalBillInputUnit(billLine.unit);
    const normalizedBill = billValue === null || billUnit === null ? null : normalizeBillRate("ASOS", billValue, billUnit, normalizedUnit);
    if (normalizedBill) {
      const exactMatches = matches.filter((candidate) => {
        const normalizedOfficial = normalizeOfficialRate(candidate, normalizedUnit);
        return normalizedOfficial !== null && normalizedOfficial.unit === normalizedBill.unit && Math.abs(normalizedOfficial.value - normalizedBill.value) <= RATE_TOLERANCE;
      });
      // ASOS BTA6 has four official variants. Never choose one by insertion
      // order: an exact bill-rate match must identify one and only one.
      if (exactMatches.length === 1) return exactMatches[0];
      if (exactMatches.length > 1) return null;
    }
  }
  return matches.sort((left, right) => {
    const leftExact = left.componentCode === codes[0] ? 1 : 0;
    const rightExact = right.componentCode === codes[0] ? 1 : 0;
    return rightExact - leftExact || (right.customerScope === scope ? 1 : 0) - (left.customerScope === scope ? 1 : 0) || Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
  })[0] ?? null;
}

function referencesFor(records: readonly RegulatoryValueRecord[], domain: ReferenceDomain, period: string, scope: string): readonly RegulatoryValueRecord[] {
  const unique = new Map<string, RegulatoryValueRecord>();
  for (const record of records) if (referenceDomainOf(record) === domain && applicable(record, period, scope)) unique.set(record.officialIdentifier + "|" + record.componentCode, record);
  return [...unique.values()];
}

function lineFor(lines: readonly StructuredBillEconomicChargeLine[], codes: readonly string[]): StructuredBillEconomicChargeLine | null {
  return lines.find((line) => line.status === "FOUND" && codes.includes(line.code)) ?? null;
}

function componentLines(lines: readonly StructuredBillEconomicChargeLine[], code: string): readonly StructuredBillEconomicChargeLine[] {
  const found = lines.filter((line) => line.status === "FOUND");
  const matches = (test: (line: StructuredBillEconomicChargeLine) => boolean): readonly StructuredBillEconomicChargeLine[] => found.filter(test);
  switch (code) {
    case "NETWORK_FIXED": return matches((line) => line.code === "NETWORK_FIXED" && !/uc6/i.test(line.description));
    case "METERING_FIXED": return matches((line) => line.code === "METERING_FIXED" || (line.code === "OTHER_SELLER_FIXED_CHARGE" && /servizio\s+di\s+misura/i.test(line.description) && /quota\s+fissa/i.test(line.description)));
    case "NETWORK_POWER": return matches((line) => line.code === "POWER_CHARGE" && !/uc6/i.test(line.description));
    case "NETWORK_ENERGY": return matches((line) => line.code === "NETWORK_SYSTEM" && /distribuzione.*energia/i.test(line.description) && !/uc3|uc6/i.test(line.description));
    case "TRANSMISSION_ENERGY": return matches((line) => line.code === "TRANSMISSION_ENERGY" || (line.code === "NETWORK_SYSTEM" && /tariffa\s+di\s+trasmissione/i.test(line.description) && /energia|scaglione/i.test(line.description)));
    case "ASOS": return matches((line) => line.code === "ASOS");
    case "ARIM": return matches((line) => line.code === "ARIM");
    case "UC3": return matches((line) => line.code === "NETWORK_SYSTEM" && /uc3/i.test(line.description));
    case "UC6": return matches((line) => (line.code === "NETWORK_FIXED" || line.code === "POWER_CHARGE" || line.code === "NETWORK_SYSTEM") && /uc6/i.test(line.description));
    case "UC6_FIXED": return matches((line) => line.code === "NETWORK_FIXED" && /uc6/i.test(line.description) && /fissa/i.test(line.description));
    case "UC6_POWER": return matches((line) => line.code === "POWER_CHARGE" && /uc6/i.test(line.description) && /potenza/i.test(line.description));
    case "UC6_ENERGY": return matches((line) => line.code === "NETWORK_SYSTEM" && /uc6/i.test(line.description) && /energia|scaglione/i.test(line.description));
    default: return matches((line) => line.code === code);
  }
}

function mergedLine(lines: readonly StructuredBillEconomicChargeLine[]): StructuredBillEconomicChargeLine | null {
  const first = lines[0];
  if (!first) return null;
  const numericValue = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const text = String(value).replace(/\s/g, "");
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const amounts = lines.map((line) => numericValue(line.amount)).filter((value): value is number => value !== null);
  const quantities = lines.map((line) => numericValue(line.quantity)).filter((value): value is number => value !== null);
  const amount = amounts.length ? amounts.reduce((sum, value) => sum + value, 0).toFixed(2) : first.amount;
  const quantity = quantities.length ? String(quantities.reduce((sum, value) => sum + value, 0)) : first.quantity;
  return lines.length === 1 ? first : { ...first, quantity, amount };
}

function recordUnitFor(code: string, lines: readonly StructuredBillEconomicChargeLine[]): string | undefined {
  if (["NETWORK_FIXED", "METERING_FIXED"].includes(code)) return "EUR/POD/YEAR";
  if (code === "NETWORK_POWER") return "EUR/KW/YEAR";
  if (["NETWORK_ENERGY", "TRANSMISSION_ENERGY", "ASOS", "ARIM", "UC3"].includes(code)) return "EUR/KWH";
  if (code === "UC6_FIXED") return "EUR/POD/YEAR";
  if (code === "UC6_POWER") return "EUR/KW/YEAR";
  if (code === "UC6_ENERGY") return "EUR/KWH";
  if (code === "UC6") {
    const descriptions = lines.map((line) => line.description.toLowerCase());
    if (descriptions.some((description) => description.includes("potenza"))) return "EUR/KW/YEAR";
    if (descriptions.some((description) => description.includes("energia"))) return "EUR/KWH";
    if (descriptions.some((description) => description.includes("fissa"))) return "EUR/POD/YEAR";
    return "EUR/KWH";
  }
  return undefined;
}

function factFor(facts: readonly StructuredBillExtendedFact[], code: string): StructuredBillExtendedFact | null {
  return facts.find((fact) => fact.status === "FOUND" && fact.code === code) ?? null;
}

function isAggregate(line: StructuredBillEconomicChargeLine | null): boolean {
  if (!line) return false;
  if (line.code === "POWER_CHARGE") return false;
  return line.code === "NETWORK_SYSTEM" || /rete\s+e\s+gli\s+oneri|rete\s+e\s+oneri|totale.*rete/i.test(line.description);
}

function periodFraction(period: { readonly from: string; readonly to: string }): number {
  const from = Date.parse(period.from), to = Date.parse(period.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  const year = new Date(from).getUTCFullYear();
  const daysInYear = new Date(Date.UTC(year + 1, 0, 1)).getTime() - new Date(Date.UTC(year, 0, 1)).getTime();
  return (to - from) / daysInYear;
}

function wholeCalendarMonths(period: { readonly from: string; readonly to: string }): number | null {
  const from = new Date(`${period.from}T00:00:00Z`), to = new Date(`${period.to}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getUTCDate() !== 1 || to.getUTCDate() !== 1) return null;
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  return months > 0 ? months : null;
}

function normalizeBillRate(code: string, value: number, unit: string, targetUnit?: string): { readonly value: number; readonly unit: string } | null {
  const source = canonicalBillInputUnit(unit);
  if (!source) return null;
  try {
    if (["NETWORK_FIXED", "METERING_FIXED", "ASOS", "UC6_FIXED"].includes(code) && source === "CENT_EUR/MONTH") return { value: value * 12 / 100, unit: "EUR/POD/YEAR" };
    if (["NETWORK_FIXED", "METERING_FIXED", "ASOS", "UC6_FIXED"].includes(code) && source === "EUR/MONTH") return { value: value * 12, unit: "EUR/POD/YEAR" };
    if (code === "METERING_FIXED" && source === "EUR/POD/MONTH") return { value: value * 12, unit: "EUR/POD/YEAR" };
    if (code === "UC6_POWER" && source === "CENT_EUR/KW/MONTH") return { value: value * 12 / 100, unit: "EUR/KW/YEAR" };
    if (source === "CENT_EUR/KW/MONTH") return targetUnit === "EUR/KW/MONTH" ? { value: value / 100, unit: targetUnit } : { value: value * 12 / 100, unit: "EUR/KW/YEAR" };
    if (source === "CENT_EUR/KWH") return { value: value / 100, unit: "EUR/KWH" };
    if (source === "CENT_EUR/POD/MONTH") return { value: value * 12 / 100, unit: "EUR/POD/YEAR" };
    const normalized = normalizeRegulatoryUnit(value, source, targetUnit);
    return { value: normalized.value, unit: normalized.unit };
  } catch { return null; }
}

function normalizeOfficialRate(record: Pick<RegulatoryValueRecord, "originalValue" | "originalUnit">, targetUnit?: string): { readonly value: number; readonly unit: string } | null {
  try {
    const normalized = normalizeRegulatoryUnit(record.originalValue, record.originalUnit, targetUnit);
    return { value: normalized.value, unit: normalized.unit };
  } catch { return null; }
}

function statusFor(outcome: RegulatedPassThroughOutcome, unitDifference: number | null = null, amountDifference: number | null = null): { readonly status: RegulatedPassThroughStatus; readonly comparisonResult: RegulatedPassThroughComparisonResult } {
  if (outcome === "COINCIDE") return { status: "CONFORME", comparisonResult: "MATCH" };
  if (outcome === "SCOSTAMENTO") {
    const difference = amountDifference ?? unitDifference ?? 0;
    return difference > 0 ? { status: "SUPERIORE_AL_RIFERIMENTO", comparisonResult: "CUSTOMER_OVERCHARGE" } : { status: "INFERIORE_AL_RIFERIMENTO", comparisonResult: "CUSTOMER_UNDERCHARGE" };
  }
  if (outcome === "PRESENTE_AGGREGATO") return { status: "PRESENTE_IN_VOCE_AGGREGATA", comparisonResult: null };
  if (outcome === "NON_IDENTIFICATO_IN_BOLLETTA") return { status: "NON_IDENTIFICATO_SEPARATAMENTE", comparisonResult: null };
  if (outcome === "RIFERIMENTO_UFFICIALE_NON_DISPONIBILE") return { status: "RIFERIMENTO_UFFICIALE_MANCANTE", comparisonResult: null };
  if (outcome === "NON_APPLICABILE") return { status: "NON_APPLICABILE", comparisonResult: null };
  return { status: "NON_CONFRONTABILE", comparisonResult: null };
}

function outcomeFields(outcome: RegulatedPassThroughOutcome, unitDifference: number | null = null, amountDifference: number | null = null): { readonly outcome: RegulatedPassThroughOutcome; readonly status: RegulatedPassThroughStatus; readonly comparisonResult: RegulatedPassThroughComparisonResult } {
  return { outcome, ...statusFor(outcome, unitDifference, amountDifference) };
}

function reasonFields(code: string, reasonCode: BillNonComparableReasonCode | null): { readonly reasonCode: BillNonComparableReasonCode | null; readonly humanReason: string | null } {
  const labels: Readonly<Record<BillNonComparableReasonCode, string>> = {
    BILL_COMPONENT_NOT_IDENTIFIED: "Componente non identificata separatamente nella bolletta.",
    OFFICIAL_REFERENCE_MISSING: "Riferimento ufficiale semanticamente equivalente non disponibile per il periodo.",
    OFFICIAL_REFERENCE_NOT_PROJECTED: "Il riferimento ufficiale esiste, ma non è ancora proiettato nel catalogo runtime.",
    SEMANTIC_MISMATCH: "La voce della bolletta non ha una corrispondenza semantica univoca.",
    UNIT_MISMATCH: "Unità di misura o base di calcolo non equivalenti.",
    PERIOD_MISMATCH: "Periodo di applicazione non equivalente.",
    AGGREGATED_BILL_LINE: "La voce è presente solo in un aggregato della bolletta.",
    CONTRACT_SPECIFIC_COMPONENT: "Voce contrattuale del venditore. I riferimenti ARERA/Terna disponibili non consentono un confronto diretto equivalente.",
    NOT_REGULATED_COMPONENT: "Voce non classificata come componente regolata confrontabile.",
    INSUFFICIENT_EVIDENCE: "Dati documentali insufficienti per un confronto affidabile.",
  };
  if (!reasonCode) return { reasonCode: null, humanReason: null };
  if (code === "UC6_POWER" && (reasonCode === "OFFICIAL_REFERENCE_MISSING" || reasonCode === "OFFICIAL_REFERENCE_NOT_PROJECTED")) return { reasonCode, humanReason: "Riferimento ARERA individuato. Il valore ufficiale equivalente non è disponibile per il profilo e il periodo della fornitura." };
  if (code === "CAPACITY_MARKET" && reasonCode === "SEMANTIC_MISMATCH") return { reasonCode, humanReason: "Voce contrattuale. Il riferimento ufficiale disponibile non è equivalente alla modalità applicata a questa fornitura business." };
  return { reasonCode, humanReason: labels[reasonCode] };
}

export function semanticCategoryLabel(category: BillComponentSemanticCategory): string {
  const labels: Readonly<Record<BillComponentSemanticCategory, string>> = {
    REGULATED_ARERA: "REGOLATA ARERA",
    REGULATED_TERNA: "REGOLATA TERNA",
    REGULATED_REFERENCE_NOT_AVAILABLE: "RIFERIMENTO NON DISPONIBILE",
    REGULATED_NOT_SEMANTICALLY_EQUIVALENT: "RIFERIMENTO NON EQUIVALENTE",
    CONTRACTUAL_SELLER: "CONTRATTUALE VENDITORE",
    FISCAL: "FISCALE",
    OTHER_PARTY: "ALTRA PARTITA",
    UNKNOWN: "CLASSIFICAZIONE DA VERIFICARE",
  };
  return labels[category];
}

function semanticCategoryFor(code: string, authority: RegulatedPassThroughItem["authority"], record: (RegulatoryValueRecord | CapacityCustomerReference) | null, reasonCode: BillNonComparableReasonCode | null, refs: readonly (RegulatoryValueRecord | CapacityCustomerReference)[]): BillComponentSemanticCategory {
  if (code === "UC6_POWER") return "REGULATED_ARERA";
  if (code === "DISPATCHING") return reasonCode === "CONTRACT_SPECIFIC_COMPONENT" ? "CONTRACTUAL_SELLER" : record?.authority === "TERNA" ? "REGULATED_TERNA" : "REGULATED_ARERA";
  if (code === "CAPACITY_MARKET") return reasonCode === "SEMANTIC_MISMATCH" || refs.length > 0 ? "REGULATED_NOT_SEMANTICALLY_EQUIVALENT" : "REGULATED_REFERENCE_NOT_AVAILABLE";
  if (record?.authority === "TERNA" || authority === "TERNA") return "REGULATED_TERNA";
  if (record?.authority === "ARERA" || authority === "ARERA") return "REGULATED_ARERA";
  return reasonCode ? "REGULATED_REFERENCE_NOT_AVAILABLE" : "UNKNOWN";
}

function referenceDTO(record: Pick<RegulatoryValueRecord, "authority" | "officialIdentifier" | "sourceReference" | "effectiveFrom" | "effectiveTo" | "originalValue" | "originalUnit" | "normalizedValue" | "normalizedUnit" | "applicationBasis"> & { readonly regulatoryVariant?: string }): RegulatedPassThroughReference {
  return { authority: record.authority, officialIdentifier: record.officialIdentifier, sourceReference: record.sourceReference, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, originalValue: record.originalValue, originalUnit: record.originalUnit, normalizedValue: record.normalizedValue, normalizedUnit: record.normalizedUnit, applicationBasis: record.applicationBasis, ...(record.regulatoryVariant === undefined ? {} : { regulatoryVariant: record.regulatoryVariant }) };
}

function baseItem(code: string, authority: RegulatedPassThroughItem["authority"], domain: ReferenceDomain, record: (RegulatoryValueRecord | CapacityCustomerReference) | null, refs: readonly (RegulatoryValueRecord | CapacityCustomerReference)[], upstreamRefs: readonly RegulatoryValueRecord[] = [], missingReason: BillNonComparableReasonCode = "OFFICIAL_REFERENCE_MISSING"): RegulatedPassThroughItem {
  const initialOutcome = record ? "NON_CONFRONTABILE" : "RIFERIMENTO_UFFICIALE_NON_DISPONIBILE";
  return { code, label: LABELS[code] ?? code.replaceAll("_", " "), semanticCategory: semanticCategoryFor(code, authority, record, record ? null : missingReason, refs), authority, referenceDomain: domain, billValue: null, billOriginalUnit: null, billQuantity: null, billAmount: null, billExposure: "NOT_IDENTIFIED", officialValue: record?.normalizedValue ?? null, officialOriginalValue: record?.originalValue ?? null, officialOriginalUnit: record?.originalUnit ?? null, officialUnit: record?.normalizedUnit ?? null, normalizedBillRate: null, normalizedOfficialRate: record ? normalizeOfficialRate(record)?.value ?? null : null, normalizedUnit: record ? normalizeOfficialRate(record)?.unit ?? record.normalizedUnit : null, unitRateDifference: null, unitRateDifferencePercent: null, estimatedAmountAtOfficialRate: null, amountDifference: null, sourceReference: record?.sourceReference ?? null, officialIdentifier: record?.officialIdentifier ?? null, effectivePeriod: record ? { from: record.effectiveFrom, to: record.effectiveTo } : null, applicationBasis: record?.applicationBasis ?? null, officialReferences: refs.map(referenceDTO), upstreamReferences: upstreamRefs.map(referenceDTO), officialReferenceKind: record ? (record.authority === "ARERA" ? "CUSTOMER_FACING" : "UPSTREAM") : "NONE", ...outcomeFields(initialOutcome), comparable: false, reason: record ? null : "REFERENCE_MISSING", ...reasonFields(code, record ? null : missingReason) };
}

function withBill(item: RegulatedPassThroughItem, line: StructuredBillEconomicChargeLine | null, fact: StructuredBillExtendedFact | null, code: string, input: RegulatedPassThroughInput, semanticLineMapping = false): RegulatedPassThroughItem {
  const billAmount = numeric(line?.amount);
  const rawBillValue = numeric(fact?.value ?? line?.unitPrice);
  const rawBillUnit = canonicalBillInputUnit(fact?.unit ?? line?.unit);
  const amountBasedConsumptionRate = rawBillValue === null && billAmount !== null && rawBillUnit === "EUR" && input.billedConsumptionKwh !== null && input.billedConsumptionKwh > 0 && Boolean(line && /quota\s+per\s+consumi|consumi/i.test(line.description)) && ["ASOS", "ARIM", "UC3", "UC6"].includes(code)
    ? billAmount / input.billedConsumptionKwh
    : null;
  const billValue = rawBillValue ?? amountBasedConsumptionRate;
  const billUnit = amountBasedConsumptionRate === null ? rawBillUnit : "EUR/KWH";
  const billQuantity = numeric(line?.quantity) ?? (fact || amountBasedConsumptionRate !== null ? input.billedConsumptionKwh : null);
  const aggregate = !semanticLineMapping && isAggregate(line);
  const common = { ...item, billValue, billOriginalUnit: billUnit, billQuantity, billAmount, billExposure: aggregate ? "AGGREGATED" as const : line || fact ? "SEPARATE" as const : "NOT_IDENTIFIED" as const };
  if (aggregate) return { ...common, ...outcomeFields("PRESENTE_AGGREGATO"), reason: "AGGREGATED_BILL_LINE", ...reasonFields(code, "AGGREGATED_BILL_LINE") };
  if (!line && !fact) return { ...common, ...outcomeFields("NON_IDENTIFICATO_IN_BOLLETTA"), reason: "BILL_LINE_NOT_IDENTIFIED", ...reasonFields(code, "BILL_COMPONENT_NOT_IDENTIFIED") };
  if (!item.officialIdentifier) {
    const reasonCode = item.reasonCode ?? "OFFICIAL_REFERENCE_MISSING";
    return { ...common, ...outcomeFields("RIFERIMENTO_UFFICIALE_NON_DISPONIBILE"), reason: reasonCode === "OFFICIAL_REFERENCE_NOT_PROJECTED" ? "REFERENCE_NOT_PROJECTED" : "REFERENCE_MISSING", ...reasonFields(code, reasonCode) };
  }
  if (billValue === null || !billUnit) return { ...common, ...outcomeFields("NON_CONFRONTABILE"), reason: "BILL_RATE_MISSING", ...reasonFields(code, "INSUFFICIENT_EVIDENCE") };
  // A power charge explicitly billed as EUR/kW/month is compared month-to-month.
  // Do not annualize the bill and prorate the official annual tariff by days in
  // the same calculation: that mixes two temporal bases and reverses the sign.
  const monthlyPowerBasis = code === "NETWORK_POWER" && ["EUR/KW/MONTH", "CENT_EUR/KW/MONTH"].includes(billUnit);
  const powerBased = ["NETWORK_POWER", "UC6", "UC6_POWER"].includes(code) && billUnit.includes("KW");
  const comparisonUnit = monthlyPowerBasis ? "EUR/KW/MONTH" : undefined;
  const normalizedBill = normalizeBillRate(code, billValue, billUnit, comparisonUnit);
  const normalizedOfficial = item.officialIdentifier && item.officialOriginalValue !== null && item.officialOriginalUnit
    ? normalizeOfficialRate({ originalValue: item.officialOriginalValue, originalUnit: item.officialOriginalUnit }, comparisonUnit)
    : null;
  if (!normalizedBill || !normalizedOfficial || normalizedOfficial.value === null || !normalizedOfficial.unit || normalizedBill.unit !== normalizedOfficial.unit) return { ...common, ...outcomeFields("NON_CONFRONTABILE"), reason: "UNIT_OR_CALCULATION_BASIS_MISMATCH", ...reasonFields(code, "UNIT_MISMATCH") };
  const difference = normalizedBill.value - normalizedOfficial.value;
  const differencePercent = normalizedOfficial.value === 0 ? null : (difference / normalizedOfficial.value) * 100;
  const fraction = periodFraction(input.billingPeriod);
  const months = wholeCalendarMonths(input.billingPeriod);
  const fixedBased = ["NETWORK_FIXED", "METERING_FIXED", "UC6_FIXED"].includes(code);
  const estimatedAmount = fixedBased
    ? normalizedOfficial.value * (months ?? 12 * fraction) / 12
    : powerBased
      ? monthlyPowerBasis
        ? normalizedOfficial.value * (input.powerKw ?? 0) * (months ?? 12 * fraction)
        : normalizedOfficial.value * (input.powerKw ?? 0) * fraction
      : input.billedConsumptionKwh === null ? null : normalizedOfficial.value * input.billedConsumptionKwh;
  const amountDifference = billAmount === null || estimatedAmount === null ? null : billAmount - estimatedAmount;
  const rateWithinTolerance = Math.abs(difference) <= RATE_TOLERANCE;
  const amountWithinTolerance = amountDifference === null || Math.abs(amountDifference) <= AMOUNT_TOLERANCE;
  const comparable = (rateWithinTolerance && amountWithinTolerance) || (amountBasedConsumptionRate !== null && amountDifference !== null && amountWithinTolerance);
  const outcome = comparable ? "COINCIDE" : "SCOSTAMENTO";
  return { ...common, normalizedBillRate: rounded(normalizedBill.value), normalizedOfficialRate: rounded(normalizedOfficial.value), normalizedUnit: normalizedBill.unit, unitRateDifference: rounded(difference), unitRateDifferencePercent: differencePercent === null ? null : rounded(differencePercent, 4), estimatedAmountAtOfficialRate: estimatedAmount === null ? null : rounded(estimatedAmount, 2), amountDifference: amountDifference === null ? null : rounded(amountDifference, 2), ...outcomeFields(outcome, difference, amountDifference), comparable: true, reason: comparable ? null : "DIFFERENCE_OUTSIDE_TOLERANCE", ...reasonFields(code, null) };
}

function upstreamGroup(code: "DISPATCHING" | "CAPACITY_MARKET", input: RegulatedPassThroughInput): RegulatedPassThroughItem {
  const domain = code === "DISPATCHING" ? "DISPATCHING" : "CAPACITY_MARKET";
  const refs = referencesFor(input.regulatoryReferences, domain, input.billingPeriod.from, input.customerScope);
  const fact = factFor(input.extendedFacts, code);
  const first = refs[0] ?? null;
  const customerReference = code === "CAPACITY_MARKET"
    ? resolveCustomerFacingCapacityMarketReference(input.regulatoryReferences, input.billingPeriod, input.customerScope)
    : customerFacingReferenceFor(input.regulatoryReferences, domain, code, input.billingPeriod, input.customerScope);
  const primary = customerReference ?? (refs.length === 1 ? first : null);
  const upstreamRefs = customerReference ? refs.filter((record) => record.officialIdentifier !== customerReference.officialIdentifier || record.componentCode !== customerReference.componentCode) : refs;
  const item = baseItem(code, customerReference ? "ARERA" : code === "CAPACITY_MARKET" ? "TERNA" : refs.some((record) => record.authority === "TERNA") ? "ARERA/TERNA" : "ARERA", domain, primary, primary ? [primary] : refs, upstreamRefs);
  if (customerReference) return withBill(item, null, fact, code, input);
  const billValue = numeric(fact?.value);
  const billUnit = canonicalUnit(fact?.unit);
  const outcome = !fact ? "NON_IDENTIFICATO_IN_BOLLETTA" : code === "CAPACITY_MARKET" ? "NON_CONFRONTABILE" : !refs.length ? "RIFERIMENTO_UFFICIALE_NON_DISPONIBILE" : "NON_CONFRONTABILE";
  const reasonCode = !fact ? "BILL_COMPONENT_NOT_IDENTIFIED" : code === "CAPACITY_MARKET" ? "SEMANTIC_MISMATCH" : !refs.length ? "OFFICIAL_REFERENCE_MISSING" : "CONTRACT_SPECIFIC_COMPONENT";
  return { ...item, semanticCategory: semanticCategoryFor(code, item.authority, first, reasonCode, refs), billValue, billOriginalUnit: billUnit, billQuantity: input.billedConsumptionKwh, billExposure: fact ? "SEPARATE" : "NOT_IDENTIFIED", officialValue: first?.normalizedValue ?? null, officialOriginalValue: first?.originalValue ?? null, officialOriginalUnit: first?.originalUnit ?? null, officialUnit: first?.normalizedUnit ?? null, sourceReference: first?.sourceReference ?? null, officialIdentifier: first?.officialIdentifier ?? null, effectivePeriod: first ? { from: first.effectiveFrom, to: first.effectiveTo } : null, ...outcomeFields(outcome), comparable: false, reason: !fact ? "BILL_LINE_NOT_IDENTIFIED" : code === "CAPACITY_MARKET" ? "CUSTOMER_FACING_REFERENCE_NOT_EQUIVALENT" : !refs.length ? "REFERENCE_MISSING" : "CUSTOMER_FACING_REFERENCE_MISSING", ...reasonFields(code, reasonCode) };
}

export function verifyRegulatedPassThrough(input: RegulatedPassThroughInput): RegulatedPassThroughVerification {
  const items: RegulatedPassThroughItem[] = [];
  const codes: readonly string[] = input.customerScope === "NON_DOMESTIC_BT_BTA6"
    ? [...CORE_CODES.filter((code) => code !== "UC6"), "UC6_FIXED", "UC6_POWER", "UC6_ENERGY"]
    : CORE_CODES;
  for (const code of codes) {
    const semanticScope = input.customerScope === "DOMESTIC_NON_RESIDENT_BT" || input.customerScope === "NON_DOMESTIC_BT_BTA6";
    const semanticLinesForScope = semanticScope ? componentLines(input.chargeLines, code) : [];
    const legacyLine = semanticScope ? null : lineFor(input.chargeLines, code === "NETWORK_POWER" ? ["NETWORK_POWER", "POWER_CHARGE"] : NETWORK_ALIASES[code]);
    const lines = semanticLinesForScope.length ? semanticLinesForScope : legacyLine ? [legacyLine] : [];
    const selectionLine = code === "ASOS"
      ? lines.find((candidate) => /energia|scaglione/i.test(candidate.description) && !/fissa|potenza/i.test(candidate.description)) ?? null
      : mergedLine(lines);
    const record = recordFor(input.regulatoryReferences, NETWORK_ALIASES[code], input.billingPeriod.from, input.customerScope, semanticLinesForScope.length ? recordUnitFor(code, semanticLinesForScope) : undefined, selectionLine);
    const selectedLines = semanticLinesForScope.length && record?.normalizedUnit === "EUR/KWH"
      ? lines.filter((candidate) => /energia|scaglione/i.test(candidate.description) && !/fissa|potenza/i.test(candidate.description))
      : semanticLinesForScope.length && record?.normalizedUnit === "EUR/KW/YEAR"
        ? lines.filter((candidate) => /potenza/i.test(candidate.description))
        : semanticLinesForScope.length && record?.normalizedUnit === "EUR/POD/YEAR"
          ? lines.filter((candidate) => /fissa/i.test(candidate.description))
          : lines;
    const line = mergedLine(selectedLines.length ? selectedLines : lines);
    const fact = null;
    const officialReferenceNotProjected = !record && input.customerScope === "NON_DOMESTIC_BT_BTA6" && ["ASOS", "ARIM"].includes(code) && input.regulatoryReferences.some((candidate) => candidate.componentCode === code && candidate.authority === "ARERA" && /227\/2026\/R\/com/i.test(candidate.officialIdentifier));
    const item = baseItem(code, "ARERA", ["ASOS", "ARIM", "UC3", "UC6", "UC6_FIXED", "UC6_POWER", "UC6_ENERGY"].includes(code) ? "SYSTEM_CHARGES" : "NETWORK", record, record ? [record] : [], [], officialReferenceNotProjected ? "OFFICIAL_REFERENCE_NOT_PROJECTED" : "OFFICIAL_REFERENCE_MISSING");
    items.push(withBill(item, line, fact, code, input, semanticLinesForScope.length > 0));
  }
  items.push(upstreamGroup("DISPATCHING", input), upstreamGroup("CAPACITY_MARKET", input));
  const differences = items.filter((item) => item.outcome === "SCOSTAMENTO");
  const overcharges = differences.filter((item) => (item.amountDifference ?? 0) > 0);
  const undercharges = differences.filter((item) => (item.amountDifference ?? 0) < 0);
  const confirmed = differences.reduce((sum, item) => sum + (item.amountDifference ?? 0), 0);
  const overchargeAmount = overcharges.reduce((sum, item) => sum + (item.amountDifference ?? 0), 0);
  const underchargeAmount = undercharges.reduce((sum, item) => sum + Math.abs(item.amountDifference ?? 0), 0);
  const overReferenceCount = items.filter((item) => item.status === "SUPERIORE_AL_RIFERIMENTO").length;
  const underReferenceCount = items.filter((item) => item.status === "INFERIORE_AL_RIFERIMENTO").length;
  const summary = {
    regulatedPassThroughCount: items.length,
    comparableCount: items.filter((item) => item.comparable).length,
    matchingCount: items.filter((item) => item.outcome === "COINCIDE").length,
    differentCount: items.filter((item) => item.outcome === "SCOSTAMENTO").length,
    overReferenceCount,
    underReferenceCount,
    aggregatedCount: items.filter((item) => item.outcome === "PRESENTE_AGGREGATO").length,
    nonComparableCount: items.filter((item) => item.outcome === "NON_CONFRONTABILE").length,
    notIdentifiedCount: items.filter((item) => item.outcome === "NON_IDENTIFICATO_IN_BOLLETTA").length,
    officialReferenceMissingCount: items.filter((item) => item.outcome === "RIFERIMENTO_UFFICIALE_NON_DISPONIBILE").length,
    confirmedDifferenceAmount: rounded(confirmed, 2),
    confirmedDifferenceCount: differences.length,
    confirmedOverchargeCount: overReferenceCount,
    confirmedUnderchargeCount: underReferenceCount,
    confirmedOverchargeAmount: rounded(overchargeAmount, 2),
    confirmedUnderchargeAmount: rounded(underchargeAmount, 2),
    netConfirmedDifferenceAmount: rounded(overchargeAmount - underchargeAmount, 2),
  };
  return { items, summary };
}
