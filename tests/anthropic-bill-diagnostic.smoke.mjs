import assert from "node:assert/strict";
import { APIError } from "@anthropic-ai/sdk";
import { extractAnthropicApiError, sanitizeAnthropicTechnicalError } from "../app/lib/ingestion/anthropic-bill-sdk.ts";

const nestedBody = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "Schema is too complex for compilation.",
  },
  request_id: "req_test",
};
const nestedFixture = { status: 400, error: nestedBody, requestID: "req_test" };
const upstream = new APIError(400, nestedBody, undefined, new Headers([["request-id", "req_test"]]), "invalid_request_error");

const nestedDetails = extractAnthropicApiError(nestedFixture);
assert.equal(nestedDetails.status, 400);
assert.equal(nestedDetails.type, "invalid_request_error");
assert.equal(nestedDetails.technicalMessage, "Schema is too complex for compilation.");
assert.equal(nestedDetails.requestID, "req_test");
assert.equal(sanitizeAnthropicTechnicalError(nestedFixture), "Schema is too complex for compilation.");
console.log("NESTED_ERROR_TYPE_TEST=OK");
console.log("NESTED_ERROR_MESSAGE_TEST=OK");

const toolsMessage = { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "tools.0.input_schema: invalid schema" }, request_id: "req_tools" }, requestID: "req_tools" };
assert.equal(sanitizeAnthropicTechnicalError(toolsMessage), "tools.0.input_schema: invalid schema");
assert.equal(extractAnthropicApiError(toolsMessage).type, "invalid_request_error");

const serialized = new APIError(400, undefined, '400 {"type":"error","error":{"type":"invalid_request_error","message":"TEST"}}', new Headers([["request-id", "req_serialized"]]), "invalid_request_error");
Object.defineProperty(serialized, "message", { value: '400 {"type":"error","error":{"type":"invalid_request_error","message":"TEST"}}', configurable: true });
assert.equal(extractAnthropicApiError(serialized).technicalMessage, "TEST");
assert.equal(sanitizeAnthropicTechnicalError(serialized), "TEST");
console.log("SERIALIZED_MESSAGE_TEST=OK");

const sensitive = { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "schema parameter api_key=sk-ant-api03-secret-secret-secret base64: " + "A".repeat(96) }, request_id: "req_sensitive" } };
const sanitizedSensitive = sanitizeAnthropicTechnicalError(sensitive);
assert.match(sanitizedSensitive, /schema parameter/);
assert.doesNotMatch(sanitizedSensitive, /sk-ant-api03-secret-secret-secret|A{40,}/);
console.log("SANITIZER_TEST=OK");
console.log("NO_SECRET_TEST=OK");

const pii = { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "document customerName=Alice customerId=RSSMRA80A01H501X email alice@example.com phone +39 333 1234567" }, request_id: "req_pii" } };
const sanitizedPii = sanitizeAnthropicTechnicalError(pii);
assert.doesNotMatch(sanitizedPii, /Alice|RSSMRA80A01H501X|alice@example\.com|333 1234567/);
assert.match(sanitizedPii, /document/);
console.log("NO_PII_TEST=OK");

// Tony (5/11/2026): the old bill adapter is gone; the error helpers stay for the new reader (app/lib/reading/bill-reader.ts).
console.log("anthropic bill diagnostic smoke: ok");
