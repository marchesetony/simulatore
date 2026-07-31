import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateBillContract } from "../energy/validation.ts";
import type { BillContract } from "../energy/types.ts";

export type ExtractionStatus = "EXTRACTED" | "OCR_PROVIDER_REQUIRED" | "FAILED" | "REVIEW_REQUIRED";
export type FieldName = "supplier" | "pod" | "customerName" | "billingPeriod" | "annualConsumption" | "billedConsumption" | "totalAmount";
export type FieldValue = string | null;
export type ReviewState = "WORKING" | "WORKING_AFTER_APPROVAL" | "WORKING_SUPERSEDED" | "APPROVED_CURRENT" | "APPROVED_SUPERSEDED";
export type ExtractedField = { readonly value: FieldValue; readonly confidence: number; readonly source: "embedded-text" | "manual" | "unavailable"; readonly confirmed: boolean };
export type BillFields = Record<FieldName, ExtractedField>;
export type BillVersion = {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly supersedesVersionId: string | null;
  readonly status: ExtractionStatus;
  readonly fields: BillFields;
  readonly createdAt: string;
  readonly origin: "INGESTION" | "MANUAL_REVIEW";
  readonly energyContract?: BillContract;
};
export type BillProvenanceEvent = {
  readonly eventId: string;
  readonly type: "INGESTION" | "MANUAL_REVIEW" | "APPROVAL";
  readonly origin: "INGESTION" | "MANUAL_REVIEW" | "LOCAL_APPROVAL";
  readonly tenantId: string;
  readonly documentId: string;
  readonly sourceVersionId: string | null;
  readonly resultVersionId: string;
  readonly versionNumber?: number;
  readonly field: FieldName | null;
  readonly previousValue: FieldValue;
  readonly nextValue: FieldValue;
  readonly at: string;
};
export type BillApprovalRecord = {
  readonly approvalId: string;
  readonly tenantId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly approvedAt: string;
  readonly origin: "LOCAL_APPROVAL";
  readonly supersedesApprovalId: string | null;
};
export type BillCorrectionOperation = { readonly operation: "correct"; readonly field: FieldName; readonly value: string; readonly versionId?: string };
export type BillApprovalOperation = { readonly operation: "approve"; readonly versionId: string };
export type BillOperation = BillCorrectionOperation | BillApprovalOperation;
export type BillDocument = {
  readonly id: string;
  readonly tenantId: string;
  readonly fileName: string;
  readonly objectKey: string;
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentVersionId: string;
  readonly currentApprovedVersionId: string | null;
  readonly versions: readonly BillVersion[];
  readonly provenance: readonly BillProvenanceEvent[];
  readonly approvals: readonly BillApprovalRecord[];
};
export type PublicBillVersion = {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly reviewState: ReviewState;
  readonly approvedAt: string | null;
};
export type PublicBillDocument = {
  readonly id: string;
  readonly tenantId: string;
  readonly fileName: string;
  readonly size: number;
  readonly status: ExtractionStatus;
  readonly fields: BillFields;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentVersionId: string;
  readonly currentVersionNumber: number;
  readonly reviewState: ReviewState;
  readonly currentApprovedVersionId: string | null;
  readonly currentApprovedVersionNumber: number | null;
  readonly currentApprovedAt: string | null;
  readonly versionCount: number;
  readonly approvalCount: number;
  readonly requiredFields: readonly FieldName[];
  readonly approvalReady: boolean;
  readonly approvalIssues: {
    readonly missingFields: readonly FieldName[];
    readonly unconfirmedFields: readonly FieldName[];
  };
  readonly versions: readonly PublicBillVersion[];
};
type BillStore = {
  readonly schemaVersion: 1;
  readonly documents: readonly BillDocument[];
};
type LegacyBillDocument = {
  readonly id: string;
  readonly tenantId: string;
  readonly fileName: string;
  readonly objectKey: string;
  readonly size: number;
  readonly status: ExtractionStatus;
  readonly fields: BillFields;
  readonly createdAt: string;
  readonly updatedAt: string;
};
type ApprovalValidation = {
  readonly missingFields: readonly FieldName[];
  readonly unconfirmedFields: readonly FieldName[];
};
type MetadataRecord = Record<string, unknown>;

export interface DocumentStoragePort {
  store(tenantId: string, id: string, bytes: Uint8Array): Promise<string>;
  read(objectKey: string): Promise<Uint8Array>;
}
export interface TextExtractionPort {
  extract(bytes: Uint8Array): Promise<{ readonly text: string; readonly pages: number }>;
}
export interface BillRepository {
  save(document: BillDocument): Promise<void>;
  get(tenantId: string, id: string): Promise<BillDocument | null>;
}
export interface EnergyContractMapperInput {
  readonly text: string;
  readonly pages: number;
  readonly tenantId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly extractionSource?: "embedded-text" | "ocr";
}
export type EnergyContractMapper = (input: EnergyContractMapperInput) => BillContract;
export interface AuditSink {
  record(event: { readonly type: "UPLOAD" | "VALIDATION" | "EXTRACTION" | "EXTRACTION_FAILURE" | "MANUAL_REVIEW" | "CORRECTION" | "APPROVAL"; readonly tenantId: string; readonly documentId: string; readonly outcome: "ALLOWED" | "DENIED" | "FAILED" }): Promise<void>;
}

