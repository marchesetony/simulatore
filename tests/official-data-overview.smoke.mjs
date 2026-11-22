import assert from "node:assert/strict";
import { describeServiceError, officialDataOverview, parseServiceRun, punUsedByEngine } from "../app/lib/official-monitor/service-overview.ts";

// Control Room → Dati ufficiali (Tony 22/11/2026): read-only view of the service reports and of the PUN the engine uses.
// The GME run below is the shape and content of the first real dry run of 22/11/2026 (values as printed by GME: May 2026
// bands 107,17 / 131,44 / 120,81 €/MWh); the archive records are minimal test records, never written anywhere.
const NOW = "2026-11-22T09:00:00.000Z";
const TENANTS = [{ tenantId: "tenant_piattaforma", label: "Archivio produttore" }, { tenantId: "tenant_cliente-prova", label: "Azienda di prova" }];
const legacy = (month) => ({ month, state: "LEGACY_AUDIT", bands: null, monthly: null, tenants: [], errors: [] });
const gmeRun = {
  runId: "svc_gme_prova", job: "gme", mode: "DRY_RUN", startedAt: "2026-11-22T08:22:45.966Z", finishedAt: "2026-11-22T08:22:47.751Z", identity: "user_svc-dati-ufficiali", outcome: "PARTIAL", nextCheckAt: "2026-11-23T05:20:00.000Z",
  errors: ["2026-05:GME_NEWSLETTER_CHECKS:TEXT testo del PDF non leggibile"],
  summary: { months: [legacy("2026-10"), legacy("2026-09"), legacy("2026-08"), legacy("2026-07"), legacy("2026-06"), { month: "2026-05", state: "FAILED", bands: { f1: 107.17, f2: 131.44, f3: 120.81, hours: [220, 180, 344], sha256: "85c55937b3a87a0449e5dbb45f13101d96b3e26a674bd6848ea43c61aa8fdf9c", url: "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/20260601PrezzomedioperfasceMaggio2026.pdf" }, monthly: null, tenants: [], errors: ["GME_NEWSLETTER_CHECKS:TEXT testo del PDF non leggibile"] }], downloads: [{}, {}, {}] },
};
const rate = (value) => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });
const record = (tenantId, month, version, values, status = "APPROVED", url = "https://gme.mercatoelettrico.org/x.pdf") => {
  const [y, m] = month.split("-").map(Number); const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { archiveId: `gme-pun-${month}${version > 1 ? `-v${version}` : ""}`, tenantId, vector: "EE", index: "PUN", month, status, createdAt: "2026-11-06T16:00:00.000Z", updatedAt: `2026-11-0${version}T16:00:00.000Z`, approvals: [{ approvalId: "a", recordId: "r", decision: "APPROVED", reviewer: "prova", decisionId: "d", decidedAt: "2026-11-06T16:33:08.549Z" }], history: [],
    record: { recordId: `gme-pun-${month}`, version: String(version), vector: "EE", index: "PUN", month, effectiveFrom: `${month}-01`, effectiveTo: to, publicationDate: null, source: { sourceId: "GME", name: "GME Prezzo medio per fasce (mensile)", url, authority: "GME", sourceType: "OFFICIAL" }, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, rate(value)])) } };
};
function marketOf(records) {
  let writes = 0;
  return { repository: { async get(tenantId, id) { return records.find((item) => item.tenantId === tenantId && item.archiveId === id) ?? null; }, async list(tenantId) { return records.filter((item) => item.tenantId === tenantId); }, async save() { writes += 1; throw new Error("READ_ONLY"); } }, writes: () => writes };
}
const october = { f1: 233.39, f2: 252.14, f3: 215.88, monthly: 230.81532885906037 };
const base = [
  ...["tenant_piattaforma", "tenant_cliente-prova"].map((tenantId) => record(tenantId, "2026-10", 1, october)),
  record("tenant_cliente-prova", "2026-09", 1, { f1: 206.3504537706613, f2: 227.57624874999993, f3: 197.02407626644703, monthly: 207.54221705555565 }),
  record("tenant_cliente-prova", "2026-09", 2, { f1: 206.35, f2: 227.58, f3: 197.02, monthly: 207.54125 }),
  record("tenant_cliente-prova", "2026-05", 1, { f1: 107.1740328522727, f2: 131.43756644444454, f3: 120.8147880959298, monthly: 119.35125845766144 }, "REJECTED"),
];

