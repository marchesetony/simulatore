import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { acquireAreraDocument, ARERA_DOCUMENT_URL, ARERA_ACQUISITION_LIMITS } from "../modules/regulatory/acquisition.ts";
import { AreraAcquisitionError } from "../modules/regulatory/acquisition-types.ts";

// Synthetic prefix, deliberately NOT a valid workbook or complete ZIP archive.
const original = Uint8Array.from([0x50, 0x4b, 3, 4, 0, 255, 128, 13, 10]);
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function response(bytes = original, headers = {}, status = 200) {
  return new Response(bytes, { status, headers: { "content-type": mime, ...headers } });
}
function mock(t, implementation) { return t.mock.method(globalThis, "fetch", implementation); }
async function rejects(code, options = {}, url = ARERA_DOCUMENT_URL) {
  await assert.rejects(acquireAreraDocument(url, options), error =>
    error instanceof AreraAcquisitionError && error.code === code && error.message === code);
}
test("B2a preserves binary bytes, hashes independently, and exposes transport evidence only", async t => {
  const calls = mock(t, async (url, init) => {
    assert.equal(url, ARERA_DOCUMENT_URL); assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual"); assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    return response(original, { "content-length": String(original.length) });
  });
  const before = Date.now();
  const result = await acquireAreraDocument();
  assert.deepEqual(result.bytes, original);
  assert.equal(result.evidence.sha256, createHash("sha256").update(original).digest("hex"));
  assert.equal(result.evidence.contentLengthReceived, original.length);
  assert.equal(result.evidence.authority, "ARERA"); assert.equal(result.evidence.actReference, "573/2025/R/eel");
  assert.equal(result.evidence.documentUrl, ARERA_DOCUMENT_URL); assert.equal(result.evidence.httpStatus, 200);
  assert.equal(result.evidence.contentType, mime);
  assert.ok(Date.parse(result.evidence.retrievedAt) >= before && Date.parse(result.evidence.retrievedAt) <= Date.now());
  assert.equal(result.evidence.acquisitionStatus, "B2A_CHECKS_PASSED");
  assert.deepEqual(Object.keys(result), ["bytes", "evidence"]);
  assert.deepEqual(Object.keys(result.evidence).sort(), ["authority", "actReference", "documentUrl", "retrievedAt", "httpStatus", "contentType", "contentLengthReceived", "sha256", "acquisitionStatus"].sort());
  assert.ok(Object.isFrozen(result.evidence)); assert.equal(calls.mock.callCount(), 1);
});
test("untrusted destinations fail before fetching", async t => {
  const calls = mock(t, () => assert.fail("network forbidden"));
  for (const url of ["https://example.com/a.xlsx", ARERA_DOCUMENT_URL + "?x=1", ARERA_DOCUMENT_URL + "#x", ARERA_DOCUMENT_URL.replace("https:", "http:"), ARERA_DOCUMENT_URL.replace("www.arera.it", "www.arera.it.evil.test")])
    await rejects("UNTRUSTED_SOURCE", {}, url);
  assert.equal(calls.mock.callCount(), 0);
});
for (const status of [301, 302, 303, 307, 308, 304, 404, 500, 206, 201]) {
  test(`HTTP ${status} rejected without follow-up`, async t => {
    const calls = mock(t, async () => new Response(null, { status, headers: { location: "https://example.com/" } }));
    await rejects(status < 400 && status >= 300 ? "UNEXPECTED_REDIRECT" : "HTTP_ERROR");
    assert.equal(calls.mock.callCount(), 1);
  });
}
for (const contentType of ["text/html", "application/json", "text/plain", ""]) {
  test(`reject content type ${contentType}`, async t => {
    mock(t, async () => response(original, { "content-type": contentType })); await rejects("INVALID_CONTENT_TYPE");
  });
}
for (const bytes of [new TextEncoder().encode("<html>error</html>"), new TextEncoder().encode('{"error":true}'), Uint8Array.of(0x50, 0x4b, 3)]) {
  test("Excel MIME cannot hide HTML, JSON or a short signature", async t => {
    mock(t, async () => response(bytes)); await rejects("INVALID_FILE_SIGNATURE");
  });
}
for (const length of ["8", "10", "bad", "-1", "1.5", "9007199254740992"]) {
  test(`unexpected Content-Length ${length}`, async t => {
    mock(t, async () => response(original, { "content-length": length })); await rejects("INCOMPLETE_DOWNLOAD");
  });
}
test("header size above limit rejected and body cancelled", async t => {
  let cancelled = false;
  mock(t, async () => response(new ReadableStream({ cancel() { cancelled = true; } }), { "content-length": "100" }));
  await rejects("DOCUMENT_TOO_LARGE", { maxBytes: 9 }); assert.ok(cancelled);
});
test("streaming limit enforced without Content-Length, cancel and abort on overflow", async t => {
  let cancelled = false, signal;
  mock(t, async (_, init) => {
    signal = init.signal;
    return response(new ReadableStream({ start(c) { c.enqueue(original.slice(0, 4)); c.enqueue(original.slice(4)); }, cancel() { cancelled = true; } }));
  });
  await rejects("DOCUMENT_TOO_LARGE", { maxBytes: 8 }); assert.ok(cancelled); assert.ok(signal.aborted);
});
test("fragmented signature and exact byte limit accepted", async t => {
  mock(t, async () => response(new ReadableStream({ start(c) { for (const byte of original) c.enqueue(Uint8Array.of(byte)); c.close(); } })));
  assert.deepEqual((await acquireAreraDocument(undefined, { maxBytes: original.length })).bytes, original);
});
test("interrupted stream never returns a partial document", async t => {
  let count = 0;
  mock(t, async () => response(new ReadableStream({ pull(c) { if (count++ === 0) c.enqueue(original); else c.error(new Error("broken")); } })));
  await rejects("INCOMPLETE_DOWNLOAD");
});
test("network failure is typed", async t => { mock(t, async () => { throw new Error("offline"); }); await rejects("NETWORK_ERROR"); });
for (const phase of ["headers", "body"]) {
  test(`deadline covers stalled ${phase}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(performance, "now", () => 0);
    let signal;
    mock(t, (_, init) => {
      signal = init.signal;
      if (phase === "headers") {
        queueMicrotask(() => t.mock.timers.tick(15));
        return new Promise(() => {});
      }
      return Promise.resolve(response(new ReadableStream({
        pull() { queueMicrotask(() => t.mock.timers.tick(15)); },
      }, { highWaterMark: 0 })));
    });
    await rejects("REQUEST_TIMEOUT", { timeoutMs: 15 }); assert.ok(signal.aborted);
  });
}
for (const body of [null, new Uint8Array()]) {
  test("empty document rejected", async t => { mock(t, async () => response(body)); await rejects("EMPTY_DOCUMENT"); });
}
test("missing body with positive Content-Length is incomplete", async t => {
  mock(t, async () => response(null, { "content-length": "9" })); await rejects("INCOMPLETE_DOWNLOAD");
});

for (const chunkSize of [1, 7]) {
  test(`M1: 65536 original bytes in chunks of ${chunkSize}, bounded output storage`, async t => {
    t.mock.method(performance, "now", () => 0);
    const expected = Uint8Array.from({ length: 65536 }, (_, i) => i % 256);
    expected.set(original);
    let offset = 0, reads = 0, signal, listenerCalls;
    const body = new ReadableStream({
      pull(c) {
        reads++;
        if (offset === expected.length) { c.close(); return; }
        const end = Math.min(offset + chunkSize, expected.length);
        c.enqueue(expected.subarray(offset, end)); offset = end;
      },
    }, { highWaterMark: 0 });
    mock(t, async (_, init) => {
      signal = init.signal;
      listenerCalls = t.mock.method(signal, "addEventListener");
      return response(body);
    });
    const result = await acquireAreraDocument(undefined, { maxBytes: expected.length });
    assert.deepEqual(result.bytes, expected);
    assert.equal(result.bytes.buffer.byteLength, expected.length);
    assert.equal(result.evidence.sha256, createHash("sha256").update(expected).digest("hex"));
    assert.equal(result.evidence.contentLengthReceived, expected.length);
    assert.equal(reads, Math.ceil(expected.length / chunkSize) + 1);
    assert.equal(listenerCalls.mock.callCount(), 0);
    assert.equal(body.locked, false); assert.equal(signal.aborted, false);
  });
}

test("M1: a single oversized chunk is rejected without partial success", async t => {
  let cancelled = false, signal;
  const body = new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(65536)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  mock(t, async (_, init) => { signal = init.signal; return response(body); });
  await rejects("DOCUMENT_TOO_LARGE", { maxBytes: 32 });
  assert.ok(cancelled); assert.ok(signal.aborted); assert.equal(body.locked, false);
});

test("M2: monotonic deadline rejects continuous reads while timer callbacks are held", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0, reads = 0, cancelled = false, signal;
  t.mock.method(performance, "now", () => now);
  const body = new ReadableStream({
    pull(c) { reads++; now += 1; c.enqueue(original); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  mock(t, async (_, init) => { signal = init.signal; return response(body); });
  await rejects("REQUEST_TIMEOUT", { timeoutMs: 10, maxBytes: 1024 });
  assert.equal(reads, 10); assert.ok(cancelled); assert.ok(signal.aborted);
  assert.equal(body.locked, false);
});

test("M2: deadline expiring during final metadata creation prevents success", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0, signal, metadataCreated = false;
  t.mock.method(performance, "now", () => now);
  const iso = Date.prototype.toISOString;
  t.mock.method(Date.prototype, "toISOString", function () {
    metadataCreated = true; now = 10;
    return iso.call(this);
  });
  const body = response();
  mock(t, async (_, init) => { signal = init.signal; return body; });
  await rejects("REQUEST_TIMEOUT", { timeoutMs: 10 });
  assert.ok(metadataCreated); assert.ok(signal.aborted); assert.equal(body.body.locked, false);
});
test("encoded HTTP representation rejected", async t => {
  mock(t, async () => response(original, { "content-encoding": "gzip" })); await rejects("INTEGRITY_ERROR");
});
test("optional independently pinned hash is enforced", async t => {
  mock(t, async () => response());
  await rejects("INTEGRITY_ERROR", { expectedSha256: "0".repeat(64) });
  await rejects("INTEGRITY_ERROR", { expectedSha256: "bad" });
  const expectedSha256 = createHash("sha256").update(original).digest("hex");
  assert.equal((await acquireAreraDocument(undefined, { expectedSha256 })).evidence.sha256, expectedSha256);
});
test("configuration cannot remove resource ceilings", async t => {
  const calls = mock(t, () => assert.fail("network forbidden"));
  for (const options of [{ maxBytes: 0 }, { maxBytes: Infinity }, { maxBytes: ARERA_ACQUISITION_LIMITS.maximumBytes + 1 }, { timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: ARERA_ACQUISITION_LIMITS.maximumTimeoutMs + 1 }])
    await rejects("INVALID_CONFIGURATION", options);
  assert.equal(calls.mock.callCount(), 0);
});
