import type { CteExtractionField, CteExtractionFieldStatus, CteIngestionRecord } from "./ingestion";
import type { CteCapacityMarketScheduleEntry, CteContract, CteDispatchingReference, CteEconomicDuration, CteExitFee, CteLossReference, CteLossSemantics, CtePassThroughComponent, CtePunResolutionRule, CteLossTreatment } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateCteContract } from "./validation.ts";

export type CteReviewValue = string | number | readonly string[] | readonly CtePassThroughComponent[] | CteEconomicDuration | CteLossSemantics | CteExitFee | null;

export interface CteReviewField {
  readonly fieldKey: string;
  readonly label: string;
  readonly normalizedValue: CteReviewValue;
  readonly required: boolean;
  readonly unit?: string;
  readonly periodicity?: string;
  readonly description?: string;
  readonly status: CteExtractionFieldStatus;
  readonly confidence: number;
  readonly sourcePage: number | null;
  readonly sourceText: string | null;
  readonly sourceTextComplete: string | null;
  readonly sourceRef?: number;
  readonly conditions?: readonly string[];
  readonly notes?: readonly string[];
}

export interface CteReviewSource {
  readonly sourceRef: number;
  readonly sourcePage: number | null;
  readonly sourceText: string;
  readonly sourceTextComplete: string;
}

export interface CteApprovalBlocker {
  readonly code: "REQUIRED_FIELD_MISSING" | "REQUIRED_FIELD_UNCERTAIN" | "CLASSIFICATION_UNCONFIRMED" | "AUTHORITATIVE_CONTRACT_MISSING" | "AUTHORITATIVE_CONTRACT_INVALID";
  readonly fieldKey?: string;
  readonly label: string;
  readonly required: true;
}

export interface CteApprovalGate {
  readonly approvalReady: boolean;
  readonly blockers: readonly CteApprovalBlocker[];
  readonly optionalNotFound: readonly string[];
}

export interface CteReviewModel {
  readonly currency: string | null;
  readonly commercialFields: readonly CteReviewField[];
  readonly notFoundFields: readonly CteReviewField[];
  readonly sources: readonly CteReviewSource[];
  readonly approvalGate: CteApprovalGate;
}

export interface CteAuthoritativeBuildResult {
  readonly contract: CteContract | null;
  readonly errorCode: string | null;
  readonly validationPaths: readonly string[];
}

const labels: Record<string, string> = {
  "supplier.name": "Fornitore",
  "supplier.supplierId": "Partita IVA fornitore",
  "offer.name": "Offerta",
  "offer.code": "Codice offerta",
  "validity.period": "Validit\u00E0",
  "expiry.date": "Scadenza dichiarata",
  "eligibility.customerTypes": "Tipo cliente",
  "eligibility.consumptionRange": "Fascia consumo",
  "eligibility.exclusions": "Esclusioni",
  "pricing.mode": "Modalit\u00E0 prezzo",
  "pricing.reference": "Indice",
  "pricing.spread.amount": "Spread",
  "pricing.fixedPrice.amount": "Prezzo fisso",
  "commercialTerms.fixedFees": "Quote fisse",
  "commercialTerms.variableFees": "Quote variabili",
  "commercialTerms.imbalance": "Sbilanciamento",
  "commercialTerms.oneOffFees": "Una tantum",
  "commercialTerms.commercialDiscounts": "Sconti commerciali",
  "commercialTerms.passThroughComponents": "Componenti contrattuali pass-through",
  "commercialTerms.economicDuration": "Durata condizioni economiche",
  "commercialTerms.lossSemantics": "Semantica perdite di rete",
  "commercialTerms.exitFee": "Oneri di recesso anticipato",
  "eligibility.voltageLevels": "Livelli tensione",
  taxTreatment: "Trattamento fiscale",
};

function text(field: CteExtractionField | undefined): string {
  const value = field && typeof field.value === "string" ? field.value : field?.sourceText;
  return value ? value.replace(/\s+/g, " ").trim() : "";
}
function evidence(field: CteExtractionField | undefined): string | null {
  const value = field?.sourceText ?? (typeof field?.value === "string" ? field.value : null);
  return value ? value.replace(/\s+/g, " ").trim().slice(0, 240) : null;
}
function completeEvidence(field: CteExtractionField | undefined): string | null {
  const value = field?.sourceText ?? (typeof field?.value === "string" ? field.value : null);
  return value ? value.replace(/\s+/g, " ").trim() : null;
}
function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (!match) return null;
  const day = Number(match[4] ?? match[3]);
  const month = Number(match[5] ?? match[2]);
  const year = Number(match[6] ?? match[1]);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}
function dates(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b/g)].map((match) => date(match[0])).filter((item): item is string => item !== null);
}
function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/[-+]?\d[\d.\s]*(?:,\d+)?/);
  if (!match) return null;
  const candidate = match[0].replace(/\s/g, "");
  const normalized = candidate.includes(",") ? candidate.replace(/\./g, "").replace(",", ".") : candidate;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
