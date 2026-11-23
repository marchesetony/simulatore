import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createServiceStore, memoryBackend, WRITABLE_COLLECTIONS } from "../services/dati-ufficiali/src/store.ts";
import { handle, SCHEDULE, AUDIT_MONTHS } from "../services/dati-ufficiali/src/handler.ts";
import { readNewsletterPdf, newsletterCandidates } from "../services/dati-ufficiali/src/gme/newsletter.ts";
import { assertOfficialUrl, createOfficialFetch } from "../services/dati-ufficiali/src/official-fetch.ts";
import { conservedBytes } from "../services/dati-ufficiali/src/documents.ts";
import { RegulatoryApprovalDomainService, OFFICIAL_DATA_SERVICE_PRINCIPAL } from "../app/lib/regulatory-approval-domain.ts";
import { syntheticGmeBandsPdf } from "./fixtures/official-monitor/synthetic-gme-bands-pdf.mjs";
import { syntheticGmeNewsletterPdf } from "./fixtures/official-data-service/synthetic-gme-newsletter-pdf.mjs";

/**
 * Tony (21/11/2026, "Automazione GME/ARERA/Terna — servizio Vercel indipendente", opzione A): the official data service
 * downloads, checks, conserves, versions and publishes official data by itself, with a dedicated technical identity and only
 * on the official data collections. GME monthly value (newsletter, Tabella 1) and F1/F2/F3 ("Prezzo medio per fasce" PDF) are
 * distinct series from distinct conserved documents; nothing is derived; nothing is published unless every check passes;
 * May 2026 becomes a new version and the rejected one stays as it is; June–October are only audited. Synthetic documents and
 * archive; no network, no Supabase.
 */
const NOW = "2026-11-21T05:20:00.000Z";
const SECRET = "test-cron-secret-0123456789";
const ENV = { CRON_SECRET: SECRET, OFFICIAL_DATA_SERVICE_MODE: "publish", OFFICIAL_DATA_TENANT_IDS: "tenant_energia-priva" };
const ZIP_SHA = "55a8e0fc7efe71ab4830a42991802415e0b03bc11fa434e444a59a9385a686a0";
const PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce";
const BANDS_URL = (file) => `https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/${file}`;
const NL = (date) => `https://www.mercatoelettrico.org/Portals/0/Documents/Newsletter/${date}Newsletter.pdf`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rate = (value) => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });
const MONTHS_IT = { "2026-05": "Maggio 2026", "2026-06": "Giugno 2026", "2026-07": "Luglio 2026", "2026-08": "Agosto 2026", "2026-09": "Settembre 2026", "2026-10": "Ottobre 2026" };
const BAND_FILES = { "2026-05": "20260601PrezzomedioperfasceMaggio2026.pdf", "2026-06": "20260703PrezzomedioperfasceGiugno2026.pdf", "2026-07": "20260803PrezzomedioperfasceLuglio2026.pdf", "2026-08": "20260902PrezzomedioperfasceAgosto2026.pdf", "2026-09": "20260930PrezzomedioperfasceSettembre2026.pdf", "2026-10": "20261103PrezzomedioperfasceOttobre2026.pdf" };
const HOURS = { "2026-05": [220, 180, 344], "2026-06": [220, 196, 304], "2026-07": [253, 207, 284], "2026-08": [220, 192, 332], "2026-09": [242, 198, 280], "2026-10": [242, 198, 305] };
const BANDS = { "2026-05": ["107,17", "131,44", "120,81"], "2026-06": ["125,76", "151,70", "127,24"], "2026-07": ["150,10", "170,22", "155,31"], "2026-08": ["175,40", "190,11", "178,25"], "2026-09": ["201,15", "222,40", "203,10"], "2026-10": ["226,30", "241,05", "228,80"] };
const MONTHLY = { "2026-05": "119,35", "2026-06": "132,50", "2026-07": "157,04", "2026-08": "180,00", "2026-09": "207,54", "2026-10": "230,82" };
const NEWSLETTER_DATES = { "2026-05": "20260615", "2026-06": "20260714", "2026-07": "20260810", "2026-08": "20260915", "2026-09": "20261014", "2026-10": "20261116" };
const num = (text) => Number(text.replace(",", "."));

