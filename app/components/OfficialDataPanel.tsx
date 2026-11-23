"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";
import type { AcquiredValueView, GmeMonthView, OfficialDataOverview, PunField, ServiceError, SourceStatus } from "../lib/official-monitor/service-overview";

/**
 * Control Room Produttore → Dati ufficiali (Tony 22/11/2026): GME, ARERA and Terna verified from the application, without Vercel
 * logs or a terminal. Read-only screen: state of each source, last run of the independent service and its outcome, GME values
 * acquired (month, year, unit, source document), the official reference values of the weekly audit, the version the simulator
 * actually uses for each company, the comparison between them, and every anomaly. Three levels are never mixed: acquired in
 * test mode, validated, published and used in simulations.
 */
type ActiveJob = { readonly job: string; readonly since: string | null; readonly until: string } | null;
type Model = { readonly overview: OfficialDataOverview; readonly coverageAvailable: boolean; readonly manual?: { readonly connected: boolean; readonly active: { readonly gme: ActiveJob; readonly regulatory: ActiveJob } } };
/** Manual commands (Tony 23/11/2026): each source card has its button; ARERA and Terna share the service job "regulatory". */
type Command = "gme" | "arera" | "terna";
const COMMANDS: Readonly<Record<SourceStatus["source"], { readonly command: Command; readonly label: string; readonly job: "gme" | "regulatory" }>> = {
  GME: { command: "gme", label: "Aggiorna GME", job: "gme" }, ARERA: { command: "arera", label: "Aggiorna ARERA", job: "regulatory" }, TERNA: { command: "terna", label: "Aggiorna Terna", job: "regulatory" },
};
type Phase = "WAITING" | "RUNNING" | "COMPLETED" | "ERROR";
type CommandState = { readonly phase: Phase; readonly message: string; readonly at: string; readonly errors: readonly ServiceError[] };
type TriggerResponse = { readonly status: "COMPLETED" | "ALREADY_RUNNING" | "RUNNING" | "FAILED"; readonly outcome: string | null; readonly message: string; readonly errors: readonly ServiceError[] };
const PHASE_LABEL: Readonly<Record<Phase, string>> = { WAITING: "In attesa", RUNNING: "In esecuzione", COMPLETED: "Completato", ERROR: "Errore" };
const phaseTone = (phase: Phase) => phase === "COMPLETED" ? "positive" : phase === "ERROR" ? "negative" : "";

const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }) : "—";
const euro = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const seconds = (ms: number) => `${(ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s`;
const FIELD_LABEL: Readonly<Record<PunField, string>> = { f1: "F1", f2: "F2", f3: "F3", monthly: "Mensile" };
const sourceTone = (status: SourceStatus["status"]) => status === "OK" ? "positive" : status === "NEVER_RUN" ? "" : "negative";
const levelTone = (level: GmeMonthView["level"]) => level === "PUBLISHED_IN_USE" ? "positive" : level === "VALIDATED_NOT_PUBLISHED" ? "" : "negative";
/** The three GME pages (Tony 22/11/2026), shown before the service has reported on them. */
const GME_PAGES_DEFAULT = [
  { id: "GME_PUN_BANDS", url: "https://www.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce", meaning: "Prezzo medio per fasce F1, F2, F3 (PDF mensile)", reachable: false, detail: "" },
  { id: "ARERA_300_05_ART_5_2", url: "https://www.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioDel300", meaning: "Parametro art. 5.2 della deliberazione ARERA 300/05 (PUNop), pubblicato dal GME", reachable: false, detail: "" },
  { id: "GME_PUN_INDEX_GME", url: "https://www.mercatoelettrico.org/it-it/Home/Pubblicazioni/Indici-GME/PUNIndexGme", meaning: "PUN Index GME: definizione dell'indice; il valore mensile si legge dalla Newsletter GME, Tabella 1", reachable: false, detail: "" },
] as const;
const shortSha = (sha: string | null) => sha ? `${sha.slice(0, 12)}…` : "—";
const fileName = (url: string | null) => { if (!url) return "—"; try { return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? url); } catch { return url; } };

function ErrorList({ errors }: { readonly errors: readonly ServiceError[] }) {
  if (!errors.length) return null;
  return <ul className="plain-list">{errors.map((error, index) => <li key={`${error.code}-${index}`}>{error.scope ? <strong>{error.scope}: </strong> : null}{error.message} <small className="muted">(codice {error.code})</small></li>)}</ul>;
}

