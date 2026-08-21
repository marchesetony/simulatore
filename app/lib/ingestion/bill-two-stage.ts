import type {
  StructuredBillEconomicChargeLine,
  StructuredBillExtendedFact,
  StructuredBillExtraction,
  StructuredBillField,
  StructuredBillPeriod,
} from "./structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildBillSupplyProfile } from "./bill-supply-profile.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStructuredBillExtraction } from "./structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { BILL_WIRE_SCHEMA, BillWireValidationError, mapBillWireToStructuredBill, parseBillWireExtraction, type BillWireExtraction, type BillWireStatus } from "./bill-wire.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { BILL_ANALYST_ITEM_CODES, BILL_ECONOMIC_CHARGE_CODES, normalizeAnalystItemCode, type BillEconomicChargeLineCode, type BillAnalystItemCode } from "./bill-extended-contract.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { normalizeBillEconomicComponent } from "../foundation/bill-economic-analysis.ts";

export const BILL_CORE_TOOL_NAME = "extract_bill_core";
export const BILL_ANALYST_TOOL_NAME = "extract_bill_analyst_items";
export const BILL_TWO_STAGE_SCHEMA_VERSION = "1";

type SchemaRecord = Record<string, unknown>;

/* The CORE schema is mechanically derived from the last accepted CORE-compatible
 * wire. The legacy one-call analystItems branch is deliberately excluded. */
const coreProperties = Object.fromEntries(Object.entries(BILL_WIRE_SCHEMA.properties).filter(([name]) => name !== "analystItems"));
export const CORE_WIRE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...BILL_WIRE_SCHEMA.required],
  properties: coreProperties,
} as const;

export const CORE_WIRE_TOOL = {
  name: BILL_CORE_TOOL_NAME,
  description: "Estrai esclusivamente i dati core affidabili della bolletta. Usa NOT_FOUND per dati assenti e non inventare valori.",
  strict: true,
  input_schema: CORE_WIRE_SCHEMA,
} as const;

export const ANALYST_ITEM_PROPERTY_NAMES = ["kind", "code", "label", "value", "unit", "quantity", "unitPrice", "amount", "period", "status"] as const;
export type AnalystItemPropertyName = typeof ANALYST_ITEM_PROPERTY_NAMES[number];

export interface BillAnalystWireItem {
  readonly kind: string;
  readonly code: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly amount: string;
  readonly period: string;
  readonly status: string;
}

export interface BillAnalystWireExtraction {
  readonly schemaVersion: string;
  readonly items: readonly BillAnalystWireItem[];
}

const analystItemProperties = Object.fromEntries(ANALYST_ITEM_PROPERTY_NAMES.map((name) => [name, { type: "string" }])) as Record<AnalystItemPropertyName, { readonly type: "string" }>;
export const ANALYST_WIRE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "items"],
  properties: {
    schemaVersion: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...ANALYST_ITEM_PROPERTY_NAMES],
        properties: analystItemProperties,
      },
    },
  },
} as const;

export const ANALYST_WIRE_TOOL = {
  name: BILL_ANALYST_TOOL_NAME,
  description: "Estrai fatti analyst e righe economiche. Tutti i campi sono stringhe; usa stringa vuota quando non applicabile. Il catalogo code viene normalizzato server-side.",
  strict: true,
  input_schema: ANALYST_WIRE_SCHEMA,
} as const;