/** The GME site as seen by the service: bands page with links, bands PDFs, newsletters; everything else 404. */
function gmeSite(overrides = {}) {
  const calls = [];
  const files = new Map();
  const pageLinks = Object.entries(BAND_FILES).map(([month, file]) => `<a href="/Portals/0/Documents/it-IT/${file}">Prezzo medio per fasce - ${MONTHS_IT[month]}</a>`).join("");
  files.set(PAGE, { body: new TextEncoder().encode(`<html><body>${overrides.pageLinks ?? pageLinks}</body></html>`), type: "text/html" });
  for (const [month, file] of Object.entries(BAND_FILES)) {
    const [f1, f2, f3] = BANDS[month];
    files.set(BANDS_URL(file), { body: syntheticGmeBandsPdf({ month: MONTHS_IT[month], f1, f2, f3, hours: HOURS[month] }), type: "application/pdf" });
  }
  for (const [month, date] of Object.entries(NEWSLETTER_DATES)) {
    files.set(NL(date), { body: syntheticGmeNewsletterPdf({ number: String(203 + Object.keys(NEWSLETTER_DATES).indexOf(month) + 1), reportMonth: MONTHS_IT[month], baseload: MONTHLY[month], prose: MONTHLY[month] }), type: "application/pdf" });
  }
  for (const [url, value] of Object.entries(overrides.files ?? {})) { if (value === null) files.delete(url); else files.set(url, value); }
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    if (overrides.status?.[url]) return new Response("errore", { status: overrides.status[url] });
    const file = files.get(url);
    if (!file) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if ((init.method ?? "GET") === "HEAD") return new Response(null, { status: 200, headers: { "content-type": file.type } });
    return new Response(file.body, { status: 200, headers: { "content-type": file.type } });
  };
  return { fetchImpl, calls, files };
}

