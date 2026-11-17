"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ErrorState } from "./UiStates";
import { requestForm, requestJson, toUiError } from "../lib/ui/client";

/**
 * Control Room Produttore → Archivi ufficiali, flusso semplificato (Tony, 17/11/2026). In alto solo gli aggiornamenti da
 * completare, ognuno con una sola azione: «Completa aggiornamento» per un documento già validato e pubblicabile, «Carica il
 * file» per un documento mancante. Il caricamento si fa scegliendo o trascinando il file: tipo e periodo sono rilevati dal
 * contenuto quando è verificabile, la validazione parte subito e mostra direttamente l'unica conferma necessaria. La conferma
 * è legata alla versione mostrata (la schermata invia la sua impronta, il produttore non la trascrive); se l'autenticità non è
 * verificata serve la dichiarazione esplicita del produttore, che non è un'autenticazione presso la fonte. Il server ripete
 * ogni controllo (permessi, impronta e valori riletti dal file conservato, provenienza, duplicati e versioni) e risponde solo
 * al produttore (ADMIN di tenant_piattaforma): questa schermata non decide nulla sull'accesso. Dettagli tecnici, SHA-256,
 * storico e audit restano nella sezione espandibile.
 */
type Alert = { readonly alertId: string; readonly code: string; readonly document: string; readonly period: string; readonly officialLink: string; readonly reason: string; readonly instructions: readonly string[]; readonly uploadPath: string; readonly status: string; readonly statusLabel: string; readonly lastCheckedAt: string; readonly occurrences: number };
type DocumentView = { readonly code: string; readonly document: string; readonly acquisition: string; readonly officialLink: string; readonly uploadPath: string; readonly uploadable: boolean; readonly coveredPeriods: readonly string[]; readonly lastUpdate: string | null };
type HistoryEntry = { readonly at: string; readonly kind: string; readonly document: string; readonly period: string; readonly outcome: string; readonly detail: string; readonly actor: string | null; readonly documentId: string | null };
type Archive = { readonly source: string; readonly label: string; readonly status: string; readonly statusLabel: string; readonly lastUpdate: string | null; readonly periodCovered: string; readonly officialLinks: readonly string[]; readonly missing: readonly { readonly code: string; readonly document: string; readonly period: string; readonly statusLabel: string }[]; readonly alerts: readonly Alert[]; readonly documents: readonly DocumentView[]; readonly history: readonly HistoryEntry[] };
type Value = { readonly voltage: string; readonly year: number; readonly kind: string; readonly band: string; readonly centsPerKvarh: string; readonly thresholdRatio: string; readonly sheet: string; readonly cell: string };
type Preview = { readonly documentId: string; readonly code: string; readonly source: string; readonly period: string; readonly version: number; readonly originalName: string; readonly size: number; readonly sha256: string; readonly status: string; readonly uploadedAt: string; readonly provenance: { readonly level: string; readonly detail: string; readonly officialSha256: string | null; readonly comparison?: string }; readonly provenanceLabel: string; readonly checks: readonly { readonly code: string; readonly ok: boolean; readonly detail: string }[]; readonly warnings: readonly string[]; readonly values: readonly Value[]; readonly structure: { readonly sheet: string | null; readonly titleCell: string | null; readonly years: readonly number[] } };
type CatalogItem = { readonly code: string; readonly source: string; readonly document: string; readonly uploadable: boolean };
type Model = { readonly archives: readonly Archive[]; readonly documents: readonly Preview[]; readonly catalog: readonly CatalogItem[] };
type Detected = { readonly code: string; readonly period: string; readonly basis: string };
type Destination = { readonly code: string; readonly period: string; readonly from: string };
type Pending =
  | { readonly kind: "PUBLISH"; readonly key: string; readonly source: string; readonly period: string; readonly code: string; readonly doc: Preview }
  | { readonly kind: "UPLOAD" | "MANUAL" | "SOURCE"; readonly key: string; readonly source: string; readonly archiveSource: string; readonly period: string; readonly code: string; readonly alert: Alert };

