import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const REAL_DIAG_4_SCHEMA_VERSION = 1 as const;
export const REAL_DIAG_4_RELATIVE_ROOT = path.join("var", "diagnostics", "real-diag-4");
export const REAL_DIAG_4_MAX_FILE_BYTES = 32_768;
export const REAL_DIAG_4_MAX_ITEMS = 128;
export const REAL_DIAG_4_MAX_PATHS = 64;

export type RealDiag4BillStage = "CORE" | "ANALYST";

export interface BillStageShapeDiagnostic {
  readonly schemaVersion: typeof REAL_DIAG_4_SCHEMA_VERSION;
  readonly stage: RealDiag4BillStage;
  readonly toolName: string;
  readonly topLevelKeys: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
  readonly periodBands: Readonly<Record<string, unknown>>;
  readonly monthly: {
    readonly present: boolean;
    readonly monthKeys: readonly string[];
    readonly structureKeys: readonly string[];
  };
  readonly items?: readonly Readonly<Record<string, unknown>>[];
}

export interface CteValidationDiagnosticIssue {
  readonly path: string;
  readonly code: string;
  readonly expected: string;
  readonly receivedType: string;
  readonly receivedShape: string;
}

export interface CteShapeDiagnostic {
  readonly schemaVersion: typeof REAL_DIAG_4_SCHEMA_VERSION;
  readonly toolName: string | null;
  readonly topLevelKeys: readonly string[];
  readonly nestedKeyPaths: readonly string[];
  readonly primitiveTypes: Readonly<Record<string, string>>;
  readonly arrayLengths: Readonly<Record<string, number>>;
  readonly enumValues: Readonly<Record<string, readonly string[]>>;
  readonly contentBlockTypes: readonly string[];
  readonly toolInputIsObject: boolean;
  readonly toolInputFieldShapes: readonly Readonly<Record<string, unknown>>[];
}

export interface CteValidationDiagnostic {
  readonly schemaVersion: typeof REAL_DIAG_4_SCHEMA_VERSION;
  readonly toolName: string | null;
  readonly errorCode: string | null;
  readonly issues: readonly CteValidationDiagnosticIssue[];
}

export interface CteDiagnosticCapture {
  readonly shape: CteShapeDiagnostic;
  readonly validation: CteValidationDiagnostic;
}

const BILL_CORE_DIAGNOSTIC_FIELDS = ["billingPeriod", "annualConsumption", "billedConsumption", "totalAmount", "f1Consumption", "f2Consumption", "f3Consumption"] as const;
const SAFE_STATUSES = new Set(["FOUND", "NOT_FOUND", "INVALID", "NEEDS_REVIEW", "CONFIRMED", "UNCERTAIN", "CORRECTED"]);
const SAFE_ENUM_KEYS = new Set(["schemaVersion", "documentType", "vector", "status", "path", "kind", "unit"]);

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function safeKey(value: string): string {
  return /^[A-Za-z0-9_.:[\]-]{1,120}$/.test(value) ? value : "[REDACTED_KEY]";
}

function safeToken(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.:[\]-]{1,120}$/.test(value) ? value : "REDACTED";
}

function numericValues(value: unknown, enabled: boolean): readonly number[] {
  if (!enabled) return [];
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value !== "string") return [];
  const matches = value.match(/[+-]?\d+(?:[.,]\d+)?/g) ?? [];
  return matches.slice(0, 8).map((item) => Number(item.replace(",", "."))).filter((item) => Number.isFinite(item));
}

function monthKeys(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.match(/\b20\d{2}-(?:0[1-9]|1[0-2])\b/g) ?? [])].slice(0, 12);
}

function dateLikeValues(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.match(/\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]20\d{2})\b/g) ?? [])].slice(0, 8).map(() => "DATE_LIKE");
}