const archive = (tenantId, archiveId, month, version, status, values, source, by = "market-regulatory-auto-refresh") => ({
  collection: "market-archives", tenantId, recordId: archiveId, payload: {
    archiveId, tenantId, vector: "EE", index: "PUN", month, status, createdAt: "2026-10-22T16:09:02.017Z", updatedAt: "2026-11-02T08:19:48.037Z", approvals: [],
    history: [{ eventId: `e-${archiveId}`, type: "CREATED", tenantId, recordId: archiveId, at: "2026-10-22T16:09:02.017Z", actor: by, reason: null }],
    record: { schemaVersion: 1, recordId: archiveId, version: String(version), parentVersionId: null, tenantId, recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month, ...values, source, approval: status === "APPROVED" ? { status, reviewer: by, reviewedAt: "2026-11-06T16:38:00.000Z", decisionId: `d-${archiveId}` } : { status, reason: "PUN_RETENTION_5_MONTHS" }, publicationDate: null, effectiveFrom: `${month}-01`, effectiveTo: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10) },
  },
});
const zipSource = { sourceId: "GME_MGP_ANNUAL_ARCHIVE", name: "GME MGP PUN Index GME PT15", url: "https://gme.mercatoelettrico.org/Home/Esiti/Elettricita/MGP/Statistiche/DatiStorici/moduleId/10874/controller/GmeDatiStoriciItem/action/DownloadFile?fileName=Anno2026.zip", authority: "GME", sourceType: "OFFICIAL", sourceSha256: ZIP_SHA };
/** The archive as on 21/11/2026: May v1 rejected (ZIP); June–October approved by the earlier automation, monthly derived. */
function seed({ augustMonthly = 180.0012 } = {}) {
  const legacy = (month, monthly) => archive("tenant_energia-priva", `gme-pun-${month}-v2`, month, 2, "APPROVED", { monthly: rate(monthly), f1: rate(num(BANDS[month][0])), f2: rate(num(BANDS[month][1])), f3: rate(num(BANDS[month][2])) }, { sourceId: "GME_PREZZO_MEDIO_FASCE", name: "GME Prezzo medio per fasce (mensile)", url: BANDS_URL(BAND_FILES[month]), authority: "GME", sourceType: "OFFICIAL", sourceSha256: "a".repeat(64) });
  return [
    archive("tenant_energia-priva", "gme-pun-2026-05", "2026-05", 1, "REJECTED", { monthly: rate(119.35125845766144), f1: rate(107.1740328522727), f2: rate(131.43756644444454), f3: rate(120.8147880959298) }, zipSource),
    legacy("2026-06", 132.50647222222221), legacy("2026-07", 157.0391), legacy("2026-08", augustMonthly), legacy("2026-09", 207.54125), legacy("2026-10", 230.8199),
    { collection: "companies", tenantId: "tenant_piattaforma", recordId: "company-energia-priva", payload: { tenantId: "tenant_energia-priva", name: "Energia Priva" } },
    { collection: "bills", tenantId: "tenant_energia-priva", recordId: "bill-1", payload: { untouched: true } },
    { collection: "cte-records", tenantId: "tenant_energia-priva", recordId: "cte-1", payload: { untouched: true } },
  ];
}
const request = (job, secret = SECRET, method = "GET") => new Request(`https://servizio.example/api/run?job=${job}`, { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} });
const run = async (job, backend, site, env = ENV, now = NOW) => {
  const response = await handle(request(job), env, { store: createServiceStore(backend), fetchImpl: site.fetchImpl, now: () => now, sleep: async () => undefined });
  return { status: response.status, body: await response.json() };
};
const pun = (backend, tenantId, month) => [...backend.rows.values()].filter((row) => row.collection === "market-archives" && row.tenantId === tenantId && row.payload.month === month).map((row) => row.payload).sort((a, b) => Number(a.record.version) - Number(b.record.version));
const rows = (backend, collection) => [...backend.rows.values()].filter((row) => row.collection === collection);

// 1. Guard: only the official data collections, no delete, append-only documents and runs.
{
  const store = createServiceStore(memoryBackend());
  for (const forbidden of ["bills", "cte-records", "proposals", "calculations", "comparisons", "foundation-memberships", "customers", "offers", "companies"]) assert.throws(() => store.writable(forbidden), /SERVICE_COLLECTION_NOT_WRITABLE/, forbidden);
  assert.throws(() => store.readOnly("bills"), /SERVICE_COLLECTION_FORBIDDEN/);
  const documents = store.writable("official-service-documents");
  assert.equal(typeof documents.delete, "undefined");
  await documents.append({ tenantId: "tenant_piattaforma", recordId: "d1", payload: {} });
  await assert.rejects(documents.put({ tenantId: "tenant_piattaforma", recordId: "d1", payload: {}, expectedVersion: 1 }), /APPEND_ONLY/);
  assert.ok(!WRITABLE_COLLECTIONS.some((name) => /bill|cte|proposal|customer|offer|calculation|comparison|membership|compan/.test(name)));
}

// 2. Only its own scheduled calls: secret, method, job.
{
  const store = createServiceStore(memoryBackend());
  assert.equal((await handle(request("gme", null), ENV, { store })).status, 401);
  assert.equal((await handle(request("gme", "wrong-secret-0123456789"), ENV, { store })).status, 401);
  assert.equal((await handle(request("gme"), { ...ENV, CRON_SECRET: "short" }, { store })).status, 401, "a weak secret is refused");
  assert.equal((await handle(request("gme", SECRET, "POST"), ENV, { store })).status, 405);
  assert.equal((await handle(request("delete-bills"), ENV, { store })).status, 400);
}