export const fieldNames: readonly FieldName[] = ["supplier", "pod", "customerName", "billingPeriod", "annualConsumption", "billedConsumption", "totalAmount"];
export const requiredFieldNames: readonly FieldName[] = fieldNames;
const extractionStatuses: readonly ExtractionStatus[] = ["EXTRACTED", "OCR_PROVIDER_REQUIRED", "FAILED", "REVIEW_REQUIRED"];
const fieldSources: readonly ExtractedField["source"][] = ["embedded-text", "manual", "unavailable"];
const versionOrigins: readonly BillVersion["origin"][] = ["INGESTION", "MANUAL_REVIEW"];
const provenanceTypes: readonly BillProvenanceEvent["type"][] = ["INGESTION", "MANUAL_REVIEW", "APPROVAL"];
const provenanceOrigins: readonly BillProvenanceEvent["origin"][] = ["INGESTION", "MANUAL_REVIEW", "LOCAL_APPROVAL"];
const approvalOrigins: readonly BillApprovalRecord["origin"][] = ["LOCAL_APPROVAL"];

function documentsRoot(explicitRoot?: string): string {
  return path.resolve(explicitRoot ?? path.join(/* turbopackIgnore: true */ process.cwd(), "var", "foundation-documents"));
}

function emptyFields(): BillFields {
  return {
    supplier: unavailable(),
    pod: unavailable(),
    customerName: unavailable(),
    billingPeriod: unavailable(),
    annualConsumption: unavailable(),
    billedConsumption: unavailable(),
    totalAmount: unavailable(),
  };
}

function unavailable(): ExtractedField {
  return { value: null, confidence: 0, source: "unavailable", confirmed: false };
}

function cloneFields(fields: BillFields): BillFields {
  return {
    supplier: { ...fields.supplier },
    pod: { ...fields.pod },
    customerName: { ...fields.customerName },
    billingPeriod: { ...fields.billingPeriod },
    annualConsumption: { ...fields.annualConsumption },
    billedConsumption: { ...fields.billedConsumption },
    totalAmount: { ...fields.totalAmount },
  };
}

function metadataInvalid(): Error {
  return new Error("METADATA_INVALID");
}

function isRecord(value: unknown): value is MetadataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw metadataInvalid();
  return value;
}

function readTimestamp(value: unknown): string {
  const timestamp = readRequiredString(value);
  if (!Number.isFinite(Date.parse(timestamp))) throw metadataInvalid();
  return timestamp;
}

function readOptionalString(value: unknown): string | null {
  if (value === null) return null;
  return readRequiredString(value);
}

function readFieldValue(value: unknown): FieldValue {
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw metadataInvalid();
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw metadataInvalid();
  return value;
}

function readNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw metadataInvalid();
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw metadataInvalid();
  return value;
}

function readArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw metadataInvalid();
  return value;
}

function readExtractionStatus(value: unknown): ExtractionStatus {
  if (typeof value !== "string" || !extractionStatuses.includes(value as ExtractionStatus)) throw metadataInvalid();
  return value as ExtractionStatus;
}

function readFieldSource(value: unknown): ExtractedField["source"] {
  if (typeof value !== "string" || !fieldSources.includes(value as ExtractedField["source"])) throw metadataInvalid();
  return value as ExtractedField["source"];
}

function readVersionOrigin(value: unknown): BillVersion["origin"] {
  if (typeof value !== "string" || !versionOrigins.includes(value as BillVersion["origin"])) throw metadataInvalid();
  return value as BillVersion["origin"];
}

function readProvenanceType(value: unknown): BillProvenanceEvent["type"] {
  if (typeof value !== "string" || !provenanceTypes.includes(value as BillProvenanceEvent["type"])) throw metadataInvalid();
  return value as BillProvenanceEvent["type"];
}

function readProvenanceOrigin(value: unknown): BillProvenanceEvent["origin"] {
  if (typeof value !== "string" || !provenanceOrigins.includes(value as BillProvenanceEvent["origin"])) throw metadataInvalid();
  return value as BillProvenanceEvent["origin"];
}

function readApprovalOrigin(value: unknown): BillApprovalRecord["origin"] {
  if (typeof value !== "string" || !approvalOrigins.includes(value as BillApprovalRecord["origin"])) throw metadataInvalid();
  return value as BillApprovalRecord["origin"];
}

function readFieldName(value: unknown): FieldName {
  if (typeof value !== "string" || !fieldNames.includes(value as FieldName)) throw metadataInvalid();
  return value as FieldName;
}

function readOptionalFieldName(value: unknown): FieldName | null {
  if (value === null) return null;
  return readFieldName(value);
}

function assertUniqueIds(values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw metadataInvalid();
    seen.add(value);
  }
}

function fieldsEqual(left: ExtractedField, right: ExtractedField): boolean {
  return left.value === right.value
    && left.confidence === right.confidence
    && left.source === right.source
    && left.confirmed === right.confirmed;
}