function fieldShape(name: string, value: unknown): Readonly<Record<string, unknown>> {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const raw = item?.value ?? value;
  const status = typeof item?.status === "string" && SAFE_STATUSES.has(item.status) ? item.status : undefined;
  return {
    valueType: valueType(raw),
    ...(status ? { status } : {}),
    ...(name === "billingPeriod" ? { dateLikeValues: dateLikeValues(raw), monthKeys: monthKeys(raw) } : {}),
    ...(/(?:Consumption|totalAmount|annualConsumption)/i.test(name) ? { numericValues: numericValues(raw, true) } : {}),
  };
}

function collectObjectShape(value: unknown, prefix = "", paths: string[] = [], arrays: Record<string, number> = {}, enums: Record<string, string[]> = {}): void {
  if (paths.length >= REAL_DIAG_4_MAX_PATHS) return;
  if (Array.isArray(value)) {
    arrays[prefix || "$"] = Math.min(value.length, REAL_DIAG_4_MAX_ITEMS);
    value.slice(0, REAL_DIAG_4_MAX_ITEMS).forEach((item, index) => collectObjectShape(item, `${prefix}[${index}]`, paths, arrays, enums));
    return;
  }
  if (value === null || typeof value !== "object") {
    const pathName = prefix || "$";
    paths.push(pathName);
    const key = prefix.split(/[.[]/).at(-1)?.replace(/\]$/, "") ?? "";
    if (SAFE_ENUM_KEYS.has(key) && typeof value === "string") (enums[key] ??= []).push(safeToken(value));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (paths.length >= REAL_DIAG_4_MAX_PATHS) break;
    collectObjectShape(child, prefix ? `${prefix}.${safeKey(key)}` : safeKey(key), paths, arrays, enums);
  }
}

function nestedShape(value: unknown): Pick<CteShapeDiagnostic, "nestedKeyPaths" | "primitiveTypes" | "arrayLengths" | "enumValues"> {
  const nestedKeyPaths: string[] = [];
  const arrays: Record<string, number> = {};
  const enumValues: Record<string, string[]> = {};
  collectObjectShape(value, "", nestedKeyPaths, arrays, enumValues);
  const primitiveTypes: Record<string, string> = {};
  const visit = (candidate: unknown, prefix = ""): void => {
    if (Object.keys(primitiveTypes).length >= REAL_DIAG_4_MAX_PATHS) return;
    if (Array.isArray(candidate)) return candidate.slice(0, REAL_DIAG_4_MAX_ITEMS).forEach((item, index) => visit(item, `${prefix}[${index}]`));
    if (candidate === null || typeof candidate !== "object") { primitiveTypes[prefix || "$" ] = valueType(candidate); return; }
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) visit(child, prefix ? `${prefix}.${safeKey(key)}` : safeKey(key));
  };
  visit(value);
  return { nestedKeyPaths: nestedKeyPaths.slice(0, REAL_DIAG_4_MAX_PATHS), primitiveTypes, arrayLengths: arrays, enumValues: Object.fromEntries(Object.entries(enumValues).map(([key, values]) => [key, [...new Set(values)].slice(0, 16)])) };
}

