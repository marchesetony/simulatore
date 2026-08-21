import type { DeclaredText, Quantity } from "../energy/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateBillContract } from "../energy/validation.ts";
import type { BillContract } from "../energy/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { BILL_ECONOMIC_CHARGE_CODES, normalizeAnalystItemCode, type BillEconomicChargeLineCode, type BillExtendedFactCode } from "./bill-extended-contract.ts";
import type { StructuredBillExtraction, StructuredBillField, StructuredBillPeriod } from "./structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStructuredBillExtraction } from "./structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveBillVectorFromEvidence } from "./vector-resolution.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeBillEconomicComponent } from "../foundation/bill-economic-analysis.ts";

export const BILL_WIRE_TOOL_NAME = "extract_bill_structured";
export const BILL_WIRE_FIELD_NAMES = [
  "vector", "supplier", "customerName", "customerId", "customerType", "customerTaxIdentifier", "billingPeriod",
  "totalAmount", "annualConsumption", "billedConsumption", "pod", "pdr", "voltageLevel", "powerKw",
  "f1Consumption", "f2Consumption", "f3Consumption", "smcConsumption", "conversionCoefficient", "pcs", "offerName", "offerCode",
] as const;

export type BillWireFieldName = typeof BILL_WIRE_FIELD_NAMES[number];
export const BILL_WIRE_STATUS_VALUES = ["FOUND", "NOT_FOUND", "INVALID", "NEEDS_REVIEW"] as const;
export const BILL_WIRE_ANALYST_ITEM_KINDS = ["FACT", "CHARGE"] as const;
export const BILL_WIRE_VECTOR_VALUES = ["EE", "GAS", "UNKNOWN", "NOT_FOUND"] as const;
export const BILL_WIRE_CUSTOMER_TYPE_VALUES = ["RESIDENTIAL", "NON_RESIDENTIAL", "UNKNOWN", "NOT_FOUND"] as const;
export const BILL_WIRE_VOLTAGE_LEVEL_VALUES = ["LV", "MV", "HV", "EHV", "UNKNOWN", "NOT_FOUND"] as const;
export type BillWireStatus = typeof BILL_WIRE_STATUS_VALUES[number];
export type BillWireAnalystItemKind = typeof BILL_WIRE_ANALYST_ITEM_KINDS[number];
export interface BillWireField { readonly value: string; readonly status: BillWireStatus; }
export interface BillWireAnalystItem {
  readonly kind: BillWireAnalystItemKind;
  readonly code: string;
  readonly value: string;
  readonly unit: string;
  readonly description: string;
  readonly period: string;
  readonly status: BillWireStatus;
}
export type BillWireExtraction = { readonly schemaVersion: 1 } & {
  readonly [K in Exclude<BillWireFieldName, "customerId">]: BillWireField;
} & { readonly customerId?: BillWireField; readonly analystItems?: readonly BillWireAnalystItem[] };

const BILL_WIRE_VALUE_ENUMS: Partial<Record<BillWireFieldName, readonly string[]>> = {
  vector: BILL_WIRE_VECTOR_VALUES,
  customerType: BILL_WIRE_CUSTOMER_TYPE_VALUES,
  voltageLevel: BILL_WIRE_VOLTAGE_LEVEL_VALUES,
};
const BILL_WIRE_REQUIRED_FIELD_NAMES = BILL_WIRE_FIELD_NAMES.filter((name) => name !== "customerId");

export class BillWireValidationError extends Error {
  readonly code = "BILL_WIRE_VALIDATION_FAILED";
  readonly fieldPath: string;
  readonly reason: string;
  readonly expectedType: string;
  readonly actualType: string;
  readonly expectedEnumName: string;
  readonly validationStage = "WIRE" as const;

