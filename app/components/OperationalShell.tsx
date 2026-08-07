"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, FormField, LoadingState } from "./UiStates";
import CteIngestionPanel from "./CteIngestionPanel";
import { downloadExport, requestForm, requestJson, toUiError } from "../lib/ui/client";
import { formatEuro, formatNumber, statusLabel } from "../lib/ui/format";
import type { BillDocumentModel, CalculationModel, ComparisonModel, CteArchiveModel, MarketArchiveModel, ProposalModel, ReadinessModel, SimulationDraft, UiRole, UiVector, VerifiedContextModel } from "../lib/ui/models";

type SectionId = "dashboard" | "bills" | "cte" | "market" | "simulations" | "proposals" | "system";
type LoadState = "loading" | "ready" | "error";
const sections: readonly { readonly id: SectionId; readonly label: string; readonly short: string }[] = [{ id: "dashboard", label: "Dashboard", short: "D" }, { id: "bills", label: "Bollette", short: "B" }, { id: "cte", label: "Archivio CTE", short: "C" }, { id: "market", label: "Dati di mercato", short: "M" }, { id: "simulations", label: "Simulazioni", short: "S" }, { id: "proposals", label: "Proposte", short: "P" }, { id: "system", label: "Stato sistema", short: "" }];

function uiError(error: unknown): string { const safe = toUiError(error); return `${safe.message}  codice ${safe.code}${safe.correlationId ? `  ${safe.correlationId}` : ""}`; }
function parseObject(value: string): Record<string, unknown> { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("FORM_INVALID"); return parsed as Record<string, unknown>; }
function StatusBadge({ value }: { readonly value: string }) { const tone = ["APPROVED", "REVIEWED", "ALLOWED"].includes(value) ? "positive" : ["REJECTED", "FAILED"].includes(value) ? "negative" : "neutral"; return <span className={`status-badge ${tone}`}>{statusLabel(value)}</span>; }
function SectionHeader({ eyebrow, title, detail, action }: { readonly eyebrow: string; readonly title: string; readonly detail: string; readonly action?: ReactNode }) { return <div className="section-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="section-detail">{detail}</p></div>{action}</div>; }
function Card({ children, className = "" }: { readonly children: ReactNode; readonly className?: string }) { return <section className={`ui-card ${className}`}>{children}</section>; }
function DataLine({ label, value }: { readonly label: string; readonly value: ReactNode }) { return <div className="data-line"><span>{label}</span><strong>{value}</strong></div>; }
function MetricCard({ label, value, detail, tone = "default" }: { readonly label: string; readonly value: string; readonly detail: string; readonly tone?: "default" | "positive" | "warning" }) { return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }

function VectorTabs({ idPrefix, value, onChange }: { readonly idPrefix: string; readonly value: UiVector; readonly onChange: (value: UiVector) => void }) {
  function move(event: React.KeyboardEvent) { const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? "GAS" : event.key === "ArrowLeft" || event.key === "ArrowUp" ? "EE" : event.key === "Home" ? "EE" : event.key === "End" ? "GAS" : null; if (next) { event.preventDefault(); onChange(next); document.getElementById(`${idPrefix}-${next.toLowerCase()}-tab`)?.focus(); } }
  return <div className="vector-tabs" role="tablist" aria-label="Vettore energetico"><button id={`${idPrefix}-ee-tab`} type="button" role="tab" aria-selected={value === "EE"} aria-controls={`${idPrefix}-panel`} tabIndex={value === "EE" ? 0 : -1} className={value === "EE" ? "active" : ""} onClick={() => onChange("EE")} onKeyDown={move}>Energia elettrica (EE)</button><button id={`${idPrefix}-gas-tab`} type="button" role="tab" aria-selected={value === "GAS"} aria-controls={`${idPrefix}-panel`} tabIndex={value === "GAS" ? 0 : -1} className={value === "GAS" ? "active" : ""} onClick={() => onChange("GAS")} onKeyDown={move}>Gas (GAS)</button></div>;
}

function DashboardPanel({ context, readiness, readinessState }: { readonly context: VerifiedContextModel | null; readonly readiness: ReadinessModel | null; readonly readinessState: LoadState }) {
  return <div className="content-stack"><SectionHeader eyebrow="CONTROL ROOM OPERATIVA" title="Dashboard" detail="Contesto e stato provengono dai servizi server Phase 6. Nessun ruolo, tenant o valore viene inventato nel browser." /><div className="metric-grid"><MetricCard label="Stato applicazione" value={readinessState === "loading" ? "Caricamento" : readiness?.readiness ? "Pronto" : "Bloccato"} detail={context?.runtimeMode === "local" ? "Locale sintetico esplicito" : context?.runtimeMode === "production" ? "Production" : "Non disponibile"} tone={readiness?.readiness ? "positive" : "warning"} /><MetricCard label="Autenticazione" value={context?.authenticated ? "Autenticata" : "Non autenticata"} detail={context?.role ?? "Sola lettura"} /><MetricCard label="Calcolo e confronto" value="Su richiesta" detail="Totali e ranking arrivano dal server" /><MetricCard label="Readiness" value={readiness?.readiness ? "APPROVED" : "Non disponibile"} detail="Contratto health/readiness" /></div><div className="two-columns"><Card><h3>Contesto verificato</h3><div className="data-list"><DataLine label="Principal" value={context?.principalId ?? "Non disponibile"} /><DataLine label="Ruolo" value={context?.role ?? "Non autenticato"} /><DataLine label="Tenant" value={context?.tenantId ?? "Non disponibile"} /><DataLine label="Sessione" value={context?.authenticated ? "Server verificata" : "Non autenticata"} /></div></Card><Card><h3>Stato readiness</h3>{readinessState === "loading" ? <LoadingState label="Verifica configurazione" /> : readiness ? <div className="data-list"><DataLine label="Runtime" value={readiness.runtimeMode} /><DataLine label="Persistenza" value={readiness.persistenceAdapterConfigured ? "Configurata" : "Mancante"} /><DataLine label="Schema" value={readiness.schemaCompatibility ? "Compatibile" : "Non compatibile"} /></div> : <ErrorState message="Readiness non disponibile" />}</Card></div></div>;
}

function BillsPanel({ readonly }: { readonly readonly: boolean }) {
  const [listState, setListState] = useState<LoadState>("loading"); const [detailState, setDetailState] = useState<LoadState>("ready"); const [bills, setBills] = useState<readonly BillDocumentModel[]>([]); const [bill, setBill] = useState<BillDocumentModel | null>(null); const [pending, setPending] = useState<"upload" | "approve" | "correct" | null>(null); const [field, setField] = useState(""); const [value, setValue] = useState(""); const [fieldError, setFieldError] = useState<string>(); const [error, setError] = useState<string>(); const [message, setMessage] = useState<string>();
  const load = useCallback(async (signal?: AbortSignal) => { setListState("loading"
); try { const response = await requestJson<{ readonly documents: readonly BillDocumentModel[] }>("/api/bills", {}, signal); setBills(response.documents); setListState("ready"); } catch (cause) { if (!signal?.aborted) { setListState("error"); setError(uiError(cause)); } } }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function select(id: string) { setError(undefined); setDetailState("loading"); try { const response = await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(id)}`); setBill(response.document); setDetailState("ready"); } catch (cause) { setDetailState("error"); setError(uiError(cause)); } }
  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file || readonly || pending) return; setError(undefined); setPending("upload"); if (file.type !== "application/pdf" || file.size > 10_000_000) { setError("Il file PDF non rispetta i limiti di formato o dimensione."); setPending(null); return; } const body = new FormData(); body.set("file", file); try { const response = await requestForm<{ readonly document: BillDocumentModel }>("/api/bills", body); await load(); await select(response.document.id); setMessage("Bolletta caricata dal server."); } catch (cause) { setError(uiError(cause)); } finally { setPending(null); } }
  async function mutate(operation: "approve" | "correct") { if (!bill || readonly || pending) return; setError(undefined); setFieldError(undefined); if (operation === "correct" && !field.trim()) { setFieldError("Indicare il campo da correggere."); return; } setPending(operation); const body = operation === "approve" ? { operation, versionId: bill.currentVersionId } : { operation, field: field.trim(), value, versionId: bill.currentVersionId }; try { const response = await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(bill.id)}`, { method: "PATCH", body: JSON.stringify(body) }); setBill(response.document); await load(); setMessage("Operazione sulla bolletta inviata al server."); } catch (cause) { setError(uiError(cause)); } finally { setPending(null); } }
  return <div className="content-stack"><SectionHeader eyebrow="DOCUMENTI E PROVENIENZA" title="Bollette" detail="Elenco, dettaglio e revisione sono tenant-scoped dal server. Documento originale, objectKey, percorsi e OCR non vengono esposti." /><Card><div className="card-heading"><div><h3>Carica bolletta PDF</h3><p>La validazione definitiva resta server-side.</p></div><label className="button primary">Seleziona PDF<input className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={upload} disabled={readonly || pending !== null} /></label></div>{pending === "upload" ? <LoadingState label="Invio documento" /> : null}{error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}</Card><div className="two-columns"><Card><h3>Elenco tenant-scoped</h3>{listState === "loading" ? <LoadingState label="Caricamento bollette" /> : listState === "error" ? <ErrorState message="Elenco bollette non disponibile" onRetry={() => void load()} /> : bills.length ? <div className="select-list">{bills.map((item) => <button type="button" key={item.id} className={item.id === bill?.id ? "selected" : ""} onClick={() => void select(item.id)} disabled={detailState === "loading"}><span>{item.fileName}</span><StatusBadge value={item.status} /><small>{item.id}  {item.status}</small></button>)}</div> : <EmptyState title="Nessuna bolletta" detail="Il tenant verificato non ha documenti nell'archivio." />}</Card><Card><h3>Dettaglio autorevole</h3>{detailState === "loading" ? <LoadingState label="Lettura dettaglio" /> : bill ? <BillDetail bill={bill} readonly={readonly} pending={pending} field={field} value={value} fieldError={fieldError} onField={setField} onValue={setValue} onAction={mutate} /> : <EmptyState title="Nessun documento selezionato" detail="Seleziona una bolletta restituita dall'elenco." />}</Card></div></div>;
}