export const ANALYST_STAGE_PROMPT = [
  "Scansiona l'intero documento.",
  "Leggi l'intero documento e cerca la classificazione effettiva della fornitura.",
  "Non dedurre la residenza da nome, codice fiscale, indirizzo, potenza o tipo di cliente.",
  "Se il documento riporta diciture come domestico residente, domestico non residente, altri usi o altra classificazione equivalente, restituisci esattamente il testo trovato.",
  "Cerca esplicitamente la sezione con caratteristiche tecniche, dati della fornitura, tipologia cliente, uso della fornitura o diciture equivalenti.",
  "Conserva il testo documentale originale nei value; non trasformare RESIDENTIAL in residente.",
  "Per i campi di classificazione usa i code *_RAW e restituisci il testo esatto trovato.",
  "Restituisci un item per ogni fatto documentale trovato e una riga CHARGE per ogni componente economica trovata.",
  `Usa questo catalogo solo come guida di normalizzazione: ${BILL_ANALYST_ITEM_CODES.join(", ")}. Non filtrare né scartare voci economiche perché il codice non è presente; per ogni corrispettivo distinto conserva descrizione e valori originali e assegna un code testuale descrittivo.`,
  "Usa kind FACT per i fatti e kind CHARGE per le righe economiche.",
  "Distingui i prezzi PUN_SINGLE/PUN_F1/PUN_F2/PUN_F3 dai consumi F1/F2/F3, che sono kWh.",
  "Per ogni CHARGE conserva label originale, value, quantity, unit, unitPrice, amount e periodo raw.",
  "Restituisci ogni voce economica distinta realmente esposta, anche se il code non è nel catalogo: conserva la descrizione originale e usa un code descrittivo; il server classifica gli elementi sconosciuti come UNCLASSIFIED_BILL_CHARGE.",
  "Usa FOUND solo con evidenza esplicita, NEEDS_REVIEW quando l'evidenza è ambigua e UNKNOWN o INVALID quando il dato non è classificabile o è presente ma inutilizzabile.",
].join(" ");

export class BillAnalystWireValidationError extends Error {
  readonly code = "BILL_ANALYST_WIRE_VALIDATION_FAILED";
  readonly fieldPath: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`BILL_ANALYST_WIRE_VALIDATION_FAILED:${path}:${reason}`);
    this.name = "BillAnalystWireValidationError";
    this.fieldPath = path;
    this.reason = reason;
  }
}

const isRecord = (value: unknown): value is SchemaRecord => typeof value === "object" && value !== null && !Array.isArray(value);

function object(value: unknown, path: string): SchemaRecord {
  if (!isRecord(value)) throw new BillAnalystWireValidationError(path, "OBJECT_REQUIRED");
  return value;
}

export function validateBillCoreWireExtraction(value: unknown): asserts value is BillWireExtraction {
  if (!isRecord(value) || Object.hasOwn(value, "analystItems")) throw new BillWireValidationError("root", "CORE_ONLY_REQUIRED");
  parseBillWireExtraction(value);
}

export function parseBillCoreWireExtraction(value: unknown): BillWireExtraction {
  validateBillCoreWireExtraction(value);
  return value;
}

export function validateBillAnalystWireExtraction(value: unknown): asserts value is BillAnalystWireExtraction {
  const root = object(value, "root");
  if (typeof root.schemaVersion !== "string" || !/^1(?:\.0+)?$/.test(root.schemaVersion.trim())) throw new BillAnalystWireValidationError("schemaVersion", "VERSION");
  for (const key of Object.keys(root)) if (key !== "schemaVersion" && key !== "items") throw new BillAnalystWireValidationError(key, "UNEXPECTED_PROPERTY");
  if (!Array.isArray(root.items)) throw new BillAnalystWireValidationError("items", "ARRAY_REQUIRED");
  for (const [index, rawItem] of root.items.entries()) {
    const item = object(rawItem, `items.${index}`);
    for (const key of ANALYST_ITEM_PROPERTY_NAMES) {
      if (!(key in item)) throw new BillAnalystWireValidationError(`items.${index}.${key}`, "REQUIRED");
      if (typeof item[key] !== "string") throw new BillAnalystWireValidationError(`items.${index}.${key}`, "STRING_REQUIRED");
    }
    for (const key of Object.keys(item)) if (!(ANALYST_ITEM_PROPERTY_NAMES as readonly string[]).includes(key)) throw new BillAnalystWireValidationError(`items.${index}.${key}`, "UNEXPECTED_PROPERTY");
  }
}

export function parseBillAnalystWireExtraction(value: unknown): BillAnalystWireExtraction {
  validateBillAnalystWireExtraction(value);
  return value;
}