  constructor(path: string, reason: string, details: { readonly expectedType?: string; readonly actualType?: string; readonly expectedEnumName?: string } = {}) {
    super(`BILL_WIRE_VALIDATION_FAILED:${path}:${reason}`);
    this.name = "BillWireValidationError";
    this.fieldPath = path;
    this.reason = reason;
    this.expectedType = details.expectedType ?? "NONE";
    this.actualType = details.actualType ?? "NONE";
    this.expectedEnumName = details.expectedEnumName ?? "NONE";
  }
}

const actualType = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const enumName = (field: BillWireFieldName): string => `BILL_WIRE_${field.toUpperCase()}_VALUE`;

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BillWireValidationError(path, "OBJECT_REQUIRED", { expectedType: "object", actualType: actualType(value) });
  return value as Record<string, unknown>;
}

function validateAnalystItems(value: unknown): asserts value is readonly BillWireAnalystItem[] {
  if (!Array.isArray(value)) throw new BillWireValidationError("analystItems", "ARRAY_REQUIRED", { expectedType: "array", actualType: actualType(value) });
  for (const [index, itemValue] of value.entries()) {
    const item = record(itemValue, `analystItems.${index}`);
    for (const key of ["kind", "code", "value", "unit", "description", "period", "status"]) if (!(key in item)) throw new BillWireValidationError(`analystItems.${index}.${key}`, "REQUIRED");
    for (const key of Object.keys(item)) if (!["kind", "code", "value", "unit", "description", "period", "status"].includes(key)) throw new BillWireValidationError(`analystItems.${index}.${key}`, "UNEXPECTED_PROPERTY");
    if (!BILL_WIRE_ANALYST_ITEM_KINDS.includes(item.kind as BillWireAnalystItemKind)) throw new BillWireValidationError(`analystItems.${index}.kind`, "ENUM", { expectedType: "string", actualType: actualType(item.kind), expectedEnumName: "BILL_WIRE_ANALYST_ITEM_KIND" });
    for (const key of ["code", "value", "unit", "description", "period"] as const) if (typeof item[key] !== "string") throw new BillWireValidationError(`analystItems.${index}.${key}`, "TYPE", { expectedType: "string", actualType: actualType(item[key]) });
    if (!BILL_WIRE_STATUS_VALUES.includes(item.status as BillWireStatus)) throw new BillWireValidationError(`analystItems.${index}.status`, "ENUM", { expectedType: "string", actualType: actualType(item.status), expectedEnumName: "BILL_WIRE_STATUS" });
  }
}

const wireFieldSchema = (field: BillWireFieldName) => ({
  type: "object",
  additionalProperties: false,
  required: ["value", "status"],
  properties: {
    value: { type: "string", ...(BILL_WIRE_VALUE_ENUMS[field] ? { enum: [...BILL_WIRE_VALUE_ENUMS[field]!] } : {}), description: "Valore documentale come stringa; usa NOT_FOUND quando assente." },
    status: { type: "string", enum: [...BILL_WIRE_STATUS_VALUES] },
  },
});

export const BILL_WIRE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", ...BILL_WIRE_REQUIRED_FIELD_NAMES],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    vector: wireFieldSchema("vector"), supplier: wireFieldSchema("supplier"), customerName: wireFieldSchema("customerName"), customerId: wireFieldSchema("customerId"), customerType: wireFieldSchema("customerType"), customerTaxIdentifier: wireFieldSchema("customerTaxIdentifier"),
    billingPeriod: wireFieldSchema("billingPeriod"), totalAmount: wireFieldSchema("totalAmount"), annualConsumption: wireFieldSchema("annualConsumption"), billedConsumption: wireFieldSchema("billedConsumption"),
    pod: wireFieldSchema("pod"), pdr: wireFieldSchema("pdr"), voltageLevel: wireFieldSchema("voltageLevel"), powerKw: wireFieldSchema("powerKw"),
    f1Consumption: wireFieldSchema("f1Consumption"), f2Consumption: wireFieldSchema("f2Consumption"), f3Consumption: wireFieldSchema("f3Consumption"), smcConsumption: wireFieldSchema("smcConsumption"), conversionCoefficient: wireFieldSchema("conversionCoefficient"), pcs: wireFieldSchema("pcs"),
    offerName: wireFieldSchema("offerName"), offerCode: wireFieldSchema("offerCode"),
    analystItems: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "code", "value", "unit", "description", "period", "status"], properties: { kind: { type: "string", enum: [...BILL_WIRE_ANALYST_ITEM_KINDS] }, code: { type: "string" }, value: { type: "string" }, unit: { type: "string" }, description: { type: "string" }, period: { type: "string" }, status: { type: "string", enum: [...BILL_WIRE_STATUS_VALUES] } } } },
  },
} as const;