function italianNumber(value: number): string { return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value); }
function statusOf(fields: readonly (CteExtractionField | undefined)[]): CteExtractionFieldStatus {
  if (fields.some((field) => field?.status === "CORRECTED")) return "CORRECTED";
  if (fields.some((field) => field?.status === "UNCERTAIN")) return "UNCERTAIN";
  if (fields.every((field) => !field || field.status === "NOT_FOUND" || field.value === null)) return "NOT_FOUND";
  return "CONFIRMED";
}
function base(fieldKey: string, normalizedValue: CteReviewValue, field: CteExtractionField | undefined, extra: Partial<CteReviewField> = {}): CteReviewField {
  return { fieldKey, label: labels[fieldKey] ?? fieldKey, normalizedValue, required: false, status: field?.status ?? "NOT_FOUND", confidence: field?.confidence ?? 0, sourcePage: field?.sourcePage ?? null, sourceText: evidence(field), sourceTextComplete: completeEvidence(field), ...extra };
}
function fieldsByPath(fields: readonly CteExtractionField[]): Map<string, CteExtractionField> { return new Map(fields.map((field) => [field.path, field])); }
function concise(value: string): string | null {
  const result = value.replace(/^(?:fornitore|ragione sociale|offerta(?:\s+commerciale)?|nome offerta)\s*[:\-]?\s*/i, "").replace(/\s*(?:partita\s+iva|p\.?\s*iva|p\s+iva|vat)\s*[:#-]?\s*(?:IT\s*)?(?:\d[\s.-]*){8,20}\s*$/i, "").split(/[;\n]/, 1)[0].trim().replace(/\bS\.p\.A\.?/gi, "S.p.A.");
  return result || null;
}
function code(value: string): string | null {
  const labelled = value.match(/(?:codice|code)(?:\s+offerta)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  if (labelled) return labelled[1];
  const result = value.trim();
  return /^[A-Z0-9][A-Z0-9._/-]*$/i.test(result) ? result : null;
}
function currency(value: string): string | null {
  if (/\b(?:EUR|EURO)\b|\u20AC/i.test(value)) return "EUR";
  return concise(value);
}
function expectedIndex(vector: CteIngestionRecord["vector"]): "PUN" | "PSV" | null { return vector === "EE" ? "PUN" : vector === "GAS" ? "PSV" : null; }

function isoDate(value: string): string | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function reviewFieldMap(review: CteReviewModel): Map<string, CteReviewField> {
  return new Map([...review.commercialFields, ...review.notFoundFields].map((field) => [field.fieldKey, field]));
}

function feeUnit(value: string | undefined, vector: CteIngestionRecord["vector"], fallback: "EUR_PER_CONTRACT" | "EUR_PER_KWH" | "EUR_PER_SMC"): "EUR_PER_KWH" | "EUR_PER_SMC" | "EUR_PER_POD" | "EUR_PER_MONTH" | "EUR_PER_YEAR" | "EUR_PER_CONTRACT" | null {
  if (value && /\/\s*pod/i.test(value)) return "EUR_PER_POD";
  if (value === "€/kWh") return "EUR_PER_KWH";
  if (value === "€/Smc") return "EUR_PER_SMC";
  if (value === "€/mese") return "EUR_PER_MONTH";
  if (value === "€/anno") return "EUR_PER_YEAR";
  if (value === "€") return "EUR_PER_CONTRACT";
  if (value === undefined) return fallback;
  if (vector === "EE" && value === "€/kWh") return "EUR_PER_KWH";
  if (vector === "GAS" && value === "€/Smc") return "EUR_PER_SMC";
  return null;
}

function asString(field: CteReviewField | undefined): string | null {
  return field?.status !== "UNCERTAIN" && typeof field?.normalizedValue === "string" && field.normalizedValue.trim() ? field.normalizedValue.trim() : null;
}

function asNumber(field: CteReviewField | undefined): number | null {
  return field?.status !== "UNCERTAIN" && typeof field?.normalizedValue === "number" && Number.isFinite(field.normalizedValue) && field.normalizedValue >= 0 ? field.normalizedValue : null;
}

function asSemantic<T extends object>(field: CteReviewField | undefined): T | null {
  return field?.status !== "UNCERTAIN" && field?.normalizedValue !== null && typeof field?.normalizedValue === "object" && !Array.isArray(field.normalizedValue) ? field.normalizedValue as T : null;
}

function customerTypes(field: CteReviewField | undefined): readonly ("RESIDENTIAL" | "NON_RESIDENTIAL")[] | null {
  if (!field || field.status === "UNCERTAIN" || field.normalizedValue === null) return null;
  const values = Array.isArray(field.normalizedValue) ? field.normalizedValue : [field.normalizedValue];
  const result = values.flatMap((value) => {
    if (typeof value !== "string") return [];
    if (/non\s+domestic/i.test(value)) return ["NON_RESIDENTIAL" as const];
    if (/domestic/i.test(value)) return ["RESIDENTIAL" as const];
    return [];
  });
  return result.length ? [...new Set(result)] : null;
}

function voltageLevels(field: CteReviewField | undefined): readonly ("LV" | "MV" | "HV" | "EHV")[] | null {
  const value = asString(field);
  if (!value) return null;
  const levels: ("LV" | "MV" | "HV" | "EHV")[] = [];
  if (/\bBT\b|bassa\s+tensione/i.test(value)) levels.push("LV");
  if (/\bMT\b|media\s+tensione/i.test(value)) levels.push("MV");
  if (/\bHV\b|alta\s+tensione/i.test(value)) levels.push("HV");
  if (/\bEHV\b|altissima\s+tensione/i.test(value)) levels.push("EHV");
  return levels.length ? [...new Set(levels)] : null;
}

function taxTreatment(field: CteReviewField | undefined): "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE" | null {
  const value = asString(field);
  if (!value) return null;
  if (/iva\s+e\s+imposte\s+escluse|iva[^.;]*(?:esclus|non\s+inclus)|imposte[^.;]*(?:esclus|non\s+inclus)/i.test(value)) return "EXCLUDED";
  if (/iva\s+inclusa|iva[^.;]*(?:inclus|compres)/i.test(value)) return "INCLUDED";
  if (/non\s+applicabile|fuori\s+campo/i.test(value)) return "NOT_APPLICABLE";
  return null;
}

function fixedMonthlyEquivalent(field: CteReviewField | undefined): number | null {
  const raw = field?.sourceTextComplete ?? field?.sourceText ?? "";
  const match = raw.match(/([-+]?\d[\d.\s]*(?:,\d+)?)\s*(?:€|EUR|euro)\s*\/\s*(?:mese|month|mensil)/i);
  return match ? numeric(match[1]) : null;
}

function canonicalEligibilityScope(field: CteReviewField | undefined): {
  readonly allowedCustomerTypes?: readonly ("CONSUMER" | "BUSINESS" | "BOTH")[];
  readonly allowedSupplyUses?: readonly ("DOMESTIC" | "OTHER_USE" | "PUBLIC_LIGHTING" | "EV_CHARGING" | "OTHER")[];
  readonly allowedLegalForms?: readonly ("NATURAL_PERSON" | "LEGAL_PERSON" | "PROFESSIONAL" | "ENTERPRISE" | "PUBLIC_BODY" | "OTHER")[];
  readonly allowedIdentifierTypes?: readonly ("TAX_CODE" | "VAT" | "OTHER")[];
} {
  const evidence = `${sourceComplete(field)} ${asString(field) ?? ""}`.normalize("NFKC").toLocaleLowerCase("it-IT");
  if (!evidence.trim()) return {};
  const consumer = /persona\s+fisica|codice\s+fiscale|consumer|cliente\s+non\s+business|altri\s+usi\s+con\s+(?:cf|codice\s+fiscale)|persone\s+fisiche/.test(evidence);
  const business = /business|partita\s+iva|p\.?\s*iva|impresa|azienda|professionista|persona\s+giuridica/.test(evidence);
  const allowedCustomerTypes = consumer && business ? ["BOTH" as const] : consumer ? ["CONSUMER" as const] : business ? ["BUSINESS" as const] : undefined;
  const allowedSupplyUses = /altri\s+usi|altro\s+uso/.test(evidence) ? ["OTHER_USE" as const] : /domestic/.test(evidence) ? ["DOMESTIC" as const] : undefined;
  const allowedLegalForms = [
    ...(consumer && /persona\s+fisica/.test(evidence) ? ["NATURAL_PERSON" as const] : []),
    ...(business && /persona\s+giuridica|societ[aà]/.test(evidence) ? ["LEGAL_PERSON" as const] : []),
    ...(business && /professionista/.test(evidence) ? ["PROFESSIONAL" as const] : []),
    ...(business && /impresa|azienda/.test(evidence) ? ["ENTERPRISE" as const] : []),
  ];
  const allowedIdentifierTypes = [
    ...(consumer && /codice\s+fiscale|\bcf\b/.test(evidence) ? ["TAX_CODE" as const] : []),
    ...(business && /partita\s+iva|p\.?\s*iva/.test(evidence) ? ["VAT" as const] : []),
  ];
  return {
    ...(allowedCustomerTypes ? { allowedCustomerTypes } : {}),
    ...(allowedSupplyUses ? { allowedSupplyUses } : {}),
    ...(allowedLegalForms.length ? { allowedLegalForms } : {}),
    ...(allowedIdentifierTypes.length ? { allowedIdentifierTypes } : {}),
  };
}

function feeComponent(field: CteReviewField | undefined, feeId: string, vector: CteIngestionRecord["vector"], tax: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE", fallback: "EUR_PER_CONTRACT" | "EUR_PER_KWH" | "EUR_PER_SMC", label?: string, lossTreatment?: CteLossTreatment): CteContract["commercialTerms"]["fixedFees"][number] | null {
  const amount = asNumber(field);
  if (amount === null) return null;
  const unit = feeUnit(field?.unit, vector, fallback);
  if (!unit) return null;
  if (unit === "EUR_PER_POD") {
    const raw = field?.sourceTextComplete ?? field?.sourceText ?? "";
    if (field?.periodicity !== "anno" || !/\/\s*pod\s*\/??\s*(?:anno|year|annual)/i.test(raw) || /\/\s*pod\s*\/??\s*(?:mese|month|mensil)/i.test(raw)) return null;
    const monthlyEquivalent = fixedMonthlyEquivalent(field);
    if (monthlyEquivalent !== null && Math.abs(monthlyEquivalent - amount / 12) > 0.000001) return null;
    return { feeId, label: label ?? field?.label ?? feeId, amount, currency: "EUR", unit, period: "YEAR", monthlyEquivalent: amount / 12, taxTreatment: tax, ...(lossTreatment === undefined ? {} : { lossTreatment }) };
  }
  return { feeId, label: label ?? field?.label ?? feeId, amount, currency: "EUR", unit, taxTreatment: tax, ...(lossTreatment === undefined ? {} : { lossTreatment }) };
}

function passThroughComponents(field: CteExtractionField | CteReviewField | undefined): readonly CtePassThroughComponent[] | null {
  if (!field || field.status === "NOT_FOUND" || field.status === "UNCERTAIN") return null;
  const value = "normalizedValue" in field ? field.normalizedValue : field.value;
  return Array.isArray(value) ? value as readonly CtePassThroughComponent[] : null;
}

function sourceComplete(field: CteExtractionField | CteReviewField | undefined): string {
  if (!field) return "";
  if ("sourceTextComplete" in field && typeof field.sourceTextComplete === "string") return field.sourceTextComplete;
  return typeof field.sourceText === "string" ? field.sourceText : "";
}

function commercialCustomerScopes(field: CteReviewField | undefined): readonly ("DOMESTIC_BT" | "DOMESTIC_RESIDENT_BT" | "DOMESTIC_NON_RESIDENT_BT" | "NON_DOMESTIC_BT" | "NON_DOMESTIC_OTHER_USE" | "NON_DOMESTIC_BT_BTA6" | "ALL_ELECTRICITY" | "DOMESTIC_GAS" | "NON_DOMESTIC_GAS" | "ALL_GAS")[] | null {
  const value = asString(field);
  if (!value) return null;
  if (/non\s+domestic/i.test(value) && /altri\s+usi\s+business/i.test(value)) return ["NON_DOMESTIC_OTHER_USE"];
  return null;
}

function annualConsumptionRule(field: CteReviewField | undefined, vector: CteIngestionRecord["vector"]): { readonly operator: ">"; readonly value: number; readonly unit: "KWH_PER_YEAR" | "SMC_PER_YEAR"; readonly sourceEvidence: string } | null {
  const evidence = `${sourceComplete(field)} ${typeof field?.normalizedValue === "string" ? field.normalizedValue : ""}`.trim();
  const match = evidence.match(/(?:superiore|maggiore)\s+a\s+([\d.]+)|>\s*([\d.]+)/i);
  const rawValue = match?.[1] ?? match?.[2] ?? "";
  const value = rawValue && !rawValue.includes(",") && /^\d{1,3}(?:\.\d{3})+$/.test(rawValue) ? Number(rawValue.replace(/\./g, "")) : numeric(rawValue);
  if (value === null) return null;
  if (vector === "EE" && !/kwh\s*\/(?:anno|a)|kwh\s+annui/i.test(evidence)) return null;
  if (vector === "GAS" && !/smc\s*\/(?:anno|a)|smc\s+annui/i.test(evidence)) return null;
  return { operator: ">", value, unit: vector === "EE" ? "KWH_PER_YEAR" : "SMC_PER_YEAR", sourceEvidence: evidence };
}

function feeAmountFromText(value: string, expression: RegExp): number | null {
  const match = value.match(expression);
  return match?.[1] ? numeric(match[1]) : null;
}

function officialReference(authority: "ARERA" | "TERNA" | "ARERA_TERNA", document: string, sourceEvidence: string, extra: { readonly table?: string; readonly column?: string; readonly article?: string } = {}): { readonly authority: "ARERA" | "TERNA" | "ARERA_TERNA"; readonly document: string; readonly sourceEvidence: string; readonly table?: string; readonly column?: string; readonly article?: string } {
  return { authority, document, sourceEvidence, ...extra };
}

function punRule(pricingReference: CteReviewField | undefined, pricingMode: CteReviewField | undefined, validityStart: string, validityEnd: string): CtePunResolutionRule | null {
  const evidence = `${sourceComplete(pricingMode)} ${sourceComplete(pricingReference)} ${asString(pricingReference) ?? ""}`.trim();
  if (!/\bPUN\b/i.test(evidence) || !/media\s+aritmetica/i.test(evidence) || !/\bF1\b[\s\S]*\bF2\b[\s\S]*\bF3\b/i.test(evidence)) return null;
  return { index: "PUN", resolution: "MONTHLY_ARITHMETIC_MEAN", periodBasis: "CALENDAR_MONTH", timeBands: ["F1", "F2", "F3"], application: "PER_TIME_BAND", spreadApplication: "ADD_TO_INDEXED_UNIT_PRICE", effectiveFrom: validityStart, effectiveTo: validityEnd, sourceEvidence: evidence };
}

function capacitySchedule(source: string, validityStart: string, validityEnd: string): readonly CteCapacityMarketScheduleEntry[] {
  const entries: CteCapacityMarketScheduleEntry[] = [];
  const add = (value: number | null, timeClass: CteCapacityMarketScheduleEntry["timeClass"], voltageScope: CteCapacityMarketScheduleEntry["voltageScope"], lossTreatment: CteCapacityMarketScheduleEntry["lossTreatment"], evidence: string) => {
    if (value === null) return;
    entries.push({ voltageScope, timeClass, value, unit: "EUR_PER_KWH", mode: "OFFICIAL_PASS_THROUGH", effectiveFrom: validityStart, effectiveTo: validityEnd, lossTreatment, officialReference: officialReference("ARERA", "TIV", evidence, { article: "comma 34.8 bis" }), sourceEvidence: evidence });
  };
  const bt = source.match(/corrispettivo\s+mercato\s+capacit[\s\S]{0,220}?pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€)\s*\/\s*kWh\s+in\s+bassa\s+tensione/i);
  const peak = source.match(/pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€)\s*\/\s*kWh\s+nelle\s+ore\s+di\s+picco/i);
  const mt = source.match(/pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€)\s*\/\s*kWh\s+per\s+i\s+clienti\s+in\s+media\s+tensione/i);
  const free = source.match(/Capacity\s+Market\s+libero\s+pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€)\s*\/\s*kWh/i);
  add(bt?.[1] ? numeric(bt[1]) : null, "ALL", "LV", "NOT_DECLARED", bt?.[0] ?? "");
  add(peak?.[1] ? numeric(peak[1]) : null, "PEAK", undefined, "NOT_DECLARED", peak?.[0] ?? "");
  add(mt?.[1] ? numeric(mt[1]) : null, "ALL", "MV", "NOT_DECLARED", mt?.[0] ?? "");
  if (free?.[1]) {
    const value = numeric(free[1]);
    if (value !== null) entries.push({ timeClass: "CAPACITY_MARKET_LIBERO", value, unit: "EUR_PER_KWH", mode: "FIXED_VALUE", effectiveFrom: validityStart, effectiveTo: validityEnd, lossTreatment: "GROSS_OF_LOSSES", sourceEvidence: free[0] });
  }
  return entries;
}

