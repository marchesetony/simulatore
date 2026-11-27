import assert from "node:assert/strict";
import { createUploadTarget, MAX_UPLOAD_BYTES, uploadedFile } from "../app/lib/foundation/large-upload.ts";
import { CTE_MAX_DOCUMENT_BYTES, validateCteUpload } from "../app/lib/cte/ingestion.ts";

// Tony (31/10): "IL LIMITE DI 10 MB BISOGNA ALZARLO". Bills and CTEs up to 20 MB; files above 4 MB go straight to
// storage through a signed URL (the hosting refuses bodies over ~4,5 MB) and the route reads them back by upload id.
assert.equal(MAX_UPLOAD_BYTES, 20_000_000);
assert.equal(CTE_MAX_DOCUMENT_BYTES, 20_000_000);
const pdf15mb = new Uint8Array(15_000_000); pdf15mb.set(new TextEncoder().encode("%PDF-1.7\n"));
assert.equal(validateCteUpload({ fileName: "cte.pdf", contentType: "application/pdf", bytes: pdf15mb }), "application/pdf");
assert.throws(() => validateCteUpload({ fileName: "cte.pdf", contentType: "application/pdf", bytes: new Uint8Array(20_000_001) }));

const stored = new Map();
const storage = {
  async createUploadTarget(tenantId, uploadId) { stored.set(`${tenantId}/${uploadId}`, new Uint8Array([1, 2, 3])); return { signedUrl: `https://storage.test/${uploadId}` }; },
  async takeUpload(tenantId, uploadId) { const key = `${tenantId}/${uploadId}`; const bytes = stored.get(key); if (!bytes) throw new Error("UPLOAD_NOT_FOUND"); stored.delete(key); return bytes; },
};
const target = await createUploadTarget(storage, "tenant_a");
assert.match(target.uploadId, /^upload_[a-f0-9]{32}$/);
assert.equal(target.maxBytes, 20_000_000);

const json = new Request("https://app.test/api/bills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId: target.uploadId, fileName: "bolletta.pdf", contentType: "application/pdf" }) });
const file = await uploadedFile(json, storage, "tenant_a");
assert.deepEqual([file.fileName, file.contentType, [...file.bytes]], ["bolletta.pdf", "application/pdf", [1, 2, 3]]);
assert.equal(stored.size, 0, "the temporary upload is removed once read");

// Another company's upload id is not reachable, and a malformed id is refused.
await createUploadTarget(storage, "tenant_b");
const [otherKey] = stored.keys();
await assert.rejects(uploadedFile(new Request("https://app.test/api/bills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId: otherKey.split("/")[1] }) }), storage, "tenant_a"));
assert.equal(await uploadedFile(new Request("https://app.test/api/bills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId: "../x" }) }), storage, "tenant_a"), null);

// Small files keep the ordinary multipart upload.
const form = new FormData(); form.set("file", new File([new Uint8Array([9])], "cte.pdf", { type: "application/pdf" }));
const small = await uploadedFile(new Request("https://app.test/api/cte/ingestion", { method: "POST", body: form }), storage, "tenant_a");
assert.deepEqual([small.fileName, [...small.bytes]], ["cte.pdf", [9]]);
console.log("large-upload ok");
