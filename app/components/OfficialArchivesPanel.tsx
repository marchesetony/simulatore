"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { ErrorState } from "./UiStates";
import { requestForm, requestJson, toUiError } from "../lib/ui/client";

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026). Quattro archivi (ARERA, GME, Terna, ADM) con ultimo
 * aggiornamento, periodo coperto, fonte, stato, documenti mancanti, alert e storico; caricamento dal computer con due
 * operazioni distinte, "Valida documento" e "Pubblica aggiornamento". L'anteprima mostra nome del file, fonte dichiarata,
 * periodo, SHA-256, valori estratti e controlli; la pubblicazione chiede la conferma esplicita dell'impronta. Ogni alert apre
 * direttamente il documento richiesto. Il server risponde solo al produttore (ADMIN di tenant_piattaforma): questa schermata
 * non decide nulla sull'accesso.
 */
type Alert = { readonly alertId: string; readonly code: string; readonly document: string; readonly period: string; readonly officialLink: string; readonly reason: string; readonly instructions: readonly string[]; readonly uploadPath: string; readonly status: string; readonly statusLabel: string; readonly lastCheckedAt: string; readonly occurrences: number };
type DocumentView = { readonly code: string; readonly document: string; readonly acquisition: string; readonly officialLink: string; readonly uploadPath: string; readonly uploadable: boolean; readonly coveredPeriods: readonly string[]; readonly lastUpdate: string | null };
type HistoryEntry = { readonly at: string; readonly kind: string; readonly document: string; readonly period: string; readonly outcome: string; readonly detail: string; readonly actor: string | null; readonly documentId: string | null };
type Archive = { readonly source: string; readonly label: string; readonly status: string; readonly statusLabel: string; readonly lastUpdate: string | null; readonly periodCovered: string; readonly officialLinks: readonly string[]; readonly missing: readonly { readonly code: string; readonly document: string; readonly period: string; readonly statusLabel: string }[]; readonly alerts: readonly Alert[]; readonly documents: readonly DocumentView[]; readonly history: readonly HistoryEntry[] };
type Value = { readonly voltage: string; readonly year: number; readonly kind: string; readonly band: string; readonly centsPerKvarh: string; readonly thresholdRatio: string; readonly sheet: string; readonly cell: string };
type Preview = { readonly documentId: string; readonly code: string; readonly source: string; readonly period: string; readonly version: number; readonly originalName: string; readonly size: number; readonly sha256: string; readonly status: string; readonly uploadedAt: string; readonly provenance: { readonly level: string; readonly detail: string }; readonly provenanceLabel: string; readonly checks: readonly { readonly code: string; readonly ok: boolean; readonly detail: string }[]; readonly warnings: readonly string[]; readonly values: readonly Value[]; readonly structure: { readonly sheet: string | null; readonly titleCell: string | null } };
type CatalogItem = { readonly code: string; readonly source: string; readonly document: string; readonly uploadable: boolean };
type Model = { readonly archives: readonly Archive[]; readonly documents: readonly Preview[]; readonly catalog: readonly CatalogItem[] };

const when = (value: string | null) => value ? new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }) : "mai";
const decimal = (value: string) => value.replace(".", ",");
const tone = (status: string) => status === "UP_TO_DATE" || status === "RESOLVED" || status === "VALIDATED" || status === "PUBLISHED" || status === "COVERED" || status === "ACQUIRED" ? "positive" : status === "NEVER_CHECKED" || status === "FILE_UPLOADED" || status === "AWAITING_PUBLICATION" ? "" : "negative";
const KIND_LABEL: Readonly<Record<string, string>> = { CHECK: "Controllo", VALIDATION: "Validazione", PUBLICATION: "Pubblicazione" };
const errorText = (cause: unknown) => { const safe = toUiError(cause); return `${safe.message} (codice ${safe.code})`; };

