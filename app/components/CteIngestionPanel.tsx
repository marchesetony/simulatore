"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "./UiStates";
import { requestForm, requestJson, toUiError } from "../lib/ui/client";
import { formatNumber, statusLabel } from "../lib/ui/format";
import { canonicalCteApprovedView, canonicalCteReviewView, type CteCanonicalViewModel } from "../lib/cte/canonical-view";
import type { CteApprovedArchiveDetailModel, CteApprovedArchiveSummaryModel, CteIngestionModel, CteReviewFieldModel, UiVector } from "../lib/ui/models";

const MAX_BYTES = 10_000_000;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"] as const;
const CORRECTABLE = new Set(["supplier.name", "offer.name", "offer.code", "validity.periodStart", "validity.periodEnd", "expiry.date", "pricing.mode", "pricing.reference", "pricing.spread.amount", "pricing.fixedPrice.amount", "taxTreatment", "eligibility.customerTypes", "eligibility.voltageLevels"]);
const ARCHIVE_OFFER_LABEL = "Nome offerta";
const OFFER_CODE_LABEL = "Codice offerta";
const SAFE_INGESTION_CODES = new Set(["CTE_OCR_PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY_MISSING", "ANTHROPIC_MODEL_MISSING", "ANTHROPIC_CTE_MAX_TOKENS_INVALID", "ANTHROPIC_CTE_TIMEOUT_INVALID", "CTE_OCR_PROVIDER_AUTH_FAILED", "CTE_OCR_PROVIDER_RATE_LIMITED", "CTE_OCR_PROVIDER_TIMEOUT", "CTE_OCR_PROVIDER_FAILED", "CTE_OCR_RESPONSE_INVALID", "CTE_OCR_TOOL_USE_MISSING", "CTE_OCR_TOOL_NAME_MISMATCH", "CTE_OCR_TOOL_CALL_MULTIPLE", "CTE_OCR_TOOL_INPUT_MALFORMED", "CTE_OCR_OUTPUT_TRUNCATED", "CTE_OCR_PROVIDER_REFUSAL", "CTE_OCR_PROVIDER_RESPONSE_UNKNOWN", "CTE_OCR_NO_USABLE_EVIDENCE", "CTE_EXTRACTION_SCHEMA_INVALID", "CTE_EXTRACTION_CONTRACT_INVALID", "CTE_EXTRACTION_FINAL_DOMAIN_EARLY", "CTE_VECTOR_FIELD_MIXED", "CTE_VECTOR_MISMATCH", "CTE_APPROVAL_BLOCKED", "CTE_ORIGINAL_DOCUMENT_UNAVAILABLE", "CTE_OCR_RETRY_IN_PROGRESS", "CTE_RETRY_STATE_INVALID"]);

const isRetryable = (ingestion: CteIngestionModel): boolean => ingestion.status === "FAILED" || ingestion.status === "PROVIDER_NOT_CONFIGURED";
function ReceivedIngestionRow({ ingestion, readonly, retrying, busy, onOpen, onRetry }: { readonly ingestion: CteIngestionModel; readonly readonly: boolean; readonly retrying: boolean; readonly busy: boolean; readonly onOpen: () => void; readonly onRetry: () => void }) {
  const title = ingestion.offerName ?? ingestion.fileName;
  return <div className="data-line cte-received-row"><button className="cte-received-document" type="button" onClick={onOpen}><span>{title}</span><small>{ingestion.supplierName ? `${ingestion.supplierName} · ` : ""}{statusLabel(ingestion.status)}</small></button><strong>{ingestion.vector}</strong>{isRetryable(ingestion) ? <div className="button-row"><button className="button primary" type="button" onClick={onRetry} disabled={readonly || busy}>{retrying ? "Analisi in corso…" : "Analizza"}</button></div> : null}<ReceivedDeleteAction ingestion={ingestion} readonly={readonly} /></div>;
}

// The opened document renders below the lists, so bring it into view instead of leaving the click looking inert.
function revealSection(id: string): void { globalThis.requestAnimationFrame?.(() => globalThis.document?.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })); }