// 1. The real dry run: GME executed with anomalies, May bands validated but not published, May missing for the engine.
{
  const market = marketOf(base);
  const overview = await officialDataOverview({ now: NOW, runs: [gmeRun, { job: "gme", mode: "?" }], alerts: [], market: market.repository, tenants: TENANTS, coverage: null });
  assert.equal(overview.service.runs, 1, "a malformed report is ignored, never shown as data");
  assert.equal(overview.service.publicationActive, false);
  assert.deepEqual(overview.window, ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
  const gme = overview.sources.find((item) => item.source === "GME");
  assert.equal(gme.status, "WARNING"); assert.equal(gme.lastRun.durationMs, 1785); assert.match(gme.errors[0].message, /Newsletter GME .*non leggibile/);
  assert.equal(overview.sources.find((item) => item.source === "ARERA").status, "NEVER_RUN");
  const may = overview.gme.find((item) => item.month === "2026-05");
  assert.equal(may.level, "VALIDATED_NOT_PUBLISHED");
  assert.match(may.levelLabel, /Fasce F1, F2, F3 validate, PUN mensile non validato: non pubblicato \(modalità prova\)/);
  assert.equal(may.acquired.bands.validated, true); assert.equal(may.acquired.monthly.validated, false);
  assert.deepEqual(may.acquired.bands.values, { f1: 107.17, f2: 131.44, f3: 120.81 });
  assert.ok(may.used.every((item) => item.status === "MISSING"), "the rejected May version is never shown as used");
  assert.ok(may.comparison.every((item) => item.outcome === "ENGINE_MISSING"));
  const sept = overview.gme.find((item) => item.month === "2026-09").used.find((item) => item.tenantId === "tenant_cliente-prova");
  assert.equal(sept.version, "2", "the engine's choice: highest approved version"); assert.equal(sept.values.f2, 227.58);
  const blocking = overview.anomalies.filter((item) => item.severity === "BLOCKING");
  assert.ok(blocking.some((item) => /nessun PUN approvato per maggio 2026/.test(item.message)));
  assert.ok(overview.gme.find((item) => item.month === "2026-08").used.every((item) => item.status === "MISSING"));
  assert.equal(market.writes(), 0, "nothing is written");
}

// 2. Audit reference values: equal at two decimals → match; a different official value → divergence signalled, nothing changed.
{
  const auditRun = { runId: "svc_audit", job: "audit-pun", mode: "DRY_RUN", startedAt: "2026-11-23T06:00:00.000Z", finishedAt: "2026-11-23T06:00:09.000Z", identity: "x", outcome: "OK", nextCheckAt: "2026-11-30T06:00:00.000Z", errors: [],
    summary: { audits: [{ month: "2026-10", at: "2026-11-23T06:00:00.000Z", official: { monthly: 230.9, newsletter: "209", newsletterUrl: "https://www.mercatoelettrico.org/n.pdf", f1: 233.39, f2: 252.14, f3: 215.88, bandsUrl: "https://gme.mercatoelettrico.org/b.pdf" }, errors: [] }] } };
  const market = marketOf(base);
  const overview = await officialDataOverview({ now: "2026-11-23T07:00:00.000Z", runs: [gmeRun, auditRun], alerts: [], market: market.repository, tenants: TENANTS, coverage: null });
  const october = overview.gme.find((item) => item.month === "2026-10");
  assert.equal(october.reference.newsletter, "209");
  const outcome = (field) => october.comparison.find((item) => item.tenantId === "tenant_piattaforma" && item.field === field);
  assert.equal(outcome("f1").outcome, "MATCH"); assert.equal(outcome("f1").serviceOrigin, "AUDIT");
  assert.equal(outcome("monthly").outcome, "DIVERGENT", "230,82 in the archive vs 230,90 official (test value)");
  assert.ok(overview.anomalies.some((item) => item.origin === "Confronto con l'audit settimanale" && /PUN mensile: GME 230.9 €\/MWh, motore 230.82/.test(item.message)));
  assert.equal(market.writes(), 0);
}

// 3. ARERA and Terna from the regulatory run; a stale run is reported late; errors in plain Italian with their code.
{
  const regulatory = { runId: "svc_reg", job: "regulatory", mode: "DRY_RUN", startedAt: "2026-11-20T03:40:00.000Z", finishedAt: "2026-11-20T03:41:00.000Z", identity: "x", outcome: "PARTIAL", nextCheckAt: "2026-11-21T03:40:00.000Z",
    errors: ["tenant_cliente-prova ARERA:ARERA_SOURCE_UNAVAILABLE"], summary: { tenants: [{ tenantId: "tenant_cliente-prova", arera: "PARTIAL_FAILURE", capacity: "SUCCESS", terna: "SUCCESS", tide: "SUCCESS", errors: ["ARERA:ARERA_SOURCE_UNAVAILABLE"] }] } };
  const overview = await officialDataOverview({ now: NOW, runs: [regulatory], alerts: [{ alertId: "al1", source: "TERNA", status: "OPEN", period: "2026", document: "TIDE", reason: "documento non trovato", lastCheckedAt: NOW }], market: marketOf([]).repository, tenants: TENANTS, coverage: null });
  const arera = overview.sources.find((item) => item.source === "ARERA"); const terna = overview.sources.find((item) => item.source === "TERNA");
  assert.equal(arera.status, "LATE"); assert.equal(terna.status, "LATE");
  assert.equal(arera.errors.length, 1); assert.equal(terna.errors.length, 0);
  assert.match(arera.details[0], /Azienda di prova: tariffe con anomalie, capacità riuscito/);
  assert.ok(overview.anomalies.some((item) => item.origin === "Alert della Control Room" && /TIDE: documento non trovato/.test(item.message)));
  assert.ok(overview.gme.every((month) => month.level === "MISSING"));
}

// 4. Error descriptions and the engine read path.
assert.deepEqual(describeServiceError("2026-05:GME_NEWSLETTER_NOT_PUBLISHED_YET"), { code: "GME_NEWSLETTER_NOT_PUBLISHED_YET", message: "Newsletter GME del mese non ancora pubblicata", scope: "maggio 2026", informative: true });
assert.equal(describeServiceError("SERVICE_DB_ERROR_28P01").message, "Connessione al database del servizio non riuscita");
assert.equal(parseServiceRun({ ...gmeRun, startedAt: "ieri" }), null);
assert.equal((await punUsedByEngine(marketOf(base).repository, "tenant_cliente-prova", "2026-04", "2026-11-22")), null, "months outside the window are never used");

console.log("official-data-overview smoke: OK");
