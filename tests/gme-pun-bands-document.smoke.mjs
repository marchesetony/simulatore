import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publishOfficialDocument, validateOfficialDocument, detectOfficialUpload, UPLOADABLE_DOCUMENTS } from "../app/lib/official-monitor/documents.ts";
import { listAlerts, upsertAlert } from "../app/lib/official-monitor/monitor.ts";
import { runPunMarketRefresh } from "../app/lib/market-refresh/service.ts";
import { estimateBillSpread } from "../app/lib/market/bill-spread.ts";
import { memoryRepository } from "./fixtures/official-monitor/synthetic-tit-xlsx.mjs";
import { syntheticGmeBandsPdf } from "./fixtures/official-monitor/synthetic-gme-bands-pdf.mjs";

/**
 * Tony (20/11/2026, "PUN maggio 2026 — approvazione delle sole fasce"): the GME "Prezzo medio per fasce" PDF of May 2026 is
 * conserved in the Control Room with its own SHA-256, its three bands are read from the document, and the producer's explicit
 * publication writes a new PUN version with F1, F2, F3 only. The monthly 119,35 is never approved, nor derived from the bands;
 * the rejected version and its audit stay as they are; other months and formulas are untouched. Synthetic PDF and archive.
 */
const NOW = "2026-11-20T18:00:00.000Z";
const CODE = "GME_PUN_BANDS_DOCUMENT";
const PDF_LINK = "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/20260601PrezzomedioperfasceMaggio2026.pdf";
const ZIP_SHA = "55a8e0fc7efe71ab4830a42991802415e0b03bc11fa434e444a59a9385a686a0";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rate = (value) => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });

class MarketMemory {
  constructor() { this.records = new Map(); }
  async get(tenantId, archiveId) { return structuredClone(this.records.get(`${tenantId}|${archiveId}`) ?? null); }
  async list(tenantId) { return [...this.records.values()].filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record)); }
  async save(record) { this.records.set(`${record.tenantId}|${record.archiveId}`, structuredClone(record)); }
}
const marketRecord = (tenantId, archiveId, month, version, status, values, source) => ({
  archiveId, tenantId, vector: "EE", index: "PUN", month, status, createdAt: "2026-10-22T16:09:02.017Z", updatedAt: "2026-11-02T08:19:48.037Z", approvals: [],
  history: [{ eventId: "e1", type: "CREATED", tenantId, recordId: archiveId, at: "2026-10-22T16:09:02.017Z", actor: "market-regulatory-auto-refresh", reason: null }, ...(status === "REJECTED" ? [{ eventId: "e2", type: "REJECTED", tenantId, recordId: archiveId, at: "2026-11-02T08:19:48.037Z", actor: "market-regulatory-auto-refresh", reason: "PUN_RETENTION_5_MONTHS" }] : [])],
  record: { schemaVersion: 1, recordId: archiveId, version: String(version), parentVersionId: null, tenantId, recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month, ...values, source, approval: { status }, publicationDate: null, effectiveFrom: `${month}-01`, effectiveTo: month === "2026-05" ? "2026-06-01" : "2026-07-01" },
});
const zipSource = { sourceId: "GME_MGP_ANNUAL_ARCHIVE", name: "GME MGP PUN Index GME PT15", url: "https://gme.mercatoelettrico.org/Home/Esiti/Elettricita/MGP/Statistiche/DatiStorici/moduleId/10874/controller/GmeDatiStoriciItem/action/DownloadFile?fileName=Anno2026.zip", authority: "GME", sourceType: "OFFICIAL", sourceSha256: ZIP_SHA };
const setup = async () => {
  const monitor = { alerts: memoryRepository(), checks: memoryRepository(), documents: memoryRepository(), publications: memoryRepository() };
  const market = new MarketMemory();
  // Archive as on 20/11/2026: May v1 from the yearly ZIP, rejected by the old five-month retention; June approved.
  await market.save(marketRecord("tenant_energia-priva", "gme-pun-2026-05", "2026-05", 1, "REJECTED", { monthly: rate(119.35125845766144), f1: rate(107.1740328522727), f2: rate(131.43756644444454), f3: rate(120.8147880959298) }, zipSource));
  await market.save(marketRecord("tenant_energia-priva", "gme-pun-2026-06-v2", "2026-06", 2, "APPROVED", { monthly: rate(132.50647222222221), f1: rate(125.76), f2: rate(151.7), f3: rate(127.24) }, { ...zipSource, sourceId: "GME_PREZZO_MEDIO_FASCE", url: "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/20260703PrezzomedioperfasceGiugno2026.pdf" }));
  return { monitor, market };
};
const pdf = syntheticGmeBandsPdf();
const validate = (monitor, bytes, download, period = "2026-05", now = NOW) => validateOfficialDocument(monitor, { code: CODE, period, originalName: "20260601PrezzomedioperfasceMaggio2026.pdf", bytes, uploadedBy: "user_owner", now, fetchOfficial: async (url) => (url === PDF_LINK ? download : null) });
const publish = (monitor, market, document, options = {}) => publishOfficialDocument(monitor, { documentId: document.documentId, confirmSha256: options.confirm ?? document.sha256, acknowledgeDeclaredProvenance: options.acknowledge ?? false, publishedBy: "user_owner", now: "2026-11-20T18:05:00.000Z", ...(market ? { market: { repository: market, tenants: ["tenant_piattaforma", "tenant_energia-priva"] } } : {}) });

