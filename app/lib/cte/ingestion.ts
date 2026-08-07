import { randomUUID } from "node:crypto";
import type { CteContract } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateCteContract } from "./validation.ts";
import type { DocumentStoragePort } from "../foundation/real-bill";
import type { DeletableTenantRecordRepository, TenantRecord } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createAnthropicCteOcrProvider } from "./anthropic.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { cteApprovalGate, normalizeCteReview, tryBuildAuthoritativeCteContract } from "./review.ts";
import type { CteApprovedSnapshot } from "./approved-snapshot";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createCteApprovedSnapshot } from "./approved-snapshot.ts";

export const CTE_INGESTION_SCHEMA_VERSION = 1 as const;
export const CTE_MAX_DOCUMENT_BYTES = 10_000_000;
export const CTE_ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type CteDocumentContentType = typeof CTE_ALLOWED_CONTENT_TYPES[number];
export type CteIngestionStatus = "UPLOADED" | "OCR_PROCESSING" | "EXTRACTION_PROCESSING" | "REVIEW_REQUIRED" | "PROVIDER_NOT_CONFIGURED" | "FAILED" | "APPROVED";
export type CteExtractionFieldStatus = "CONFIRMED" | "UNCERTAIN" | "NOT_FOUND" | "CORRECTED";
export type CteExtractionValue = string | number | null;

export interface CteExtractionField {
  readonly path: string;
  readonly value: CteExtractionValue;
  readonly confidence: number;
  readonly sourcePage: number | null;
  readonly sourceText: string | null;
  readonly status: CteExtractionFieldStatus;
}

export interface CteProviderDiagnostics {
  readonly model: string;
  readonly httpStatus: number | null;
  readonly stopReason: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly contentBlockTypes: readonly string[];
  readonly toolName: string | null;
  readonly internalErrorCode: string | null;
}

export interface CteIngestionAttempt {
  readonly attemptId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fromStatus: CteIngestionStatus;
  readonly toStatus: CteIngestionStatus;
  readonly outcome: "SUCCEEDED" | "FAILED" | "PROVIDER_NOT_CONFIGURED";
  readonly errorCode: string | null;
  readonly providerDiagnostics: CteProviderDiagnostics | null;
}

export interface CteProviderExtraction {
  readonly schemaVersion: typeof CTE_INGESTION_SCHEMA_VERSION;
  readonly documentType: "CTE" | "UNKNOWN";
  readonly vector: "EE" | "GAS" | "UNKNOWN";
  readonly fields: readonly CteExtractionField[];
  readonly extractionNotes?: readonly string[];
  readonly contractCandidate?: unknown;
  readonly providerDiagnostics?: CteProviderDiagnostics;
}

export interface CteCorrection {
  readonly version: number;
  readonly fieldPath: string;
  readonly previousValue: CteExtractionValue;
  readonly nextValue: CteExtractionValue;
  readonly actor: string;
  readonly correctedAt: string;
}

export interface CteIngestionRecord {
  readonly schemaVersion: typeof CTE_INGESTION_SCHEMA_VERSION;
  readonly ingestionId: string;
  readonly documentId: string;
  readonly objectKey: string;
  readonly fileName: string;
  readonly contentType: CteDocumentContentType;
  readonly size: number;
  readonly status: CteIngestionStatus;
  readonly documentType: "CTE" | "UNKNOWN";
  readonly vector: "EE" | "GAS" | "UNKNOWN";
  readonly fields: readonly CteExtractionField[];
  readonly extractionNotes: readonly string[];
  readonly candidate: CteContract | null;
  readonly reviewedCandidate: CteContract | null;
  readonly corrections: readonly CteCorrection[];
  readonly errorCode: string | null;
  readonly providerDiagnostics: CteProviderDiagnostics | null;
  readonly attempts: readonly CteIngestionAttempt[];
  readonly approvedArchiveId: string | null;
  readonly approvedSnapshot: CteApprovedSnapshot | null;
}