function BillDetail({ bill, readonly, pending, field, value, fieldError, onField, onValue, onAction }: { readonly bill: BillDocumentModel; readonly readonly: boolean; readonly pending: "upload" | "approve" | "correct" | null; readonly field: string; readonly value: string; readonly fieldError?: string; readonly onField: (value: string) => void; readonly onValue: (value: string) => void; readonly onAction: (operation: "approve" | "correct") => Promise<void> }) { return <div className="data-list"><DataLine label="Identificativo" value={bill.id} /><DataLine label="Filename" value={bill.fileName} /><DataLine label="Classificazione / vettore" value="Non disponibile" /><DataLine label="Stato" value={<StatusBadge value={bill.status} />} /><DataLine label="Revisione" value={statusLabel(bill.reviewState)} /><DataLine label="Versione" value={bill.currentVersionNumber} /><DataLine label="Pronto per approvazione" value={bill.approvalReady ? "S" : "No"} /><div className="provenance-list"><strong>Valori normalizzati e provenienza</strong>{Object.entries(bill.fields).length ? Object.entries(bill.fields).map(([name, item]) => <div key={name}><span>{name}</span><span>{item.value ?? "Non disponibile"}  {item.source}  {formatNumber(item.confidence)}{item.confirmed ? "" : "  da confermare"}</span></div>) : <span>Nessun valore disponibile.</span>}</div><div className="button-row"><button className="button primary" type="button" disabled={readonly || pending !== null || !bill.approvalReady} onClick={() => void onAction("approve")}>{pending === "approve" ? "Approvazione" : "Approva"}</button></div><FormField id="bill-correction-field" label="Campo da correggere" error={fieldError}><input id="bill-correction-field" value={field} onChange={(event) => onField(event.target.value)} disabled={readonly || pending !== null} /></FormField><FormField id="bill-correction-value" label="Valore corretto" hint="Validazione autorevole del server."><input id="bill-correction-value" value={value} onChange={(event) => onValue(event.target.value)} disabled={readonly || pending !== null} /></FormField><button className="button secondary" type="button" disabled={readonly || pending !== null} onClick={() => void onAction("correct")}>{pending === "correct" ? "Invio" : "Invia correzione"}</button><p className="muted">Campi non disponibili: Non disponibile. Azioni reject non supportate dal route esistente.</p></div>; }

type CteDraft = {
  readonly vector: UiVector;
  readonly recordId: string;
  readonly cteId: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly offerId: string;
  readonly offerName: string;
  readonly offerCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly expiryDate: string;
  readonly customerType: "RESIDENTIAL" | "NON_RESIDENTIAL" | "";
  readonly voltageLevel: "LV" | "MV" | "HV" | "EHV" | "";
  readonly pricingMode: "INDEXED" | "FIXED";
  readonly taxTreatment: "INCLUDED" | "EXCLUDED" | "NOT_APPLICABLE";
  readonly spread: string;
  readonly fixedPrice: string;
  readonly fixedMonthlyFee: string;
  readonly variableFee: string;
  readonly imbalanceStatus: "DECLARED" | "NOT_DECLARED";
  readonly imbalanceAmount: string;
};

function initialCteDraft(vector: UiVector): CteDraft {
  const suffix = vector.toLowerCase();
  return {
    vector, recordId: "cte-manuale-" + suffix, cteId: "cte-manuale-" + suffix,
    supplierId: "supplier-manuale-" + suffix, supplierName: "",
    offerId: "offer-manuale-" + suffix, offerName: "", offerCode: "",
    periodStart: "", periodEnd: "", expiryDate: "",
    customerType: "NON_RESIDENTIAL", voltageLevel: vector === "EE" ? "LV" : "",
    pricingMode: "INDEXED", taxTreatment: "EXCLUDED", spread: "",
    fixedPrice: "", fixedMonthlyFee: "", variableFee: "",
    imbalanceStatus: "NOT_DECLARED", imbalanceAmount: "",
  };
}

