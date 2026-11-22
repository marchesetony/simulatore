"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";
import type { GmeMonthView, OfficialDataOverview, PunField, ServiceError, SourceStatus } from "../lib/official-monitor/service-overview";

/**
 * Control Room Produttore → Dati ufficiali (Tony 22/11/2026): GME, ARERA and Terna verified from the application, without Vercel
 * logs or a terminal. Read-only screen: state of each source, last run of the independent service and its outcome, GME values
 * acquired (month, year, unit, source document), the official reference values of the weekly audit, the version the simulator
 * actually uses for each company, the comparison between them, and every anomaly. Three levels are never mixed: acquired in
 * test mode, validated, published and used in simulations.
 */
type Model = { readonly overview: OfficialDataOverview; readonly coverageAvailable: boolean };

const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }) : "—";
const euro = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s`;
const FIELD_LABEL: Readonly<Record<PunField, string>> = { f1: "F1", f2: "F2", f3: "F3", monthly: "Mensile" };
const sourceTone = (status: SourceStatus["status"]) => status === "OK" ? "positive" : status === "NEVER_RUN" ? "" : "negative";
const levelTone = (level: GmeMonthView["level"]) => level === "PUBLISHED_IN_USE" ? "positive" : level === "VALIDATED_NOT_PUBLISHED" ? "" : "negative";
const shortSha = (sha: string | null) => sha ? `${sha.slice(0, 12)}…` : "—";
const fileName = (url: string | null) => { if (!url) return "—"; try { return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? url); } catch { return url; } };

function ErrorList({ errors }: { readonly errors: readonly ServiceError[] }) {
  if (!errors.length) return null;
  return <ul className="plain-list">{errors.map((error, index) => <li key={`${error.code}-${index}`}>{error.scope ? <strong>{error.scope}: </strong> : null}{error.message} <small className="muted">(codice {error.code})</small></li>)}</ul>;
}

function MonthCard({ month }: { readonly month: GmeMonthView }) {
  const acquired = month.acquired;
  const values = (field: PunField) => field === "monthly" ? acquired?.monthly.values.monthly : acquired?.bands.values[field];
  return <article className="official-archive-alert" aria-label={`PUN ${month.label}`}>
    <strong style={{ textTransform: "capitalize" }}>{month.label}</strong>
    <p><span className={`status-badge ${levelTone(month.level)}`}>{month.levelLabel}</span></p>

    <h5>1. Acquisito dal servizio{acquired ? ` il ${when(acquired.at)}` : ""}</h5>
    {acquired ? <>
      <p><span className={`status-badge ${acquired.mode === "DRY_RUN" ? "" : "positive"}`}>{acquired.mode === "DRY_RUN" ? "Modalità prova: non pubblicato" : "Pubblicazione automatica"}</span> · {acquired.stateLabel}</p>
      {acquired.state === "LEGACY_AUDIT" ? null : <div className="responsive-table"><table><caption>Valori GME letti (€/MWh), {month.label}</caption><thead><tr><th>Serie</th><th>Valore</th><th>Validazione</th><th>Documento GME</th></tr></thead><tbody>
        {(["f1", "f2", "f3"] as const).map((field, index) => <tr key={field}><td>{FIELD_LABEL[field]}{acquired.bands.hours ? ` (${acquired.bands.hours[index]} ore)` : ""}</td><td>{euro(values(field))}</td><td><span className={`status-badge ${acquired.bands.validated ? "positive" : "negative"}`}>{acquired.bands.validated ? "Validato" : "Non validato"}</span></td><td>{acquired.bands.url ? <a href={acquired.bands.url} target="_blank" rel="noreferrer">{fileName(acquired.bands.url)}</a> : acquired.bands.note}{acquired.bands.sha256 ? <><br /><small className="muted">SHA-256 {shortSha(acquired.bands.sha256)}</small></> : null}</td></tr>)}
        <tr><td>PUN mensile</td><td>{euro(values("monthly"))}</td><td><span className={`status-badge ${acquired.monthly.validated ? "positive" : "negative"}`}>{acquired.monthly.validated ? "Validato" : "Non validato"}</span></td><td>{acquired.monthly.url ? <><a href={acquired.monthly.url} target="_blank" rel="noreferrer">{fileName(acquired.monthly.url)}</a><br /><small className="muted">{acquired.monthly.note} · SHA-256 {shortSha(acquired.monthly.sha256)}</small></> : acquired.monthly.note}</td></tr>
      </tbody></table></div>}
      <ErrorList errors={acquired.errors} />
    </> : <p className="muted">Nessuna lettura del servizio per questo mese.</p>}

    {month.reference ? <>
      <h5>Valori ufficiali di riferimento (audit settimanale del {when(month.reference.at)})</h5>
      <p>{(["f1", "f2", "f3", "monthly"] as const).map((field) => `${FIELD_LABEL[field]} ${euro(month.reference!.values[field])}`).join(" · ")} €/MWh{month.reference.newsletter ? ` · Newsletter GME n. ${month.reference.newsletter}` : ""}</p>
      <ErrorList errors={month.reference.errors} />
    </> : null}

    <h5>2. Usato nelle simulazioni</h5>
    <div className="responsive-table"><table><caption>Versione approvata letta dal motore di simulazione (€/MWh)</caption><thead><tr><th>Archivio</th><th>Versione</th><th>F1</th><th>F2</th><th>F3</th><th>Mensile</th><th>Fonte</th></tr></thead><tbody>
      {month.used.map((item) => <tr key={item.tenantId}><td>{item.label}</td>{item.status === "MISSING" ? <td colSpan={6}><span className="status-badge negative">Nessun PUN approvato: simulazioni del mese bloccate</span></td> : <>
        <td>v{item.version}<br /><small className="muted">{item.archiveId} · approvata il {when(item.approvedAt)}{item.writtenByService ? " · dal servizio" : ""}</small></td>
        <td>{euro(item.values.f1)}</td><td>{euro(item.values.f2)}</td><td>{euro(item.values.f3)}</td><td>{euro(item.values.monthly)}</td>
        <td>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceName ?? "fonte"}</a> : item.sourceName ?? "—"}{item.officialSource ? null : <><br /><span className="status-badge negative">Fonte non ufficiale</span></>}</td>
      </>}</tr>)}
    </tbody></table></div>

    <h5>3. Confronto GME / motore di simulazione</h5>
    {month.comparison.length ? <div className="responsive-table"><table><caption>Valore letto dal servizio confrontato con quello usato dal motore, a due decimali (nessun calcolo modificato)</caption><thead><tr><th>Archivio</th><th>Serie</th><th>GME (servizio)</th><th>Motore</th><th>Esito</th></tr></thead><tbody>
      {month.comparison.map((item) => <tr key={`${item.tenantId}-${item.field}`}><td>{item.label}</td><td>{FIELD_LABEL[item.field]}</td><td>{euro(item.service)}{item.serviceOrigin === "AUDIT" ? <small className="muted"> (audit)</small> : null}</td><td>{euro(item.engine)}</td><td><span className={`status-badge ${item.outcome === "MATCH" ? "positive" : item.outcome === "SERVICE_MISSING" ? "" : "negative"}`}>{item.outcomeLabel}</span></td></tr>)}
    </tbody></table></div> : <p className="muted">Nessun valore da confrontare: il servizio non ha ancora letto questo mese e il motore non ha una versione approvata.</p>}
  </article>;
}

export default function OfficialDataPanel() {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setModel(await requestJson<Model>("/api/system/official-data")); }
    catch (cause) { const safe = toUiError(cause); setError(`${safe.message} (codice ${safe.code})`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const overview = model?.overview ?? null;
  const blocking = overview?.anomalies.filter((item) => item.severity === "BLOCKING").length ?? 0;

  return <section id="dati-ufficiali" className="content-stack official-archives" aria-labelledby="official-data-title">
    <div className="ui-card">
      <div className="card-heading"><div><p className="eyebrow">Control Room Produttore</p><h3 id="official-data-title">Dati ufficiali</h3><p>Stato degli aggiornamenti automatici GME, ARERA e Terna, valori acquisiti e valori usati dal Simulatore EE. Solo lettura: da qui non si pubblica e non si modifica nulla.</p></div>
        <button className="button secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Aggiornamento…" : "Aggiorna"}</button></div>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!overview && !error ? <p className="muted">Lettura dei rapporti del servizio…</p> : null}
      {overview ? <>
        <p className="notice-card"><span><strong>Servizio:</strong> {overview.service.modeLabel}. {overview.service.publicationActive ? "I valori validati vengono pubblicati automaticamente." : "I valori validati non entrano nelle simulazioni finché la pubblicazione automatica resta disattivata."} Ultima esecuzione: {when(overview.service.lastRunAt)} · esecuzioni registrate: {overview.service.runs}.</span></p>

        <h4 className="official-archives-subtitle">Stato degli aggiornamenti</h4>
        <div className="metric-grid" aria-label="Stato delle fonti">{overview.sources.map((source) => <div key={source.source} className="metric-card">
          <span>{source.label}</span>
          <strong><span className={`status-badge ${sourceTone(source.status)}`}>{source.statusLabel}</span></strong>
          {source.lastRun ? <small>Ultima esecuzione {when(source.lastRun.startedAt)} · {source.lastRun.outcomeLabel} · {seconds(source.lastRun.durationMs)}<br />{source.lastRun.mode === "DRY_RUN" ? "Modalità prova" : "Pubblicazione"} · prossima {when(source.lastRun.nextCheckAt)}</small> : <small>Pianificato {source.schedule}</small>}
          {source.details.length ? <small className="muted">{source.details.join(" · ")}</small> : null}
          <ErrorList errors={source.errors} />
        </div>)}</div>

        <h4 className="official-archives-subtitle">Anomalie {overview.anomalies.length ? `(${overview.anomalies.length}${blocking ? `, ${blocking} bloccanti` : ""})` : ""}</h4>
        {overview.anomalies.length === 0 ? <p className="notice-card"><span>Nessuna anomalia: dati presenti, validati e coerenti con quelli usati dal simulatore.</span></p>
          : <div className="official-archive-alerts" aria-label="Anomalie dei dati ufficiali">{overview.anomalies.map((item) => <article key={item.id} className="official-archive-alert">
            <strong>{item.source}{item.period ? ` · ${item.period}` : ""}</strong>
            <p><span className={`status-badge ${item.severity === "INFO" ? "" : "negative"}`}>{item.severityLabel}</span> · {item.origin}{item.at ? ` · ${when(item.at)}` : ""}</p>
            <p>{item.message}</p>
          </article>)}</div>}

        <h4 className="official-archives-subtitle">PUN GME, finestra operativa ({overview.window.length} mesi)</h4>
        <p className="muted">Per ogni mese: 1. cosa ha letto il servizio e se è validato; 2. la versione approvata che il motore usa davvero, azienda per azienda; 3. il confronto tra i due. In modalità prova i valori letti non sono pubblicati e non entrano nelle simulazioni.</p>
        <div className="official-archive-alerts">{overview.gme.map((month) => <MonthCard key={month.month} month={month} />)}</div>

        <h4 className="official-archives-subtitle">ARERA e Terna: dati usati dal simulatore</h4>
        {overview.regulatoryInUse.length ? <div className="responsive-table"><table><caption>Ultimo periodo disponibile e ultimo aggiornamento di ogni componente regolata</caption><thead><tr><th>Fonte</th><th>Componente</th><th>Ultimo periodo</th><th>Aggiornato il</th><th>Stato</th></tr></thead><tbody>
          {overview.regulatoryInUse.map((item) => <tr key={`${item.source}-${item.name}`}><td>{item.source}</td><td>{item.name}</td><td>{item.lastAvailable ?? "—"}</td><td>{when(item.lastData)}</td><td>{item.statusLabel}</td></tr>)}
        </tbody></table></div> : <p className="muted">{model?.coverageAvailable ? "Nessuna componente ARERA o Terna in archivio." : "Copertura non calcolabile in questo momento: riprova più tardi."}</p>}

        <details className="official-archive-technical"><summary>Storico delle esecuzioni del servizio ({overview.history.length})</summary>
          <div className="responsive-table"><table><thead><tr><th>Quando</th><th>Attività</th><th>Modalità</th><th>Esito</th><th>Durata</th><th>Errori</th></tr></thead><tbody>
            {overview.history.map((run) => <tr key={run.runId || run.startedAt}><td>{when(run.startedAt)}</td><td>{run.jobLabel}</td><td>{run.modeLabel}</td><td>{run.outcomeLabel}</td><td>{seconds(run.durationMs)}</td><td>{run.errors.length ? <ErrorList errors={run.errors} /> : "nessuno"}</td></tr>)}
          </tbody></table></div>
        </details>
      </> : null}
    </div>
  </section>;
}
