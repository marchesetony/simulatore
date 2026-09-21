"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";
import type { ApprovedBillSummaryModel, BillDocumentModel, CalculationModel, ComparisonModel, CteApprovedArchiveSummaryModel, SimulationDraft } from "../lib/ui/models";

type BillLoadState = "loading" | "ready" | "error";
type CteLoadState = "idle" | "loading" | "ready" | "error";
type OverrideStatus = "REQUESTED" | "AUTHORIZED" | "REJECTED" | "EXPIRED" | "USED";
type ServerOverride = { readonly overrideId: string; readonly billId: string; readonly billVersionId: string; readonly cteId: string; readonly requestedByUserId: string; readonly authorizedByUserId: string | null; readonly createdAt: string; readonly authorizedAt: string | null; readonly reason: string; readonly originalMismatchReasons: readonly string[]; readonly status: OverrideStatus; readonly expiresAt?: string };
type OverrideUiState = { readonly capabilities: { readonly role: "SUPER_ADMIN" | "ADMIN" | "AGENT"; readonly canRequest: boolean; readonly canAuthorize: boolean; readonly canReject: boolean }; readonly overrides: readonly ServerOverride[] };
type ServerSimulationContext = {
  readonly tenantId: string;
  readonly billId: string;
  readonly billVersionId: string;
  readonly ownerUserId: string | null;
  readonly vector: "EE" | "GAS";
  readonly customerType: "RESIDENTIAL" | "NON_RESIDENTIAL";
  readonly customerLegalType?: "CONSUMER" | "BUSINESS" | "OTHER" | "NOT_DECLARED";
  readonly supplyUseScope?: "DOMESTIC" | "OTHER_USE" | "PUBLIC_LIGHTING" | "EV_CHARGING" | "OTHER" | "NOT_DECLARED";
  readonly residency: "RESIDENT" | "NON_RESIDENT" | null;
  readonly supply: { readonly pod: string | null; readonly pdr: string | null; readonly voltageLevel: "LV" | "MV" | "HV" | "EHV" | null; readonly contractedPowerKw: number | null; readonly availablePowerKw: number | null };
  readonly billingPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly consumption: { readonly annual: number | null; readonly period: { readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly smc: number | null }; readonly monthlyProfile: readonly { readonly month: string; readonly f1: number; readonly f2: number; readonly f3: number }[] | null; readonly correctionCoefficient: number | null };
  readonly currentSupplier: string;
  readonly currentOffer: { readonly name: string | null; readonly code: string | null };
  readonly contractExpiry: { readonly status: "KNOWN" | "UNKNOWN"; readonly date?: string };
  readonly economicBaseline: { readonly amount: number; readonly currency: "EUR"; readonly source: "APPROVED_BILL" } | null;
  readonly classification: { readonly domestic: boolean; readonly nonDomestic: boolean; readonly resident: boolean | null; readonly voltageClass: "LV" | "MV" | "HV" | "EHV" | null; readonly regulatoryCustomerScope: string | null; readonly bta6Eligible: boolean | null; readonly status: "READY" | "PARTIAL" };
  readonly alerts: readonly { readonly code: "DOMESTIC_HIGH_COMMITTED_POWER"; readonly severity: "WARNING"; readonly requiresReview: true; readonly message: string }[];
  readonly missingRequiredData: readonly string[];
};
type ServerCandidate = { readonly archiveId: string; readonly cteId: string; readonly cteVersionId: string | null; readonly supplier: string; readonly offer: { readonly name: string; readonly code: string }; readonly validity: { readonly periodStart: string; readonly periodEnd: string }; readonly pricingType: "INDEXED" | "FIXED" | null; readonly pricingReference: string | null; readonly eligibilityStatus: "COMPATIBLE" | "NOT_COMPATIBLE"; readonly compatibilityReason: string; readonly reasonCodes?: readonly string[]; readonly finalStatus?: "ELIGIBLE" | "NOT_ELIGIBLE" | "ELIGIBLE_BY_OVERRIDE" | "BLOCKED"; readonly eligibilityOverrideId?: string; readonly overrideRequestable?: boolean; readonly calculationReadiness: "READY" | "MARKET_DATA_MISSING" | "NOT_READY" };
type Candidate = { readonly summary: CteApprovedArchiveSummaryModel; readonly cteId: string; readonly compatible: boolean; readonly finalStatus: "ELIGIBLE" | "NOT_ELIGIBLE" | "ELIGIBLE_BY_OVERRIDE" | "BLOCKED"; readonly overrideRequestable: boolean; readonly override: ServerOverride | null; readonly reasons: readonly string[]; readonly serverVersionId: string; readonly pricingType: "INDEXED" | "FIXED" | null; readonly calculationReadiness: "READY" | "MARKET_DATA_MISSING" | "NOT_READY" };