export interface BillTwoStageSchemaMetrics {
  readonly properties: number;
  readonly bytes: number;
  readonly objects: number;
  readonly arrays: number;
  readonly enumValues: number;
  readonly optional: number;
  readonly unions: number;
  readonly maxDepth: number;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function schemaMetrics(schema: unknown): BillTwoStageSchemaMetrics {
  const metrics = { properties: 0, bytes: utf8Bytes(JSON.stringify(schema)), objects: 0, arrays: 0, enumValues: 0, optional: 0, unions: 0, maxDepth: 0 };
  const walk = (value: unknown, depth: number): void => {
    if (!isRecord(value)) return;
    metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    if (value.type === "object") metrics.objects += 1;
    if (value.type === "array") metrics.arrays += 1;
    if (Array.isArray(value.enum)) metrics.enumValues += value.enum.length;
    if (Array.isArray(value.required) && isRecord(value.properties)) {
      const required = new Set(value.required.filter((item): item is string => typeof item === "string"));
      metrics.optional += Object.keys(value.properties).filter((key) => !required.has(key)).length;
    }
    if (isRecord(value.properties)) {
      metrics.properties += Object.keys(value.properties).length;
      for (const child of Object.values(value.properties)) walk(child, depth + 1);
    }
    if (value.items) walk(value.items, depth + 1);
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(value[key])) metrics.unions += 1;
  };
  walk(schema, 1);
  return metrics;
}

export const CORE_SCHEMA_METRICS = schemaMetrics(CORE_WIRE_SCHEMA);
export const ANALYST_SCHEMA_METRICS = schemaMetrics(ANALYST_WIRE_SCHEMA);

function normalizeKind(value: string): "FACT" | "CHARGE" {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z]+/g, "_");
  return normalized === "CHARGE" || normalized === "CHARGE_LINE" ? "CHARGE" : "FACT";
}

function normalizeStatus(value: string): BillWireStatus {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z]+/g, "_");
  return normalized === "FOUND" || normalized === "NOT_FOUND" || normalized === "NEEDS_REVIEW" || normalized === "INVALID" ? normalized : "INVALID";
}

export function normalizeAnalystUnit(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.replace(/^€\s*\//, "EUR/").replace(/€/g, "EUR").replace(/\b(kwh|kw|smc|m3|v|eur)\b/gi, (unit) => unit.toUpperCase());
}

function normalizeAnalystItem(item: BillAnalystWireItem): BillAnalystWireItem & { readonly normalizedKind: "FACT" | "CHARGE"; readonly normalizedCode: BillAnalystItemCode; readonly normalizedStatus: BillWireStatus; readonly normalizedUnit: string } {
  return {
    ...item,
    normalizedKind: normalizeKind(item.kind),
    normalizedCode: normalizeAnalystItemCode(item.code),
    normalizedStatus: normalizeStatus(item.status),
    normalizedUnit: normalizeAnalystUnit(item.unit),
  };
}

function documentField<T>(value: T | null, status: BillWireStatus): StructuredBillField<T> {
  return { value, status, confidence: status === "FOUND" ? 0.9 : status === "NEEDS_REVIEW" ? 0.5 : 0, source: "DOCUMENT_AI" };
}

function parsePeriod(value: string): StructuredBillPeriod | null {
  const raw = value.trim();
  const monthNames: Readonly<Record<string, number>> = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
  const monthOnly = /^(?:(\d{1,2})[/. -](\d{4})|([a-zàèéìòù]+)\s+(\d{4}))$/i.exec(raw);
  const date = (candidateRaw: string): string | null => {
    const candidate = candidateRaw.trim();
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(candidate);
    const italian = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.exec(candidate);
    const year = iso ? Number(iso[1]) : italian ? Number(italian[3]) : NaN;
    const month = iso ? Number(iso[2]) : italian ? Number(italian[2]) : NaN;
    const day = iso ? Number(iso[3]) : italian ? Number(italian[1]) : NaN;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed.toISOString().slice(0, 10) : null;
  };
  if (monthOnly) {
    const month = monthOnly[1] ? Number(monthOnly[1]) : monthNames[monthOnly[3].toLowerCase()];
    const year = Number(monthOnly[2] ?? monthOnly[4]);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) return null;
    const from = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
    const to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    return { from, to, raw };
  }
  const range = /^(?:dal\s+)?(.+?)\s+(?:-|al|a)\s+(.+)$/i.exec(raw);
  if (!range) return null;
  const from = date(range[1]);
  const to = date(range[2]);
  return from && to && from < to ? { from, to, raw } : null;
}

export function mapBillCoreToStructuredBill(core: BillWireExtraction): StructuredBillExtraction {
  validateBillCoreWireExtraction(core);
  const extraction = mapBillWireToStructuredBill(core);
  return { ...extraction, analystExtractionStatus: "NOT_RUN" };
}