function parseExtractedField(value: unknown): ExtractedField {
  if (!isRecord(value)) throw metadataInvalid();
  return {
    value: readFieldValue(value.value),
    confidence: readNonNegativeNumber(value.confidence),
    source: readFieldSource(value.source),
    confirmed: readBoolean(value.confirmed),
  };
}

function parseBillFields(value: unknown): BillFields {
  if (!isRecord(value)) throw metadataInvalid();
  return {
    supplier: parseExtractedField(value.supplier),
    pod: parseExtractedField(value.pod),
    customerName: parseExtractedField(value.customerName),
    billingPeriod: parseExtractedField(value.billingPeriod),
    annualConsumption: parseExtractedField(value.annualConsumption),
    billedConsumption: parseExtractedField(value.billedConsumption),
    totalAmount: parseExtractedField(value.totalAmount),
  };
}

function validateTenantId(tenantId: string): string {
  if (!/^tenant_[a-z0-9-]+$/.test(tenantId)) throw new Error("TENANT_ACCESS_DENIED");
  return tenantId;
}

export function assertLocalBillAccess(tenantId: string | null | undefined, localDev: string | undefined): string {
  if (!tenantId || localDev !== "true") throw new Error("TENANT_ACCESS_DENIED");
  return validateTenantId(tenantId);
}

export function parseBillOperation(value: unknown): BillOperation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const correction = (record.operation === undefined || record.operation === "correct")
    && typeof record.field === "string"
    && fieldNames.includes(record.field as FieldName)
    && typeof record.value === "string"
    && record.value.trim().length > 0
    && record.value.length <= 500
    && (record.versionId === undefined || typeof record.versionId === "string");
  if (correction) return { operation: "correct", field: record.field as FieldName, value: record.value as string, versionId: record.versionId as string | undefined };
  const approval = record.operation === "approve" && typeof record.versionId === "string" && record.versionId.trim().length > 0;
  if (approval) return { operation: "approve", versionId: record.versionId as string };
  return null;
}

function currentVersion(document: BillDocument): BillVersion {
  const version = document.versions.find((item) => item.versionId === document.currentVersionId);
  if (!version) throw new Error("DOCUMENT_CORRUPT");
  return version;
}

function approvedVersion(document: BillDocument): BillVersion | null {
  if (!document.currentApprovedVersionId) return null;
  return document.versions.find((item) => item.versionId === document.currentApprovedVersionId) ?? null;
}

function approvalRecordFor(document: BillDocument, versionId: string): BillApprovalRecord | null {
  const matches = document.approvals.filter((item) => item.versionId === versionId);
  if (matches.length === 0) return null;
  return [...matches].sort((left, right) => right.versionNumber - left.versionNumber || right.approvedAt.localeCompare(left.approvedAt))[0];
}

export function reviewStateFor(document: BillDocument, versionId: string): ReviewState {
  const hasApproval = document.approvals.some((item) => item.versionId === versionId);
  if (versionId === document.currentVersionId && versionId === document.currentApprovedVersionId) return "APPROVED_CURRENT";
  if (versionId === document.currentVersionId) return document.currentApprovedVersionId ? "WORKING_AFTER_APPROVAL" : "WORKING";
  if (versionId === document.currentApprovedVersionId) return "APPROVED_CURRENT";
  return hasApproval ? "APPROVED_SUPERSEDED" : "WORKING_SUPERSEDED";
}

export function documentStatus(fields: BillFields): ExtractionStatus {
  return fieldNames.every((name) => Boolean(fields[name].value?.trim())) ? "EXTRACTED" : "REVIEW_REQUIRED";
}

export function approvalValidation(document: BillDocument, versionId: string): ApprovalValidation {
  const version = document.versions.find((item) => item.versionId === versionId);
  if (!version) throw new Error("DOCUMENT_VERSION_NOT_FOUND");
  const missingFields = requiredFieldNames.filter((field) => !version.fields[field].value?.trim());
  const unconfirmedFields = requiredFieldNames.filter((field) => !version.fields[field].confirmed);
  return { missingFields, unconfirmedFields };
}

export function toPublicDocument(document: BillDocument): PublicBillDocument {
  const working = currentVersion(document);
  const approved = approvedVersion(document);
  const issues = approvalValidation(document, working.versionId);
  return {
    id: document.id,
    tenantId: document.tenantId,
    fileName: document.fileName,
    size: document.size,
    status: working.status,
    fields: cloneFields(working.fields),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    currentVersionId: working.versionId,
    currentVersionNumber: working.versionNumber,
    reviewState: reviewStateFor(document, working.versionId),
    currentApprovedVersionId: approved?.versionId ?? null,
    currentApprovedVersionNumber: approved?.versionNumber ?? null,
    currentApprovedAt: approved ? approvalRecordFor(document, approved.versionId)?.approvedAt ?? null : null,
    versionCount: document.versions.length,
    approvalCount: document.approvals.length,
    requiredFields: requiredFieldNames,
    approvalReady: issues.missingFields.length === 0 && issues.unconfirmedFields.length === 0,
    approvalIssues: issues,
    versions: [...document.versions]
      .sort((left, right) => left.versionNumber - right.versionNumber)
      .map((version) => ({
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        reviewState: reviewStateFor(document, version.versionId),
        approvedAt: approvalRecordFor(document, version.versionId)?.approvedAt ?? null,
      })),
  };
}