export function buildBillStageShapeDiagnostic(stage: RealDiag4BillStage, toolName: string, input: unknown): BillStageShapeDiagnostic {
  const object = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const topLevelKeys = Object.keys(object).slice(0, REAL_DIAG_4_MAX_ITEMS).map(safeKey);
  const fields: Record<string, unknown> = {};
  for (const name of BILL_CORE_DIAGNOSTIC_FIELDS) if (name in object) fields[name] = fieldShape(name, object[name]);
  const periodBands: Record<string, unknown> = {};
  for (const name of ["f1Consumption", "f2Consumption", "f3Consumption"] as const) if (name in object) periodBands[name] = fieldShape(name, object[name]);
  const analystItems = Array.isArray(object.items) ? object.items : [];
  const items = stage === "ANALYST" ? analystItems.slice(0, REAL_DIAG_4_MAX_ITEMS).map((candidate) => {
    const item = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
    const code = safeToken(item.code);
    const relevant = /(?:CONSUMPTION|BAND|TOTAL|ANNUAL|MONTH|F[123])/i.test(code);
    const itemMonthKeys = [...new Set([...monthKeys(item.period), ...monthKeys(item.value)])].slice(0, 12);
    const bandKeys = [...new Set((code.match(/F[123]/gi) ?? []).map((value) => value.toUpperCase()))].slice(0, 3);
    return { kind: safeToken(item.kind), code, valueType: valueType(item.value), ...(typeof item.status === "string" && SAFE_STATUSES.has(item.status) ? { status: item.status } : {}), ...(typeof item.unit === "string" ? { unit: safeToken(item.unit) } : {}), periodMonthKeys: monthKeys(item.period), valueMonthKeys: monthKeys(item.value), monthKeys: itemMonthKeys, bandKeys, numericValues: numericValues(item.value, relevant), dateLikeValues: dateLikeValues(item.period) };
  }) : undefined;
  const monthlyKeys = [...new Set([...(topLevelKeys.filter((key) => /(?:month|monthly)/i.test(key))), ...((items ?? []).flatMap((item) => item.monthKeys))])].slice(0, 12);
  const monthlyStructureKeys = [...new Set([...(topLevelKeys.filter((key) => /(?:month|monthly|breakdown)/i.test(key))), ...((items ?? []).filter((item) => /(?:MONTH|MONTHLY)/i.test(item.code)).map((item) => item.code))])].slice(0, 24);
  return { schemaVersion: REAL_DIAG_4_SCHEMA_VERSION, stage, toolName: safeToken(toolName), topLevelKeys, fields, periodBands, monthly: { present: monthlyKeys.length > 0 && ((items ?? []).some((item) => item.bandKeys.length > 0) || monthlyStructureKeys.length > 0), monthKeys: monthlyKeys, structureKeys: monthlyStructureKeys }, ...(items ? { items } : {}) };
}

function expectedForValidationCode(code: string): string {
  if (code === "REQUIRED") return "property present";
  if (code === "UNEXPECTED_PROPERTY") return "allowlisted property";
  if (code === "ENUM") return "allowlisted enum value";
  if (code === "OBJECT") return "object";
  if (code === "ARRAY_MIN_ITEMS") return "array with at least one item";
  if (code === "TYPE") return "expected primitive type";
  if (code === "RANGE") return "finite number in [0,1]";
  if (code === "NOT_FOUND_REQUIRES_NULL") return "null value";
  if (code === "STRUCTURED_COMPONENT") return "array of objects";
  return "schema-valid value";
}

function valueAtPath(root: unknown, pathName: string): unknown {
  if (!pathName) return root;
  let current: unknown = root;
  for (const token of pathName.match(/[^.\[\]]+|\[\d+\]/g) ?? []) {
    if (token.startsWith("[")) current = Array.isArray(current) ? current[Number(token.slice(1, -1))] : undefined;
    else current = current && typeof current === "object" ? (current as Record<string, unknown>)[token] : undefined;
  }
  return current;
}

function receivedShape(value: unknown): string {
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return `array length=${Math.min(value.length, REAL_DIAG_4_MAX_ITEMS)}`;
  if (typeof value === "string") return `string length=${Math.min(value.length, 500)}`;
  if (value && typeof value === "object") return `object keys=${Math.min(Object.keys(value).length, REAL_DIAG_4_MAX_ITEMS)}`;
  return valueType(value);
}

function semanticTags(value: unknown, depth = 0): readonly string[] {
  if (depth > 3) return [];
  if (Array.isArray(value)) return [...new Set(value.slice(0, REAL_DIAG_4_MAX_ITEMS).flatMap((item) => semanticTags(item, depth + 1)))];
  if (value && typeof value === "object") return [...new Set(Object.values(value as Record<string, unknown>).slice(0, REAL_DIAG_4_MAX_ITEMS).flatMap((item) => semanticTags(item, depth + 1)))];
  if (typeof value !== "string") return [];
  const tags: string[] = [];
  if (/loss|perdit|network|rete|gross|lordo/i.test(value)) tags.push("LOSS_SEMANTICS");
  if (/monthly|month|mensil|luglio|agosto|january|february|march|april|may|june|july|august/i.test(value)) tags.push("MONTHLY_SEMANTICS");
  return tags;
}

