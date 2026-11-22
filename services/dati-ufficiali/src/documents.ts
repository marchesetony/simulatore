import { createHash } from "node:crypto";
import type { ServiceStore } from "./store";
import type { FetchedDocument } from "./official-fetch";
import { SERVICE_ACTOR } from "./identity";

/**
 * Conservation of the original official documents (Tony 21/11/2026, punto 5): the bytes as downloaded, their SHA-256, source,
 * period, version, who acquired them and when, and the checks they passed. Append-only: a document already conserved with the
 * same fingerprint is reused, never rewritten; a new fingerprint for the same document and period is a new version.
 */
export const PLATFORM_TENANT = "tenant_piattaforma";
export const MAX_CONSERVED_BYTES = 6 * 1024 * 1024;
export type DocumentKind = "GME_PUN_BANDS_PDF" | "GME_NEWSLETTER_PDF" | "GME_ARERA_300_05_PDF" | "ARERA_SOURCE" | "TERNA_SOURCE";
export interface DocumentCheck { readonly code: string; readonly ok: boolean; readonly detail: string }

export interface ConservedDocument {
  readonly documentId: string;
  readonly kind: DocumentKind;
  readonly source: "GME" | "ARERA" | "TERNA";
  readonly period: string;
  readonly version: number;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly contentType: string;
  readonly retrievedAt: string;
  readonly retrievedBy: string;
  readonly checks: readonly DocumentCheck[];
  readonly values: Readonly<Record<string, unknown>> | null;
  /** The original bytes; null only when the file is larger than MAX_CONSERVED_BYTES (then `notConservedReason` says so). */
  readonly originalBase64: string | null;
  readonly notConservedReason: string | null;
}

export const documentIdFor = (kind: DocumentKind, period: string, sha256: string) => `svcdoc_${kind}_${period.replace(/[^0-9A-Za-z-]/g, "")}_${sha256.slice(0, 24)}`;

export async function listConserved(store: ServiceStore, kind?: DocumentKind, period?: string): Promise<readonly ConservedDocument[]> {
  return (await store.writable<ConservedDocument>("official-service-documents").list(PLATFORM_TENANT)).map((record) => record.payload).filter((doc) => (!kind || doc.kind === kind) && (!period || doc.period === period));
}

export async function conserveDocument(store: ServiceStore, input: { readonly document: FetchedDocument; readonly kind: DocumentKind; readonly source: ConservedDocument["source"]; readonly period: string; readonly checks: readonly DocumentCheck[]; readonly values?: Readonly<Record<string, unknown>> | null }): Promise<{ readonly document: ConservedDocument; readonly reused: boolean }> {
  const repository = store.writable<ConservedDocument>("official-service-documents");
  const documentId = documentIdFor(input.kind, input.period, input.document.sha256);
  const existing = await repository.get(PLATFORM_TENANT, documentId);
  if (existing) return { document: existing.payload, reused: true };
  const same = await listConserved(store, input.kind, input.period);
  const tooLarge = input.document.bytes.byteLength > MAX_CONSERVED_BYTES;
  const document: ConservedDocument = {
    documentId, kind: input.kind, source: input.source, period: input.period, version: same.reduce((max, doc) => Math.max(max, doc.version), 0) + 1,
    url: input.document.url, sha256: input.document.sha256, size: input.document.size, contentType: input.document.contentType.slice(0, 120),
    retrievedAt: input.document.retrievedAt, retrievedBy: SERVICE_ACTOR, checks: input.checks, values: input.values ?? null,
    originalBase64: tooLarge ? null : Buffer.from(input.document.bytes).toString("base64"),
    notConservedReason: tooLarge ? `file di ${input.document.size} byte oltre il limite di conservazione (${MAX_CONSERVED_BYTES}): conservati impronta e metadati` : null,
  };
  await repository.append({ tenantId: PLATFORM_TENANT, recordId: documentId, payload: document, idempotencyKey: documentId, now: input.document.retrievedAt });
  return { document, reused: false };
}

/** Re-reads a conserved document and checks that its bytes still have the recorded fingerprint. */
export function conservedBytes(document: ConservedDocument): Uint8Array {
  if (!document.originalBase64) throw new Error("SERVICE_DOCUMENT_NOT_CONSERVED");
  const bytes = new Uint8Array(Buffer.from(document.originalBase64, "base64"));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== document.sha256) throw new Error("SERVICE_DOCUMENT_INTEGRITY_FAILED");
  return bytes;
}
