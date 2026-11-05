// Tony (5/11/2026, "cancellare e ripartire da zero"): the old bill readers that lived here (core + analyst two-stage reading,
// the verifier, the scontrino transcript and the patches from the PDF text layer) are removed. The bill is read by
// app/lib/reading/bill-reader.ts; this file keeps the provider interface and the Anthropic error helpers it shares.
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { BillOcrErrorCode } from "./errors.ts";
import type { StructuredBillExtraction } from "./structured-bill.ts";
import type { BillStageShapeDiagnostic } from "../diagnostics/real-diag-4.ts";

export interface BillExtractionProvider {
  extract(input: { readonly bytes: Uint8Array; readonly contentType: string }): Promise<StructuredBillExtraction>;
  getDiagnosticSnapshots?: () => readonly BillStageShapeDiagnostic[];
}

export interface AnthropicBillSdkClient {
  readonly messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>;
  };
}

export class AnthropicBillSdkError extends Error {
  readonly code: BillOcrErrorCode;
  readonly requestId: string | null;

  constructor(code: BillOcrErrorCode, requestId: string | null = null) {
    super(code);
    this.name = "AnthropicBillSdkError";
    this.code = code;
    this.requestId = requestId;
  }
}


export interface AnthropicApiErrorDetails {
  readonly status: number | null;
  readonly type: string | null;
  readonly technicalMessage: string;
  readonly requestID: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function serializedErrorBody(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const match = /^\s*\d{3}\s+(\{[\s\S]*\})\s*$/.exec(value);
  if (!match) return null;
  try {
    return record(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

function bodyMessage(body: Record<string, unknown> | null): string | null {
  return stringValue(record(body?.error)?.message) ?? stringValue(body?.message);
}

function bodyType(body: Record<string, unknown> | null): string | null {
  return stringValue(record(body?.error)?.type);
}

function requestIDValue(root: Record<string, unknown> | null, body: Record<string, unknown> | null): string | null {
  return stringValue(root?.requestID) ?? stringValue(root?.request_id) ?? stringValue(body?.request_id);
}

/** Extracts the Anthropic HTTP body, not the SDK's derived top-level `type`. */
export function extractAnthropicApiError(error: unknown): AnthropicApiErrorDetails {
  const root = record(error);
  const body = record(root?.error);
  const serialized = serializedErrorBody(root?.message);
  const candidateBodies = [body, serialized];
  const technicalMessage = candidateBodies.map(bodyMessage).find((value): value is string => value !== null) ?? "NONE";
  const nestedType = candidateBodies.map(bodyType).find((value): value is string => value !== null) ?? null;
  const status = typeof root?.status === "number" && Number.isSafeInteger(root.status) ? root.status : null;
  return {
    status,
    type: nestedType,
    technicalMessage,
    requestID: requestIDValue(root, body) ?? requestIDValue(root, serialized),
  };
}

function sanitizeTechnicalMessage(message: string): string {
  return message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/data:application\/pdf;base64,[A-Za-z0-9+/=_-]+/gi, "[REDACTED_PDF]")
    .replace(/(?:base64(?:\s+data)?|pdf(?:\s+content)?)\s*[:=]\s*[A-Za-z0-9+/=_-]{20,}/gi, "[REDACTED_BINARY]")
    .replace(/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,})\b/gi, "[REDACTED_API_KEY]")
    .replace(/\b(?:api[_ -]?key|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_PII]")
    .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, "[REDACTED_PII]")
    .replace(/\b(?:pod|pdr|customer(?:[_ -]?(?:name|id|taxidentifier))?)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED_PII]")
    .replace(/\b\+?\d[\d ()-]{6,}\d\b/g, "[REDACTED_PII]")
    .replace(/(?<![A-Za-z0-9])[A-Za-z0-9+/]{80,}={0,2}(?![A-Za-z0-9])/g, "[REDACTED_BASE64]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function sanitizeAnthropicTechnicalError(error: unknown): string {
  const technicalMessage = extractAnthropicApiError(error).technicalMessage;
  if (technicalMessage === "NONE") return "NONE";
  const sanitized = sanitizeTechnicalMessage(technicalMessage);
  return sanitized || "NONE";
}