function validateCteDraft(draft: CteDraft): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const required = (key: keyof CteDraft, message: string) => {
    if (typeof draft[key] !== "string" || !String(draft[key]).trim()) errors[String(key)] = message;
  };
  const numberField = (key: keyof CteDraft, message: string) => {
    const value = String(draft[key]).trim();
    if (!value || !Number.isFinite(Number(value)) || Number(value) < 0) errors[String(key)] = message;
  };
  const dateField = (key: keyof CteDraft) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft[key]))) errors[String(key)] = "Inserire una data valida.";
  };
  required("recordId", "Inserire l'identificativo del record.");
  required("cteId", "Inserire l'identificativo CTE.");
  required("supplierId", "Inserire l'identificativo del fornitore.");
  required("supplierName", "Inserire il nome del fornitore.");
  required("offerId", "Inserire l'identificativo dell'offerta.");
  required("offerName", "Inserire il nome dell'offerta.");
  required("offerCode", "Inserire il codice dell'offerta.");
  dateField("periodStart"); dateField("periodEnd"); dateField("expiryDate");
  required("customerType", "Selezionare il tipo cliente.");
  if (draft.vector === "EE") required("voltageLevel", "Selezionare il livello di tensione.");
  numberField("fixedMonthlyFee", "Inserire un importo mensile valido.");
  numberField("variableFee", "Inserire un importo variabile valido.");
  if (draft.pricingMode === "INDEXED") numberField("spread", "Inserire uno spread valido.");
  else numberField("fixedPrice", "Inserire un prezzo fisso valido.");
  if (draft.imbalanceStatus === "DECLARED") numberField("imbalanceAmount", "Inserire l'importo di sbilanciamento.");
  return errors;
}

/* Legacy manual CTE contract builder retained only as commented historical code; OCR ingestion is the operational path.
function cteContractFromDraft(draft: CteDraft, tenantId: string): Record<string, unknown> {
  const taxTreatment = draft.taxTreatment;
  const priceUnit = "SERVER_AUTHORITATIVE";
  const feeUnit = priceUnit;
  const fee = (feeId: string, label: string, amount: string, unit: string) => ({
    feeId, label, amount: Number(amount), currency: "EUR", unit, taxTreatment,
  });
  const imbalance = draft.imbalanceStatus === "DECLARED"
    ? { status: "DECLARED", component: fee("imbalance-" + draft.vector.toLowerCase(), "Sbilanciamento", draft.imbalanceAmount, feeUnit) }
    : { status: "NOT_DECLARED", reason: "NOT_PROVIDED" };
  const pricing = draft.pricingMode === "INDEXED"
    ? { mode: "INDEXED", reference: draft.vector === "EE" ? "PUN" : "PSV", spread: { amount: Number(draft.spread), currency: "EUR", unit: priceUnit, taxTreatment } }
    : { mode: "FIXED", reference: "NONE", fixedPrice: { amount: Number(draft.fixedPrice), currency: "EUR", unit: priceUnit, taxTreatment }, spread: { status: "NOT_DECLARED", reason: "NOT_PROVIDED" } };
  const eligibility = draft.vector === "EE"
    ? { customerTypes: [draft.customerType], voltageLevels: [draft.voltageLevel] }
    : { customerTypes: [draft.customerType] };
  return {
    schemaVersion: 1, recordId: draft.recordId.trim(), version: "1", parentVersionId: null,
    tenantId, approval: { status: "DRAFT", reason: "IMPORTED_FOR_REVIEW" },
    recordType: "CTE", cteId: draft.cteId.trim(), vector: draft.vector,
    supplier: { supplierId: draft.supplierId.trim(), name: draft.supplierName.trim() },
    offer: { offerId: draft.offerId.trim(), name: draft.offerName.trim(), code: draft.offerCode.trim() },
    validity: { periodStart: draft.periodStart, periodEnd: draft.periodEnd },
    expiry: { status: "EXPIRES_ON", date: draft.expiryDate },
    currency: "EUR", taxTreatment, eligibility, pricing,
    commercialTerms: {
      fixedFees: [fee("fixed-monthly-" + draft.vector.toLowerCase(), "Quota fissa mensile", draft.fixedMonthlyFee, "EUR_PER_MONTH")],
      variableFees: [fee("variable-" + draft.vector.toLowerCase(), "Quota variabile", draft.variableFee, feeUnit)],
      imbalance, oneOffFees: [], commercialDiscounts: [],
    },
  };
}

}
*/

function cteContractFromDraft(_draft: CteDraft, _tenantId: string): Record<string, unknown> {
  void _draft;
  void _tenantId;
  throw new Error("CTE_MANUAL_FLOW_REMOVED");
}

