import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PROVENANCE_LABEL, publishOfficialDocument, publishedDocuments, validateOfficialDocument } from "../app/lib/official-monitor/documents.ts";
import { listAlerts, upsertAlert } from "../app/lib/official-monitor/monitor.ts";
import { syntheticTitWorkbook, memoryRepository } from "./fixtures/official-monitor/synthetic-tit-xlsx.mjs";

/**
 * Provenienza della Tabella 5 (Tony, 17/11/2026, "correzione minima PROVENANCE"): file identico al download ufficiale →
 * verificata; impronta diversa ma valori tariffari del periodo identici → DA VERIFICARE, pubblicabile solo con conferma
 * esplicita; valori diversi o equivalenza non dimostrabile → bloccato; download non valido → nessun riferimento, provenienza
 * dichiarata. Valori identici non rendono mai autentico un documento.
 */
const NOW = "2026-11-17T10:00:00Z";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const official = new Uint8Array(readFileSync(new URL("./fixtures/official-monitor/575-2025-R-eel-TABELLE_TIT.xlsx", import.meta.url)));
const OFFICIAL_SHA = "22cd84f9163bd0a788921f8a26c9fd5ddedd7a0ea77edbbf06d714d57413de5d";
assert.equal(sha(official), OFFICIAL_SHA);

