import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readTitTable5File, validateTable5Year } from "../app/lib/official-monitor/tit-table5.ts";
import { publishOfficialDocument, publishedDocuments, validateOfficialDocument } from "../app/lib/official-monitor/documents.ts";
import { upsertAlert, listAlerts } from "../app/lib/official-monitor/monitor.ts";
import { reactiveRowsFromOfficialDocuments } from "../app/lib/engine-v3/adapters/tit-table5-official.ts";
import { simulateV3 } from "../app/lib/engine-v3/simulate.ts";
import { memoryRepository } from "./fixtures/official-monitor/synthetic-tit-xlsx.mjs";
import { referenceInput } from "./fixtures/engine-v3/reference-070789E.mjs";

/**
 * Collaudo sul file ARERA reale (Tony, 17/11/2026): 575-2025-R-eel-TABELLE_TIT.xlsx caricato dal produttore nel thread,
 * conservato senza modifiche come fixture. Celle e valori qui sotto sono stati letti dal file, non presunti.
 */
const bytes = new Uint8Array(readFileSync(new URL("./fixtures/official-monitor/575-2025-R-eel-TABELLE_TIT.xlsx", import.meta.url)));
const SHA = "22cd84f9163bd0a788921f8a26c9fd5ddedd7a0ea77edbbf06d714d57413de5d";
assert.equal(createHash("sha256").update(bytes).digest("hex"), SHA, "fixture identica al file caricato dal produttore");

const reading = readTitTable5File(bytes);
assert.deepEqual(reading.structure, { sheet: "Tab.5", titleCell: "B1", years: [2024, 2025, 2026] });
assert.ok(reading.checks.every((check) => check.ok), JSON.stringify(reading.checks));

const y2026 = validateTable5Year(reading, 2026);
assert.ok(y2026.checks.every((check) => check.ok));
const at = (voltage, kind, band) => y2026.values.find((value) => value.voltage === voltage && value.kind === kind && value.band === band);
assert.deepEqual([at("BT", "WITHDRAWN", "F1").centsPerKvarh, at("BT", "WITHDRAWN", "F1").cell, at("BT", "WITHDRAWN", "F1").thresholdRatio], ["1.088", "H8", "0.33"]);
assert.deepEqual([at("BT", "WITHDRAWN", "F2").centsPerKvarh, at("BT", "WITHDRAWN", "F2").cell], ["1.088", "H9"]);
assert.deepEqual([at("BT", "INJECTED", "F3").centsPerKvarh, at("BT", "INJECTED", "F3").cell], ["1.088", "I10"]);
assert.deepEqual([at("MT", "WITHDRAWN", "F1").centsPerKvarh, at("MT", "WITHDRAWN", "F1").cell], ["0.377", "H5"]);
assert.deepEqual([at("MT", "INJECTED", "F3").centsPerKvarh, at("MT", "INJECTED", "F3").cell], ["0.377", "I7"]);
// Righe "quota parte" (B11:I16) escluse: 0,264 e 0,795 non devono comparire.
assert.ok(!y2026.values.some((value) => ["0.264", "0.795"].includes(value.centsPerKvarh)));
// Il 2027 ha intestazioni ma nessun valore: non validabile.
assert.ok(validateTable5Year(reading, 2027).checks.some((check) => !check.ok));

const repositories = { alerts: memoryRepository(), checks: memoryRepository(), documents: memoryRepository(), publications: memoryRepository() };
await upsertAlert(repositories, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", reason: "documento assente", now: "2026-11-17T08:00:00Z" });
const { record: document } = await validateOfficialDocument(repositories, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", originalName: "575-2025-R-eel-TABELLE_TIT.xlsx", bytes, uploadedBy: "collaudo", now: "2026-11-17T08:01:00Z", fetchOfficial: async () => null });
assert.equal(document.status, "VALIDATED");
assert.equal(document.sha256, SHA);
assert.deepEqual(document.structure, { sheet: "Tab.5", titleCell: "B1", years: [2024, 2025, 2026] });
assert.ok(document.checks.every((check) => check.ok));
assert.equal(document.provenance.level, "DECLARED_BY_PRODUCER", "sito ARERA non raggiungibile: provenienza non confermata dall'impronta");
assert.equal((await listAlerts(repositories))[0].status, "FILE_UPLOADED", "dopo la sola validazione l'alert non è risolto");
assert.equal((await publishedDocuments(repositories, "ARERA_TIT_TABLE5_REACTIVE")).length, 0, "nessun dato disponibile prima della pubblicazione");
await assert.rejects(() => publishOfficialDocument(repositories, { documentId: document.documentId, confirmSha256: SHA, acknowledgeDeclaredProvenance: false, publishedBy: "collaudo", now: "2026-11-17T08:05:00Z" }), /PROVENANCE_ACK_REQUIRED/);
await publishOfficialDocument(repositories, { documentId: document.documentId, confirmSha256: SHA, acknowledgeDeclaredProvenance: true, publishedBy: "collaudo", now: "2026-11-17T08:05:00Z" });
assert.equal((await listAlerts(repositories))[0].status, "RESOLVED", "alert risolto dopo la pubblicazione confermata");

const rows = reactiveRowsFromOfficialDocuments(await publishedDocuments(repositories, "ARERA_TIT_TABLE5_REACTIVE"));
assert.deepEqual(rows.map((row) => `${row.id}=${row.rate.value}`).sort(), ["TIT5-BT-2026-IMMESSA=1.088", "TIT5-BT-2026-PRELEVATA=1.088", "TIT5-MT-2026-IMMESSA=0.377", "TIT5-MT-2026-PRELEVATA=0.377"]);

const input = referenceInput();
const result = simulateV3({ ...input, regulated: { ...input.regulated, reactiveTariff: rows } });
assert.equal(result.totals.byLeaf.REACTIVE, 548, "504 kVArh × 1,088 c€/kVArh = 5,48 €");
assert.deepEqual(result.totals.unverified, []);
assert.equal(result.totals.status, "COMPLETE");
assert.equal(result.totals.totalCents, 20464);

console.log("official-monitor-real-tit: OK");