function dispatchingReference(source: string, validityStart: string, validityEnd: string): CteDispatchingReference | null {
  if (!/dispacciamento/i.test(source) || !/Art\.\s*24\s+del\s*TIS/i.test(source)) return null;
  const snapshotValue = feeAmountFromText(source, /dispacciamento[\s\S]{0,500}?pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€)\s*\/\s*kWh/i);
  return { mode: "OFFICIAL_PASS_THROUGH", reference: officialReference("ARERA_TERNA", "TIS", source, { article: "Art. 24" }), formula: "Corrispettivo Art. 24 TIS risolto dal riferimento ufficiale applicabile al periodo, con fattore perdite Tabella 4 colonna A TIS", lossTreatment: "OFFICIAL_REFERENCE", ...(snapshotValue === null ? {} : { snapshotValue, snapshotUnit: "EUR_PER_KWH" as const }), effectiveFrom: validityStart, effectiveTo: validityEnd, sourceEvidence: source };
}

function lossReference(source: string): CteLossReference | null {
  if (!/Tabella\s+4\s+colonna\s+A\s+TIS/i.test(source)) return null;
  return { lossMode: "OFFICIAL_REFERENCE", reference: officialReference("ARERA_TERNA", "TIS", source, { table: "Tabella 4", column: "A" }), applicationTargets: ["DISPATCHING"], sourceEvidence: source };
}

