import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026): autorizzazioni e pubblicazione simulata attraverso la route
 * vera, in modalità locale su una cartella temporanea (nessuna scrittura negli archivi di produzione). Il principal viene dalla
 * sessione lato server; tenant e ruolo dichiarati dal browser (header, campi del form) sono ignorati.
 */
const fixture = new URL("./fixtures/official-monitor/575-2025-R-eel-TABELLE_TIT.xlsx", import.meta.url);
const SHA = "22cd84f9163bd0a788921f8a26c9fd5ddedd7a0ea77edbbf06d714d57413de5d";
const bytes = await readFile(fixture);
const root = await mkdtemp(path.join(os.tmpdir(), "official-archives-"));
const originalCwd = process.cwd();
process.chdir(root);
Object.assign(process.env, { APP_RUNTIME_MODE: "local", FOUNDATION_LOCAL_DEV: "true" });
const as = (tenantId, role, userId = "user_test") => Object.assign(process.env, { FOUNDATION_LOCAL_TENANT_ID: tenantId, FOUNDATION_LOCAL_ROLE: role, FOUNDATION_LOCAL_USER_ID: userId });
const { GET, POST } = await import("../app/api/system/control-room/route.ts");
const URL_ = "http://localhost/api/system/control-room";
const spoof = { "x-tenant-id": "tenant_piattaforma", "x-role": "ADMIN" };
const get = () => GET(new Request(URL_, { headers: spoof }));
const validate = (file = bytes, name = "575-2025-R-eel-TABELLE_TIT.xlsx", period = "2026") => { const form = new FormData(); form.append("code", "ARERA_TIT_TABLE5_REACTIVE"); form.append("period", period); form.append("tenantId", "tenant_piattaforma"); form.append("file", new File([file], name)); return POST(new Request(URL_, { method: "POST", body: form, headers: spoof })); };
const json = (body) => POST(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...spoof }, body: JSON.stringify(body) }));

