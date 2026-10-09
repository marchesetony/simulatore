import { createHash } from "node:crypto";
import * as yauzl from "yauzl";
import { ZipPreflightError } from "./errors";
import { ZIP_PREFLIGHT_LIMITS } from "./limits";
import { preflightZip } from "./preflight";
import type { BoundedPartRequest, BoundedPartResult } from "./part-reader-types";
import { inspectZipStructure, prepareYauzlBuffer } from "./structure";

export const MAX_OOXML_PART_BYTES = ZIP_PREFLIGHT_LIMITS.maxUncompressedEntryBytes;

function fail(code: "INTEGRITY_ERROR" | "PART_NAME_INVALID" | "PART_NOT_FOUND" | "PART_TOO_LARGE" | "PART_READ_ERROR", message: string): never {
  throw new ZipPreflightError(code, message);
}

function validatePartName(name: string): void {
  if (!name || name.length > ZIP_PREFLIGHT_LIMITS.maxPathLength || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) fail("PART_NAME_INVALID", "part name is not canonical");
  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..") || segments.length > ZIP_PREFLIGHT_LIMITS.maxPathDepth) fail("PART_NAME_INVALID", "part name is not canonical");
}

function appendChunk(chunks: Buffer[], chunk: unknown, total: { value: number }, limit: number): void {
  const bytes = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : fail("PART_READ_ERROR", "part stream returned non-binary data");
  total.value += bytes.length;
  if (total.value > limit) fail("PART_TOO_LARGE", "part exceeds bounded XML limit");
  chunks.push(bytes);
}

async function readTarget(zip: yauzl.ZipFile, target: string, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: Buffer) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(value as Buffer); };
    const cleanup = () => { zip.removeListener("entry", onEntry); zip.removeListener("end", onEnd); zip.removeListener("error", onError); };
    const onEnd = () => finish(new ZipPreflightError("PART_NOT_FOUND", "requested part is absent"));
    const onError = (error: Error) => finish(new ZipPreflightError("PART_READ_ERROR", error.message));
    const onEntry = (entry: yauzl.Entry) => {
      if (entry.fileName !== target) { zip.readEntry(); return; }
      void (async () => {
        let stream: Awaited<ReturnType<yauzl.ZipFile["openReadStreamPromise"]>> | undefined;
        try {
          stream = await zip.openReadStreamPromise(entry);
          const chunks: Buffer[] = []; const total = { value: 0 };
          for await (const chunk of stream) appendChunk(chunks, chunk, total, limit);
          if (total.value !== entry.uncompressedSize) throw new ZipPreflightError("TRUNCATED_ENTRY", "part stream ended early");
          finish(undefined, Buffer.concat(chunks, total.value));
        } catch (error) {
          stream?.destroy();
          finish(error instanceof ZipPreflightError ? error : new ZipPreflightError("PART_READ_ERROR", error instanceof Error ? error.message : "part stream failed"));
        }
      })();
    };
    zip.once("entry", onEntry); zip.once("end", onEnd); zip.once("error", onError); zip.readEntry();
  });
}

export async function readBoundedPart(request: BoundedPartRequest): Promise<BoundedPartResult> {
  validatePartName(request.partName);
  const limit = request.maxBytes ?? MAX_OOXML_PART_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_OOXML_PART_BYTES) fail("PART_TOO_LARGE", "requested limit is outside the bounded range");
  const archive = Buffer.from(request.archive);
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  const expectedSha256 = request.preflight.originalSha256;
  if (request.preflight.status !== "ZIP_PREFLIGHT_PASSED" || request.preflight.archiveBytes !== archive.length || expectedSha256 !== archiveSha256) fail("INTEGRITY_ERROR", "archive is not bound to preflight evidence");
  const bound = await preflightZip(archive, { sourceSha256: expectedSha256 });
  if (!bound.entries.some((entry) => entry.name === request.partName)) fail("PART_NOT_FOUND", "requested part is absent");
  const structure = inspectZipStructure(archive, ZIP_PREFLIGHT_LIMITS.maxEntries);
  const parserBytes = prepareYauzlBuffer(archive, structure);
  let zip: yauzl.ZipFile | undefined;
  try {
    zip = await yauzl.fromBufferPromise(parserBytes, { lazyEntries: true, validateEntrySizes: false, strictFileNames: true, decodeStrings: true });
    parserBytes.set(archive);
    const bytes = await readTarget(zip, request.partName, limit);
    return { partName: request.partName, bytes, byteLength: bytes.length, archiveSha256, preflightVersion: bound.preflightVersion };
  } catch (error) {
    if (error instanceof ZipPreflightError) throw error;
    throw new ZipPreflightError("PART_READ_ERROR", error instanceof Error ? error.message : "part reader failed");
  } finally { zip?.close(); }
}
