import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readXlsx } from "../app/lib/official-monitor/xlsx.ts";
import { readTitTable5, validateTable5Year } from "../app/lib/official-monitor/tit-table5.ts";
import { OFFICIAL_CATALOG, dueChecks } from "../app/lib/official-monitor/catalog.ts";
import { ALERT_STATUS_LABEL, OFFICIAL_MONITOR_TENANT, alertIdFor, listAlerts, listChecks, runOfficialMonitor } from "../app/lib/official-monitor/monitor.ts";
import { confirmManualVerification, publishOfficialDocument, publishedDocuments, validateOfficialDocument } from "../app/lib/official-monitor/documents.ts";
import { archiveOverview } from "../app/lib/official-monitor/archives.ts";
import { reactiveRowsFromOfficialDocuments } from "../app/lib/engine-v3/adapters/tit-table5-official.ts";
import { simulateV3 } from "../app/lib/engine-v3/simulate.ts";
import { isPlatformOwner } from "../app/lib/access/service.ts";
import { syntheticTitWorkbook, memoryRepository } from "./fixtures/official-monitor/synthetic-tit-xlsx.mjs";
import { referenceInput } from "./fixtures/engine-v3/reference-070789E.mjs";

// Control Room produttore (Tony, 17/11/2026). Workbook SINTETICO (non il file ARERA): verifica il lettore per etichette.
const workbook = syntheticTitWorkbook();
const repos = () => ({ alerts: memoryRepository(), checks: memoryRepository(), documents: memoryRepository(), publications: memoryRepository() });
const NOW = "2026-11-17T07:00:00.000Z";

// --- Accesso: solo il produttore (ADMIN di tenant_piattaforma), mai un amministratore/direttore di azienda ------------------
assert.equal(isPlatformOwner({ tenantId: "tenant_piattaforma", role: "ADMIN" }), true);
assert.equal(isPlatformOwner({ tenantId: "tenant_energia-priva", role: "ADMIN" }), false, "amministratore/direttore aziendale non è produttore");
assert.equal(isPlatformOwner({ tenantId: "tenant_piattaforma", role: "ANALYST" }), false);

// --- Lettura Excel e integrità ----------------------------------------------------------------------------------------
{
  const book = readXlsx(workbook);
  assert.deepEqual(book.sheets.map((sheet) => sheet.name), ["Copertina", "Tabelle 4-5"]);
  const corrupt = workbook.slice(); const at = corrupt.length - 400; corrupt[at] ^= 0xff;
  assert.throws(() => readXlsx(corrupt), /OFFICIAL_XLSX_/, "un byte alterato viene rilevato");
  assert.throws(() => readXlsx(new TextEncoder().encode("non è un excel")), /OFFICIAL_XLSX_NOT_ZIP/);
}

// --- Tabella 5 per etichette ------------------------------------------------------------------------------------------
{
  const reading = readTitTable5(readXlsx(workbook));
  assert.equal(reading.ok, true, JSON.stringify(reading.checks));
  assert.equal(reading.structure.sheet, "Tabelle 4-5"); assert.equal(reading.structure.titleCell, "A4");
  assert.deepEqual(reading.structure.years, [2024, 2025, 2026]);
  const v = (voltage, year, kind, band) => reading.values.find((item) => item.voltage === voltage && item.year === year && item.kind === kind && item.band === band);
  assert.equal(v("BT", 2026, "INJECTED", "F3").centsPerKvarh, "1.088", "rumore binario di Excel ricondotto al valore pubblicato");
  assert.ok(reading.warnings.some((warning) => /1\.0880000000000001 letto come 1\.088/.test(warning)));
  assert.equal(v("BT", 2026, "WITHDRAWN", "F1").thresholdRatio, "0.33");
  assert.equal(v("BT", 2026, "INJECTED", "F3").thresholdRatio, "0");
  assert.equal(v("MT", 2026, "INJECTED", "F3").centsPerKvarh, "0.377");
  assert.equal(v("BT", 2025, "WITHDRAWN", "F2").centsPerKvarh, "1.046");
  assert.ok(!reading.values.some((item) => item.centsPerKvarh === "0.795" || item.centsPerKvarh === "0.264"), "righe \"quota parte\" escluse");
  assert.ok(!reading.values.some((item) => item.centsPerKvarh === "9.99"), "Tabella 4 non letta come Tabella 5");
  assert.ok(v("BT", 2026, "INJECTED", "F3").cell.match(/^[A-Z]+\d+$/));
  assert.equal(validateTable5Year(reading, 2026).ok, true);
  const y2027 = validateTable5Year(reading, 2027);
  assert.equal(y2027.ok, false); assert.ok(y2027.checks.some((item) => item.code === "PERIOD_BT_INJECTED_F3" && !item.ok));
  // Missing table, wrong unit, missing MT year
  const none = readTitTable5(readXlsx(syntheticTitWorkbook({ table5: false })));
  assert.equal(none.ok, false); assert.equal(none.checks[0].code, "TITLE");
  const unit = readTitTable5(readXlsx(syntheticTitWorkbook({ unit: "euro/kWh" })));
  assert.equal(unit.checks.find((item) => item.code === "UNIT").ok, false);
  const noMt = validateTable5Year(readTitTable5(readXlsx(syntheticTitWorkbook({ omitMtYear: 2026 }))), 2026);
  assert.equal(noMt.ok, false); assert.ok(noMt.checks.some((item) => item.code === "PERIOD_MT_INJECTED_F3" && !item.ok));
}