// 3. Only official hosts; redirects to another host refused.
{
  assert.throws(() => assertOfficialUrl("https://example.com/x.pdf"), /OFFICIAL_HOST_NOT_ALLOWED/);
  assert.throws(() => assertOfficialUrl("http://gme.mercatoelettrico.org/x.pdf"), /OFFICIAL_HOST_NOT_ALLOWED/);
  const official = createOfficialFetch({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.pdf" } }), now: () => NOW, sleep: async () => undefined });
  await assert.rejects(official.fetch("https://gme.mercatoelettrico.org/a.pdf"), /OFFICIAL_HOST_NOT_ALLOWED/);
  let attempts = 0;
  const flaky = createOfficialFetch({ fetchImpl: async () => { attempts += 1; return new Response("x", { status: 503 }); }, now: () => NOW, sleep: async () => undefined });
  await assert.rejects(flaky.fetch("https://gme.mercatoelettrico.org/a.pdf"), /OFFICIAL_HTTP_503/);
  assert.equal(attempts, 3, "a 503 is retried a bounded number of times");
  attempts = 0;
  const missing = createOfficialFetch({ fetchImpl: async () => { attempts += 1; return new Response("x", { status: 404 }); }, now: () => NOW, sleep: async () => undefined });
  assert.equal((await missing.fetch("https://gme.mercatoelettrico.org/a.pdf")).status, 404);
  assert.equal(attempts, 1, "a 404 is not retried");
}

// 4. Newsletter reader: the monthly value only from Tabella 1 of the report on that month.
{
  const ok = readNewsletterPdf(syntheticGmeNewsletterPdf(), "2026-05");
  assert.equal(ok.monthly, 119.35); assert.equal(ok.number, "204");
  assert.equal(readNewsletterPdf(syntheticGmeNewsletterPdf(), "2026-06").monthly, null, "report on May is not June");
  assert.equal(readNewsletterPdf(syntheticGmeNewsletterPdf({ withTable: false }), "2026-05").monthly, null, "a chart or commentary alone is not a source");
  assert.equal(readNewsletterPdf(syntheticGmeNewsletterPdf({ prose: "118,90" }), "2026-05").monthly, null, "commentary and table must agree");
  assert.equal(readNewsletterPdf(syntheticGmeNewsletterPdf({ extraReport: "Aprile 2026" }), "2026-05").monthly, null, "two report months: ambiguous");
  assert.equal(readNewsletterPdf(new TextEncoder().encode("<html>404</html>"), "2026-05").monthly, null);
  assert.ok(newsletterCandidates("2026-05").includes(NL("20260615")) && newsletterCandidates("2026-05").every((url) => /^https:\/\/(?:www|gme)\.mercatoelettrico\.org\/Portals\/0\/Documents\/Newsletter\/202606\d\dNewsletter\.pdf$/.test(url)));
}

// 5. Dry run (default mode): downloads and checks, writes nothing to archives or documents.
{
  const backend = memoryBackend(seed()); const site = gmeSite();
  const before = structuredClone([...backend.rows.entries()]);
  const { status, body } = await run("gme", backend, site, { ...ENV, OFFICIAL_DATA_SERVICE_MODE: undefined });
  assert.equal(status, 200); assert.equal(body.mode, "DRY_RUN");
  const may = body.months.find((month) => month.month === "2026-05");
  assert.equal(may.state, "READY_DRY_RUN"); assert.deepEqual([may.bands.f1, may.bands.f2, may.bands.f3, may.monthly.value], [107.17, 131.44, 120.81, 119.35]);
  for (const month of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) assert.equal(body.months.find((item) => item.month === month).state, "LEGACY_AUDIT", month);
  assert.deepEqual(new Set(backend.writes.map((write) => write.collection)), new Set(["official-service-locks", "official-service-runs"]), "dry run: only the lease and the run report");
  for (const [key, row] of before) if (!key.startsWith("official-service-")) assert.deepEqual(backend.rows.get(key), row);
}

// 6. Publication: May 2026 = new version with F1/F2/F3 from the bands PDF and the monthly value from the newsletter.
const backend = memoryBackend(seed()); const site = gmeSite();
const rejectedBefore = structuredClone(pun(backend, "tenant_energia-priva", "2026-05")[0]);
const legacyBefore = Object.fromEntries(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month) => [month, structuredClone(pun(backend, "tenant_energia-priva", month))]));
{
  const { status, body } = await run("gme", backend, site);
  assert.equal(status, 200); assert.equal(body.mode, "PUBLISH"); assert.equal(body.identity, OFFICIAL_DATA_SERVICE_PRINCIPAL);
  const may = pun(backend, "tenant_energia-priva", "2026-05");
  assert.equal(may.length, 2);
  assert.deepEqual(may[0], rejectedBefore, "the rejected version and its history stay exactly as they were");
  const v2 = may[1];
  assert.equal(v2.archiveId, "gme-pun-2026-05-v2"); assert.equal(v2.status, "APPROVED"); assert.equal(v2.record.version, "2"); assert.equal(v2.record.parentVersionId, "gme-pun-2026-05");
  assert.deepEqual([v2.record.f1.value, v2.record.f2.value, v2.record.f3.value], [107.17, 131.44, 120.81]);
  assert.equal(v2.record.monthly.value, 119.35, "monthly value as printed by GME, not 119,35126 nor a mean of the bands");
  assert.notEqual(v2.record.source.sourceSha256, ZIP_SHA);
  const components = v2.record.officialComponents;
  assert.equal(components.bands.sha256, sha(site.files.get(BANDS_URL(BAND_FILES["2026-05"])).body));
  assert.equal(components.monthly.sha256, sha(site.files.get(NL("20260615")).body));
  assert.equal(components.monthly.url, NL("20260615")); assert.equal(components.monthly.newsletter, "204");
  assert.ok(v2.approvals.every((approval) => approval.reviewer === OFFICIAL_DATA_SERVICE_PRINCIPAL) && v2.history.every((event) => event.actor === OFFICIAL_DATA_SERVICE_PRINCIPAL));
  const platform = pun(backend, "tenant_piattaforma", "2026-05");
  assert.equal(platform.length, 1); assert.equal(platform[0].archiveId, "gme-pun-2026-05"); assert.equal(platform[0].status, "APPROVED");
  for (const month of Object.keys(legacyBefore)) assert.deepEqual(pun(backend, "tenant_energia-priva", month), legacyBefore[month], `${month} untouched`);
  // The two documents are conserved byte for byte with their fingerprint.
  const documents = rows(backend, "official-service-documents").map((row) => row.payload).filter((doc) => doc.period === "2026-05");
  assert.deepEqual(documents.map((doc) => doc.kind).sort(), ["GME_NEWSLETTER_PDF", "GME_PUN_BANDS_PDF"]);
  for (const doc of documents) { assert.equal(sha(conservedBytes(doc)), doc.sha256); assert.equal(doc.retrievedBy, OFFICIAL_DATA_SERVICE_PRINCIPAL); assert.ok(doc.checks.every((check) => check.ok)); }
  // Control Room: a check with source, values and next check; no open alert for May.
  const checks = rows(backend, "official-checks").map((row) => row.payload).filter((check) => check.period === "2026-05");
  assert.equal(checks.length, 1); assert.equal(checks[0].outcome, "ACQUIRED"); assert.match(checks[0].detail, /F1 107\.17 · F2 131\.44 · F3 120\.81/); assert.match(checks[0].detail, /mensile 119\.35/); assert.match(checks[0].detail, /prossima verifica/);
  // Bills and CTE never touched.
  assert.ok(!backend.writes.some((write) => /bill|cte|compan/.test(write.collection)));
  assert.ok(rows(backend, "official-service-runs").length >= 1);
}