function focusCteError(errors: Readonly<Record<string, string>>): void {
  const first = Object.keys(errors).find((key) => key !== "form");
  if (!first) return;
  requestAnimationFrame(() => {
    const control = document.getElementById("cte-" + first);
    if (control instanceof HTMLElement) {
      control.focus();
      control.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

function CtePanel({ readonly, tenantId }: { readonly readonly: boolean; readonly tenantId: string | null }) {
  const [vector, setVector] = useState<UiVector>("EE");
  const [draft, setDraft] = useState<CteDraft>(() => initialCteDraft("EE"));
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string>();
  const [records, setRecords] = useState<readonly CteArchiveModel[]>([]);
  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ readonly records: readonly CteArchiveModel[] }>("/api/cte/archive");
      setRecords(result.records);
    } catch (cause) {
      setError(uiError(cause));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const operationKey = (kind: "create" | "approve" | "reject" | "correction", record?: CteArchiveModel) =>
    kind === "create" ? "cte:create" : "cte:" + kind + ":" + String(record?.archiveId ?? "missing");
  const busy = (key: string) => pending.has(key);
  const recordBusy = (id: string) => [...pending].some((key) => key.endsWith(":" + id));

  function updateDraft<K extends keyof CteDraft>(key: K, value: CteDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[String(key)]; delete next.form; return next; });
    setError(undefined);
    setMessage(undefined);
  }

  function invalidDraft(): Readonly<Record<string, string>> {
    const errors = validateCteDraft(draft);
    if (Object.keys(errors).length > 0) {
      const withForm = { ...errors, form: "Correggere i campi evidenziati prima dell'invio." };
      setFieldErrors(withForm);
      focusCteError(withForm);
    }
    return errors;
  }

  async function action(kind: "approve" | "reject" | "correction", record: CteArchiveModel): Promise<void> {
    const key = operationKey(kind, record);
    if (readonly || !tenantId || busy(key) || recordBusy(record.archiveId)) return;
    let contract: Record<string, unknown> | undefined;
    if (kind === "correction") {
      const errors = invalidDraft();
      if (Object.keys(errors).length > 0) return;
      contract = cteContractFromDraft(draft, tenantId);
    }
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setError(undefined); setMessage(undefined); setFieldErrors({});
    try {
      const body = kind === "approve"
        ? { versionId: record.currentWorkingVersionId, decisionId: "decision_ui_" + record.archiveId }
        : kind === "reject"
          ? { versionId: record.currentWorkingVersionId, reason: "Decisione operativa" }
          : { expectedVersionId: record.currentWorkingVersionId, contract, reason: "Correzione operativa" };
      await requestJson("/api/cte/archive/" + record.archiveId + "/" + kind, { method: "POST", body: JSON.stringify(body) });
      await load();
      setMessage("Operazione CTE inviata al server.");
    } catch (cause) {
      setError(uiError(cause));
    } finally {
      pendingRef.current.delete(key);
      setPending(new Set(pendingRef.current));
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (readonly || !tenantId || busy("cte:create") || pendingRef.current.has("cte:create")) {
      if (readonly) setError("Operazione non disponibile: contesto autenticato e readiness richiesti.");
      return;
    }
    const errors = invalidDraft();
    if (Object.keys(errors).length > 0) return;
    pendingRef.current.add("cte:create");
    setPending(new Set(pendingRef.current));
    setError(undefined); setMessage(undefined); setFieldErrors({});
    try {
      await requestJson("/api/cte/archive", { method: "POST", body: JSON.stringify({ contract: cteContractFromDraft(draft, tenantId) }) });
      await load();
      setMessage("CTE creato e lista aggiornata.");
    } catch (cause) {
      setError(uiError(cause));
    } finally {
      pendingRef.current.delete("cte:create");
      setPending(new Set(pendingRef.current));
    }
  }

  const preview = tenantId ? cteContractFromDraft(draft, tenantId) : null;
  return <div className="content-stack">
    <SectionHeader eyebrow="CONTRATTI E OFFERTE" title="Archivio CTE" detail="EE e GAS restano separati; lifecycle e eligibility sono server-side." />
    <VectorTabs idPrefix="cte" value={vector} onChange={(next) => { setVector(next); setDraft(initialCteDraft(next)); setFieldErrors({}); setError(undefined); setMessage(undefined); }} />
    <div id="cte-panel" role="tabpanel" aria-labelledby={"cte-" + vector.toLowerCase() + "-tab"} tabIndex={0}>
      <Card><h3>Record {vector}</h3>
        {records.filter((record) => record.vector === vector).map((record) => <div className="data-line" key={record.archiveId}><span>{record.cteId} {record.currentWorkingVersionId}</span><span className="button-row">
          <button className="button compact" type="button" disabled={readonly || busy(operationKey("approve", record)) || recordBusy(record.archiveId)} onClick={() => void action("approve", record)}>Approva</button>
          <button className="button compact danger" type="button" disabled={readonly || busy(operationKey("reject", record)) || recordBusy(record.archiveId)} onClick={() => void action("reject", record)}>Rifiuta</button>
          <button className="button compact secondary" type="button" disabled={readonly || busy(operationKey("correction", record)) || recordBusy(record.archiveId)} onClick={() => void action("correction", record)}>Correggi</button>
        </span></div>)}
        {!records.some((record) => record.vector === vector) ? <EmptyState title={"Nessun CTE " + vector} detail="Nessun record restituito dal server." /> : null}
      </Card>
      <Card className="cte-create-card">
        {message ? <p className="inline-success cte-submit-status" role="status" aria-live="polite">{message}</p> : null}
        {readonly ? <p className="warning-text" role="status">Inserimento disabilitato finché contesto autenticato e readiness non sono verificati.</p> : null}
        <form onSubmit={(event) => { void submitCreate(event); }}>
          <div className="card-heading">
            <div><h3>Crea CTE {vector}</h3><p>Compilare i campi leggibili; il server valida il contratto completo.</p></div>
            <button className="button primary" type="submit" disabled={readonly || busy("cte:create")} aria-busy={busy("cte:create")}>{busy("cte:create") ? "Invio…" : "Invia"}</button>
          </div>
          {fieldErrors.form ? <p className="form-submit-error" role="alert">{fieldErrors.form}</p> : null}
          {error ? <ErrorState message={error} /> : null}
          <fieldset className="fieldset"><legend>Identificativi contratto</legend><div className="form-grid">
            <FormField id="cte-recordId" label="Identificativo record" error={fieldErrors.recordId}><input id="cte-recordId" value={draft.recordId} onChange={(event) => updateDraft("recordId", event.target.value)} required /></FormField>
            <FormField id="cte-cteId" label="Identificativo CTE" error={fieldErrors.cteId}><input id="cte-cteId" value={draft.cteId} onChange={(event) => updateDraft("cteId", event.target.value)} required /></FormField>
            <FormField id="cte-supplierId" label="ID fornitore" error={fieldErrors.supplierId}><input id="cte-supplierId" value={draft.supplierId} onChange={(event) => updateDraft("supplierId", event.target.value)} required /></FormField>
            <FormField id="cte-offerId" label="ID offerta" error={fieldErrors.offerId}><input id="cte-offerId" value={draft.offerId} onChange={(event) => updateDraft("offerId", event.target.value)} required /></FormField>
          </div></fieldset>
          <fieldset className="fieldset"><legend>Offerta</legend><div className="form-grid">
            <FormField id="cte-supplierName" label="Nome fornitore" error={fieldErrors.supplierName}><input id="cte-supplierName" value={draft.supplierName} onChange={(event) => updateDraft("supplierName", event.target.value)} required /></FormField>
            <FormField id="cte-offerName" label="Nome offerta" error={fieldErrors.offerName}><input id="cte-offerName" value={draft.offerName} onChange={(event) => updateDraft("offerName", event.target.value)} required /></FormField>
            <FormField id="cte-offerCode" label="Codice offerta" error={fieldErrors.offerCode}><input id="cte-offerCode" value={draft.offerCode} onChange={(event) => updateDraft("offerCode", event.target.value)} required /></FormField>
            <FormField id="cte-periodStart" label="Validità inizio" error={fieldErrors.periodStart}><input id="cte-periodStart" type="date" value={draft.periodStart} onChange={(event) => updateDraft("periodStart", event.target.value)} required /></FormField>
            <FormField id="cte-periodEnd" label="Validità fine" error={fieldErrors.periodEnd}><input id="cte-periodEnd" type="date" value={draft.periodEnd} onChange={(event) => updateDraft("periodEnd", event.target.value)} required /></FormField>
            <FormField id="cte-expiryDate" label="Scadenza dichiarata" error={fieldErrors.expiryDate}><input id="cte-expiryDate" type="date" value={draft.expiryDate} onChange={(event) => updateDraft("expiryDate", event.target.value)} required /></FormField>
            <FormField id="cte-customerType" label="Tipo cliente" error={fieldErrors.customerType}><select id="cte-customerType" value={draft.customerType} onChange={(event) => updateDraft("customerType", event.target.value as CteDraft["customerType"])}><option value="">Selezionare</option><option value="NON_RESIDENTIAL">Non residenziale</option><option value="RESIDENTIAL">Residenziale</option></select></FormField>
            {vector === "EE" ? <FormField id="cte-voltageLevel" label="Livello tensione" error={fieldErrors.voltageLevel}><select id="cte-voltageLevel" value={draft.voltageLevel} onChange={(event) => updateDraft("voltageLevel", event.target.value as CteDraft["voltageLevel"])}><option value="">Selezionare</option><option value="LV">LV</option><option value="MV">MV</option><option value="HV">HV</option><option value="EHV">EHV</option></select></FormField> : null}
          </div></fieldset>
          <fieldset className="fieldset"><legend>Prezzi e componenti dichiarate</legend><div className="form-grid">
            <FormField id="cte-pricingMode" label="Modalità prezzo" error={fieldErrors.pricingMode}><select id="cte-pricingMode" value={draft.pricingMode} onChange={(event) => updateDraft("pricingMode", event.target.value as CteDraft["pricingMode"])}><option value="INDEXED">Indicizzato</option><option value="FIXED">Fisso</option></select></FormField>
            <FormField id="cte-reference" label="Riferimento indice"><input id="cte-reference" value={vector === "EE" ? "PUN" : "PSV"} readOnly aria-readonly="true" /></FormField>
            <FormField id="cte-spread" label={vector === "EE" ? "Spread EUR/kWh" : "Spread EUR/Smc"} hint={draft.pricingMode === "INDEXED" ? (vector === "EE" ? "Riferimento PUN" : "Riferimento PSV") : "Non applicabile per prezzo fisso"} error={fieldErrors.spread}><input id="cte-spread" type="number" min="0" step="any" value={draft.spread} onChange={(event) => updateDraft("spread", event.target.value)} disabled={draft.pricingMode !== "INDEXED"} /></FormField>
            {draft.pricingMode === "FIXED" ? <FormField id="cte-fixedPrice" label={vector === "EE" ? "Prezzo fisso EUR/kWh" : "Prezzo fisso EUR/Smc"} error={fieldErrors.fixedPrice}><input id="cte-fixedPrice" type="number" min="0" step="any" value={draft.fixedPrice} onChange={(event) => updateDraft("fixedPrice", event.target.value)} required /></FormField> : null}
            <FormField id="cte-fixedMonthlyFee" label="Quota fissa mensile EUR" error={fieldErrors.fixedMonthlyFee}><input id="cte-fixedMonthlyFee" type="number" min="0" step="any" value={draft.fixedMonthlyFee} onChange={(event) => updateDraft("fixedMonthlyFee", event.target.value)} required /></FormField>
            <FormField id="cte-variableFee" label={vector === "EE" ? "Quota variabile EUR/kWh" : "Quota variabile EUR/Smc"} error={fieldErrors.variableFee}><input id="cte-variableFee" type="number" min="0" step="any" value={draft.variableFee} onChange={(event) => updateDraft("variableFee", event.target.value)} required /></FormField>
            <FormField id="cte-imbalanceStatus" label="Sbilanciamento" error={fieldErrors.imbalanceStatus}><select id="cte-imbalanceStatus" value={draft.imbalanceStatus} onChange={(event) => updateDraft("imbalanceStatus", event.target.value as CteDraft["imbalanceStatus"])}><option value="NOT_DECLARED">Non dichiarato</option><option value="DECLARED">Dichiarato</option></select></FormField>
            {draft.imbalanceStatus === "DECLARED" ? <FormField id="cte-imbalanceAmount" label={vector === "EE" ? "Importo sbilanciamento EUR/kWh" : "Importo sbilanciamento EUR/Smc"} error={fieldErrors.imbalanceAmount}><input id="cte-imbalanceAmount" type="number" min="0" step="any" value={draft.imbalanceAmount} onChange={(event) => updateDraft("imbalanceAmount", event.target.value)} required /></FormField> : null}
            <FormField id="cte-taxTreatment" label="Trattamento fiscale" error={fieldErrors.taxTreatment}><select id="cte-taxTreatment" value={draft.taxTreatment} onChange={(event) => updateDraft("taxTreatment", event.target.value as CteDraft["taxTreatment"])}><option value="EXCLUDED">Escluso</option><option value="INCLUDED">Incluso</option><option value="NOT_APPLICABLE">Non applicabile</option></select></FormField>
          </div><p className="muted">Riferimento energia: {vector === "EE" ? "PUN" : "PSV"}. Il riferimento opposto non è presente nel contratto.</p></fieldset>
          <details><summary>Anteprima JSON di sola lettura</summary><pre className="safe-pre">{preview ? JSON.stringify(preview, null, 2) : "Anteprima disponibile dopo la verifica del contesto."}</pre></details>
        </form>
      </Card>
    </div>
  </div>;
}

function MarketPanel({ readonly }: { readonly readonly: boolean }) { const [vector,setVector]=useState<UiVector>("EE"); const [json,setJson]=useState('{"vector":"EE","index":"PUN"}'); const pendingRef=useRef<Set<string>>(new Set()); const [pending,setPending]=useState<ReadonlySet<string>>(new Set()); const [records,setRecords]=useState<readonly MarketArchiveModel[]>([]); const [error,setError]=useState<string>(); const [fieldErrors,setFieldErrors]=useState<Readonly<Record<string,string>>>({}); const [message,setMessage]=useState<string>(); const load=useCallback(async()=>{try{const result=await requestJson<{readonly records:readonly MarketArchiveModel[]}>("/api/market/archive");setRecords(result.records);}catch(cause){setError(uiError(cause));}},[]); useEffect(()=>{void load();},[load]); const operationKey=(kind:"create"|"approve"|"reject",record?:MarketArchiveModel)=>kind==="create"?"market:create":"market:"+kind+":"+String(record?.archiveId??"missing"); const busy=(key:string)=>pending.has(key); const recordBusy=(id:string)=>[...pending].some((key)=>key.endsWith(":"+id)); async function action(kind:"create"|"approve"|"reject",record?:MarketArchiveModel){const key=operationKey(kind,record);if(readonly||busy(key)||(record!==undefined&&recordBusy(record.archiveId)))return;let value:Record<string,unknown>|undefined;if(kind==="create"){try{value=parseObject(json);}catch{setFieldErrors({marketRecord:"Inserire un oggetto JSON valido."});return;}} pendingRef.current.add(key);setPending(new Set(pendingRef.current));setError(undefined);setFieldErrors({});try{const body=kind==="create"?{record:value}:kind==="approve"?{decisionId:"decision_ui_"+String(record?.archiveId)}:{reason:"Decisione operativa"};const path=kind==="create"?"/api/market/archive":"/api/market/archive/"+String(record?.archiveId)+"/"+kind;await requestJson(path,{method:"POST",body:JSON.stringify(body)});await load();setMessage("Operazione mercato inviata al server.");}catch(cause){setError(uiError(cause));}finally{pendingRef.current.delete(key);setPending(new Set(pendingRef.current));}} const index=vector==="EE"?"PUN":"PSV"; return <div className="content-stack"><SectionHeader eyebrow="DATI AUTORITATIVI" title="Dati di mercato" detail="PUN solo EE; PSV solo GAS. I dati mancanti non sono sostituiti."/><VectorTabs idPrefix="market" value={vector} onChange={(next)=>{setVector(next);setJson(JSON.stringify({vector:next,index:next==="EE"?"PUN":"PSV"}));setFieldErrors({});}}/><div id="market-panel" role="tabpanel" aria-labelledby={"market-"+vector.toLowerCase()+"-tab"} tabIndex={0}><Card><h3>Record {index}</h3>{records.filter((record)=>record.vector===vector&&record.index===index).map((record)=><div className="data-line" key={record.archiveId}><span>{record.month} v{String(record.record.version??"Non disponibile")}</span><span className="button-row"><button className="button compact" type="button" disabled={readonly||busy(operationKey("approve",record))||recordBusy(record.archiveId)} onClick={()=>void action("approve",record)}>Approva</button><button className="button compact danger" type="button" disabled={readonly||busy(operationKey("reject",record))||recordBusy(record.archiveId)} onClick={()=>void action("reject",record)}>Rifiuta</button></span></div>)}{!records.some((record)=>record.vector===vector&&record.index===index)?<EmptyState title={"Nessun record "+index} detail="Il server non ha restituito dati per questo vettore."/>:null}</Card><Card><form onSubmit={(event)=>{event.preventDefault();void action("create");}}><div className="card-heading"><h3>Crea record {index}</h3><button className="button primary" type="submit" disabled={readonly||busy("market:create")}>{busy("market:create")?"Invio":"Invia"}</button></div><FormField id="market-record" label={"Record mercato "+index} error={fieldErrors.marketRecord}><textarea id="market-record" value={json} onChange={(event)=>{setJson(event.target.value);setFieldErrors({});}} rows={8}/></FormField>{error?<ErrorState message={error}/>:null}{message?<p className="inline-success" role="status">{message}</p>:null}</form></Card></div></div>; }

function initialDraft(vector: UiVector): SimulationDraft { return { vector, calculationDate: new Date().toISOString().slice(0, 10), periodStart: "2026-01-01", periodEnd: "2027-01-01", customerCategory: "NON_RESIDENTIAL", taxTreatment: "EXCLUDED", customerReference: "", supplyReference: "", voltageLevel: "LV", f1: "", f2: "", f3: "", smc: "", correctionRequired: false, correctionCoefficient: "", baseline: "" }; }
function requiredNumber(value: string): number { const parsed = Number(value); if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) throw new Error("FORM_INVALID"); return parsed; }
function simulationPayload(draft: SimulationDraft, tenantId: string): Record<string, unknown> { const common = { schemaVersion: 1, tenantId, calculationDate: draft.calculationDate, supplyPeriod: { periodStart: draft.periodStart, periodEnd: draft.periodEnd }, customerCategory: draft.customerCategory, currency: "EUR", taxTreatment: draft.taxTreatment, customerReference: draft.customerReference, supplyReference: draft.supplyReference, ...(draft.baseline.trim() ? { baseline: { totalCommercialCost: requiredNumber(draft.baseline), currency: "EUR", taxTreatment: draft.taxTreatment, supplyPeriod: { periodStart: draft.periodStart, periodEnd: draft.periodEnd } } } : {}) }; return draft.vector === "EE" ? { ...common, vector: "EE", voltageLevel: draft.voltageLevel, consumption: { basis: "PERIOD", unit: "KWH", f1: requiredNumber(draft.f1), f2: requiredNumber(draft.f2), f3: requiredNumber(draft.f3) } } : { ...common, vector: "GAS", consumption: { basis: "PERIOD", unit: "SMC", smc: requiredNumber(draft.smc), correctionCoefficient: draft.correctionRequired ? { required: true, value: requiredNumber(draft.correctionCoefficient) } : { required: false } } }; }
function validateSimulationDraft(draft: SimulationDraft): Readonly<Record<string,string>> { const errors:Record<string,string>={}; if(!draft.customerReference.trim())errors.customerReference="Inserire l'identificativo cliente."; if(!draft.supplyReference.trim())errors.supplyReference=draft.vector==="EE"?"Inserire il POD o la fornitura.":"Inserire il PDR o la fornitura."; if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(draft.periodStart))errors.periodStart="Inserire una data valida."; if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(draft.periodEnd))errors.periodEnd="Inserire una data valida."; const numeric=(key:string,value:string)=>{if(!value.trim()||!Number.isFinite(Number(value))||Number(value)<0)errors[key]="Inserire un numero non negativo.";}; if(draft.vector==="EE"){numeric("f1",draft.f1);numeric("f2",draft.f2);numeric("f3",draft.f3);}else numeric("smc",draft.smc); return errors; }
function SimulationPanel({ tenantId, readonly, onCalculation, onComparison }: { readonly tenantId: string | null; readonly readonly: boolean; readonly onCalculation: (result: CalculationModel, draft: SimulationDraft) => void; readonly onComparison: (result: ComparisonModel, draft: SimulationDraft) => void }) { const [vector,setVector]=useState<UiVector>("EE"); const [draft,setDraft]=useState<SimulationDraft>(()=>initialDraft("EE")); const [pending,setPending]=useState<"calculation"|"comparison">(); const [error,setError]=useState<string>(); const [fieldErrors,setFieldErrors]=useState<Readonly<Record<string,string>>>({}); async function run(kind:"calculation"|"comparison"){if(readonly||!tenantId||pending)return;const nextErrors=validateSimulationDraft(draft);setFieldErrors(nextErrors);if(Object.keys(nextErrors).length)return;setPending(kind);setError(undefined);try{const result=kind==="calculation"?await requestJson<{readonly result:CalculationModel}>("/api/calculation",{method:"POST",body:JSON.stringify(simulationPayload(draft,tenantId))}):await requestJson<{readonly result:ComparisonModel}>("/api/comparison",{method:"POST",body:JSON.stringify(simulationPayload(draft,tenantId))});if(kind==="calculation")onCalculation(result.result as CalculationModel,draft);else onComparison(result.result as ComparisonModel,draft);}catch(cause){setError(uiError(cause));}finally{setPending(undefined);}} function update<K extends keyof SimulationDraft>(key:K,value:SimulationDraft[K]){setDraft((current)=>({...current,[key]:value}));setFieldErrors((current)=>{const next={...current};delete next[String(key)];return next;});} return <div className="content-stack"><SectionHeader eyebrow="MOTORE PHASE 4" title="Simulazioni" detail="EE e GAS hanno campi distinti; calcolo, confronto, risparmi e ranking arrivano dal server."/><VectorTabs idPrefix="simulation" value={vector} onChange={(next)=>{setVector(next);setDraft(initialDraft(next));setFieldErrors({});setError(undefined);}}/><div id="simulation-panel" role="tabpanel" aria-labelledby={`simulation-${vector.toLowerCase()}-tab`} tabIndex={0}><Card><form onSubmit={(event)=>{event.preventDefault();void run("calculation");}}><div className="form-grid"><FormField id="customer-reference" label="Identificativo cliente" error={fieldErrors.customerReference}><input id="customer-reference" value={draft.customerReference} onChange={(event)=>update("customerReference",event.target.value)} required/></FormField><FormField id="supply-reference" label={vector==="EE"?"POD / fornitura":"PDR / fornitura"} error={fieldErrors.supplyReference}><input id="supply-reference" value={draft.supplyReference} onChange={(event)=>update("supplyReference",event.target.value)} required/></FormField><FormField id="period-start" label="Periodo da" error={fieldErrors.periodStart}><input id="period-start" type="date" value={draft.periodStart} onChange={(event)=>update("periodStart",event.target.value)} required/></FormField><FormField id="period-end" label="Periodo a" error={fieldErrors.periodEnd}><input id="period-end" type="date" value={draft.periodEnd} onChange={(event)=>update("periodEnd",event.target.value)} required/></FormField></div>{vector==="EE"?<div className="form-grid"><FormField id="f1" label="F1 (kWh)" error={fieldErrors.f1}><input id="f1" type="number" min="0" step="any" value={draft.f1} onChange={(event)=>update("f1",event.target.value)} required/></FormField><FormField id="f2" label="F2 (kWh)" error={fieldErrors.f2}><input id="f2" type="number" min="0" step="any" value={draft.f2} onChange={(event)=>update("f2",event.target.value)} required/></FormField><FormField id="f3" label="F3 (kWh)" error={fieldErrors.f3}><input id="f3" type="number" min="0" step="any" value={draft.f3} onChange={(event)=>update("f3",event.target.value)} required/></FormField></div>:<FormField id="smc" label="Consumo GAS (Smc)" error={fieldErrors.smc}><input id="smc" type="number" min="0" step="any" value={draft.smc} onChange={(event)=>update("smc",event.target.value)} required/></FormField>}<div className="button-row"><button className="button primary" type="submit" disabled={readonly||pending==="calculation"}>{pending==="calculation"?"Calcolo":"Esegui calcolo server"}</button><button className="button secondary" type="button" disabled={readonly||pending==="comparison"} onClick={()=>void run("comparison")}>{pending==="comparison"?"Confronto":"Esegui confronto server"}</button></div>{error?<ErrorState message={error}/>:null}</form></Card></div></div>; }

