import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getConfiguredCteOcrProvider, normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { createAnthropicBillOcrProvider, ANTHROPIC_BILL_DEFAULT_TIMEOUT_MS, ANTHROPIC_BILL_MAX_TIMEOUT_MS, ANTHROPIC_BILL_MIN_TIMEOUT_MS, ANTHROPIC_BILL_TOOL_NAME, ANTHROPIC_CTE_SYSTEM_PROMPT, ANTHROPIC_TOOL_NAME } from "../app/lib/cte/anthropic.ts";
import { billOcrErrorCode, billOcrPublicError } from "../app/lib/ingestion/errors.ts";

const env = { CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "unit-test-key-only", ANTHROPIC_MODEL: "unit-test-model", ANTHROPIC_BASE_URL: "https://api.anthropic.com" };
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 untrusted document instructions"));
const image = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const field = (path, value = null, status = value === null ? "NOT_FOUND" : "CONFIRMED") => ({ path, value, confidence: value === null ? 0 : 0.9, sourcePage: value === null ? null : 1, sourceText: value === null ? null : `evidence:${path}`, status });
const validInput = { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("supplier.name", "Supplier evidence"), field("pricing.reference", "PUN"), field("offer.code", null)], extractionNotes: ["Evidence limited to document text"] };
let lastRequest;
const mockedFetch = async (_url, init) => { lastRequest = { url: String(_url), init }; return Response.json({ stop_reason: "tool_use", usage: { input_tokens: 123, output_tokens: 456 }, content: [{ type: "text", text: "prelude ignored" }, { type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: validInput }] }); };
const provider = getConfiguredCteOcrProvider(env, mockedFetch);
let observedCteTimeout;
const originalCteSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => { observedCteTimeout = delay; return originalCteSetTimeout(callback, delay, ...args); };
const extracted = await provider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" });
globalThis.setTimeout = originalCteSetTimeout;
assert.equal(observedCteTimeout, 60000);
const { providerDiagnostics, ...extractedPayload } = extracted;
assert.deepEqual(extractedPayload, validInput);
assert.deepEqual(providerDiagnostics, { model: "unit-test-model", httpStatus: 200, stopReason: "tool_use", inputTokens: 123, outputTokens: 456, contentBlockTypes: ["text", "tool_use"], toolName: ANTHROPIC_TOOL_NAME, internalErrorCode: null });
assert.equal(lastRequest.url, "https://api.anthropic.com/v1/messages");
const requestBody = JSON.parse(lastRequest.init.body);
assert.equal(requestBody.model, "unit-test-model");
assert.equal(requestBody.max_tokens, 65536);
assert.deepEqual(requestBody.thinking, { type: "disabled" });
assert.equal("temperature" in requestBody, false);
assert.equal("top_p" in requestBody, false);
assert.equal("top_k" in requestBody, false);
assert.deepEqual(requestBody.tool_choice, { type: "tool", name: ANTHROPIC_TOOL_NAME, disable_parallel_tool_use: true });
assert.equal(requestBody.tools[0].name, ANTHROPIC_TOOL_NAME);
assert.equal(requestBody.tools[0].strict, true);
assert.equal(requestBody.tools[0].input_schema.type, "object");
assert.equal(requestBody.tools[0].input_schema.additionalProperties, false);
assert.deepEqual(requestBody.tools[0].input_schema.required, ["schemaVersion", "documentType", "vector", "fields", "extractionNotes"]);
assert.equal(requestBody.messages[0].content[0].type, "document");
assert.equal(requestBody.messages[0].content[0].source.media_type, "application/pdf");
assert.equal(lastRequest.init.headers["x-api-key"], "unit-test-key-only");
assert.equal(requestBody.system, ANTHROPIC_CTE_SYSTEM_PROMPT);
assert.match(requestBody.system, /non attendibile|ignora/i);
assert.equal(JSON.stringify(requestBody).includes("unit-test-key-only"), false);

await provider.extract({ bytes: image, contentType: "image/jpeg", fileName: "contract.jpg" });
const imageBody = JSON.parse(lastRequest.init.body);
assert.equal(imageBody.messages[0].content[0].type, "image");
assert.equal(imageBody.messages[0].content[0].source.media_type, "image/jpeg");
await provider.extract({ bytes: png, contentType: "image/png", fileName: "contract.png" });
const pngBody = JSON.parse(lastRequest.init.body);
assert.equal(pngBody.messages[0].content[0].type, "image");
assert.equal(pngBody.messages[0].content[0].source.media_type, "image/png");