export class LocalDocumentStorage implements DocumentStoragePort {
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = documentsRoot(rootDir);
  }

  async store(tenantId: string, id: string, bytes: Uint8Array): Promise<string> {
    const dir = path.join(this.root, tenantId);
    await mkdir(dir, { recursive: true });
    const key = path.join(dir, `${id}.pdf`);
    await writeFile(key, bytes, { flag: "wx" });
    return key;
  }

  async read(objectKey: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(objectKey));
  }
}

export class LocalBillRepository implements BillRepository {
  private readonly file: string;

  constructor(rootDir?: string) {
    this.file = path.join(documentsRoot(rootDir), "metadata.json");
  }

  async save(document: BillDocument): Promise<void> {
    const rootDir = path.dirname(this.file);
    await mkdir(rootDir, { recursive: true });
    const store = await this.readStore();
    const documents = [...store.documents.filter((item) => !(item.id === document.id && item.tenantId === document.tenantId)), validateStoredDocument(document)];
    await writeFile(this.file, JSON.stringify({ schemaVersion: 1, documents }, null, 2), "utf8");
  }

  async get(tenantId: string, id: string): Promise<BillDocument | null> {
    validateTenantId(tenantId);
    const store = await this.readStore();
    const document = store.documents.find((item) => item.id === id && item.tenantId === tenantId) ?? null;
    return document ? sanitizeDocument(document) : null;
  }

  private async readStore(): Promise<BillStore> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      return normalizeStore(parsed);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { schemaVersion: 1, documents: [] };
      if (error instanceof SyntaxError || error instanceof Error && error.message === "METADATA_INVALID") throw metadataInvalid();
      throw error;
    }
  }
}

export class EmbeddedPdfTextExtractor implements TextExtractionPort {
  async extract(bytes: Uint8Array): Promise<{ readonly text: string; readonly pages: number }> {
    const raw = new TextDecoder("latin1").decode(bytes);
    const text = [...raw.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match) => match[1]).join(" ").replace(/\\([\\()])/g, "$1").trim();
    const pages = Math.max(1, (raw.match(/\/Type\s*\/Page\b/g) ?? []).length);
    if (!text) throw new Error("OCR_PROVIDER_REQUIRED");
    return { text, pages };
  }
}

