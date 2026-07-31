// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateBillContract } from "../energy/validation.ts";
import type {
  BillContract,
  BillFieldName,
  DeclaredNumber,
  DeclaredText,
  ExtractedValueProvenance,
  ElectricitySupply,
  GasSupply,
  Quantity,
} from "../energy/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { BillIngestionError } from "./errors.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { classifyBillText } from "./classifier.ts";
import type { BillClassification } from "./types.ts";

const PROVENANCE_FIELDS: readonly BillFieldName[] = ["billingPeriod", "customer", "supply", "consumption", "supplier", "offer", "regulatedCharges"];
const LABELS = [
  "customer id", "id cliente", "customer type", "tipo cliente", "customer", "cliente", "intestatario", "customer name", "nome cliente",
  "vat number", "partita iva", "p iva", "tax code", "codice fiscale", "supply id", "id fornitura", "meter id", "matricola contatore",
  "pod", "pdr", "voltage level", "livello tensione", "billing period", "periodo fatturazione", "periodo", "consumption basis", "tipo consumo",
  "supplier", "fornitore", "offer name", "nome offerta", "offer code", "codice offerta", "f1", "f2", "f3", "total kwh", "totale kwh",
  "billed kwh", "consumo fatturato", "kwh", "smc", "gas consumption", "consumo gas", "correction coefficient", "coefficiente di conversione",
  "coefficiente", "tax number", "identificativo fiscale",
] as const;

const unavailableText = (reason: "NOT_EXTRACTED" | "NOT_PROVIDED" | "UNREADABLE" = "NOT_EXTRACTED"): DeclaredText => ({ status: "UNAVAILABLE", reason });
const unavailableNumber = (reason: "NOT_EXTRACTED" | "NOT_PROVIDED" | "UNREADABLE" = "NOT_EXTRACTED"): DeclaredNumber => ({ status: "UNAVAILABLE", reason });
const unavailableQuantity = <U extends "KWH" | "SMC">(unit: U, reason: "NOT_EXTRACTED" | "NOT_PROVIDED" | "UNREADABLE" = "NOT_EXTRACTED"): Quantity<U> => ({ unit, status: "UNAVAILABLE", reason });

function required(value: string | null): string {
  if (!value) throw new BillIngestionError("EXTRACTION_REQUIRED_FIELD_MISSING");
  return value;
}

function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function readLabel(text: string, aliases: readonly string[]): string | null {
  const aliasPattern = aliases.map(escape).join("|");
  const labelPattern = LABELS.map(escape).join("|");
  const pattern = new RegExp(`(?:^|[;|\\n])\\s*(?:${aliasPattern})\\s*[:=]\\s*([^;|\\n]+)`
    + `|(?:^|\\s)(?:${aliasPattern})\\s*[:=]\\s*(.*?)(?=\\s+(?:${labelPattern})\\s*[:=]|[;|\\n]|$)`, "i");
  const match = text.replace(/\r/g, "").match(pattern);
  return (match?.[1] ?? match?.[2] ?? "").trim() || null;
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const candidate = raw.replace(/[^0-9,.-]/g, "").trim();
  if (!candidate) throw new BillIngestionError("EXTRACTION_VALUE_INVALID");
  const normalized = candidate.includes(",")
    ? candidate.replace(/\./g, "").replace(",", ".")
    : candidate.replace(/,(?=\d{3}(?:\D|$))/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) throw new BillIngestionError("EXTRACTION_VALUE_INVALID");
  return value;
}

function dateOnly(raw: string): string | null {
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const italian = raw.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (!italian) return null;
  return `${italian[3]}-${italian[2].padStart(2, "0")}-${italian[1].padStart(2, "0")}`;
}

function parsePeriod(raw: string | null): { periodStart: string; periodEnd: string } | null {
  if (!raw) return null;
  const dates = [...raw.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/g)].map((match) => dateOnly(match[0])).filter((value): value is string => Boolean(value));
  if (dates.length < 2) return null;
  return { periodStart: dates[0], periodEnd: dates[1] };
}

function declaredText(raw: string | null): DeclaredText {
  return raw ? { status: "KNOWN", value: raw } : unavailableText("NOT_PROVIDED");
}