export const BILL_WIRE_TOOL = {
  name: BILL_WIRE_TOOL_NAME,
  description: "Estrai i campi core della bolletta e usa analystItems per fatti e componenti economiche. code è testo libero normalizzato server-side. F1/F2/F3 sono consumi kWh; PUN_F1/PUN_F2/PUN_F3 sono prezzi.",
  strict: true,
  input_schema: BILL_WIRE_SCHEMA,
} as const;

export function validateBillWireExtraction(value: unknown): asserts value is BillWireExtraction {
  const item = record(value, "root");
  if (item.schemaVersion !== 1) throw new BillWireValidationError("schemaVersion", "ENUM", { expectedType: "integer", actualType: actualType(item.schemaVersion), expectedEnumName: "BILL_WIRE_SCHEMA_VERSION" });
  const expected = new Set<string>(["schemaVersion", ...BILL_WIRE_FIELD_NAMES, "analystItems"]);
  for (const key of Object.keys(item)) if (!expected.has(key)) throw new BillWireValidationError(key, "UNEXPECTED_PROPERTY");
  for (const key of BILL_WIRE_FIELD_NAMES) {
    if (!(key in item)) {
      if (key === "customerId") continue;
      throw new BillWireValidationError(key, "REQUIRED", { expectedType: "object" });
    }
    const field = record(item[key], key);
    for (const property of Object.keys(field)) if (property !== "value" && property !== "status") throw new BillWireValidationError(`${key}.${property}`, "UNEXPECTED_PROPERTY");
    if (!("value" in field)) throw new BillWireValidationError(`${key}.value`, "REQUIRED", { expectedType: "string" });
    if (!("status" in field)) throw new BillWireValidationError(`${key}.status`, "REQUIRED", { expectedType: "string" });
    if (typeof field.value !== "string") throw new BillWireValidationError(`${key}.value`, "TYPE", { expectedType: "string", actualType: actualType(field.value) });
    if (!BILL_WIRE_STATUS_VALUES.includes(field.status as BillWireStatus)) throw new BillWireValidationError(`${key}.status`, "ENUM", { expectedType: "string", actualType: actualType(field.status), expectedEnumName: "BILL_WIRE_STATUS" });
    const supportedValues = BILL_WIRE_VALUE_ENUMS[key];
    if (supportedValues && !supportedValues.includes(field.value)) throw new BillWireValidationError(`${key}.value`, "ENUM", { expectedType: "string", actualType: "string", expectedEnumName: enumName(key) });
  }
  if (item.analystItems !== undefined) validateAnalystItems(item.analystItems);
}

export function parseBillWireExtraction(value: unknown): BillWireExtraction {
  validateBillWireExtraction(value);
  return value;
}

type WireParser<T> = (value: string) => T;