function messageFor(error: unknown): string { return toUiError(error).message; }
function eligibilityReasonLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = { CUSTOMER_LEGAL_TYPE_MISMATCH: "Tipo giuridico cliente non ammesso", SUPPLY_USE_MISMATCH: "Uso della fornitura non ammesso", IDENTIFIER_TYPE_MISMATCH: "Tipo identificativo non ammesso", VOLTAGE_MISMATCH: "Livello di tensione non ammesso", CONSUMPTION_THRESHOLD_MISMATCH: "Soglia di consumo non rispettata", POWER_THRESHOLD_MISMATCH: "Soglia di potenza non rispettata", VALIDITY_MISMATCH: "Validità CTE non compatibile", CALCULATION_NOT_READY: "Calcolo non pronto", REVIEW_REQUIRED: "CTE da revisionare", EXPIRED_CTE: "CTE scaduta" };
  return labels[value] ?? value;
}
function finalStatusLabel(value: Candidate["finalStatus"]): string {
  if (value === "ELIGIBLE_BY_OVERRIDE") return "Utilizzo autorizzato";
  if (value === "BLOCKED") return "Bloccata";
  if (value === "NOT_ELIGIBLE") return "Non compatibile";
  return "CTE compatibile";
}
function candidateFromServer(candidate: ServerCandidate, overrides: readonly ServerOverride[], context: ServerSimulationContext): Candidate {
  const finalStatus = candidate.finalStatus ?? "BLOCKED";
  const override = overrides.find((item) => item.billId === context.billId && item.billVersionId === context.billVersionId && item.cteId === candidate.cteId) ?? null;
  return { summary: { archiveId: candidate.archiveId, vector: context.vector, offerName: candidate.offer.name, supplierName: candidate.supplier, validity: candidate.validity, status: "APPROVED" as const, commercialStatus: "ACTIVE" as const }, cteId: candidate.cteId, compatible: finalStatus === "ELIGIBLE" || finalStatus === "ELIGIBLE_BY_OVERRIDE", finalStatus, overrideRequestable: candidate.overrideRequestable === true, override, reasons: candidate.eligibilityStatus === "COMPATIBLE" ? [] : [candidate.compatibilityReason, ...(candidate.reasonCodes ?? [])].map(eligibilityReasonLabel), serverVersionId: candidate.cteVersionId ?? "", pricingType: candidate.pricingType, calculationReadiness: candidate.calculationReadiness };
}
function text(value: unknown): string { return value === null || value === undefined || String(value).trim() === "" ? "Non disponibile" : String(value); }
function fieldValue(value: { readonly value?: unknown } | null | undefined): unknown { return value?.value ?? null; }
const IT_DATE_FORMATTER = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const IT_MONTH_FORMATTER = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const UI_SEPARATOR = "\u00b7";
const UI_RANGE_SEPARATOR = "\u2013";

function validIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatItalianDate(value: string | null | undefined): string {
  const date = validIsoDate(value);
  return date ? IT_DATE_FORMATTER.format(date) : "Non disponibile";
}

function formatItalianMonth(value: string | null | undefined): string {
  const date = validIsoDate(value);
  return date ? IT_MONTH_FORMATTER.format(date) : "Periodo non rilevato";
}

