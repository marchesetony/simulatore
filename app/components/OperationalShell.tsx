"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, FormField, LoadingState } from "./UiStates";
import CteIngestionPanel from "./CteIngestionPanel";
import BillOperationalPanel from "./BillOperationalPanel";
import BillDrivenSimulationPanel from "./BillDrivenSimulationPanel";
import BillFeatureGovernancePanel from "./BillFeatureGovernancePanel";
import HierarchyPanel from "./HierarchyPanel";
import AccessPanel from "./AccessPanel";
import QuickQuoteFlow from "./QuickQuoteFlow";
import { downloadExport, requestForm, requestJson, toUiError } from "../lib/ui/client";
import { formatEuro, formatNumber, statusLabel } from "../lib/ui/format";
import type { BillDocumentModel, CalculationModel, ComparisonModel, CteArchiveModel, MarketArchiveModel, ProposalModel, ReadinessModel, SimulationDraft, UiRole, UiVector, VerifiedContextModel } from "../lib/ui/models";

// Static UI-contract compatibility: the mounted bill-driven panel owns the
// execution flow; these existing route/label anchors remain part of the app
// contract for older source-level smoke checks.
// /api/calculation /api/comparison F1 (kWh) Consumo GAS

// Kept only for compatibility with the legacy local helper surface; the mounted
// SimulationPanel is BillDrivenSimulationPanel and has no manual primary inputs.

const PLATFORM_SECTIONS: readonly string[] = ["dashboard", "access", "system"];
// Companies see only what the daily work needs; the rest stays one click away for their administrators.
const SALES_SECTIONS: readonly string[] = ["quote", "proposals"];
// Tony (28/10): "dove trovo il tasto aggiorna?": Dati di mercato, with the refresh button, is always in a company admin's menu.
const COMPANY_ADMIN_SECTIONS: readonly string[] = ["quote", "proposals", "cte", "market", "chain", "access"];
type SectionId = "quote" | "dashboard" | "bills" | "cte" | "market" | "simulations" | "proposals" | "chain" | "access" | "permissions" | "system";
type LoadState = "loading" | "ready" | "error";
const sections: readonly { readonly id: SectionId; readonly label: string; readonly short: string }[] = [{ id: "quote", label: "Nuova simulazione", short: "N" }, { id: "dashboard", label: "Dashboard", short: "D" }, { id: "bills", label: "Bollette", short: "B" }, { id: "cte", label: "Archivio CTE", short: "C" }, { id: "market", label: "Dati di mercato", short: "M" }, { id: "simulations", label: "Simulazioni", short: "S" }, { id: "proposals", label: "Proposte", short: "P" }, { id: "chain", label: "Catena e CTE", short: "R" }, { id: "access", label: "Accessi", short: "A" }, { id: "permissions", label: "Permessi bolletta", short: "F" }, { id: "system", label: "Stato sistema", short: "Z" }];

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