const setup = async () => {
  const r = { alerts: memoryRepository(), checks: memoryRepository(), documents: memoryRepository(), publications: memoryRepository() };
  await upsertAlert(r, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", reason: "documento assente", now: NOW });
  return r;
};
const validate = (r, bytes, download) => validateOfficialDocument(r, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", originalName: "575-2025-R-eel-TABELLE_TIT.xlsx", bytes, uploadedBy: "user_owner", now: NOW, fetchOfficial: async () => download });
const publish = (r, document, acknowledge) => publishOfficialDocument(r, { documentId: document.documentId, confirmSha256: document.sha256, acknowledgeDeclaredProvenance: acknowledge, publishedBy: "user_owner", now: "2026-11-17T10:05:00Z" });
const alertStatus = async (r) => (await listAlerts(r))[0].status;
const provenanceCheck = (document) => document.checks.find((check) => check.code === "PROVENANCE");

// 1. Identico: verificata, nessuna conferma aggiuntiva richiesta.
{
  const r = await setup();
  const { record } = await validate(r, official, official);
  assert.equal(record.status, "VALIDATED");
  assert.equal(record.provenance.level, "MATCHES_OFFICIAL_DOWNLOAD"); assert.equal(record.provenance.comparison, "IDENTICAL");
  assert.equal(record.sha256, OFFICIAL_SHA); assert.equal(record.provenance.officialSha256, OFFICIAL_SHA);
  assert.match(PROVENANCE_LABEL[record.provenance.level], /^Verificata/);
  assert.equal(await alertStatus(r), "FILE_UPLOADED");
  const publication = await publish(r, record, false);
  assert.equal(publication.provenanceAcknowledged, false);
  assert.equal(await alertStatus(r), "RESOLVED");
}

// 2. Equivalente: impronta diversa, stessi valori 2026 (celle e fogli possono cambiare) → DA VERIFICARE.
{
  const r = await setup();
  const variant = syntheticTitWorkbook({ extraNote: "altra versione del file" });
  const reference = syntheticTitWorkbook();
  assert.notEqual(sha(variant), sha(reference));
  const { record } = await validate(r, variant, reference);
  assert.equal(record.status, "VALIDATED", "tecnicamente valido ed equivalente: non rifiutato");
  assert.equal(record.provenance.level, "EQUIVALENT_TO_OFFICIAL_DOWNLOAD"); assert.equal(record.provenance.comparison, "EQUIVALENT");
  assert.equal(record.sha256, sha(variant)); assert.equal(record.provenance.officialSha256, sha(reference), "conservate entrambe le impronte");
  assert.ok(provenanceCheck(record).ok); assert.match(provenanceCheck(record).detail, /da verificare/);
  assert.match(PROVENANCE_LABEL[record.provenance.level], /^Da verificare.*non è prova di autenticità/, "valori identici non rendono autentico il file");
  assert.equal(await alertStatus(r), "FILE_UPLOADED");
  await assert.rejects(() => publish(r, record, false), /PROVENANCE_ACK_REQUIRED/, "serve la conferma esplicita");
  assert.equal((await publishedDocuments(r, "ARERA_TIT_TABLE5_REACTIVE")).length, 0);
  const publication = await publish(r, record, true);
  assert.equal(publication.provenanceLevel, "EQUIVALENT_TO_OFFICIAL_DOWNLOAD"); assert.equal(publication.provenanceAcknowledged, true);
  assert.equal(await alertStatus(r), "RESOLVED");
}

// 3. Valori diversi → bloccato (rifiutato, non pubblicabile).
{
  const r = await setup();
  const reference = syntheticTitWorkbook({ bt: { 2024: "1.169", 2025: "1.046", 2026: "1.099" } });
  const { record } = await validate(r, syntheticTitWorkbook(), reference);
  assert.equal(record.status, "REJECTED");
  assert.equal(record.provenance.level, "DIFFERS_FROM_OFFICIAL_DOWNLOAD"); assert.equal(record.provenance.comparison, "DIFFERENT");
  assert.equal(record.provenance.officialSha256, sha(reference));
  assert.deepEqual(record.values, []);
  await assert.rejects(() => publish(r, record, true), /NOT_VALIDATED/);
  assert.equal(await alertStatus(r), "REJECTED");
  // Same values but a different threshold (classification) is a different tariff too.
  const threshold = syntheticTitWorkbook({ thresholdPercent: 40 });
  const other = (await validate(await setup(), syntheticTitWorkbook({ extraNote: "x" }), threshold)).record;
  assert.equal(other.provenance.comparison, "DIFFERENT", "soglia 40% contro 33%: tariffa diversa");
  assert.equal(other.status, "REJECTED");
}

// 4. Equivalenza non dimostrabile: il file ufficiale non contiene l'anno → bloccato.
{
  const r = await setup();
  const reference = syntheticTitWorkbook({ years: [2024, 2025], bt: { 2024: "1.169", 2025: "1.046" }, mt: { 2024: "0.408", 2025: "0.361" } });
  const { record } = await validate(r, syntheticTitWorkbook(), reference);
  assert.equal(record.status, "REJECTED");
  assert.equal(record.provenance.level, "DIFFERS_FROM_OFFICIAL_DOWNLOAD"); assert.equal(record.provenance.comparison, "NOT_DEMONSTRABLE");
}

// 5. Download non valido (pagina HTML, Excel senza Tabella 5, file troncato): nessun riferimento, provenienza dichiarata.
for (const [label, download] of [
  ["pagina HTML", new TextEncoder().encode("<!doctype html><html><body>Verifica di sicurezza</body></html>")],
  ["Excel senza Tabella 5", syntheticTitWorkbook({ table5: false })],
  ["Excel troncato", official.slice(0, 2000)],
]) {
  const r = await setup();
  const { record } = await validate(r, official, download);
  assert.equal(record.status, "VALIDATED", `${label}: il file caricato resta valido`);
  assert.equal(record.provenance.level, "DECLARED_BY_PRODUCER", `${label}: provenienza dichiarata`);
  assert.equal(record.provenance.comparison, "INVALID_DOWNLOAD");
  assert.equal(record.provenance.officialSha256, null, `${label}: l'impronta del download non è usata come riferimento`);
  assert.equal(record.provenance.discardedDownloadSha256, sha(download), `${label}: impronta scartata conservata per l'audit`);
  await assert.rejects(() => publish(r, record, false), /PROVENANCE_ACK_REQUIRED/);
}

// 6. Sito non raggiungibile: dichiarata, come prima.
{
  const r = await setup();
  const { record } = await validate(r, official, null);
  assert.equal(record.provenance.level, "DECLARED_BY_PRODUCER"); assert.equal(record.provenance.comparison, "UNREACHABLE");
  assert.equal(record.provenance.officialSha256, null);
}

console.log("official-provenance: OK");