export function mapBillAnalystItems(analyst: BillAnalystWireExtraction): { readonly facts: readonly StructuredBillExtendedFact[]; readonly charges: readonly StructuredBillEconomicChargeLine[] } {
  validateBillAnalystWireExtraction(analyst);
  const facts: StructuredBillExtendedFact[] = [];
  const charges: StructuredBillEconomicChargeLine[] = [];
  for (const source of analyst.items) {
    const item = normalizeAnalystItem(source);
    if (item.normalizedKind === "CHARGE") {
      const code = BILL_ECONOMIC_CHARGE_CODES.includes(item.normalizedCode as BillEconomicChargeLineCode) ? item.normalizedCode as BillEconomicChargeLineCode : "UNKNOWN";
      const raw = normalizeBillEconomicComponent({ code: source.code, description: item.label, value: source.value, unit: item.normalizedUnit, quantity: item.quantity, unitPrice: item.unitPrice, amount: item.amount.trim() || item.value.trim(), period: item.period, status: item.normalizedStatus });
      charges.push({ code, description: raw.description, quantity: raw.quantity ?? "", unit: raw.unit ?? "", unitPrice: raw.unitPrice ?? "", amount: raw.amount ?? "", periodRaw: raw.period ?? "", classification: raw.classification, rawDescription: raw.rawDescription, rawValue: raw.rawValue, rawUnit: raw.rawUnit, rawQuantity: raw.rawQuantity, rawUnitPrice: raw.rawUnitPrice, rawAmount: raw.rawAmount, rawPeriod: raw.rawPeriod, documentEvidence: raw.documentEvidence, calculationCheck: raw.calculationCheck, status: item.normalizedStatus });
    } else {
      facts.push({ code: item.normalizedCode, value: item.value.trim(), ...(item.normalizedUnit ? { unit: item.normalizedUnit } : {}), status: item.normalizedStatus });
    }
  }
  return { facts, charges };
}

export const ANALYST_OWNED_PROPERTIES = ["extendedFacts", "economicChargeLines", "supplyProfile", "analystExtractionStatus", "analystDiagnostic"] as const;

/** Remove every previous Analyst result while preserving the authoritative CORE fields. */
export function stripBillAnalystData(extraction: StructuredBillExtraction): StructuredBillExtraction {
  validateStructuredBillExtraction(extraction);
  const { extendedFacts, economicChargeLines, supplyProfile, analystExtractionStatus, analystDiagnostic, ...core } = extraction;
  void extendedFacts;
  void economicChargeLines;
  void supplyProfile;
  void analystExtractionStatus;
  void analystDiagnostic;
  const cleanCore: StructuredBillExtraction = { ...core, extendedFacts: [], economicChargeLines: [] };
  validateStructuredBillExtraction(cleanCore);
  return cleanCore;
}

export function mergeBillCoreAndAnalyst(core: StructuredBillExtraction, analyst: BillAnalystWireExtraction | null, options: { readonly analystExtractionStatus?: "NOT_RUN" | "EXTRACTED" | "FAILED"; readonly diagnostic?: StructuredBillExtraction["analystDiagnostic"] } = {}): StructuredBillExtraction {
  const cleanCore = stripBillAnalystData(core);
  if (!analyst) return { ...cleanCore, analystExtractionStatus: options.analystExtractionStatus ?? "NOT_RUN", ...(options.diagnostic ? { analystDiagnostic: options.diagnostic } : {}) };
  const mapped = mapBillAnalystItems(analyst);
  let billingPeriod = cleanCore.billingPeriod;
  const raw = mapped.facts.find((fact) => fact.code === "BILLING_PERIOD_RAW" && fact.value.trim());
  if (billingPeriod.status !== "FOUND" && raw) {
    const parsed = parsePeriod(raw.value);
    billingPeriod = parsed ? documentField<StructuredBillPeriod>(parsed, raw.status) : documentField<StructuredBillPeriod>(null, raw.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "INVALID");
  }
  const merged: StructuredBillExtraction = {
    ...cleanCore,
    billingPeriod,
    extendedFacts: [...mapped.facts],
    economicChargeLines: [...mapped.charges],
    supplyProfile: buildBillSupplyProfile(mapped.facts),
    analystExtractionStatus: options.analystExtractionStatus ?? "EXTRACTED",
    ...(options.diagnostic ? { analystDiagnostic: options.diagnostic } : {}),
  };
  validateStructuredBillExtraction(merged);
  return merged;
}
