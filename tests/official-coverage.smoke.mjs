import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Control Room Produttore → copertura reale degli archivi (Tony, 17/11/2026). Dati sintetici: un valore conta solo se approvato
 * nel suo dominio, il PUN solo con mensile unico e F1/F2/F3, quattro tipi di anomalia separati (mancanti, non aggiornati, non
 * verificati, copie divergenti), Tabella 5 e accise ADM, nessuna scrittura negli archivi durante la lettura della Control Room.
 */
const { computeCoverage, formatPeriods } = await import("../app/lib/official-monitor/coverage.ts");

const NOW = "2026-11-17T10:00:00Z";
let n = 0;
const value = (tenantId, authority, componentCode, effectiveFrom, effectiveTo, normalizedValue = 1) => {
  n += 1;
  return { id: `rv_${n}`, identityKey: `${tenantId}|${authority}|${componentCode}|BT|${effectiveFrom}`, authority, componentCode, customerScope: "BT", normalizedUnit: "EUR_PER_KWH", normalizedValue, effectiveFrom: `${effectiveFrom}T00:00:00.000Z`, effectiveTo: effectiveTo ? `${effectiveTo}T00:00:00.000Z` : null, checksum: `c${n}`, retrievedAt: "2026-11-06T09:00:00.000Z" };
};
const months = (from, to) => { const out = []; for (let m = from; m <= to; m += 1) out.push(m); return out; };
const ym = (m) => `2026-${String(m).padStart(2, "0")}`;
const next = (m) => m === 12 ? "2027-01-01" : `${ym(m + 1)}-01`;
const pun = (tenantId, m, { status = "APPROVED", f3 = true } = {}) => ({
  archiveId: `${tenantId}-pun-${m}`, tenantId, vector: "EE", index: "PUN", month: ym(m), status, updatedAt: `${ym(m + 1 > 12 ? 12 : m + 1)}-08T00:00:00.000Z`,
  record: { version: "1.0.0", publicationDate: `${ym(m)}-28`, monthly: { value: 0.11, unit: "EUR/kWh" }, f1: { value: 0.12, unit: "EUR/kWh" }, f2: { value: 0.11, unit: "EUR/kWh" }, ...(f3 ? { f3: { value: 0.1, unit: "EUR/kWh" } } : {}) },
});

function copy(tenantId, label, platform, records, approve, market) {
  const approved = records.filter(approve);
  return { tenantId, label, platform, regulatoryValues: records, approvalDomains: [{ effectiveApprovals: approved.map((record) => ({ targetRecordId: record.id, targetRecordChecksum: record.checksum })) }], marketArchives: market };
}

