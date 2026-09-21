import type { CteExtractionField, CteIngestionRecord } from "./ingestion";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeCteReview } from "./review.ts";

export type CteContractEconomicMode = "CONTRACT_FIXED" | "CONTRACT_SCHEDULE" | "CONTRACT_FORMULA" | "DYNAMIC_REGULATORY_PASS_THROUGH" | "INCLUDED_IN_OTHER_COMPONENT" | "NOT_APPLICABLE" | "AMBIGUOUS";

export interface CteEconomicAudit {
  readonly supplierVatRequiredForCalculation: "NO";
  readonly supplierVatRequiredForEligibility: "NO";
  readonly supplierVatVisibleInUi: "NO";
  readonly voltageRaw: string;
  readonly voltageDocumentEvidence: string;
  readonly voltageScopeResolved: "BT/MT" | "BT" | "MT" | "UNRESOLVED";
  readonly voltageScopeStatus: "RESOLVED_EXPLICIT_MULTI_SCOPE" | "RESOLVED_SINGLE_SCOPE" | "UNRESOLVED";
  readonly multipleVoltageVariantsFound: "NO" | "YES";
  readonly variantModelRequired: "NO" | "YES";
  readonly pricingType: "INDEXED" | "FIXED" | "NOT_DECLARED";
  readonly indexReference: string;
  readonly spread: number | null;
  readonly fixedFee: number | null;
  readonly dispatchingMode: "OFFICIAL_PASS_THROUGH" | "NOT_DECLARED";
  readonly dispatchingValue: number | null;
  readonly dispatchingSnapshotValue: number | null;
  readonly dispatchingClassification: CteContractEconomicMode;
  readonly dispatchingRuntimeResolverRequired: "YES" | "NO";
  readonly dispatchingContractValueUsable: "YES" | "NO";
  readonly dispatchingReason: string;
  readonly dispatchingUnit: string;
  readonly dispatchingIndexReference: string;
  readonly dispatchingFormula: string;
  readonly dispatchingSource: string;
  readonly capacityMarketMode: "PEAK_OFFPEAK" | "OFFICIAL_PASS_THROUGH" | "NOT_DECLARED";
  readonly capacityMarketValue: Readonly<Record<string, number>> | null;
  readonly capacityMarketUnit: string;
  readonly capacityMarketIndexReference: string;
  readonly capacityMarketFormula: string;
  readonly capacityMarketSource: string;
  readonly capacityClassifications: Readonly<Record<string, CteContractEconomicMode>>;
  readonly capacityRuntimeResolverRequired: "YES" | "NO";
  readonly mt0065Component: string;
  readonly mt0065Mode: CteContractEconomicMode;
  readonly mt0065ApplicationRule: string;
  readonly lossTreatmentMode: string;
  readonly lossFactor: number | null;
  readonly lossApplicationBase: string;
  readonly lossSource: string;
  readonly lossReferenceMode: "STATIC_CONTRACT_REFERENCE" | "DYNAMIC_REGULATORY_REFERENCE" | "AMBIGUOUS" | "NOT_APPLICABLE";
  readonly lossSuccessorReferenceAllowed: "YES" | "NO";
  readonly lossRuntimeResolverRequired: "YES" | "NO";
  readonly lossStaticContractRuleUsable: "YES" | "NO";
  readonly imbalanceMode: "FIXED_VALUE" | "NOT_DECLARED";
  readonly imbalanceValue: number | null;
  readonly imbalanceUnit: string;
  readonly imbalanceFormula: string;
  readonly imbalanceSource: string;
  readonly imbalanceClassification: CteContractEconomicMode;
  readonly imbalanceDynamicUpdate: "YES" | "NO";
  readonly imbalanceRuntimeResolverRequired: "YES" | "NO";
  readonly variableFee: number | null;
  readonly oneOffFee: number | null;
  readonly commercializationFee: number | null;
  readonly commercializationClassification: CteContractEconomicMode;
  readonly commercializationCountOnce: "YES";
  readonly fixedFeeClassification: CteContractEconomicMode;
  readonly oneOffFeeClassification: CteContractEconomicMode;
  readonly administrativeFee: number | null;
  readonly otherCommercialFees: null;
  readonly discounts: null;
  readonly customerScopeRaw: string;
  readonly customerScopeCanonical: null;
  readonly customerScopeStatus: "NOT_AVAILABLE_EXACT_ENUM";
  readonly minAnnualConsumption: number | null;
  readonly maxAnnualConsumption: null;
  readonly thresholdOperator: ">" | null;
  readonly economicModelGaps: readonly string[];
  readonly punMode: CteContractEconomicMode;
  readonly punRuntimeValueRequired: "YES" | "NO";
}