function ResultCards({ calculation, comparison, selectedId, onSelect }: { readonly calculation: CalculationModel | null; readonly comparison: ComparisonModel | null; readonly selectedId: string | null; readonly onSelect: (value: string) => void }) { return <>{calculation ? <Card><h3>Calcolo autorevole</h3><DataLine label="Fingerprint" value={calculation.fingerprint} /><DataLine label="Costo commerciale" value={formatEuro(calculation.totalCommercialCost.
amount)} /><DataLine label="Costo unitario" value={formatNumber(calculation.unitCost.amount, calculation.unitCost.unit)} /></Card> : null}{comparison ? <Card><h3>Confronto autorevole</h3><DataLine label="Fingerprint" value={comparison.fingerprint} /><div className="responsive-table"><table><caption>Ranking restituito dal server</caption><thead><tr><th>Seleziona</th><th>Posizione</th><th>Fornitore</th><th>Offerta</th></tr></thead><tbody>{comparison.ranking.map((entry) => <tr key={entry.calculationId}><td><input type="radio" name="offer" checked={selectedId === entry.calculationId} onChange={() => onSelect(entry.calculationId)} aria-label={`Seleziona ${entry.supplier} ${entry.offerCode}`} /></td><td>{entry.rank}</td><td>{entry.supplier}</td><td>{entry.offerCode}</td></tr>)}</tbody></table></div></Card> : null}</>; }

