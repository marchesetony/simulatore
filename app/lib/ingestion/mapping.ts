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
import { BillIngestionError, type BillExtractionField } from "./errors.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { classifyBillText } from "./classifier.ts";
import type { BillClassification } from "./types.ts";

const PROVENANCE_FIELDS: readonly BillFieldName[] = ["billingPeriod", "customer", "supply", "consumption", "supplier", "offer", "regulatedCharges"];
const LABELS = [
  "customer id", "id cliente", "codice cliente", "customer type", "tipo cliente", "tipologia cliente", "customer", "cliente", "intestatario", "customer name", "nome cliente",
  "vat number", "partita iva", "p iva", "tax code", "codice fiscale", "supply id", "id fornitura", "meter id", "matricola contatore",
  "pod", "pdr", "voltage level", "livello tensione", "tensione di alimentazione", "billing period", "periodo fatturazione", "periodo", "consumption basis", "tipo consumo",
  "supplier", "fornitore", "offer name", "nome offerta", "offerta commerciale", "offer code", "codice offerta", "f1", "f2", "f3", "total kwh", "totale kwh",
  "billed kwh", "consumo fatturato", "kwh", "smc", "gas consumption", "consumo gas", "correction coefficient", "coefficiente di conversione",
  "coefficiente", "tax number", "identificativo fiscale",
] as const;

const unavailableText = (reason: "NOT_EXTRACTED" | "NOT_PROVIDED" | "UNREADABLE" = "NOT_EXTRACTED"): DeclaredText => ({ status: "UNAVAILABLE", reason });
const unavailableNumber = (reason: "NOT_EXTRACTED" | "NOT_PROVIDED" | "UNREADABLE" = "NOT_EXTRACTED"): DeclaredNumber => ({ status: "UNAVAILABLE", reason });
const unavailableQuantity = <U extends "KWH" | "SMC">(unit: U, reason: "NOT_EXTRACTED" | "NOT_PROVIDED" | "UNREADABLE" = "NOT_EXTRACTED"): Quantity<U> => ({ unit, status: "UNAVAILABLE", reason });

function required(value: string | null, field?: BillExtractionField): string {
  if (!value) throw new BillIngestionError("EXTRACTION_REQUIRED_FIELD_MISSING", field);
  return value;
}

function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function readLabel(text: string, aliases: readonly string[]): string | null {
  const aliasPattern = aliases.map(escape).sort((left, right) => right.length - left.length).join("|");
  const labelPattern = LABELS.map(escape).sort((left, right) => right.length - left.length).join("|");
  const source = text.normalize("NFKC").replace(/\r\n?/g, "\n");
  const linePattern = new RegExp(`(?:^|\\n)\\s*(?:${aliasPattern})(?![A-Za-z])\\s*(?::|=)\\s*([^\\n;|]+)`
    + `|(?:^|\\n)\\s*(?:${aliasPattern})(?![A-Za-z])\\s*\\n\\s*([^\\n;|]+)`, "i");
  const lineMatch = source.match(linePattern);
  if (lineMatch) return (lineMatch[1] ?? lineMatch[2] ?? "").trim() || null;
  const normalizedText = source.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const inlinePattern = new RegExp(`(?:^|[;|])\\s*(?:${aliasPattern})(?![A-Za-z])\\s*[:=]\\s*([^;|]+)`
    + `|(?:^|\\s)(?:${aliasPattern})(?![A-Za-z])\\s*[:=]\\s*(.*?)(?=\\s+(?:${labelPattern})(?![A-Za-z])\\s*[:=]|[;|]|$)`, "i");
  const match = normalizedText.match(inlinePattern);
  return (match?.[1] ?? match?.[2] ?? "").trim() || null;
}

