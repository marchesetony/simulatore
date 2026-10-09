import "server-only";
import { createHash } from "node:crypto";
import { AreraAcquisitionError } from "./acquisition-types";
import type { AreraAcquisitionErrorCode, AreraAcquisitionOptions, AreraAcquisitionResult } from "./acquisition-types";

export const ARERA_DOCUMENT_URL = "https://www.arera.it/fileadmin/allegati/docs/25/573-2025-R-eel-TABELLE.xlsx";
export const ARERA_ACQUISITION_LIMITS = Object.freeze({
  defaultMaxBytes: 8 * 1024 * 1024, maximumBytes: 32 * 1024 * 1024,
  defaultTimeoutMs: 15_000, maximumTimeoutMs: 60_000,
});
const contentTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", "application/zip",
]);
function fail(code: AreraAcquisitionErrorCode): never { throw new AreraAcquisitionError(code); }

/** Fixed-source, explicit acquisition only. No parser, publication, storage or retry. */
export async function acquireAreraDocument(
  documentUrl: string = ARERA_DOCUMENT_URL, options: AreraAcquisitionOptions = {},
): Promise<AreraAcquisitionResult> {
  if (documentUrl !== ARERA_DOCUMENT_URL) return fail("UNTRUSTED_SOURCE");
  const maxBytes = options.maxBytes ?? ARERA_ACQUISITION_LIMITS.defaultMaxBytes;
  const timeoutMs = options.timeoutMs ?? ARERA_ACQUISITION_LIMITS.defaultTimeoutMs;
  const expectedSha256 = options.expectedSha256;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ARERA_ACQUISITION_LIMITS.maximumBytes ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > ARERA_ACQUISITION_LIMITS.maximumTimeoutMs)
    return fail("INVALID_CONFIGURATION");
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) return fail("INTEGRITY_ERROR");

  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  let timedOut = false;
  const deadline = performance.now() + timeoutMs;
  // Only the current operation has a rejection callback; no shared pending promise
  // or per-chunk abort listeners retain reactions throughout the download.
  let interrupt: ((error: AreraAcquisitionError) => void) | undefined;
  function expire(): void {
    timedOut = true;
    interrupt?.(new AreraAcquisitionError("REQUEST_TIMEOUT"));
    controller.abort();
  }
  function checkDeadline(): void {
    if (timedOut || performance.now() >= deadline) {
      expire();
      fail("REQUEST_TIMEOUT");
    }
  }
  async function waitFor<T>(operation: () => Promise<T>): Promise<T> {
    checkDeadline();
    try {
      return await new Promise<T>((resolve, reject) => {
        interrupt = reject;
        operation().then(resolve, reject);
      });
    } finally {
      interrupt = undefined;
    }
  }
  const timer = setTimeout(expire, timeoutMs);
  try {
    response = await waitFor(() => fetch(ARERA_DOCUMENT_URL, {
      method: "GET", redirect: "manual", signal: controller.signal, cache: "no-store",
      headers: { Accept: [...contentTypes].join(", "), "Accept-Encoding": "identity" },
    }));
    checkDeadline();
    if (response.redirected || (response.status >= 300 && response.status < 400)) return fail("UNEXPECTED_REDIRECT");
    if (response.url && response.url !== ARERA_DOCUMENT_URL) return fail("UNTRUSTED_SOURCE");
    if (response.status !== 200 || response.headers.has("content-range")) return fail("HTTP_ERROR");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentTypes.has(contentType.split(";", 1)[0].trim().toLowerCase())) return fail("INVALID_CONTENT_TYPE");
    // Fetch may transparently decompress HTTP encodings: reject them to preserve original bytes.
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") return fail("INTEGRITY_ERROR");
    const length = response.headers.get("content-length");
    let declaredLength: number | undefined;
    if (length !== null) {
      if (!/^\d+$/.test(length)) return fail("INCOMPLETE_DOWNLOAD");
      declaredLength = Number(length);
      if (!Number.isSafeInteger(declaredLength)) return fail("INCOMPLETE_DOWNLOAD");
      if (declaredLength > maxBytes) return fail("DOCUMENT_TOO_LARGE");
    }
    if (!response.body) return fail(declaredLength ? "INCOMPLETE_DOWNLOAD" : "EMPTY_DOCUMENT");
    reader = response.body.getReader();
    // Exactly one backing buffer, at most 32 MiB, independent of chunk count.
    // The returned view retains this capacity; no second final buffer is allocated.
    const storage = new Uint8Array(maxBytes);
    let received = 0;
    const hash = createHash("sha256");
    while (true) {
      checkDeadline();
      const { done, value } = await waitFor(() => reader!.read());
      checkDeadline();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) return fail("DOCUMENT_TOO_LARGE");
      if (declaredLength !== undefined && received > declaredLength) return fail("INCOMPLETE_DOWNLOAD");
      if (value.byteLength) {
        const offset = received - value.byteLength;
        storage.set(value, offset);
        hash.update(storage.subarray(offset, received));
      }
      checkDeadline();
    }
    if (declaredLength !== undefined && received !== declaredLength) return fail("INCOMPLETE_DOWNLOAD");
    if (!received) return fail("EMPTY_DOCUMENT");
    const bytes = storage.subarray(0, received);
    // ZIP local-file header only. This does NOT establish XLSX/OOXML validity.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04)
      return fail("INVALID_FILE_SIGNATURE");
    const sha256 = hash.digest("hex");
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) return fail("INTEGRITY_ERROR");
    const result: AreraAcquisitionResult = { bytes, evidence: Object.freeze({ authority: "ARERA", actReference: "573/2025/R/eel",
      documentUrl: ARERA_DOCUMENT_URL, retrievedAt: new Date().toISOString(), httpStatus: 200,
      contentType, contentLengthReceived: received, sha256, acquisitionStatus: "B2A_CHECKS_PASSED" }) };
    // JS timers cannot preempt synchronous work. Recheck elapsed monotonic time
    // after hashing/metadata creation so delayed timer callbacks cannot allow success.
    checkDeadline();
    completed = true;
    return result;
  } catch (error) {
    if (timedOut) return fail("REQUEST_TIMEOUT");
    if (error instanceof AreraAcquisitionError) throw error;
    return fail(response ? "INCOMPLETE_DOWNLOAD" : "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    if (!completed) {
      controller.abort();
      // Cleanup must not extend the deadline or expose transport/body errors in logs.
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}