export default function OfficialArchivesPanel() {
  const [model, setModel] = useState<Model | null>(null);
  const [archive, setArchive] = useState("ARERA");
  const [code, setCode] = useState("ARERA_TIT_TABLE5_REACTIVE");
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [confirmSha, setConfirmSha] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const uploadRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { setModel(await requestJson<Model>("/api/system/control-room")); } catch (cause) { setError(errorText(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  // Deep link from an alert: #archivi-ufficiali?documento=CODE&periodo=YYYY opens the requested document.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#archivi-ufficiali")) return;
    const query = new URLSearchParams(hash.split("?")[1] ?? "");
    const requested = query.get("documento"); const requestedPeriod = query.get("periodo");
    if (requested) setCode(requested);
    if (requestedPeriod) setPeriod(requestedPeriod);
  }, []);
  const catalog = model?.catalog ?? [];
  const selectedEntry = catalog.find((entry) => entry.code === code);
  useEffect(() => { if (selectedEntry) setArchive(selectedEntry.source); }, [selectedEntry]);
  const current = model?.archives.find((item) => item.source === archive);
  const reset = () => { setPreview(null); setDuplicate(false); setConfirmSha(""); setAcknowledge(false); };
  async function act(key: string, work: () => Promise<string | undefined>) { if (busy) return; setBusy(key); setError(undefined); setNotice(undefined); try { const message = await work(); if (message) setNotice(message); await load(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(undefined); } }
  const openDocument = (alert: Alert) => { setCode(alert.code); setPeriod(alert.period); reset(); window.history.replaceState(null, "", `#archivi-ufficiali?documento=${encodeURIComponent(alert.code)}&periodo=${encodeURIComponent(alert.period)}`); uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const validate = () => void act("validate", async () => {
    if (!file) throw new Error("Seleziona il file dal computer");
    const form = new FormData(); form.append("code", code); form.append("period", period); form.append("file", file);
    const result = await requestForm<{ readonly document: Preview; readonly duplicate: boolean }>("/api/system/control-room", form);
    setPreview(result.document); setDuplicate(result.duplicate); setConfirmSha(""); setAcknowledge(false);
    return result.duplicate ? "Questo file è già stato caricato per lo stesso documento e periodo: nessuna nuova versione, ecco la validazione registrata." : result.document.status === "VALIDATED" ? "Documento validato. Controlla l'anteprima, poi pubblica l'aggiornamento." : "Documento rifiutato dalla validazione: vedi i controlli falliti.";
  });
  const publish = () => void act("publish", async () => {
    if (!preview) return undefined;
    const result = await requestJson<{ readonly publication: { readonly version: number; readonly sha256: string } }>("/api/system/control-room", { method: "POST", body: JSON.stringify({ action: "publish", documentId: preview.documentId, confirmSha256: confirmSha, acknowledgeDeclaredProvenance: acknowledge }) });
    reset(); setFile(null);
    return `Aggiornamento pubblicato: versione ${result.publication.version}, SHA-256 ${result.publication.sha256.slice(0, 12)}…, disponibile a tutte le aziende dall'archivio globale.`;
  });
  const confirmManual = (alert: Alert) => { const note = window.prompt("Cosa hai verificato sul sito ufficiale? (almeno 10 caratteri)"); if (!note) return; void act(alert.alertId, async () => { await requestJson("/api/system/control-room", { method: "POST", body: JSON.stringify({ action: "confirm", code: alert.code, period: alert.period, note }) }); return "Verifica registrata."; }); };
  const run = () => void act("run", async () => { const result = await requestJson<{ readonly checks: readonly unknown[] }>("/api/system/control-room", { method: "POST", body: JSON.stringify({ action: "run" }) }); return result.checks.length ? `Controlli eseguiti: ${result.checks.length}.` : "Nessun controllo previsto oggi."; });
  const declared = preview?.provenance.level === "DECLARED_BY_PRODUCER";
  const canPublish = Boolean(preview && preview.status === "VALIDATED" && preview.checks.every((check) => check.ok) && confirmSha.trim().toLowerCase() === preview.sha256 && (!declared || acknowledge) && !busy);
  const alreadyPublished = preview ? (model?.archives ?? []).some((item) => item.history.some((entry) => entry.kind === "PUBLICATION" && entry.documentId === preview.documentId)) : false;

  return <section id="archivi-ufficiali" className="content-stack official-archives" aria-labelledby="official-archives-title">
    <div className="ui-card">
      <div className="card-heading"><div><p className="eyebrow">Control Room Produttore</p><h3 id="official-archives-title">Archivi ufficiali</h3><p>Archivio globale dei dati ufficiali, unico per tutte le aziende clienti. Visibile solo al produttore della piattaforma.</p></div><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={run}>{busy === "run" ? "Controlli in corso" : "Esegui i controlli di oggi"}</button></div>
      {error ? <ErrorState message={error} /> : null}{notice ? <p className="inline-success" role="status">{notice}</p> : null}
      {!model && !error ? <p className="muted">Caricamento degli archivi…</p> : null}
      <div className="metric-grid official-archive-tabs" role="tablist" aria-label="Archivi">{(model?.archives ?? []).map((item) => <button key={item.source} role="tab" type="button" aria-selected={archive === item.source} className={`metric-card official-archive-tab${archive === item.source ? " selected" : ""}`} onClick={() => setArchive(item.source)}><span>Archivio</span><strong>{item.label}</strong><span className={`status-badge ${tone(item.status)}`}>{item.statusLabel}</span><small>Ultimo aggiornamento: {when(item.lastUpdate)}</small><small>Periodo coperto: {item.periodCovered}</small>{item.missing.length ? <small>Documenti mancanti: {item.missing.length}</small> : null}</button>)}</div>
    </div>

    {current ? <div className="ui-card" role="tabpanel" aria-label={`Archivio ${current.label}`}>
      <div className="card-heading"><div><h3>Archivio {current.label}</h3><p>Stato: {current.statusLabel}. Ultimo aggiornamento: {when(current.lastUpdate)}. Periodo coperto: {current.periodCovered}.</p></div></div>
      <div className="data-list">{current.documents.map((doc) => <div key={doc.code} className="data-line"><span>{doc.document}<br /><a href={doc.officialLink} target="_blank" rel="noreferrer">Fonte ufficiale</a></span><strong>{doc.coveredPeriods.length ? `Coperto: ${doc.coveredPeriods.join(", ")}` : "Nessun periodo coperto"}<br /><small className="muted">{doc.acquisition === "AUTOMATIC" ? "Acquisizione automatica" : doc.acquisition === "MANUAL_UPLOAD" ? doc.uploadable ? "Caricamento in Archivi ufficiali" : "Caricamento dalla scheda esistente" : "Verifica manuale"} · {when(doc.lastUpdate)}</small></strong></div>)}</div>
      <h4 className="official-archives-subtitle">Documenti mancanti e alert</h4>
      {current.alerts.filter((alert) => alert.status !== "RESOLVED").length === 0 ? <p className="muted">Nessun documento mancante.</p> : <div className="official-archive-alerts">{current.alerts.filter((alert) => alert.status !== "RESOLVED").map((alert) => {
        const entry = catalog.find((item) => item.code === alert.code);
        return <article key={alert.alertId} className="official-archive-alert"><div className="card-heading"><div><strong>{alert.document}</strong><p>Periodo {alert.period} · <span className={`status-badge ${tone(alert.status)}`}>{alert.statusLabel}</span> · {alert.occurrences} controlli · ultimo {when(alert.lastCheckedAt)}</p></div>{entry?.uploadable ? <a className="button primary" href={`#archivi-ufficiali?documento=${encodeURIComponent(alert.code)}&periodo=${encodeURIComponent(alert.period)}`} onClick={(event) => { event.preventDefault(); openDocument(alert); }}>Apri il documento</a> : entry?.source === "ADM" ? <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => confirmManual(alert)}>Conferma verifica</button> : null}</div>
          <p><strong>Motivo:</strong> {alert.reason}</p><ol className="plain-list">{alert.instructions.map((step) => <li key={step}>{step}</li>)}</ol><p className="muted">Link ufficiale: <a href={alert.officialLink} target="_blank" rel="noreferrer">{alert.officialLink}</a><br />Percorso: {alert.uploadPath}</p></article>;
      })}</div>}
      <h4 className="official-archives-subtitle">Storico importazioni</h4>
      {current.history.length === 0 ? <p className="muted">Nessuna operazione registrata.</p> : <div className="responsive-table"><table><thead><tr><th>Quando</th><th>Operazione</th><th>Documento</th><th>Periodo</th><th>Esito</th><th>Dettaglio</th></tr></thead><tbody>{current.history.map((entry, index) => <tr key={`${entry.at}-${index}`}><td>{when(entry.at)}</td><td>{KIND_LABEL[entry.kind] ?? entry.kind}</td><td>{entry.document}</td><td>{entry.period}</td><td><span className={`status-badge ${tone(entry.outcome)}`}>{entry.outcome}</span></td><td className="official-archive-detail">{entry.detail}{entry.actor ? ` · ${entry.actor}` : ""}</td></tr>)}</tbody></table></div>}
    </div> : null}

    <div className="ui-card" ref={uploadRef} id="archivi-ufficiali-caricamento">
      <div className="card-heading"><div><h3>Carica documento dal computer</h3><p>1. Valida documento: il file è conservato con SHA-256 e versione, nessun dato diventa disponibile. 2. Pubblica aggiornamento: solo dopo la validazione completa e la tua conferma esplicita.</p></div></div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="official-document">Documento</label><select id="official-document" value={code} onChange={(event) => { setCode(event.target.value); reset(); }}>{catalog.filter((entry) => entry.uploadable).map((entry) => <option key={entry.code} value={entry.code}>{entry.document}</option>)}</select><small>Archivio: {selectedEntry ? selectedEntry.source : "—"} (deciso dal documento, non dal file)</small></div>
        <div className="form-field"><label htmlFor="official-period">Periodo di competenza (anno)</label><input id="official-period" inputMode="numeric" pattern="20[0-9]{2}" value={period} onChange={(event) => { setPeriod(event.target.value.trim()); reset(); }} /></div>
        <div className="form-field"><label htmlFor="official-file">File ufficiale (.xlsx, max 2 MB)</label><input id="official-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event: ChangeEvent<HTMLInputElement>) => { setFile(event.target.files?.[0] ?? null); reset(); }} /></div>
      </div>
      <div className="button-row"><button className="button primary" type="button" disabled={!file || Boolean(busy)} onClick={validate}>{busy === "validate" ? "Validazione in corso" : "Valida documento"}</button></div>

      {preview ? <div className="official-archive-preview" aria-label="Anteprima prima della pubblicazione">
        <h4 className="official-archives-subtitle">Anteprima prima della pubblicazione {duplicate ? "(file già caricato)" : ""}</h4>
        <div className="data-list">
          <div className="data-line"><span>Nome del file</span><strong>{preview.originalName} ({preview.size.toLocaleString("it-IT")} byte), versione {preview.version}</strong></div>
          <div className="data-line"><span>Fonte dichiarata</span><strong>{preview.source} · {preview.provenanceLabel}</strong></div>
          <div className="data-line"><span>Periodo</span><strong>{preview.period}</strong></div>
          <div className="data-line"><span>SHA-256</span><strong><code>{preview.sha256}</code></strong></div>
          <div className="data-line"><span>Tabella trovata</span><strong>{preview.structure.sheet ? `foglio ${preview.structure.sheet}, titolo in ${preview.structure.titleCell}` : "non trovata"}</strong></div>
          <div className="data-line"><span>Esito validazione</span><strong><span className={`status-badge ${tone(preview.status)}`}>{preview.status === "VALIDATED" ? "Validato" : "Rifiutato"}</span></strong></div>
        </div>
        {preview.values.length ? <div className="responsive-table"><table><caption>Valori estratti (c€/kvarh), anno {preview.period}</caption><thead><tr><th>Tensione</th><th>Energia reattiva</th><th>Fascia</th><th>Valore</th><th>Soglia</th><th>Cella</th></tr></thead><tbody>{preview.values.filter((value) => Number(value.centsPerKvarh) > 0).map((value) => <tr key={value.cell}><td>{value.voltage}</td><td>{value.kind === "INJECTED" ? "immessa" : "prelevata"}</td><td>{value.band}</td><td>{decimal(value.centsPerKvarh)}</td><td>{value.kind === "INJECTED" ? "—" : `oltre ${Math.round(Number(value.thresholdRatio) * 100)}% dell'attiva`}</td><td>{value.sheet}!{value.cell}</td></tr>)}</tbody></table></div> : null}
        <div className="responsive-table"><table><caption>Controlli</caption><thead><tr><th>Controllo</th><th>Esito</th><th>Dettaglio</th></tr></thead><tbody>{preview.checks.map((check) => <tr key={check.code}><td>{check.code}</td><td><span className={`status-badge ${check.ok ? "positive" : "negative"}`}>{check.ok ? "Superato" : "Fallito"}</span></td><td className="official-archive-detail">{check.detail}</td></tr>)}</tbody></table></div>
        {preview.warnings.length ? <details className="muted"><summary>Avvisi di lettura ({preview.warnings.length})</summary><ul className="plain-list">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
        {preview.status === "VALIDATED" && !alreadyPublished ? <div className="official-archive-publish">
          <h4 className="official-archives-subtitle">Pubblica aggiornamento</h4>
          {declared ? <p className="warning-text">La provenienza è solo dichiarata: il sito ufficiale non è stato raggiunto per confrontare l&apos;impronta. Non è una prova di autenticità del documento.</p> : null}
          <div className="form-field"><label htmlFor="official-confirm-sha">Per confermare, riscrivi o incolla lo SHA-256 del file</label><input id="official-confirm-sha" autoComplete="off" spellCheck={false} value={confirmSha} onChange={(event) => setConfirmSha(event.target.value)} /></div>
          {declared ? <label className="check-field"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />Ho verificato che questo file è quello pubblicato dalla fonte ufficiale e accetto la provenienza dichiarata.</label> : null}
          <div className="button-row"><button className="button primary" type="button" disabled={!canPublish} onClick={publish}>{busy === "publish" ? "Pubblicazione in corso" : "Pubblica aggiornamento"}</button></div>
        </div> : preview.status === "VALIDATED" ? <p className="inline-success">Questa versione è già pubblicata nell&apos;archivio globale.</p> : <p className="warning-text">Un documento rifiutato non si può pubblicare: carica il file corretto.</p>}
      </div> : null}
    </div>
  </section>;
}
