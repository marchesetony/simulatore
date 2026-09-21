import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CteProviderPayloadCapture {
  readonly requestId: string | null;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: string;
  readonly responseStatus: number | null;
  readonly rawPayload: unknown;
  readonly normalizedPayload: unknown | null;
  readonly schemaValidation: {
    readonly status: "PASS" | "FAIL";
    readonly errorCode: string | null;
    readonly issuePaths: readonly string[];
    readonly issueCodes: readonly string[];
  };
}

export interface CteProviderPayloadFiles {
  readonly rawPayloadFile: string;
  readonly normalizedPayloadFile: string;
  readonly validationFile: string;
}

const diagnosticRoot = path.join("var", "cte-diagnostics");
const safeSegment = /^[A-Za-z0-9._:-]{1,160}$/;
const sensitiveKey = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|cookie|headers/i;

function safe(value: string): string {
  if (!safeSegment.test(value) || value.includes("..")) throw new Error("CTE_DIAGNOSTIC_PATH_INVALID");
  return value;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[REDACTED_DEPTH]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redact(child, depth + 1)]));
}

function json(value: unknown): string { return JSON.stringify(redact(value), null, 2) + "\n"; }

export async function persistCteProviderPayload(input: {
  readonly tenantId: string;
  readonly documentId: string;
  readonly attemptNumber: number;
  readonly capture: CteProviderPayloadCapture;
  readonly rootDir?: string;
}): Promise<CteProviderPayloadFiles> {
  const tenantId = safe(input.tenantId);
  const documentId = safe(input.documentId);
  if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1) throw new Error("CTE_DIAGNOSTIC_ATTEMPT_INVALID");
  const root = path.resolve(input.rootDir ?? path.join(process.cwd(), diagnosticRoot), tenantId);
  await mkdir(root, { recursive: true });
  const stem = `${documentId}-attempt-${input.attemptNumber}`;
  const files = {
    rawPayloadFile: path.join(root, `${stem}.raw.json`),
    normalizedPayloadFile: path.join(root, `${stem}.normalized.json`),
    validationFile: path.join(root, `${stem}.validation.json`),
  };
  const metadata = { requestId: input.capture.requestId, provider: input.capture.provider, model: input.capture.model, timestamp: input.capture.timestamp, documentId, tenantId, responseStatus: input.capture.responseStatus };
  await writeFile(files.rawPayloadFile, json({ ...metadata, rawProviderPayload: input.capture.rawPayload }), { encoding: "utf8", flag: "wx" });
  await writeFile(files.normalizedPayloadFile, json({ ...metadata, normalizedProviderPayload: input.capture.normalizedPayload }), { encoding: "utf8", flag: "wx" });
  await writeFile(files.validationFile, json({ ...metadata, schemaValidation: input.capture.schemaValidation }), { encoding: "utf8", flag: "wx" });
  return files;
}