const billProvider = createAnthropicBillOcrProvider(env, async (_url, init) => { lastRequest = { url: String(_url), init }; return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_BILL_TOOL_NAME, input: { text: "supplier: evidence", pages: 1 } }] }); });
const originalSetTimeout = globalThis.setTimeout;
let observedBillTimeout;
globalThis.setTimeout = (callback, delay, ...args) => { observedBillTimeout = delay; return originalSetTimeout(callback, delay, ...args); };
const billResult = await billProvider.extract({ bytes: pdf, contentType: "application/pdf" });
globalThis.setTimeout = originalSetTimeout;
assert.deepEqual(billResult, { text: "supplier: evidence", pages: 1 });
assert.equal(ANTHROPIC_BILL_DEFAULT_TIMEOUT_MS, 300000);
assert.equal(observedBillTimeout, 300000);
const billBody = JSON.parse(lastRequest.init.body);
assert.equal(billBody.max_tokens, 65536);
assert.equal(billBody.tool_choice.name, ANTHROPIC_BILL_TOOL_NAME);
assert.equal(billBody.tools[0].strict, true);
assert.deepEqual(Object.keys(billBody.tools[0].input_schema.properties.text), ["type"]);
assert.deepEqual(Object.keys(billBody.tools[0].input_schema.properties.pages), ["type"]);
assert.equal(billBody.tools[0].input_schema.additionalProperties, false);
assert.deepEqual(billBody.tools[0].input_schema.required, ["text", "pages"]);
assert.equal(billBody.messages[0].content[0].type, "document");

const billResponseProvider = (input, stopReason = "tool_use") => createAnthropicBillOcrProvider(env, async () => Response.json({ stop_reason: stopReason, content: [{ type: "tool_use", name: ANTHROPIC_BILL_TOOL_NAME, input }] }));
for (const input of [
  { text: "", pages: 1 },
  { text: "x".repeat(300001), pages: 1 },
  { text: "x", pages: 0 },
  { text: "x", pages: 10001 },
  { text: "x", pages: 1.5 },
]) {
  await assert.rejects(() => billResponseProvider(input).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_RESPONSE_INVALID/);
}
await assert.doesNotReject(() => billResponseProvider({ text: "valid evidence", pages: 10000 }).extract({ bytes: pdf, contentType: "application/pdf" }));
await assert.rejects(() => billResponseProvider({ text: "valid evidence", pages: 1 }, "max_tokens").extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_OUTPUT_TRUNCATED/);

const billOverrideProvider = createAnthropicBillOcrProvider({ ...env, ANTHROPIC_BILL_MAX_TOKENS: "8192" }, async (_url, init) => { lastRequest = { url: String(_url), init }; return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_BILL_TOOL_NAME, input: { text: "supplier: evidence", pages: 1 } }] }); });
await billOverrideProvider.extract({ bytes: pdf, contentType: "application/pdf" });
assert.equal(JSON.parse(lastRequest.init.body).max_tokens, 8192);
let observedConfiguredBillTimeout;
const configuredBillProvider = createAnthropicBillOcrProvider({ ...env, ANTHROPIC_BILL_TIMEOUT_MS: "180000" }, async (_url, init) => { lastRequest = { url: String(_url), init }; return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_BILL_TOOL_NAME, input: { text: "supplier: evidence", pages: 1 } }] }); });
const originalConfiguredSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => { observedConfiguredBillTimeout = delay; return originalConfiguredSetTimeout(callback, delay, ...args); };
await configuredBillProvider.extract({ bytes: pdf, contentType: "application/pdf" });
globalThis.setTimeout = originalConfiguredSetTimeout;
assert.equal(observedConfiguredBillTimeout, 180000);
assert.equal(ANTHROPIC_BILL_MIN_TIMEOUT_MS, 60000);
assert.equal(ANTHROPIC_BILL_MAX_TIMEOUT_MS, 600000);
for (const value of ["59999", "600001", "not-a-number", "180000.5"]) {
  assert.throws(() => createAnthropicBillOcrProvider({ ...env, ANTHROPIC_BILL_TIMEOUT_MS: value }, mockedFetch), /BILL_OCR_PROVIDER_CONFIGURATION_INVALID/);
}
for (const value of ["8191", "128001", "not-a-number", "8192.5", ""]) {
  assert.throws(() => createAnthropicBillOcrProvider({ ...env, ANTHROPIC_BILL_MAX_TOKENS: value }, mockedFetch), /BILL_OCR_PROVIDER_CONFIGURATION_INVALID/);
}
assert.equal(billOcrErrorCode(new Error("ANTHROPIC_BILL_MAX_TOKENS_INVALID")), "BILL_OCR_PROVIDER_CONFIGURATION_INVALID");

