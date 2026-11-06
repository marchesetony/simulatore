import assert from "node:assert/strict";
import { purgeCompanyArchive } from "../app/lib/foundation/company-archive-purge.ts";

// Tony (31/10): "eliminiamo tutti gli archivi bolletta e cte, in modo da avere una pulizia totale e ricomenciare con tutto
// nuovo" (for his company only, "a"); "il cliente gestisce solo fatture e cte". Every bill and CTE of the company goes,
// with its PDF; other companies and official data are untouched.
const bills = [{ id: "b1", tenantId: "tenant_a" }, { id: "b2", tenantId: "tenant_a" }, { id: "b3", tenantId: "tenant_b" }];
const archives = [{ archiveId: "c1", tenantId: "tenant_a" }, { archiveId: "c2", tenantId: "tenant_b" }];
const ingestions = [{ recordId: "i1", tenantId: "tenant_a", version: 1, payload: { documentId: "i1" } }, { recordId: "i2", tenantId: "tenant_b", version: 1, payload: { documentId: "i2" } }];
const pdfs = new Set(["tenant_a:b1", "tenant_a:b2", "tenant_b:b3", "tenant_a:i1", "tenant_b:i2"]);
const audit = [];
const repositories = {
  bills: { async list(tenantId) { return bills.filter((bill) => bill.tenantId === tenantId); }, async delete(tenantId, id) { bills.splice(bills.findIndex((bill) => bill.tenantId === tenantId && bill.id === id), 1); } },
  ctes: { async list(tenantId) { return archives.filter((item) => item.tenantId === tenantId); }, async remove(tenantId, id) { archives.splice(archives.findIndex((item) => item.tenantId === tenantId && item.archiveId === id), 1); } },
  cteIngestions: { async list(tenantId) { return ingestions.filter((item) => item.tenantId === tenantId); }, async delete({ tenantId, recordId }) { ingestions.splice(ingestions.findIndex((item) => item.tenantId === tenantId && item.recordId === recordId), 1); } },
  storage: { async remove(tenantId, id) { if (!pdfs.delete(`${tenantId}:${id}`)) throw new Error("DOCUMENT_NOT_FOUND"); } },
  audit: { async record(event) { audit.push(event.type); } },
};
await assert.rejects(purgeCompanyArchive({ tenantId: "tenant_a", confirmation: "si", repositories }), /ARCHIVE_PURGE_CONFIRMATION_REQUIRED/, "nothing goes without typing SVUOTA");
assert.equal(bills.length, 3);
const result = await purgeCompanyArchive({ tenantId: "tenant_a", confirmation: "SVUOTA", repositories });
assert.deepEqual(result, { bills: 2, ctes: 1, cteDocuments: 1, failed: 0 });
assert.deepEqual(bills.map((bill) => bill.id), ["b3"], "the other company's bill stays");
assert.deepEqual(archives.map((item) => item.archiveId), ["c2"], "the other company's CTE stays");
assert.deepEqual([...pdfs].sort(), ["tenant_b:b3", "tenant_b:i2"], "only the company's PDFs are removed");
assert.ok(audit.includes("CTE_ARCHIVE_PURGED") && audit.includes("CTE_DOCUMENT_PURGED"), "each removal is audited");
console.log("COMPANY_ARCHIVE_PURGE=PASS");