export type CteIngestionRepository = DeletableTenantRecordRepository<CteIngestionRecord>;
export type CteProviderConfigurationError = "CTE_OCR_PROVIDER_NOT_CONFIGURED" | "ANTHROPIC_API_KEY_MISSING" | "ANTHROPIC_MODEL_MISSING" | "ANTHROPIC_CTE_MAX_TOKENS_INVALID";

export interface CteOcrProvider {
  extract(input: { readonly bytes: Uint8Array; readonly contentType: CteDocumentContentType; readonly fileName: string }): Promise<CteProviderExtraction>;
}

const commonFieldPaths = [
  "documentType", "vector", "supplier.name", "supplier.supplierId", "offer.name", "offer.code",
  "validity.periodStart", "validity.periodEnd", "expiry.date", "eligibility.customerTypes",
  "pricing.mode", "currency", "taxTreatment", "commercialTerms.fixedFees", "commercialTerms.variableFees",
  "commercialTerms.oneOffFees", "commercialTerms.commercialDiscounts", "commercialTerms.imbalance",
] as const;
const eeFieldPaths = ["eligibility.voltageLevels", "pricing.reference", "pricing.spread.amount"] as const;
const gasFieldPaths = ["pricing.reference", "pricing.spread.amount"] as const;
const correctionPaths = new Set([
  "supplier.name", "supplier.supplierId", "offer.name", "offer.code", "validity.periodStart", "validity.periodEnd",
  "expiry.date", "pricing.spread.amount", "pricing.fixedPrice.amount", "commercialTerms.fixedFees[0].amount",
  "commercialTerms.variableFees[0].amount", "commercialTerms.imbalance.component.amount",
]);

function fail(code: string): never { throw new Error(code); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeFileName(value: string): string { if (!value || value.length > 180 || /[\0\r\n\\/]/.test(value)) fail("CTE_FILE_NAME_INVALID"); return value; }
function validContentType(value: string): value is CteDocumentContentType { return (CTE_ALLOWED_CONTENT_TYPES as readonly string[]).includes(value); }
function signatureMatches(contentType: CteDocumentContentType, bytes: Uint8Array): boolean {
  if (contentType === "application/pdf") return bytes.length >= 5 && new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-";
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

export function validateCteUpload(input: { readonly fileName: string; readonly contentType: string; readonly bytes: Uint8Array; readonly maxBytes?: number }): CteDocumentContentType {
  const contentType = input.contentType;
  const maxBytes = input.maxBytes ?? CTE_MAX_DOCUMENT_BYTES;
  if (!validContentType(contentType)) fail("CTE_FILE_TYPE_UNSUPPORTED");
  safeFileName(input.fileName);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) fail("CTE_FILE_TOO_LARGE");
  if (!signatureMatches(contentType, input.bytes)) fail("CTE_FILE_SIGNATURE_INVALID");
  return contentType;
}

function sourcePage(value: unknown): number | null { return value === null ? null : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fail("CTE_EXTRACTION_SCHEMA_INVALID"); }
function sourceText(value: unknown): string | null { return value === null ? null : typeof value === "string" && value.length <= 500 ? value : fail("CTE_EXTRACTION_SCHEMA_INVALID"); }
function extractionField(value: unknown): CteExtractionField {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length < 1 || value.path.length > 120) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  if (!(value.value === null || typeof value.value === "string" || typeof value.value === "number" && Number.isFinite(value.value))) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  const status = value.status === "CONFIRMED" || value.status === "UNCERTAIN" || value.status === "NOT_FOUND" || value.status === "CORRECTED" ? value.status : value.value === null ? "NOT_FOUND" : value.confidence < 0.8 ? "UNCERTAIN" : "CONFIRMED";
  if (status === "NOT_FOUND" && value.value !== null) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  return { path: value.path, value: value.value, confidence: value.confidence, sourcePage: sourcePage(value.sourcePage), sourceText: sourceText(value.sourceText), status };
}

function extractionNotes(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== "string" || item.length > 500)) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  return value as readonly string[];
}