// 7. Idempotent: the next day the same documents give no new version.
{
  const writesBefore = backend.writes.filter((write) => write.collection === "market-archives").length;
  const { body } = await run("gme", backend, site, ENV, "2026-11-22T05:20:00.000Z");
  assert.equal(body.months.find((month) => month.month === "2026-05").state, "UNCHANGED");
  assert.equal(backend.writes.filter((write) => write.collection === "market-archives").length, writesBefore);
  assert.equal(pun(backend, "tenant_energia-priva", "2026-05").length, 2);
}

// 8. Bands first, monthly later: a document with only F1/F2/F3 publishes only those; the newsletter adds the monthly value.
{
  const early = memoryBackend(seed()); const noNewsletter = gmeSite({ files: { [NL("20260615")]: null } });
  const { body } = await run("gme", early, noNewsletter);
  const may = body.months.find((month) => month.month === "2026-05");
  assert.equal(may.state, "PUBLISHED"); assert.equal(may.monthly, null);
  const v2 = pun(early, "tenant_energia-priva", "2026-05")[1];
  assert.equal(v2.record.monthly, undefined, "no monthly value without its document");
  assert.deepEqual([v2.record.f1.value, v2.record.f2.value, v2.record.f3.value], [107.17, 131.44, 120.81]);
  assert.ok(!rows(early, "official-alerts").some((row) => row.payload.period === "2026-05" && row.payload.status === "OPEN"), "a newsletter not yet published is not an anomaly");
  await run("gme", early, gmeSite(), ENV, "2026-11-22T05:20:00.000Z");
  const versions = pun(early, "tenant_energia-priva", "2026-05");
  assert.equal(versions.length, 3); assert.equal(versions[2].record.parentVersionId, "gme-pun-2026-05-v2");
  assert.equal(versions[2].record.monthly.value, 119.35); assert.equal(versions[2].record.officialComponents.bands.sha256, v2.record.officialComponents.bands.sha256);
}