const PROVIDER_SETUP_MESSAGES: Readonly<Record<string, string>> = {
  CTE_OCR_PROVIDER_NOT_CONFIGURED: "Il server non vede CTE_OCR_PROVIDER=anthropic (oppure ANTHROPIC_BASE_URL non valido).",
  ANTHROPIC_API_KEY_MISSING: "Il server non vede la variabile ANTHROPIC_API_KEY.",
  ANTHROPIC_MODEL_MISSING: "Il server non vede la variabile ANTHROPIC_MODEL.",
  ANTHROPIC_CTE_MAX_TOKENS_INVALID: "La variabile ANTHROPIC_CTE_MAX_TOKENS ha un valore non valido.",
  ANTHROPIC_CTE_TIMEOUT_INVALID: "La variabile ANTHROPIC_CTE_TIMEOUT_MS ha un valore non valido.",
};
function providerSetupMessage(code: string | null): string { return (code && PROVIDER_SETUP_MESSAGES[code]) ?? "Provider Anthropic non configurato."; }
function safeIngestionCode(value: string | null): string { return value && SAFE_INGESTION_CODES.has(value) ? value : "CTE_INGESTION_FAILED"; }
function ReceivedDeleteAction({ ingestion, readonly, compact = false }: { readonly ingestion: CteIngestionModel; readonly readonly: boolean; readonly compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busyRef = useRef(false);
  if (ingestion.status === "APPROVED") return null;
  const remove = async () => { if (readonly || busyRef.current) return; busyRef.current = true; setBusy(true); setConfirming(false); try { await requestJson(`/api/cte/ingestion/${encodeURIComponent(ingestion.ingestionId)}`, { method: "DELETE" }); globalThis.dispatchEvent(new CustomEvent("cte:ingestion-deleted", { detail: ingestion.ingestionId })); } catch (cause) { globalThis.dispatchEvent(new CustomEvent("cte:ingestion-delete-error", { detail: toUiError(cause).message })); } finally { busyRef.current = false; setBusy(false); } };
  if (confirming) return <div className="cte-delete-confirmation" role="alertdialog" aria-label="Conferma cancellazione"><p>Vuoi eliminare questo documento?<br />L&apos;operazione eliminerà il documento non approvato e i relativi dati di elaborazione.</p><div className="button-row"><button className="button secondary" type="button" onClick={() => setConfirming(false)} disabled={busy}>Annulla</button><button className="button danger" type="button" onClick={() => void remove()} disabled={readonly || busy}>{busy ? "Eliminazione in corso…" : "Cancella documento"}</button></div></div>;
  const button = <button className={compact ? "button tool-delete" : "button secondary"} type="button" onClick={() => setConfirming(true)} disabled={readonly || busy}>{busy ? "Eliminazione in corso…" : "Cancella"}</button>;
  return compact ? button : <div className="button-row">{button}</div>;
}
function errorText(error: unknown): string { const safe = toUiError(error); return `${safe.message} codice ${safe.code}${safe.detail ? ` · dettaglio tecnico: ${safe.detail}` : ""}`; }
function formatReviewValue(field: CteReviewFieldModel): string { if (Array.isArray(field.normalizedValue)) return field.normalizedValue.join(", "); if (typeof field.normalizedValue === "number") return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(field.normalizedValue); return typeof field.normalizedValue === "string" ? field.normalizedValue : "Non rilevato nel documento"; }
function correctionValue(field: CteReviewFieldModel): string { if (typeof field.normalizedValue === "number") return String(field.normalizedValue).replace(".", ","); if (Array.isArray(field.normalizedValue)) return field.normalizedValue.join(", "); return typeof field.normalizedValue === "string" ? field.normalizedValue : ""; }
function fieldMap(model: CteCanonicalViewModel): Map<string, CteReviewFieldModel> { return new Map([...model.reviewFields, ...model.notFoundFields].map((field) => [field.fieldKey, field])); }
function displayValue(field: CteReviewFieldModel | undefined): string { return !field || field.normalizedValue === null ? "Non rilevato nel documento" : formatReviewValue(field); }
const PRICE_KEYS = new Set(["pricing.spread.amount", "pricing.fixedPrice.amount"]);
function summaryDisplayValue(field: CteReviewFieldModel): string { const value = displayValue(field); return PRICE_KEYS.has(field.fieldKey) && field.unit && field.normalizedValue !== null ? `${value} ${field.unit}` : value; }
/** A fixed offer shows its fixed amount; an indexed one shows index and spread. */
function pricingKeys(fields: Map<string, CteReviewFieldModel>): readonly string[] { return fields.get("pricing.mode")?.normalizedValue === "Fissa" ? ["pricing.mode", "pricing.fixedPrice.amount"] : ["pricing.mode", "pricing.reference", "pricing.spread.amount"]; }
function SourceReference({ field }: { readonly field?: CteReviewFieldModel }) { void field; return null; }
function ReviewStatus({ field }: { readonly field: CteReviewFieldModel }) { void field.confidence; if (field.status === "CORRECTED") return <span className="status-badge positive">Corretto</span>; return null; }

/** Offer name and validity are what the operator looks for first. */
const HIGHLIGHT_KEYS = new Set(["offer.name", "validity.period"]);
function SummaryItem({ field, editing, correction, onCorrection, disabled, hideLabel = false }: { readonly field?: CteReviewFieldModel; readonly editing: boolean; readonly correction: string | undefined; readonly onCorrection: (value: string) => void; readonly disabled: boolean; readonly hideLabel?: boolean }) {
  if (!field) return null;
  const missing = field.status === "NOT_FOUND" || field.normalizedValue === null;
  const editable = editing && CORRECTABLE.has(field.fieldKey) && !disabled;
  const label = field.fieldKey === "offer.code" ? OFFER_CODE_LABEL : field.label;
  return <div className={"cte-summary-item" + (PRICE_KEYS.has(field.fieldKey) ? " cte-spread-item" : "") + (HIGHLIGHT_KEYS.has(field.fieldKey) ? " cte-highlight-item" : "")}>{hideLabel && !(field.required && missing) ? null : <div className="cte-summary-label">{hideLabel ? null : <span>{label}</span>}{field.required && missing ? <span className="status-badge negative">Obbligatorio</span> : null}</div>}{editable ? <input className="cte-inline-edit" value={correction ?? correctionValue(field)} onChange={(event) => onCorrection(event.target.value)} aria-label={`Correggi ${label}`} /> : <strong className={missing ? "muted" : undefined} aria-label={missing ? "Non trovato" : undefined}>{summaryDisplayValue(field)}</strong>}<div className="cte-summary-meta"><SourceReference field={field} /><ReviewStatus field={field} /></div></div>;
}

function SummaryGroup({ title, fields, fieldKeys, editing, corrections, onCorrection, disabled }: { readonly title: string; readonly fields: Map<string, CteReviewFieldModel>; readonly fieldKeys: readonly string[]; readonly editing: boolean; readonly corrections: Readonly<Record<string, string>>; readonly onCorrection: (path: string, value: string) => void; readonly disabled: boolean }) {
  return <section className="cte-review-group"><h4>{title}</h4><div className="cte-summary-grid">{fieldKeys.map((key) => <SummaryItem key={key} field={fields.get(key)} editing={editing} correction={corrections[key]} onCorrection={(value) => onCorrection(key, value)} disabled={disabled} hideLabel={fieldKeys.length === 1 && fields.get(key)?.label === title} />)}</div></section>;
}

function commercialUnit(field: CteReviewFieldModel): string { const values = [field.unit]; if (field.periodicity && (!field.unit || !field.unit.toLowerCase().includes(field.periodicity.toLowerCase()))) values.push(field.periodicity); return values.filter(Boolean).join(" / ") || "—"; }
function commercialConditions(field: CteReviewFieldModel): ReactNode { const conditions = [...(field.conditions ?? [])]; if (field.description) conditions.push(field.description); return conditions.length ? conditions.map((condition, index) => <div key={`${field.fieldKey}-condition-${index}`}>{field.description === condition ? <><span className="muted">Descrizione:</span> {condition}</> : condition}</div>) : "—"; }

function CommercialTable({ fields, editing, corrections, onCorrection, disabled }: { readonly fields: readonly CteReviewFieldModel[]; readonly editing: boolean; readonly corrections: Readonly<Record<string, string>>; readonly onCorrection: (path: string, value: string) => void; readonly disabled: boolean }) {
  const order = ["commercialTerms.fixedFees", "commercialTerms.variableFees", "commercialTerms.imbalance", "commercialTerms.oneOffFees", "commercialTerms.commercialDiscounts", "commercialTerms.additionalServices"];
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const rows = order.map((key) => byKey.get(key)).filter((field): field is CteReviewFieldModel => Boolean(field));
  return <section className="cte-review-group"><h4>Componenti commerciali</h4>{rows.length ? <div className="cte-commercial-table-wrap"><table className="cte-commercial-table"><thead><tr><th>Componente</th><th>Importo</th><th>Unità/periodicità</th><th>Condizioni</th><th>Revisione</th></tr></thead><tbody>{rows.map((field) => <tr key={field.fieldKey}><th scope="row">{field.label}<SourceReference field={field} /></th><td>{editing && CORRECTABLE.has(field.fieldKey) ? <input className="cte-inline-edit" value={corrections[field.fieldKey] ?? correctionValue(field)} onChange={(event) => onCorrection(field.fieldKey, event.target.value)} aria-label={`Correggi ${field.label}`} disabled={disabled} /> : displayValue(field)}</td><td>{commercialUnit(field)}</td><td>{commercialConditions(field)}</td><td>{field.status === "UNCERTAIN" || field.status === "CORRECTED" ? <ReviewStatus field={field} /> : <span>Confermato</span>}</td></tr>)}</tbody></table></div> : <p className="muted">Nessun dato commerciale rilevato.</p>}</section>;
}

/** Duration and early-exit penalty are objects in the review model; show them as the CTE states them. */
function semanticText(field: CteReviewFieldModel | undefined, kind: "duration" | "exit"): string {
  const value = field?.normalizedValue as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return kind === "exit" ? "Nessuna penale indicata nella CTE" : "Non indicata nella CTE";
  const record = value as { readonly value?: unknown; readonly amount?: unknown; readonly durationReference?: { readonly value?: unknown } | null; readonly sourceText?: unknown };
  if (kind === "duration") return typeof record.value === "number" ? `${record.value} mesi` : "Non indicata nella CTE";
  const amount = typeof record.amount === "number" ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(record.amount) : null;
  const months = typeof record.durationReference?.value === "number" ? ` se recedi prima di ${record.durationReference.value} mesi` : "";
  return amount ? `${amount}${months}` : typeof record.sourceText === "string" ? record.sourceText : "Nessuna penale indicata nella CTE";
}
function ExitTerms({ fields }: { readonly fields: Map<string, CteReviewFieldModel> }) {
  const exit = fields.get("commercialTerms.exitFee");
  return <section className="cte-review-group"><h4>Durata e recesso</h4><div className="cte-summary-grid"><div className="cte-summary-item"><div className="cte-summary-label"><span>Durata condizioni economiche</span></div><strong>{semanticText(fields.get("commercialTerms.economicDuration"), "duration")}</strong></div><div className="cte-summary-item"><div className="cte-summary-label"><span>Penale di recesso anticipato</span></div><strong>{semanticText(exit, "exit")}</strong>{exit?.sourceText && exit.normalizedValue ? <p className="muted">{exit.sourceText}</p> : null}</div></div></section>;
}

function CardHeading({ title, detail, action }: { readonly title: string; readonly detail?: string; readonly action?: ReactNode }) { return <div className="card-heading"><div><h3>{title}</h3>{detail ? <p className="muted">{detail}</p> : null}</div>{action}</div>; }
function CommercialAvailability({ model }: { readonly model: CteCanonicalViewModel }) { if (!model.commercialStatus) return null; return <div className="cte-commercial-availability" role="status"><div><span>Disponibilità commerciale</span><strong>{model.commercialStatus === "BLOCKED" ? "Bloccata" : "Attiva"}</strong></div>{model.commercialStatus === "BLOCKED" && model.blockReason ? <div><span>Motivo blocco</span><strong>{model.blockReason}</strong></div> : null}</div>; }

function CteContractSummary({ model, readonly, pending, editing, corrections, onCorrection, onStartEdit, onSaveAll, onCancelAll, onRetry, onBack, onReread, extraAction }: { readonly extraAction?: ReactNode; readonly model: CteCanonicalViewModel; readonly readonly: boolean; readonly pending: ReadonlySet<string>; readonly editing: boolean; readonly corrections: Readonly<Record<string, string>>; readonly onCorrection: (path: string, value: string | undefined) => void; readonly onStartEdit: () => void; readonly onSaveAll: () => void; readonly onCancelAll: () => void; readonly onRetry: () => void; readonly onBack?: () => void; readonly onReread?: () => void }) {
  const reviewMode = model.mode === "review";
  const fields = fieldMap(model);
  const disabled = readonly || !reviewMode || pending.has("cte:retry") || pending.has("cte:save");
  const optionalMissing = model.notFoundFields.filter((field) => !field.required && field.fieldKey !== "commercialTerms.exitFee" && field.fieldKey !== "commercialTerms.economicDuration");
  const detail = model.size === null ? model.detailName : `${model.detailName} · ${formatNumber(model.size, "B")}`;
  const status = model.status === "APPROVED" ? "Approvata" : statusLabel(model.status);
  return <div className="content-stack cte-review-compact"><CardHeading title={model.title} detail={detail} action={onBack ? <button className="button secondary" type="button" onClick={onBack}>Torna all&apos;Archivio approvato</button> : undefined} /><div className="data-list cte-review-metadata"><div className="data-line"><span>Stato</span><strong>{status}</strong></div><div className="data-line"><span>Tipo documento</span><strong>{model.documentType}</strong></div><div className="data-line"><span>Tipo fornitura</span><strong>{model.vector === "EE" ? "Energia elettrica" : model.vector === "GAS" ? "Gas" : model.vector}</strong></div></div><CommercialAvailability model={model} />{reviewMode && model.unavailable ? <p className="warning-text" role="alert">{providerSetupMessage(model.errorCode)} Documento conservato, estrazione non eseguita. Codice {safeIngestionCode(model.errorCode)}</p> : null}{reviewMode && model.errorCode && !model.unavailable ? <ErrorState message={`Elaborazione non riuscita. Codice ${safeIngestionCode(model.errorCode)}${model.providerDetail ? ` · risposta Anthropic: ${model.providerDetail}` : ""}`} /> : null}{reviewMode && (model.processing || pending.has("cte:retry")) ? <LoadingState label="Analisi documento in corso" /> : null}<div className="cte-review-layout"><SummaryGroup title="Fornitore e offerta" fields={fields} fieldKeys={["offer.name", "validity.period", "supplier.name", "offer.code"]} editing={reviewMode && editing} corrections={corrections} onCorrection={(path, value) => onCorrection(path, value)} disabled={disabled} /><SummaryGroup title="Struttura prezzo" fields={fields} fieldKeys={pricingKeys(fields)} editing={reviewMode && editing} corrections={corrections} onCorrection={(path, value) => onCorrection(path, value)} disabled={disabled} /><SummaryGroup title="Ambito di applicazione" fields={fields} fieldKeys={["eligibility.customerTypes", "eligibility.consumptionRange", "eligibility.voltageLevels", "eligibility.exclusions"]} editing={reviewMode && editing} corrections={corrections} onCorrection={(path, value) => onCorrection(path, value)} disabled={disabled} /><SummaryGroup title="Trattamento fiscale" fields={fields} fieldKeys={["taxTreatment"]} editing={reviewMode && editing} corrections={corrections} onCorrection={(path, value) => onCorrection(path, value)} disabled={disabled} /></div><CommercialTable fields={model.reviewFields} editing={reviewMode && editing} corrections={corrections} onCorrection={onCorrection} disabled={disabled} /><ExitTerms fields={fields} />{optionalMissing.length ? <details className="cte-collapsed-section"><summary>Non rilevati</summary><p>Questi dati non sono presenti nel documento e non bloccano l&apos;approvazione.</p><ul>{optionalMissing.map((field) => <li key={field.fieldKey}>{field.label}</li>)}</ul></details> : null}{reviewMode ? <div className="cte-review-toolbar">{editing ? <><button className="button primary" data-correction-action="Salva correzione" type="button" onClick={onSaveAll} disabled={disabled || Object.keys(corrections).length === 0}>Salva modifiche</button><button className="button secondary" type="button" onClick={onCancelAll} disabled={disabled}>Annulla</button></> : <button className="button tool-edit" type="button" onClick={onStartEdit} disabled={readonly || pending.has("cte:retry")}>Modifica</button>}{onReread && model.status === "REVIEW_REQUIRED" ? <button className="button tool-reread" type="button" onClick={onReread} disabled={readonly || pending.has("cte:retry")}>{pending.has("cte:retry") ? "Rilettura in corso…" : "Rileggi dalla CTE"}</button> : null}{model.retryable ? <button className="button tool-reread" type="button" onClick={onRetry} disabled={readonly || pending.has("cte:retry")}>{pending.has("cte:retry") ? "Analisi documento in corso" : "Riprova analisi"}</button> : null}{extraAction}</div> : null}</div>;
}

function ApprovalGate({ ingestion, readonly, pending, draftCorrections, onApprove }: { readonly ingestion: CteIngestionModel; readonly readonly: boolean; readonly pending: ReadonlySet<string>; readonly draftCorrections: readonly string[]; readonly onApprove: () => void }) {
  if (ingestion.status === "APPROVED") return <section className="cte-approval-gate" aria-live="polite"><div className="cte-approved-status" role="status"><strong>CTE approvata</strong><span>Stato: Approvata</span></div></section>;
  const blockers = [...ingestion.approvalGate.blockers, ...draftCorrections.map((fieldKey) => ({ code: "CORRECTION_UNSAVED", fieldKey, label: "Correzione non ancora salvata", required: true as const }))];
  if (readonly) blockers.push({ code: "READ_ONLY", label: "Operatore in sola lettura", required: true });
  const candidateUnavailable = ingestion.candidatePreview === null;
  const disabled = readonly || blockers.length > 0 || candidateUnavailable || pending.has("cte:approve") || pending.has("cte:retry");
  return <section className="cte-approval-gate" aria-live="polite"><div className="button-row"><button className="button primary" type="button" onClick={onApprove} disabled={disabled}>{pending.has("cte:approve") ? "Approvazione in corso…" : "Approva CTE"}</button></div>{blockers.length ? <div className="cte-approval-blocked" role="status"><strong>Approvazione non disponibile</strong><ul>{blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.fieldKey ?? index}`}>{blocker.label}</li>)}</ul></div> : <p className="inline-success" role="status">Pronta per approvazione.</p>}</section>;
}


function Review({ ingestion, readonly, pending, editing, corrections, onCorrection, onStartEdit, onSaveAll, onCancelAll, onRetry, onReread }: { readonly ingestion: CteIngestionModel; readonly readonly: boolean; readonly pending: ReadonlySet<string>; readonly editing: boolean; readonly corrections: Readonly<Record<string, string>>; readonly onCorrection: (path: string, value: string | undefined) => void; readonly onStartEdit: () => void; readonly onSaveAll: () => void; readonly onCancelAll: () => void; readonly onRetry: () => void; readonly onReread: () => void }) {
  return <><CteContractSummary model={canonicalCteReviewView(ingestion)} readonly={readonly} pending={pending} editing={editing} corrections={corrections} onCorrection={onCorrection} onStartEdit={onStartEdit} onSaveAll={onSaveAll} onCancelAll={onCancelAll} onRetry={onRetry} onReread={onReread} extraAction={<ReceivedDeleteAction ingestion={ingestion} readonly={readonly} compact />} /></>;
}

type CommercialAction = "block" | "reactivate" | "delete" | "adjust" | "expiry";
function CommercialLifecycleActions({ record, readonly }: { readonly record: CteApprovedArchiveSummaryModel; readonly readonly: boolean }) {
  const status = record.commercialStatus ?? "ACTIVE";
  const [confirming, setConfirming] = useState<CommercialAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const copy = confirming === "block"
    ? { title: "Vuoi bloccare questa CTE?", detail: "La CTE resterà consultabile ma non potrà essere utilizzata nelle simulazioni o nelle proposte.", confirm: "Blocca" }
    : confirming === "reactivate"
      ? { title: "Vuoi riattivare questa CTE?", detail: "Se ancora valida secondo le altre regole commerciali, tornerà disponibile per simulazioni e proposte.", confirm: "Riattiva" }
      : { title: "Vuoi cancellare questa CTE dall'archivio operativo?", detail: "La CTE non sarà più disponibile nelle simulazioni, nei ranking o nelle proposte commerciali.", confirm: "Cancella CTE" };
  const run = async () => {
    if (!confirming || readonly || busy || busyRef.current || (confirming === "block" && !reason.trim())) return;
    busyRef.current = true; setBusy(true);
    try {
      const path = confirming === "block" ? `/api/cte/archive/${encodeURIComponent(record.archiveId)}/block` : confirming === "reactivate" ? `/api/cte/archive/${encodeURIComponent(record.archiveId)}/reactivate` : `/api/cte/archive/${encodeURIComponent(record.archiveId)}`;
      await requestJson(path, { method: confirming === "delete" ? "DELETE" : "POST", ...(confirming === "block" ? { body: JSON.stringify({ reason: reason.trim() }) } : {}) });
      globalThis.dispatchEvent(new CustomEvent("cte:commercial-updated", { detail: { archiveId: record.archiveId, action: confirming } }));
      setConfirming(null); setReason("");
    } catch (cause) { globalThis.dispatchEvent(new CustomEvent("cte:commercial-error", { detail: errorText(cause) })); } finally { busyRef.current = false; setBusy(false); }
  };
  if (confirming) return <div className="cte-commercial-confirmation" role="alertdialog" aria-label="Conferma stato commerciale"><strong>{copy.title}</strong><p>{copy.detail}</p>{confirming === "block" ? <label>Motivo del blocco<input value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} required /></label> : null}<div className="button-row"><button className="button secondary" type="button" onClick={() => { setConfirming(null); setReason(""); }} disabled={busy}>Annulla</button><button className="button danger" type="button" onClick={() => void run()} disabled={readonly || busy || (confirming === "block" && !reason.trim())}>{busy ? (confirming === "delete" ? "Cancellazione in corso…" : `${copy.confirm} in corso…`) : copy.confirm}</button></div></div>;
  return <div className="cte-commercial-actions">{status === "ACTIVE" ? <><button className="button secondary" type="button" onClick={() => setConfirming("block")} disabled={readonly || busy}>{busy ? "Blocco in corso…" : "Blocca"}</button><button className="button danger" type="button" onClick={() => setConfirming("delete")} disabled={readonly || busy}>{busy ? "Cancellazione in corso…" : "Cancella"}</button></> : <><button className="button secondary" type="button" onClick={() => setConfirming("reactivate")} disabled={readonly || busy}>{busy ? "Riattivazione in corso…" : "Riattiva"}</button><button className="button danger" type="button" onClick={() => setConfirming("delete")} disabled={readonly || busy}>{busy ? "Cancellazione in corso…" : "Cancella"}</button></>}</div>;
}

function formatDelta(value: number, unit: string): string { return `${value > 0 ? "+" : ""}${value.toLocaleString("it-IT", { maximumFractionDigits: 6 })} ${unit}`; }

/** Company correttivi: they move every quote built on this CTE, never the approved document. */
function CommercialAdjustment({ record, canAdjust }: { readonly record: CteApprovedArchiveSummaryModel; readonly canAdjust: boolean }) {
  const current = record.commercialAdjustment ?? null;
  const unit = record.vector === "GAS" ? "€/Smc" : "€/kWh";
  const [open, setOpen] = useState(false);
  const [energy, setEnergy] = useState(String(current?.energyPriceDelta ?? 0));
  const [fee, setFee] = useState(String(current?.monthlyFeeDelta ?? 0));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/cte/archive/${encodeURIComponent(record.archiveId)}/adjustment`, { method: "POST", body: JSON.stringify({ energyPriceDelta: energy, monthlyFeeDelta: fee }) });
      globalThis.dispatchEvent(new CustomEvent("cte:commercial-updated", { detail: { archiveId: record.archiveId, action: "adjust" } }));
      setOpen(false);
    } catch (cause) { globalThis.dispatchEvent(new CustomEvent("cte:commercial-error", { detail: errorText(cause) })); } finally { setBusy(false); }
  };
  const summary = current ? `Ricarico o sconto: prezzo energia ${formatDelta(current.energyPriceDelta, unit)} · quota fissa ${formatDelta(current.monthlyFeeDelta, "€/mese")}` : "Nessun ricarico o sconto";
  if (!open) return <div className="cte-adjustment"><small className="muted">{summary}</small>{canAdjust ? <button className="button secondary compact" type="button" onClick={() => setOpen(true)}>Ricarico o sconto</button> : null}</div>;
  return <div className="cte-adjustment cte-adjustment-form" role="group" aria-label="Ricarico o sconto">
    <label>Prezzo energia ({unit})<input inputMode="decimal" value={energy} onChange={(event) => setEnergy(event.target.value)} disabled={busy} /></label>
    <label>Quota fissa (€/mese)<input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} disabled={busy} /></label>
    <small className="muted">Valori in più o in meno rispetto alla CTE: per esempio -0,005 abbassa il prezzo di mezzo centesimo. Si applicano a tutte le simulazioni e proposte nuove.</small>
    <div className="button-row"><button className="button secondary" type="button" onClick={() => setOpen(false)} disabled={busy}>Annulla</button><button className="button primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? "Salvataggio" : "Salva ricarico o sconto"}</button></div>
  </div>;
}