// 1. The PDF is recognised from its content, conserved with its own fingerprint, and its three bands are read from it.
assert.ok(UPLOADABLE_DOCUMENTS.includes(CODE));
assert.deepEqual(detectOfficialUpload(pdf, { openAlerts: [], now: NOW }).period, "2026-05");
{
  const { monitor, market } = await setup();
  await upsertAlert(monitor, { code: CODE, period: "2026-05", reason: "PUN di maggio rifiutato dalla vecchia conservazione a 5 mesi", now: NOW });
  const { record } = await validate(monitor, pdf, pdf);
  assert.equal(record.status, "VALIDATED");
  assert.equal(record.sha256, sha(pdf)); assert.notEqual(record.sha256, ZIP_SHA, "the yearly ZIP fingerprint is never reused");
  assert.equal(Buffer.from(record.originalBase64, "base64").equals(Buffer.from(pdf)), true, "original conserved byte for byte");
  assert.equal(record.provenance.level, "MATCHES_OFFICIAL_DOWNLOAD"); assert.equal(record.provenance.officialLink, PDF_LINK);
  assert.deepEqual(record.marketValues, { month: "2026-05", f1: 107.17, f2: 131.44, f3: 120.81, hours: [220, 180, 344], unit: "EUR_PER_MWH" });
  assert.equal("monthly" in record.marketValues, false);
  assert.ok(record.checks.find((check) => check.code === "MONTHLY_NOT_RECORDED").ok);
  assert.equal(market.records.get("tenant_energia-priva|gme-pun-2026-05").status, "REJECTED", "validation makes nothing available");
  assert.equal((await listAlerts(monitor))[0].status, "FILE_UPLOADED");

  // Before the producer publishes, the automatic refresh does not rebuild May (monthly derived from the bands) nor approve it.
  const early = await runPunMarketRefresh({ tenantId: "tenant_energia-priva", repositories: { marketArchiveRepository: market, marketRefreshState: memoryRepository(), marketRefreshRuns: memoryRepository(), marketRefreshLocks: memoryRepository() }, sourceReader: { async load({ tenantId, referenceMonth }) {
    if (referenceMonth !== "2026-05") return { gmeError: "TEST_ONLY_MAY" };
    return { gme: { record: { schemaVersion: 1, recordId: "gme-pun-2026-05", version: "1", parentVersionId: null, tenantId, recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month: "2026-05", monthly: rate(119.34844086021506), f1: rate(107.17), f2: rate(131.44), f3: rate(120.81), source: { sourceId: "GME_PREZZO_MEDIO_FASCE", name: "GME Prezzo medio per fasce (mensile)", url: PDF_LINK, authority: "GME", sourceType: "OFFICIAL", sourceSha256: "a".repeat(64) }, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" }, publicationDate: null, effectiveFrom: "2026-05-01", effectiveTo: "2026-06-01" } } };
  } }, now: NOW, runId: "before-publication", trigger: "TEST" });
  assert.ok(early.errors.some((error) => error.startsWith("2026-05:")), "May is not rebuilt automatically");
  assert.deepEqual((await market.list("tenant_energia-priva")).filter((item) => item.month === "2026-05").map((item) => [item.archiveId, item.status]), [["gme-pun-2026-05", "REJECTED"]]);

  // 2. Publication needs the confirmation bound to the conserved fingerprint and the PUN archive.
  await assert.rejects(() => publish(monitor, market, record, { confirm: "0".repeat(64) }), /CONFIRMATION_MISMATCH/);
  await assert.rejects(() => publish(monitor, null, record), /MARKET_UNAVAILABLE/);
  const before = structuredClone([...market.records.values()]);
  const publication = await publish(monitor, market, record);

  // 3. New version with F1, F2, F3 only, linked to the rejected one; the rejected version and its audit are unchanged.
  const v2 = market.records.get("tenant_energia-priva|gme-pun-2026-05-v2");
  assert.equal(v2.status, "APPROVED"); assert.equal(v2.record.version, "2"); assert.equal(v2.record.parentVersionId, "gme-pun-2026-05");
  assert.deepEqual([v2.record.f1.value, v2.record.f2.value, v2.record.f3.value], [107.17, 131.44, 120.81]);
  assert.equal(v2.record.monthly, undefined, "the monthly 119,35 is never approved nor derived");
  assert.equal(v2.record.source.sourceSha256, sha(pdf)); assert.equal(v2.record.source.url, PDF_LINK); assert.equal(v2.record.source.sourceId, "GME_PREZZO_MEDIO_FASCE");
  assert.equal(v2.record.effectiveFrom, "2026-05-01"); assert.equal(v2.record.effectiveTo, "2026-06-01");
  assert.deepEqual(market.records.get("tenant_energia-priva|gme-pun-2026-05"), before.find((item) => item.archiveId === "gme-pun-2026-05" && item.tenantId === "tenant_energia-priva"));
  assert.deepEqual(market.records.get("tenant_energia-priva|gme-pun-2026-06-v2"), before.find((item) => item.archiveId === "gme-pun-2026-06-v2"), "other months untouched");
  const platform = market.records.get("tenant_piattaforma|gme-pun-2026-05");
  assert.equal(platform.status, "APPROVED"); assert.equal(platform.record.version, "1"); assert.equal(platform.record.monthly, undefined);
  assert.deepEqual(publication.marketRecords.map((item) => [item.tenantId, item.archiveId]), [["tenant_piattaforma", "gme-pun-2026-05"], ["tenant_energia-priva", "gme-pun-2026-05-v2"]]);
  assert.equal((await listAlerts(monitor))[0].status, "RESOLVED");
  await assert.rejects(() => publish(monitor, market, record), /ALREADY_PUBLISHED/);
  console.log("GME_BANDS_DOCUMENT_PUBLISHED_BANDS_ONLY=PASS");

  // 4. Band calculations read the published bands; no monthly value exists to be used.
  const official = (item) => item.record.source.authority === "GME";
  const bill = { vector: { value: "EE", status: "FOUND" }, f1Consumption: { value: 100, status: "FOUND" }, f2Consumption: { value: 80, status: "FOUND" }, f3Consumption: { value: 150, status: "FOUND" }, extendedFacts: [{ code: "PRICE_TIME_STRUCTURE_RAW", value: "a fasce", status: "FOUND" }], economicChargeLines: [], documentPriceRows: [{ page: 1, label: "PUN F1", period: null, unitPrice: "0,10717" }, { page: 1, label: "SPREAD", period: null, unitPrice: "0,01" }] };
  const spread = estimateBillSpread(bill, ["2026-05"], await market.list("tenant_energia-priva"), official, "2026-11-20");
  assert.deepEqual(spread.referenceBands.map((item) => Math.round(item.pun * 1e5) / 1e5), [0.10717, 0.13144, 0.12081]);
  assert.equal((await market.list("tenant_energia-priva")).filter((item) => item.month === "2026-05" && item.status === "APPROVED").every((item) => item.record.monthly === undefined), true);

  // 5. The automatic refresh never replaces nor completes that version: same bands → unchanged; other readings → reported only.
  const repositories = { marketArchiveRepository: market, marketRefreshState: memoryRepository(), marketRefreshRuns: memoryRepository(), marketRefreshLocks: memoryRepository() };
  const reader = (f1) => ({ async load({ tenantId, referenceMonth }) {
    if (referenceMonth !== "2026-05") return { gmeError: "TEST_ONLY_MAY" };
    return { gme: { record: { schemaVersion: 1, recordId: "gme-pun-2026-05", version: "1", parentVersionId: null, tenantId, recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month: "2026-05", monthly: rate(119.34844086021506), f1: rate(f1), f2: rate(131.44), f3: rate(120.81), source: { sourceId: "GME_PREZZO_MEDIO_FASCE", name: "GME Prezzo medio per fasce (mensile)", url: PDF_LINK, authority: "GME", sourceType: "OFFICIAL", sourceSha256: "a".repeat(64) }, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" }, publicationDate: null, effectiveFrom: "2026-05-01", effectiveTo: "2026-06-01" } } };
  } });
  const count = async () => (await market.list("tenant_energia-priva")).filter((item) => item.month === "2026-05").length;
  const same = await runPunMarketRefresh({ tenantId: "tenant_energia-priva", repositories, sourceReader: reader(107.17), now: NOW, runId: "bands-same", trigger: "TEST" });
  assert.equal(same.monthsUnchanged, 1); assert.equal(await count(), 2);
  const other = await runPunMarketRefresh({ tenantId: "tenant_energia-priva", repositories, sourceReader: reader(107.1740328522727), now: "2026-11-20T18:10:00.000Z", runId: "bands-other", trigger: "TEST" });
  assert.ok(other.errors.includes("2026-05:PUN_PUBLISHED_BANDS_DIFFER")); assert.equal(await count(), 2);
  assert.equal(market.records.get("tenant_energia-priva|gme-pun-2026-05-v2").record.monthly, undefined);
  console.log("GME_BANDS_DOCUMENT_REFRESH_NEVER_OVERRIDES=PASS");
}

// 6. Provenance: different bands from the GME download → blocked; same bands, different file → only with explicit confirmation.
{
  const { monitor, market } = await setup();
  const { record: differs } = await validate(monitor, syntheticGmeBandsPdf({ f1: "107,18" }), pdf);
  assert.equal(differs.status, "REJECTED"); assert.equal(differs.provenance.level, "DIFFERS_FROM_OFFICIAL_DOWNLOAD"); assert.equal(differs.marketValues, null);
  const variant = syntheticGmeBandsPdf({ note: "copia salvata di nuovo" });
  const { record: equivalent } = await validate(monitor, variant, pdf);
  assert.equal(equivalent.status, "VALIDATED"); assert.equal(equivalent.provenance.level, "EQUIVALENT_TO_OFFICIAL_DOWNLOAD");
  await assert.rejects(() => publish(monitor, market, equivalent), /PROVENANCE_ACK_REQUIRED/);
  assert.equal(market.records.has("tenant_energia-priva|gme-pun-2026-05-v2"), false);
  console.log("GME_BANDS_DOCUMENT_PROVENANCE=PASS");
}

// 7. Only months of the operational window; wrong month in the document; a file that is not the GME PDF.
{
  const { monitor } = await setup();
  assert.equal((await validate(monitor, syntheticGmeBandsPdf({ month: "Aprile 2026", hours: [210, 168, 342] }), null, "2026-04")).record.status, "REJECTED");
  assert.equal((await validate(monitor, pdf, null, "2026-06")).record.checks.find((check) => check.code === "VALUES").ok, false, "May PDF is not June");
  assert.equal((await validate(monitor, new Uint8Array(Buffer.from("not a pdf")), null)).record.status, "REJECTED");
  // From 1 December May leaves the window: validation refuses it.
  const late = await validate(monitor, pdf, pdf, "2026-05", "2026-12-01T10:00:00.000Z");
  assert.equal(late.record.status, "REJECTED"); assert.equal(late.record.checks.find((check) => check.code === "OPERATIONAL_WINDOW").ok, false);
  console.log("GME_BANDS_DOCUMENT_WINDOW=PASS");
}