function formatEuro(value: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

function formatPower(value: number | null): string {
  return value === null ? "Non disponibile" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function formatConsumption(value: string): string {
  const parsed = Number(value.trim());
  return value.trim() === "" || !Number.isFinite(parsed) ? "Non disponibile" : formatPower(parsed);
}

function reviewText(field: { readonly value?: unknown; readonly status?: string } | null | undefined): string | null {
  if (!field || (field.status !== undefined && field.status !== "FOUND" && field.status !== "KNOWN")) return null;
  const value = field.value;
  return value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();
}

function formatQuantity(value: number | null): string {
  return value === null ? "Non rilevato" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function parseMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = value.trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoneyValue(value: string | number | null | undefined): string {
  const parsed = parseMoney(value);
  return parsed === null ? "Importo non rilevato" : formatEuro(parsed);
}

function pricingLabelFor(value: string): string {
  if (value === "FIXED") return "Prezzo fisso";
  if (value === "INDEXED_PUN_PLUS_SPREAD" || value === "INDEXED_OTHER") return "Prezzo indicizzato";
  if (value === "HYBRID") return "Struttura mista";
  return "Non rilevato";
}

function timeBandLabelFor(value: string): string {
  if (value === "MONORARIO") return "Monorario";
  if (value === "F1_F2_F3") return "F1 / F2 / F3";
  if (value === "F1_F23") return "F1 / F23";
  if (value === "OTHER_TIME_BANDS") return "Altra struttura oraria";
  return "Non rilevata";
}

function extraordinaryLabelFor(value: string): string {
  if (value === "CMOR") return "CMOR";
  if (value === "INTERESSI_MORA") return "Interessi di mora";
  if (value === "RICALCOLI") return "Conguagli o ricalcoli";
  if (value === "ADMINISTRATIVE_FEES") return "Oneri amministrativi";
  if (value === "ADDEBITI") return "Addebiti";
  if (value === "ACCREDITI") return "Accrediti";
  return "Altre partite";
}

function energyLabelFor(vector: "EE" | "GAS"): string {
  return vector === "EE" ? "Energia elettrica" : "Gas";
}

function voltageLabelFor(value: ServerSimulationContext["supply"]["voltageLevel"]): string {
  if (value === "LV") return "Bassa tensione (BT)";
  if (value === "MV") return "Media tensione (MT)";
  if (value === "HV") return "Alta tensione (AT)";
  if (value === "EHV") return "Altissima tensione";
  return "Tensione non rilevata";
}

function classificationLabelFor(scope: string | null): string {
  if (scope === "DOMESTIC_RESIDENT_BT") return "Domestico residente";
  if (scope === "DOMESTIC_NON_RESIDENT_BT") return "Domestico non residente";
  if (scope === "NON_DOMESTIC_BT") return "Non domestico";
  if (scope === "NON_DOMESTIC_BT_BTA6") return "Non domestico \u2013 BTA6";
  return "Classificazione non disponibile";
}

function draftFromContext(bill: BillDocumentModel, context: ServerSimulationContext): SimulationDraft | null {
  if (!bill.currentApprovedVersionId || !context.billId || !context.billVersionId) return null;
  const period = context.consumption.period;
  const reference = fieldValue(bill.analystReview.customer.taxIdentifier) ?? fieldValue(bill.analystReview.customer.name);
  return { billId: context.billId, billVersion: context.billVersionId, vector: context.vector, calculationDate: new Date().toISOString().slice(0, 10), periodStart: context.billingPeriod.periodStart, periodEnd: context.billingPeriod.periodEnd, customerCategory: context.customerType, taxTreatment: "EXCLUDED", customerReference: typeof reference === "string" ? reference : "", supplyReference: context.vector === "EE" ? context.supply.pod ?? "" : context.supply.pdr ?? "", voltageLevel: context.supply.voltageLevel ?? "", f1: period.f1 === null ? "" : String(period.f1), f2: period.f2 === null ? "" : String(period.f2), f3: period.f3 === null ? "" : String(period.f3), smc: period.smc === null ? "" : String(period.smc), monthlyProfile: context.consumption.monthlyProfile ?? undefined, correctionRequired: context.vector === "GAS" && context.consumption.correctionCoefficient !== null, correctionCoefficient: context.consumption.correctionCoefficient === null ? "" : String(context.consumption.correctionCoefficient), baseline: context.economicBaseline ? String(context.economicBaseline.amount) : "" };
}

function draftIsUsable(draft: SimulationDraft): boolean { if (!draft.billId || !draft.billVersion || !draft.periodStart || !draft.periodEnd || !draft.customerCategory || !draft.taxTreatment) return false; return draft.vector === "EE" ? Boolean(draft.voltageLevel && draft.f1 && draft.f2 && draft.f3) : Boolean(draft.smc); }

function powerSummaryFor(context: ServerSimulationContext): string {
  const base = `${voltageLabelFor(context.supply.voltageLevel)} ${UI_SEPARATOR} Potenza impegnata ${formatPower(context.supply.contractedPowerKw)} kW`;
  return context.supply.availablePowerKw === null ? base : `${base} ${UI_SEPARATOR} Potenza disponibile ${formatPower(context.supply.availablePowerKw)} kW`;
}

function BillSummary({ bill, draft, context }: { readonly bill: BillDocumentModel; readonly draft: SimulationDraft; readonly context: ServerSimulationContext }): ReactNode {
  const review = bill.analystReview;
  const holder = reviewText(review.customer.name);
  const typedIdentifiers = bill.normalized?.customer.taxIdentifiers ?? [];
  const taxCode = typedIdentifiers.find((item) => item.kind === "TAX_CODE")?.value ?? null;
  const vatNumber = reviewText(review.receipt.customerVatNumber);
  const supplier = reviewText(review.supply.supplier);
  const offer = reviewText(review.receipt.offerName);
  const pricing = review.receipt.priceMechanism === "UNKNOWN" ? null : pricingLabelFor(review.receipt.priceMechanism);
  const timeBands = review.receipt.priceTimeStructure === "UNKNOWN" ? null : timeBandLabelFor(review.receipt.priceTimeStructure);
  const supplyAddressParts = [reviewText(review.supply.address), reviewText(review.supply.cap), reviewText(review.supply.city), reviewText(review.supply.province)].filter((value): value is string => value !== null);
  const supplyAddress = supplyAddressParts.length ? supplyAddressParts.join(", ") : null;
  const supplyReference = draft.vector === "EE" ? reviewText(review.supply.pod) : reviewText(review.supply.pdr);
  const supplyReferenceLabel = draft.vector === "EE" ? "POD" : "PDR";
  const invoiceTotal = parseMoney(reviewText(review.economics.total));
  const extraordinaryItems = review.economics.economicAnalysis.components
    .filter((item) => item.status === "FOUND" && ["CMOR", "INTERESSI_MORA", "RICALCOLI", "ADMINISTRATIVE_FEES", "ADDEBITI", "ACCREDITI", "ALTRE_PARTITE"].includes(item.classification))
    .map((item) => ({ label: extraordinaryLabelFor(item.classification), amount: formatMoneyValue(item.amount) }));
  const identifierRows = [
    ...(taxCode ? [{ label: "Codice fiscale", value: taxCode }] : []),
    ...(vatNumber ? [{ label: "Partita IVA", value: vatNumber }] : []),
  ];
  const expiry = reviewText(review.dates.contractExpiryDate);
  return <div className="data-list">
    <div className="data-line"><span>Intestatario</span><strong>{holder ?? "Non rilevato"}</strong></div>
    {identifierRows.map((row) => <div className="data-line" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
    {supplyAddress ? <div className="data-line"><span>Indirizzo di fornitura</span><strong>{supplyAddress}</strong></div> : null}
    {supplyReference ? <div className="data-line"><span>{supplyReferenceLabel}</span><strong>{supplyReference}</strong></div> : null}
    <div className="data-line"><span>Utenza</span><strong>{energyLabelFor(context.vector)} {UI_SEPARATOR} {classificationLabelFor(context.classification.regulatoryCustomerScope)}</strong></div>
    <div className="data-line"><span>Periodo bolletta</span><strong>{formatItalianDate(context.billingPeriod.periodStart)} {UI_RANGE_SEPARATOR} {formatItalianDate(context.billingPeriod.periodEnd)}</strong></div>
    <div className="data-line"><span>Fornitore</span><strong>{supplier ?? "Non rilevato"}</strong></div>
    {offer ? <div className="data-line"><span>Offerta attuale</span><strong>{offer}</strong></div> : null}
    {pricing ? <div className="data-line"><span>Tipo prezzo</span><strong>{pricing}</strong></div> : null}
    {timeBands ? <div className="data-line"><span>Struttura oraria</span><strong>{timeBands}</strong></div> : null}
    {draft.vector === "EE" ? <div className="data-list"><div className="data-line"><span>F1</span><strong>{formatQuantity(context.consumption.period.f1)} kWh</strong></div><div className="data-line"><span>F2</span><strong>{formatQuantity(context.consumption.period.f2)} kWh</strong></div><div className="data-line"><span>F3</span><strong>{formatQuantity(context.consumption.period.f3)} kWh</strong></div><div className="data-line"><span>Consumo annuo</span><strong>{formatQuantity(context.consumption.annual)} kWh</strong></div></div> : <div className="data-list"><div className="data-line"><span>Consumo periodo</span><strong>{formatQuantity(context.consumption.period.smc)} Smc</strong></div><div className="data-line"><span>Consumo annuo</span><strong>{formatQuantity(context.consumption.annual)} Smc</strong></div></div>}
    {draft.vector === "EE" ? <div className="data-line"><span>Tensione / potenza</span><strong>{powerSummaryFor(context)}</strong></div> : null}
    <div className="data-line"><span>Scadenza contratto</span><strong>{expiry ? formatItalianDate(expiry) : "Non rilevata"}</strong></div>
    <div className="data-line"><span>Totale bolletta</span><strong>{formatMoneyValue(invoiceTotal)}</strong></div>
    {context.alerts.map((alert) => <p className="inline-warning" role="status" key={alert.code}>{alert.message}</p>)}
    {extraordinaryItems.length ? <><p className="inline-warning" role="status">Questa bolletta contiene voci straordinarie che non devono essere considerate automaticamente nel confronto dell&apos;offerta.</p><div className="data-list"><strong>Voci da verificare</strong>{extraordinaryItems.map((item, index) => <div className="data-line" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.amount}</strong></div>)}</div></> : null}
    {context.missingRequiredData.length ? <p className="inline-warning" role="status">Dati insufficienti per la simulazione</p> : null}
  </div>;
}

export default function BillDrivenSimulationPanel({ tenantId, readonly, prefill, onCalculation, onComparison }: { readonly tenantId: string | null; readonly readonly: boolean; readonly prefill: SimulationDraft | null; readonly onCalculation: (result: CalculationModel, draft: SimulationDraft) => void; readonly onComparison: (result: ComparisonModel, draft: SimulationDraft) => void }): ReactNode {
  const [bills, setBills] = useState<readonly ApprovedBillSummaryModel[]>([]);
  const [billState, setBillState] = useState<BillLoadState>("loading");
  const [selectedBill, setSelectedBill] = useState<BillDocumentModel | null>(null);
  const [context, setContext] = useState<ServerSimulationContext | null>(null);
  const [draft, setDraft] = useState<SimulationDraft | null>(null);
  const [candidates, setCandidates] = useState<readonly Candidate[]>([]);
  const [selectedCteId, setSelectedCteId] = useState("");
  const [overrideUi, setOverrideUi] = useState<OverrideUiState | null>(null);
  const [cteState, setCteState] = useState<CteLoadState>("idle");
  const [pending, setPending] = useState<"calculation" | "comparison" | "bill" | "override">();
  const [error, setError] = useState<string>();

  const loadBills = useCallback(async (signal?: AbortSignal) => { setBillState("loading"); try { const result = await requestJson<{ readonly documents: readonly ApprovedBillSummaryModel[] }>("/api/bills?view=approved", {}, signal); setBills(result.documents); setBillState("ready"); } catch (cause) { if (!signal?.aborted) { setBillState("error"); setError(messageFor(cause)); } } }, []);
  const selectBill = useCallback(async (billId: string) => {
    if (!billId) { setSelectedBill(null); setContext(null); setDraft(null); setCandidates([]); setSelectedCteId(""); setOverrideUi(null); return; }
    setPending("bill"); setError(undefined); setContext(null); setDraft(null); setCandidates([]); setSelectedCteId(""); setCteState("loading");
    try {
      const billResult = await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(billId)}?view=approved`);
      const billVersionId = billResult.document.currentApprovedVersionId ?? "";
      const overrideState = await requestJson<OverrideUiState>(`/api/eligibility/override?billId=${encodeURIComponent(billId)}&billVersionId=${encodeURIComponent(billVersionId)}`);
      const prepared = await requestJson<{ readonly context: ServerSimulationContext; readonly candidates: readonly ServerCandidate[] }>(`/api/simulation/context?billId=${encodeURIComponent(billId)}&taxTreatment=EXCLUDED`);
      const nextDraft = draftFromContext(billResult.document, prepared.context);
      if (!nextDraft) throw new Error("Dati insufficienti per la simulazione");
      setSelectedBill(billResult.document); setContext(prepared.context); setDraft(nextDraft);
      setOverrideUi(overrideState);
      setCandidates(prepared.candidates.map((candidate) => candidateFromServer(candidate, overrideState.overrides, prepared.context)));
      setCteState("ready");
    } catch (cause) { setSelectedBill(null); setContext(null); setDraft(null); setCteState("error"); setError(cause instanceof Error && cause.message === "Dati insufficienti per la simulazione" ? cause.message : messageFor(cause)); } finally { setPending(undefined); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void loadBills(controller.signal); return () => controller.abort(); }, [loadBills]);
  useEffect(() => { if (prefill?.billId && bills.some((bill) => bill.id === prefill.billId) && selectedBill?.id !== prefill.billId) void selectBill(prefill.billId); }, [bills, prefill, selectBill, selectedBill?.id]);

  const compatible = candidates.filter((candidate) => candidate.compatible);
  const selectedCte = compatible.find((candidate) => candidate.summary.archiveId === selectedCteId) ?? null;
  const requestOverride = async (candidate: Candidate): Promise<void> => {
    if (!draft || !context || !overrideUi?.capabilities.canRequest || !candidate.overrideRequestable || candidate.finalStatus !== "NOT_ELIGIBLE") return;
    const selectedContext = context;
    const reason = window.prompt("Motivo obbligatorio per la richiesta di autorizzazione", "")?.trim() ?? "";
    if (!reason) { setError("Inserire un motivo per richiedere l'autorizzazione"); return; }
    setPending("override"); setError(undefined);
    try { await requestJson("/api/eligibility/override", { method: "POST", body: JSON.stringify({ action: "request", billId: selectedContext.billId, billVersionId: selectedContext.billVersionId, cteId: candidate.cteId, reason }) }); await selectBill(selectedContext.billId); } catch (cause) { setError(messageFor(cause)); } finally { setPending(undefined); }
  };
  const authorizeOverride = async (candidate: Candidate): Promise<void> => {
    const override = candidate.override;
    if (!overrideUi?.capabilities.canAuthorize || override?.status !== "REQUESTED") return;
    const reason = window.prompt("Motivo obbligatorio per autorizzare l'eccezione", override.reason)?.trim() ?? "";
    if (!reason) { setError("Inserire un motivo per autorizzare l'eccezione"); return; }
    setPending("override"); setError(undefined);
    try { await requestJson("/api/eligibility/override", { method: "POST", body: JSON.stringify({ action: "authorize", overrideId: override.overrideId, reason }) }); await selectBill(override.billId); } catch (cause) { setError(messageFor(cause)); } finally { setPending(undefined); }
  };
  const rejectOverride = async (candidate: Candidate): Promise<void> => {
    const override = candidate.override;
    if (!overrideUi?.capabilities.canReject || override?.status !== "REQUESTED") return;
    const reason = window.prompt("Motivo obbligatorio per rifiutare la richiesta", "")?.trim() ?? "";
    if (!reason) { setError("Inserire un motivo per rifiutare la richiesta"); return; }
    setPending("override"); setError(undefined);
    try { await requestJson("/api/eligibility/override", { method: "POST", body: JSON.stringify({ action: "reject", overrideId: override.overrideId, reason }) }); await selectBill(override.billId); } catch (cause) { setError(messageFor(cause)); } finally { setPending(undefined); }
  };
  const run = async (kind: "calculation" | "comparison") => {
    if (readonly || !tenantId || !draft || !selectedBill || !selectedCte || pending || !draftIsUsable(draft) || selectedCte.calculationReadiness !== "READY") { if (!draft || !draftIsUsable(draft)) setError("Dati insufficienti per la simulazione"); else if (selectedCte?.calculationReadiness !== "READY") setError("CTE compatibile - dati di mercato non disponibili"); return; }
    setPending(kind); setError(undefined);
    const binding = { billId: draft.billId, billVersionId: draft.billVersion, cteId: selectedCte.summary.archiveId, cteVersionId: selectedCte.serverVersionId, taxTreatment: draft.taxTreatment, calculationDate: draft.calculationDate, ...(selectedCte.finalStatus === "ELIGIBLE_BY_OVERRIDE" && selectedCte.override?.status === "AUTHORIZED" ? { eligibilityOverrideId: selectedCte.override.overrideId } : {}) };
    try {
      if (kind === "calculation") {
        const result = await requestJson<{ readonly result: CalculationModel }>("/api/simulation/execute", { method: "POST", body: JSON.stringify(binding) });
        onCalculation(result.result, { ...draft, archiveId: selectedCte.summary.archiveId });
      } else {
        const result = await requestJson<{ readonly result: ComparisonModel }>("/api/comparison", { method: "POST", body: JSON.stringify({ sourceBill: { billId: draft.billId, version: draft.billVersion }, cteId: selectedCte.summary.archiveId, cteVersionId: selectedCte.serverVersionId, ...(selectedCte.finalStatus === "ELIGIBLE_BY_OVERRIDE" && selectedCte.override?.status === "AUTHORIZED" ? { eligibilityOverrideId: selectedCte.override.overrideId } : {}) }) });
        onComparison(result.result, { ...draft, archiveId: selectedCte.summary.archiveId });
      }
    } catch (cause) { setError(messageFor(cause)); } finally { setPending(undefined); }
  };

  return <div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">MOTORE PHASE 4</p><h2>Simulazioni</h2><p className="section-detail">Il flusso parte da una bolletta approvata: dati tecnici, CTE compatibili, simulazione e confronto.</p></div></div>
    <div className="two-columns">
      <section className="ui-card"><h3>1 {UI_SEPARATOR} Seleziona bolletta</h3>{billState === "loading" ? <LoadingState label="Caricamento bollette approvate" /> : billState === "error" ? <ErrorState message="Elenco bollette non disponibile" onRetry={() => void loadBills()} /> : bills.length ? <label className="form-field"><span className="form-label">Bolletta revisionata e utilizzabile</span><select id="simulation-bill" value={selectedBill?.id ?? ""} onChange={(event) => void selectBill(event.target.value)} disabled={pending === "bill" || pending === "override"}><option value="">Selezionare</option>{bills.map((bill) => <option key={bill.id} value={bill.id}>{bill.title} {UI_SEPARATOR} {energyLabelFor(bill.vector)} {UI_SEPARATOR} {formatItalianMonth(bill.period.periodStart)}</option>)}</select></label> : <EmptyState title="Nessuna bolletta utilizzabile" detail="Sono mostrate solo bollette approvate nello scope dell'utente." />}</section>
      <section className="ui-card"><h3>2 {UI_SEPARATOR} Dati rilevati</h3>{pending === "bill" ? <LoadingState label="Lettura contesto autorevole" /> : selectedBill && draft && context ? <BillSummary bill={selectedBill} draft={draft} context={context} /> : <EmptyState title="Selezionare una bolletta" detail="La simulazione non accetta dati tecnici principali inseriti manualmente." />}</section>
    </div>
    {selectedBill && draft && context ? <section className="ui-card">
      <h3>3 {UI_SEPARATOR} CTE candidate</h3><p className="muted">Vettore {energyLabelFor(draft.vector)} {UI_SEPARATOR} {classificationLabelFor(context.classification.regulatoryCustomerScope)}{draft.vector === "EE" ? `${UI_SEPARATOR} ${voltageLabelFor(context.supply.voltageLevel)}` : ""}</p>
      {cteState === "loading" ? <LoadingState label="Verifica compatibilita CTE" /> : cteState === "error" ? <ErrorState message="CTE compatibili non disponibili" /> : compatible.length ? <label className="form-field"><span className="form-label">CTE da utilizzare</span><select id="simulation-cte" value={selectedCteId} onChange={(event) => { setSelectedCteId(event.target.value); setError(undefined); }}><option value="">Selezionare una CTE compatibile</option>{compatible.map((candidate) => <option key={candidate.summary.archiveId} value={candidate.summary.archiveId}>{candidate.summary.supplierName} {UI_SEPARATOR} {candidate.summary.offerName} {UI_SEPARATOR} {finalStatusLabel(candidate.finalStatus)}</option>)}</select></label> : <p className="inline-warning" role="status">Nessuna CTE utilizzabile disponibile</p>}
      {candidates.some((candidate) => !candidate.compatible) ? <details open><summary>CTE escluse ({candidates.filter((candidate) => !candidate.compatible).length})</summary><div className="data-list">{candidates.filter((candidate) => !candidate.compatible).map((candidate) => <div className="data-line" key={candidate.summary.archiveId}><span>{candidate.summary.supplierName} {UI_SEPARATOR} {candidate.summary.offerName}</span><strong>{finalStatusLabel(candidate.finalStatus)}</strong>{candidate.reasons.map((reason) => <small key={reason}>{reason}</small>)}{candidate.override?.status === "REQUESTED" ? <small role="status">Autorizzazione richiesta</small> : null}{candidate.override?.status === "REJECTED" ? <small role="status">Richiesta rifiutata</small> : null}{candidate.override?.status === "EXPIRED" ? <small role="status">Autorizzazione scaduta</small> : null}{candidate.finalStatus === "BLOCKED" ? <small role="status">Stato bloccato: non è possibile richiedere un&apos;eccezione</small> : null}{candidate.overrideRequestable && candidate.override?.status === undefined && overrideUi?.capabilities.canRequest ? <button className="button secondary" type="button" disabled={Boolean(pending)} onClick={() => void requestOverride(candidate)}>Richiedi autorizzazione</button> : null}{candidate.override?.status === "REQUESTED" && overrideUi?.capabilities.canAuthorize ? <><button className="button primary" type="button" disabled={Boolean(pending)} onClick={() => void authorizeOverride(candidate)}>Autorizza eccezione</button><button className="button secondary" type="button" disabled={Boolean(pending)} onClick={() => void rejectOverride(candidate)}>Rifiuta richiesta</button></> : null}</div>)}</div></details> : null}
    </section> : null}
    {selectedCte && draft ? <section className="ui-card"><h3>4 {UI_SEPARATOR} Esegui simulazione</h3><div className="data-list"><div className="data-line"><span>CTE selezionata</span><strong>{selectedCte.summary.supplierName} {UI_SEPARATOR} {selectedCte.summary.offerName} {UI_SEPARATOR} {finalStatusLabel(selectedCte.finalStatus)}</strong></div><div className="data-line"><span>Origine</span><strong>Bolletta approvata</strong></div></div><div className="button-row"><button className="button primary" type="button" disabled={readonly || Boolean(pending)} onClick={() => void run("calculation")}>{pending === "calculation" ? "Calcolo" : "Esegui simulazione"}</button><button className="button secondary" type="button" disabled={readonly || Boolean(pending)} onClick={() => void run("comparison")}>{pending === "comparison" ? "Confronto" : "Esegui confronto"}</button></div></section> : null}
    {error ? <ErrorState message={error} /> : null}
  </div>;
}