// 9. Checks that fail block publication and open an alert; nothing presumed.
{
  const inconsistent = memoryBackend(seed());
  await run("gme", inconsistent, gmeSite({ files: { [NL("20260615")]: { body: syntheticGmeNewsletterPdf({ baseload: "150,00", prose: "150,00" }), type: "application/pdf" } } }));
  assert.equal(pun(inconsistent, "tenant_energia-priva", "2026-05").length, 1, "documents inconsistent with each other: nothing published");
  assert.ok(rows(inconsistent, "official-alerts").some((row) => row.payload.period === "2026-05" && row.payload.status === "OPEN" && /GME_MONTHLY_INCONSISTENT/.test(row.payload.reason)));

  const down = memoryBackend(seed()); const siteDown = gmeSite({ status: { [BANDS_URL(BAND_FILES["2026-05"])]: 503 }, files: { [NL("20260615")]: null } });
  const { body } = await run("gme", down, siteDown);
  assert.equal(body.months.find((month) => month.month === "2026-05").state, "FAILED");
  assert.equal(siteDown.calls.filter((call) => call.url === BANDS_URL(BAND_FILES["2026-05"])).length, 3, "bounded retries");
  assert.equal(pun(down, "tenant_energia-priva", "2026-05").length, 1, "no data presumed");
  assert.ok(rows(down, "official-alerts").some((row) => row.payload.period === "2026-05" && row.payload.status === "OPEN" && /503/.test(row.payload.reason)));
  assert.ok(rows(down, "official-checks").some((row) => row.payload.period === "2026-05" && row.payload.outcome === "FAILED"));

  const wrongMonth = memoryBackend(seed());
  await run("gme", wrongMonth, gmeSite({ files: { [BANDS_URL(BAND_FILES["2026-05"])]: { body: syntheticGmeBandsPdf({ month: "Giugno 2026" }), type: "application/pdf" } }, pageLinks: `<a href="/Portals/0/Documents/it-IT/${BAND_FILES["2026-05"]}">Prezzo medio per fasce - Maggio 2026</a>` }));
  assert.equal(pun(wrongMonth, "tenant_energia-priva", "2026-05").length, 1, "bands of another month: nothing published, not even the monthly value");
  assert.ok(rows(wrongMonth, "official-alerts").some((row) => row.payload.period === "2026-05" && /GME_BANDS_CHECKS/.test(row.payload.reason)));

  const foreign = memoryBackend(seed()); const foreignSite = gmeSite({ pageLinks: `<a href="https://evil.example/20260601PrezzomedioperfasceMaggio2026.pdf">Prezzo medio per fasce - Maggio 2026</a>` });
  await run("gme", foreign, foreignSite);
  assert.ok(!foreignSite.calls.some((call) => /evil/.test(call.url)), "a link to another host is never followed");
}