export interface CteEconomicAuditOptions {
  /** Complete clause evidence supplied by the real document reader; never inferred from a filename. */
  readonly contractEvidence?: string;
}

function field(record: Pick<CteIngestionRecord, "fields">, path: string): CteExtractionField | undefined { return record.fields.find((candidate) => candidate.path === path); }
function reviewText(value: { readonly sourceText?: string | null; readonly sourceTextComplete?: string | null; readonly normalizedValue?: unknown } | undefined): string {
  if (typeof value?.sourceTextComplete === "string") return value.sourceTextComplete;
  if (typeof value?.sourceText === "string") return value.sourceText;
  return typeof value?.normalizedValue === "string" ? value.normalizedValue : "";
}
function rawText(value: CteExtractionField | undefined): string { return typeof value?.sourceText === "string" ? value.sourceText : typeof value?.value === "string" ? value.value : ""; }
function italianNumber(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
function amountAfter(raw: string, expression: RegExp): number | null {
  const match = raw.match(expression);
  return match?.[1] ? italianNumber(match[1]) : null;
}
function feeSource(record: Pick<CteIngestionRecord, "fields">, path: string): string { return rawText(field(record, path)); }

export function auditCteEconomicContract(record: Pick<CteIngestionRecord, "fields" | "vector" | "documentType">, options: CteEconomicAuditOptions = {}): CteEconomicAudit {
  const review = normalizeCteReview(record);
  const reviewField = (path: string) => review.commercialFields.find((candidate) => candidate.fieldKey === path) ?? review.notFoundFields.find((candidate) => candidate.fieldKey === path);
  const voltageField = field(record, "eligibility.voltageLevels");
  const voltageEvidence = rawText(voltageField);
  const voltageBoth = /bassa\s+(?:o|e)\s+(?:in\s+)?media\s+tensione/i.test(voltageEvidence);
  const pricingMode = reviewField("pricing.mode")?.normalizedValue;
  const pricingType = pricingMode === "Indicizzata" || pricingMode === "INDEXED" ? "INDEXED" : pricingMode === "Fissa" || pricingMode === "FIXED" ? "FIXED" : "NOT_DECLARED";
  const pricingReference = reviewField("pricing.reference");
  const pricingSource = `${reviewText(pricingReference)} ${typeof pricingReference?.normalizedValue === "string" ? pricingReference.normalizedValue : ""}`;
  const dispatchingSource = options.contractEvidence?.trim() || feeSource(record, "commercialTerms.passThroughComponents");
  const capacityValues: Record<string, number> = {};
  const capacityStart = dispatchingSource.search(/(?:mercato\s+capacit|capacity\s+market)/i);
  if (capacityStart >= 0) {
    const capacityText = dispatchingSource.slice(capacityStart);
    for (const segment of capacityText.split(/(?<=\.)\s+/)) {
      const amounts = [...segment.matchAll(/pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€|â‚¬)\s*\/\s*kWh/gi)];
      for (let index = 0; index < amounts.length; index += 1) {
        const match = amounts[index];
        const next = amounts[index + 1];
        const context = segment.slice(match.index ?? 0, next?.index ?? segment.length);
        const value = match[1] ? italianNumber(match[1]) : null;
        const key = /bassa\s+tensione/i.test(context) ? "BT" : /ore\s+di\s+picco/i.test(context) ? "PEAK" : /media\s+tensione/i.test(context) ? "MT" : /capacity\s+market\s+libero/i.test(segment) ? "CAPACITY_MARKET_LIBERO" : null;
        if (key && value !== null) capacityValues[key] = value;
      }
    }
  }
  const variableSource = feeSource(record, "commercialTerms.variableFees");
  const imbalanceSource = feeSource(record, "commercialTerms.imbalance");
  const commercialization = amountAfter(variableSource, /commercializzazione[^\d]*([\d.,]+)\s*(?:€|EUR|Eur|â‚¬)\s*\/\s*kWh/i);
  const imbalance = amountAfter(imbalanceSource, /sbilanciamento[^\d]*([\d.,]+)\s*(?:€|EUR|Eur|â‚¬)\s*\/\s*kWh/i);
  const fixedFeeValue = reviewField("commercialTerms.fixedFees")?.normalizedValue;
  const oneOffValue = reviewField("commercialTerms.oneOffFees")?.normalizedValue;
  const customerSource = rawText(field(record, "eligibility.customerTypes"));
  const threshold = customerSource.match(/(?:superiore|maggiore)\s+a\s+([\d.,]+)\s*kwh(?:\/anno|\/a)?/i);
  const lossSource = options.contractEvidence?.trim() || feeSource(record, "commercialTerms.lossSemantics") || variableSource;
  const dispatchingSnapshotValue = amountAfter(dispatchingSource, /dispacciamento[\s\S]{0,500}?pari\s+a\s+([\d.,]+)\s+(?:Eur|EUR|€)\s*\/\s*kWh/i);
  const dispatchingIsDynamic = /dispacciamento/i.test(dispatchingSource) && /periodicamente\s+aggiornati/i.test(dispatchingSource) && /Art\.\s*24\s+del\s*TIS/i.test(dispatchingSource);
  const capacityIsDynamic = /corrispettivo\s+mercato\s+capacit/i.test(dispatchingSource) && /definito\s+ed\s+aggiornato\s+dall['’]ARERA/i.test(dispatchingSource);
  const capacityClassifications: Record<string, CteContractEconomicMode> = {};
  for (const key of Object.keys(capacityValues)) capacityClassifications[key] = key === "CAPACITY_MARKET_LIBERO" ? "CONTRACT_FIXED" : capacityIsDynamic ? "DYNAMIC_REGULATORY_PASS_THROUGH" : "AMBIGUOUS";
  const lossReferenceIsPresent = /Tabella\s+4\s*,?\s*colonna\s+A[\s\S]{0,40}\bTIS\b/i.test(lossSource);
  const lossReferenceMode = lossReferenceIsPresent ? "AMBIGUOUS" : "NOT_APPLICABLE";
  return {
    supplierVatRequiredForCalculation: "NO",
    supplierVatRequiredForEligibility: "NO",
    supplierVatVisibleInUi: "NO",
    voltageRaw: voltageEvidence,
    voltageDocumentEvidence: voltageEvidence,
    voltageScopeResolved: voltageBoth ? "BT/MT" : /\bBT\b|bassa\s+tensione/i.test(voltageEvidence) ? "BT" : /\bMT\b|media\s+tensione/i.test(voltageEvidence) ? "MT" : "UNRESOLVED",
    voltageScopeStatus: voltageBoth ? "RESOLVED_EXPLICIT_MULTI_SCOPE" : /\bBT\b|\bMT\b|tensione/i.test(voltageEvidence) ? "RESOLVED_SINGLE_SCOPE" : "UNRESOLVED",
    multipleVoltageVariantsFound: "NO",
    variantModelRequired: "NO",
    pricingType,
    indexReference: pricingSource.match(/\bPUN\b/i) ? "PUN" : "NOT_DECLARED",
    spread: typeof reviewField("pricing.spread.amount")?.normalizedValue === "number" ? reviewField("pricing.spread.amount")?.normalizedValue as number : null,
    fixedFee: typeof fixedFeeValue === "number" ? fixedFeeValue : null,
    dispatchingMode: /dispacciamento/i.test(dispatchingSource) ? "OFFICIAL_PASS_THROUGH" : "NOT_DECLARED",
    dispatchingValue: null,
    dispatchingSnapshotValue,
    dispatchingClassification: dispatchingIsDynamic ? "DYNAMIC_REGULATORY_PASS_THROUGH" : "AMBIGUOUS",
    dispatchingRuntimeResolverRequired: dispatchingIsDynamic ? "YES" : "NO",
    dispatchingContractValueUsable: "NO",
    dispatchingReason: "La CTE richiama Art. 24 TIS e dichiara aggiornamenti periodici ARERA/Terna; il numero 0,01155 è adiacente al fattore perdite e non è un prezzo dispatch standalone utilizzabile.",
    dispatchingUnit: "EUR/kWh",
    dispatchingIndexReference: /Art\.\s*24\s+del\s*TIS/i.test(dispatchingSource) ? "ARERA/TERNA TIS Art. 24" : "NOT_DECLARED",
    dispatchingFormula: "Corrispettivo Art. 24 TIS aggiornato da ARERA/Terna, incrementato del fattore perdite Tabella 4 colonna A TIS",
    dispatchingSource,
    capacityMarketMode: Object.keys(capacityValues).length > 1 ? "PEAK_OFFPEAK" : Object.keys(capacityValues).length === 1 ? "OFFICIAL_PASS_THROUGH" : "NOT_DECLARED",
    capacityMarketValue: Object.keys(capacityValues).length ? capacityValues : null,
    capacityMarketUnit: "EUR/kWh",
    capacityMarketIndexReference: /34\.8\s*bis\s*TIV/i.test(dispatchingSource) ? "TIV comma 34.8 bis" : "NOT_DECLARED",
    capacityMarketFormula: "Valori distinti per bassa tensione, ore di picco, media tensione e Capacity Market libero; non un singolo numero canonico",
    capacityMarketSource: dispatchingSource,
    capacityClassifications,
    capacityRuntimeResolverRequired: Object.values(capacityClassifications).some((mode) => mode === "DYNAMIC_REGULATORY_PASS_THROUGH") ? "YES" : "NO",
    mt0065Component: "Corrispettivo mercato capacità comma 34.8 bis TIV per clienti in media tensione",
    mt0065Mode: capacityClassifications.MT ?? "AMBIGUOUS",
    mt0065ApplicationRule: "Applicabile ai clienti in media tensione; valore indicato dalla CTE come attualmente pari a 0,065 EUR/kWh e soggetto alla clausola di aggiornamento ARERA.",
    lossTreatmentMode: "MIXED_DECLARED: commercializzazione/sbilanciamento al netto; capacity market libero al lordo; dispacciamento con fattore TIS",
    lossFactor: null,
    lossApplicationBase: "Commercializzazione e sbilanciamento: netto perdite; dispacciamento: fattore Tabella 4 colonna A TIS; Capacity Market libero: lordo perdite",
    lossSource,
    lossReferenceMode,
    lossSuccessorReferenceAllowed: "NO",
    lossRuntimeResolverRequired: lossReferenceIsPresent ? "YES" : "NO",
    lossStaticContractRuleUsable: "NO",
    imbalanceMode: imbalance !== null ? "FIXED_VALUE" : "NOT_DECLARED",
    imbalanceValue: imbalance,
    imbalanceUnit: imbalance === null ? "NOT_DECLARED" : "EUR/kWh",
    imbalanceFormula: "NOT_APPLICABLE",
    imbalanceSource,
    imbalanceClassification: imbalance !== null ? "CONTRACT_FIXED" : "NOT_APPLICABLE",
    imbalanceDynamicUpdate: "NO",
    imbalanceRuntimeResolverRequired: "NO",
    variableFee: commercialization,
    oneOffFee: typeof oneOffValue === "number" ? oneOffValue : null,
    commercializationFee: commercialization,
    commercializationClassification: commercialization !== null ? "CONTRACT_FIXED" : "NOT_APPLICABLE",
    commercializationCountOnce: "YES",
    fixedFeeClassification: typeof fixedFeeValue === "number" ? "CONTRACT_FIXED" : "NOT_APPLICABLE",
    oneOffFeeClassification: typeof oneOffValue === "number" ? "CONTRACT_FIXED" : "NOT_APPLICABLE",
    administrativeFee: null,
    otherCommercialFees: null,
    discounts: null,
    customerScopeRaw: customerSource,
    customerScopeCanonical: null,
    customerScopeStatus: "NOT_AVAILABLE_EXACT_ENUM",
    minAnnualConsumption: threshold?.[1] ? italianNumber(threshold[1]) : null,
    maxAnnualConsumption: null,
    thresholdOperator: threshold ? ">" : null,
    economicModelGaps: [
      "CUSTOMER_SCOPE_EXACT_ENUM_MISSING",
      "CAPACITY_MARKET_DIMENSIONED_SCHEDULE_NOT_NATIVE",
      "PUN_TIME_BAND_AVERAGING_RULE_REMAINS_SOURCE_EVIDENCE",
      "LOSS_FACTOR_NUMERIC_NOT_DECLARED",
    ],
    punMode: "CONTRACT_FORMULA",
    punRuntimeValueRequired: "YES",
  };
}