function readSupplyReference(text: string, alias: "pod" | "pdr"): string | null {
  const value = readLabel(text, [alias]);
  if (value) return value;
  const normalizedText = text.normalize("NFKC").replace(/\r\n?/g, " ").replace(/\s+/g, " ").trim();
  const pattern = alias === "pod"
    ? new RegExp(`\\bP\\s*O\\s*D\\s*[:=#-]?\\s*(IT[A-Z0-9]{6,30})(?=$|[^0-9A-Z])`, "i")
    : /\bP\s*D\s*R\s*[:=#-]?\s*((?:\d\s*){14})(?=$|[^0-9])/i;
  return normalizedText.match(pattern)?.[1]?.replace(/\s+/g, "").trim() || null;
}

function localizedNumberTokens(value: string): string[] {
  return value.match(/(?<![\w])(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/g) ?? [];
}

function readConsumptionBand(text: string, band: "f1" | "f2" | "f3"): string | null {
  const lines = text.normalize("NFKC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const bandPattern = new RegExp(`\\b${band}\\b`, "i");
  const excluded = (line: string): boolean => /pun|\u20ac\s*\/\s*kwh|prezzo|formula commerciale|box dell.?offerta|potenza/i.test(line);
  const valueAfterBand = (line: string, mode: "first" | "last"): string | null => {
    if (excluded(line)) return null;
    const match = bandPattern.exec(line);
    if (!match) return null;
    const tokens = localizedNumberTokens(line.slice(match.index + match[0].length));
    if (tokens.length === 0) return "__INVALID_NUMBER__";
    return mode === "first" ? tokens[0] : tokens[tokens.length - 1];
  };
  const billedIndex = lines.findIndex((line) => /consumi\s+fatturati/i.test(line));
  if (billedIndex >= 0) {
    for (const line of lines.slice(billedIndex + 1)) {
      if (!/quarto[- ]?oraria/i.test(line)) continue;
      const value = valueAfterBand(line, "first");
      if (value !== null) return value;
    }
  }
  const summaryIndex = lines.findIndex((line) => /riepilogo\s+consumi/i.test(line));
  if (summaryIndex >= 0) {
    const end = billedIndex > summaryIndex ? billedIndex : lines.length;
    for (const line of lines.slice(summaryIndex + 1, end)) {
      const value = valueAfterBand(line, "last");
      if (value !== null) return value;
    }
  }
  for (const line of lines) {
    if (excluded(line) || !new RegExp(`^\\s*${band}\\b`, "i").test(line)) continue;
    const value = valueAfterBand(line, "last");
    if (value !== null) return value;
  }
  for (const line of lines) {
    if (excluded(line) || !new RegExp(`\\b${band}\\s*[:=]`, "i").test(line)) continue;
    const value = valueAfterBand(line, "first");
    if (value !== null) return value;
  }
  return null;
}

function readCustomerId(text: string): string | null {
  const labeled = readLabel(text, ["customer id", "id cliente"]);
  if (labeled) return labeled;
  const lines = text.normalize("NFKC").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*codice cliente\s*(?::|=)?\s*(.*)$/i);
    if (!match) continue;
    if (match[1].trim()) return match[1].trim();
    for (const next of lines.slice(index + 1)) {
      const value = next.trim();
      if (value) return value;
    }
  }
  return null;
}

function readSupplier(text: string): string | null {
  const labeled = readLabel(text, ["supplier", "fornitore"]);
  if (labeled) return labeled;
  const normalizedText = text.normalize("NFKC").replace(/\r\n?/g, "\n");
  const companyLine = /(?:^|\n)\s*(?:\[\d+\]\s*)?([A-ZÀ-ÖØ-Ý0-9][A-ZÀ-ÖØ-Ý0-9 &'.,-]{1,118}?\s+(?:S\.?\s*R\.?\s*L\.?|S\.?\s*P\.?\s*A\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*N\.?\s*C\.?)\s*)(?:-\s+[^\n;]+)?$/im;
  return normalizedText.match(companyLine)?.[1]?.trim() || null;
}

function readCustomerName(text: string): string | null {
  const labeled = readLabel(text, ["customer name", "nome cliente", "customer", "cliente", "intestatario"]);
  if (labeled) return labeled;
  const lines = text.normalize("NFKC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const sectionIndex = lines.findIndex((line) => /^(?:dati cliente|customer data)$/i.test(line));
  if (sectionIndex < 0) return null;
  for (const line of lines.slice(sectionIndex + 1, sectionIndex + 6)) {
    if (/^(?:codice cliente|customer id|id cliente|codice fiscale|partita iva)\b/i.test(line)) continue;
    if (/^(?:via|viale|piazza|corso)\b/i.test(line)) continue;
    if (/^(?:dati|fornitura|periodo|consumo|totale|pod|pdr)\b/i.test(line)) break;
    if (!/^\[?\d[\d .-]*\]?$/.test(line)) return line;
  }
  return null;
}

function parseNumber(raw: string | null, field?: BillExtractionField): number | null {
  if (!raw) return null;
  const candidate = raw.replace(/[^0-9,.-]/g, "").trim();
  if (!candidate) throw new BillIngestionError("EXTRACTION_VALUE_INVALID", field);
  const normalized = candidate.includes(",")
    ? candidate.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(?:\.\d{3})+$/.test(candidate)
      ? candidate.replace(/\./g, "")
      : candidate.replace(/,(?=\d{3}(?:\D|$))/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) throw new BillIngestionError("EXTRACTION_VALUE_INVALID", field);
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

function quantity<U extends "KWH" | "SMC">(unit: U, raw: string | null, field?: BillExtractionField): Quantity<U> {
  const value = parseNumber(raw, field);
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
  if (/non\s*residente|non[-_ ]?residential|business|azienda|impresa/i.test(raw)) return "NON_RESIDENTIAL";
  if (/residente|residential|domestic|privat/i.test(raw)) return "RESIDENTIAL";
  throw new BillIngestionError("EXTRACTION_VALUE_INVALID", "customerType");
}

function parseConsumptionBasis(raw: string | null): "MEASURED" | "ESTIMATED" | "MIXED" | null {
  if (!raw) return null;
  if (/measured|misurat/i.test(raw)) return "MEASURED";
  if (/estimated|stimat/i.test(raw)) return "ESTIMATED";
  if (/mixed|misto/i.test(raw)) return "MIXED";
  throw new BillIngestionError("EXTRACTION_VALUE_INVALID", "consumptionBasis");
}

function parseVoltageLevel(raw: string | null): "LV" | "MV" | "HV" | "EHV" {
  if (!raw) throw new BillIngestionError("EXTRACTION_REQUIRED_FIELD_MISSING");
  const normalized = raw.toUpperCase().replace(/\s/g, "");
  if (normalized === "LV" || normalized === "MV" || normalized === "HV" || normalized === "EHV") return normalized;
  if (/\b(?:bassa|low)\s+tensione\b|\bBT\b/i.test(raw)) return "LV";
  if (/\b(?:media|medium)\s+tensione\b|\bMT\b/i.test(raw)) return "MV";
  if (/\b(?:alta|high)\s+tensione\b|\bAT\b/i.test(raw)) return "HV";
  const volts = parseNumber(raw, "voltageLevel");
  if (volts !== null && volts > 0 && volts <= 1_000) return "LV";
  throw new BillIngestionError("EXTRACTION_VALUE_INVALID", "voltageLevel");
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

  const customerId = readCustomerId(input.text);
  const customerName = readCustomerName(input.text);
  const customerType = parseCustomerType(readLabel(input.text, ["customer type", "tipo cliente", "tipologia cliente"]));
  const vatNumber = readLabel(input.text, ["vat number", "partita iva", "p iva", "vat"]);
  const taxCode = readLabel(input.text, ["tax code", "codice fiscale"]);
  const taxIdentifiers = [
    ...(vatNumber ? [{ kind: "VAT_NUMBER" as const, value: vatNumber }] : []),
    ...(taxCode ? [{ kind: "TAX_CODE" as const, value: taxCode }] : []),
  ];
  const supplyId = readLabel(input.text, ["supply id", "id fornitura"]);
  const meterId = readLabel(input.text, ["meter id", "matricola contatore"]);
  const periodRaw = readLabel(input.text, ["billing period", "periodo fatturato", "periodo fatturazione", "periodo"]);
  const billingPeriod = parsePeriod(periodRaw);
  if (!billingPeriod) throw new BillIngestionError("EXTRACTION_VALUE_INVALID", "billingPeriod");
  const supplier = required(readSupplier(input.text), "supplier");
  const offerNameRaw = readLabel(input.text, ["offer name", "nome offerta", "offerta commerciale"]);
  const offerCodeRaw = readLabel(input.text, ["offer code", "codice offerta"]);
  const consumptionBasis = parseConsumptionBasis(readLabel(input.text, ["consumption basis", "tipo consumo"]));

  const podOrPdr = vector === "EE"
    ? required(readSupplyReference(input.text, "pod"), "pod")
    : required(readSupplyReference(input.text, "pdr"), "pdr");
  const supply: ElectricitySupply | GasSupply = vector === "EE"
    ? {
      vector: "EE" as const,
      ...(supplyId ? { supplyId } : {}),
      ...(meterId ? { meterId } : {}),
      pod: podOrPdr,
      voltageLevel: ((): "LV" | "MV" | "HV" | "EHV" => {
        return parseVoltageLevel(readLabel(input.text, ["voltage level", "livello tensione", "tensione di alimentazione"]));
      })(),
    }
    : { vector: "GAS" as const, ...(supplyId ? { supplyId } : {}), ...(meterId ? { meterId } : {}), pdr: podOrPdr };

  const f1Raw = vector === "EE" ? readConsumptionBand(input.text, "f1") : null;
  const f2Raw = vector === "EE" ? readConsumptionBand(input.text, "f2") : null;
  const f3Raw = vector === "EE" ? readConsumptionBand(input.text, "f3") : null;
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
    ...(customerId ? { customerId } : {}),
    ...(supplyId ? { supplyId } : {}),
    supply: supply as ElectricitySupply,
    billingPeriod,
    ...(consumptionBasis ? { consumptionBasis } : {}),
    currentSupplier: supplier,
    customer: { ...(customerId ? { customerId } : {}), customerType, name: declaredText(customerName), taxIdentifiers },
    offer: { supplier, offerName: declaredText(offerNameRaw), offerCode: declaredText(offerCodeRaw) },
    consumption: { vector: "EE", f1: quantity("KWH", f1Raw, "f1"), f2: quantity("KWH", f2Raw, "f2"), f3: quantity("KWH", f3Raw, "f3"), total: quantity("KWH", totalRaw, "billedConsumption") },
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
    ...(customerId ? { customerId } : {}),
    ...(supplyId ? { supplyId } : {}),
    supply: supply as GasSupply,
    billingPeriod,
    ...(consumptionBasis ? { consumptionBasis } : {}),
    currentSupplier: supplier,
    customer: { ...(customerId ? { customerId } : {}), customerType, name: declaredText(customerName), taxIdentifiers },
    offer: { supplier, offerName: declaredText(offerNameRaw), offerCode: declaredText(offerCodeRaw) },
    consumption: { vector: "GAS", smc: quantity("SMC", smcRaw, "smc"), correctionCoefficient: parseNumber(coefficientRaw, "correctionCoefficient") === null ? unavailableNumber("NOT_PROVIDED") : { status: "KNOWN", value: parseNumber(coefficientRaw, "correctionCoefficient") as number } },
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