function quantity<U extends "KWH" | "SMC">(unit: U, raw: string | null): Quantity<U> {
  const value = parseNumber(raw);
  return value === null ? unavailableQuantity(unit) : { unit, status: "KNOWN", value };
}

function valueConfidence(raw: string | null, presentConfidence: number): number { return raw ? presentConfidence : 0; }

function buildValueProvenance(
  billId: string,
  vector: "EE" | "GAS",
  text: string,
  extractionSource: "embedded-text" | "ocr",
  values: ReadonlyArray<{ path: string; raw: string | null; confidence: number; locator: string }>,
): readonly ExtractedValueProvenance[] {
  const reference = `bill-document:${billId}`;
  return values.map((item) => ({
    path: item.path,
    source: item.raw ? "BILL_DOCUMENT" : "UNAVAILABLE",
    sourceReference: reference,
    locator: `${extractionSource}:${vector.toLowerCase()}:label:${item.locator}${text.length > 0 ? ":present" : ":empty"}`,
    confidence: item.raw ? item.confidence : 0,
    reviewed: false,
  }));
}

function fieldProvenance(
  billId: string,
  extractionSource: "embedded-text" | "ocr",
  values: ReadonlyArray<{ field: BillFieldName; raw: string | null; confidence: number; locator: string }>,
) {
  const reference = `bill-document:${billId}`;
  return PROVENANCE_FIELDS.map((field) => {
    const value = values.find((item) => item.field === field);
    return {
      field,
      source: value?.raw ? "BILL_DOCUMENT" as const : "UNAVAILABLE" as const,
      sourceReference: reference,
      locator: value ? `${extractionSource}:label:${value.locator}` : "unavailable:not-extracted",
      confidence: value?.raw ? value.confidence : 0,
      reviewed: false,
    };
  });
}

function parseCustomerType(raw: string | null): "RESIDENTIAL" | "NON_RESIDENTIAL" {
  if (!raw) throw new BillIngestionError("EXTRACTION_REQUIRED_FIELD_MISSING");
  if (/non[-_ ]?residential|business|azienda|impresa/i.test(raw)) return "NON_RESIDENTIAL";
  if (/residential|domestic|privat/i.test(raw)) return "RESIDENTIAL";
  throw new BillIngestionError("EXTRACTION_VALUE_INVALID");
}

function parseConsumptionBasis(raw: string | null): "MEASURED" | "ESTIMATED" | "MIXED" {
  if (!raw) throw new BillIngestionError("EXTRACTION_REQUIRED_FIELD_MISSING");
  if (/measured|misurat/i.test(raw)) return "MEASURED";
  if (/estimated|stimat/i.test(raw)) return "ESTIMATED";
  if (/mixed|misto/i.test(raw)) return "MIXED";
  throw new BillIngestionError("EXTRACTION_VALUE_INVALID");
}