function expectedPaths(vector: "EE" | "GAS" | "UNKNOWN"): readonly string[] {
  return vector === "EE" ? [...commonFieldPaths, ...eeFieldPaths] : vector === "GAS" ? [...commonFieldPaths, ...gasFieldPaths] : [...commonFieldPaths];
}

function emptyExtractionFields(vector: "EE" | "GAS" | "UNKNOWN"): readonly CteExtractionField[] {
  return expectedPaths(vector).map((path) => ({ path, value: null, confidence: 0, sourcePage: null, sourceText: null, status: "NOT_FOUND" as const }));
}

function ensureVectorSeparation(vector: "EE" | "GAS" | "UNKNOWN", fields: readonly CteExtractionField[], candidate: CteContract | null): void {
  const reference = fields.find((field) => field.path === "pricing.reference")?.value;
  if (vector === "EE" && reference === "PSV" || vector === "GAS" && reference === "PUN") fail("CTE_VECTOR_FIELD_MIXED");
  if (candidate) {
    if (candidate.vector !== vector) fail("CTE_VECTOR_MISMATCH");
    if (candidate.vector === "EE" && candidate.pricing.reference !== "PUN" || candidate.vector === "GAS" && candidate.pricing.reference !== "PSV") fail("CTE_VECTOR_FIELD_MIXED");
  }
}

function bindCandidate(value: unknown, tenantId: string, vector: "EE" | "GAS" | "UNKNOWN"): CteContract | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || (vector !== "UNKNOWN" && value.vector !== vector)) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  const candidate = structuredClone(value) as Record<string, unknown>;
  candidate.tenantId = tenantId;
  candidate.approval = { status: "DRAFT", reason: "CTE_OCR_REVIEW_REQUIRED" };
  try { validateCteContract(candidate); } catch { fail("CTE_EXTRACTION_CONTRACT_INVALID"); }
  return candidate as unknown as CteContract;
}

export function normalizeProviderExtraction(value: unknown, tenantId: string): { readonly documentType: "CTE" | "UNKNOWN"; readonly vector: "EE" | "GAS" | "UNKNOWN"; readonly fields: readonly CteExtractionField[]; readonly extractionNotes: readonly string[]; readonly candidate: CteContract | null } {
  if (!isRecord(value) || value.schemaVersion !== CTE_INGESTION_SCHEMA_VERSION) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  const documentType = value.documentType === "CTE" || value.documentType === "UNKNOWN" ? value.documentType : fail("CTE_EXTRACTION_SCHEMA_INVALID");
  const vector = value.vector === "EE" || value.vector === "GAS" || value.vector === "UNKNOWN" ? value.vector : fail("CTE_EXTRACTION_SCHEMA_INVALID");
  if (!Array.isArray(value.fields)) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  const supplied = value.fields.map(extractionField);
  const notes = extractionNotes(value.extractionNotes);
  const allowed = new Set(expectedPaths(vector));
  const fields = supplied.filter((field) => allowed.has(field.path));
  if (fields.length !== supplied.length) fail("CTE_EXTRACTION_SCHEMA_INVALID");
  const seen = new Set<string>();
  for (const field of fields) { if (seen.has(field.path)) fail("CTE_EXTRACTION_SCHEMA_INVALID"); seen.add(field.path); }
  const candidate = bindCandidate(value.contractCandidate, tenantId, vector);
  ensureVectorSeparation(vector, fields, candidate);
  const byPath = new Map(fields.map((field) => [field.path, field]));
   const complete = expectedPaths(vector).map((path) => byPath.get(path) ?? { path, value: null, confidence: 0, sourcePage: null, sourceText: null, status: "NOT_FOUND" as const });
  return { documentType, vector, fields: complete, extractionNotes: notes, candidate };
}