function isFingerprint(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sameOffer(proposal: ProposalModel["selectedOffer"], selected: CalculationModel["sourceCte"]): boolean { return proposal.archiveId === selected.archiveId && proposal.cteId === selected.cteId && proposal.versionId === selected.versionId && proposal.version === selected.version && proposal.supplier === selected.supplier && proposal.offerCode === selected.offerCode; }
function validateProposalResponse(proposal: ProposalModel, selected: CalculationModel, tenantId: string, expectedRanking: { readonly rank: number; readonly tieGroup: string } | null): void { const selectedResult = proposal.selectedResult; const rankingMatches = expectedRanking === null ? selectedResult.rankingPosition === null && selectedResult.tieGroup === null : selectedResult.rankingPosition === expectedRanking.rank && selectedResult.tieGroup === expectedRanking.tieGroup; if (!isFingerprint(proposal.proposalFingerprint) || !/^proposal_[a-f0-9]{32}$/.test(proposal.proposalId) || proposal.proposalId !== `proposal_${proposal.proposalFingerprint.slice(0, 32)}` || proposal.tenantId !== tenantId || proposal.vector !== selected.vector || proposal.calculationFingerprint !== selected.fingerprint || !isFingerprint(proposal.calculationFingerprint) || !sameOffer(proposal.selectedOffer, selected.sourceCte) || selectedResult.calculationId !== selected.calculationId || selectedResult.calculationFingerprint !== selected.fingerprint || !rankingMatches) throw new Error("PROPOSAL_RESPONSE_INVALID"); }

function ProposalsPanel({ calculation, comparison, selectedId, draft, tenantId, readonly }: { readonly calculation: CalculationModel | null; readonly comparison: ComparisonModel | null; readonly selectedId: string | null; readonly draft: SimulationDraft | null; readonly tenantId: string | null; readonly readonly: boolean }) { const selected=comparison&&selectedId?comparison.results.find((item)=>item.calculationId===selectedId)??null:calculation; const [customerId,setCustomerId]=useState(""); const [supplyId,setSupplyId]=useState(""); const [validFrom,setValidFrom]=useState(""); const [validTo,setValidTo]=useState(""); const [commercialNotes,setCommercialNotes]=useState(""); const [proposal,setProposal]=useState<ProposalModel|null>(null); const [pending,setPending]=useState<"generate"|"JSON"|"CSV"|"HTML">(); const [error,setError]=useState<string>(); const [fieldErrors,setFieldErrors]=useState<Readonly<Record<string,string>>>({}); useEffect(()=>{if(draft){setValidFrom(draft.periodStart);setValidTo(draft.periodEnd);}},[draft]); function validateFields():Readonly<Record<string,string>>{const next:Record<string,string>={};if(!customerId.trim())next.customerId="Inserire l'identificativo cliente.";if(!supplyId.trim())next.supplyId="Inserire il POD o il PDR.";if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(validFrom))next.validFrom="Inserire una data valida.";if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(validTo))next.validTo="Inserire una data valida.";if(commercialNotes.length>1000)next.commercialNotes="La nota e troppo lunga.";return next;} async function generate(event:FormEvent){event.preventDefault();if(readonly||!tenantId||!selected||!draft||pending)return;const nextErrors=validateFields();setFieldErrors(nextErrors);if(Object.keys(nextErrors).length)return;setPending("generate");setError(undefined);const comparisonSource=Boolean(comparison&&selectedId);const selectedOffer={archiveId:selected.sourceCte.archiveId,cteId:selected.sourceCte.cteId,versionId:selected.sourceCte.versionId,version:selected.sourceCte.version,supplier:selected.sourceCte.supplier,offerCode:selected.sourceCte.offerCode};const body={schemaVersion:1,tenantId,sourceType:comparisonSource?"COMPARISON":"CALCULATION",...(comparisonSource?{comparison,selectedCalculationId:selectedId}:{calculation:selected}),selectedOffer,customer:{customerId,category:draft.customerCategory},supply:{supplyId,...(selected.vector==="EE"?{pod:supplyId,voltageLevel:selected.voltageLevel}:{pdr:supplyId})},proposalIssueDate:draft.calculationDate,offerValidity:{periodStart:validFrom,periodEnd:validTo},...(commercialNotes.trim()?{commercialNotes:commercialNotes.trim()}:{}),requestedExportFormat:"JSON"};const expectedRanking=comparisonSource?comparison?.ranking.find((entry)=>entry.calculationId===selected.calculationId)??null:null;try{if(comparisonSource && (!comparison || comparison.tenantId !== tenantId || comparison.vector !== selected.vector || !isFingerprint(comparison.fingerprint) || !comparison.results.some((item) => item.calculationId === selected.calculationId && item.fingerprint === selected.fingerprint) || !expectedRanking)) throw new Error("PROPOSAL_RESPONSE_INVALID");const path=comparisonSource?"/api/proposal/comparison":"/api/proposal";const response=await requestJson<{readonly proposal:ProposalModel}>(path,{method:"POST",body:JSON.stringify(body)});validateProposalResponse(response.proposal,selected,tenantId,expectedRanking);setProposal(response.proposal);}catch(cause){setError(uiError(cause));}finally{setPending(undefined);}} async function exportProposal(format:"JSON"|"CSV"|"HTML"){if(!proposal||pending||readonly)return;setPending(format);setError(undefined);try{await downloadExport("/api/proposal/export/"+format.toLowerCase(),{proposal},format);}catch(cause){setError(uiError(cause));}finally{setPending(undefined);}} return <div className="content-stack"><SectionHeader eyebrow="DOCUMENTO COMMERCIALE" title="Proposte" detail="La proposta e i fingerprint sono restituiti dal servizio autorizzato."/><Card><form onSubmit={generate}><div className="card-heading"><h3>Genera da risultato selezionato</h3><button className="button primary" type="submit" disabled={readonly||!selected||!draft||Boolean(pending)}>{pending==="generate"?"Generazione":"Genera proposta"}</button></div><div className="form-grid"><FormField id="proposal-customer" label="Identificativo cliente" error={fieldErrors.customerId}><input id="proposal-customer" value={customerId} onChange={(event)=>{setCustomerId(event.target.value);setFieldErrors((current)=>{const next={...current};delete next.customerId;return next;});}} required/></FormField><FormField id="proposal-supply" label="POD / PDR" error={fieldErrors.supplyId}><input id="proposal-supply" value={supplyId} onChange={(event)=>{setSupplyId(event.target.value);setFieldErrors((current)=>{const next={...current};delete next.supplyId;return next;});}} required/></FormField><FormField id="proposal-valid-from" label="Validita da" error={fieldErrors.validFrom}><input id="proposal-valid-from" type="date" value={validFrom} onChange={(event)=>setValidFrom(event.target.value)} required/></FormField><FormField id="proposal-valid-to" label="Validita a" error={fieldErrors.validTo}><input id="proposal-valid-to" type="date" value={validTo} onChange={(event)=>setValidTo(event.target.value)} required/></FormField></div><FormField id="proposal-notes" label="Note commerciali" error={fieldErrors.commercialNotes}><textarea id="proposal-notes" value={commercialNotes} onChange={(event)=>setCommercialNotes(event.target.value)} maxLength={1000} rows={4}/></FormField>{error?<ErrorState message={error}/>:null}</form></Card>{proposal?<Card><div className="card-heading"><h3>Proposta {proposal.proposalId}</h3><div className="button-row"><button className="button secondary" type="button" disabled={pending==="JSON"} onClick={()=>void exportProposal("JSON")}>JSON</button><button className="button secondary" type="button" disabled={pending==="CSV"} onClick={()=>void exportProposal("CSV")}>CSV</button><button className="button secondary" type="button" disabled={pending==="HTML"} onClick={()=>void exportProposal("HTML")}>HTML</button></div></div><DataLine label="Fingerprint proposta" value={proposal.proposalFingerprint}/><DataLine label="Costo" value={formatEuro(proposal.commercialCost.amount)}/></Card>:<EmptyState title="Nessuna proposta" detail="Genera da un calcolo o confronto restituito dal server."/>}</div>; }