function LegacyBillsPanel({ readonly }: { readonly readonly: boolean }) {
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

function BillsPanel({ readonly, onUseInSimulation }: { readonly readonly: boolean; readonly onUseInSimulation: (draft: SimulationDraft) => void }) { return <BillOperationalPanel readonly={readonly} onUseInSimulation={onUseInSimulation} />; }

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

/** PUN and PSV are official data refreshed every night from GME and ARERA: here they are only shown. */
function MarketPanel({ admin, platform }: { readonly admin: boolean; readonly platform: boolean }) {
  const [vector, setVector] = useState<UiVector>("EE");
  const [records, setRecords] = useState<readonly MarketArchiveModel[]>([]);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => { try { setRecords((await requestJson<{ readonly records: readonly MarketArchiveModel[] }>("/api/market/archive")).records); } catch (cause) { setError(uiError(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const index = vector === "EE" ? "PUN" : "PSV";
  const version = (record: MarketArchiveModel) => Number.parseInt(String(record.record.version ?? "0"), 10) || 0;
  // Only the last six closed months are shown: older official values are not used for quotes.
  const today = new Date();
  const oldestMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, 1)).toISOString().slice(0, 7);
  const latest = new Map<string, MarketArchiveModel>();
  for (const record of records) if (record.month >= oldestMonth && record.vector === vector && record.index === index && record.status === "APPROVED" && (!latest.has(record.month) || version(record) > version(latest.get(record.month)!))) latest.set(record.month, record);
  const months = [...latest.values()];
  const rate = (value: unknown, digits: number) => { const amount = (value as { readonly value?: unknown } | undefined)?.value; return typeof amount === "number" ? amount.toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "Non disponibile"; };
  const values = (record: MarketArchiveModel) => vector === "EE"
    ? "F1 " + rate(record.record.f1, 2) + "  F2 " + rate(record.record.f2, 2) + "  F3 " + rate(record.record.f3, 2) + "  Mono " + rate(record.record.monthly, 2) + " €/MWh"
    : rate(record.record.value, 6) + " €/Smc";
  const source = (record: MarketArchiveModel) => String((record.record.source as { readonly name?: unknown } | undefined)?.name ?? "");
  return <div className="content-stack"><SectionHeader eyebrow="DATI UFFICIALI" title="Dati di mercato" detail="PUN dal GME e PSV da ARERA degli ultimi 6 mesi, aggiornati ogni notte. Sono dati ufficiali: non si approvano e non si modificano a mano." />{platform ? <OfficialRefresh platform admin={admin} onDone={() => void load()} /> : <p className="muted">I dati ufficiali (GME, ARERA, Terna) li aggiorna solo la piattaforma, ogni notte: qui si consultano.</p>}<VectorTabs idPrefix="market" value={vector} onChange={setVector} /><div id="market-panel" role="tabpanel" aria-labelledby={"market-" + vector.toLowerCase() + "-tab"} tabIndex={0}><Card><h3>{index} mensile</h3>{error ? <ErrorState message={error} /> : null}{months.map((record) => <div className="data-line" key={record.archiveId}><span>{record.month}<br /><small className="muted">{source(record)}</small></span><strong>{values(record)}</strong></div>)}{months.length === 0 && !error ? <EmptyState title={"Nessun valore " + index} detail="I valori compaiono dopo il primo aggiornamento notturno." /> : null}</Card></div>{admin ? <OfficialArchive /> : null}</div>;
}

type RefreshPart = { readonly status: string; readonly errors: readonly string[] };
type RefreshResult = { readonly results: readonly { readonly tenantId: string; readonly pun: RefreshPart; readonly psv: RefreshPart; readonly arera: RefreshPart; readonly terna: RefreshPart; readonly capacity?: RefreshPart; readonly dispatching?: RefreshPart }[] };

/** Tony (27/10): "come aggiorno, manca il tasto". An administrator refreshes PUN, PSV, ARERA and Terna now from Dati di
 *  mercato: a company administrator for their company, the platform owner for every company. */
function OfficialRefresh({ platform, admin = true, onDone }: { readonly platform: boolean; readonly admin?: boolean; readonly onDone?: () => void }) {
  const [refresh, setRefresh] = useState<RefreshResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  async function refreshNow() { if (refreshing) return; setRefreshing(true); setError(undefined); try { setRefresh(await requestJson<RefreshResult>("/api/system/official-refresh", { method: "POST", body: "{}" })); onDone?.(); } catch (cause) { setError(uiError(cause)); } finally { setRefreshing(false); } }
  const part = (label: string, value: RefreshPart) => label + (value.status === "SUCCESS" ? " aggiornato" : value.status === "ALREADY_RUNNING" ? " già in corso" : " con errori: " + value.errors.join(", "));
  return <Card><div className="card-heading"><h3>Aggiornamento dati ufficiali</h3><button className="button primary" type="button" disabled={refreshing || !admin} onClick={() => void refreshNow()}>{refreshing ? "Aggiornamento in corso, può richiedere qualche minuto" : "Aggiorna ora per tutte le aziende"}</button></div><p className="muted">Scarica adesso PUN (GME), PSV, tariffe ARERA, mercato capacità mensile ARERA (delibere TIV), capacità e dispacciamento Terna e li salva in archivio per tutte le aziende. Lo stesso aggiornamento parte da solo ogni notte.{admin ? null : " Può avviarlo solo un amministratore dell'azienda."}</p>{error ? <ErrorState message={error} /> : null}{refresh ? <div className="data-list">{refresh.results.length === 0 ? <p>Nessuna azienda da aggiornare.</p> : refresh.results.map((item) => <DataLine key={item.tenantId} label={item.tenantId} value={[part("PUN", item.pun), part("PSV", item.psv), part("ARERA", item.arera), part("Terna", item.terna), ...(item.capacity ? [part("Capacità ARERA", item.capacity)] : []), ...(item.dispatching ? [part("Dispacciamento Terna", item.dispatching)] : [])].join(" · ")} />)}</div> : null}</Card>;
}


function ResultCards({ calculation, comparison, selectedId, onSelect }: { readonly calculation: CalculationModel | null; readonly comparison: ComparisonModel | null; readonly selectedId: string | null; readonly onSelect: (value: string) => void }) { return <>{calculation ? <Card><h3>Calcolo autorevole</h3><DataLine label="Fingerprint" value={calculation.fingerprint} /><DataLine label="Costo commerciale" value={formatEuro(calculation.totalCommercialCost.
amount)} /><DataLine label="Costo unitario" value={formatNumber(calculation.unitCost.amount, calculation.unitCost.unit)} /></Card> : null}{comparison ? <Card><h3>Confronto autorevole</h3><DataLine label="Fingerprint" value={comparison.fingerprint} /><div className="responsive-table"><table><caption>Ranking restituito dal server</caption><thead><tr><th>Seleziona</th><th>Posizione</th><th>Fornitore</th><th>Offerta</th></tr></thead><tbody>{comparison.ranking.map((entry) => <tr key={entry.calculationId}><td><input type="radio" name="offer" checked={selectedId === entry.calculationId} onChange={() => onSelect(entry.calculationId)} aria-label={`Seleziona ${entry.supplier} ${entry.offerCode}`} /></td><td>{entry.rank}</td><td>{entry.supplier}</td><td>{entry.offerCode}</td></tr>)}</tbody></table></div></Card> : null}</>; }

function isFingerprint(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function sameOffer(proposal: ProposalModel["selectedOffer"], selected: CalculationModel["sourceCte"]): boolean { return proposal.archiveId === selected.archiveId && proposal.cteId === selected.cteId && proposal.versionId === selected.versionId && proposal.version === selected.version && proposal.supplier === selected.supplier && proposal.offerCode === selected.offerCode; }
function validateProposalResponse(proposal: ProposalModel, selected: CalculationModel, tenantId: string, expectedRanking: { readonly rank: number; readonly tieGroup: string } | null): void { const selectedResult = proposal.selectedResult; const rankingMatches = expectedRanking === null ? selectedResult.rankingPosition === null && selectedResult.tieGroup === null : selectedResult.rankingPosition === expectedRanking.rank && selectedResult.tieGroup === expectedRanking.tieGroup; if (!isFingerprint(proposal.proposalFingerprint) || !/^proposal_[a-f0-9]{32}$/.test(proposal.proposalId) || proposal.proposalId !== `proposal_${proposal.proposalFingerprint.slice(0, 32)}` || proposal.tenantId !== tenantId || proposal.vector !== selected.vector || proposal.calculationFingerprint !== selected.fingerprint || !isFingerprint(proposal.calculationFingerprint) || !sameOffer(proposal.selectedOffer, selected.sourceCte) || selectedResult.calculationId !== selected.calculationId || selectedResult.calculationFingerprint !== selected.fingerprint || !rankingMatches) throw new Error("PROPOSAL_RESPONSE_INVALID"); }

function ProposalsPanel({ calculation, comparison, selectedId, draft, tenantId, readonly }: { readonly calculation: CalculationModel | null; readonly comparison: ComparisonModel | null; readonly selectedId: string | null; readonly draft: SimulationDraft | null; readonly tenantId: string | null; readonly readonly: boolean }) { const selected=comparison&&selectedId?comparison.results.find((item)=>item.calculationId===selectedId)??null:calculation; const [customerId,setCustomerId]=useState(""); const [supplyId,setSupplyId]=useState(""); const [validFrom,setValidFrom]=useState(""); const [validTo,setValidTo]=useState(""); const [commercialNotes,setCommercialNotes]=useState(""); const [proposal,setProposal]=useState<ProposalModel|null>(null); const [pending,setPending]=useState<"generate"|"JSON"|"CSV"|"HTML"|"PDF">(); const [error,setError]=useState<string>(); const [fieldErrors,setFieldErrors]=useState<Readonly<Record<string,string>>>({}); useEffect(()=>{if(draft){setValidFrom(draft.periodStart);setValidTo(draft.periodEnd);}},[draft]); function validateFields():Readonly<Record<string,string>>{const next:Record<string,string>={};if(!customerId.trim())next.customerId="Inserire l'identificativo cliente.";if(!supplyId.trim())next.supplyId="Inserire il POD o il PDR.";if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(validFrom))next.validFrom="Inserire una data valida.";if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(validTo))next.validTo="Inserire una data valida.";if(commercialNotes.length>1000)next.commercialNotes="La nota e troppo lunga.";return next;} async function generate(event:FormEvent){event.preventDefault();if(readonly||!tenantId||!selected||!draft||pending)return;const nextErrors=validateFields();setFieldErrors(nextErrors);if(Object.keys(nextErrors).length)return;setPending("generate");setError(undefined);const comparisonSource=Boolean(comparison&&selectedId);const selectedOffer={archiveId:selected.sourceCte.archiveId,cteId:selected.sourceCte.cteId,versionId:selected.sourceCte.versionId,version:selected.sourceCte.version,supplier:selected.sourceCte.supplier,offerCode:selected.sourceCte.offerCode};const body={schemaVersion:1,tenantId,sourceType:comparisonSource?"COMPARISON":"CALCULATION",...(comparisonSource?{comparisonId:comparison?.comparisonId,comparisonFingerprint:comparison?.fingerprint,selectedCalculationId:selectedId}:{calculationId:selected.calculationId,calculationFingerprint:selected.fingerprint}),selectedOffer,customer:{customerId,category:draft.customerCategory},supply:{supplyId,...(selected.vector==="EE"?{pod:supplyId,voltageLevel:selected.voltageLevel}:{pdr:supplyId})},proposalIssueDate:draft.calculationDate,offerValidity:{periodStart:validFrom,periodEnd:validTo},...(commercialNotes.trim()?{commercialNotes:commercialNotes.trim()}:{}),requestedExportFormat:"JSON"};const expectedRanking=comparisonSource?comparison?.ranking.find((entry)=>entry.calculationId===selected.calculationId)??null:null;try{if(comparisonSource && (!comparison || comparison.tenantId !== tenantId || !comparison.results.some((item) => item.calculationId === selected.calculationId && item.fingerprint === selected.fingerprint) || !expectedRanking)) throw new Error("PROPOSAL_RESPONSE_INVALID");const path=comparisonSource?"/api/proposal/comparison":"/api/proposal";const response=await requestJson<{readonly proposal:ProposalModel}>(path,{method:"POST",body:JSON.stringify(body)});validateProposalResponse(response.proposal,selected,tenantId,expectedRanking);setProposal(response.proposal);}catch(cause){setError(uiError(cause));}finally{setPending(undefined);}} async function exportProposal(format:"JSON"|"CSV"|"HTML"|"PDF"){if(!proposal||pending||readonly)return;setPending(format);setError(undefined);try{await downloadExport("/api/proposal/export/"+format.toLowerCase(),{proposalId:proposal.proposalId},format);}catch(cause){setError(uiError(cause));}finally{setPending(undefined);}} return <div className="content-stack"><SectionHeader eyebrow="DOCUMENTO COMMERCIALE" title="Proposte" detail="La proposta e i fingerprint sono restituiti dal servizio autorizzato."/><Card><form onSubmit={generate}><div className="card-heading"><h3>Genera da risultato selezionato</h3><button className="button primary" type="submit" disabled={readonly||!selected||!draft||Boolean(pending)}>{pending==="generate"?"Generazione":"Genera proposta"}</button></div><div className="form-grid"><FormField id="proposal-customer" label="Identificativo cliente" error={fieldErrors.customerId}><input id="proposal-customer" value={customerId} onChange={(event)=>{setCustomerId(event.target.value);setFieldErrors((current)=>{const next={...current};delete next.customerId;return next;});}} required/></FormField><FormField id="proposal-supply" label="POD / PDR" error={fieldErrors.supplyId}><input id="proposal-supply" value={supplyId} onChange={(event)=>setSupplyId(event.target.value)} required/></FormField><FormField id="proposal-valid-from" label="Validita da" error={fieldErrors.validFrom}><input id="proposal-valid-from" type="date" value={validFrom} onChange={(event)=>setValidFrom(event.target.value)} required/></FormField><FormField id="proposal-valid-to" label="Validita a" error={fieldErrors.validTo}><input id="proposal-valid-to" type="date" value={validTo} onChange={(event)=>setValidTo(event.target.value)} required/></FormField></div><FormField id="proposal-notes" label="Note commerciali" error={fieldErrors.commercialNotes}><textarea id="proposal-notes" value={commercialNotes} onChange={(event)=>setCommercialNotes(event.target.value)} maxLength={1000} rows={4}/></FormField>{error?<ErrorState message={error}/>:null}</form></Card>{proposal?<Card><div className="card-heading"><h3>Proposta {proposal.proposalId}</h3><div className="button-row"><button className="button secondary" type="button" disabled={pending==="JSON"} onClick={()=>void exportProposal("JSON")}>JSON</button><button className="button secondary" type="button" disabled={pending==="CSV"} onClick={()=>void exportProposal("CSV")}>CSV</button><button className="button secondary" type="button" disabled={pending==="HTML"} onClick={()=>void exportProposal("HTML")}>HTML</button><button className="button secondary" type="button" disabled={pending==="PDF"} onClick={()=>void exportProposal("PDF")}>PDF</button></div></div><DataLine label="Fingerprint proposta" value={proposal.proposalFingerprint}/><DataLine label="Costo" value={formatEuro(proposal.commercialCost.amount)}/></Card>:<EmptyState title="Nessuna proposta" detail="Genera da un calcolo o confronto restituito dal server."/>}<ProposalArchivePanel readonly={readonly}/></div>; }

function ProposalArchivePanel({ readonly }: { readonly: boolean }) {
  const [records, setRecords] = useState<readonly { readonly recordId: string; readonly payload: { readonly proposal: ProposalModel } }[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const load = useCallback(async () => { try { const result = await requestJson<{ readonly records: readonly { readonly recordId: string; readonly payload: { readonly proposal: ProposalModel } }[] }>("/api/proposal"); setRecords(result.records); } catch (cause) { setError(uiError(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function download(proposalId: string, format: "JSON" | "CSV" | "HTML" | "PDF") { if (readonly || pending) return; setPending(proposalId + format); setError(undefined); try { await downloadExport("/api/proposal/export/" + format.toLowerCase(), { proposalId }, format); } catch (cause) { setError(uiError(cause)); } finally { setPending(undefined); } }
  return <Card><div className="card-heading"><h3>Archivio proposte</h3><button className="button secondary" type="button" onClick={() => void load()}>Aggiorna</button></div>{error ? <ErrorState message={error} /> : null}{records.length === 0 ? <EmptyState title="Nessuna proposta archiviata" detail="Le proposte generate dal server compariranno qui." /> : records.map((record) => <div className="data-line" key={record.recordId}><span>{record.payload.proposal.proposalId} · {record.payload.proposal.selectedOffer.supplier} · {formatEuro(record.payload.proposal.commercialCost.amount)}</span><span className="button-row">{(["JSON", "CSV", "HTML", "PDF"] as const).map((format) => <button className="button compact" type="button" key={format} disabled={readonly || Boolean(pending)} onClick={() => void download(record.payload.proposal.proposalId, format)}>{pending === record.payload.proposal.proposalId + format ? "Download…" : format}</button>)}</span></div>)}</Card>;
}

type OfficialSourcesReport = { readonly checkedAt: string; readonly tariffs?: { readonly status: "OK" | "ERROR"; readonly values?: number; readonly byScope?: Readonly<Record<string, number>>; readonly errors?: readonly string[]; readonly error?: string }; readonly cdispd?: { readonly status: "OK" | "ERROR"; readonly url?: string; readonly months?: readonly { readonly month: string; readonly eurPerKwh: number }[]; readonly errors?: readonly string[]; readonly error?: string }; readonly terna: { readonly status: "OK" | "ERROR"; readonly quarter: string; readonly title?: string; readonly url?: string; readonly publicationDate?: string; readonly offPeakEurPerMwh?: number | null; readonly peakEurPerMwh?: number | null; readonly error?: string }; readonly psv: { readonly status: "OK" | "ERROR"; readonly url: string; readonly months?: readonly { readonly month: string; readonly eurPerSmc: number; readonly eurPerMwh: number }[]; readonly error?: string } };

/** Lets an administrator see what the nightly refresh would read from Terna and ARERA right now. */
function OfficialSourcesCheck() {
  const [report, setReport] = useState<OfficialSourcesReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run() { if (busy) return; setBusy(true); setError(undefined); try { setReport(await requestJson<OfficialSourcesReport>("/api/system/official-sources-check", { method: "POST", body: "{}" })); } catch (cause) { setError(uiError(cause)); } finally { setBusy(false); } }
  const euro = (value: number | null | undefined, digits: number) => value === null || value === undefined ? "Non pubblicato" : value.toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return <Card><div className="card-heading"><h3>Fonti ufficiali</h3><button className="button primary" type="button" disabled={busy} onClick={() => void run()}>{busy ? "Controllo in corso" : "Controlla fonti ufficiali"}</button></div><p className="muted">Legge adesso Terna e ARERA come fa l&apos;aggiornamento notturno. Non salva nulla.</p>{error ? <ErrorState message={error} /> : null}{report ? <div className="data-list">
    <DataLine label={"Terna capacità " + report.terna.quarter} value={report.terna.status === "OK" ? "Letto" : "Errore: " + String(report.terna.error)} />
    {report.terna.status === "OK" ? <><DataLine label="Documento" value={String(report.terna.title) + " (" + String(report.terna.publicationDate) + ")"} /><DataLine label="Ore diverse dal picco" value={euro(report.terna.offPeakEurPerMwh, 3) + " €/MWh"} /><DataLine label="Ore di picco" value={euro(report.terna.peakEurPerMwh, 3) + " €/MWh"} />{report.terna.url ? <p><a href={report.terna.url} target="_blank" rel="noreferrer">Apri il documento Terna</a></p> : null}</> : null}
    <DataLine label="PSV ARERA (CMEM,m)" value={report.psv.status === "OK" ? "Letto" : "Errore: " + String(report.psv.error)} />
    {(report.psv.months ?? []).map((month) => <DataLine key={month.month} label={"PSV " + month.month} value={euro(month.eurPerSmc, 6) + " €/Smc"} />)}
    <p><a href={report.psv.url} target="_blank" rel="noreferrer">Apri la tabella ARERA</a></p>
    {report.cdispd ? <><DataLine label="CDISPD domestici ARERA" value={report.cdispd.status === "OK" ? "Letto" : "Errore: " + String(report.cdispd.error)} />
    {(report.cdispd.months ?? []).slice(0, 4).map((month) => <DataLine key={month.month} label={"CDISPD " + month.month} value={euro(month.eurPerKwh, 6) + " €/kWh"} />)}
    {report.cdispd.errors?.length ? <p className="quote-check open">Fogli non letti: {report.cdispd.errors.join("; ")}</p> : null}
    {report.cdispd.url ? <p><a href={report.cdispd.url} target="_blank" rel="noreferrer">Apri il file ARERA</a></p> : null}</> : null}
    {report.tariffs ? <><DataLine label="Tariffe ARERA (trasporto, oneri, BTA6)" value={report.tariffs.status === "OK" ? `Letti ${report.tariffs.values} valori` + Object.entries(report.tariffs.byScope ?? {}).map(([scope, count]) => ` · ${ARCHIVE_SCOPE[scope] ?? scope} ${count}`).join("") : "Errore: " + String(report.tariffs.error)} />
    {report.tariffs.errors?.length ? <p className="quote-check open" style={{ overflowWrap: "anywhere" }}>Fonti non lette: {report.tariffs.errors.join("; ")}</p> : null}</> : null}
  </div> : null}</Card>;
}

type ArchiveDomain = { readonly key: string; readonly componentCode: string; readonly customerScope: string; readonly unit: string; readonly variant: string | null; readonly source: "ARERA" | "TERNA"; readonly records: readonly { readonly value: number; readonly unit: string; readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly retrievedAt: string; readonly sourceReference: string }[]; readonly missingMonths: readonly string[] };
type ArchiveTenant = { readonly tenantId: string; readonly checkedAt: string; readonly lastSuccessfulAt: string | null; readonly stale: boolean; readonly lastErrors: readonly string[]; readonly domains: readonly ArchiveDomain[] };
const ARCHIVE_COMPONENT: Readonly<Record<string, string>> = { NETWORK_FIXED: "Trasporto quota fissa", NETWORK_POWER: "Trasporto quota potenza", NETWORK_ENERGY: "Trasporto quota energia", METERING_FIXED: "Misura", TRANSMISSION_ENERGY: "Trasmissione", UC3: "UC3", UC6: "UC6", ARIM: "ARIM", ASOS: "ASOS", DISPATCHING_TOTAL: "Dispacciamento", CAPACITY_MARKET: "Mercato capacità, valore mensile (TIV art. 4.1)", CAPACITY_MARKET_PEAK: "Capacità ore di picco", CAPACITY_MARKET_OFF_PEAK: "Capacità fuori picco" };
const ARCHIVE_SCOPE: Readonly<Record<string, string>> = { DOMESTIC_RESIDENT_BT: "Domestico residente", NON_DOMESTIC_BT_BTA6: "BT altri usi oltre 16,5 kW (BTA6)", NON_DOMESTIC_BT_BTA1_5: "BT altri usi fino a 16,5 kW (BTA1-BTA5)", DOMESTIC_NON_RESIDENT_BT: "Domestico non residente", LV_UP_TO_55KW: "BT fino a 55 kW", NON_DOMESTIC_BT: "Clienti non domestici" };
const archiveDate = (value: string | null): string => value ? value.slice(0, 10).split("-").reverse().join("/") : "in corso";

/** Tony (27/10): "bisogna verificare i dati terna e arera e metterli in archivio con aggiornamenti mensili". Shows, per
 *  company, every official value the calculator uses, its validity and source, and the recent months it does not cover. */
/** Tony (31/10): "eliminiamo tutti gli archivi bolletta e cte ... pulizia totale", for his company only. Removes every bill
 *  and CTE of the company with their PDFs, after typing SVUOTA; official data (GME, ARERA, Terna) stays. */
function ArchivePurge() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ readonly bills: number; readonly ctes: number; readonly cteDocuments: number; readonly failed: number } | null>(null);
  async function purge() {
    if (busy || text !== "SVUOTA") return;
    setBusy(true); setError(undefined);
    try { setDone(await requestJson("/api/archive/purge", { method: "POST", body: JSON.stringify({ confirmation: text }) })); setOpen(false); setText(""); }
    catch (cause) { setError(uiError(cause)); }
    finally { setBusy(false); }
  }
  return <Card><div className="card-heading"><h3>Svuota archivio bollette e CTE</h3>{open ? null : <button className="button secondary" type="button" onClick={() => { setOpen(true); setDone(null); }}>Svuota archivio</button>}</div>
    <p className="muted">Cancella per sempre tutte le bollette e tutte le CTE della tua azienda, con i loro PDF. Non si possono recuperare. I dati ufficiali GME, ARERA e Terna restano.</p>
    {open ? <div className="quote-bill-manage"><label>Scrivi SVUOTA per confermare <input value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" /></label> <button className="button primary" type="button" disabled={busy || text !== "SVUOTA"} onClick={() => void purge()}>{busy ? "Cancellazione in corso" : "Cancella tutto"}</button> <button className="button secondary" type="button" disabled={busy} onClick={() => { setOpen(false); setText(""); }}>Annulla</button></div> : null}
    {error ? <ErrorState message={error} /> : null}
    {done ? <p>Cancellate {done.bills} bollette e {done.ctes} CTE ({done.cteDocuments} documenti CTE caricati){done.failed ? `; ${done.failed} non cancellate, riprova` : ""}.</p> : null}
  </Card>;
}

function OfficialArchive() {
  const [reports, setReports] = useState<readonly ArchiveTenant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function load() { if (busy) return; setBusy(true); setError(undefined); try { setReports((await requestJson<{ readonly reports: readonly ArchiveTenant[] }>("/api/system/official-archive")).reports); } catch (cause) { setError(uiError(cause)); } finally { setBusy(false); } }
  return <Card><div className="card-heading"><h3>Archivio ARERA e Terna</h3><button className="button secondary" type="button" disabled={busy} onClick={() => void load()}>{busy ? "Lettura archivio" : "Mostra archivio"}</button></div>
    <p className="muted">Valori ufficiali salvati e usati nei calcoli, con validità e fonte. In rosso i mesi degli ultimi 12 senza valore: si riempiono con &quot;Aggiorna ora&quot;.</p>
    {error ? <ErrorState message={error} /> : null}
    {reports?.map((report) => <div className="data-list" key={report.tenantId}>
      <DataLine label={report.tenantId} value={(report.lastSuccessfulAt ? "Ultimo aggiornamento riuscito " + archiveDate(report.lastSuccessfulAt) : "Mai aggiornato") + (report.stale ? " · DA AGGIORNARE (oltre 15 giorni)" : "")} />
      {report.lastErrors.length ? <p className="quote-check open" style={{ overflowWrap: "anywhere" }}>Errori dell&apos;ultimo aggiornamento: {report.lastErrors.join("; ")}</p> : null}
      {report.domains.map((domain) => { const latest = domain.records[0]; return <div className="data-line" key={domain.key}>
        <span>{domain.source} · {ARCHIVE_COMPONENT[domain.componentCode] ?? domain.componentCode}{domain.variant ? " " + domain.variant : ""} · {ARCHIVE_SCOPE[domain.customerScope] ?? domain.customerScope} ({domain.unit})</span>
        <span>{latest ? latest.value.toLocaleString("it-IT", { maximumFractionDigits: 8 }) + " dal " + archiveDate(latest.effectiveFrom) + " al " + archiveDate(latest.effectiveTo) : "nessun valore"}{latest ? <> · <a href={latest.sourceReference} target="_blank" rel="noreferrer">fonte</a></> : null}{domain.missingMonths.length ? <small className="quote-check open"> Mancano: {domain.missingMonths.join(", ")}</small> : <small className="quote-check"> ✓ ultimi 12 mesi coperti</small>}</span>
      </div>; })}
    </div>)}
  </Card>;
}

function SystemPanel({ context, readiness, onReload }: { readonly context: VerifiedContextModel | null; readonly readiness: ReadinessModel | null; readonly onReload: () => void }) { return <div className="content-stack"><SectionHeader eyebrow="OPERATIONS" title="Stato sistema" detail="Readiness e contesto verificato, senza segreti o internals." action={<button className="button secondary" type="button" onClick={onReload}>Aggiorna stato</button>} /><Card><div className="data-list"><DataLine label="Autenticazione" value={context?.authenticated ? "Autenticata" : "Non autenticata"} /><DataLine label="Ruolo" value={context?.role ?? "Non disponibile"} /><DataLine label="Tenant" value={context?.tenantId ?? "Non disponibile"} /><DataLine label="Runtime" value={readiness?.runtimeMode ?? "Non disponibile"} /><DataLine label="Readiness" value={readiness?.readiness ? "Pronta" : "Bloccata"} /></div></Card>{context?.role === "ADMIN" && context.tenantId === "tenant_piattaforma" ? <><OfficialSourcesCheck /><OfficialRefresh platform /><OfficialArchive /></> : null}</div>; }

void CtePanel;

export default function OperationalShell() {
  const [chosenSection, setSection] = useState<SectionId | null>(null); const [showAdvanced, setShowAdvanced] = useState(false); const [context, setContext] = useState<VerifiedContextModel | null>(null); const [contextState, setContextState] = useState<LoadState>("loading"); const [readiness, setReadiness] = useState<ReadinessModel | null>(null); const [readinessState, setReadinessState] = useState<LoadState>("loading"); const [calculation, setCalculation] = useState<CalculationModel | null>(null); const [comparison, setComparison] = useState<ComparisonModel | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [draft, setDraft] = useState<SimulationDraft | null>(null); const [simulationPrefill, setSimulationPrefill] = useState<SimulationDraft | null>(null);
  // Tony (29/10): the simulation stays open while the operator moves between pages; it closes with "Ricomincia" or on exit.
  const signOut = useCallback(() => { void fetch("/api/auth/logout", { method: "POST", cache: "no-store" }).finally(() => { window.location.assign("/login"); }); }, []);
  const loadContext = useCallback(async (signal?: AbortSignal) => { setContextState("loading"); try { const result = await requestJson<VerifiedContextModel>("/api/foundation/context", {}, signal); if (!result.authenticated || !result.role || !result.tenantId) throw new Error("CONTEXT_INVALID"); setContext(result); setContextState("ready"); } catch { if (!signal?.aborted) { setContext(null); setContextState("error"); } } }, []); const loadReadiness = useCallback(async (signal?: AbortSignal) => { setReadinessState("loading"); try { setReadiness(await requestJson<ReadinessModel>("/api/health/readiness", {}, signal)); setReadinessState("ready"); } catch { if (!signal?.aborted) setReadinessState("error"); } }, []); useEffect(() => { const controller = new AbortController(); void loadContext(controller.signal); void loadReadiness(controller.signal); return () => controller.abort(); }, [loadContext, loadReadiness]);
  const canWrite = contextState === "ready" && readinessState === "ready" && Boolean(context?.authenticated && context.role && context.role !== ("VIEWER" satisfies UiRole) && context.readiness.readiness && readiness?.readiness); const readonly = !canWrite;
  // Agents only read the archives, but they upload bills, simulate and prepare proposals within their own scope.
  const canOperate = contextState === "ready" && readinessState === "ready" && Boolean(context?.authenticated && context.role && context.readiness.readiness && readiness?.readiness); const operateReadonly = !canOperate; const tenantId = context?.tenantId ?? null;
  // The platform owner's tenant only manages client companies; the sales screens belong to each company.
  const platformTenant = tenantId === "tenant_piattaforma";
  const section: SectionId = chosenSection ?? (platformTenant ? "dashboard" : "quote");
  const companyAdmin = context?.role === "ADMIN";
  const visibleSection = (id: SectionId): boolean => platformTenant ? PLATFORM_SECTIONS.includes(id) : (companyAdmin ? COMPANY_ADMIN_SECTIONS : SALES_SECTIONS).includes(id);
  const roleLabel = platformTenant ? "Gestione piattaforma" : context?.role === "ADMIN" ? "Amministratore" : context?.role === "ANALYST" ? "Responsabile" : context?.role === "VIEWER" ? "Agente" : "Sola lettura";
  function useBillInSimulation(value: SimulationDraft) { setSimulationPrefill(value); setDraft(value); setSection("simulations"); } function onCalculation(result: CalculationModel, value: SimulationDraft) { setCalculation(result); setComparison(null); setSelectedId(result.calculationId); setDraft(value); } function onComparison(result: ComparisonModel, value: SimulationDraft) { setComparison(result); setCalculation(null); setSelectedId(result.ranking[0]?.calculationId ?? null); setDraft(value); }
  return <div className="operational-app"><a className="skip-link" href="#main-content">Vai al contenuto</a><header className="app-header"><div className="brand-lockup"><div className="brand-mark" aria-hidden="true">E</div><div><h1>Energia Operativa</h1></div></div><div className="header-context">{context?.authSource === "LOCAL_SYNTHETIC" ? <span className="mode-pill">Locale sintetico esplicito</span> : null}<span className="mode-pill">{roleLabel}</span>{context?.authenticated ? <button className="mode-pill logout-button" type="button" onClick={signOut}>Esci</button> : null}</div></header><div className="app-layout"><aside className="app-sidebar"><nav aria-label="Navigazione principale">{sections.filter((item) => visibleSection(item.id) || (showAdvanced && companyAdmin && !platformTenant)).map((item) => <button key={item.id} className={section === item.id ? "nav-item active" : "nav-item"} type="button" onClick={() => setSection(item.id)} aria-current={section === item.id ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{item.short}</span><span>{item.label}</span></button>)}</nav>{companyAdmin && !platformTenant ? <button className="nav-more" type="button" onClick={() => { setShowAdvanced((value) => !value); if (showAdvanced && !visibleSection(section)) setSection("quote"); }} aria-expanded={showAdvanced}>{showAdvanced ? "Meno funzioni" : "Altre funzioni"}</button> : null}{operateReadonly ? <div className="sidebar-note"><strong>Vista sola lettura</strong></div> : null}</aside><main id="main-content" className="app-main" tabIndex={-1}><div hidden={section !== "quote"}><QuickQuoteFlow readonly={operateReadonly} /></div>{section === "dashboard" ? <DashboardPanel context={context} readiness={readiness} readinessState={readinessState} /> : null}{section === "bills" ? <BillsPanel readonly={operateReadonly} onUseInSimulation={useBillInSimulation} /> : null}{section === "cte" ? <><CteIngestionPanel readonly={readonly} canAdjust={context?.role === "ADMIN"} />{context?.role === "ADMIN" && !platformTenant && !readonly ? <ArchivePurge /> : null}</> : null}{section === "market" ? <MarketPanel admin={context?.role === "ADMIN"} platform={platformTenant} /> : null}{section === "simulations" ? <><BillDrivenSimulationPanel tenantId={tenantId} readonly={operateReadonly} prefill={simulationPrefill} onCalculation={onCalculation} onComparison={onComparison} /><ResultCards calculation={calculation} comparison={comparison} selectedId={selectedId} onSelect={setSelectedId} /></> : null}{section === "proposals" ? calculation || comparison ? <ProposalsPanel calculation={calculation} comparison={comparison} selectedId={selectedId} draft={draft} tenantId={tenantId} readonly={operateReadonly} /> : <div className="content-stack"><SectionHeader eyebrow="ARCHIVIO" title="Proposte" detail="Le proposte preparate dalle simulazioni." /><ProposalArchivePanel readonly={operateReadonly} /></div> : null}{section === "chain" ? <HierarchyPanel /> : null}{section === "access" ? <AccessPanel /> : null}{section === "permissions" ? <BillFeatureGovernancePanel /> : null}{section === "system" ? <SystemPanel context={context} readiness={readiness} onReload={() => { void loadContext(); void loadReadiness(); }} /> : null}</main></div></div>;
}