// --- Calendario dei controlli -----------------------------------------------------------------------------------------
{
  const codes = (now) => dueChecks(now).map((check) => `${check.code}:${check.period}`);
  assert.deepEqual(codes("2026-11-05T06:00:00Z"), ["GME_PUN_MONTH:2026-10"]);
  assert.deepEqual(codes("2026-11-14T06:00:00Z"), ["GME_PUN_MONTH:2026-10"]);
  assert.deepEqual(codes("2026-11-15T06:00:00Z"), []);
  assert.deepEqual(codes("2026-11-04T06:00:00Z"), []);
  assert.deepEqual(codes("2026-11-16T06:00:00Z"), ["ARERA_REGULATED_REFRESH:2026-11-16", "TERNA_DISPATCHING_CAPACITY:2026-11-16", "ARERA_TIME_TABLES:2026", "ARERA_TIT_TABLE5_REACTIVE:2026", "ADM_EXCISE_RATES:2026"]);
  assert.deepEqual(codes("2026-11-30T23:30:00Z").slice(0, 1), ["ARERA_REGULATED_REFRESH:2026-12-01"], "giorno di calendario italiano");
  assert.deepEqual(codes("2027-01-07T06:00:00Z"), ["GME_PUN_MONTH:2026-12"]);
  assert.ok(codes("2026-12-16T06:00:00Z").includes("ARERA_TIT_TABLE5_REACTIVE:2027"), "scadenza: tabelle dell'anno dopo");
  assert.ok(OFFICIAL_CATALOG.every((entry) => entry.officialLink.startsWith("https://") && entry.instructions.length > 0 && entry.uploadPath.length > 0));
}