function parseNumber(value: string): number {
  if (/(?:pun|€\s*\/\s*kwh|eur\s*\/\s*kwh|\/\s*kwh)/i.test(value)) throw new Error("PUN_OR_PRICE_VALUE");
  const normalized = value.trim().replace(/[€$£]/g, "").replace(/\b(?:eur|euro|kwh|kw|smc|m3|m³)\b/gi, "").replace(/[\s']/g, "");
  if (!/^[+-]?\d[\d.,]*$/.test(normalized)) throw new Error("NUMBER_NOT_PARSEABLE");
  const european = normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized.includes(".") && normalized.split(".").at(-1)?.length === 3 ? normalized.replace(/\./g, "") : normalized;
  const parsed = Number(european);
  if (!Number.isFinite(parsed)) throw new Error("NUMBER_NOT_PARSEABLE");
  return parsed;
}

function parseEnum<T extends string>(values: readonly T[], value: string): T {
  if (!values.includes(value as T)) throw new Error("ENUM_NOT_NORMALIZABLE");
  return value as T;
}

function parsePeriod(value: string): StructuredBillPeriod {
  const raw = value.trim();
  const monthNames: Readonly<Record<string, number>> = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
  const monthOnly = /^(?:(\d{1,2})[/. -](\d{4})|([a-zàèéìòù]+)\s+(\d{4}))$/i.exec(raw);
  const next = (year: number, month: number): string => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  if (monthOnly) {
    const month = monthOnly[1] ? Number(monthOnly[1]) : monthNames[monthOnly[3].toLowerCase()];
    const year = Number(monthOnly[2] ?? monthOnly[4]);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) throw new Error("DATE_NOT_PARSEABLE");
    return { from: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`, to: next(year, month), raw };
  }
  const match = /^(?:dal\s+)?(.+?)\s+(?:-|al|a)\s+(.+)$/i.exec(raw);
  if (!match) throw new Error("PERIOD_NOT_PARSEABLE");
  const date = (candidateRaw: string): string => {
    const candidate = candidateRaw.trim();
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(candidate);
    const italian = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.exec(candidate);
    const year = iso ? Number(iso[1]) : italian ? Number(italian[3]) : NaN;
    const month = iso ? Number(iso[2]) : italian ? Number(italian[2]) : NaN;
    const day = iso ? Number(iso[3]) : italian ? Number(italian[1]) : NaN;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error("DATE_NOT_PARSEABLE");
    return parsed.toISOString().slice(0, 10);
  };
  const from = date(match[1]);
  const to = date(match[2]);
  if (from >= to) throw new Error("PERIOD_ORDER_INVALID");
  return { from, to, raw };
}

function canonicalField<T>(fieldPath: BillWireFieldName, field: BillWireField, parser: WireParser<T>): StructuredBillField<T> {
  if (field.status === "NOT_FOUND") return { value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" };
  if (field.status === "INVALID") return { value: null, status: "INVALID", confidence: 0, source: "DOCUMENT_AI" };
  if (field.value === "NOT_FOUND" || field.value.trim().length === 0) return { value: null, status: field.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "INVALID", confidence: field.status === "NEEDS_REVIEW" ? 0.5 : 0, source: "DOCUMENT_AI" };
  try { return { value: parser(field.value), status: field.status, confidence: field.status === "FOUND" ? 0.9 : 0.5, source: "DOCUMENT_AI" }; }
  catch { console.error(`[BILL_WIRE_VALIDATION] field_path=${fieldPath} reason=VALUE_NOT_NORMALIZABLE expected_type=canonical actual_type=string expected_enum_name=NONE validation_stage=DOMAIN_NORMALIZATION`); return { value: null, status: field.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "INVALID", confidence: field.status === "NEEDS_REVIEW" ? 0.5 : 0, source: "DOCUMENT_AI" }; }
}

const stringValue: WireParser<string> = (value) => value.trim();
const numberFields = new Set(["totalAmount", "annualConsumption", "billedConsumption", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption", "smcConsumption", "conversionCoefficient", "pcs"]);
function parserFor(name: BillWireFieldName): WireParser<unknown> {
  if (numberFields.has(name)) return parseNumber;
  if (name === "vector") return (value) => parseEnum(["EE", "GAS"], value);
  if (name === "customerType") return (value) => parseEnum(["RESIDENTIAL", "NON_RESIDENTIAL"], value);
  if (name === "voltageLevel") return (value) => parseEnum(["LV", "MV", "HV", "EHV"], value);
  if (name === "billingPeriod") return parsePeriod;
  return stringValue;
}

function canonical<T>(wire: BillWireExtraction, name: BillWireFieldName): StructuredBillField<T> {
  return canonicalField(name, wire[name] ?? { value: "NOT_FOUND", status: "NOT_FOUND" }, parserFor(name) as WireParser<T>);
}

export function mapBillWireToStructuredBill(wire: BillWireExtraction): StructuredBillExtraction {
  validateBillWireExtraction(wire);
  const analystItems = wire.analystItems ?? [];
  const facts = analystItems.filter((item) => item.kind === "FACT").map((item) => ({ code: normalizeAnalystItemCode(item.code) as BillExtendedFactCode, value: item.value, ...(item.unit ? { unit: item.unit } : {}), status: item.status }));
  const charges = analystItems.filter((item) => item.kind === "CHARGE").map((item) => {
    const normalized = normalizeAnalystItemCode(item.code);
    const code = BILL_ECONOMIC_CHARGE_CODES.includes(normalized as BillEconomicChargeLineCode) ? normalized as BillEconomicChargeLineCode : "UNKNOWN";
    const raw = normalizeBillEconomicComponent({ code: item.code, description: item.description, rawValue: item.value, rawUnit: item.unit, rawQuantity: "", rawUnitPrice: "", rawAmount: item.value, rawPeriod: item.period, status: item.status });
    return { code, description: raw.description, quantity: raw.quantity ?? "", unit: raw.unit ?? "", unitPrice: raw.unitPrice ?? "", amount: raw.amount ?? "", periodRaw: raw.period ?? "", classification: raw.classification, rawDescription: raw.rawDescription, rawValue: raw.rawValue, rawUnit: raw.rawUnit, rawQuantity: raw.rawQuantity, rawUnitPrice: raw.rawUnitPrice, rawAmount: raw.rawAmount, rawPeriod: raw.rawPeriod, documentEvidence: raw.documentEvidence, calculationCheck: raw.calculationCheck, status: item.status };
  });
  const coreBillingPeriod = canonical<StructuredBillPeriod>(wire, "billingPeriod");
  const rawBillingPeriod = facts.find((fact) => fact.code === "BILLING_PERIOD_RAW");
  const billingPeriod = coreBillingPeriod.status === "FOUND" || !rawBillingPeriod ? coreBillingPeriod : canonicalField("billingPeriod", { value: rawBillingPeriod.value, status: rawBillingPeriod.status }, parsePeriod);
  const extraction: StructuredBillExtraction = {
    schemaVersion: 1,
    vector: canonical(wire, "vector"), supplier: canonical(wire, "supplier"), customerName: canonical(wire, "customerName"), customerId: canonical(wire, "customerId"), customerType: canonical(wire, "customerType"), customerTaxIdentifier: canonical(wire, "customerTaxIdentifier"),
    billingPeriod, totalAmount: canonical(wire, "totalAmount"), annualConsumption: canonical(wire, "annualConsumption"), billedConsumption: canonical(wire, "billedConsumption"),
    pod: canonical(wire, "pod"), pdr: canonical(wire, "pdr"), voltageLevel: canonical(wire, "voltageLevel"), powerKw: canonical(wire, "powerKw"),
    f1Consumption: canonical(wire, "f1Consumption"), f2Consumption: canonical(wire, "f2Consumption"), f3Consumption: canonical(wire, "f3Consumption"), smcConsumption: canonical(wire, "smcConsumption"), conversionCoefficient: canonical(wire, "conversionCoefficient"), pcs: canonical(wire, "pcs"),
    offerName: canonical(wire, "offerName"), offerCode: canonical(wire, "offerCode"), extendedFacts: facts, economicChargeLines: charges,
  };
  validateStructuredBillExtraction(extraction);
  return extraction;
}

const unavailableText = (reason: "NOT_PROVIDED" = "NOT_PROVIDED"): DeclaredText => ({ status: "UNAVAILABLE", reason });
const valueOf = <T>(item: StructuredBillField<T>): T | null => item.status === "FOUND" ? item.value : null;
const quantity = <U extends "KWH" | "SMC">(unit: U, item: StructuredBillField<number>): Quantity<U> => valueOf(item) === null ? { unit, status: "UNAVAILABLE", reason: "NOT_EXTRACTED" } : { unit, status: "KNOWN", value: valueOf(item) as number };
const declared = (item: StructuredBillField<string>): DeclaredText => valueOf(item) === null ? unavailableText() : { status: "KNOWN", value: valueOf(item) as string };
const isoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

export function mapBillWireToContract(input: { readonly extraction: StructuredBillExtraction; readonly tenantId: string; readonly billId: string; readonly versionId: string }): BillContract | null {
  const extraction = input.extraction;
  const vector = resolveBillVectorFromEvidence(extraction).vector;
  const supplier = valueOf(extraction.supplier);
  const period = valueOf(extraction.billingPeriod);
  const customerType = valueOf(extraction.customerType);
  if (vector === "UNKNOWN" || !supplier || !period || !isoDate(period.from) || !isoDate(period.to) || period.from >= period.to || !customerType) return null;
  const customerId = valueOf(extraction.customerId);
  const provenanceFields = ["billingPeriod", "customer", "supply", "consumption", "supplier", "offer", "regulatedCharges"] as const;
  const base = { schemaVersion: 1 as const, recordId: `${input.billId}::structured::${input.versionId}`, version: "1", parentVersionId: null, tenantId: input.tenantId, approval: { status: "DRAFT" as const, reason: "INGESTION_PENDING_REVIEW" }, recordType: "BILL" as const, billId: input.billId, ...(customerId ? { customerId } : {}), billingPeriod: { periodStart: period.from, periodEnd: period.to }, currentSupplier: supplier, customer: { ...(customerId ? { customerId } : {}), customerType, name: declared(extraction.customerName), taxIdentifiers: [] }, offer: { supplier, offerName: declared(extraction.offerName), offerCode: declared(extraction.offerCode) }, regulatedCharges: [], fieldProvenance: provenanceFields.map((field) => ({ field, source: "BILL_DOCUMENT" as const, sourceReference: `bill-document:${input.billId}`, locator: `wire:${field}`, confidence: 0.9, reviewed: false })), reviewState: "NEEDS_REVIEW" as const };
  if (vector === "EE") {
    const pod = valueOf(extraction.pod);
    const voltageLevel = valueOf(extraction.voltageLevel);
    if (!pod || !/^IT[A-Z0-9]{6,30}$/i.test(pod) || !voltageLevel) return null;
    const contract: BillContract = { ...base, vector: "EE", supply: { vector: "EE", pod, voltageLevel }, consumption: { vector: "EE", f1: quantity("KWH", extraction.f1Consumption), f2: quantity("KWH", extraction.f2Consumption), f3: quantity("KWH", extraction.f3Consumption), total: quantity("KWH", extraction.billedConsumption) } };
    try { validateBillContract(contract); return contract; } catch { return null; }
  }
  const pdr = valueOf(extraction.pdr);
  if (!pdr || !/^\d{14}$/.test(pdr)) return null;
  const contract: BillContract = { ...base, vector: "GAS", supply: { vector: "GAS", pdr }, consumption: { vector: "GAS", smc: quantity("SMC", extraction.smcConsumption), correctionCoefficient: valueOf(extraction.conversionCoefficient) === null ? { status: "UNAVAILABLE", reason: "NOT_EXTRACTED" } : { status: "KNOWN", value: valueOf(extraction.conversionCoefficient) as number } } };
  try { validateBillContract(contract); return contract; } catch { return null; }
}
