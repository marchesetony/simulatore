import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { approveDocumentVersion, createManualCorrection, ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { requestJson } from "../app/lib/ui/client.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "bill-delete-smoke-"));
const tenant = "tenant_bill-delete";
const otherTenant = "tenant_other-delete";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill-delete-smoke", "latin1"));
const audit = { async record() {} };
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);
const exists = async (file) => { try { await access(file, constants.F_OK); return true; } catch { return false; } };
const deleteCore = async (tenantId, id) => {
  const document = await repository.get(tenantId, id);
  if (!document) return { status: 200, deleted: true };
  if (document.currentApprovedVersionId !== null) return { status: 409, code: "BILL_APPROVED_DELETE_FORBIDDEN" };
  await storage.remove(document.objectKey);
  await repository.delete(tenantId, id);
  return { status: 200, deleted: true };
};
const seedFailure = (seedTenant, error) => ingestBill({ tenantId: seedTenant, fileName: "offline.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, extractor: { async extract() { throw new Error(error); } } });

try {
  const failed = await seedFailure(tenant, "BILL_EXTRACTION_REQUIRED_FIELD_MISSING");
  const failedKey = failed.objectKey;
  assert.deepEqual(await deleteCore(tenant, failed.id), { status: 200, deleted: true });
  assert.equal(await repository.get(tenant, failed.id), null);
  assert.equal(await exists(failedKey), false);

  const legacy = await seedFailure(tenant, "OCR_PROVIDER_REQUIRED");
  const legacyKey = legacy.objectKey;
  assert.deepEqual(await deleteCore(tenant, legacy.id), { status: 200, deleted: true });
  assert.equal(await repository.get(tenant, legacy.id), null);
  assert.equal(await exists(legacyKey), false);

  const approvedSeed = await ingestBill({ tenantId: tenant, fileName: "approved.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, extractor: { async extract() { return { text: "Supplier: S; POD: IT001E12345678; Customer: C; Periodo: 01/01/2026 - 31/01/2026; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20", pages: 1 }; } } });
  let working = approvedSeed;
  for (const [field, item] of Object.entries(working.versions.at(-1).fields)) working = createManualCorrection({ document: working, tenantId: tenant, sourceVersionId: working.currentVersionId, field, value: `${item.value} verified`, at: "2026-08-13T12:00:00.000Z" });
  const approved = approveDocumentVersion({ document: working, tenantId: tenant, versionId: working.currentVersionId, at: "2026-08-13T12:01:00.000Z" });
  await repository.save(approved);
  assert.deepEqual(await deleteCore(tenant, approved.id), { status: 409, code: "BILL_APPROVED_DELETE_FORBIDDEN" });
  assert.ok(await repository.get(tenant, approved.id));
  assert.equal(await exists(approved.objectKey), true);

  assert.deepEqual(await deleteCore(tenant, "missing-document-id"), { status: 200, deleted: true });
  const crossTenant = await seedFailure(otherTenant, "OCR_PROVIDER_REQUIRED");
  assert.deepEqual(await deleteCore(tenant, crossTenant.id), { status: 200, deleted: true });
  assert.ok(await repository.get(otherTenant, crossTenant.id));
  assert.equal(await exists(crossTenant.objectKey), true);

  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8");
  const panel = await (await import("node:fs/promises")).readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /export async function DELETE/);
  assert.match(source, /requestPrincipal\(request, "WRITE"\)/);
  assert.match(source, /documentStorage\.remove\(document\.objectKey\)/);
  assert.match(source, /billRepository\.delete\(principal\.tenantId, id\)/);
  assert.match(panel, /requestJson\("\/api\/bills\/" \+ encodeURIComponent\(id\), \{ method: "DELETE" \}\)/);
  assert.match(panel, /setSelected\(null\)/);
  assert.match(panel, /await load\(\)/);
  assert.match(panel, /Documento cancellato/);

  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method ?? "GET", credentials: init?.credentials }); return Response.json({ deleted: true }); };
  try {
    assert.deepEqual(await requestJson("/api/bills/document-delete-test", { method: "DELETE" }), { deleted: true });
    assert.deepEqual(calls[0], { url: "/api/bills/document-delete-test", method: "DELETE", credentials: "same-origin" });
  } finally { globalThis.fetch = previousFetch; }

  const errorFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: "BILL_APPROVED_DELETE_FORBIDDEN", message: "bounded" } }, { status: 409 });
  try { await assert.rejects(() => requestJson("/api/bills/document-delete-test", { method: "DELETE" }), (error) => error.code === "BILL_APPROVED_DELETE_FORBIDDEN"); } finally { globalThis.fetch = errorFetch; }
  console.log("bill delete smoke: ok (failed/legacy deletion, approved policy, bounded tenant/ID handling, route/UI/client wiring)");
} finally {
  await rm(root, { recursive: true, force: true });
}
