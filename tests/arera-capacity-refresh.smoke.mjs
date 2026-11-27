import assert from "node:assert/strict";
import { zlibSync } from "fflate";
import { ARERA_TIV_PAGE, areraCapacityRecords, createAreraCapacitySourceReader, discoverTivResolutions, parseAreraCapacityText, pdfCompactText, runAreraCapacityRefresh } from "../app/lib/regulatory-refresh/arera-capacity.ts";
import { areraCapacityForPeriod, mergeAreraCapacityMonths } from "../app/lib/foundation/arera-capacity-tiv.ts";
import { officialArchiveReport } from "../app/lib/regulatory-refresh/archive-report.ts";

// Tony (27/10): "sono dati che devi aggiornare mensilmente in automatico da ARERA". The monthly capacity charge for BT up
// to 55 kW is read from each quarterly TIV resolution (art. 4.1) that the TIV page cites, with no table kept by hand.

class MemoryRepository {
  constructor() { this.records = []; }
  async get(tenantId, recordId) { return this.records.find((record) => record.tenantId === tenantId && record.recordId === recordId) ?? null; }
  async list(tenantId) { return this.records.filter((record) => record.tenantId === tenantId); }
  async put(input) {
    const existing = await this.get(input.tenantId, input.recordId);
    if (input.idempotencyKey && existing?.idempotencyKey === input.idempotencyKey) return existing;
    if (input.expectedVersion === undefined && existing) throw new Error("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) throw new Error("PERSISTENCE_VERSION_CONFLICT");
    const next = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: input.now, updatedAt: input.now, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey };
    this.records = this.records.filter((record) => !(record.tenantId === input.tenantId && record.recordId === input.recordId)); this.records.push(next); return next;
  }
  async append(input) { if (await this.get(input.tenantId, input.recordId)) throw new Error("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.put(input); }
}

const latin1 = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const concat = (parts) => { const total = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(total); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; };
const escape = (text) => text.replace(/[\\()]/g, (char) => `\\${char}`);
/** A one-page PDF like ARERA's: compressed content, text runs split mid-word, the page optionally packed in an object stream. */
function resolutionPdf(lines, { objectStream = false } = {}) {
  const content = zlibSync(latin1(`BT\n/F1 11 Tf\n1 0 0 1 72 760 Tm\n${lines.map((line) => `[(${escape(line.slice(0, Math.ceil(line.length / 2)))}) -12 (${escape(line.slice(Math.ceil(line.length / 2)))})] TJ\n0 -14 Td`).join("\n")}\nET`));
  const page = "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
  const parts = [latin1("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /TimesNewRoman /Encoding /WinAnsiEncoding >>\nendobj\n")];
  if (objectStream) {
    const packed = zlibSync(latin1(`3 0 ${page}`));
    parts.push(latin1(`6 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`), packed, latin1("\nendstream\nendobj\n"));
  } else parts.push(latin1(`3 0 obj\n${page}\nendobj\n`));
  parts.push(latin1(`5 0 obj\n<< /Filter /FlateDecode /Length ${content.length} >>\nstream\n`), content, latin1("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"));
  return concat(parts);
}
const capacityLines = (date, values, year) => [`DELIBERAZIONE ${date}`, "Articolo 4", "Disposizioni in materia di corrispettivo capacità", "4.1 Il valore del corrispettivo capacità di cui ai commi 34.8, 41.9 e 48.9 del TIV", "e al comma 18.1, lettera c), della deliberazione 555/2017/R/com è pari a:", ...values.map(([value, month], index) => `${"abc"[index]}) ${value} c\x80/kWh per il mese di ${month} ${year}${index === values.length - 1 ? "." : ";"}`), "I predetti valori non comprendono le perdite di energia elettrica sulle reti."];

// The text layer is read whatever the PDF packs: plain objects or object streams, runs split anywhere.
const q3 = capacityLines("25 GIUGNO 2026", [["2,4466", "luglio"], ["0,6288", "agosto"], ["0,3197", "settembre"]], 2026);
for (const objectStream of [false, true]) {
  const parsed = parseAreraCapacityText(pdfCompactText(resolutionPdf(q3, { objectStream })).text);
  assert.equal(parsed.publicationDate, "2026-06-25");
  assert.deepEqual(parsed.months, [{ month: "2026-07", centsPerKwh: 2.4466 }, { month: "2026-08", centsPerKwh: 0.6288 }, { month: "2026-09", centsPerKwh: 0.3197 }]);
}
assert.deepEqual(parseAreraCapacityText(pdfCompactText(resolutionPdf(["DELIBERAZIONE 23 SETTEMBRE 2026", "Aggiornamento delle componenti RCV"])).text).months, []);

// The TIV page cites the quarterly updates as linked acts and in the "Versione modificata con ..." notes, newest first.
const tivHtml = `<a href="/atti-e-provvedimenti/dettaglio/26/96-26">96/2026/R/eel</a><a href="/atti-e-provvedimenti/dettaglio/25/586-25">586/2025/R/eel</a>
  <a href="/fileadmin/allegati/docs/23/Allegato_A_TIV_Aggiornato_1_ottobre.pdf" title="Versione modificata con le deliberazioni 96/2026/R/eel, 218/2026/R/eel, 219/2026/R/eel, 336/2026/R/eel e 338/2026/R/eel">Allegato A</a>
  <a href="/atti-e-provvedimenti/dettaglio/24/594-24">594/2024/R/eel</a><a href="/atti-e-provvedimenti/dettaglio/23/362-23">362/2023/R/eel</a>`;
assert.deepEqual(discoverTivResolutions(tivHtml, "2026-10-27T03:15:00.000Z").map((id) => `${id.number}/${id.year}`), ["338/2026", "336/2026", "219/2026", "218/2026", "96/2026", "586/2025"]);

/** ARERA's site: the TIV page and the resolution PDFs; 338/2026 (Q4) appears only when published. */
function areraSite({ publishQ4 = true, q3 = q3Pdf } = {}) {
  const routes = new Map([
    [ARERA_TIV_PAGE, new TextEncoder().encode(publishQ4 ? tivHtml : tivHtml.replace(", 336/2026/R/eel e 338/2026/R/eel", ""))],
    ["https://www.arera.it/fileadmin/allegati/docs/26/219-2026-R-eel.pdf", q3],
    ["https://www.arera.it/fileadmin/allegati/docs/26/336-2026-R-eel.pdf", resolutionPdf(["DELIBERAZIONE 23 SETTEMBRE 2026", "Aggiornamento delle componenti RCV"])],
    ["https://www.arera.it/fileadmin/allegati/docs/26/96-2026-R-eel.pdf", resolutionPdf(capacityLines("24 MARZO 2026", [["0,3619", "aprile"], ["0,3619", "maggio"], ["0,7593", "giugno"]], 2026), { objectStream: true })],
    ...(publishQ4 ? [["https://www.arera.it/fileadmin/allegati/docs/26/338-2026-R-eel.pdf", resolutionPdf(capacityLines("23 SETTEMBRE 2026", [["0,3423", "ottobre"], ["0,3423", "novembre"], ["0,9243", "dicembre"]], 2026))]] : []),
  ]);
  return async (input) => {
    const body = routes.get(input);
    if (body === undefined) return { status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    return { status: 200, headers: { get: () => "application/pdf" }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
}
const q3Pdf = resolutionPdf(q3);

const tenantId = "tenant_arera-cmc-smoke";
const repositories = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };
const first = await runAreraCapacityRefresh({ tenantId, repositories, capacitySourceReader: createAreraCapacitySourceReader({ fetcher: areraSite() }), now: "2026-10-27T03:15:00.000Z", runId: "cmc_first", trigger: "TEST" });
assert.equal(first.status, "SUCCESS", first.errors.join(","));
assert.deepEqual(first.months.map((item) => `${item.month}=${item.centsPerKwh}@${item.resolution}`), ["2026-04=0.3619@96/2026/R/eel", "2026-05=0.3619@96/2026/R/eel", "2026-06=0.7593@96/2026/R/eel", "2026-07=2.4466@219/2026/R/eel", "2026-08=0.6288@219/2026/R/eel", "2026-09=0.3197@219/2026/R/eel", "2026-10=0.3423@338/2026/R/eel", "2026-11=0.3423@338/2026/R/eel", "2026-12=0.9243@338/2026/R/eel"]);
assert.equal(first.createdCount, 9);
const stored = (await repositories.regulatoryValues.list(tenantId)).map((record) => record.payload);
const september = stored.find((record) => record.effectiveFrom.startsWith("2026-09"));
assert.ok(Math.abs(september.normalizedValue - 0.003197) < 1e-12); assert.equal(september.originalValue, 0.3197);
assert.equal(september.sourceReference, "https://www.arera.it/fileadmin/allegati/docs/26/219-2026-R-eel.pdf");

// Running it again changes nothing; a quarter not published yet is not an error until its first month starts.
const again = await runAreraCapacityRefresh({ tenantId, repositories, capacitySourceReader: createAreraCapacitySourceReader({ fetcher: areraSite() }), now: "2026-10-28T03:15:00.000Z", runId: "cmc_again", trigger: "TEST" });
assert.equal(again.createdCount, 0); assert.equal(again.unchangedCount, 9);
const lateRepositories = { regulatoryValues: new MemoryRepository(), approvalDomains: new MemoryRepository(), auditEvents: new MemoryRepository(), regulatoryRefreshState: new MemoryRepository(), regulatoryRefreshRuns: new MemoryRepository() };
const beforeQ4 = await runAreraCapacityRefresh({ tenantId, repositories: lateRepositories, capacitySourceReader: createAreraCapacitySourceReader({ fetcher: areraSite({ publishQ4: false }) }), now: "2026-09-20T03:15:00.000Z", runId: "cmc_before", trigger: "TEST" });
assert.equal(beforeQ4.status, "SUCCESS", beforeQ4.errors.join(","));
const missingMonth = await runAreraCapacityRefresh({ tenantId, repositories: lateRepositories, capacitySourceReader: createAreraCapacitySourceReader({ fetcher: areraSite({ publishQ4: false }) }), now: "2026-10-02T03:15:00.000Z", runId: "cmc_missing", trigger: "TEST" });
assert.equal(missingMonth.status, "PARTIAL_FAILURE"); assert.deepEqual(missingMonth.errors, ["2026-10:ARERA_CAPACITY_MONTH_NOT_FOUND"]);
const offline = await runAreraCapacityRefresh({ tenantId, repositories, capacitySourceReader: { async load() { throw new Error("ARERA_HTTP_503"); } }, now: "2026-10-28T03:15:00.000Z", runId: "cmc_offline", trigger: "TEST" });
assert.equal(offline.status, "FAILED");

// A later resolution that corrects a month wins over the earlier one.
const corrected = areraCapacityRecords(tenantId, [{ resolution: "219/2026/R/eel", url: "https://www.arera.it/fileadmin/allegati/docs/26/219-2026-R-eel.pdf", publicationDate: "2026-06-25", months: [{ month: "2026-09", centsPerKwh: 0.3197 }], sourceSha256: "a".repeat(64) }, { resolution: "250/2026/R/eel", url: "https://www.arera.it/fileadmin/allegati/docs/26/250-2026-R-eel.pdf", publicationDate: "2026-07-20", months: [{ month: "2026-09", centsPerKwh: 0.3001 }], sourceSha256: "b".repeat(64) }], "2026-10-27T03:15:00.000Z");
assert.equal(corrected.length, 1); assert.equal(corrected[0].originalValue, 0.3001);

// The quote uses the stored months over the hand-checked table, and the archive page shows when each was downloaded.
const bridgeRecords = stored.map((record) => ({ ...record, normalizedValue: record.effectiveFrom.startsWith("2026-09") ? 0.0031 : record.normalizedValue }));
assert.ok(Math.abs(areraCapacityForPeriod("2026-09-01", "2026-10-01", mergeAreraCapacityMonths(bridgeRecords)).eurPerKwh - 0.0031) < 1e-12);
assert.ok(Math.abs(areraCapacityForPeriod("2026-09-01", "2026-10-01", mergeAreraCapacityMonths([])).eurPerKwh - 0.003197) < 1e-12);
const report = await officialArchiveReport(repositories, tenantId, "2026-10-28T08:00:00.000Z");
const capacity = report.domains.find((domain) => domain.key === "CAPACITY_MARKET|LV_UP_TO_55KW|EUR/KWH|TIV_MONTHLY");
assert.equal(capacity.records.find((record) => record.effectiveFrom.startsWith("2026-09")).retrievedAt, "2026-10-27T03:15:00.000Z");
assert.deepEqual(capacity.missingMonths, []);

console.log("arera capacity refresh smoke: ok");