// --- Monitor: alert completi, nessun duplicato, esiti registrati -------------------------------------------------------
{
  const r = repos();
  let gmeAvailable = false;
  const probes = {
    GME_PUN_MONTH: { covered: async () => gmeAvailable, acquire: async () => ({ ok: false, errors: ["2026-10: GME_PUN_NOT_PUBLISHED"] }) },
    ARERA_TIT_TABLE5_REACTIVE: { covered: async (year) => (await publishedDocuments(r, "ARERA_TIT_TABLE5_REACTIVE")).some((doc) => doc.period === year) },
  };
  const gme = [{ code: "GME_PUN_MONTH", period: "2026-10", why: "test" }];
  const [first] = await runOfficialMonitor({ repositories: r, probes, now: "2026-11-05T06:00:00Z", only: gme });
  assert.equal(first.outcome, "FAILED");
  await runOfficialMonitor({ repositories: r, probes, now: "2026-11-06T06:00:00Z", only: gme });
  const alerts = await listAlerts(r);
  assert.equal(alerts.length, 1, "stesso documento e periodo: un solo alert");
  const alert = alerts[0];
  assert.equal(alert.alertId, alertIdFor("GME_PUN_MONTH", "2026-10"));
  assert.equal(alert.occurrences, 2); assert.equal(alert.status, "OPEN");
  for (const field of ["source", "document", "period", "officialLink", "reason", "instructions", "uploadPath", "status"]) assert.ok(alert[field], `alert senza ${field}`);
  assert.match(alert.reason, /GME_PUN_NOT_PUBLISHED/);
  gmeAvailable = true;
  const [covered] = await runOfficialMonitor({ repositories: r, probes, now: "2026-11-07T06:00:00Z", only: gme });
  assert.equal(covered.outcome, "COVERED");
  assert.equal((await listAlerts(r))[0].status, "RESOLVED");
  assert.equal((await listChecks(r)).length, 3, "ogni controllo registrato");

  // Day 16: manual documents open their alerts; automatic ones without a wired probe say so (no simulated success).
  const day16 = await runOfficialMonitor({ repositories: r, probes, now: "2026-11-16T06:00:00Z" });
  assert.deepEqual(day16.map((check) => [check.code, check.outcome]), [["ARERA_REGULATED_REFRESH", "FAILED"], ["TERNA_DISPATCHING_CAPACITY", "FAILED"], ["ARERA_TIME_TABLES", "MANUAL_REQUIRED"], ["ARERA_TIT_TABLE5_REACTIVE", "MANUAL_REQUIRED"], ["ADM_EXCISE_RATES", "MANUAL_REQUIRED"]]);
  assert.match(day16[0].detail, /non collegata/);
  const tab5 = (await listAlerts(r)).find((item) => item.code === "ARERA_TIT_TABLE5_REACTIVE");
  assert.equal(tab5.officialLink, "https://www.arera.it/fileadmin/allegati/docs/25/575-2025-R-eel-TABELLE_TIT.xlsx");
  assert.match(tab5.uploadPath, /Control Room Produttore → Archivi ufficiali → archivio ARERA/);
  assert.equal(ALERT_STATUS_LABEL[tab5.status], "Da lavorare");

  // ADM: manual verification closes the alert, with a note; the next check is COVERED.
  await assert.rejects(() => confirmManualVerification(r, { code: "ADM_EXCISE_RATES", period: "2026", note: "ok", confirmedBy: "user_x", now: NOW }), /NOTE_REQUIRED/);
  await assert.rejects(() => confirmManualVerification(r, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", note: "verificato tutto", confirmedBy: "user_x", now: NOW }), /NOT_ALLOWED/);
  const confirmed = await confirmManualVerification(r, { code: "ADM_EXCISE_RATES", period: "2026", note: "aliquote 2026 invariate sul portale ADM", confirmedBy: "user_x", now: NOW });
  assert.equal(confirmed.status, "RESOLVED");
  const [admAgain] = await runOfficialMonitor({ repositories: r, probes, now: "2026-12-01T06:00:00Z", only: [{ code: "ADM_EXCISE_RATES", period: "2026", why: "test" }] });
  assert.equal(admAgain.outcome, "COVERED");

  // --- "Valida documento": versione, impronta, provenienza, stato dell'alert; nessun dato disponibile -----------------
  const sha = createHash("sha256").update(workbook).digest("hex");
  const validate = async (bytes, extra = {}) => (await validateOfficialDocument(r, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", originalName: "575-2025-R-eel-TABELLE_TIT.xlsx", bytes, uploadedBy: "user_owner", now: NOW, ...extra }));
  const tab5Status = async () => (await listAlerts(r)).find((item) => item.code === "ARERA_TIT_TABLE5_REACTIVE").status;
  const { record: bad } = await validate(syntheticTitWorkbook({ omitMtYear: 2026 }));
  assert.equal(bad.status, "REJECTED"); assert.equal(bad.version, 1); assert.deepEqual(bad.values, [], "un file rifiutato non espone valori");
  assert.equal(await tab5Status(), "REJECTED");
  // Official download with different 2026 values: blocked (17/11 correction: a broken download is no longer a reference, see official-provenance).
  const { record: differs } = await validate(workbook, { fetchOfficial: async () => syntheticTitWorkbook({ bt: { 2024: "1.169", 2025: "1.046", 2026: "1.099" } }) });
  assert.equal(differs.status, "REJECTED"); assert.equal(differs.provenance.level, "DIFFERS_FROM_OFFICIAL_DOWNLOAD");
  const outOfWindow = (await validateOfficialDocument(r, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2029", originalName: "x.xlsx", bytes: workbook, uploadedBy: "user_owner", now: NOW })).record;
  assert.equal(outOfWindow.status, "REJECTED"); assert.ok(outOfWindow.checks.some((check) => check.code === "PERIOD_WINDOW" && !check.ok), "periodo oltre l'anno prossimo rifiutato");
  const { record: good, duplicate: firstTime } = await validate(workbook, { fetchOfficial: async () => workbook });
  assert.equal(firstTime, false);
  assert.equal(good.status, "VALIDATED"); assert.equal(good.version, 3); assert.equal(good.sha256, sha);
  assert.equal(good.provenance.level, "MATCHES_OFFICIAL_DOWNLOAD");
  assert.equal(Buffer.from(good.originalBase64, "base64").equals(Buffer.from(workbook)), true, "originale conservato identico");
  assert.equal(await tab5Status(), "FILE_UPLOADED", "validato ma non pubblicato: l'alert NON è risolto");
  assert.equal((await publishedDocuments(r, "ARERA_TIT_TABLE5_REACTIVE")).length, 0, "un documento validato non è disponibile ai calcoli");
  const [stillMissing] = await runOfficialMonitor({ repositories: r, probes, now: "2026-11-20T06:00:00Z", only: [{ code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", why: "test" }] });
  assert.equal(stillMissing.outcome, "MANUAL_REQUIRED"); assert.equal(await tab5Status(), "FILE_UPLOADED", "il controllo non riapre né risolve l'alert");
  // Same bytes again: no duplicate version.
  const again = await validate(workbook, { originalName: "nome-diverso.xlsx", fetchOfficial: async () => null });
  assert.equal(again.duplicate, true); assert.equal(again.record.documentId, good.documentId);
  await assert.rejects(() => validate(workbook, { originalName: "x.xlsx", period: "26" }), /PERIOD_INVALID/);
  await assert.rejects(() => validateOfficialDocument(r, { code: "GME_PUN_MONTH", period: "2026-10", originalName: "a.xlsx", bytes: workbook, uploadedBy: "u", now: NOW }), /NOT_SUPPORTED/);

  // --- "Pubblica aggiornamento": solo validato, conferma esplicita, append-only --------------------------------------
  const publish = (documentId, extra = {}) => publishOfficialDocument(r, { documentId, confirmSha256: sha, acknowledgeDeclaredProvenance: false, publishedBy: "user_owner", now: "2026-11-17T09:00:00Z", ...extra });
  await assert.rejects(() => publish(bad.documentId, { confirmSha256: bad.sha256 }), /NOT_VALIDATED/);
  await assert.rejects(() => publish(differs.documentId), /NOT_VALIDATED/);
  await assert.rejects(() => publish(good.documentId, { confirmSha256: "0".repeat(64) }), /CONFIRMATION_MISMATCH/);
  await assert.rejects(() => publish("official-document_inesistente"), /DOCUMENT_NOT_FOUND/);
  const published = await publish(good.documentId);
  assert.equal(published.version, 3); assert.equal(published.supersedes, null); assert.equal(published.provenanceAcknowledged, false);
  assert.equal(await tab5Status(), "RESOLVED", "alert risolto solo dopo la pubblicazione");
  await assert.rejects(() => publish(good.documentId), /ALREADY_PUBLISHED/);
  // A new version with a declared provenance needs the explicit acknowledgment.
  const v4 = (await validate(syntheticTitWorkbook({ extraNote: "v4" }), { fetchOfficial: async () => null })).record;
  assert.equal(v4.status, "VALIDATED"); assert.equal(v4.provenance.level, "DECLARED_BY_PRODUCER"); assert.equal(v4.version, 4);
  await assert.rejects(() => publish(v4.documentId, { confirmSha256: v4.sha256 }), /PROVENANCE_ACK_REQUIRED/);
  const p4 = await publish(v4.documentId, { confirmSha256: v4.sha256, acknowledgeDeclaredProvenance: true, now: "2026-11-17T10:00:00Z" });
  assert.equal(p4.supersedes, published.publicationId); assert.equal(p4.provenanceAcknowledged, true);
  await assert.rejects(() => publish(good.documentId, { now: "2026-11-17T11:00:00Z" }), /ALREADY_PUBLISHED|OLDER_VERSION/);
  // Tampered stored original: publication refused.
  const tampered = (await validate(syntheticTitWorkbook({ extraNote: "v5" }), { fetchOfficial: async () => null })).record;
  const storedTampered = await r.documents.get(OFFICIAL_MONITOR_TENANT, tampered.documentId);
  storedTampered.payload = { ...storedTampered.payload, values: storedTampered.payload.values.map((value) => ({ ...value, centsPerKvarh: value.centsPerKvarh === "0" ? "0" : "9.999" })) };
  await assert.rejects(() => publish(tampered.documentId, { confirmSha256: tampered.sha256, acknowledgeDeclaredProvenance: true }), /CONTENT_CHANGED/);
  // History is never rewritten: every version and every publication stays, each record at its first version.
  const stored = (await r.documents.list(OFFICIAL_MONITOR_TENANT)).map((record) => [record.payload.version, record.payload.status]);
  assert.deepEqual(stored.sort(), [[1, "REJECTED"], [1, "REJECTED"], [2, "REJECTED"], [3, "VALIDATED"], [4, "VALIDATED"], [5, "VALIDATED"]]);
  assert.equal((await r.publications.list(OFFICIAL_MONITOR_TENANT)).length, 2);
  const [tab5Check] = await runOfficialMonitor({ repositories: r, probes, now: "2026-12-01T06:00:00Z", only: [{ code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", why: "test" }] });
  assert.equal(tab5Check.outcome, "COVERED");

  // --- Archivi: quattro viste, ultimo aggiornamento, periodo coperto, storico --------------------------------------
  const archives = await archiveOverview(r);
  assert.deepEqual(archives.map((item) => item.source), ["ARERA", "GME", "TERNA", "ADM"]);
  const arera = archives.find((item) => item.source === "ARERA");
  assert.ok(arera.documents.find((doc) => doc.code === "ARERA_TIT_TABLE5_REACTIVE").coveredPeriods.includes("2026"));
  assert.ok(arera.history.some((entry) => entry.kind === "PUBLICATION" && entry.documentId === v4.documentId));
  assert.ok(arera.history.some((entry) => entry.kind === "VALIDATION" && entry.outcome === "REJECTED"));
  assert.equal(archives.find((item) => item.source === "GME").documents[0].coveredPeriods.includes("2026-10"), true);
  assert.ok(archives.find((item) => item.source === "ADM").documents[0].coveredPeriods.includes("2026"));
  for (const item of archives) for (const field of ["status", "statusLabel", "periodCovered", "officialLinks", "missing", "alerts", "history"]) assert.ok(item[field] !== undefined, `${item.source} senza ${field}`);

  // --- Disponibilità al motore V3 solo dopo pubblicazione --------------------------------------------------------
  const live = await publishedDocuments(r, "ARERA_TIT_TABLE5_REACTIVE");
  assert.deepEqual(live.map((doc) => doc.version), [4], "vale l'ultima versione pubblicata, non l'ultima validata (v5)");
  const rows = reactiveRowsFromOfficialDocuments(live);
  assert.deepEqual(rows.map((row) => [row.id, row.bands.join(""), row.rate.value, row.fromRatio]).sort(), [["TIT5-BT-2026-IMMESSA", "F3", "1.088", "0"], ["TIT5-BT-2026-PRELEVATA", "F1F2", "1.088", "0.33"], ["TIT5-MT-2026-IMMESSA", "F3", "0.377", "0"], ["TIT5-MT-2026-PRELEVATA", "F1F2", "0.377", "0.33"]]);
  assert.ok(rows.every((row) => row.rate.source.verification.level === "ORIGINAL_DOCUMENT"));
  assert.deepEqual(reactiveRowsFromOfficialDocuments([bad, differs]), [], "caricamenti rifiutati: nessuna riga");
  const result = simulateV3({ ...referenceInput(), regulated: { ...referenceInput().regulated, reactiveTariff: rows } });
  const reactive = result.components.find((component) => component.category === "REACTIVE_ENERGY");
  assert.equal(reactive.amountCents, 548); assert.equal(reactive.unitPrice.value, "0.01088");
  assert.deepEqual(result.totals.unverified, []); assert.equal(result.totals.status, "COMPLETE");
  const withoutDoc = simulateV3({ ...referenceInput(), regulated: { ...referenceInput().regulated, reactiveTariff: reactiveRowsFromOfficialDocuments([]) } });
  assert.equal(withoutDoc.components.find((component) => component.category === "REACTIVE_ENERGY").completeness, "NOT_DETERMINABLE");
}

console.log("official-monitor: OK");