const cteWithBillOnlyOverride = getConfiguredCteOcrProvider({ ...env, ANTHROPIC_BILL_MAX_TOKENS: "8192" }, mockedFetch);
await cteWithBillOnlyOverride.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" });
assert.equal(JSON.parse(lastRequest.init.body).max_tokens, 65536);

const billErrorProvider = (bodyOrResponse, fetcher = async () => bodyOrResponse instanceof Response ? bodyOrResponse : Response.json(bodyOrResponse)) => createAnthropicBillOcrProvider(env, fetcher);
const billValidTool = { type: "tool_use", name: ANTHROPIC_BILL_TOOL_NAME, input: { text: "x", pages: 1 } };
const diagnosticLines = [];
const previousConsoleError = console.error;
console.error = (...args) => diagnosticLines.push(args.join(" "));
try {
  const responseForStatus = (status) => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "raw upstream secret" }, request_id: "req_bill_fake" }), { status, headers: { "content-type": "application/json", "request-id": "req_bill_fake" } });
  for (const [status, code] of [[400, "BILL_OCR_REQUEST_INVALID"], [401, "BILL_OCR_PROVIDER_AUTH_FAILED"], [402, "BILL_OCR_BILLING_ERROR"], [404, "BILL_OCR_NOT_FOUND"], [413, "BILL_OCR_REQUEST_TOO_LARGE"], [429, "BILL_OCR_PROVIDER_RATE_LIMITED"], [500, "BILL_OCR_PROVIDER_UNAVAILABLE"], [529, "BILL_OCR_PROVIDER_UNAVAILABLE"]]) {
    await assert.rejects(() => billErrorProvider(responseForStatus(status)).extract({ bytes: pdf, contentType: "application/pdf" }), new RegExp(code));
    assert.equal(diagnosticLines.at(-1).includes(`code=${code}`), true);
    assert.doesNotMatch(diagnosticLines.at(-1), /raw upstream secret|unit-test-key-only/);
  }
  await assert.rejects(() => billErrorProvider({}, async () => { throw new Error("dns raw secret"); }).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_NETWORK_ERROR/);
  await assert.rejects(() => billErrorProvider({}, async () => { throw new DOMException("timeout", "AbortError"); }).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_PROVIDER_TIMEOUT/);
  await assert.rejects(() => billErrorProvider({ stop_reason: "max_tokens", content: [] }).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_OUTPUT_TRUNCATED/);
  await assert.rejects(() => billErrorProvider({ stop_reason: "pause_turn", content: [] }).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_RESPONSE_INVALID/);
  await assert.rejects(() => billErrorProvider({ stop_reason: "tool_use", content: [] }).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_RESPONSE_INVALID/);
  await assert.rejects(() => billErrorProvider({ stop_reason: "tool_use", content: [billValidTool, billValidTool] }).extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_RESPONSE_INVALID/);
  const routeError = billOcrPublicError("BILL_OCR_BILLING_ERROR");
  assert.deepEqual(routeError, { code: "BILL_OCR_BILLING_ERROR", message: "Il servizio di lettura non è disponibile per un problema di credito o fatturazione.", status: 502 });
  assert.ok(diagnosticLines.length >= 13);
} finally {
  console.error = previousConsoleError;
}

const overrideEnv = { ...env, ANTHROPIC_CTE_MAX_TOKENS: "8192" };
const overrideProvider = getConfiguredCteOcrProvider(overrideEnv, mockedFetch);
await overrideProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" });
assert.equal(JSON.parse(lastRequest.init.body).max_tokens, 8192);
for (const value of ["8191", "128001", "not-a-number", ""]) {
  assert.throws(() => getConfiguredCteOcrProvider({ ...env, ANTHROPIC_CTE_MAX_TOKENS: value }, mockedFetch), /ANTHROPIC_CTE_MAX_TOKENS_INVALID/);
}