/** Only the expiry of an approved CTE can be changed; everything else stays as read from the document. */
function ExpiryEditor({ record, canEdit }: { readonly record: CteApprovedArchiveSummaryModel; readonly canEdit: boolean }) {
  const until = record.activeUntil ?? record.validity.periodEnd;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(until);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/cte/archive/${encodeURIComponent(record.archiveId)}/expiry`, { method: "POST", body: JSON.stringify({ date }) });
      globalThis.dispatchEvent(new CustomEvent("cte:commercial-updated", { detail: { archiveId: record.archiveId, action: "expiry" } }));
      setOpen(false);
    } catch (cause) { globalThis.dispatchEvent(new CustomEvent("cte:commercial-error", { detail: errorText(cause) })); } finally { setBusy(false); }
  };
  return <div className="cte-active-period"><strong>Attiva dal {approvedDate(record.validity.periodStart)} al {approvedDate(until)}</strong>{open ? <span className="button-row"><input type="date" aria-label="Nuova data di scadenza" value={date} onChange={(event) => setDate(event.target.value)} disabled={busy} /><button className="button secondary compact" type="button" onClick={() => { setDate(until); setOpen(false); }} disabled={busy}>Annulla</button><button className="button primary compact" type="button" onClick={() => void save()} disabled={busy || !date}>{busy ? "Salvataggio" : "Salva scadenza"}</button></span> : canEdit ? <button className="button secondary compact" type="button" onClick={() => setOpen(true)}>Modifica scadenza</button> : null}</div>;
}

function ApprovedArchiveRow({ record, readonly, canAdjust, onOpen }: { readonly record: CteApprovedArchiveSummaryModel; readonly readonly: boolean; readonly canAdjust: boolean; readonly onOpen: () => void }) {
  const commercialStatus = record.commercialStatus ?? "ACTIVE";
  return <div className="data-line cte-approved-archive-row"><button className="cte-approved-document" aria-label={`${ARCHIVE_OFFER_LABEL}: ${record.offerName}`} type="button" onClick={onOpen}><span><strong>{record.offerName}</strong><small>{record.supplierName} · {record.vector === "GAS" ? "Gas" : "Energia elettrica"}</small></span></button><ExpiryEditor record={record} canEdit={canAdjust && !readonly} /><span className="cte-approved-badges"><strong className="status-badge positive">Approvata</strong><strong className={`status-badge ${commercialStatus === "BLOCKED" ? "negative" : "positive"}`}>{commercialStatus === "BLOCKED" ? "Bloccata" : "Attiva"}</strong></span><CommercialLifecycleActions record={record} readonly={readonly} />{canAdjust && !readonly ? <CommercialAdjustment record={record} canAdjust /> : null}</div>;
}

function ApprovedCteDetail({ detail, onBack }: { readonly detail: CteApprovedArchiveDetailModel; readonly onBack: () => void }) {
  return <CteContractSummary model={canonicalCteApprovedView(detail)} readonly pending={new Set()} editing={false} corrections={{}} onCorrection={() => undefined} onStartEdit={() => undefined} onSaveAll={() => undefined} onCancelAll={() => undefined} onRetry={() => undefined} onBack={onBack} />;
}

function approvedDate(value: string): string { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); return match ? `${match[3]}/${match[2]}/${match[1]}` : value; }

export default function CteIngestionPanel({ readonly, canAdjust = false }: { readonly readonly: boolean; readonly canAdjust?: boolean }) {
  const [vector, setVector] = useState<UiVector>("EE");
  const [records, setRecords] = useState<readonly CteApprovedArchiveSummaryModel[]>([]);
  const [ingestions, setIngestions] = useState<readonly CteIngestionModel[]>([]);
  const [selected, setSelected] = useState<CteIngestionModel | null>(null);
  const [approvedDetail, setApprovedDetail] = useState<CteApprovedArchiveDetailModel | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [corrections, setCorrections] = useState<Readonly<Record<string, string>>>({});
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [bulkProgress, setBulkProgress] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const load = useCallback(async (selectedId?: string) => { try { const [archive, ingestion, detail] = await Promise.all([requestJson<{ readonly records: readonly CteApprovedArchiveSummaryModel[] }>("/api/cte/archive?view=approved"), requestJson<{ readonly ingestions: readonly CteIngestionModel[] }>(`/api/cte/ingestion?vector=${encodeURIComponent(vector)}`), selectedId ? requestJson<{ readonly ingestion: CteIngestionModel }>(`/api/cte/ingestion/${encodeURIComponent(selectedId)}`) : Promise.resolve(null)]); setRecords(archive.records); setIngestions(ingestion.ingestions); if (detail) setSelected(detail.ingestion); } catch (cause) { setError(errorText(cause)); throw cause; } }, [vector]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => { const deleted = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (selected?.ingestionId === id) { setSelected(null); setCorrections({}); setEditing(false); } void load().catch(() => undefined); }; const failed = (event: Event) => setError((event as CustomEvent<string>).detail); globalThis.addEventListener("cte:ingestion-deleted", deleted); globalThis.addEventListener("cte:ingestion-delete-error", failed); return () => { globalThis.removeEventListener("cte:ingestion-deleted", deleted); globalThis.removeEventListener("cte:ingestion-delete-error", failed); }; }, [load, selected?.ingestionId]);
  useEffect(() => { const updated = (event: Event) => { const detail = (event as CustomEvent<{ readonly archiveId: string; readonly action: CommercialAction }>).detail; void (async () => { try { await load(); if (approvedDetail?.archiveId === detail.archiveId && detail.action === "delete") setApprovedDetail(null); else if (approvedDetail?.archiveId === detail.archiveId) { const result = await requestJson<{ readonly record: CteApprovedArchiveDetailModel }>(`/api/cte/archive/${encodeURIComponent(detail.archiveId)}?view=approved`); setApprovedDetail(result.record); } } catch (cause) { setError(errorText(cause)); } })(); }; const failed = (event: Event) => setError((event as CustomEvent<string>).detail); globalThis.addEventListener("cte:commercial-updated", updated); globalThis.addEventListener("cte:commercial-error", failed); return () => { globalThis.removeEventListener("cte:commercial-updated", updated); globalThis.removeEventListener("cte:commercial-error", failed); }; }, [load, approvedDetail?.archiveId]);
  const setBusy = (key: string, value: boolean) => { if (value) pendingRef.current.add(key); else pendingRef.current.delete(key); setPending(new Set(pendingRef.current)); };
  const chooseFile = async (file: File): Promise<boolean> => { if (readonly || pendingRef.current.has("cte:upload")) return false; setError(undefined); setMessage(undefined); if (!ACCEPTED.includes(file.type as typeof ACCEPTED[number]) || file.size > MAX_BYTES) { setError("Documento non valido: usare PDF, JPG, JPEG o PNG entro 10 MB. codice CTE_FILE_INVALID"); return false; } setBusy("cte:upload", true); try { const form = new FormData(); form.append("file", file); const result = await requestForm<{ readonly ingestion: CteIngestionModel }>("/api/cte/ingestion", form, undefined, { "x-idempotency-key": globalThis.crypto.randomUUID() }); setSelected(result.ingestion); setIngestions((current) => [result.ingestion, ...current.filter((item) => item.ingestionId !== result.ingestion.ingestionId)]); setMessage(result.ingestion.status === "PROVIDER_NOT_CONFIGURED" ? `Documento conservato. Provider Anthropic non configurato. Codice ${safeIngestionCode(result.ingestion.errorCode)}` : "Documento inviato per l'elaborazione."); await load(); return true; } catch (cause) { setError(errorText(cause)); return false; } finally { setBusy("cte:upload", false); } };
  // Several CTEs go one after the other, so each keeps its own reading and review.
  const chooseFiles = async (files: readonly File[]) => { if (files.length === 1) { await chooseFile(files[0]); return; } const failed: string[] = []; for (const [index, file] of files.entries()) { setBulkProgress(`Caricamento ${index + 1} di ${files.length}: ${file.name}`); if (!(await chooseFile(file))) failed.push(file.name); } setBulkProgress(undefined); setMessage(`${files.length - failed.length} CTE su ${files.length} caricate: le trovi tra i documenti ricevuti.`); setError(failed.length ? `Non caricate: ${failed.join(", ")}.` : undefined); };
  const onInput = (event: ChangeEvent<HTMLInputElement>) => { const files = [...(event.target.files ?? [])]; if (files.length) void chooseFiles(files); event.currentTarget.value = ""; };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const files = [...event.dataTransfer.files]; if (files.length) void chooseFiles(files); };
  const openIngestion = async (id: string) => { try { const result = await requestJson<{ readonly ingestion: CteIngestionModel }>(`/api/cte/ingestion/${encodeURIComponent(id)}`); setApprovedDetail(null); setSelected(result.ingestion); setCorrections({}); setEditing(false); revealSection("cte-review"); } catch (cause) { setError(errorText(cause)); } };
  const openApprovedArchive = async (id: string) => { try { const result = await requestJson<{ readonly record: CteApprovedArchiveDetailModel }>(`/api/cte/archive/${encodeURIComponent(id)}?view=approved`); setSelected(null); setCorrections({}); setEditing(false); setApprovedDetail(result.record); revealSection("cte-approved-detail"); } catch (cause) { setError(errorText(cause)); } };
  const correct = async (path: string) => { const value = corrections[path]; if (value === undefined || !selected || pendingRef.current.has(`cte:correction:${path}`)) return; setBusy(`cte:correction:${path}`, true); try { const result = await requestJson<{ readonly ingestion: CteIngestionModel }>(`/api/cte/ingestion/${encodeURIComponent(selected.ingestionId)}/review`, { method: "POST", body: JSON.stringify({ fieldPath: path, value }) }); setSelected(result.ingestion); setCorrections((current) => { const next = { ...current }; delete next[path]; return next; }); setMessage("Correzione registrata."); } catch (cause) { setError(errorText(cause)); } finally { setBusy(`cte:correction:${path}`, false); } };
  const saveAll = async () => { if (!selected || readonly || pendingRef.current.has("cte:save")) return; setBusy("cte:save", true); try { for (const path of Object.keys(corrections)) await correct(path); setEditing(false); setMessage("Modifiche registrate."); } catch (cause) { setError(errorText(cause)); } finally { setBusy("cte:save", false); } };
  // Re-reads a document already in review with the current extractor; if it fails the current reading stays.
  const reread = async () => { if (!selected || readonly || pendingRef.current.has("cte:retry")) return; setBusy("cte:retry", true); setError(undefined); setMessage(undefined); try { const result = await requestJson<{ readonly ingestion: CteIngestionModel }>(`/api/cte/ingestion/${encodeURIComponent(selected.ingestionId)}/retry?reread=1`, { method: "POST" }); setSelected(result.ingestion); setCorrections({}); setEditing(false); setMessage(result.ingestion.errorCode ? "Rilettura non riuscita: resta la lettura precedente." : "Documento riletto dalla CTE."); await load(); } catch (cause) { setError(errorText(cause)); } finally { setBusy("cte:retry", false); } };
  const cancelAll = () => { if (pendingRef.current.has("cte:save")) return; setCorrections({}); setEditing(false); };
  const approve = async () => { if (!selected || readonly || pendingRef.current.has("cte:approve")) return; const selectedId = selected.ingestionId; setBusy("cte:approve", true); setError(undefined); setMessage(undefined); try { await requestJson(`/api/cte/ingestion/${encodeURIComponent(selectedId)}/approve`, { method: "POST" }); await load(selectedId); setCorrections({}); setEditing(false); setMessage("CTE approvata e archivio aggiornato."); } catch (cause) { setError(errorText(cause)); } finally { setBusy("cte:approve", false); } };
  const retryIngestion = async (ingestionId: string): Promise<CteIngestionModel> => { const result = await requestJson<{ readonly ingestion: CteIngestionModel }>(`/api/cte/ingestion/${encodeURIComponent(ingestionId)}/retry`, { method: "POST" }); setIngestions((current) => [result.ingestion, ...current.filter((item) => item.ingestionId !== result.ingestion.ingestionId)]); return result.ingestion; };
  const retry = async () => { if (!selected || readonly || pendingRef.current.has("cte:retry")) return; setBusy("cte:retry", true); setError(undefined); setMessage(undefined); try { const ingestion = await retryIngestion(selected.ingestionId); setSelected(ingestion); setMessage(ingestion.status === "REVIEW_REQUIRED" ? "Analisi completata: documento in revisione." : "Nuovo tentativo registrato."); await load(); } catch (cause) { setError(errorText(cause)); } finally { setBusy("cte:retry", false); } };
  const retryMany = async (targets: readonly CteIngestionModel[]) => { if (readonly || pendingRef.current.has("cte:retry") || targets.length === 0) return; setBusy("cte:retry", true); setError(undefined); setMessage(undefined); let completed = 0; let lastError: unknown; let lastFailure: string | null = null; let lastDetail: string | null = null; try { for (const [index, target] of targets.entries()) { setBulkProgress(`Analisi ${index + 1} di ${targets.length}: ${target.fileName}`); setRetryingId(target.ingestionId); try { const ingestion = await retryIngestion(target.ingestionId); if (ingestion.status === "REVIEW_REQUIRED") completed += 1; else lastFailure = ingestion.errorCode; if (ingestion.providerDetail) lastDetail = ingestion.providerDetail; if (selected?.ingestionId === ingestion.ingestionId) setSelected(ingestion); } catch (cause) { lastError = cause; } } setBulkProgress(undefined); if (completed === targets.length) setMessage(targets.length === 1 ? "Analisi completata: documento in revisione." : `${completed} documenti analizzati: aprili per controllarli e approvarli.`); else setError(`${completed} di ${targets.length} documenti analizzati. ${lastFailure ? `${toUiError(new Error(lastFailure), "CTE_INGESTION_FAILED").message}. Codice ${safeIngestionCode(lastFailure)}${lastDetail ? ` · risposta Anthropic: ${lastDetail}` : ""}` : lastError ? errorText(lastError) : "Apri un documento per vedere il motivo."}`); await load(); } finally { setBulkProgress(undefined); setRetryingId(undefined); setBusy("cte:retry", false); } };
  const archiveRecords = records.filter((record) => record.vector === vector);
  const draftCorrections = Object.keys(corrections);
  const updateCorrection = (path: string, value: string | undefined) => setCorrections((current) => { const next = { ...current }; if (value === undefined) delete next[path]; else next[path] = value; return next; });
  const received = ingestions.filter((item) => item.vector === vector || item.vector === "UNKNOWN");
  const retryableReceived = received.filter(isRetryable);
  return <div className="content-stack"><section className="ui-card"><div className="section-header"><div><p className="eyebrow">CONTRATTI E OFFERTE</p><h2>Archivio CTE</h2><p className="section-detail">Carica le CTE dei fornitori, anche tutte insieme. Ogni CTE resta utilizzabile fino alla data di validità indicata nel documento, poi viene scartata e tolta dall&apos;archivio in automatico.</p></div></div><div className="vector-tabs" role="tablist" aria-label="Vettore energetico"><button id="cte-ee-tab" type="button" role="tab" aria-selected={vector === "EE"} aria-controls="cte-panel" tabIndex={vector === "EE" ? 0 : -1} onClick={() => setVector("EE")}>Energia elettrica (EE)</button><button id="cte-gas-tab" type="button" role="tab" aria-selected={vector === "GAS"} aria-controls="cte-panel" tabIndex={vector === "GAS" ? 0 : -1} onClick={() => setVector("GAS")}>Gas (GAS)</button></div><div id="cte-panel" role="tabpanel" aria-labelledby={`cte-${vector.toLowerCase()}-tab`}><div className="ui-state cte-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}><strong>Carica CTE {vector}</strong><span>PDF, JPG, JPEG o PNG · massimo 10 MB ciascuno · puoi selezionarne anche più di uno insieme</span><label className="button primary" htmlFor="cte-document">Seleziona documento</label><input id="cte-document" type="file" multiple accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={onInput} disabled={readonly || pending.has("cte:upload")} hidden />{pending.has("cte:upload") || bulkProgress ? <p role="status" aria-live="polite">{bulkProgress ?? "Upload in corso…"}</p> : null}</div>{message ? <p className="inline-success" role="status" aria-live="polite">{message}</p> : null}{error ? <ErrorState message={error} /> : null}</div></section><section className="ui-card"><CardHeading title={`Documenti ricevuti ${vector}`} action={retryableReceived.length > 1 ? <button className="button primary" type="button" onClick={() => void retryMany(retryableReceived)} disabled={readonly || pending.has("cte:retry")}>{pending.has("cte:retry") ? "Analisi in corso…" : `Analizza tutti (${retryableReceived.length})`}</button> : undefined} /><div className="data-list">{received.map((item) => <ReceivedIngestionRow key={item.ingestionId} ingestion={item} readonly={readonly} retrying={retryingId === item.ingestionId} busy={pending.has("cte:retry")} onOpen={() => void openIngestion(item.ingestionId)} onRetry={() => void retryMany([item])} />)}</div>{ingestions.length === 0 ? <EmptyState title="Nessun documento" detail="Carica un CTE per avviare l'estrazione." /> : null}</section>{approvedDetail ? <section className="ui-card" id="cte-approved-detail"><ApprovedCteDetail detail={approvedDetail} onBack={() => setApprovedDetail(null)} /></section> : selected ? <><section className="ui-card" id="cte-review"><Review ingestion={selected} readonly={readonly} pending={pending} editing={editing} corrections={corrections} onCorrection={updateCorrection} onStartEdit={() => setEditing(true)} onSaveAll={() => void saveAll()} onCancelAll={cancelAll} onRetry={() => void retry()} onReread={() => void reread()} /></section><section className="ui-card"><ApprovalGate ingestion={selected} readonly={readonly} pending={pending} draftCorrections={draftCorrections} onApprove={() => void approve()} /></section></> : null}<section className="ui-card"><CardHeading title={`Archivio approvato ${vector}`} />{archiveRecords.length ? <div className="data-list">{archiveRecords.map((record) => <ApprovedArchiveRow key={record.archiveId} record={record} readonly={readonly} canAdjust={canAdjust} onOpen={() => void openApprovedArchive(record.archiveId)} />)}</div> : <EmptyState title={`Nessun CTE ${vector}`} detail="Solo i record approvati dal server sono utilizzabili dal simulatore." />}</section></div>;
}