// 10. Window: from 1 December May is no longer acquired nor published.
{
  const december = memoryBackend(seed());
  const { body } = await run("gme", december, gmeSite(), ENV, "2026-12-01T05:20:00.000Z");
  assert.ok(!body.months.some((month) => month.month === "2026-05"));
  assert.equal(pun(december, "tenant_energia-priva", "2026-05").length, 1);
}

// 11. Audit June–October: compares, records, prepares; never writes the PUN archive.
{
  const audited = memoryBackend(seed({ augustMonthly: 179.5 })); const site2 = gmeSite();
  const before = Object.fromEntries(AUDIT_MONTHS.map((month) => [month, structuredClone(pun(audited, "tenant_energia-priva", month))]));
  const { status, body } = await run("audit-pun", audited, site2);
  assert.equal(status, 200);
  const byMonth = Object.fromEntries(body.audits.map((audit) => [audit.month, audit]));
  for (const month of ["2026-07", "2026-09", "2026-10"]) assert.equal(byMonth[month].outcome, "MATCH", month);
  // June: a monthly value derived from the bands (132,50647 → 132,51) differs from the one GME prints (132,50) by one cent.
  assert.equal(byMonth["2026-06"].outcome, "DIVERGENT");
  assert.deepEqual(byMonth["2026-06"].findings.filter((finding) => finding.outcome === "DIVERGENT").map((finding) => finding.field), ["monthly"]);
  assert.equal(byMonth["2026-08"].outcome, "DIVERGENT");
  const divergence = byMonth["2026-08"].findings.find((finding) => finding.field === "monthly" && finding.tenantId === "tenant_energia-priva");
  assert.deepEqual([divergence.archived, divergence.official], [179.5, 180]);
  assert.deepEqual(byMonth["2026-08"].preparedVersion.monthly, 180);
  for (const month of AUDIT_MONTHS) assert.deepEqual(pun(audited, "tenant_energia-priva", month), before[month], `${month} not corrected silently`);
  assert.ok(!audited.writes.some((write) => write.collection === "market-archives"));
  assert.equal(rows(audited, "official-service-audits").length, 5);
  assert.ok(rows(audited, "official-alerts").some((row) => row.payload.period === "2026-08" && /audit PUN/.test(row.payload.reason)));
}

// 12. Technical identity: accepted only for its own principal and role, written as such in the approval audit.
{
  const memory = () => { const map = new Map(); return { async get(t, id) { return map.get(`${t}|${id}`) ?? null; }, async list(t) { return [...map.values()].filter((r) => r.tenantId === t); }, async put(input) { const r = { ...input, version: 1, schemaVersion: 1, createdAt: NOW, updatedAt: NOW }; map.set(`${input.tenantId}|${input.recordId}`, r); return r; }, async append(input) { return this.put(input); } }; };
  const approval = new RegulatoryApprovalDomainService({ regulatoryValues: memory(), approvalDomains: memory(), auditEvents: memory() });
  const base = { tenantId: "tenant_energia-priva", targetRecordId: "rv-1", correlationId: "c1", idempotencyKey: "k1", evidenceReference: "https://www.arera.it/x" };
  await assert.rejects(approval.approveRegulatoryValue({ ...base, principalId: OFFICIAL_DATA_SERVICE_PRINCIPAL, role: "ADMIN" }), /REGULATORY_APPROVAL_ADMIN_REQUIRED/, "the service is never a fictitious ADMIN");
  await assert.rejects(approval.approveRegulatoryValue({ ...base, principalId: "user_tony", role: "OFFICIAL_DATA_SERVICE" }), /REGULATORY_APPROVAL_ADMIN_REQUIRED/, "the service role belongs to the service only");
  await assert.rejects(approval.approveRegulatoryValue({ ...base, principalId: OFFICIAL_DATA_SERVICE_PRINCIPAL, role: "OFFICIAL_DATA_SERVICE" }), /REGULATORY_RECORD_NOT_FOUND/, "the request itself is accepted");
  await assert.rejects(approval.approveRegulatoryValue({ ...base, principalId: "user_admin", role: "ADMIN" }), /REGULATORY_RECORD_NOT_FOUND/, "human ADMIN approvals unchanged");
}