export function validatePdf(fileName: string, contentType: string, bytes: Uint8Array, maxBytes: number): string {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error("PDF_LIMIT_INVALID");
  if (bytes.length === 0) throw new Error("PDF_EMPTY");
  if (bytes.length > maxBytes) throw new Error("PDF_TOO_LARGE");
  if (contentType !== "application/pdf") throw new Error("PDF_MIME_INVALID");
  if (new TextDecoder("latin1").decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("PDF_SIGNATURE_INVALID");
  if (!/^[\w .-]{1,120}\.pdf$/i.test(fileName)) throw new Error("PDF_FILENAME_INVALID");
  return fileName.replace(/[^\w .-]/g, "_");
}

function extracted(value: string | null, confidence: number): ExtractedField {
  return { value, confidence, source: value ? "embedded-text" : "unavailable", confirmed: false };
}

export function extractBillFields(text: string): BillFields {
  const result = emptyFields();
  const match = (pattern: RegExp): string | null => text.match(pattern)?.[1]?.trim() || null;
  result.supplier = extracted(match(/(?:fornitore|supplier)\s*[:\-]\s*([^\n;]+)/i), 0.9);
  result.pod = extracted(match(/(?:POD|PDR)\s*[:\-]\s*([A-Z0-9]+)/i), 0.95);
  result.customerName = extracted(match(/(?:cliente|customer|intestatario)\s*[:\-]\s*([^\n;]+)/i), 0.85);
  result.billingPeriod = extracted(match(/(?:periodo|billing period)\s*[:\-]\s*([^\n;]+)/i), 0.8);
  result.annualConsumption = extracted(match(/(?:consumo annuo|annual consumption)\s*[:\-]\s*([^\n;]+)/i), 0.8);
  result.billedConsumption = extracted(match(/(?:consumo fatturato|billed consumption)\s*[:\-]\s*([^\n;]+)/i), 0.9);
  result.totalAmount = extracted(match(/(?:totale da pagare|total amount)\s*[:\-]\s*([^\n;]+)/i), 0.9);
  return result;
}

export async function ingestBill(input: {
  readonly tenantId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly storage: DocumentStoragePort;
  readonly extractor: TextExtractionPort;
  readonly repository: BillRepository;
  readonly audit: AuditSink;
  readonly mapEnergyContract?: EnergyContractMapper;
}): Promise<BillDocument> {
  const tenantId = validateTenantId(input.tenantId);
  const safeName = validatePdf(input.fileName, input.contentType, input.bytes, input.maxBytes);
  const id = randomUUID();
  await input.audit.record({ type: "VALIDATION", tenantId, documentId: id, outcome: "ALLOWED" });
  const objectKey = await input.storage.store(tenantId, id, input.bytes);
  const now = new Date().toISOString();
  const versionId = randomUUID();
  try {
    const extractedText = await input.extractor.extract(input.bytes);
    const fields = extractBillFields(extractedText.text);
    const energyContract = input.mapEnergyContract?.({
      text: extractedText.text,
      pages: extractedText.pages,
      tenantId,
      documentId: id,
      versionId,
    });
    if (energyContract) {
      validateBillContract(energyContract);
      if (energyContract.tenantId !== tenantId || energyContract.billId !== id) throw new Error("EXTRACTION_METADATA_INVALID");
    }
    const document = sanitizeDocument({
      id,
      tenantId,
      fileName: safeName,
      objectKey,
      size: input.bytes.length,
      createdAt: now,
      updatedAt: now,
      currentVersionId: versionId,
      currentApprovedVersionId: null,
      versions: [{ versionId, versionNumber: 1, supersedesVersionId: null, status: energyContract ? "EXTRACTED" : documentStatus(fields), fields, createdAt: now, origin: "INGESTION", ...(energyContract ? { energyContract } : {}) }],
      provenance: [{ eventId: randomUUID(), type: "INGESTION", origin: "INGESTION", tenantId, documentId: id, sourceVersionId: null, resultVersionId: versionId, field: null, previousValue: null, nextValue: null, at: now }],
      approvals: [],
    });
    await input.repository.save(document);
    await input.audit.record({ type: "UPLOAD", tenantId, documentId: id, outcome: "ALLOWED" });
    await input.audit.record({ type: "EXTRACTION", tenantId, documentId: id, outcome: "ALLOWED" });
    return document;
  } catch (error) {
    const status: ExtractionStatus = error instanceof Error && error.message === "OCR_PROVIDER_REQUIRED" ? "OCR_PROVIDER_REQUIRED" : "FAILED";
    const document = sanitizeDocument({
      id,
      tenantId,
      fileName: safeName,
      objectKey,
      size: input.bytes.length,
      createdAt: now,
      updatedAt: now,
      currentVersionId: versionId,
      currentApprovedVersionId: null,
      versions: [{ versionId, versionNumber: 1, supersedesVersionId: null, status, fields: emptyFields(), createdAt: now, origin: "INGESTION" }],
      provenance: [{ eventId: randomUUID(), type: "INGESTION", origin: "INGESTION", tenantId, documentId: id, sourceVersionId: null, resultVersionId: versionId, field: null, previousValue: null, nextValue: null, at: now }],
      approvals: [],
    });
    await input.repository.save(document);
    await input.audit.record({ type: "UPLOAD", tenantId, documentId: id, outcome: "ALLOWED" });
    await input.audit.record({ type: "EXTRACTION_FAILURE", tenantId, documentId: id, outcome: "FAILED" });
    return document;
  }
}

export function createManualCorrection(input: {
  readonly document: BillDocument;
  readonly tenantId: string;
  readonly sourceVersionId: string;
  readonly field: FieldName;
  readonly value: string;
  readonly at: string;
}): BillDocument {
  validateTenantId(input.tenantId);
  if (input.document.tenantId !== input.tenantId) throw new Error("TENANT_ACCESS_DENIED");
  if (input.document.currentVersionId !== input.sourceVersionId) throw new Error("DOCUMENT_VERSION_STALE");
  if (!fieldNames.includes(input.field)) throw new Error("CORRECTION_INVALID");
  const value = input.value.trim();
  if (!value || value.length > 500) throw new Error("CORRECTION_INVALID");

  const source = currentVersion(input.document);
  if (source.fields[input.field].value === value) throw new Error("DOCUMENT_NO_CHANGES");
  const fields = cloneFields(source.fields);
  fields[input.field] = { value, confidence: 1, source: "manual", confirmed: true };
  const versionNumber = Math.max(...input.document.versions.map((item) => item.versionNumber)) + 1;
  const versionId = randomUUID();
  const nextVersion: BillVersion = {
    versionId,
    versionNumber,
    supersedesVersionId: source.versionId,
    status: documentStatus(fields),
    fields,
    createdAt: input.at,
    origin: "MANUAL_REVIEW",
    ...(source.energyContract ? { energyContract: source.energyContract } : {}),
  };

  return sanitizeDocument({
    ...input.document,
    updatedAt: input.at,
    currentVersionId: versionId,
    versions: [...input.document.versions, nextVersion],
    provenance: [
      ...input.document.provenance,
      {
        eventId: randomUUID(),
        type: "MANUAL_REVIEW",
        origin: "MANUAL_REVIEW",
        tenantId: input.tenantId,
        documentId: input.document.id,
        sourceVersionId: source.versionId,
        resultVersionId: versionId,
        field: input.field,
        previousValue: source.fields[input.field].value,
        nextValue: value,
        at: input.at,
      },
    ],
  });
}

export function approveDocumentVersion(input: {
  readonly document: BillDocument;
  readonly tenantId: string;
  readonly versionId: string;
  readonly at: string;
}): BillDocument {
  validateTenantId(input.tenantId);
  if (input.document.tenantId !== input.tenantId) throw new Error("TENANT_ACCESS_DENIED");
  const version = input.document.versions.find((item) => item.versionId === input.versionId);
  if (!version) throw new Error("DOCUMENT_VERSION_NOT_FOUND");
  if (input.document.currentVersionId !== input.versionId) throw new Error("DOCUMENT_VERSION_NOT_CURRENT");
  if (input.document.currentApprovedVersionId === input.versionId) throw new Error("DOCUMENT_VERSION_ALREADY_APPROVED");
  const issues = approvalValidation(input.document, input.versionId);
  if (issues.missingFields.length > 0) throw new Error("APPROVAL_REQUIRED_FIELDS_MISSING");
  if (issues.unconfirmedFields.length > 0) throw new Error("APPROVAL_FIELDS_UNCONFIRMED");

  const previous = input.document.currentApprovedVersionId ? approvalRecordFor(input.document, input.document.currentApprovedVersionId) : null;
  const approval: BillApprovalRecord = {
    approvalId: randomUUID(),
    tenantId: input.tenantId,
    documentId: input.document.id,
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    approvedAt: input.at,
    origin: "LOCAL_APPROVAL",
    supersedesApprovalId: previous?.approvalId ?? null,
  };

  return sanitizeDocument({
    ...input.document,
    updatedAt: input.at,
    currentApprovedVersionId: version.versionId,
    approvals: [...input.document.approvals, approval],
    provenance: [
      ...input.document.provenance,
      {
        eventId: randomUUID(),
        type: "APPROVAL",
        origin: "LOCAL_APPROVAL",
        tenantId: input.tenantId,
        documentId: input.document.id,
        sourceVersionId: version.versionId,
        resultVersionId: version.versionId,
        field: null,
        previousValue: null,
        nextValue: null,
        at: input.at,
      },
    ],
  });
}

function sanitizeDocument(document: BillDocument): BillDocument {
  const versions = [...document.versions]
    .map((version) => ({
      ...version,
      fields: cloneFields(version.fields),
    }))
    .sort((left, right) => left.versionNumber - right.versionNumber);
  const approvals = [...document.approvals].sort((left, right) => left.versionNumber - right.versionNumber || left.approvedAt.localeCompare(right.approvedAt));
  const provenance = [...document.provenance].sort((left, right) => left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId));
  return {
    ...document,
    versions,
    approvals,
    provenance,
  };
}