try {
  // --- Autorizzazioni: solo ADMIN di tenant_piattaforma -----------------------------------------------------------------
  const outsiders = [
    ["amministratore di un'azienda cliente", "tenant_energia-priva", "ADMIN"],
    ["direttore aziendale (ANALYST)", "tenant_energia-priva", "ANALYST"],
    ["agente (VIEWER)", "tenant_energia-priva", "VIEWER"],
    ["subagente (VIEWER)", "tenant_energia-priva", "VIEWER"],
    ["analista della piattaforma", "tenant_piattaforma", "ANALYST"],
    ["visualizzatore della piattaforma", "tenant_piattaforma", "VIEWER"],
  ];
  for (const [who, tenant, role] of outsiders) {
    as(tenant, role);
    assert.equal((await get()).status, 403, `${who}: lettura negata`);
    assert.equal((await validate()).status, 403, `${who}: caricamento negato`);
    assert.equal((await json({ action: "publish", documentId: "official-document_x", confirmSha256: SHA, acknowledgeDeclaredProvenance: true })).status, 403, `${who}: pubblicazione negata`);
    assert.equal((await json({ action: "run" })).status, 403, `${who}: esecuzione controlli negata`);
  }

  // --- Produttore: validazione, anteprima, pubblicazione -----------------------------------------------------------------
  as("tenant_piattaforma", "ADMIN", "user_produttore");
  const first = await (await get()).json();
  assert.deepEqual(first.archives.map((item) => item.source), ["ARERA", "GME", "TERNA", "ADM"]);
  assert.ok(first.catalog.find((entry) => entry.code === "ARERA_TIT_TABLE5_REACTIVE").uploadable);
  const unsupported = new FormData(); unsupported.append("code", "GME_PUN_MONTH"); unsupported.append("period", "2026-10"); unsupported.append("file", new File([bytes], "x.xlsx"));
  assert.equal((await POST(new Request(URL_, { method: "POST", body: unsupported }))).status, 400, "documento senza caricamento previsto");

  const renamed = await validate(bytes, "qualunque-nome.xlsx");
  assert.equal(renamed.status, 200);
  const { document: preview, duplicate } = await renamed.json();
  assert.equal(duplicate, false);
  assert.equal(preview.status, "VALIDATED", "il contenuto decide, non il nome del file");
  assert.equal(preview.sha256, SHA);
  assert.equal(preview.source, "ARERA");
  assert.equal(preview.period, "2026");
  assert.deepEqual(preview.structure, { sheet: "Tab.5", titleCell: "B1", years: [2024, 2025, 2026] });
  assert.equal(preview.originalBase64, undefined, "l'anteprima non rimanda il file");
  assert.match(preview.provenanceLabel, /non è prova di autenticità|Verificata/);
  const value = (voltage, kind, band) => preview.values.find((item) => item.voltage === voltage && item.kind === kind && item.band === band);
  assert.deepEqual([value("BT", "WITHDRAWN", "F1").centsPerKvarh, value("BT", "WITHDRAWN", "F1").cell], ["1.088", "H8"]);
  assert.deepEqual([value("BT", "INJECTED", "F3").centsPerKvarh, value("BT", "INJECTED", "F3").cell], ["1.088", "I10"]);
  assert.deepEqual([value("MT", "WITHDRAWN", "F1").centsPerKvarh, value("MT", "WITHDRAWN", "F1").cell], ["0.377", "H5"]);
  assert.deepEqual([value("MT", "INJECTED", "F3").centsPerKvarh, value("MT", "INJECTED", "F3").cell], ["0.377", "I7"]);
  assert.ok(preview.checks.some((check) => check.code === "UNIT" && check.ok));

  // Same file again: no new version.
  const again = await (await validate()).json();
  assert.equal(again.duplicate, true); assert.equal(again.document.documentId, preview.documentId);
  // Corrupted copy: rejected, never publishable.
  const corrupted = Buffer.from(bytes); corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  const rejected = (await (await validate(corrupted)).json()).document;
  assert.equal(rejected.status, "REJECTED");
  assert.equal((await json({ action: "publish", documentId: rejected.documentId, confirmSha256: rejected.sha256, acknowledgeDeclaredProvenance: true })).status, 409);

  // Before publication: nothing published, alert not resolved.
  const before = await (await get()).json();
  const arera = before.archives.find((item) => item.source === "ARERA");
  assert.equal(arera.documents.find((doc) => doc.code === "ARERA_TIT_TABLE5_REACTIVE").coveredPeriods.length, 0, "validato non è pubblicato");

  // Publication: wrong confirmation, missing provenance acknowledgment (when declared), then the confirmed one.
  const wrong = await json({ action: "publish", documentId: preview.documentId, confirmSha256: "0".repeat(64), acknowledgeDeclaredProvenance: true });
  assert.equal(wrong.status, 409); assert.equal((await wrong.json()).error.code, "OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH");
  if (preview.provenance.level === "DECLARED_BY_PRODUCER") {
    const noAck = await json({ action: "publish", documentId: preview.documentId, confirmSha256: SHA, acknowledgeDeclaredProvenance: false });
    assert.equal(noAck.status, 409); assert.equal((await noAck.json()).error.code, "OFFICIAL_PUBLISH_PROVENANCE_ACK_REQUIRED");
  }
  const published = await json({ action: "publish", documentId: preview.documentId, confirmSha256: SHA.toUpperCase(), acknowledgeDeclaredProvenance: true });
  assert.equal(published.status, 200);
  const { publication } = await published.json();
  assert.equal(publication.sha256, SHA); assert.equal(publication.publishedBy, "user_produttore");
  assert.equal((await json({ action: "publish", documentId: preview.documentId, confirmSha256: SHA, acknowledgeDeclaredProvenance: true })).status, 409, "nessuna doppia pubblicazione");

  const after = await (await get()).json();
  const arera2 = after.archives.find((item) => item.source === "ARERA");
  assert.deepEqual(arera2.documents.find((doc) => doc.code === "ARERA_TIT_TABLE5_REACTIVE").coveredPeriods, ["2026"]);
  assert.ok(arera2.history.some((entry) => entry.kind === "PUBLICATION" && entry.documentId === preview.documentId && entry.actor === "user_produttore"));
  assert.ok(arera2.history.some((entry) => entry.kind === "VALIDATION" && entry.outcome === "REJECTED"));

  // Audit: validation and publication recorded with who and what, without file contents.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const walk = (dir) => readdirSync(dir).flatMap((name) => { const full = path.join(dir, name); return statSync(full).isDirectory() ? walk(full) : [full]; });
  const stored = walk(path.join(root, "var")).map((file) => readFileSync(file, "utf8"));
  const auditText = stored.filter((text) => /official-document\.(validate|publish)/.test(text)).join("\n");
  assert.match(auditText, /official-document\.validate/);
  assert.match(auditText, /official-document\.publish/);
  assert.match(auditText, /user_produttore/);
  assert.doesNotMatch(auditText, /UEsDB/, "nessun contenuto del file nell'audit");
  assert.ok(stored.some((text) => text.includes("UEsDB")), "l'originale è conservato nell'archivio documenti");
  console.log("official-archives-route: OK");
} finally {
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
}
