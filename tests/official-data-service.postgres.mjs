import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "../services/dati-ufficiali/node_modules/postgres/src/index.js";
import { handle } from "../services/dati-ufficiali/src/handler.ts";
import { syntheticGmeBandsPdf } from "./fixtures/official-monitor/synthetic-gme-bands-pdf.mjs";
import { syntheticGmeNewsletterPdf } from "./fixtures/official-data-service/synthetic-gme-newsletter-pdf.mjs";

/**
 * Tony (21/11/2026, Fase B): the jobs of the official data service run against a real PostgreSQL with the servizio_dati migration,
 * connected ONLY as svc_dati_ufficiali (the production code path, database.ts), with synthetic GME documents and archive.
 * Needs a disposable local server: SERVIZIO_DATI_TEST_ADMIN_URL (to seed and inspect) and SERVIZIO_DATI_DB_URL /
 * SERVIZIO_DATI_DB_PASSWORD (the service role). Never point it at Supabase: the admin URL must be local.
 */
const ADMIN_URL = process.env.SERVIZIO_DATI_TEST_ADMIN_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)[:/]/.test(ADMIN_URL)) throw new Error("SERVIZIO_DATI_TEST_ADMIN_URL deve puntare a un server locale");
const admin = postgres(ADMIN_URL, { onnotice: () => undefined, max: 1 });
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

const SERVICE_ENV = { SERVIZIO_DATI_DB_URL: process.env.SERVIZIO_DATI_DB_URL, SERVIZIO_DATI_DB_PASSWORD: process.env.SERVIZIO_DATI_DB_PASSWORD };
const run = async (job, env = {}) => {
  const response = await handle(request(job), { ...ENV, ...SERVICE_ENV, ...env }, { fetchImpl: gmeSite().fetchImpl, now: () => NOW, sleep: async () => undefined });
  return { status: response.status, body: await response.json() };
};
const commercial = async () => (await admin`select count(*)::int n, md5(string_agg(t::text, E'\n' order by collection, tenant_id, record_id)) h from public.runtime_records t where collection not in ('market-archives','regulatory-values','regulatory-approval-domains','regulatory-refresh-state','regulatory-refresh-runs','audit-events','official-alerts','official-checks','official-service-documents','official-service-runs','official-service-audits','official-service-locks')`)[0];
const legacyHash = async () => (await admin`select md5(string_agg(t::text, E'\n' order by record_id)) h from public.runtime_records t where collection = 'market-archives' and record_id <> 'gme-pun-2026-05' and payload->'history'->0->>'actor' <> 'user_svc-dati-ufficiali'`)[0].h;

await admin`delete from servizio_dati.registro`.catch(() => undefined);
await admin`delete from public.runtime_records`;
for (const row of seed()) await admin`insert into public.runtime_records values (${row.collection}, ${row.tenantId}, ${row.recordId}, 1, 1, now(), now(), ${admin.json(row.payload)}, null)`;
const commercialBefore = await commercial();
const legacyBefore = await legacyHash();
const results = [];
const check = (name, condition, detail = "") => { results.push(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : `: ${detail}`}`); };

// 1. Dry run: downloads and checks, writes only the lease and the run report.
{ const { status, body } = await run("gme", { OFFICIAL_DATA_SERVICE_MODE: "dry-run" });
  const written = await admin`select distinct collezione from servizio_dati.registro order by 1`;
  check("prova senza pubblicazione: solo lease e rapporto", status === 200 && written.every((r) => ["official-service-locks", "official-service-runs"].includes(r.collezione)), JSON.stringify({ status, body: body.error ?? body.outcome, written })); }
// 2. Publish: May 2026 published automatically, as a new version of the service, for platform and client company.
{ const { status, body } = await run("gme");
  const may = await admin`select tenant_id, record_id, payload->>'status' s, payload->'record'->>'version' v, payload->'history'->0->>'actor' a from public.runtime_records where collection = 'market-archives' and payload->>'month' = '2026-05' order by 1, 2`;
  const published = may.filter((r) => r.a === "user_svc-dati-ufficiali" && r.s === "APPROVED");
  check("pubblicazione automatica PUN maggio 2026 (piattaforma e azienda)", status === 200 && new Set(published.map((r) => r.tenant_id)).size === 2, JSON.stringify({ status, outcome: body.outcome, error: body.error, errors: body.errors?.slice(0, 5), may }));
  const rejected = may.find((r) => r.record_id === "gme-pun-2026-05");
  check("versione rifiutata di maggio intatta", rejected?.s === "REJECTED" && rejected?.v === "1", JSON.stringify(rejected));
  const docs = await admin`select count(*)::int n from public.runtime_records where collection = 'official-service-documents'`;
  check("documenti GME conservati", docs[0].n > 0, String(docs[0].n)); }
// 3. Same documents again: no new version.
{ const before = (await admin`select count(*)::int n from public.runtime_records where collection = 'market-archives'`)[0].n;
  const { status } = await run("gme");
  const after = (await admin`select count(*)::int n from public.runtime_records where collection = 'market-archives'`)[0].n;
  check("stessi documenti: nessuna nuova versione", status === 200 && before === after, `${before} -> ${after}`); }
// 4. Audit June–October: no change to the approved months of the earlier automation.
{ const { status, body } = await run("audit-pun");
  check("audit giugno-ottobre eseguito", status === 200 && body.outcome !== "FAILED", JSON.stringify({ status, outcome: body.outcome, error: body.error }));
  check("mesi giugno-ottobre non modificati", (await legacyHash()) === legacyBefore); }
// 5. Every write went through the functions and is in the register, made by the service role only.
{ const users = await admin`select distinct utente_db from servizio_dati.registro`;
  check("registro: tutte le scritture del ruolo svc_dati_ufficiali", users.length === 1 && users[0].utente_db === "svc_dati_ufficiali", JSON.stringify(users));
  const collections = await admin`select distinct collezione from servizio_dati.registro`;
  check("registro: solo collezioni dei dati ufficiali", collections.every((r) => !/bill|cte|propos|compan|compar|access/.test(r.collezione)), JSON.stringify(collections)); }
// 6. Commercial data untouched.
{ const after = await commercial();
  check("dati commerciali invariati (bollette, CTE, aziende)", after.n === commercialBefore.n && after.h === commercialBefore.h, `${JSON.stringify(commercialBefore)} -> ${JSON.stringify(after)}`); }
// 7. Wrong configuration is refused before any connection.
{ const wrong = await run("gme", { SERVIZIO_DATI_DB_URL: "postgresql://postgres@127.0.0.1:5432/postgres" });
  check("configurazione con utente diverso dal ruolo del servizio rifiutata", wrong.status === 500 && wrong.body.error === "SERVICE_DB_USER_NOT_SERVICE_ROLE", JSON.stringify(wrong.body));
  const remote = await run("gme", { SERVIZIO_DATI_DB_URL: "postgresql://svc_dati_ufficiali.abcdefghijklmnopqrst@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" });
  check("collegamento remoto senza certificato rifiutato", remote.status === 500 && remote.body.error === "SERVICE_DB_CA_MISSING", JSON.stringify(remote.body)); }

await admin.end();
for (const line of results) console.log(line);
const failed = results.filter((line) => line.startsWith("FAIL"));
assert.equal(failed.length, 0, failed.join("\n"));
console.log(`official-data-service postgres: ${results.length} PASS`);
