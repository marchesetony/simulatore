import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ExtractionStatus = "EXTRACTED" | "OCR_PROVIDER_REQUIRED" | "FAILED" | "REVIEW_REQUIRED";
export type FieldName = "supplier" | "pod" | "customerName" | "billingPeriod" | "annualConsumption" | "billedConsumption" | "totalAmount";
export type FieldValue = string | null;
export type ExtractedField = { readonly value: FieldValue; readonly confidence: number; readonly source: "embedded-text" | "manual" | "unavailable"; readonly confirmed: boolean };
export type BillFields = Record<FieldName, ExtractedField>;
export type BillDocument = { readonly id: string; readonly tenantId: string; readonly fileName: string; readonly objectKey: string; readonly size: number; readonly status: ExtractionStatus; readonly fields: BillFields; readonly createdAt: string; readonly updatedAt: string };
export type PublicBillDocument = Omit<BillDocument, "objectKey" | "tenantId"> & { readonly tenantId: string };

export interface DocumentStoragePort { store(tenantId: string, id: string, bytes: Uint8Array): Promise<string>; read(objectKey: string): Promise<Uint8Array>; }
export interface TextExtractionPort { extract(bytes: Uint8Array): Promise<{ readonly text: string; readonly pages: number }>; }
export interface BillRepository { save(document: BillDocument): Promise<void>; get(tenantId: string, id: string): Promise<BillDocument | null>; }
export interface AuditSink { record(event: { readonly type: "UPLOAD" | "VALIDATION" | "EXTRACTION" | "EXTRACTION_FAILURE" | "MANUAL_REVIEW" | "CORRECTION"; readonly tenantId: string; readonly documentId: string; readonly outcome: "ALLOWED" | "DENIED" | "FAILED" }): Promise<void>; }

export const fieldNames: readonly FieldName[] = ["supplier", "pod", "customerName", "billingPeriod", "annualConsumption", "billedConsumption", "totalAmount"];
const root = path.join(process.cwd(), "var", "foundation-documents");
const emptyFields = (): BillFields => ({ supplier: unavailable(), pod: unavailable(), customerName: unavailable(), billingPeriod: unavailable(), annualConsumption: unavailable(), billedConsumption: unavailable(), totalAmount: unavailable() });
const unavailable = (): ExtractedField => ({ value: null, confidence: 0, source: "unavailable", confirmed: false });

export function toPublicDocument(document: BillDocument): PublicBillDocument { return { id: document.id, tenantId: document.tenantId, fileName: document.fileName, size: document.size, status: document.status, fields: document.fields, createdAt: document.createdAt, updatedAt: document.updatedAt }; }

export class LocalDocumentStorage implements DocumentStoragePort {
  async store(tenantId: string, id: string, bytes: Uint8Array): Promise<string> { const dir = path.join(root, tenantId); await mkdir(dir, { recursive: true }); const key = path.join(dir, `${id}.pdf`); await writeFile(key, bytes, { flag: "wx" }); return key; }
  async read(objectKey: string): Promise<Uint8Array> { return new Uint8Array(await readFile(objectKey)); }
}

export class LocalBillRepository implements BillRepository {
  private readonly file = path.join(root, "metadata.json");
  async save(document: BillDocument): Promise<void> { await mkdir(root, { recursive: true }); let current: BillDocument[] = []; try { current = JSON.parse(await readFile(this.file, "utf8")) as BillDocument[]; } catch { /* first write */ } const next = current.filter((item) => item.id !== document.id); await writeFile(this.file, JSON.stringify([...next, document], null, 2), "utf8"); }
  async get(tenantId: string, id: string): Promise<BillDocument | null> { try { const all = JSON.parse(await readFile(this.file, "utf8")) as BillDocument[]; return all.find((item) => item.id === id && item.tenantId === tenantId) ?? null; } catch { return null; } }
}

export class EmbeddedPdfTextExtractor implements TextExtractionPort {
  async extract(bytes: Uint8Array): Promise<{ readonly text: string; readonly pages: number }> { const raw = new TextDecoder("latin1").decode(bytes); const text = [...raw.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match) => match[1]).join(" ").replace(/\\([\\()])/g, "$1").trim(); const pages = Math.max(1, (raw.match(/\/Type\s*\/Page\b/g) ?? []).length); if (!text) throw new Error("OCR_PROVIDER_REQUIRED"); return { text, pages }; }
}