function normalizeStore(value: unknown): BillStore {
  if (Array.isArray(value)) return { schemaVersion: 1, documents: normalizeLegacyDocuments(value) };
  if (!isRecord(value)) throw metadataInvalid();
  if (value.schemaVersion !== 1) throw metadataInvalid();
  const documents = readArray(value.documents).map((item) => validateStoredDocument(item));
  assertUniqueIds(documents.map((document) => document.id));
  assertUniqueIds(documents.flatMap((document) => document.versions.map((version) => version.versionId)));
  return { schemaVersion: 1, documents };
}

function normalizeLegacyDocuments(value: readonly unknown[]): readonly BillDocument[] {
  const legacyDocuments = value.map((item) => normalizeLegacyDocument(item));
  assertUniqueIds(legacyDocuments.map((document) => document.id));
  assertUniqueIds(legacyDocuments.flatMap((document) => document.versions.map((version) => version.versionId)));
  return legacyDocuments;
}

function normalizeLegacyDocument(value: unknown): BillDocument {
  if (!isRecord(value)) throw metadataInvalid();
  if ("versions" in value || "provenance" in value || "approvals" in value || "currentVersionId" in value || "currentApprovedVersionId" in value) {
    throw metadataInvalid();
  }
  const legacy = value as LegacyBillDocument;
  const createdAt = typeof legacy.createdAt === "string" && legacy.createdAt.trim().length > 0 ? legacy.createdAt : new Date(0).toISOString();
  const updatedAt = typeof legacy.updatedAt === "string" && legacy.updatedAt.trim().length > 0 ? legacy.updatedAt : createdAt;
  return validateStoredDocument({
    id: readRequiredString(legacy.id),
    tenantId: validateTenantId(readRequiredString(legacy.tenantId)),
    fileName: readRequiredString(legacy.fileName),
    objectKey: readRequiredString(legacy.objectKey),
    size: readNonNegativeNumber(legacy.size),
    createdAt,
    updatedAt,
    currentVersionId: `${readRequiredString(legacy.id)}::v1`,
    currentApprovedVersionId: null,
    versions: [{
      versionId: `${readRequiredString(legacy.id)}::v1`,
      versionNumber: 1,
      supersedesVersionId: null,
      status: readExtractionStatus(legacy.status),
      fields: parseBillFields(legacy.fields),
      createdAt: updatedAt,
      origin: "INGESTION",
    }],
    provenance: [],
    approvals: [],
  }, true);
}