const when = (value: string | null) => value ? new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }) : "mai";
const decimal = (value: string) => value.replace(".", ",");
const tone = (status: string) => status === "UP_TO_DATE" || status === "RESOLVED" || status === "VALIDATED" || status === "PUBLISHED" || status === "COVERED" || status === "ACQUIRED" ? "positive" : status === "NEVER_CHECKED" || status === "FILE_UPLOADED" || status === "AWAITING_PUBLICATION" ? "" : "negative";
const KIND_LABEL: Readonly<Record<string, string>> = { CHECK: "Controllo", VALIDATION: "Validazione", PUBLICATION: "Pubblicazione" };
/** Control Room codes in plain Italian (the shared client only knows the app-wide ones): same wording as the server's answers. */
const CONTROL_ROOM_MESSAGES: Readonly<Record<string, string>> = {
  AUTHORIZATION_DENIED: "Riservato al produttore della piattaforma.",
  OFFICIAL_UPLOAD_TYPE_UNKNOWN: "Tipo di documento non riconosciuto dal contenuto del file: scegli documento e periodo manualmente.",
  OFFICIAL_UPLOAD_PERIOD_AMBIGUOUS: "Il file contiene più anni richiesti da alert aperti: scegli il periodo manualmente.",
  OFFICIAL_UPLOAD_PERIOD_UNDETERMINED: "Periodo non determinabile dal file: scegli il periodo manualmente.",
  OFFICIAL_UPLOAD_SIZE_INVALID: "File vuoto o oltre 2 MB.",
  OFFICIAL_UPLOAD_NOT_SUPPORTED: "Per questo documento il caricamento non è previsto: segui le istruzioni dell'archivio.",
  OFFICIAL_UPLOAD_FILE_MISSING: "Seleziona il file scaricato dalla fonte ufficiale.",
  OFFICIAL_UPLOAD_REJECTED: "Validazione non riuscita.",
  OFFICIAL_PUBLISH_DOCUMENT_NOT_FOUND: "Documento non trovato.",
  OFFICIAL_PUBLISH_NOT_VALIDATED: "Si pubblica solo un documento con tutti i controlli superati.",
  OFFICIAL_PUBLISH_CONFIRMATION_MISMATCH: "La conferma non corrisponde alla versione validata conservata: aggiorna la pagina e riprova.",
  OFFICIAL_PUBLISH_PROVENANCE_REJECTED: "Provenienza bloccata: valori diversi dal file della fonte ufficiale, o equivalenza non dimostrabile.",
  OFFICIAL_PUBLISH_PROVENANCE_ACK_REQUIRED: "Autenticità non verificata: serve la tua conferma esplicita.",
  OFFICIAL_PUBLISH_INTEGRITY_FAILED: "Il file conservato non corrisponde più alla sua impronta: pubblicazione bloccata.",
  OFFICIAL_PUBLISH_CONTENT_CHANGED: "La rilettura del file conservato non conferma i valori validati: pubblicazione bloccata.",
  OFFICIAL_PUBLISH_ALREADY_PUBLISHED: "Questa versione è già pubblicata.",
  OFFICIAL_PUBLISH_OLDER_VERSION: "È già pubblicata una versione più recente dello stesso documento e periodo.",
};
const MANUAL_CHOICE_CODES = new Set(["OFFICIAL_UPLOAD_TYPE_UNKNOWN", "OFFICIAL_UPLOAD_PERIOD_AMBIGUOUS", "OFFICIAL_UPLOAD_PERIOD_UNDETERMINED"]);
const errorText = (cause: unknown) => { const safe = toUiError(cause); return `${CONTROL_ROOM_MESSAGES[safe.code] ?? safe.message} (codice ${safe.code})`; };
/** Provenance levels the producer must explicitly accept (same list as the server's PROVENANCE_NEEDS_ACK). */
const NEEDS_ACK = new Set(["EQUIVALENT_TO_OFFICIAL_DOWNLOAD", "DECLARED_BY_PRODUCER"]);
const SHORT_PROVENANCE: Readonly<Record<string, string>> = {
  MATCHES_OFFICIAL_DOWNLOAD: "Provenienza verificata",
  EQUIVALENT_TO_OFFICIAL_DOWNLOAD: "Autenticità non verificata: valori identici al file ufficiale",
  DECLARED_BY_PRODUCER: "Autenticità non verificata: provenienza solo dichiarata",
  DIFFERS_FROM_OFFICIAL_DOWNLOAD: "Bloccato: diverso dal file ufficiale",
};
const dropZoneStyle = (active: boolean) => ({ display: "grid", gap: 6, placeItems: "center", padding: "26px 16px", border: `2px dashed ${active ? "var(--teal)" : "#b8c5d6"}`, borderRadius: 12, background: active ? "var(--teal-soft)" : "#fbfcfe", textAlign: "center" as const, cursor: "pointer" });