export function validatePdf(fileName: string, contentType: string, bytes: Uint8Array, maxBytes: number): string { if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error("PDF_LIMIT_INVALID"); if (bytes.length === 0) throw new Error("PDF_EMPTY"); if (bytes.length > maxBytes) throw new Error("PDF_TOO_LARGE"); if (contentType !== "application/pdf") throw new Error("PDF_MIME_INVALID"); if (new TextDecoder("latin1").decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("PDF_SIGNATURE_INVALID"); if (!/^[\w .-]{1,120}\.pdf$/i.test(fileName)) throw new Error("PDF_FILENAME_INVALID"); return fileName.replace(/[^\w .-]/g, "_"); }

function extracted(value: string | null, confidence: number): ExtractedField { return { value, confidence, source: value ? "embedded-text" : "unavailable", confirmed: false }; }
export function extractBillFields(text: string): BillFields { const result = emptyFields(); const match = (pattern: RegExp): string | null => text.match(pattern)?.[1]?.trim() || null; result.supplier = extracted(match(/(?:fornitore|supplier)\s*[:\-]\s*([^\n;]+)/i), .9); result.pod = extracted(match(/(?:POD|PDR)\s*[:\-]\s*([A-Z0-9]+)/i), .95); result.customerName = extracted(match(/(?:cliente|customer|intestatario)\s*[:\-]\s*([^\n;]+)/i), .85); result.billingPeriod = extracted(match(/(?:periodo|billing period)\s*[:\-]\s*([^\n;]+)/i), .8); result.annualConsumption = extracted(match(/(?:consumo annuo|annual consumption)\s*[:\-]\s*([^\n;]+)/i), .8); result.billedConsumption = extracted(match(/(?:consumo fatturato|billed consumption)\s*[:\-]\s*([^\n;]+)/i), .9); result.totalAmount = extracted(match(/(?:totale da pagare|total amount)\s*[:\-]\s*([^\n;]+)/i), .9); return result; }
export function documentStatus(fields: BillFields): ExtractionStatus { return fieldNames.every((name) => Boolean(fields[name].value?.trim())) ? "EXTRACTED" : "REVIEW_REQUIRED"; }

export async function ingestBill(input: { readonly tenantId: string; readonly fileName: string; readonly contentType: string; readonly bytes: Uint8Array; readonly maxBytes: number; readonly storage: DocumentStoragePort; readonly extractor: TextExtractionPort; readonly repository: BillRepository; readonly audit: AuditSink }): Promise<BillDocument> { if (!/^tenant_[a-z0-9-]+$/.test(input.tenantId)) throw new Error("TENANT_ACCESS_DENIED"); const safeName = validatePdf(input.fileName, input.contentType, input.bytes, input.maxBytes); const id = randomUUID(); await input.audit.record({ type: "VALIDATION", tenantId: input.tenantId, documentId: id, outcome: "ALLOWED" }); const objectKey = await input.storage.store(input.tenantId, id, input.bytes); const now = new Date().toISOString(); try { const extractedText = await input.extractor.extract(input.bytes); const values = extractBillFields(extractedText.text); const document: BillDocument = { id, tenantId: input.tenantId, fileName: safeName, objectKey, size: input.bytes.length, status: documentStatus(values), fields: values, createdAt: now, updatedAt: now }; await input.repository.save(document); await input.audit.record({ type: "UPLOAD", tenantId: input.tenantId, documentId: id, outcome: "ALLOWED" }); await input.audit.record({ type: "EXTRACTION", tenantId: input.tenantId, documentId: id, outcome: "ALLOWED" }); return document; } catch (error) { const status: ExtractionStatus = error instanceof Error && error.message === "OCR_PROVIDER_REQUIRED" ? "OCR_PROVIDER_REQUIRED" : "FAILED"; const document: BillDocument = { id, tenantId: input.tenantId, fileName: safeName, objectKey, size: input.bytes.length, status, fields: emptyFields(), createdAt: now, updatedAt: now }; await input.repository.save(document); await input.audit.record({ type: "UPLOAD", tenantId: input.tenantId, documentId: id, outcome: "ALLOWED" }); await input.audit.record({ type: "EXTRACTION_FAILURE", tenantId: input.tenantId, documentId: id, outcome: "FAILED" }); return document; } }