function validateVersionChain(versions: readonly BillVersion[], currentVersionId: string): void {
  const versionById = new Map(versions.map((item) => [item.versionId, item] as const));
  const childrenByParent = new Map<string, BillVersion[]>();
  const roots = versions.filter((version) => version.supersedesVersionId === null);
  if (roots.length !== 1 || roots[0].versionNumber !== 1) throw metadataInvalid();

  for (const version of versions) {
    if (version.supersedesVersionId === null) continue;
    const parent = versionById.get(version.supersedesVersionId);
    if (!parent || parent.versionNumber + 1 !== version.versionNumber) throw metadataInvalid();
    const children = childrenByParent.get(parent.versionId) ?? [];
    children.push(version);
    childrenByParent.set(parent.versionId, children);
  }

  const visited = new Set<string>();
  let current = roots[0];
  while (true) {
    if (visited.has(current.versionId)) throw metadataInvalid();
    visited.add(current.versionId);
    const children = childrenByParent.get(current.versionId) ?? [];
    if (children.length > 1) throw metadataInvalid();
    if (children.length === 0) break;
    current = children[0];
  }
  if (visited.size !== versions.length || current.versionId !== currentVersionId) throw metadataInvalid();
}

function validateProvenance(
  provenance: readonly BillProvenanceEvent[],
  versions: readonly BillVersion[],
  approvals: readonly BillApprovalRecord[],
  allowLegacyEmptyProvenance: boolean,
): void {
  if (provenance.length === 0 && allowLegacyEmptyProvenance) return;
  if (provenance.length === 0) throw metadataInvalid();

  const versionById = new Map(versions.map((item) => [item.versionId, item] as const));
  const manualEventsByResult = new Map<string, BillProvenanceEvent[]>();
  const approvalEvents = provenance.filter((event) => event.type === "APPROVAL");
  let ingestionEvents = 0;

  for (const event of provenance) {
    const result = versionById.get(event.resultVersionId);
    if (!result) throw metadataInvalid();
    if (event.versionNumber !== undefined && event.versionNumber !== result.versionNumber) throw metadataInvalid();

    if (event.type === "INGESTION") {
      if (event.origin !== "INGESTION" || event.sourceVersionId !== null || result.origin !== "INGESTION" || result.versionNumber !== 1
        || result.supersedesVersionId !== null || event.field !== null || event.previousValue !== null || event.nextValue !== null) throw metadataInvalid();
      ingestionEvents += 1;
      continue;
    }

    if (event.type === "MANUAL_REVIEW") {
      const source = event.sourceVersionId === null ? null : versionById.get(event.sourceVersionId);
      if (!source || source.versionId === result.versionId || event.origin !== "MANUAL_REVIEW" || result.origin !== "MANUAL_REVIEW"
        || result.supersedesVersionId !== source.versionId || result.versionNumber <= source.versionNumber || event.field === null) throw metadataInvalid();
      if (event.previousValue !== source.fields[event.field].value
        || event.nextValue !== result.fields[event.field].value
        || source.fields[event.field].value === result.fields[event.field].value
        || event.previousValue === event.nextValue) throw metadataInvalid();
      const events = manualEventsByResult.get(result.versionId) ?? [];
      events.push(event);
      manualEventsByResult.set(result.versionId, events);
      continue;
    }

    if (event.origin !== "LOCAL_APPROVAL" || event.sourceVersionId !== result.versionId || event.field !== null
      || event.previousValue !== null || event.nextValue !== null) throw metadataInvalid();
  }

  if (ingestionEvents !== 1) throw metadataInvalid();
  for (const version of versions) {
    if (version.origin === "INGESTION") {
      if (provenance.filter((event) => event.type === "INGESTION" && event.resultVersionId === version.versionId).length !== 1) throw metadataInvalid();
      continue;
    }
    const events = manualEventsByResult.get(version.versionId) ?? [];
    if (events.length === 0) throw metadataInvalid();
    const eventFields = new Set<string>();
    const source = versionById.get(version.supersedesVersionId ?? "");
    if (!source) throw metadataInvalid();
    for (const event of events) {
      if (event.field === null || eventFields.has(event.field)) throw metadataInvalid();
      if (source.fields[event.field].value === version.fields[event.field].value) throw metadataInvalid();
      eventFields.add(event.field);
    }
    for (const field of fieldNames) {
      if (!fieldsEqual(source.fields[field], version.fields[field]) && !eventFields.has(field)) throw metadataInvalid();
    }
  }

  assertUniqueIds(approvals.map((approval) => approval.versionId));
  if (approvalEvents.length !== approvals.length) throw metadataInvalid();
  for (const approval of approvals) {
    if (approvalEvents.filter((event) => event.resultVersionId === approval.versionId).length !== 1) throw metadataInvalid();
  }
}

