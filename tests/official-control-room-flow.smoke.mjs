import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syntheticTitWorkbook } from "./fixtures/official-monitor/synthetic-tit-xlsx.mjs";

/**
 * Control Room Produttore, flusso semplificato (Tony, 17/11/2026), attraverso la route vera in modalità locale su una cartella
 * temporanea: tipo e periodo rilevati dal contenuto (mai dal nome), conferma legata alla versione validata senza trascrivere lo
 * SHA-256, conferma esplicita per la provenienza non verificata, e il server che continua a bloccare file alterati, conferme di
 * un'altra versione, duplicati, versioni più vecchie e utenti che non sono il produttore.
 */
const fixture = new URL("./fixtures/official-monitor/575-2025-R-eel-TABELLE_TIT.xlsx", import.meta.url);
const bytes = await readFile(fixture);
const root = await mkdtemp(path.join(os.tmpdir(), "control-room-flow-"));
const originalCwd = process.cwd();
process.chdir(root);
Object.assign(process.env, { APP_RUNTIME_MODE: "local", FOUNDATION_LOCAL_DEV: "true" });
const as = (tenantId, role, userId = "user_test") => Object.assign(process.env, { FOUNDATION_LOCAL_TENANT_ID: tenantId, FOUNDATION_LOCAL_ROLE: role, FOUNDATION_LOCAL_USER_ID: userId });
const { GET, POST } = await import("../app/api/system/control-room/route.ts");
const { detectOfficialUpload } = await import("../app/lib/official-monitor/documents.ts");
const { upsertAlert } = await import("../app/lib/official-monitor/monitor.ts");
const { runtimeRepositories } = await import("../app/lib/persistence/adapter.ts");
const URL_ = "http://localhost/api/system/control-room";
const drop = (file, name = "qualunque-nome.xlsx") => { const form = new FormData(); form.append("file", new File([file], name)); return POST(new Request(URL_, { method: "POST", body: form })); };
const chosen = (file, period, name = "scelto.xlsx") => { const form = new FormData(); form.append("code", "ARERA_TIT_TABLE5_REACTIVE"); form.append("period", period); form.append("file", new File([file], name)); return POST(new Request(URL_, { method: "POST", body: form })); };
const publish = (doc, extra = {}) => POST(new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish", documentId: doc.documentId, confirmSha256: doc.sha256, acknowledgeDeclaredProvenance: false, ...extra }) }));
const errorCode = async (response) => (await response.json()).error.code;

try {
  // --- Rilevamento dal contenuto (funzione pura, data fissata) ----------------------------------------------------------
  const tit = new Uint8Array(bytes);
  assert.deepEqual(detectOfficialUpload(tit, { openAlerts: [], now: "2026-11-17T10:00:00Z" }).period, "2026", "anno in corso presente nel file");
  assert.equal(detectOfficialUpload(tit, { openAlerts: [{ code: "ARERA_TIT_TABLE5_REACTIVE", period: "2025", status: "MISSING" }], now: "2026-11-17T10:00:00Z" }).period, "2025", "prima l'anno dell'alert aperto");
  assert.equal(detectOfficialUpload(tit, { openAlerts: [{ code: "ARERA_TIT_TABLE5_REACTIVE", period: "2025", status: "RESOLVED" }], now: "2026-11-17T10:00:00Z" }).period, "2026", "un alert risolto non conta");
  assert.throws(() => detectOfficialUpload(tit, { openAlerts: ["2025", "2026"].map((period) => ({ code: "ARERA_TIT_TABLE5_REACTIVE", period, status: "MISSING" })), now: "2026-11-17T10:00:00Z" }), /PERIOD_AMBIGUOUS/);
  assert.throws(() => detectOfficialUpload(tit, { openAlerts: [], now: "2031-01-10T10:00:00Z" }), /PERIOD_UNDETERMINED/, "nessun anno riconoscibile: lo sceglie il produttore");
  assert.throws(() => detectOfficialUpload(new TextEncoder().encode("<html>tabella 5 reattiva</html>"), { openAlerts: [], now: "2026-11-17T10:00:00Z" }), /TYPE_UNKNOWN/);
  assert.throws(() => detectOfficialUpload(syntheticTitWorkbook({ table5: false }), { openAlerts: [], now: "2026-11-17T10:00:00Z" }), /TYPE_UNKNOWN/, "Excel senza Tabella 5");

  // --- Solo il produttore -----------------------------------------------------------------------------------------------
  as("tenant_energia-priva", "ADMIN");
  assert.equal((await drop(bytes)).status, 403, "amministratore di un'azienda cliente: caricamento negato");
  as("tenant_piattaforma", "ANALYST");
  assert.equal((await drop(bytes)).status, 403, "analista della piattaforma: caricamento negato");
  as("tenant_piattaforma", "ADMIN", "user_produttore");

  // --- File trascinato senza scegliere nulla: tipo e periodo dall'alert aperto ---------------------------------------------
  const r = runtimeRepositories();
  await upsertAlert({ alerts: r.officialAlerts, checks: r.officialChecks }, { code: "ARERA_TIT_TABLE5_REACTIVE", period: "2026", reason: "documento assente", now: new Date().toISOString() });
  const unknown = await drop(new TextEncoder().encode("<!doctype html><p>pagina</p>"), "575-2025-R-eel-TABELLE_TIT.xlsx");
  assert.equal(unknown.status, 422); assert.equal(await errorCode(unknown), "OFFICIAL_UPLOAD_TYPE_UNKNOWN", "il nome del file non basta");
  assert.equal((await (await GET(new Request(URL_))).json()).documents.length, 0, "nessun documento conservato per un tipo non riconosciuto");

  const first = await drop(bytes);
  assert.equal(first.status, 200);
  const { document: doc, detected, duplicate } = await first.json();
  assert.equal(duplicate, false);
  assert.deepEqual([detected.code, detected.period], ["ARERA_TIT_TABLE5_REACTIVE", "2026"]); assert.match(detected.basis, /alert/);
  assert.equal(doc.status, "VALIDATED"); assert.equal(doc.period, "2026"); assert.equal(doc.originalBase64, undefined);

  // --- Conferma legata alla versione: impronta di un'altra versione rifiutata, provenienza non verificata solo con conferma --
  const other = await publish(doc, { confirmSha256: "f".repeat(64), acknowledgeDeclaredProvenance: true });
  assert.equal(other.status, 409); assert.equal(await errorCode(other), "OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH");
  if (doc.provenance.level !== "MATCHES_OFFICIAL_DOWNLOAD") {
    const noAck = await publish(doc);
    assert.equal(noAck.status, 409); assert.equal(await errorCode(noAck), "OFFICIAL_PUBLISH_PROVENANCE_ACK_REQUIRED", "nessuna pubblicazione automatica di una provenienza non verificata");
  }

  // --- File alterato dopo la validazione: il server ricalcola l'impronta dal file conservato --------------------------------
  const v2 = (await (await chosen(syntheticTitWorkbook({ extraNote: "seconda versione" }), "2026")).json()).document;
  assert.equal(v2.status, "VALIDATED"); assert.equal(v2.version, 2);
  const dir = path.join(root, "var/phase6/official-documents/tenant_piattaforma");
  const file = path.join(dir, (await readdir(dir)).find((name) => name.includes(v2.documentId.replace("official-document_", ""))) ?? "");
  const stored = JSON.parse(await readFile(file, "utf8"));
  const holder = stored.payload ?? stored.record?.payload ?? stored;
  const original = Buffer.from(holder.originalBase64, "base64"); original[original.length - 10] ^= 0xff; holder.originalBase64 = original.toString("base64");
  await writeFile(file, JSON.stringify(stored));
  const altered = await publish(v2, { acknowledgeDeclaredProvenance: true });
  assert.equal(altered.status, 409); assert.equal(await errorCode(altered), "OFFICIAL_PUBLISH_INTEGRITY_FAILED", "file conservato alterato: bloccato");

  // --- Pubblicazione confermata, poi duplicato e versione più vecchia bloccati -----------------------------------------------
  const ok = await publish(doc, { acknowledgeDeclaredProvenance: true });
  assert.equal(ok.status, 200);
  const { publication } = await ok.json();
  assert.equal(publication.sha256, doc.sha256); assert.equal(publication.publishedBy, "user_produttore");
  assert.equal(publication.provenanceAcknowledged, doc.provenance.level !== "MATCHES_OFFICIAL_DOWNLOAD", "la conferma è registrata solo se serviva");
  const again = await publish(doc, { acknowledgeDeclaredProvenance: true });
  assert.equal(again.status, 409); assert.equal(await errorCode(again), "OFFICIAL_PUBLISH_ALREADY_PUBLISHED");
  const v3 = (await (await chosen(syntheticTitWorkbook({ extraNote: "terza versione" }), "2026")).json()).document;
  assert.equal(v3.version, 3);
  assert.equal((await publish(v3, { acknowledgeDeclaredProvenance: true })).status, 200, "versione più recente pubblicabile");
  const older = await publish(doc, { acknowledgeDeclaredProvenance: true });
  assert.equal(older.status, 409); assert.match(await errorCode(older), /OLDER_VERSION|ALREADY_PUBLISHED/);

  // --- Lo stesso file caricato di nuovo: nessuna nuova versione ----------------------------------------------------------
  const dup = await (await chosen(bytes, "2026", "di-nuovo.xlsx")).json();
  assert.equal(dup.duplicate, true); assert.equal(dup.document.documentId, doc.documentId);
  const model = await (await GET(new Request(URL_))).json();
  assert.equal(model.documents.length, 3, "v1 rilevata, v2 alterata, v3: nessuna versione in più");
  console.log("official-control-room-flow: OK");
} finally {
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
}