function CommandControl({ source, state, connected, active, busy, onStart }: { readonly source: SourceStatus["source"]; readonly state: CommandState | undefined; readonly connected: boolean; readonly active: ActiveJob; readonly busy: boolean; readonly onStart: (command: Command) => void }) {
  const spec = COMMANDS[source];
  const phase: Phase | null = state?.phase ?? (active ? "RUNNING" : null);
  const disabled = !connected || busy || Boolean(active);
  const why = !connected ? "Comando non collegato al servizio in questo ambiente" : active ? "Aggiornamento già in esecuzione sul servizio" : busy ? "Aggiornamento già in corso" : undefined;
  return <div className="official-command">
    <button className="button secondary" type="button" disabled={disabled} title={why} onClick={() => onStart(spec.command)}>{spec.label}</button>
    {phase ? <small><span className={`status-badge ${phaseTone(phase)}`}>{PHASE_LABEL[phase]}</span> {state ? `${state.message} · ${when(state.at)}` : active?.since ? `avviato ${when(active.since)}` : ""}</small> : null}
    {state?.errors.length ? <ErrorList errors={state.errors} /> : null}
  </div>;
}

function ValuesTable({ values }: { readonly values: readonly AcquiredValueView[] }) {
  if (!values.length) return null;
  return <details className="official-archive-technical"><summary>Valori acquisiti nell&apos;ultima esecuzione ({values.length})</summary>
    <div className="responsive-table"><table><thead><tr><th>Azienda</th><th>Componente</th><th>Clienti</th><th>Periodo</th><th>Valore</th><th>Documento</th></tr></thead><tbody>
      {values.map((item, index) => <tr key={`${item.identifier}-${item.component}-${item.customerScope}-${item.tenantLabel}-${index}`}><td>{item.tenantLabel}</td><td>{item.component}<br /><small className="muted">{item.identifier}</small></td><td>{item.customerScope}</td><td>{item.period}</td><td>{item.value.toLocaleString("it-IT", { maximumFractionDigits: 7 })} {item.unit}</td><td>{item.source ? <a href={item.source} target="_blank" rel="noreferrer">{fileName(item.source)}</a> : "—"}<br /><small className="muted">SHA {shortSha(item.sha256)}</small></td></tr>)}
    </tbody></table></div></details>;
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

    <h5>Parametro art. 5.2 della deliberazione ARERA 300/05 (serie distinta dal PUN)</h5>
    {month.punop ? <>
      <p>{month.punop.value !== null ? <strong>{euro(month.punop.value)} {month.punop.unit}</strong> : "—"} · <span className={`status-badge ${month.punop.validated ? "positive" : month.punop.errors.some((error) => !error.informative) ? "negative" : ""}`}>{month.punop.validated ? (month.punop.conserved ? "Validato e archiviato" : "Validato, non archiviato (modalità prova)") : "Non validato"}</span>{month.punop.label ? ` · ${month.punop.label}` : ""}</p>
      <p>{month.punop.url ? <a href={month.punop.url} target="_blank" rel="noreferrer">{fileName(month.punop.url)}</a> : null}{month.punop.sha256 ? <small className="muted"> · SHA-256 {shortSha(month.punop.sha256)}</small> : null}{month.punop.url ? <br /> : null}<small className="muted">{month.punop.note}</small></p>
      <p className="muted">{month.punop.usage}.</p>
    </> : <p className="muted">Non ancora letto dal servizio per questo mese.</p>}

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

const RUNNING_ON_SERVICE = "Il servizio sta eseguendo l'aggiornamento: il risultato comparirà qui al termine.";

export default function OfficialDataPanel() {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commands, setCommands] = useState<Partial<Record<Command, CommandState>>>({});
  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(null); }
    try { setModel(await requestJson<Model>("/api/system/official-data")); }
    catch (cause) { if (!quiet) { const safe = toUiError(cause); setError(`${safe.message} (codice ${safe.code})`); } }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const manual = model?.manual ?? null;
  const pending = Object.values(commands).some((state) => state?.phase === "WAITING" || state?.phase === "RUNNING");
  const serviceBusy = Boolean(manual?.active.gme || manual?.active.regulatory);
  // While a command runs (here or on the service), the reports are re-read every few seconds.
  useEffect(() => {
    if (!pending && !serviceBusy) return;
    const timer = window.setInterval(() => { void load(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [pending, serviceBusy, load]);
  // A command left running on the service ends when its lease is released: the new report is then on screen.
  useEffect(() => {
    if (!manual) return;
    setCommands((current) => {
      let changed = false; const next = { ...current };
      for (const [command, state] of Object.entries(current) as [Command, CommandState][]) {
        const job = command === "gme" ? "gme" : "regulatory";
        if (state.phase === "WAITING" && manual.active[job]) { next[command] = { ...state, phase: "RUNNING" }; changed = true; }
        if (state.phase === "RUNNING" && state.message === RUNNING_ON_SERVICE && !manual.active[job]) { next[command] = { phase: "COMPLETED", message: "Esecuzione terminata: il risultato è nella scheda della fonte.", at: new Date().toISOString(), errors: [] }; changed = true; }
      }
      return changed ? next : current;
    });
  }, [manual]);
  const start = useCallback(async (command: Command) => {
    setCommands((current) => ({ ...current, [command]: { phase: "WAITING", message: "Comando inviato al servizio.", at: new Date().toISOString(), errors: [] } }));
    void load(true);
    try {
      const result = await requestJson<TriggerResponse>("/api/system/official-data/run", { method: "POST", body: JSON.stringify({ command }) });
      const phase: Phase = result.status === "COMPLETED" ? "COMPLETED" : result.status === "FAILED" ? "ERROR" : "RUNNING";
      setCommands((current) => ({ ...current, [command]: { phase, message: result.status === "RUNNING" || result.status === "ALREADY_RUNNING" ? RUNNING_ON_SERVICE : result.message, at: new Date().toISOString(), errors: result.errors } }));
    } catch (cause) {
      const safe = toUiError(cause);
      setCommands((current) => ({ ...current, [command]: { phase: "ERROR", message: `${safe.message} (codice ${safe.code})`, at: new Date().toISOString(), errors: [] } }));
    }
    await load(true);
  }, [load]);
  const overview = model?.overview ?? null;
  const blocking = overview?.anomalies.filter((item) => item.severity === "BLOCKING").length ?? 0;

  return <section id="dati-ufficiali" className="content-stack official-archives" aria-labelledby="official-data-title">
    <div className="ui-card">
      <div className="card-heading"><div><p className="eyebrow">Control Room Produttore</p><h3 id="official-data-title">Dati ufficiali</h3><p>Stato degli aggiornamenti automatici GME, ARERA e Terna, valori acquisiti e valori usati dal Simulatore EE. I comandi «Aggiorna» avviano il servizio in modalità prova: scarica e verifica, non pubblica e non modifica gli archivi.</p></div>
        <button className="button secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Lettura…" : "Rileggi i rapporti"}</button></div>
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
          <ValuesTable values={source.values ?? []} />
          <CommandControl source={source.source} state={commands[COMMANDS[source.source].command]} connected={manual?.connected ?? false} active={manual ? manual.active[COMMANDS[source.source].job] : null} busy={Object.entries(commands).some(([command, state]) => (state?.phase === "WAITING" || state?.phase === "RUNNING") && COMMANDS[source.source].job === (command === "gme" ? "gme" : "regulatory"))} onStart={(command) => void start(command)} />
        </div>)}</div>
        {manual && !manual.connected ? <p className="muted">Comandi di aggiornamento non attivi in questo ambiente: manca il collegamento tra Simulatore e servizio dati ufficiali. Gli aggiornamenti automatici pianificati continuano.</p> : null}

        <h4 className="official-archives-subtitle">Fonti GME</h4>
        <div className="responsive-table"><table><caption>Pagine ufficiali GME lette dal servizio, ciascuna con il proprio significato</caption><thead><tr><th>Serie</th><th>Significato</th><th>Pagina</th><th>Ultima verifica</th></tr></thead><tbody>
          {(overview.gmePages ?? GME_PAGES_DEFAULT).map((page) => <tr key={page.id}><td><code>{page.id}</code></td><td>{page.meaning}</td><td><a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https:\/\//, "")}</a></td><td>{overview.gmePages ? <span className={`status-badge ${page.reachable ? "positive" : "negative"}`}>{page.reachable ? "Raggiungibile" : page.detail}</span> : "Non ancora verificata dal servizio"}</td></tr>)}
        </tbody></table></div>

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