assert.throws(() => createAnthropicBillOcrProvider({}, mockedFetch), /BILL_OCR_PROVIDER_NOT_CONFIGURED/);
assert.throws(() => createAnthropicBillOcrProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_MODEL: "unit-test-model" }, mockedFetch), /BILL_OCR_PROVIDER_CONFIGURATION_INVALID/);
assert.throws(() => createAnthropicBillOcrProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "unit-test-key-only" }, mockedFetch), /BILL_OCR_PROVIDER_CONFIGURATION_INVALID/);
assert.throws(() => createAnthropicBillOcrProvider({ CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "unit-test-key-only", ANTHROPIC_MODEL: "unit-test-model", ANTHROPIC_BASE_URL: "http://not-https" }, mockedFetch), /BILL_OCR_PROVIDER_CONFIGURATION_INVALID/);

const missingToolProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "ignore tool" }] }));
await assert.rejects(() => missingToolProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), /CTE_OCR_TOOL_USE_MISSING/);
const wrongNameProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "unexpected_tool", input: validInput }] }));
await assert.rejects(() => wrongNameProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), /CTE_OCR_TOOL_NAME_MISMATCH/);
const malformedProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: { nope: true } }] }));
await assert.rejects(() => malformedProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), (error) => error?.message === "CTE_EXTRACTION_SCHEMA_INVALID" && error.issuePaths.includes("schemaVersion"));
const multipleProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: validInput }, { type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: validInput }] }));
await assert.rejects(() => multipleProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), /CTE_OCR_TOOL_CALL_MULTIPLE/);
const truncatedProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: { documentType: "CTE", vector: "EE", fields: [] } }] }));
await assert.rejects(() => truncatedProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), (error) => error?.message === "CTE_OCR_OUTPUT_TRUNCATED" && !error.issuePaths.some((path) => path.includes("fields")) && error.diagnostics.internalErrorCode === "CTE_OCR_OUTPUT_TRUNCATED");
const refusalProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "refusal", content: [{ type: "text", text: "refused" }] }));
await assert.rejects(() => refusalProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), /CTE_OCR_PROVIDER_REFUSAL/);
const unknownStopProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "pause_turn", content: [] }));
await assert.rejects(() => unknownStopProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), /CTE_OCR_PROVIDER_RESPONSE_UNKNOWN/);
const earlyDomainProvider = getConfiguredCteOcrProvider(env, async () => Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input: { ...validInput, contractCandidate: null } }] }));
await assert.rejects(() => earlyDomainProvider.extract({ bytes: pdf, contentType: "application/pdf", fileName: "contract.pdf" }), /CTE_EXTRACTION_FINAL_DOMAIN_EARLY/);

const normalized = normalizeProviderExtraction({ ...validInput, fields: [field("pricing.reference", "PUN"), field("supplier.name", null)] }, "tenant_test");
assert.ok(normalized.fields.some((item) => item.status === "NOT_FOUND" && item.value === null));
assert.deepEqual(normalized.extractionNotes, ["Evidence limited to document text"]);
const gasNormalized = normalizeProviderExtraction({ ...validInput, vector: "GAS", fields: [field("pricing.reference", "PSV")] }, "tenant_test");
assert.equal(gasNormalized.vector, "GAS");
assert.throws(() => normalizeProviderExtraction({ ...validInput, vector: "EE", fields: [field("pricing.reference", "PSV")] }, "tenant_test"), /CTE_VECTOR_FIELD_MIXED/);
assert.throws(() => normalizeProviderExtraction({ ...validInput, vector: "GAS", fields: [field("pricing.reference", "PUN")] }, "tenant_test"), /CTE_VECTOR_FIELD_MIXED/);

const route = await readFile("app/api/cte/ingestion/route.ts", "utf8");
const service = await readFile("app/lib/cte/ingestion.ts", "utf8");
const ui = await readFile("app/components/CteIngestionPanel.tsx", "utf8");
assert.doesNotMatch(route, /process\.env\.ANTHROPIC_API_KEY|x-api-key/);
assert.match(route, /requestPrincipal/);
assert.match(service, /CTE_OCR_NO_USABLE_EVIDENCE/);
assert.match(service, /approveCteIngestion|REVIEW_REQUIRED/);
assert.doesNotMatch(ui, /CTE_OCR_ENDPOINT|objectKey|filePath/);
console.log("anthropic CTE provider smoke: ok (mocked provider contract; no live Anthropic request executed)");