function validateStoredDocument(value: unknown, allowLegacyEmptyProvenance = false): BillDocument {
  if (!isRecord(value)) throw metadataInvalid();
  const documentId = readRequiredString(value.id);
  const tenantId = validateTenantId(readRequiredString(value.tenantId));
  const versions = readArray(value.versions).map((item) => parseBillVersion(item, tenantId, documentId));
  const approvals = readArray(value.approvals).map((item) => parseBillApproval(item, tenantId, documentId));
  const provenance = readArray(value.provenance).map((item) => parseBillProvenance(item, tenantId, documentId));
  const currentVersionId = readRequiredString(value.currentVersionId);
  const currentApprovedVersionId = readOptionalString(value.currentApprovedVersionId);
  const versionIds = versions.map((item) => item.versionId);
  const versionNumbers = versions.map((item) => item.versionNumber);
  const approvalIds = approvals.map((item) => item.approvalId);
  const approvalVersionIds = new Set(approvals.map((item) => item.versionId));
  const eventIds = provenance.map((item) => item.eventId);

  assertUniqueIds(versionIds);
  assertUniqueIds(versionNumbers.map(String));
  assertUniqueIds(approvalIds);
  assertUniqueIds(eventIds);
  if (!versionIds.includes(currentVersionId)) throw metadataInvalid();
  if (currentApprovedVersionId !== null) {
    if (!versionIds.includes(currentApprovedVersionId)) throw metadataInvalid();
    if (!approvalVersionIds.has(currentApprovedVersionId)) throw metadataInvalid();
  }

  const versionById = new Map(versions.map((item) => [item.versionId, item] as const));
  validateVersionChain(versions, currentVersionId);
  const approvalIdsSet = new Set(approvalIds);
  for (const version of versions) {
    if (version.supersedesVersionId !== null) {
      const superseded = versionById.get(version.supersedesVersionId);
      if (!superseded || superseded.versionId === version.versionId || superseded.versionNumber >= version.versionNumber) throw metadataInvalid();
    }
  }
  for (const approval of approvals) {
    const version = versionById.get(approval.versionId);
    if (!version || version.versionNumber !== approval.versionNumber) throw metadataInvalid();
    if (approval.supersedesApprovalId !== null && (!approvalIdsSet.has(approval.supersedesApprovalId) || approval.supersedesApprovalId === approval.approvalId)) throw metadataInvalid();
  }
  validateProvenance(provenance, versions, approvals, allowLegacyEmptyProvenance);

  return sanitizeDocument({
    id: documentId,
    tenantId,
    fileName: readRequiredString(value.fileName),
    objectKey: readRequiredString(value.objectKey),
    size: readNonNegativeNumber(value.size),
    createdAt: readTimestamp(value.createdAt),
    updatedAt: readTimestamp(value.updatedAt),
    currentVersionId,
    currentApprovedVersionId,
    versions,
    provenance,
    approvals,
  });
}

function parseBillVersion(value: unknown, tenantId: string, documentId: string): BillVersion {
  if (!isRecord(value)) throw metadataInvalid();
  if ("tenantId" in value && validateTenantId(readRequiredString(value.tenantId)) !== tenantId) throw metadataInvalid();
  if ("documentId" in value && readRequiredString(value.documentId) !== documentId) throw metadataInvalid();
  let energyContract: BillContract | undefined;
  if (value.energyContract !== undefined) {
    validateBillContract(value.energyContract);
    const candidate = value.energyContract as BillContract;
    if (candidate.tenantId !== tenantId || candidate.billId !== documentId) throw metadataInvalid();
    energyContract = candidate;
  }
  return {
    versionId: readRequiredString(value.versionId),
    versionNumber: readPositiveInteger(value.versionNumber),
    supersedesVersionId: readOptionalString(value.supersedesVersionId),
    status: readExtractionStatus(value.status),
    fields: parseBillFields(value.fields),
    createdAt: readTimestamp(value.createdAt),
    origin: readVersionOrigin(value.origin),
    ...(energyContract ? { energyContract } : {}),
  };
}

function parseBillApproval(value: unknown, tenantId: string, documentId: string): BillApprovalRecord {
  if (!isRecord(value)) throw metadataInvalid();
  const approvalTenantId = validateTenantId(readRequiredString(value.tenantId));
  const approvalDocumentId = readRequiredString(value.documentId);
  if (approvalTenantId !== tenantId || approvalDocumentId !== documentId) throw metadataInvalid();
  return {
    approvalId: readRequiredString(value.approvalId),
    tenantId: approvalTenantId,
    documentId: approvalDocumentId,
    versionId: readRequiredString(value.versionId),
    versionNumber: readPositiveInteger(value.versionNumber),
    approvedAt: readTimestamp(value.approvedAt),
    origin: readApprovalOrigin(value.origin),
    supersedesApprovalId: readOptionalString(value.supersedesApprovalId),
  };
}

function parseBillProvenance(value: unknown, tenantId: string, documentId: string): BillProvenanceEvent {
  if (!isRecord(value)) throw metadataInvalid();
  const eventTenantId = validateTenantId(readRequiredString(value.tenantId));
  const eventDocumentId = readRequiredString(value.documentId);
  if (eventTenantId !== tenantId || eventDocumentId !== documentId) throw metadataInvalid();
  const versionNumber = "versionNumber" in value ? readPositiveInteger(value.versionNumber) : undefined;
  return {
    eventId: readRequiredString(value.eventId),
    type: readProvenanceType(value.type),
    origin: readProvenanceOrigin(value.origin),
    tenantId: eventTenantId,
    documentId: eventDocumentId,
    sourceVersionId: readOptionalString(value.sourceVersionId),
    resultVersionId: readRequiredString(value.resultVersionId),
    ...(versionNumber === undefined ? {} : { versionNumber }),
    field: readOptionalFieldName(value.field),
    previousValue: readFieldValue(value.previousValue),
    nextValue: readFieldValue(value.nextValue),
    at: readTimestamp(value.at),
  };
}