// Archivio produttore: ASOS da luglio, dispacciamento ARERA fino a ottobre, capacità Terna aprile–giugno, UC3 non approvata,
// ARIM tutto l'anno, PUN giugno–ottobre completo.
const platformValues = [
  value("tenant_piattaforma", "ARERA", "ASOS", "2026-07-01", null),
  ...months(1, 10).map((m) => value("tenant_piattaforma", "ARERA", "DISPATCHING_TOTAL", `${ym(m)}-01`, next(m))),
  value("tenant_piattaforma", "TERNA", "CAPACITY_MARKET_OFF_PEAK", "2026-04-01", "2026-07-01"),
  value("tenant_piattaforma", "ARERA", "UC3", "2026-01-01", null),
  value("tenant_piattaforma", "ARERA", "ARIM", "2026-01-01", null, 0.03),
];
// Copia azienda: ASOS da luglio, capacità Terna fino a dicembre, ARIM con un valore diverso, PUN di settembre senza F3.
const companyValues = [
  value("tenant_energia-priva", "ARERA", "ASOS", "2026-07-01", null),
  ...months(1, 10).map((m) => value("tenant_energia-priva", "ARERA", "DISPATCHING_TOTAL", `${ym(m)}-01`, next(m))),
  value("tenant_energia-priva", "TERNA", "CAPACITY_MARKET_OFF_PEAK", "2026-04-01", "2027-01-01"),
  value("tenant_energia-priva", "ARERA", "ARIM", "2026-01-01", null, 0.04),
];
const copies = [
  copy("tenant_piattaforma", "Archivio produttore", true, platformValues, (record) => record.componentCode !== "UC3", months(6, 10).map((m) => pun("tenant_piattaforma", m))),
  copy("tenant_energia-priva", "Energia Priva", false, companyValues, () => true, [...months(6, 10).filter((m) => m !== 9).map((m) => pun("tenant_energia-priva", m)), pun("tenant_energia-priva", 9, { f3: false }), pun("tenant_energia-priva", 5, { status: "REJECTED" })]),
];
const publications = [{ code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", version: 3, sha256: "a".repeat(64), publishedAt: "2026-11-17T12:14:00.000Z", publishedBy: "user_produttore", provenanceLevel: "EQUIVALENT", provenanceAcknowledged: true }];
const report = computeCoverage({ now: NOW, copies, publications, checks: [{ checkId: "c1", code: "GME_PUN_MONTH", period: "2026-10", at: "2026-11-10T06:00:00.000Z", why: "", outcome: "COVERED", detail: "", alertId: null }], alerts: [] });
const component = (key) => report.archives.flatMap((archive) => archive.components).find((item) => item.key === key);
const issues = (key, kind) => component(key).issues.filter((issue) => issue.kind === kind);

assert.equal(formatPeriods(["2026-01", "2026-02", "2026-03", "2026-11"]), "gennaio–marzo 2026, novembre 2026");

// ASOS gennaio–giugno mancante in entrambe le copie: un solo alert, critico, con le due copie.
const asos = issues("ARERA:ASOS", "MISSING");
assert.equal(asos.length, 1); assert.deepEqual(asos[0].periods, months(1, 6).map(ym)); assert.equal(asos[0].severity, "CRITICAL");
assert.deepEqual(asos[0].copies, ["Archivio produttore", "Energia Priva"]); assert.match(asos[0].action, /Nessun valore si inserisce a mano/);
assert.equal(component("ARERA:ASOS").lastAvailable, "2026-11");

// Dispacciamento ARERA: si ferma a ottobre, novembre è "presente ma non aggiornato".
const dispatching = issues("ARERA:DISPATCHING_TOTAL", "STALE");
assert.equal(dispatching.length, 1); assert.deepEqual(dispatching[0].periods, ["2026-11"]); assert.match(dispatching[0].detail, /ottobre 2026/);
assert.equal(component("ARERA:DISPATCHING_TOTAL").status, "STALE");

// Capacità Terna: piattaforma ferma a giugno, azienda fino a dicembre → non aggiornata nella piattaforma e copie divergenti.
const capacity = component("TERNA:CAPACITY_MARKET_OFF_PEAK");
assert.deepEqual(issues("TERNA:CAPACITY_MARKET_OFF_PEAK", "STALE")[0].periods, months(7, 11).map(ym));
assert.deepEqual(issues("TERNA:CAPACITY_MARKET_OFF_PEAK", "STALE")[0].copies, ["Archivio produttore"]);
assert.deepEqual(issues("TERNA:CAPACITY_MARKET_OFF_PEAK", "DIVERGENT")[0].periods, months(7, 11).map(ym));
assert.match(issues("TERNA:CAPACITY_MARKET_OFF_PEAK", "DIVERGENT")[0].detail, /Energia Priva/);
assert.equal(capacity.status, "MISSING", "gennaio–marzo mancanti ovunque: il caso peggiore decide lo stato");

// Valore presente ma non approvato: non verificato, non conta come dato.
assert.equal(issues("ARERA:UC3", "UNVERIFIED")[0].copies[0], "Archivio produttore"); assert.match(issues("ARERA:UC3", "UNVERIFIED")[0].detail, /non approvati/);
assert.equal(component("ARERA:UC3").lastAvailable, null);

// Stessi periodi, valori diversi: divergenza, mai corretta in automatico.
assert.match(issues("ARERA:ARIM", "DIVERGENT")[0].detail, /valori/); assert.match(issues("ARERA:ARIM", "DIVERGENT")[0].action, /Nessuna correzione automatica/);

// PUN: atteso fino a ottobre (dal 15 novembre), mensile unico e F1/F2/F3; settembre senza F3 non vale, maggio rifiutato non vale.
const punC = component("GME:PUN");
assert.equal(punC.expected.at(-1), "2026-10"); assert.equal(punC.lastCheck, "2026-11-10T06:00:00.000Z"); assert.equal(punC.lastAvailable, "2026-10");
const punUnverified = issues("GME:PUN", "UNVERIFIED").find((issue) => issue.copies.includes("Energia Priva"));
assert.deepEqual(punUnverified.periods, ["2026-05", "2026-09"]); assert.match(punUnverified.detail, /senza F3/); assert.match(punUnverified.detail, /REJECTED/);
assert.deepEqual(issues("GME:PUN", "MISSING").find((issue) => issue.copies.includes("Archivio produttore")).periods, months(1, 5).map(ym));
assert.ok(issues("GME:PUN", "DIVERGENT").some((issue) => issue.periods.includes("2026-09")), "settembre usabile solo nella piattaforma");

// Tabella 5: pubblicata con provenienza confermata dal produttore → informativa, non un'autenticazione ARERA.
const tit = component("ARERA:TIT_TABLE5");
assert.equal(tit.lastAvailable, "2026"); assert.equal(tit.issues.length, 1); assert.equal(tit.issues[0].severity, "INFO"); assert.match(tit.issues[0].detail, /non è un'autenticazione ARERA/);

// ADM: 2026 nella tabella del codice, senza verifica registrata → informativa. Dal 15 dicembre si attende anche il 2027 → mancante.
const adm = component("ADM:EXCISE");
assert.equal(adm.lastAvailable, "2026"); assert.deepEqual(adm.issues.map((issue) => `${issue.kind}/${issue.severity}`), ["UNVERIFIED/INFO"]);
const verified = computeCoverage({ now: NOW, copies, publications, checks: [], alerts: [{ code: "ADM_EXCISE_RATES", period: "2026", status: "RESOLVED" }] });
assert.equal(verified.archives.find((archive) => archive.source === "ADM").status, "COMPLETE");
const december = computeCoverage({ now: "2026-12-20T10:00:00Z", copies, publications, checks: [], alerts: [] });
const adm27 = december.archives.find((archive) => archive.source === "ADM").components[0].issues.find((issue) => issue.kind === "MISSING");
assert.deepEqual([adm27.periods, adm27.severity], [["2027"], "CRITICAL"]); assert.match(adm27.detail, /non determinabili/);
assert.ok(december.archives.find((archive) => archive.source === "ARERA").components.find((item) => item.key === "ARERA:TIT_TABLE5").issues.some((issue) => issue.kind === "MISSING" && issue.periods.includes("2027")));

// Un archivio non è "completo" solo perché un documento è pubblicato; alert ordinati dal più grave; conteggi per tipo.
assert.notEqual(report.archives.find((archive) => archive.source === "ARERA").status, "COMPLETE");
assert.equal(report.alerts[0].severity, "CRITICAL"); assert.equal(report.alerts.at(-1).severity, "INFO");
for (const kind of ["MISSING", "STALE", "UNVERIFIED", "DIVERGENT"]) assert.ok(report.counts[kind] > 0, kind);
assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), report.alerts.length);

// --- La route della Control Room calcola la copertura senza scrivere nulla -------------------------------------------------
const root = await mkdtemp(path.join(os.tmpdir(), "control-room-coverage-"));
const originalCwd = process.cwd();
process.chdir(root);
Object.assign(process.env, { APP_RUNTIME_MODE: "local", FOUNDATION_LOCAL_DEV: "true", FOUNDATION_LOCAL_TENANT_ID: "tenant_piattaforma", FOUNDATION_LOCAL_ROLE: "ADMIN", FOUNDATION_LOCAL_USER_ID: "user_produttore" });
try {
  const { GET } = await import("../app/api/system/control-room/route.ts");
  const { runtimeRepositories } = await import("../app/lib/persistence/adapter.ts");
  const r = runtimeRepositories();
  const seeded = value("tenant_piattaforma", "ARERA", "ASOS", "2026-07-01", null);
  await r.regulatoryValues.put({ tenantId: "tenant_piattaforma", recordId: seeded.id, payload: seeded, now: NOW });
  await r.approvalDomains.put({ tenantId: "tenant_piattaforma", recordId: "domain_1", payload: { effectiveApprovals: [{ targetRecordId: seeded.id, targetRecordChecksum: seeded.checksum }] }, now: NOW });
  const snapshot = async () => { const out = []; const walk = async (dir) => { for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name !== "audit-events") await walk(full); } else out.push(`${full}:${(await stat(full)).mtimeMs}`); } }; await walk(root); return out.sort().join("\n"); };
  // Il registro di audit riceve solo l'accesso (AUTHENTICATION_SUCCESS, come per ogni richiesta autenticata): è escluso dal confronto.
  const before = await snapshot();
  const body = await (await GET(new Request("http://localhost/api/system/control-room"))).json();
  assert.equal(await snapshot(), before, "la lettura della copertura non scrive negli archivi");
  assert.equal(body.coverageError, null);
  const asosRoute = body.coverage.archives.find((archive) => archive.source === "ARERA").components.find((item) => item.key === "ARERA:ASOS");
  assert.ok(asosRoute.lastAvailable, "il valore approvato seminato è letto"); assert.equal(asosRoute.issues.some((issue) => issue.kind === "UNVERIFIED"), false);
  assert.equal(body.coverage.archives.find((archive) => archive.source === "GME").status, "MISSING", "nessun PUN in archivio");
  assert.equal(body.archives.find((archive) => archive.source === "ADM").statusLabel, "Monitoraggio mai eseguito", "stato del monitoraggio separato dalla copertura");
  Object.assign(process.env, { FOUNDATION_LOCAL_TENANT_ID: "tenant_energia-priva" });
  assert.equal((await GET(new Request("http://localhost/api/system/control-room"))).status, 403, "copertura riservata al produttore");
} finally {
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
}
console.log("official-coverage: OK");