export function buildCteDiagnosticCapture(body: unknown, error: { readonly code?: unknown; readonly issuePaths?: readonly string[]; readonly issueCodes?: readonly string[] } | null = null): CteDiagnosticCapture {
  const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const content = Array.isArray(root.content) ? root.content : [];
  const tool = content.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).type === "tool_use") as Record<string, unknown> | undefined;
  const toolInput = tool?.input;
  const toolInputFields = toolInput && typeof toolInput === "object" && !Array.isArray(toolInput) && Array.isArray((toolInput as Record<string, unknown>).fields)
    ? ((toolInput as Record<string, unknown>).fields as readonly unknown[]).slice(0, REAL_DIAG_4_MAX_ITEMS)
    : [];
  const toolInputFieldShapes = toolInputFields.map((field) => {
    const item = field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : {};
    const fieldPath = typeof item.path === "string" ? safeToken(item.path) : "MISSING";
    return { path: fieldPath, valueType: valueType(item.value), valueShape: receivedShape(item.value), semanticTags: [...new Set([...semanticTags(fieldPath), ...semanticTags(item.value), ...semanticTags(item.sourceText)])] };
  });
  const shapeData = nestedShape(body);
  const shape: CteShapeDiagnostic = { schemaVersion: REAL_DIAG_4_SCHEMA_VERSION, toolName: typeof tool?.name === "string" ? safeToken(tool.name) : null, topLevelKeys: Object.keys(root).slice(0, REAL_DIAG_4_MAX_ITEMS).map(safeKey), nestedKeyPaths: shapeData.nestedKeyPaths, primitiveTypes: shapeData.primitiveTypes, arrayLengths: shapeData.arrayLengths, enumValues: shapeData.enumValues, contentBlockTypes: content.slice(0, REAL_DIAG_4_MAX_ITEMS).map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).type === "string" ? safeToken((item as Record<string, unknown>).type) : "unknown"), toolInputIsObject: Boolean(toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)), toolInputFieldShapes };
  const paths = error?.issuePaths ?? [];
  const codes = error?.issueCodes ?? [];
  const issues = paths.slice(0, REAL_DIAG_4_MAX_PATHS).map((pathName, index) => {
    const code = typeof codes[index] === "string" ? codes[index] : "UNKNOWN";
    const received = valueAtPath(toolInput, pathName);
    return { path: safeKey(pathName), code: safeToken(code), expected: expectedForValidationCode(code), receivedType: valueType(received), receivedShape: receivedShape(received) };
  });
  return { shape, validation: { schemaVersion: REAL_DIAG_4_SCHEMA_VERSION, toolName: shape.toolName, errorCode: typeof error?.code === "string" ? safeToken(error.code) : null, issues } };
}

function localDiagnosticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const local = env.FOUNDATION_LOCAL_DEV?.trim().toLowerCase();
  return env.REAL_DIAG_4_ENABLED?.trim().toLowerCase() === "true" && (local === "true" || local === "1");
}

function safeFileName(fileName: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,119}\.json$/i.test(fileName) || fileName.includes("..")) throw new Error("REAL_DIAG_4_FILE_NAME_INVALID");
  return fileName;
}

export async function writeRealDiag4Json(fileName: string, payload: unknown, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!localDiagnosticEnabled(env)) return false;
  const safeName = safeFileName(fileName);
  const serialized = JSON.stringify(payload);
  if (serialized.length > REAL_DIAG_4_MAX_FILE_BYTES) throw new Error("REAL_DIAG_4_OUTPUT_TOO_LARGE");
  const root = path.resolve(process.cwd(), REAL_DIAG_4_RELATIVE_ROOT);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, safeName), serialized + "\n", { encoding: "utf8", flag: "wx" });
  return true;
}

export function realDiag4Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return localDiagnosticEnabled(env);
}