function authoritativeFailure(errorCode: string, validationPaths: readonly string[]): CteAuthoritativeBuildResult {
  return { contract: null, errorCode, validationPaths };
}

export function tryBuildAuthoritativeCteContract(record: Pick<CteIngestionRecord, "ingestionId" | "documentId" | "fields" | "vector" | "documentType"> & { readonly tenantId: string }): CteAuthoritativeBuildResult {
  if (record.documentType !== "CTE" || (record.vector !== "EE" && record.vector !== "GAS")) return authoritativeFailure("CTE_AUTHORITATIVE_CLASSIFICATION_INVALID", ["documentType", "vector"]);
  const review = normalizeCteReview(record);
  if (review.approvalGate.blockers.length) {
    const paths = review.approvalGate.blockers.map((blocker) => blocker.fieldKey).filter((path): path is string => typeof path === "string");
    const uncertain = review.approvalGate.blockers.some((blocker) => blocker.code === "REQUIRED_FIELD_UNCERTAIN");
    return authoritativeFailure(uncertain ? "CTE_AUTHORITATIVE_FIELD_UNCERTAIN" : "CTE_AUTHORITATIVE_FIELD_MISSING", paths);
  }
  const fields = reviewFieldMap(review);
  const supplierName = asString(fields.get("supplier.name"));
  const supplierId = asString(fields.get("supplier.supplierId"));
  const offerName = asString(fields.get("offer.name"));
  const offerCode = asString(fields.get("offer.code"));
  const validity = asString(fields.get("validity.period"));
  const validityDates = validity ? dates(validity).map(isoDate).filter((value): value is string => value !== null) : [];
  const tax = taxTreatment(fields.get("taxTreatment"));
  const customer = customerTypes(fields.get("eligibility.customerTypes"));
  const customerScopes = commercialCustomerScopes(fields.get("eligibility.customerTypes"));
  const canonicalScope = canonicalEligibilityScope(fields.get("eligibility.customerTypes"));
  const annualRule = annualConsumptionRule(fields.get("eligibility.consumptionRange") ?? fields.get("eligibility.customerTypes"), record.vector);
  const voltage = record.vector === "EE" ? voltageLevels(fields.get("eligibility.voltageLevels")) : [];
  const mode = asString(fields.get("pricing.mode"));
  const reference = asString(fields.get("pricing.reference"));
  const spread = asNumber(fields.get("pricing.spread.amount"));
  const fixedPrice = asNumber(fields.get("pricing.fixedPrice.amount"));
  const expectedUnit = record.vector === "EE" ? "EUR_PER_KWH" : "EUR_PER_SMC";
  const fixedPricing = mode === "Fissa" || mode === "FIXED";
  const passThroughField = fields.get("commercialTerms.passThroughComponents");
  const typedPassThroughComponents = passThroughComponents(passThroughField);
  const requiredPaths: string[] = [];
  if (!supplierName) requiredPaths.push("supplier.name");
  if (!supplierId) requiredPaths.push("supplier.supplierId");
  if (!offerName) requiredPaths.push("offer.name");
  if (!offerCode) requiredPaths.push("offer.code");
  if (validityDates.length < 2) requiredPaths.push("validity.periodStart", "validity.periodEnd");
  if (!tax) requiredPaths.push("taxTreatment");
  if (!customer) requiredPaths.push("eligibility.customerTypes");
  if (record.vector === "EE" && !voltage?.length) requiredPaths.push("eligibility.voltageLevels");
  if (mode !== "Indicizzata" && mode !== "INDEXED" && mode !== "Fissa" && mode !== "FIXED") requiredPaths.push("pricing.mode");
  if (fixedPricing) {
    if (fixedPrice === null) requiredPaths.push("pricing.fixedPrice.amount");
  } else {
    if (!reference || reference !== expectedIndex(record.vector)) requiredPaths.push("pricing.reference");
    if (spread === null) requiredPaths.push("pricing.spread.amount");
  }
  if (requiredPaths.length) return authoritativeFailure("CTE_AUTHORITATIVE_FIELD_MISSING", requiredPaths);
  if (!tax || !customer || !voltage || !supplierName || !supplierId || !offerName || !offerCode || validityDates.length < 2 || (!fixedPricing && spread === null) || (fixedPricing && fixedPrice === null)) return authoritativeFailure("CTE_AUTHORITATIVE_MAPPING_INVALID", ["contract"]);
  const fixed = feeComponent(fields.get("commercialTerms.fixedFees"), `${record.ingestionId}-fixed`, record.vector, tax, "EUR_PER_CONTRACT");
  const variable = feeComponent(fields.get("commercialTerms.variableFees"), `${record.ingestionId}-variable`, record.vector, tax, expectedUnit, undefined, "NET_OF_LOSSES");
  const imbalance = feeComponent(fields.get("commercialTerms.imbalance"), `${record.ingestionId}-imbalance`, record.vector, tax, expectedUnit, undefined, "NET_OF_LOSSES");
  const oneOff = feeComponent(fields.get("commercialTerms.oneOffFees"), `${record.ingestionId}-one-off`, record.vector, tax, "EUR_PER_CONTRACT", fields.get("commercialTerms.oneOffFees")?.description);
  const economicDuration = asSemantic<CteEconomicDuration>(fields.get("commercialTerms.economicDuration"));
  const lossSemantics = asSemantic<CteLossSemantics>(fields.get("commercialTerms.lossSemantics"));
  const exitFee = asSemantic<CteExitFee>(fields.get("commercialTerms.exitFee"));
  const discountsField = fields.get("commercialTerms.commercialDiscounts");
  const discounts = discountsField && discountsField.status !== "NOT_FOUND" && discountsField.normalizedValue !== null
    ? feeComponent(discountsField, `${record.ingestionId}-discount`, record.vector, tax, expectedUnit)
    : null;
  if ((fields.get("commercialTerms.fixedFees")?.normalizedValue !== null && !fixed) || (fields.get("commercialTerms.variableFees")?.normalizedValue !== null && !variable) || (fields.get("commercialTerms.imbalance")?.normalizedValue !== null && !imbalance) || (fields.get("commercialTerms.oneOffFees")?.normalizedValue !== null && !oneOff) || (discountsField && discountsField.normalizedValue !== null && !discounts) || (fields.get("commercialTerms.economicDuration")?.normalizedValue !== null && !economicDuration) || (fields.get("commercialTerms.lossSemantics")?.normalizedValue !== null && !lossSemantics) || (fields.get("commercialTerms.exitFee")?.normalizedValue !== null && !exitFee)) return authoritativeFailure("CTE_AUTHORITATIVE_MAPPING_INVALID", ["commercialTerms"]);
  const pricing = !fixedPricing
    ? { mode: "INDEXED" as const, reference: expectedIndex(record.vector) as "PUN" | "PSV", spread: { amount: spread as number, currency: "EUR" as const, unit: expectedUnit, taxTreatment: tax } }
    : fixedPricing
      ? { mode: "FIXED" as const, reference: "NONE" as const, fixedPrice: { amount: fixedPrice as number, currency: "EUR" as const, unit: expectedUnit, taxTreatment: tax }, spread: { status: "NOT_DECLARED" as const, reason: "NOT_APPLICABLE" as const } }
      : null;
  if (!pricing) return authoritativeFailure("CTE_AUTHORITATIVE_PRICING_UNSUPPORTED", ["pricing.mode", "pricing.fixedPrice.amount"]);
  const expiryRaw = record.fields.find((field) => field.path === "expiry.date");
  if (expiryRaw?.status === "UNCERTAIN") return authoritativeFailure("CTE_AUTHORITATIVE_FIELD_UNCERTAIN", ["expiry.date"]);
  const expiryDate = expiryRaw && expiryRaw.status !== "NOT_FOUND" && expiryRaw.value !== null
    ? isoDate(date(expiryRaw.value) ?? (typeof expiryRaw.sourceText === "string" ? date(expiryRaw.sourceText) : null) ?? "")
    : null;
  if (expiryRaw && expiryRaw.status !== "NOT_FOUND" && expiryRaw.value !== null && !expiryDate) return authoritativeFailure("CTE_AUTHORITATIVE_MAPPING_INVALID", ["expiry.date"]);
  const passThroughSource = sourceComplete(passThroughField);
  const punResolutionRule = record.vector === "EE" ? punRule(fields.get("pricing.reference"), fields.get("pricing.mode"), validityDates[0], validityDates[1]) : null;
  const capacityMarketSchedule = record.vector === "EE" ? capacitySchedule(passThroughSource, validityDates[0], validityDates[1]) : [];
  const dispatching = record.vector === "EE" ? dispatchingReference(passThroughSource, validityDates[0], validityDates[1]) : null;
  const lossEvidence = `${passThroughSource} ${lossSemantics?.rawText ?? ""} ${lossSemantics?.provenance ?? ""}`.trim();
  const losses = record.vector === "EE" ? lossReference(lossEvidence) : null;
  const structuredCustomerScope = record.vector === "EE" ? customerScopes : null;
  const structuredCapacitySchedule = capacityMarketSchedule.length ? capacityMarketSchedule : undefined;
  const contract = {
    schemaVersion: 1 as const,
    recordId: record.ingestionId,
    version: "1",
    parentVersionId: null,
    tenantId: record.tenantId,
    approval: { status: "NEEDS_REVIEW" as const, reason: "READY_FOR_APPROVAL" },
    recordType: "CTE" as const,
    cteId: record.documentId,
    vector: record.vector,
    supplier: { supplierId, name: supplierName },
    offer: { offerId: offerCode, name: offerName, code: offerCode },
    validity: { periodStart: validityDates[0], periodEnd: validityDates[1] },
    expiry: expiryDate ? { status: "EXPIRES_ON" as const, date: expiryDate } : { status: "NO_EXPIRY_DECLARED" as const, reason: "NOT_PROVIDED" as const },
    currency: "EUR" as const,
    taxTreatment: tax,
    eligibility: record.vector === "EE" ? { customerTypes: customer, ...(structuredCustomerScope ? { customerScopes: structuredCustomerScope } : {}), ...canonicalScope, ...(annualRule ? { annualConsumptionRule: annualRule } : {}), voltageLevels: voltage } : { customerTypes: customer, ...canonicalScope, ...(annualRule ? { annualConsumptionRule: annualRule } : {}) },
    pricing,
    commercialTerms: { fixedFees: fixed ? [fixed] : [], variableFees: variable ? [variable] : [], imbalance: imbalance ? { status: "DECLARED" as const, component: imbalance } : { status: "NOT_DECLARED" as const, reason: "NOT_PROVIDED" as const }, oneOffFees: exitFee ? [] : oneOff ? [oneOff] : [], commercialDiscounts: discounts ? [discounts] : [], ...(typedPassThroughComponents === null ? {} : { passThroughComponents: typedPassThroughComponents }), ...(economicDuration ? { economicDuration } : {}), ...(lossSemantics ? { lossSemantics } : {}), ...(exitFee ? { exitFee } : {}), ...(punResolutionRule ? { punRule: punResolutionRule } : {}), ...(structuredCapacitySchedule ? { capacityMarketSchedule: structuredCapacitySchedule } : {}), ...(dispatching ? { dispatchingReference: dispatching } : {}), ...(losses ? { lossReference: losses } : {}) },
  } as CteContract;
  try { validateCteContract(contract); } catch { return authoritativeFailure("CTE_AUTHORITATIVE_SCHEMA_INVALID", ["contract"]); }
  return { contract, errorCode: null, validationPaths: [] };
}

