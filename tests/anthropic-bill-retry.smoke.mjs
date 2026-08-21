import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAnthropicBillOcrProvider, ANTHROPIC_BILL_MAX_HTTP_ATTEMPTS } from "../app/lib/cte/anthropic.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { retryEnergyBill } from "../app/lib/ingestion/service.ts";

const env = { CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "unit-test-key", ANTHROPIC_MODEL: "unit-test-model", ANTHROPIC_BILL_TIMEOUT_MS: "60000" };
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 fake", "latin1"));
const success = () => Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "extract_bill_text", input: { text: "OCR text", pages: 1 } }] });
const overload = (status = 529, retryAfter) => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error" }, request_id: "req_fake" }), { status, headers: { "content-type": "application/json", ...(retryAfter ? { "retry-after": retryAfter } : {}) } });
const consoleLines = [];
const previousConsoleError = console.error;
console.error = (...args) => consoleLines.push(args.join(" "));

async function runSequence(responses) {
  let calls = 0;
  const waits = [];
  const provider = createAnthropicBillOcrProvider(env, async () => responses[Math.min(calls++, responses.length - 1)], async (milliseconds) => { waits.push(milliseconds); });
  const result = await provider.extract({ bytes: pdf, contentType: "application/pdf" });
  return { result, calls, waits };
}

try {
  consoleLines.length = 0;
  const recoveredOnce = await runSequence([overload(), success()]);
  assert.equal(recoveredOnce.calls, 2);
  assert.equal(recoveredOnce.result.text, "OCR text");
  assert.deepEqual(recoveredOnce.waits, [1000]);
  assert.equal(consoleLines.filter((line) => line.startsWith("[BILL_OCR_DIAG]")).length, 0);
  assert.match(consoleLines.at(-1), /\[BILL_OCR_RETRY\] attempt=2\/3 result=RECOVERED/);

  consoleLines.length = 0;
  const recoveredTwice = await runSequence([overload(), overload(), success()]);
  assert.equal(recoveredTwice.calls, 3);
  assert.deepEqual(recoveredTwice.waits, [1000, 2000]);
  assert.match(consoleLines.at(-1), /attempt=3\/3 result=RECOVERED/);

  consoleLines.length = 0;
  const capped = await runSequence([overload(529, "999999"), success()]);
  assert.deepEqual(capped.waits, [30000]);

  consoleLines.length = 0;
  let failedCalls = 0;
  const failedProvider = createAnthropicBillOcrProvider(env, async () => { failedCalls += 1; return overload(); }, async () => {});
  await assert.rejects(() => failedProvider.extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_PROVIDER_UNAVAILABLE/);
  assert.equal(failedCalls, ANTHROPIC_BILL_MAX_HTTP_ATTEMPTS);
  assert.equal(consoleLines.filter((line) => line.startsWith("[BILL_OCR_RETRY]")).length, 3);
  assert.equal(consoleLines.filter((line) => line.startsWith("[BILL_OCR_DIAG]")).length, 1);

  for (const [status, code] of [[400, "BILL_OCR_REQUEST_INVALID"], [401, "BILL_OCR_PROVIDER_AUTH_FAILED"], [413, "BILL_OCR_REQUEST_TOO_LARGE"], [429, "BILL_OCR_PROVIDER_RATE_LIMITED"]]) {
    let calls = 0;
    const provider = createAnthropicBillOcrProvider(env, async () => { calls += 1; return overload(status); }, async () => {});
    await assert.rejects(() => provider.extract({ bytes: pdf, contentType: "application/pdf" }), new RegExp(code));
    assert.equal(calls, 1);
  }

  for (const status of [500, 503]) {
    const recovered = await runSequence([overload(status), success()]);
    assert.equal(recovered.calls, 2);
  }

  let invalidCalls = 0;
  const invalidProvider = createAnthropicBillOcrProvider(env, async () => { invalidCalls += 1; return Response.json({ stop_reason: "max_tokens", content: [] }); }, async () => {});
  await assert.rejects(() => invalidProvider.extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_OUTPUT_TRUNCATED/);
  assert.equal(invalidCalls, 1);

  let malformedCalls = 0;
  const malformedProvider = createAnthropicBillOcrProvider(env, async () => { malformedCalls += 1; return Response.json({ stop_reason: "tool_use", content: [] }); }, async () => {});
  await assert.rejects(() => malformedProvider.extract({ bytes: pdf, contentType: "application/pdf" }), /BILL_OCR_RESPONSE_INVALID/);
  assert.equal(malformedCalls, 1);

  const root = await mkdtemp(path.join(os.tmpdir(), "bill-provider-version-retry-"));
  try {
    const repository = new LocalBillRepository(root);
    const storage = new LocalDocumentStorage(root);
    const seed = await ingestBill({ tenantId: "tenant_provider-retry", fileName: "offline.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { throw new Error("OCR_PROVIDER_REQUIRED"); } } });
    let httpCalls = 0;
    const provider = createAnthropicBillOcrProvider(env, async () => { httpCalls += 1; return httpCalls < 3 ? overload() : Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "extract_bill_text", input: { text: "EE; POD: IT123E12345678; Customer ID: C; Customer Type: residential; Tax Code: TEST01; Supply ID: S; Meter ID: M; Voltage Level: LV; Billing Period: 2026-01-01 - 2026-02-01; Supplier: Test; Consumption Basis: measured; Consumo fatturato: 10", pages: 1 } }] }); }, async () => {});
    const result = await retryEnergyBill({ tenantId: "tenant_provider-retry", document: seed, storage, repository, authenticated: true, audit: { async record() {} }, ocrProvider: provider });
    assert.equal(httpCalls, 3);
    assert.equal(result.document.versions.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
} finally {
  console.error = previousConsoleError;
}

console.log("anthropic bill retry smoke: ok (bounded transient retries, no retry for non-transient/parser failures, diagnostics and single application version)");