function SystemPanel({ context, readiness, onReload }: { readonly context: VerifiedContextModel | null; readonly readiness: ReadinessModel | null; readonly onReload: () => void }) { return <div className="content-stack"><SectionHeader eyebrow="OPERATIONS" title="Stato sistema" detail="Readiness e contesto verificato, senza segreti o internals." action={<button className="button secondary" type="button" onClick={onReload}>Aggiorna stato</button>} /><Card><div className="data-list"><DataLine label="Autenticazione" value={context?.authenticated ? "Autenticata" : "Non autenticata"} /><DataLine label="Ruolo" value={context?.role ?? "Non disponibile"} /><DataLine label="Tenant" value={context?.tenantId ?? "Non disponibile"} /><DataLine label="Runtime" value={readiness?.runtimeMode ?? "Non disponibile"} /><DataLine label="Readiness" value={readiness?.readiness ? "Pronta" : "Bloccata"} /></div></Card></div>; }

void CtePanel;

export default function OperationalShell() {
  const [section, setSection] = useState<SectionId>("dashboard"); const [context, setContext] = useState<VerifiedContextModel | null>(null); const [contextState, setContextState] = useState<LoadState>("loading"); const [readiness, setReadiness] = useState<ReadinessModel | null>(null); const [readinessState, setReadinessState] = useState<LoadState>("loading"); const [calculation, setCalculation] = useState<CalculationModel | null>(null); const [comparison, setComparison] = useState<ComparisonModel | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [draft, setDraft] = useState<SimulationDraft | null>(null);
  const loadContext = useCallback(async (signal?: AbortSignal) => { setContextState("loading"); try { const result = await requestJson<VerifiedContextModel>("/api/foundation/context", {}, signal); if (!result.authenticated || !result.role || !result.tenantId) throw new Error("CONTEXT_INVALID"); setContext(result); setContextState("ready"); } catch { if (!signal?.aborted) { setContext(null); setContextState("error"); } } }, []); const loadReadiness = useCallback(async (signal?: AbortSignal) => { setReadinessState("loading"); try { setReadiness(await requestJson<ReadinessModel>("/api/health/readiness", {}, signal)); setReadinessState("ready"); } catch { if (!signal?.aborted) setReadinessState("error"); } }, []); useEffect(() => { const controller = new AbortController(); void loadContext(controller.signal); void loadReadiness(controller.signal); return () => controller.abort(); }, [loadContext, loadReadiness]);
  const canWrite = contextState === "ready" && readinessState === "ready" && Boolean(context?.authenticated && context.role && context.role !== ("VIEWER" satisfies UiRole) && context.readiness.readiness && readiness?.readiness); const readonly = !canWrite; const tenantId = context?.tenantId ?? null;
  function onCalculation(result: CalculationModel, value: SimulationDraft) { setCalculation(result); setComparison(null); setSelectedId(result.calculationId); setDraft(value); } function onComparison(result: ComparisonModel, value: SimulationDraft) { setComparison(result); setCalculation(null); setSelectedId(result.ranking[0]?.calculationId ?? null); setDraft(value); }
  return <div className="operational-app"><a className="skip-link" href="#main-content">Vai al contenuto</a><header className="app-header"><div className="brand-lockup"><div className="brand-mark" aria-hidden="true">E</div><div><p className="eyebrow">FOUNDATION V1  OPERATIONS</p><h1>Energia Operativa</h1></div></div><div className="header-context"><span className="mode-pill">{context?.authSource === "LOCAL_SYNTHETIC" ? "Locale sintetico esplicito" : context?.runtimeMode === "production" ? "Production" : "Contesto non disponibile"}</span><span className="mode-pill">{context?.role ?? "Sola lettura"}</span></div></header><div className="app-layout"><aside className="app-sidebar"><nav aria-label="Navigazione principale"><p className="nav-title">Aree operative</p>{sections.map((item) => <button key={item.id} className={section === item.id ? "nav-item active" : "nav-item"} type="button" onClick={() => setSection(item.id)} aria-current={section === item.id ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{item.short}</span><span>{item.label}</span></button>)}</nav><div className="sidebar-note"><strong>{readonly ? "Vista sola lettura" : "Azioni operative"}</strong><span>Ruoli, tenant e permessi restano server-authoritative.</span></div></aside><main id="main-content" className="app-main" tabIndex={-1}>{section === "dashboard" ? <DashboardPanel context={context} readiness={readiness} readinessState={readinessState} /> : null}{section === "bills" ? <BillsPanel readonly={readonly} /> : null}{section === "cte" ? <CteIngestionPanel readonly={readonly} /> : null}{section === "market" ? <MarketPanel readonly={readonly} /> : null}{section === "simulations" ? <><SimulationPanel tenantId={tenantId} readonly={readonly} onCalculation={onCalculation} onComparison={onComparison} /><ResultCards calculation={calculation} comparison={comparison} selectedId={selectedId} onSelect={setSelectedId} /></> : null}{section === "proposals" ? <ProposalsPanel calculation={calculation} comparison={comparison} selectedId={selectedId} draft={draft} tenantId={tenantId} readonly={readonly} /> : null}{section === "system" ? <SystemPanel context={context} readiness={readiness} onReload={() => { void loadContext(); void loadReadiness(); }} /> : null}</main></div><footer className="app-footer"><span>Dati authoritative o esplicitamente non disponibili</span><span>Nessun token o segreto persistito nel browser</span></footer></div>;
}