export default function OfficialArchivesPanel() {
  const [model, setModel] = useState<Model | null>(null);
  const [archive, setArchive] = useState("ARERA");
  const [target, setTarget] = useState<Destination | null>(null);
  const [manual, setManual] = useState(false);
  const [manualCode, setManualCode] = useState("ARERA_TIT_TABLE5_REACTIVE");
  const [manualPeriod, setManualPeriod] = useState(String(new Date().getFullYear()));
  // The confirmation lives only in this page's state: after a refresh nothing is confirmed and the checkbox starts unchecked.
  const [confirming, setConfirming] = useState<Preview | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [rejected, setRejected] = useState<Preview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const confirmRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const load = useCallback(async () => { try { setModel(await requestJson<Model>("/api/system/control-room")); } catch (cause) { setError(errorText(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  // Deep link from an alert: #archivi-ufficiali?documento=CODE&periodo=YYYY sets where the next file goes.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#archivi-ufficiali")) return;
    const query = new URLSearchParams(hash.split("?")[1] ?? "");
    const requested = query.get("documento"); const requestedPeriod = query.get("periodo");
    if (requested && requestedPeriod) setTarget({ code: requested, period: requestedPeriod, from: "dal link dell'alert" });
  }, []);
  useEffect(() => { if (confirming) confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [confirming]);

  const archives = model?.archives ?? [];
  const documents = model?.documents ?? [];
  const catalog = model?.catalog ?? [];
  const info = new Map(archives.flatMap((item) => item.documents.map((doc) => [doc.code, { ...doc, sourceLabel: item.label }] as const)));
  const nameOf = (code: string) => info.get(code)?.document ?? catalog.find((entry) => entry.code === code)?.document ?? code;
  const sourceOf = (code: string) => info.get(code)?.sourceLabel ?? catalog.find((entry) => entry.code === code)?.source ?? "";

  // What may still be published, from the documents and publications the server returned. The server decides again on publish
  // (NOT_VALIDATED, ALREADY_PUBLISHED, OLDER_VERSION, integrity and provenance): this only chooses which action to offer.
  const publishedIds = new Set(archives.flatMap((item) => item.history.filter((entry) => entry.kind === "PUBLICATION" && entry.documentId).map((entry) => entry.documentId as string)));
  const publishedVersion = new Map<string, number>();
  for (const doc of documents) if (publishedIds.has(doc.documentId)) { const key = `${doc.code}|${doc.period}`; publishedVersion.set(key, Math.max(publishedVersion.get(key) ?? 0, doc.version)); }
  const stateOf = (doc: Preview): "PUBLISHABLE" | "PUBLISHED" | "SUPERSEDED" | "BLOCKED" => {
    if (doc.status !== "VALIDATED" || !doc.checks.every((check) => check.ok) || doc.provenance.level === "DIFFERS_FROM_OFFICIAL_DOWNLOAD") return "BLOCKED";
    if (publishedIds.has(doc.documentId)) return "PUBLISHED";
    const published = publishedVersion.get(`${doc.code}|${doc.period}`);
    return published !== undefined && published >= doc.version ? "SUPERSEDED" : "PUBLISHABLE";
  };
  const latestPublishable = new Map<string, Preview>();
  for (const doc of documents) {
    if (stateOf(doc) !== "PUBLISHABLE") continue;
    const key = `${doc.code}|${doc.period}`; const current = latestPublishable.get(key);
    if (!current || doc.version > current.version) latestPublishable.set(key, doc);
  }
  const pending: Pending[] = [...latestPublishable.entries()].map(([key, doc]) => ({ kind: "PUBLISH" as const, key, source: sourceOf(doc.code), period: doc.period, code: doc.code, doc }));
  for (const item of archives) for (const alert of item.alerts) {
    const key = `${alert.code}|${alert.period}`;
    if (alert.status === "RESOLVED" || latestPublishable.has(key)) continue;
    const doc = info.get(alert.code);
    pending.push({ kind: doc?.uploadable ? "UPLOAD" : doc?.acquisition === "MANUAL_VERIFICATION" ? "MANUAL" : "SOURCE", key: `${key}|${alert.alertId}`, source: item.label, archiveSource: item.source, period: alert.period, code: alert.code, alert });
  }

  const destination: Destination | null = target ?? (manual ? { code: manualCode, period: manualPeriod, from: "scelto manualmente" } : null);
  async function act(key: string, work: () => Promise<string | undefined>) { if (busy) return; setBusy(key); setError(undefined); setNotice(undefined); try { const message = await work(); if (message) setNotice(message); await load(); } catch (cause) { setError(errorText(cause)); if (MANUAL_CHOICE_CODES.has(toUiError(cause).code)) setManual(true); } finally { setBusy(undefined); } }
  const complete = (doc: Preview) => { if (busy) return; setError(undefined); setNotice(undefined); setRejected(null); setAcknowledge(false); setConfirming(doc); };
  const cancel = () => { setConfirming(null); setAcknowledge(false); };
  const chooseUpload = (alert: Alert) => { setTarget({ code: alert.code, period: alert.period, from: "dall'aggiornamento da completare" }); setConfirming(null); setRejected(null); window.history.replaceState(null, "", `#archivi-ufficiali?documento=${encodeURIComponent(alert.code)}&periodo=${encodeURIComponent(alert.period)}`); uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); fileRef.current?.focus(); };
  const openDetails = (source: string) => { setArchive(source); setDetailsOpen(true); window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };

  const upload = (file: File) => void act("validate", async () => {
    setConfirming(null); setRejected(null); setAcknowledge(false);
    const form = new FormData(); form.append("file", file);
    if (destination) { form.append("code", destination.code); form.append("period", destination.period); }
    const result = await requestForm<{ readonly document: Preview; readonly duplicate: boolean; readonly detected: Detected | null }>("/api/system/control-room", form);
    const doc = result.document;
    const found = result.detected ? `Riconosciuto dal contenuto: ${nameOf(doc.code)}, periodo ${doc.period} (${result.detected.basis}). ` : "";
    if (doc.status !== "VALIDATED") { setRejected(doc); return `${found}Documento rifiutato dalla validazione: non si può pubblicare.`; }
    const state = stateOf(doc);
    if (state === "PUBLISHED") return `${found}Questo file è già pubblicato nell'archivio centrale: nessuna azione necessaria.`;
    if (state === "SUPERSEDED") return `${found}È già pubblicata una versione uguale o più recente per lo stesso documento e periodo: nessuna azione necessaria.`;
    setTarget(null); setConfirming(doc);
    return `${found}${result.duplicate ? `File già validato in precedenza (versione ${doc.version}): nessuna nuova versione.` : `Documento validato: versione ${doc.version}.`} Manca solo la conferma qui sotto.`;
  });
  const onFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); };
  const onDrop = (event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files?.[0]; if (file && !busy) upload(file); };
  const needsAck = Boolean(confirming && NEEDS_ACK.has(confirming.provenance.level));
  const canPublish = Boolean(confirming && stateOf(confirming) !== "BLOCKED" && (!needsAck || acknowledge) && !busy);
  const publish = () => void act("publish", async () => {
    if (!confirming) return undefined;
    // The confirmation is bound to the version shown: its fingerprint goes with it, the server compares it with the stored one and
    // re-reads the original. Nothing is typed by hand, nothing is published without this explicit click.
    const result = await requestJson<{ readonly publication: { readonly version: number; readonly sha256: string; readonly period: string } }>("/api/system/control-room", { method: "POST", body: JSON.stringify({ action: "publish", documentId: confirming.documentId, confirmSha256: confirming.sha256, acknowledgeDeclaredProvenance: needsAck && acknowledge }) });
    const name = nameOf(confirming.code);
    setConfirming(null); setAcknowledge(false);
    return `Aggiornamento completato: ${name}, periodo ${result.publication.period}, versione ${result.publication.version}. È nell'archivio centrale, valido per tutte le aziende clienti.`;
  });
  const confirmManual = (alert: Alert) => { const note = window.prompt("Cosa hai verificato sul sito ufficiale? (almeno 10 caratteri)"); if (!note) return; void act(alert.alertId, async () => { await requestJson("/api/system/control-room", { method: "POST", body: JSON.stringify({ action: "confirm", code: alert.code, period: alert.period, note }) }); return "Verifica registrata."; }); };
  const run = () => void act("run", async () => { const result = await requestJson<{ readonly checks: readonly unknown[] }>("/api/system/control-room", { method: "POST", body: JSON.stringify({ action: "run" }) }); return result.checks.length ? `Controlli eseguiti: ${result.checks.length}.` : "Nessun controllo previsto oggi."; });
  const current = archives.find((item) => item.source === archive);

  const technical = (doc: Preview) => <details className="official-archive-technical"><summary>Dettagli tecnici del documento (SHA-256, valori, controlli)</summary>
    <div className="data-list">
      <div className="data-line"><span>File</span><strong>{doc.originalName} ({doc.size.toLocaleString("it-IT")} byte), versione {doc.version}, validato il {when(doc.uploadedAt)}</strong></div>
      <div className="data-line"><span>SHA-256 del file</span><strong><code>{doc.sha256}</code></strong></div>
      <div className="data-line"><span>SHA-256 riferimento ufficiale</span><strong>{doc.provenance.officialSha256 ? <code>{doc.provenance.officialSha256}</code> : "nessun riferimento valido"}<br /><small className="muted">{doc.provenance.detail}</small></strong></div>
      <div className="data-line"><span>Tabella trovata</span><strong>{doc.structure.sheet ? `foglio ${doc.structure.sheet}, titolo in ${doc.structure.titleCell}, anni ${doc.structure.years.join(", ")}` : "non trovata"}</strong></div>
    </div>
    {doc.values.length ? <div className="responsive-table"><table><caption>Valori estratti (c€/kvarh), anno {doc.period}</caption><thead><tr><th>Tensione</th><th>Energia reattiva</th><th>Fascia</th><th>Valore</th><th>Soglia</th><th>Cella</th></tr></thead><tbody>{doc.values.filter((value) => Number(value.centsPerKvarh) > 0).map((value) => <tr key={value.cell}><td>{value.voltage}</td><td>{value.kind === "INJECTED" ? "immessa" : "prelevata"}</td><td>{value.band}</td><td>{decimal(value.centsPerKvarh)}</td><td>{value.kind === "INJECTED" ? "—" : `oltre ${Math.round(Number(value.thresholdRatio) * 100)}% dell'attiva`}</td><td>{value.sheet}!{value.cell}</td></tr>)}</tbody></table></div> : null}
    <div className="responsive-table"><table><caption>Controlli</caption><thead><tr><th>Controllo</th><th>Esito</th><th>Dettaglio</th></tr></thead><tbody>{doc.checks.map((check) => <tr key={check.code}><td>{check.code}</td><td><span className={`status-badge ${check.ok ? "positive" : "negative"}`}>{check.ok ? "Superato" : "Fallito"}</span></td><td className="official-archive-detail">{check.detail}</td></tr>)}</tbody></table></div>
    {doc.warnings.length ? <ul className="plain-list">{doc.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
  </details>;

  return <section id="archivi-ufficiali" className="content-stack official-archives" aria-labelledby="official-archives-title">
    <div className="ui-card">
      <div className="card-heading"><div><p className="eyebrow">Control Room Produttore</p><h3 id="official-archives-title">Archivi ufficiali</h3><p>Archivio centrale dei dati ufficiali: ogni aggiornamento pubblicato qui vale per tutte le aziende clienti. Visibile solo al produttore della piattaforma.</p></div></div>
      {error ? <ErrorState message={error} /> : null}{notice ? <p className="inline-success" role="status">{notice}</p> : null}
      {!model && !error ? <p className="muted">Caricamento degli archivi…</p> : null}
      <h4 className="official-archives-subtitle">Aggiornamenti da completare</h4>
      {model && pending.length === 0 ? <p className="notice-card"><span>Nessun aggiornamento da completare: gli archivi controllati sono aggiornati.</span></p> : null}
      {pending.length ? <div className="official-archive-alerts" aria-label="Aggiornamenti da completare">{pending.map((item) => <article key={item.key} className="official-archive-alert">
        <strong>{nameOf(item.code)}</strong>
        <p>{item.source} · periodo {item.period}</p>
        {item.kind === "PUBLISH" ? <>
          <p>Validato il {when(item.doc.uploadedAt)} (versione {item.doc.version}), tutti i controlli superati. {SHORT_PROVENANCE[item.doc.provenance.level] ?? item.doc.provenanceLabel}.</p>
          <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => complete(item.doc)}>Completa aggiornamento</button>
        </> : <>
          <p>{item.alert.statusLabel}: {item.alert.reason}</p>
          {item.kind === "UPLOAD" ? <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => chooseUpload(item.alert)}>Carica il file</button>
            : item.kind === "MANUAL" ? <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => confirmManual(item.alert)}>Conferma verifica</button>
            : <button className="button secondary" type="button" onClick={() => openDetails(item.archiveSource)}>Apri istruzioni</button>}
          {item.kind === "UPLOAD" ? <p className="muted">Scarica il file dalla <a href={item.alert.officialLink} target="_blank" rel="noreferrer">fonte ufficiale</a> senza aprirlo né salvarlo di nuovo.</p> : null}
        </>}
      </article>)}</div> : null}
      <div className="metric-grid official-archive-tabs" style={{ marginTop: 16 }} aria-label="Stato degli archivi">{archives.map((item) => <button key={item.source} type="button" className="metric-card official-archive-tab" onClick={() => openDetails(item.source)}><span>Archivio</span><strong>{item.label}</strong><span className={`status-badge ${tone(item.status)}`}>{item.statusLabel}</span><small>Ultimo aggiornamento: {when(item.lastUpdate)}</small><small>Periodo coperto: {item.periodCovered}</small></button>)}</div>
    </div>

    {confirming ? <div className="ui-card official-archive-publish" ref={confirmRef} role="region" aria-label="Conferma aggiornamento">
      <h3>Completa aggiornamento</h3>
      <div className="data-list">
        <div className="data-line"><span>Fonte e periodo</span><strong>{sourceOf(confirming.code)} · {confirming.period}</strong></div>
        <div className="data-line"><span>Documento</span><strong>{nameOf(confirming.code)}<br /><small className="muted">file {confirming.originalName}, versione {confirming.version}, validato il {when(confirming.uploadedAt)}</small></strong></div>
        <div className="data-line"><span>Provenienza</span><strong><span className={`status-badge ${confirming.provenance.level === "MATCHES_OFFICIAL_DOWNLOAD" ? "positive" : "negative"}`}>{SHORT_PROVENANCE[confirming.provenance.level] ?? confirming.provenance.level}</span><br /><small className="muted">{confirming.provenanceLabel}</small></strong></div>
        <div className="data-line"><span>Controlli</span><strong>{confirming.checks.filter((check) => check.ok).length} su {confirming.checks.length} superati{confirming.values.length ? ` · ${confirming.values.filter((value) => Number(value.centsPerKvarh) > 0).length} valori ${confirming.period} letti` : ""}</strong></div>
      </div>
      {confirming.provenance.level === "EQUIVALENT_TO_OFFICIAL_DOWNLOAD" ? <p className="warning-text"><strong>Autenticità non verificata.</strong> Il file non è identico a quello scaricato ora dal sito {sourceOf(confirming.code)}: l&apos;impronta è diversa, mentre i valori tariffari {confirming.period} coincidono. Valori identici non provano che il file provenga dalla fonte ufficiale, e la piattaforma non può attestarlo.</p> : null}
      {confirming.provenance.level === "DECLARED_BY_PRODUCER" ? <p className="warning-text"><strong>Autenticità non verificata.</strong> Il confronto con il sito {sourceOf(confirming.code)} non è stato possibile ({confirming.provenance.detail}). La provenienza è solo dichiarata da te e la piattaforma non può attestarla.</p> : null}
      {confirming.provenance.level === "MATCHES_OFFICIAL_DOWNLOAD" ? <p className="notice-card"><span>Il file è identico a quello scaricato dal sito ufficiale durante la validazione.</span></p> : null}
      <p className="notice-card"><span>Pubblicazione centralizzata: i nuovi valori entrano nell&apos;archivio centrale e valgono per tutte le aziende clienti. La versione precedente resta nello storico.</span></p>
      {needsAck ? <label className="check-field"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />Ho controllato io questo file e decido di pubblicarlo. So che la piattaforma non ne ha verificato l&apos;autenticità presso la fonte: la mia conferma è registrata a mio nome e non equivale a un&apos;autenticazione {sourceOf(confirming.code)}.</label> : null}
      <div className="button-row"><button className="button primary" type="button" disabled={!canPublish} onClick={publish}>{busy === "publish" ? "Pubblicazione in corso" : "Pubblica per tutte le aziende"}</button><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={cancel}>Annulla</button></div>
      {technical(confirming)}
    </div> : null}

    <div className="ui-card" ref={uploadRef} id="archivi-ufficiali-caricamento">
      <div className="card-heading"><div><h3>Carica un nuovo documento</h3><p>Il file viene validato subito: se è pubblicabile ti resta solo la conferma.</p></div></div>
      <label htmlFor="official-file" style={dropZoneStyle(dragOver)} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
        <strong>{busy === "validate" ? "Validazione in corso…" : "Trascina qui il file ufficiale o fai clic per sceglierlo"}</strong>
        <small className="muted">{destination ? `Destinazione: ${nameOf(destination.code)}, periodo ${destination.period} (${destination.from}).` : "Documento e periodo riconosciuti dal contenuto del file, non dal nome."} File .xlsx, massimo 2 MB.</small>
        <input ref={fileRef} id="official-file" className="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={onFile} />
      </label>
      {target ? <div className="button-row"><button className="button secondary compact" type="button" onClick={() => { setTarget(null); window.history.replaceState(null, "", "#archivi-ufficiali"); }}>Riconosci dal contenuto</button></div> : null}
      <details className="official-archive-technical" open={manual} onToggle={(event) => setManual((event.currentTarget as HTMLDetailsElement).open)}><summary>Scegli documento e periodo manualmente</summary>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="official-document">Documento</label><select id="official-document" value={manualCode} onChange={(event) => { setManualCode(event.target.value); setTarget(null); }}>{catalog.filter((entry) => entry.uploadable).map((entry) => <option key={entry.code} value={entry.code}>{entry.document}</option>)}</select></div>
          <div className="form-field"><label htmlFor="official-period">Periodo di competenza (anno)</label><input id="official-period" inputMode="numeric" pattern="20[0-9]{2}" value={manualPeriod} onChange={(event) => { setManualPeriod(event.target.value.trim()); setTarget(null); }} /></div>
        </div>
      </details>
      {rejected ? <div className="official-archive-preview" role="region" aria-label="Documento rifiutato">
        <p className="warning-text"><strong>Documento rifiutato</strong> ({nameOf(rejected.code)}, periodo {rejected.period}, versione {rejected.version}): non si può pubblicare. Carica il file corretto.</p>
        <ul className="plain-list">{rejected.checks.filter((check) => !check.ok).map((check) => <li key={check.code}>{check.detail}</li>)}</ul>
        {technical(rejected)}
      </div> : null}
    </div>

    <details className="ui-card official-archive-technical" ref={detailsRef} open={detailsOpen} onToggle={(event) => setDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary><strong>Dettagli tecnici, storico e audit</strong></summary>
      <p className="muted">Ogni validazione e pubblicazione è registrata nell&apos;audit con autore, impronta SHA-256 e provenienza; il contenuto dei file non entra nell&apos;audit.</p>
      <div className="button-row"><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={run}>{busy === "run" ? "Controlli in corso" : "Esegui i controlli di oggi"}</button></div>
      <div className="vector-tabs" role="tablist" aria-label="Archivi">{archives.map((item) => <button key={item.source} role="tab" type="button" aria-selected={archive === item.source} className={archive === item.source ? "active" : ""} onClick={() => setArchive(item.source)}>{item.label}</button>)}</div>
      {current ? <div role="tabpanel" aria-label={`Archivio ${current.label}`}>
        <p>Stato: {current.statusLabel}. Ultimo aggiornamento: {when(current.lastUpdate)}. Periodo coperto: {current.periodCovered}.</p>
        <div className="data-list">{current.documents.map((doc) => <div key={doc.code} className="data-line"><span>{doc.document}<br /><a href={doc.officialLink} target="_blank" rel="noreferrer">Fonte ufficiale</a></span><strong>{doc.coveredPeriods.length ? `Coperto: ${doc.coveredPeriods.join(", ")}` : "Nessun periodo coperto"}<br /><small className="muted">{doc.acquisition === "AUTOMATIC" ? "Acquisizione automatica" : doc.acquisition === "MANUAL_UPLOAD" ? doc.uploadable ? "Caricamento in Archivi ufficiali" : "Caricamento dalla scheda esistente" : "Verifica manuale"} · {when(doc.lastUpdate)}</small></strong></div>)}</div>
        <h4 className="official-archives-subtitle">Alert e istruzioni</h4>
        {current.alerts.filter((alert) => alert.status !== "RESOLVED").length === 0 ? <p className="muted">Nessun documento mancante.</p> : <div className="official-archive-alerts">{current.alerts.filter((alert) => alert.status !== "RESOLVED").map((alert) => <article key={alert.alertId} className="official-archive-alert"><strong>{alert.document}</strong><p>Periodo {alert.period} · <span className={`status-badge ${tone(alert.status)}`}>{alert.statusLabel}</span> · {alert.occurrences} controlli · ultimo {when(alert.lastCheckedAt)}</p>
          <p><strong>Motivo:</strong> {alert.reason}</p><ol className="plain-list">{alert.instructions.map((step) => <li key={step}>{step}</li>)}</ol><p className="muted">Link ufficiale: <a href={alert.officialLink} target="_blank" rel="noreferrer">{alert.officialLink}</a><br />Percorso: {alert.uploadPath}</p></article>)}</div>}
        <h4 className="official-archives-subtitle">Storico importazioni</h4>
        {current.history.length === 0 ? <p className="muted">Nessuna operazione registrata.</p> : <div className="responsive-table"><table><thead><tr><th>Quando</th><th>Operazione</th><th>Documento</th><th>Periodo</th><th>Esito</th><th>Dettaglio</th><th>Azione</th></tr></thead><tbody>{current.history.map((entry, index) => {
          const doc = entry.kind === "VALIDATION" && entry.documentId ? documents.find((item) => item.documentId === entry.documentId) : undefined;
          return <tr key={`${entry.at}-${index}`}><td>{when(entry.at)}</td><td>{KIND_LABEL[entry.kind] ?? entry.kind}</td><td>{entry.document}</td><td>{entry.period}</td><td><span className={`status-badge ${tone(entry.outcome)}`}>{entry.outcome}</span></td><td className="official-archive-detail">{entry.detail}{entry.actor ? ` · ${entry.actor}` : ""}</td><td>{doc && stateOf(doc) === "PUBLISHABLE" ? <button className="button secondary compact" type="button" disabled={Boolean(busy)} onClick={() => complete(doc)}>Completa aggiornamento</button> : null}</td></tr>;
        })}</tbody></table></div>}
      </div> : null}
    </details>
  </section>;
}