export function buildAuthoritativeCteContract(record: Pick<CteIngestionRecord, "ingestionId" | "documentId" | "fields" | "vector" | "documentType"> & { readonly tenantId: string }): CteContract {
  const result = tryBuildAuthoritativeCteContract(record);
  if (!result.contract) throw new Error(result.errorCode ?? "CTE_AUTHORITATIVE_SCHEMA_INVALID");
  return result.contract;
}
function normalizeExclusion(value: string): string {
  const clean = value.trim().replace(/[.]+$/, "").replace(/\s+/g, " ").toLowerCase();
  if (/^pubblica\s+illuminazione$/.test(clean)) return "Pubblica illuminazione";
  if (/^pubblica\s+amministrazione$/.test(clean)) return "Pubblica Amministrazione";
  if (/^enti\s+pubblici$/.test(clean)) return "Enti pubblici";
  return clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
}
function money(field: CteExtractionField | undefined, vector: CteIngestionRecord["vector"], defaultUnit: string): CteReviewField {
  const raw = text(field);
  const value = numeric(field?.value) ?? numeric(field?.sourceText);
  const unit = /\/\s*pod/i.test(raw) ? "\u20AC/POD" : /\/\s*(?:kwh|kWh)/.test(raw) ? "\u20AC/kWh" : /\/\s*(?:smc|Smc)/.test(raw) ? "\u20AC/Smc" : /\/\s*(?:mese|month|mensil)/i.test(raw) ? "\u20AC/mese" : defaultUnit;
  const periodicity = /annuo|anno/i.test(raw) ? "anno" : /mese|mensil/i.test(raw) ? "mese" : undefined;
  const conditions = [...raw.matchAll(/(?:al netto|incluse?|escluse?|secondo)[^.;]*/gi)].map((match) => match[0].trim()).filter(Boolean);
  return base(field?.path ?? "", value, field, { unit, periodicity, conditions: conditions.length ? conditions : undefined });
}
function customerFields(field: CteExtractionField | undefined): readonly CteReviewField[] {
  const raw = text(field);
  const result: CteReviewField[] = [];
  let customer = concise(raw);
  if (/non\s+domestic[oi]/i.test(raw) && /altri\s+usi/i.test(raw)) customer = /business/i.test(raw) ? "Non domestico \u2013 Altri usi Business" : "Non domestico \u2013 Altri usi";
  else if (customer) customer = customer.split(/[,;.]/, 1)[0].trim();
  result.push(base("eligibility.customerTypes", customer, field));
  const range = raw.match(/(?:oltre|tra|da)\s+([\d.,]+)\s*(?:kwh(?:\/anno)?\s*)?(?:e|-)\s*fino\s+a\s+([\d.,]+)\s*kwh(?:\/anno)?/i) ?? raw.match(/([\d.,]+)\s*kwh[^.]*?fino\s+a\s+([\d.,]+)\s*kwh/i);
  if (range) result.push(base("eligibility.consumptionRange", `Oltre ${range[1]} e fino a ${range[2]} kWh/anno`, field));
  const lowerBound = !range && raw.match(/(?:superiore|maggiore)\s+a\s+([\d.,]+)\s*kwh(?:\/anno|\/a)?/i);
  if (lowerBound) result.push(base("eligibility.consumptionRange", `> ${lowerBound[1]} kWh/anno`, field));
  const excluded = raw.match(/esclus\w*\s*(?::|-)?\s*(.+)$/i);
  if (excluded) result.push(base("eligibility.exclusions", excluded[1].split(/[,;]|\s+(?:e|ed)\s+/i).map(normalizeExclusion).filter(Boolean), field));
  return result;
}
function voltage(field: CteExtractionField | undefined): CteReviewField {
  const raw = text(field);
  const low = /bassa\s+(?:(?:e|o)\s+media\s+)?tensione|\bBT\b/i.test(raw);
  const medium = /media\s+tensione|\bMT\b/i.test(raw);
  return base("eligibility.voltageLevels", low && medium ? "BT / MT" : low ? "BT" : medium ? "MT" : concise(raw), field);
}
function tax(field: CteExtractionField | undefined): CteReviewField {
  const raw = text(field);
  const normalized = /(?:iva[^.;]*(?:esclus|non inclus)|imposte[^.;]*(?:esclus|non inclus)|al netto[^.;]*(?:iva|imposte))/i.test(raw) ? "IVA e imposte escluse" : /iva[^.;]*(?:inclus|compres)/i.test(raw) ? "IVA inclusa" : concise(raw);
  return base("taxTreatment", normalized, field);
}
function supplierVat(field: CteExtractionField | undefined, fallback: CteExtractionField | undefined): { readonly value: string | null; readonly source: CteExtractionField | undefined } {
  const candidates = [field, fallback].filter((item): item is CteExtractionField => item !== undefined);
  for (const candidate of candidates) {
    const evidenceValues = [typeof candidate.value === "string" ? candidate.value : null, candidate.sourceText].filter((item): item is string => item !== null);
    for (const evidenceValue of evidenceValues) {
      const match = evidenceValue.match(/(?:partita\s+iva|p\.?\s*iva|p\s+iva|vat)\s*[:#-]?\s*(?:IT\s*)?((?:\d[\s.-]*){11})(?!\s*\d)/i);
      const digits = match?.[1]?.replace(/\D/g, "") ?? "";
      if (digits.length === 11) return { value: digits, source: candidate };
    }
  }
  return { value: null, source: field ?? fallback };
}
function oneOffDescription(raw: string): string | undefined {
  const description = raw
    .replace(/^\s*(?:valore\s+)?una\s+tantum\s*[:#-]?\s*/i, "")
    .replace(/^[-+]?\d[\d.\s]*(?:,\d+)?\s*(?:\u20AC|euro)?\s*(?:\u2014|\u2013|-)?\s*/i, "")
    .replace(/^[\s\u00C2\u00E2\u00C3\u00A0\u00AC\u201A\u2019\u201D\u20AC\u2013\u2014-]+/u, "")
    .replace(/\s+(?:di\s+)?(?:\u20AC|euro)\s*$/i, "")
    .trim();
  if (!description) return undefined;
  const words = description.match(/(?:^|\s)([A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]{3,}(?:\s+[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]+)*)$/)?.[1] ?? description;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function reviewField(fieldKey: string, field: CteExtractionField | undefined, vector: CteIngestionRecord["vector"], evidenceField?: CteExtractionField): CteReviewField | null {
  if (fieldKey === "supplier.supplierId") { const extracted = supplierVat(field, evidenceField); return base(fieldKey, extracted.value, extracted.source, { status: extracted.value ? extracted.source?.status ?? "CONFIRMED" : "NOT_FOUND" }); }
  if (fieldKey === "supplier.name" || fieldKey === "offer.name") return base(fieldKey, concise(text(field)), field);
  if (fieldKey === "offer.code") return base(fieldKey, code(text(field)), field);
  if (fieldKey === "pricing.mode") { const raw = text(field); return base(fieldKey, /indicizz|variabil.*pun|pun.*variabil/i.test(raw) ? "Indicizzata" : /fiss[oa]|prezzo fisso/i.test(raw) ? "Fissa" : concise(raw), field); }
  if (fieldKey === "pricing.reference") { const expected = expectedIndex(vector); const raw = text(field); return base(fieldKey, expected && new RegExp("\\b" + expected + "\\b", "i").test(raw) ? expected : null, field); }
  if (fieldKey === "pricing.spread.amount") return money(field, vector, vector === "GAS" ? "\u20AC/Smc" : "\u20AC/kWh");
  if (fieldKey === "pricing.fixedPrice.amount") return money(field, vector, vector === "GAS" ? "\u20AC/Smc" : "\u20AC/kWh");
  if (fieldKey === "commercialTerms.fixedFees") return money(field, vector, "\u20AC");
  if (fieldKey === "commercialTerms.variableFees" || fieldKey === "commercialTerms.imbalance") return money(field, vector, vector === "GAS" ? "\u20AC/Smc" : "\u20AC/kWh");
  if (fieldKey === "commercialTerms.commercialDiscounts") return base(fieldKey, concise(text(field)), field);
  if (fieldKey === "commercialTerms.oneOffFees") { const result = money(field, vector, "\u20AC"); const description = oneOffDescription(text(field)); return description ? { ...result, description } : result; }
  if (fieldKey === "commercialTerms.passThroughComponents") return base(fieldKey, Array.isArray(field?.value) ? field.value as readonly CtePassThroughComponent[] : null, field);
  if (fieldKey === "commercialTerms.economicDuration" || fieldKey === "commercialTerms.lossSemantics" || fieldKey === "commercialTerms.exitFee") return base(fieldKey, field?.value && typeof field.value === "object" && !Array.isArray(field.value) ? field.value as CteEconomicDuration | CteLossSemantics | CteExitFee : null, field);
  return null;
}

function attachSources(fields: readonly CteReviewField[]): { readonly fields: readonly CteReviewField[]; readonly sources: readonly CteReviewSource[] } {
  const sourceRefs = new Map<string, number>();
  const sources: CteReviewSource[] = [];
  const sourcedFields = fields.map((field) => {
    const sourceTextComplete = field.sourceTextComplete ?? field.sourceText;
    if (!sourceTextComplete) return field;
    const key = sourceTextComplete.trim();
    if (!key) return field;
    let sourceRef = sourceRefs.get(key);
    if (!sourceRef) {
      sourceRef = sources.length + 1;
      sourceRefs.set(key, sourceRef);
      sources.push({ sourceRef, sourcePage: field.sourcePage, sourceText: field.sourceText ?? key.slice(0, 240), sourceTextComplete: key });
    }
    return { ...field, sourceRef };
  });
  return { fields: sourcedFields, sources };
}

export function normalizeCteReview(record: Pick<CteIngestionRecord, "fields" | "vector">): CteReviewModel {
  const byPath = fieldsByPath(record.fields);
  const validityStart = byPath.get("validity.periodStart");
  const validityEnd = byPath.get("validity.periodEnd");
  const validityDates = [...dates(validityStart?.value), ...dates(validityEnd?.value)];
    const validity = base("validity.period", validityDates.length >= 2 ? `${validityDates[0]} \u2013 ${validityDates[1]}` : null, validityStart ?? validityEnd, { required: true, status: statusOf([validityStart, validityEnd]), sourcePage: validityStart?.sourcePage ?? validityEnd?.sourcePage ?? null, sourceText: evidence(validityStart) ?? evidence(validityEnd), sourceTextComplete: completeEvidence(validityStart) ?? completeEvidence(validityEnd) });
  const review: CteReviewField[] = [
    reviewField("supplier.name", byPath.get("supplier.name"), record.vector),
    reviewField("supplier.supplierId", byPath.get("supplier.supplierId"), record.vector, byPath.get("supplier.name")),
    reviewField("offer.name", byPath.get("offer.name"), record.vector),
    reviewField("offer.code", byPath.get("offer.code"), record.vector),
    validity,
    ...customerFields(byPath.get("eligibility.customerTypes")),
    reviewField("pricing.mode", byPath.get("pricing.mode"), record.vector),
    reviewField("pricing.reference", byPath.get("pricing.reference"), record.vector),
    reviewField("pricing.spread.amount", byPath.get("pricing.spread.amount"), record.vector),
    reviewField("pricing.fixedPrice.amount", byPath.get("pricing.fixedPrice.amount"), record.vector),
    reviewField("commercialTerms.fixedFees", byPath.get("commercialTerms.fixedFees"), record.vector),
    reviewField("commercialTerms.variableFees", byPath.get("commercialTerms.variableFees"), record.vector),
    reviewField("commercialTerms.imbalance", byPath.get("commercialTerms.imbalance"), record.vector),
    reviewField("commercialTerms.oneOffFees", byPath.get("commercialTerms.oneOffFees"), record.vector),
    reviewField("commercialTerms.commercialDiscounts", byPath.get("commercialTerms.commercialDiscounts"), record.vector),
    reviewField("commercialTerms.passThroughComponents", byPath.get("commercialTerms.passThroughComponents"), record.vector),
    reviewField("commercialTerms.economicDuration", byPath.get("commercialTerms.economicDuration"), record.vector),
    reviewField("commercialTerms.lossSemantics", byPath.get("commercialTerms.lossSemantics"), record.vector),
    reviewField("commercialTerms.exitFee", byPath.get("commercialTerms.exitFee"), record.vector),
    voltage(byPath.get("eligibility.voltageLevels")),
    tax(byPath.get("taxTreatment")),
  ].filter((field): field is CteReviewField => field !== null);
  const expiry = byPath.get("expiry.date");
  const expiryDate = date(expiry?.value);
  if (expiryDate && expiryDate !== dates(validityEnd?.value)[0]) review.push(base("expiry.date", expiryDate, expiry));
  const sourced = attachSources(review);
  const reviewFields = sourced.fields;
  const currencyField = byPath.get("currency");
  const pricingMode = reviewFields.find((field) => field.fieldKey === "pricing.mode")?.normalizedValue;
  const fixedPricing = pricingMode === "Fissa" || (record.vector === "EE" && pricingMode === "FIXED");
  const indexedPricing = pricingMode === "Indicizzata" || pricingMode === "INDEXED";
  const requiredPricingPaths = fixedPricing ? ["pricing.fixedPrice.amount"] : indexedPricing ? ["pricing.reference", "pricing.spread.amount"] : [];
  const requiredPaths = new Set(["supplier.name", "supplier.supplierId", "offer.name", "offer.code", "validity.periodStart", "validity.periodEnd", "eligibility.customerTypes", "pricing.mode", ...requiredPricingPaths, "taxTreatment", ...(record.vector === "EE" ? ["eligibility.voltageLevels"] : [])]);
  const requiredLabels: Record<string, string> = { "supplier.name": "Fornitore", "supplier.supplierId": "Partita IVA fornitore", "offer.name": "Offerta", "offer.code": "Codice offerta", "validity.periodStart": "Validit\u00E0 iniziale", "validity.periodEnd": "Validit\u00E0 finale", "eligibility.customerTypes": "Tipo cliente", "eligibility.voltageLevels": "Livelli tensione", "pricing.mode": "Modalit\u00E0 prezzo", "pricing.reference": "Indice", "pricing.spread.amount": "Spread", "pricing.fixedPrice.amount": "Prezzo fisso", taxTreatment: "Trattamento fiscale" };
  const reviewByKey = new Map(reviewFields.map((field) => [field.fieldKey, field]));
  const sourceByKey = byPath;
  const blockers: CteApprovalBlocker[] = [];
  if (record.vector !== "EE" && record.vector !== "GAS") blockers.push({ code: "CLASSIFICATION_UNCONFIRMED", label: "Classificazione del vettore non confermata", required: true });
  for (const path of requiredPaths) {
    const rawField = sourceByKey.get(path);
    const reviewField = reviewByKey.get(path);
    const hasReviewValue = reviewField?.normalizedValue !== null && reviewField?.normalizedValue !== undefined;
    const value = hasReviewValue ? reviewField?.normalizedValue : rawField?.value ?? null;
    const status = hasReviewValue ? reviewField?.status : rawField?.status ?? reviewField?.status;
    if (!rawField && !reviewField || value === null || status === "NOT_FOUND") blockers.push({ code: "REQUIRED_FIELD_MISSING", fieldKey: path, label: `Campo obbligatorio non rilevato: ${requiredLabels[path] ?? path}`, required: true });
    else if (status === "UNCERTAIN") blockers.push({ code: "REQUIRED_FIELD_UNCERTAIN", fieldKey: path, label: `Campo obbligatorio incerto: ${requiredLabels[path] ?? path}`, required: true });
  }
  const optionalNotFound = reviewFields.filter((field) => !requiredPaths.has(field.fieldKey) && (field.status === "NOT_FOUND" || field.normalizedValue === null)).map((field) => field.label);
  const commercialFields = reviewFields.filter((field) => field.status !== "NOT_FOUND" && field.normalizedValue !== null).map((field) => requiredPaths.has(field.fieldKey) ? { ...field, required: true } : field);
  const notFoundFields = reviewFields.filter((field) => field.status === "NOT_FOUND" || field.normalizedValue === null).map((field) => requiredPaths.has(field.fieldKey) ? { ...field, required: true } : field);
  const approvalGate: CteApprovalGate = { approvalReady: blockers.length === 0, blockers, optionalNotFound };
  return { currency: currency(text(currencyField)), commercialFields, notFoundFields, sources: sourced.sources, approvalGate };
}

export function cteApprovalGate(record: Pick<CteIngestionRecord, "fields" | "vector" | "documentType" | "candidate"> & Partial<Pick<CteIngestionRecord, "reviewedCandidate" | "ingestionId" | "documentId" | "status">> & { readonly tenantId?: string }): CteApprovalGate {
  const review = normalizeCteReview(record);
  const blockers = [...review.approvalGate.blockers];
  if (record.documentType !== "CTE" || (record.vector !== "EE" && record.vector !== "GAS")) blockers.push({ code: "CLASSIFICATION_UNCONFIRMED", label: "Classificazione del documento non confermata", required: true });
  const persistedCandidate = record.reviewedCandidate ?? record.candidate;
  if (persistedCandidate) {
    try { validateCteContract(persistedCandidate); } catch { blockers.push({ code: "AUTHORITATIVE_CONTRACT_INVALID", label: "Contratto autorevole non valido: schema da verificare", required: true }); }
  } else if (record.ingestionId && record.documentId && record.tenantId && blockers.length === 0) {
    const built = tryBuildAuthoritativeCteContract(record as Pick<CteIngestionRecord, "ingestionId" | "documentId" | "fields" | "vector" | "documentType"> & { readonly tenantId: string });
    if (!built.contract) blockers.push({ code: "AUTHORITATIVE_CONTRACT_MISSING", label: built.errorCode === "CTE_AUTHORITATIVE_FIELD_UNCERTAIN" ? "Contratto autorevole: confermare i campi obbligatori incerti" : built.errorCode === "CTE_AUTHORITATIVE_FIELD_MISSING" ? "Contratto autorevole: completare i campi obbligatori" : "Contratto autorevole non valido: verifica server non completata", required: true });
  } else if (!persistedCandidate) {
    blockers.push({ code: "AUTHORITATIVE_CONTRACT_MISSING", label: "Contratto autorevole non ancora disponibile", required: true });
  }
  return { approvalReady: record.status === "APPROVED" ? false : blockers.length === 0, blockers, optionalNotFound: review.approvalGate.optionalNotFound };
}

export function formatCteReviewValue(field: CteReviewField): string {
  if (Array.isArray(field.normalizedValue)) return field.normalizedValue.map((value) => typeof value === "string" ? value : `${value.kind}:${value.declarationState}`).join(", ");
  if (typeof field.normalizedValue === "number") return `${italianNumber(field.normalizedValue)}${field.unit ? ` ${field.unit}` : ""}`;
  return typeof field.normalizedValue === "string" ? field.normalizedValue : "Non rilevato";
}
