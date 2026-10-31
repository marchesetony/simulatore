import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approveDocumentVersion, createManualCorrection, ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { billReferenceDate, billTooOld, purgeOldBills } from "../app/lib/foundation/bill-retention.ts";

// Tony (31/10): "le bollette con date superiori a 5 mesi devono essere eliminati in automatico". The bill's date is the end of
// its billing period (upload date when unread); older than 5 calendar months = hidden from the lists and deleted nightly.
const root = await mkdtemp(path.join(os.tmpdir(), "bill-age-purge-"));
const tenant = "tenant_bill-age";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7 bill age", "latin1"));
const audit = { events: [], async record(event) { this.events.push(event); } };
const repository = new LocalBillRepository(root);
const storage = new LocalDocumentStorage(root);
const seed = async (period) => {
  let document = await ingestBill({ tenantId: tenant, fileName: "age.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit, extractor: { async extract() { return { text: `Supplier: S; POD: IT001E12345678; Customer: C; Periodo: ${period}; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20`, pages: 1 }; } } });
  for (const [field, item] of Object.entries(document.versions.at(-1).fields)) document = createManualCorrection({ document, tenantId: tenant, sourceVersionId: document.currentVersionId, field, value: field === "billingPeriod" ? item.value.replace(" - ", " al ").replace(/^/, "dal ") : `${item.value} verified`, at: "2026-10-01T00:00:00.000Z" });
  document = approveDocumentVersion({ document, tenantId: tenant, versionId: document.currentVersionId, at: "2026-10-01T00:01:00.000Z" });
  await repository.save(document);
  return document;
};
try {
  const old = await seed("01/01/2026 - 31/01/2026");
  const recent = await seed("01/09/2026 - 30/09/2026");
  assert.match(billReferenceDate(old), /^2026-01-31/);
  assert.equal(billTooOld(old, "2026-10-31T09:00:00.000Z"), true, "31/01 is more than 5 months before 31/10");
  assert.equal(billTooOld(recent, "2026-10-31T09:00:00.000Z"), false);
  assert.equal(billTooOld(old, "2026-06-30T00:00:00.000Z"), false, "exactly 5 months is kept");
  const result = await purgeOldBills({ tenantId: tenant, repositories: { bills: repository, storage, audit }, now: "2026-10-31T09:00:00.000Z" });
  assert.deepEqual(result, { scanned: 2, deleted: 1, failed: 0 });
  assert.equal(await repository.get(tenant, old.id), null);
  await assert.rejects(() => storage.read(tenant, old.id));
  assert.ok(await repository.get(tenant, recent.id));
  // Wiring: lists hide old bills now; the nightly job deletes them; the archive screen has the delete button.
  const list = await readFile(new URL("../app/api/bills/route.ts", import.meta.url), "utf8");
  const cron = await readFile(new URL("../app/api/cron/bill-retention/route.ts", import.meta.url), "utf8");
  const flow = await readFile(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
  assert.match(list, /!billTooOld\(document, now\)/);
  assert.match(cron, /purgeOldBills\(\{ tenantId, repositories: retentionRepositories, now \}\)/);
  assert.match(flow, /method: "DELETE"/);
  assert.match(flow, /Cancella bollette caricate/);
  console.log("bill age purge ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
