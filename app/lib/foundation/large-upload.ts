import { randomUUID } from "node:crypto";
import type { DocumentStoragePort } from "./real-bill";

/** Tony (31/10): "IL LIMITE DI 10 MB BISOGNA ALZARLO". Up to 20 MB: the AI reads a document of at most 32 MB once encoded. */
export const MAX_UPLOAD_BYTES = 20_000_000;
/** Above this the browser sends the file straight to storage (the hosting caps a request body at about 4,5 MB). */
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 4_000_000;

export interface UploadedFile { readonly fileName: string; readonly contentType: string; readonly bytes: Uint8Array }

export async function createUploadTarget(storage: DocumentStoragePort, tenantId: string): Promise<{ readonly uploadId: string; readonly signedUrl: string; readonly maxBytes: number }> {
  if (!storage.createUploadTarget) throw new Error("DIRECT_UPLOAD_UNAVAILABLE");
  const uploadId = `upload_${randomUUID().replace(/-/g, "")}`;
  const { signedUrl } = await storage.createUploadTarget(tenantId, uploadId);
  return { uploadId, signedUrl, maxBytes: MAX_UPLOAD_BYTES };
}

/** The file of an upload request: a multipart "file", or a JSON body naming a file already sent straight to storage. */
export async function uploadedFile(request: Request, storage: DocumentStoragePort, tenantId: string): Promise<UploadedFile | null> {
  if (/application\/json/i.test(request.headers.get("content-type") ?? "")) {
    const body = await request.json() as Record<string, unknown>;
    const uploadId = typeof body.uploadId === "string" && /^upload_[a-f0-9]{32}$/.test(body.uploadId) ? body.uploadId : null;
    if (!uploadId || !storage.takeUpload) return null;
    const bytes = await storage.takeUpload(tenantId, uploadId);
    return { fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 255) : "documento.pdf", contentType: typeof body.contentType === "string" ? body.contentType : "application/pdf", bytes };
  }
  const file = (await request.formData()).get("file");
  return file instanceof File ? { fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
}
