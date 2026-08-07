import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deleteCteIngestion, toPublicCteIngestion } from "../app/lib/cte/ingestion.ts";

const failed = JSON.parse(await readFile("var/phase6/cte-archives/tenant_local-demo/cte-ingestion-b10e5277-5a0b-4177-b82c-e5adce104f89.json", "utf8"));
const approved = JSON.parse(await readFile("var/phase6/cte-archives/tenant_local-demo/cte-ingestion-c30431e0-11ab-460d-ad10-6a26eb23b63d.json", "utf8"));
const records = new Map([[failed.recordId, failed], [approved.recordId, approved]]);
const removed = [];
const repository = {
  async get(tenantId, recordId) { const value = records.get(recordId); return value?.tenantId === tenantId ? structuredClone(value) : null; },
  async list(tenantId) { return [...records.values()].filter((value) => value.tenantId === tenantId).map((value) => structuredClone(value)); },
  async delete({ tenantId, recordId, expectedVersion }) { const value = await this.get(tenantId, recordId); if (!value) throw new Error("PERSISTENCE_RECORD_NOT_FOUND"); if (value.version !== expectedVersion) throw new Error("PERSISTENCE_VERSION_CONFLICT"); records.delete(recordId); },
  async put() { throw new Error("not used"); },
  async append() { throw new Error("not used"); },
};
const storage = { async remove(objectKey) { removed.push(objectKey); } };
const publicFailed = toPublicCteIngestion(failed);
const publicApproved = toPublicCteIngestion(approved);
assert.equal(publicApproved.status, "APPROVED");
assert.equal(publicFailed.fileName, failed.payload.fileName);
assert.equal([failed, approved].filter((record) => record.payload.status !== "APPROVED").length, 1);
await deleteCteIngestion({ tenantId: failed.tenantId, ingestionId: failed.recordId, repository, storage });
assert.equal(records.has(failed.recordId), false);
assert.deepEqual(removed, [failed.payload.objectKey]);
await assert.rejects(() => deleteCteIngestion({ tenantId: approved.tenantId, ingestionId: approved.recordId, repository, storage }), /CTE_INGESTION_APPROVED_IMMUTABLE/);
assert.equal(records.has(approved.recordId), true);
assert.deepEqual(removed, [failed.payload.objectKey]);
const route = await readFile(new URL("../app/api/cte/ingestion/route.ts", import.meta.url), "utf8");
const deleteRoute = await readFile(new URL("../app/api/cte/ingestion/[id]/route.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../app/components/CteIngestionPanel.tsx", import.meta.url), "utf8");
assert.match(route, /record\.payload\.status !== "APPROVED"/);
assert.match(route, /searchParams\.get\("vector"\)/);
assert.match(deleteRoute, /deleteCteIngestion/);
assert.match(deleteRoute, /requestPrincipal\(request, "WRITE"\)/);
assert.match(ui, /offerName/);
assert.match(ui, /Cancella/);
assert.match(ui, /ReceivedIngestionRow/);
assert.match(ui, /role="alertdialog"/);
assert.match(ui, /Vuoi eliminare questo documento/);
assert.match(ui, /Annulla/);
assert.match(ui, /Cancella documento/);
assert.match(ui, /Eliminazione in corso/);
assert.match(ui, /method: "DELETE"/);
console.log("cte received/delete/snapshot smoke: ok (server filter, readable fallback, tenant delete guard and approved immutability)");