// 13. ARERA/Terna in dry run: sources read through the official fetch, nothing written to the real archive.
{
  const regulatory = memoryBackend(seed());
  const { status, body } = await run("regulatory", regulatory, gmeSite(), { ...ENV, OFFICIAL_DATA_SERVICE_MODE: undefined });
  assert.equal(status, 200); assert.equal(body.mode, "DRY_RUN");
  assert.ok(body.errors.length > 0, "unreachable sources are reported");
  assert.deepEqual(new Set(regulatory.writes.map((write) => write.collection)), new Set(["official-service-locks", "official-service-runs"]));
}

// 13b. Manual commands of the Control Room (Tony 23/11/2026): only Terna or only ARERA, still a dry run; scope only for regulatory.
{
  const terna = memoryBackend(seed());
  const { status, body } = await run("regulatory&scope=terna", terna, gmeSite(), { ...ENV, OFFICIAL_DATA_SERVICE_MODE: undefined });
  assert.equal(status, 200); assert.equal(body.mode, "DRY_RUN"); assert.equal(body.scope, "terna");
  assert.ok(body.tenants.length > 0 && body.tenants.every((tenant) => tenant.arera === "SKIPPED" && tenant.capacity === "SKIPPED" && tenant.terna !== "SKIPPED"));
  assert.ok(body.errors.every((error) => /TERNA_/.test(error)), "only Terna errors");
  assert.ok(Array.isArray(body.acquired));
  assert.deepEqual(new Set(terna.writes.map((write) => write.collection)), new Set(["official-service-locks", "official-service-runs"]));
  const arera = await run("regulatory&scope=arera", memoryBackend(seed()), gmeSite(), { ...ENV, OFFICIAL_DATA_SERVICE_MODE: undefined });
  assert.ok(arera.body.tenants.every((tenant) => tenant.terna === "SKIPPED" && tenant.tide === "SKIPPED" && tenant.arera !== "SKIPPED"));
  assert.equal((await run("gme&scope=terna", memoryBackend(seed()), gmeSite())).status, 400);
  assert.equal((await run("regulatory&scope=tutto", memoryBackend(seed()), gmeSite())).status, 400);
}

// 14. Build: one function, only the official data modules, the three scheduled jobs.
{
  const { build, FORBIDDEN } = await import("../services/dati-ufficiali/build.mjs");
  const out = fs.mkdtempSync("/tmp/servizio-dati-ufficiali-");
  const { files } = build({ outDir: out });
  assert.ok(files.length < 60, `modules: ${files.length}`);
  assert.deepEqual(files.filter((file) => FORBIDDEN.some((rule) => rule.test(file))), []);
  for (const forbidden of [/cte\//, /reading\//, /quote\//, /proposal\//, /hierarchy\//, /eligibility\//, /calculation\/engine/, /persistence\/adapter/, /foundation\/real-bill/, /components\//]) assert.ok(!files.some((file) => forbidden.test(file)), String(forbidden));
  const config = JSON.parse(fs.readFileSync(`${out}/config.json`, "utf8"));
  assert.deepEqual(config.crons, Object.values(SCHEDULE).map((job) => ({ path: job.path, schedule: job.cron })));
  assert.ok(fs.existsSync(`${out}/functions/api/run.func/.vc-config.json`));
  fs.rmSync(out, { recursive: true, force: true });
}

console.log("official-data-service smoke: OK");