export function getConfiguredCteOcrProvider(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): CteOcrProvider {
  const provider = env.CTE_OCR_PROVIDER;
  if (provider === "anthropic") return createAnthropicCteOcrProvider(env, fetcher);
  const endpoint = env.CTE_OCR_ENDPOINT;
  const apiKey = env.CTE_OCR_API_KEY;
  if (provider !== "http-json" || !endpoint || !apiKey || !/^https:\/\//.test(endpoint)) fail("CTE_OCR_PROVIDER_NOT_CONFIGURED");
  return {
    async extract(input) {
      const response = await fetcher(endpoint, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": input.contentType, "x-file-name": encodeURIComponent(input.fileName) }, body: Buffer.from(input.bytes) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) fail("CTE_OCR_PROVIDER_FAILED");
      return body as CteProviderExtraction;
    },
  };
}

function nowIso(): string { return new Date().toISOString(); }
function newIngestionId(): string { return "cte-ingestion-" + randomUUID(); }
function errorCodeOf(error: unknown, fallback = "CTE_OCR_PROVIDER_FAILED"): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : fallback;
}
function diagnosticsOf(error: unknown): CteProviderDiagnostics | null {
  return isRecord(error) && isRecord(error.diagnostics) ? error.diagnostics as unknown as CteProviderDiagnostics : null;
}
function attempt(input: { readonly fromStatus: CteIngestionStatus; readonly toStatus: CteIngestionStatus; readonly outcome: CteIngestionAttempt["outcome"]; readonly errorCode: string | null; readonly startedAt: string; readonly completedAt: string; readonly providerDiagnostics: CteProviderDiagnostics | null }): CteIngestionAttempt {
  return { attemptId: "cte-attempt-" + randomUUID(), ...input };
}
function publicRecord(record: TenantRecord<CteIngestionRecord>): Record<string, unknown> {
  const payload = record.payload;
  const review = normalizeCteReview(payload);
  const serverRecord = { ...payload, tenantId: record.tenantId };
  const authoritative = payload.reviewedCandidate ?? payload.candidate ?? (payload.status === "REVIEW_REQUIRED" ? tryBuildAuthoritativeCteContract(serverRecord).contract : null);
  const reviewMap = new Map([...review.commercialFields, ...review.notFoundFields].map((field) => [field.fieldKey, field]));
  const offerName = typeof reviewMap.get("offer.name")?.normalizedValue === "string" ? reviewMap.get("offer.name")?.normalizedValue : authoritative?.offer.name ?? null;
  const supplierName = typeof reviewMap.get("supplier.name")?.normalizedValue === "string" ? reviewMap.get("supplier.name")?.normalizedValue : authoritative?.supplier.name ?? null;
  return { ingestionId: payload.ingestionId, documentId: payload.documentId, fileName: typeof offerName === "string" ? offerName : payload.fileName, offerName, supplierName, contentType: payload.contentType, size: payload.size, createdAt: record.createdAt, updatedAt: record.updatedAt, status: payload.status, documentType: payload.documentType, vector: payload.vector, currency: review.currency, fields: payload.fields, reviewFields: review.commercialFields, notFoundFields: review.notFoundFields, sources: review.sources, approvalGate: cteApprovalGate(serverRecord), extractionNotes: payload.extractionNotes, candidatePreview: authoritative ? { readyForApproval: authoritative.approval.status === "NEEDS_REVIEW" } : null, corrections: payload.corrections, errorCode: payload.errorCode, approvedArchiveId: payload.approvedArchiveId };
}

export function toPublicCteIngestion(record: TenantRecord<CteIngestionRecord>): Record<string, unknown> { return publicRecord(record); }
export function isCorrectionSupported(path: string): boolean { return correctionPaths.has(path); }

export async function createCteIngestion(input: {
  readonly tenantId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly maxBytes?: number;
  readonly repository: CteIngestionRepository;
  readonly storage: DocumentStoragePort;
  readonly provider?: CteOcrProvider;
  readonly providerErrorCode?: CteProviderConfigurationError;
  readonly idempotencyKey?: string;
}): Promise<TenantRecord<CteIngestionRecord>> {
  const contentType = validateCteUpload(input);
  if (input.idempotencyKey) {
    const existing = (await input.repository.list(input.tenantId)).find((record) => record.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
  }
  const ingestionId = newIngestionId();
  const objectKey = await input.storage.store(input.tenantId, ingestionId, input.bytes);
  let status: CteIngestionStatus = "PROVIDER_NOT_CONFIGURED";
  let documentType: "CTE" | "UNKNOWN" = "UNKNOWN";
  let vector: "EE" | "GAS" | "UNKNOWN" = "UNKNOWN";
  let fields = emptyExtractionFields(vector);
  let extractionNotesValue: readonly string[] = [];
  let candidate: CteContract | null = null;
  let errorCode: string | null = input.providerErrorCode ?? "CTE_OCR_PROVIDER_NOT_CONFIGURED";
  let providerDiagnostics: CteProviderDiagnostics | null = null;
  const attempts: CteIngestionAttempt[] = [];
  if (input.provider) {
    const startedAt = nowIso();
    status = "OCR_PROCESSING"; errorCode = null;
    try {
      const providerExtraction = await input.provider.extract({ bytes: input.bytes, contentType, fileName: safeFileName(input.fileName) });
      providerDiagnostics = providerExtraction.providerDiagnostics ?? null;
      const extracted = normalizeProviderExtraction(providerExtraction, input.tenantId);
      if (!extracted.candidate && extracted.fields.every((field) => field.value === null)) fail("CTE_OCR_NO_USABLE_EVIDENCE");
      documentType = extracted.documentType; vector = extracted.vector; fields = extracted.fields; candidate = extracted.candidate; status = "REVIEW_REQUIRED";
      extractionNotesValue = extracted.extractionNotes;
    } catch (error) {
      status = "FAILED"; errorCode = errorCodeOf(error); providerDiagnostics = diagnosticsOf(error);
    }
    attempts.push(attempt({ fromStatus: "OCR_PROCESSING", toStatus: status, outcome: status === "REVIEW_REQUIRED" ? "SUCCEEDED" : "FAILED", errorCode, startedAt, completedAt: nowIso(), providerDiagnostics }));
  }
  return input.repository.append({ tenantId: input.tenantId, recordId: ingestionId, idempotencyKey: input.idempotencyKey, payload: { schemaVersion: CTE_INGESTION_SCHEMA_VERSION, ingestionId, documentId: ingestionId, objectKey, fileName: safeFileName(input.fileName), contentType, size: input.bytes.byteLength, status, documentType, vector, fields, extractionNotes: extractionNotesValue, candidate, reviewedCandidate: candidate, corrections: [], errorCode, providerDiagnostics, attempts, approvedArchiveId: null, approvedSnapshot: null }, now: nowIso() });
}

const activeRetries = new Set<string>();
const activeIngestionLocks = new Map<string, Promise<void>>();

export async function withCteIngestionLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = activeIngestionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  activeIngestionLocks.set(key, current);
  await previous;
  try { return await operation(); }
  finally { release(); if (activeIngestionLocks.get(key) === current) activeIngestionLocks.delete(key); }
}

export async function retryCteIngestion(input: {
  readonly tenantId: string;
  readonly ingestionId: string;
  readonly repository: CteIngestionRepository;
  readonly storage: DocumentStoragePort;
  readonly provider?: CteOcrProvider;
  readonly providerErrorCode?: CteProviderConfigurationError;
}): Promise<TenantRecord<CteIngestionRecord>> {
  const lockKey = `${input.tenantId}:${input.ingestionId}`;
  if (activeRetries.has(lockKey)) fail("CTE_OCR_RETRY_IN_PROGRESS");
  activeRetries.add(lockKey);
  try {
    const current = await input.repository.get(input.tenantId, input.ingestionId);
    if (!current) fail("CTE_INGESTION_NOT_FOUND");
    const previous = current.payload;
    if (previous.status !== "FAILED" && previous.status !== "PROVIDER_NOT_CONFIGURED") fail("CTE_RETRY_STATE_INVALID");
    const startedAt = nowIso();
    const history = [...(previous.attempts ?? [])];
    if (history.length === 0 && previous.errorCode) history.push(attempt({ fromStatus: previous.status, toStatus: previous.status, outcome: previous.status === "PROVIDER_NOT_CONFIGURED" ? "PROVIDER_NOT_CONFIGURED" : "FAILED", errorCode: previous.errorCode, startedAt: current.updatedAt, completedAt: current.updatedAt, providerDiagnostics: previous.providerDiagnostics }));
    let status: CteIngestionStatus = "FAILED";
    let documentType = previous.documentType;
    let vector = previous.vector;
    let fields = previous.fields;
    let extractionNotesValue = previous.extractionNotes;
    let candidate = previous.candidate;
    let errorCode: string | null = "CTE_OCR_PROVIDER_FAILED";
    let providerDiagnostics: CteProviderDiagnostics | null = null;
    let outcome: CteIngestionAttempt["outcome"] = "FAILED";
    if (!input.provider) {
      status = "PROVIDER_NOT_CONFIGURED";
      errorCode = input.providerErrorCode ?? "CTE_OCR_PROVIDER_NOT_CONFIGURED";
      outcome = "PROVIDER_NOT_CONFIGURED";
    } else {
      let bytes: Uint8Array;
      try {
        bytes = await input.storage.read(previous.objectKey);
      } catch {
        errorCode = "CTE_ORIGINAL_DOCUMENT_UNAVAILABLE";
        bytes = new Uint8Array();
      }
      if (errorCode !== "CTE_ORIGINAL_DOCUMENT_UNAVAILABLE") try {
        const providerExtraction = await input.provider.extract({ bytes, contentType: previous.contentType, fileName: safeFileName(previous.fileName) });
        providerDiagnostics = providerExtraction.providerDiagnostics ?? null;
        const extracted = normalizeProviderExtraction(providerExtraction, input.tenantId);
        if (!extracted.candidate && extracted.fields.every((field) => field.value === null)) fail("CTE_OCR_NO_USABLE_EVIDENCE");
        status = "REVIEW_REQUIRED"; errorCode = null; outcome = "SUCCEEDED"; documentType = extracted.documentType; vector = extracted.vector; fields = extracted.fields; extractionNotesValue = extracted.extractionNotes; candidate = extracted.candidate;
      } catch (error) {
        errorCode = errorCodeOf(error); providerDiagnostics = diagnosticsOf(error);
      }
    }
    const completedAt = nowIso();
    const nextAttempt = attempt({ fromStatus: previous.status, toStatus: status, outcome, errorCode, startedAt, completedAt, providerDiagnostics });
    return input.repository.put({ tenantId: input.tenantId, recordId: current.recordId, expectedVersion: current.version, payload: { ...previous, status, documentType, vector, fields, extractionNotes: extractionNotesValue, candidate, reviewedCandidate: status === "REVIEW_REQUIRED" ? candidate : previous.reviewedCandidate, errorCode, providerDiagnostics, attempts: [...history, nextAttempt], approvedArchiveId: status === "REVIEW_REQUIRED" ? null : previous.approvedArchiveId }, now: completedAt });
  } finally {
    activeRetries.delete(lockKey);
  }
}

function valueFromText(path: string, value: string): string | number {
  if (/amount$/.test(path)) { const number = Number(value); if (!Number.isFinite(number) || number < 0) fail("CTE_CORRECTION_VALUE_INVALID"); return number; }
  if (/periodStart|periodEnd|expiry\.date$/.test(path) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("CTE_CORRECTION_VALUE_INVALID");
  if (!value.trim() || value.length > 500) fail("CTE_CORRECTION_VALUE_INVALID");
  return value.trim();
}

function setCorrection(candidate: CteContract, fieldPath: string, next: string | number): CteContract {
  const clone = structuredClone(candidate) as unknown as Record<string, unknown>;
  const parts = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cursor: Record<string, unknown> | unknown[] = clone;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextCursor: unknown = Array.isArray(cursor) ? cursor[Number(part)] : cursor[part];
    if (!isRecord(nextCursor) && !Array.isArray(nextCursor)) fail("CTE_CORRECTION_FIELD_UNSUPPORTED");
    cursor = nextCursor;
  }
  const last = parts.at(-1) as string;
  if (Array.isArray(cursor)) cursor[Number(last)] = next;
  else cursor[last] = next;
  try { validateCteContract(clone); } catch { fail("CTE_CORRECTION_VALUE_INVALID"); }
  return clone as unknown as CteContract;
}

export async function correctCteIngestion(input: { readonly tenantId: string; readonly ingestionId: string; readonly fieldPath: string; readonly value: string; readonly actor: string; readonly repository: CteIngestionRepository }): Promise<TenantRecord<CteIngestionRecord>> {
  if (!isCorrectionSupported(input.fieldPath)) fail("CTE_CORRECTION_FIELD_UNSUPPORTED");
  const current = await input.repository.get(input.tenantId, input.ingestionId);
  if (!current) fail("CTE_INGESTION_NOT_FOUND");
  const payload = current.payload;
  if (payload.status === "APPROVED") fail("CTE_INGESTION_APPROVED_IMMUTABLE");
  const nextValue = valueFromText(input.fieldPath, input.value);
  if (!payload.candidate) {
    const fields = payload.fields.map((field) => field.path === input.fieldPath ? { ...field, value: nextValue, confidence: 1, status: "CORRECTED" as const } : field);
    const correction: CteCorrection = { version: current.version + 1, fieldPath: input.fieldPath, previousValue: payload.fields.find((field) => field.path === input.fieldPath)?.value ?? null, nextValue, actor: input.actor, correctedAt: nowIso() };
    return input.repository.put({ tenantId: input.tenantId, recordId: current.recordId, expectedVersion: current.version, payload: { ...payload, status: "REVIEW_REQUIRED", fields, corrections: [...payload.corrections, correction], errorCode: null }, now: correction.correctedAt });
  }
  const nextCandidate = setCorrection(payload.reviewedCandidate ?? payload.candidate, input.fieldPath, nextValue);
  const previous = payload.fields.find((field) => field.path === input.fieldPath)?.value ?? null;
  const correction: CteCorrection = { version: current.version + 1, fieldPath: input.fieldPath, previousValue: previous, nextValue, actor: input.actor, correctedAt: nowIso() };
  const fields = payload.fields.map((field) => field.path === input.fieldPath ? { ...field, value: nextValue, confidence: 1, status: "CORRECTED" as const, sourcePage: null, sourceText: "Correzione manuale" } : field);
  return input.repository.put({ tenantId: input.tenantId, recordId: current.recordId, expectedVersion: current.version, payload: { ...payload, status: "REVIEW_REQUIRED", fields, reviewedCandidate: nextCandidate, corrections: [...payload.corrections, correction], errorCode: null }, now: correction.correctedAt });
}

export async function confirmCteIngestion(input: { readonly tenantId: string; readonly ingestionId: string; readonly fieldPath: string; readonly actor: string; readonly repository: CteIngestionRepository }): Promise<TenantRecord<CteIngestionRecord>> {
  if (!isCorrectionSupported(input.fieldPath)) fail("CTE_CORRECTION_FIELD_UNSUPPORTED");
  const current = await input.repository.get(input.tenantId, input.ingestionId);
  if (!current) fail("CTE_INGESTION_NOT_FOUND");
  const payload = current.payload;
  if (payload.status === "APPROVED") fail("CTE_INGESTION_APPROVED_IMMUTABLE");
  const existing = payload.fields.find((field) => field.path === input.fieldPath);
  if (!existing || existing.status !== "UNCERTAIN" || existing.value === null) fail("CTE_REVIEW_REQUIRED");
  const confirmedAt = nowIso();
  const fields = payload.fields.map((field) => field.path === input.fieldPath ? { ...field, status: "CONFIRMED" as const } : field);
  return input.repository.put({ tenantId: input.tenantId, recordId: current.recordId, expectedVersion: current.version, payload: { ...payload, status: "REVIEW_REQUIRED", fields, errorCode: null }, now: confirmedAt });
}

export interface ApproveCteIngestionResult {
  readonly record: TenantRecord<CteIngestionRecord>;
  readonly alreadyApproved: boolean;
}

export async function approveCteIngestion(input: { readonly tenantId: string; readonly ingestionId: string; readonly actor: string; readonly repository: CteIngestionRepository; readonly archive: { create: (input: { readonly tenantId: string; readonly contract: CteContract; readonly actor: string }) => Promise<{ readonly archiveId: string; readonly currentWorkingVersionId: string }>; approve: (tenantId: string, archiveId: string, versionId: string, actor: string, decisionId: string) => Promise<unknown> } }): Promise<ApproveCteIngestionResult> {
  return withCteIngestionLock(`${input.tenantId}:${input.ingestionId}`, async () => {
    const current = await input.repository.get(input.tenantId, input.ingestionId);
    if (!current) fail("CTE_INGESTION_NOT_FOUND");
    const payload = current.payload;
    if (payload.status === "APPROVED") return { record: current, alreadyApproved: true };
    if (payload.status !== "REVIEW_REQUIRED") fail("CTE_REVIEW_REQUIRED");
    const candidate = payload.reviewedCandidate ?? payload.candidate ?? tryBuildAuthoritativeCteContract({ ...payload, tenantId: input.tenantId }).contract;
    if (!candidate) fail("CTE_REVIEW_REQUIRED");
    if (!cteApprovalGate({ ...payload, tenantId: input.tenantId }).approvalReady) fail("CTE_APPROVAL_BLOCKED");
    const created = await input.archive.create({ tenantId: input.tenantId, contract: candidate, actor: input.actor });
    const approvedArchive = await input.archive.approve(input.tenantId, created.archiveId, created.currentWorkingVersionId, input.actor, "cte-ingestion-approval-" + input.ingestionId);
    const archiveRecord = isRecord(approvedArchive) ? approvedArchive : null;
    const versions = archiveRecord && Array.isArray(archiveRecord.versions) ? archiveRecord.versions : [];
    const approvedVersion = versions.find((version) => isRecord(version) && version.versionId === archiveRecord?.currentApprovedVersionId && isRecord(version.contract));
    const approvedContract = approvedVersion && isRecord(approvedVersion.contract) ? approvedVersion.contract as unknown as CteContract : candidate;
    const approvalMetadata = approvedContract.approval as unknown as Record<string, unknown>;
    const approvedAt = typeof approvalMetadata.reviewedAt === "string" ? approvalMetadata.reviewedAt : nowIso();
    const approvedSnapshot = createCteApprovedSnapshot({ record: payload, tenantId: input.tenantId, approvedAt, approvedVersion: approvedContract.version, contract: approvedContract });
    const approved = await input.repository.put({ tenantId: input.tenantId, recordId: current.recordId, expectedVersion: current.version, payload: { ...payload, status: "APPROVED", reviewedCandidate: approvedContract, approvedArchiveId: created.archiveId, approvedSnapshot, errorCode: null }, now: approvedAt });
    return { record: approved, alreadyApproved: false };
  });
}

export async function deleteCteIngestion(input: { readonly tenantId: string; readonly ingestionId: string; readonly repository: CteIngestionRepository; readonly storage: DocumentStoragePort }): Promise<void> {
  await withCteIngestionLock(`${input.tenantId}:${input.ingestionId}`, async () => {
    const current = await input.repository.get(input.tenantId, input.ingestionId);
    if (!current) fail("CTE_INGESTION_NOT_FOUND");
    if (current.payload.status === "APPROVED") fail("CTE_INGESTION_APPROVED_IMMUTABLE");
    const siblings = await input.repository.list(input.tenantId);
    const shared = siblings.some((record) => record.recordId !== current.recordId && record.payload.objectKey === current.payload.objectKey);
    await input.repository.delete({ tenantId: input.tenantId, recordId: current.recordId, expectedVersion: current.version });
    if (!shared) await input.storage.remove(current.payload.objectKey);
  });
}