export function mapTextToEnergyBill(input: {
  readonly text: string;
  readonly pages: number;
  readonly tenantId: string;
  readonly billId: string;
  readonly versionId: string;
  readonly extractionSource?: "embedded-text" | "ocr";
}): { readonly classification: BillClassification; readonly contract: BillContract } {
  const classification = classifyBillText(input.text);
  if (classification.vector === "UNKNOWN") throw new BillIngestionError("BILL_VECTOR_UNKNOWN");
  const vector = classification.vector;

  const customerId = required(readLabel(input.text, ["customer id", "id cliente"]));
  const customerName = readLabel(input.text, ["customer name", "nome cliente", "customer", "cliente", "intestatario"]);
  const customerType = parseCustomerType(readLabel(input.text, ["customer type", "tipo cliente"]));
  const vatNumber = readLabel(input.text, ["vat number", "partita iva", "p iva", "vat"]);
  const taxCode = readLabel(input.text, ["tax code", "codice fiscale"]);
  if (!vatNumber && !taxCode) throw new BillIngestionError("EXTRACTION_REQUIRED_FIELD_MISSING");
  const taxIdentifiers = [
    ...(vatNumber ? [{ kind: "VAT_NUMBER" as const, value: vatNumber }] : []),
    ...(taxCode ? [{ kind: "TAX_CODE" as const, value: taxCode }] : []),
  ];
  const supplyId = required(readLabel(input.text, ["supply id", "id fornitura"]));
  const meterId = required(readLabel(input.text, ["meter id", "matricola contatore"]));
  const periodRaw = readLabel(input.text, ["billing period", "periodo fatturazione", "periodo"]);
  const billingPeriod = parsePeriod(periodRaw);
  if (!billingPeriod) throw new BillIngestionError("EXTRACTION_VALUE_INVALID");
  const supplier = required(readLabel(input.text, ["supplier", "fornitore"]));
  const offerNameRaw = readLabel(input.text, ["offer name", "nome offerta"]);
  const offerCodeRaw = readLabel(input.text, ["offer code", "codice offerta"]);
  const consumptionBasis = parseConsumptionBasis(readLabel(input.text, ["consumption basis", "tipo consumo"]));

  const podOrPdr = vector === "EE"
    ? required(readLabel(input.text, ["pod"]))
    : required(readLabel(input.text, ["pdr"]));
  const supply: ElectricitySupply | GasSupply = vector === "EE"
    ? {
      vector: "EE" as const,
      supplyId,
      meterId,
      pod: podOrPdr,
      voltageLevel: ((): "LV" | "MV" | "HV" | "EHV" => {
        const raw = required(readLabel(input.text, ["voltage level", "livello tensione"]));
        const normalized = raw.toUpperCase().replace(/\s/g, "");
        if (normalized !== "LV" && normalized !== "MV" && normalized !== "HV" && normalized !== "EHV") throw new BillIngestionError("EXTRACTION_VALUE_INVALID");
        return normalized;
      })(),
    }
    : { vector: "GAS" as const, supplyId, meterId, pdr: podOrPdr };

  const f1Raw = readLabel(input.text, ["f1"]);
  const f2Raw = readLabel(input.text, ["f2"]);
  const f3Raw = readLabel(input.text, ["f3"]);
  const totalRaw = vector === "EE" ? readLabel(input.text, ["total kwh", "totale kwh", "billed kwh", "consumo fatturato"]) : null;
  const smcRaw = vector === "GAS" ? readLabel(input.text, ["smc", "gas consumption", "consumo gas"]) : null;
  const coefficientRaw = vector === "GAS" ? readLabel(input.text, ["correction coefficient", "coefficiente di conversione", "coefficiente"]) : null;

  const extractionSource = input.extractionSource ?? "embedded-text";
  const valueProvenance = buildValueProvenance(input.billId, vector, input.text, extractionSource, [
    { path: "customer.customerId", raw: customerId, confidence: 0.98, locator: "customer-id" },
    { path: "customer.customerType", raw: customerType, confidence: 0.9, locator: "customer-type" },
    { path: "customer.name", raw: customerName, confidence: 0.9, locator: "customer-name" },
    { path: "customer.taxIdentifiers", raw: vatNumber ?? taxCode, confidence: 0.98, locator: "tax-identifier" },
    { path: "supply.supplyId", raw: supplyId, confidence: 0.98, locator: "supply-id" },
    { path: "supply.meterId", raw: meterId, confidence: 0.95, locator: "meter-id" },
    { path: vector === "EE" ? "supply.pod" : "supply.pdr", raw: podOrPdr, confidence: 0.99, locator: vector === "EE" ? "pod" : "pdr" },
    ...(vector === "EE" ? [{ path: "supply.voltageLevel", raw: (supply as ElectricitySupply).voltageLevel, confidence: 0.9, locator: "voltage-level" }] : []),
    { path: "billingPeriod", raw: periodRaw, confidence: 0.9, locator: "billing-period" },
    ...(vector === "EE" ? [
      { path: "consumption.f1", raw: f1Raw, confidence: 0.92, locator: "f1" },
      { path: "consumption.f2", raw: f2Raw, confidence: 0.92, locator: "f2" },
      { path: "consumption.f3", raw: f3Raw, confidence: 0.92, locator: "f3" },
      { path: "consumption.total", raw: totalRaw, confidence: 0.95, locator: "total-kwh" },
    ] : [
      { path: "consumption.smc", raw: smcRaw, confidence: 0.92, locator: "smc" },
      { path: "consumption.correctionCoefficient", raw: coefficientRaw, confidence: 0.9, locator: "correction-coefficient" },
    ]),
    { path: "currentSupplier", raw: supplier, confidence: 0.95, locator: "supplier" },
    { path: "offer.offerName", raw: offerNameRaw, confidence: 0.88, locator: "offer-name" },
    { path: "offer.offerCode", raw: offerCodeRaw, confidence: 0.88, locator: "offer-code" },
    { path: "regulatedCharges", raw: null, confidence: 0, locator: "regulated-charges" },
  ]);

  const contract: BillContract = vector === "EE" ? {
    schemaVersion: 1,
    recordId: `${input.billId}::energy::${input.versionId}`,
    version: "1",
    parentVersionId: null,
    tenantId: input.tenantId,
    approval: { status: "DRAFT", reason: "INGESTION_PENDING_REVIEW" },
    recordType: "BILL",
    vector: "EE",
    billId: input.billId,
    customerId,
    supplyId,
    supply: supply as ElectricitySupply,
    billingPeriod,
    consumptionBasis,
    currentSupplier: supplier,
    customer: { customerId, customerType, name: declaredText(customerName), taxIdentifiers },
    offer: { supplier, offerName: declaredText(offerNameRaw), offerCode: declaredText(offerCodeRaw) },
    consumption: { vector: "EE", f1: quantity("KWH", f1Raw), f2: quantity("KWH", f2Raw), f3: quantity("KWH", f3Raw), total: quantity("KWH", totalRaw) },
    regulatedCharges: [],
    fieldProvenance: fieldProvenance(input.billId, extractionSource, [
      { field: "billingPeriod", raw: periodRaw, confidence: 0.9, locator: "billing-period" },
      { field: "customer", raw: customerId, confidence: 0.98, locator: "customer" },
      { field: "supply", raw: podOrPdr, confidence: 0.99, locator: "supply" },
      { field: "consumption", raw: f1Raw ?? f2Raw ?? f3Raw ?? totalRaw, confidence: valueConfidence(f1Raw ?? f2Raw ?? f3Raw ?? totalRaw, 0.92), locator: "consumption" },
      { field: "supplier", raw: supplier, confidence: 0.95, locator: "supplier" },
      { field: "offer", raw: offerNameRaw ?? offerCodeRaw, confidence: 0.88, locator: "offer" },
      { field: "regulatedCharges", raw: null, confidence: 0, locator: "regulated-charges" },
    ]),
    valueProvenance,
    reviewState: "NEEDS_REVIEW",
  } : {
    schemaVersion: 1,
    recordId: `${input.billId}::energy::${input.versionId}`,
    version: "1",
    parentVersionId: null,
    tenantId: input.tenantId,
    approval: { status: "DRAFT", reason: "INGESTION_PENDING_REVIEW" },
    recordType: "BILL",
    vector: "GAS",
    billId: input.billId,
    customerId,
    supplyId,
    supply: supply as GasSupply,
    billingPeriod,
    consumptionBasis,
    currentSupplier: supplier,
    customer: { customerId, customerType, name: declaredText(customerName), taxIdentifiers },
    offer: { supplier, offerName: declaredText(offerNameRaw), offerCode: declaredText(offerCodeRaw) },
    consumption: { vector: "GAS", smc: quantity("SMC", smcRaw), correctionCoefficient: parseNumber(coefficientRaw) === null ? unavailableNumber("NOT_PROVIDED") : { status: "KNOWN", value: parseNumber(coefficientRaw) as number } },
    regulatedCharges: [],
    fieldProvenance: fieldProvenance(input.billId, extractionSource, [
      { field: "billingPeriod", raw: periodRaw, confidence: 0.9, locator: "billing-period" },
      { field: "customer", raw: customerId, confidence: 0.98, locator: "customer" },
      { field: "supply", raw: podOrPdr, confidence: 0.99, locator: "supply" },
      { field: "consumption", raw: smcRaw ?? coefficientRaw, confidence: 0.92, locator: "consumption" },
      { field: "supplier", raw: supplier, confidence: 0.95, locator: "supplier" },
      { field: "offer", raw: offerNameRaw ?? offerCodeRaw, confidence: 0.88, locator: "offer" },
      { field: "regulatedCharges", raw: null, confidence: 0, locator: "regulated-charges" },
    ]),
    valueProvenance,
    reviewState: "NEEDS_REVIEW",
  };

  validateBillContract(contract);
  return { classification, contract };
}
