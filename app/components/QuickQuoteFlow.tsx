"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "./UiStates";
import { downloadExport, requestForm, requestJson, toUiError } from "../lib/ui/client";
import { buildQuoteReceipt, type QuoteReceipt } from "../lib/quote/receipt";
import type { ApprovedBillSummaryModel, BillDocumentModel, CalculationModel, ComparisonModel, ProposalModel } from "../lib/ui/models";

type Step = "bill" | "review" | "offers";
type Pending = "upload" | "open" | "confirm" | "offers" | "proposal";
type Context = {
  readonly billId: string; readonly billVersionId: string; readonly vector: "EE" | "GAS"; readonly customerType: "RESIDENTIAL" | "NON_RESIDENTIAL";
  readonly supply: { readonly pod: string | null; readonly pdr: string | null; readonly voltageLevel: "LV" | "MV" | "HV" | "EHV" | null; readonly contractedPowerKw?: number | null };
  readonly consumption?: { readonly annual: number | null; readonly period: { readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly smc: number | null } };
  readonly currentOffer?: { readonly name: string | null; readonly code: string | null };
  readonly billingPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly currentSupplier: string;
  readonly classification: { readonly domestic: boolean };
  readonly missingRequiredData: readonly string[];
};
type Candidate = { readonly archiveId: string; readonly cteVersionId: string | null; readonly supplier: string; readonly offer: { readonly name: string; readonly code: string }; readonly validity: { readonly periodStart: string; readonly periodEnd: string }; readonly finalStatus?: string; readonly calculationReadiness: string; readonly compatibilityReason?: string };
type Offer = { readonly rank: number; readonly calculation: CalculationModel; readonly supplier: string; readonly offerName: string; readonly receipt: QuoteReceipt };
type Quote = { readonly bill: BillDocumentModel; readonly context: Context; readonly comparison: ComparisonModel; readonly offers: readonly Offer[]; readonly candidates?: readonly Candidate[] };

// The seven fields the server needs confirmed before a bill can be used.
const FIELDS: readonly { readonly name: string; readonly label: string }[] = [
  { name: "customerName", label: "Intestatario" }, { name: "supplier", label: "Fornitore attuale" }, { name: "pod", label: "POD / PDR" }, { name: "billingPeriod", label: "Periodo fatturato" },
  { name: "billedConsumption", label: "Consumo fatturato" }, { name: "annualConsumption", label: "Consumo annuo" }, { name: "totalAmount", label: "Totale bolletta" },
];
const NUMERIC_FIELDS = new Set(["billedConsumption", "annualConsumption", "totalAmount"]);
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/g;
const IT_DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
// Read values are machine-formatted (1658.683, 2026-09-01); the agent reads and types them the Italian way.
function toDisplay(name: string, raw: string | null | undefined): string {
  const value = raw ?? "";
  if (NUMERIC_FIELDS.has(name) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const decimals = value.split(".")[1]?.length ?? 0;
    // Thousands always get a dot, also on four-digit numbers (1.658,683).
    const fixed = Number(value).toFixed(name === "totalAmount" ? Math.max(2, decimals) : decimals);
    const [whole, fraction] = fixed.split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fraction ? `,${fraction}` : ""}`;
  }
  if (name === "billingPeriod") return value.replace(ISO_DATE, (_, y, m, d) => `${d}/${m}/${y}`);
  return value;
}
function toMachine(name: string, display: string, raw: string | null | undefined): string {
  const value = display.trim();
  if (value === toDisplay(name, raw).trim()) return raw ?? "";
  if (NUMERIC_FIELDS.has(name)) {
    const plain = value.replace(/[€\s]/g, "");
    const normalized = plain.includes(",") ? plain.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(plain) ? plain.replace(/\./g, "") : plain;
    return normalized;
  }
  if (name === "billingPeriod") return value.replace(IT_DATE, (_, d, m, y) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  return value;
}
// Consumption is in kWh for electricity and Smc for gas; amounts are in euro.
function unitOf(name: string, vector: string): string {
  if (name === "billedConsumption" || name === "annualConsumption") return vector === "GAS" ? " (Smc)" : " (kWh)";
  return name === "totalAmount" ? " (€)" : "";
}
const MAX_BILL_BYTES = 10 * 1024 * 1024;
const DATE = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const PERCENT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function euro(value: number | null): string { return value === null ? "—" : EURO.format(value); }
function date(value: string | null): string { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? DATE.format(new Date(`${value}T00:00:00Z`)) : "Non indicata"; }
function daysUntil(value: string | null, today: string): number | null { return value ? Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null; }
function message(cause: unknown): string { return toUiError(cause).message; }
const NUMBER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
function amount(value: number | null | undefined, unit: string): string { return value === null || value === undefined ? "—" : `${NUMBER.format(value)} ${unit}`; }
const VOLTAGE: Record<string, string> = { LV: "Bassa tensione (BT)", MV: "Media tensione (MT)", HV: "Alta tensione (AT)", EHV: "Altissima tensione (AAT)" };
const MISSING: Record<string, string> = { customerType: "tipo cliente", billingPeriod: "periodo fatturato", POD: "POD", PDR: "PDR", voltageLevel: "livello di tensione", F1: "consumo F1", F2: "consumo F2", F3: "consumo F3", SMC: "consumo in Smc", technicalClassification: "uso della fornitura" };
// Why a CTE is not proposed for this bill, in the words the agent reads.
const EXCLUSION: Record<string, string> = {
  CTE_NOT_ACTIVE: "CTE bloccata", REVIEW_REQUIRED: "CTE da riapprovare", CTE_EXPIRED: "CTE scaduta", VECTOR_MISMATCH: "Tipo fornitura diverso",
  CTE_VALIDITY_MISMATCH: "Non ancora sottoscrivibile", CUSTOMER_NOT_ELIGIBLE: "Tipo cliente non ammesso (Consumer/Business)", VOLTAGE_NOT_ELIGIBLE: "Livello di tensione non previsto",
  TAX_TREATMENT_INCOMPATIBLE: "Trattamento fiscale diverso", IMBALANCE_UNAVAILABLE: "Sbilanciamento non indicato nella CTE", FEE_UNIT_MISMATCH: "Unità dei costi non coerente",
  BILL_DATA_INSUFFICIENT: "Dati della bolletta incompleti", MONTHLY_PROFILE_REQUIRED: "Servono i consumi mese per mese", COMPATIBLE_MARKET_DATA_UNAVAILABLE: "Manca l'indice PUN/PSV del periodo", CALCULATION_READY_INVALID: "CTE non calcolabile", COMPATIBLE: "Calcolo non riuscito per questa bolletta",
};
function exclusion(candidate: Candidate): string { return EXCLUSION[candidate.compatibilityReason ?? ""] ?? "Non adatta a questa bolletta"; }

function italianDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}
function monthsIn(period: { readonly periodStart: string | null; readonly periodEnd: string | null } | undefined): number | null {
  if (!period?.periodStart || !period.periodEnd) return null;
  const days = (Date.parse(`${period.periodEnd}T00:00:00Z`) - Date.parse(`${period.periodStart}T00:00:00Z`)) / 86_400_000 + 1;
  return days > 0 ? Math.max(1, Math.round(days / 30.4)) : null;
}
function decimal(value: string | null | undefined): number | null {
  if (!value) return null;
  const plain = value.replace(/[^\d,.-]/g, "");
  const parsed = Number(plain.includes(",") ? plain.replace(/\./g, "").replace(",", ".") : plain);
  return Number.isFinite(parsed) ? parsed : null;
}
const SELLER_FIXED_CODES = new Set(["PCV", "COMMERCIALIZATION_FIXED_FEE", "SELLER_FIXED_FEE", "SELLER_FIXED", "COMMERCIALIZATION", "OTHER_SELLER_FIXED_CHARGE"]);
const PER_MONTH = /mese|month|€\/m\b|eur\/m\b/i;
function factValue(bill: BillDocumentModel, ...codes: readonly string[]): string | null {
  for (const code of codes) {
    const found = bill.structuredBill?.extendedFacts.find((fact) => fact.code === code && fact.status === "FOUND" && fact.value.trim());
    if (found) return found.value.trim();
  }
  return null;
}
// Monthly PCV: the seller's fixed fee (PCV, quota fissa di vendita, commercializzazione) per month, never network or power charges.
function monthlyPcv(bill: BillDocumentModel): number | null {
  const lines = (bill.structuredBill?.economicChargeLines ?? []).filter((line) => {
    const text = `${line.description} ${line.rawDescription ?? ""}`;
    const unit = `${line.unit} ${line.rawUnit ?? ""}`;
    if (/kw\b|kw\/|potenza|rete|oneri|trasporto|distribuzione/i.test(`${text} ${unit}`) && !/pcv|vendita/i.test(text)) return false;
    return SELLER_FIXED_CODES.has(line.code) || /\bpcv\b|commercializzazione|quota fissa.*vendita|vendita.*quota fissa/i.test(text) || (/vendita/i.test(text) && PER_MONTH.test(unit));
  });
  const perMonth = lines.find((line) => PER_MONTH.test(`${line.unit} ${line.rawUnit ?? ""}`) && decimal(line.unitPrice) !== null);
  if (perMonth) return decimal(perMonth.unitPrice);
  const fact = decimal(factValue(bill, "PCV", "COMMERCIALIZATION_FIXED_FEE", "SELLER_FIXED_FEE"));
  if (fact !== null) return fact;
  if (!lines.length) return null;
  const total = lines.reduce((sum, line) => sum + (decimal(line.amount) ?? 0), 0);
  const read = bill.structuredBill?.billingPeriod;
  const months = monthsIn(bill.normalized?.billingPeriod ?? (read?.status === "FOUND" && read.value ? { periodStart: read.value.from, periodEnd: read.value.to } : undefined));
  return months ? total / months : null;
}
function priceType(bill: BillDocumentModel): string {
  const receipt = bill.analystReview.receipt;
  const text = [factValue(bill, "PRICE_MECHANISM_RAW"), factValue(bill, "PRICE_FORMULA_RAW"), factValue(bill, "INDEX_NAME")].filter(Boolean).join(" ");
  const index = /psv/i.test(text) || bill.resolvedVector === "GAS" ? "PSV" : "PUN";
  const spread = factValue(bill, "SPREAD", "ENERGY_SPREAD");
  const fixed = factValue(bill, "FIXED_PRICE", "ENERGY_FIXED_PRICE", "MONORARIO_PRICE");
  const indexed = /variabil|indicizz|pun|psv|index/i.test(text) || receipt.priceMechanism === "INDEXED_PUN_PLUS_SPREAD";
  if (indexed) return `Indicizzato ${index}${spread ? ` + spread ${spread}` : ""}`;
  if (/fiss/i.test(text) || receipt.priceMechanism === "FIXED") return `Prezzo fisso${fixed ? ` ${fixed}` : ""}`;
  return receipt.priceMechanism === "HYBRID" ? "Misto (fisso e indicizzato)" : "Non indicato";
}

function BillContractFacts({ bill }: { readonly bill: BillDocumentModel }): ReactNode {
  const receipt = bill.analystReview.receipt;
  const type = bill.structuredBill?.customerType.status === "FOUND" ? bill.structuredBill.customerType.value : null;
  const start = italianDate(receipt.contractStartDate.value ?? factValue(bill, "CONTRACT_START_DATE")) ?? italianDate(receipt.economicConditionsStartDate.value ?? factValue(bill, "ECONOMIC_CONDITIONS_START_DATE"));
  const conditionsEnd = italianDate(receipt.economicConditionsExpiryDate.value ?? factValue(bill, "ECONOMIC_EXPIRY"));
  const contractEnd = receipt.contractDurationType === "INDEFINITE" || /indeterminat/i.test(factValue(bill, "CONTRACT_EXPIRY", "CONTRACT_INDEFINITE") ?? "") ? "contratto a tempo indeterminato" : italianDate(receipt.contractExpiryDate.value);
  const expiry = [conditionsEnd ? `Condizioni fino al ${conditionsEnd}` : null, contractEnd ? (conditionsEnd ? contractEnd : contractEnd.replace(/^c/, "C")) : null].filter(Boolean).join(" · ");
  const pcv = monthlyPcv(bill);
  const rows: readonly (readonly [string, ReactNode])[] = [
    ["Tipo contratto", type === "RESIDENTIAL" ? <span className="cte-segment-consumer">Consumer</span> : type === "NON_RESIDENTIAL" ? <span className="cte-segment-business">Business</span> : "Non indicato"],
    ["Attivo dal", start ?? "Non indicato"],
    ["Scadenza o rinnovo", expiry || "Non indicata"],
    ["Tipo di prezzo", priceType(bill)],
    ["PCV mensile (quota fissa vendita)", pcv === null ? "Non indicata" : `${EURO.format(pcv)} al mese`],
  ];
  return <dl className="quote-bill-grid quote-contract-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function BillSummary({ context }: { readonly context: Context }): ReactNode {
  const ee = context.vector === "EE";
  const period = context.consumption?.period;
  const rows: readonly (readonly [string, string])[] = [
    ["Tipo fornitura", ee ? "Energia elettrica" : "Gas"],
    ["Cliente", context.customerType === "RESIDENTIAL" ? "Consumer" : "Business"],
    [ee ? "POD" : "PDR", (ee ? context.supply.pod : context.supply.pdr) ?? "—"],
    ...(ee ? [["Tensione", context.supply.voltageLevel ? VOLTAGE[context.supply.voltageLevel] : "—"] as const, ["Potenza impegnata", amount(context.supply.contractedPowerKw, "kW")] as const] : []),
    ["Fornitore attuale", [context.currentSupplier, context.currentOffer?.name].filter(Boolean).join(" · ") || "—"],
    ["Periodo fatturato", `${date(context.billingPeriod.periodStart)} – ${date(context.billingPeriod.periodEnd)}`],
    ["Consumo del periodo", ee ? `F1 ${amount(period?.f1, "kWh")} · F2 ${amount(period?.f2, "kWh")} · F3 ${amount(period?.f3, "kWh")}` : amount(period?.smc, "Smc")],
    ["Consumo annuo", amount(context.consumption?.annual, ee ? "kWh" : "Smc")],
  ];
  return <section className="ui-card quote-bill-summary"><h3>Dati della bolletta usati per la scelta</h3>
    <dl className="quote-bill-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {context.missingRequiredData.length ? <p className="quote-missing" role="alert">Mancano: {context.missingRequiredData.map((code) => MISSING[code] ?? code).join(", ")}. Ricarica una bolletta più completa o chiedi all'amministratore di correggerla.</p> : null}
  </section>;
}

function offersFrom(bill: BillDocumentModel, context: Context, candidates: readonly Candidate[], comparison: ComparisonModel): readonly Offer[] {
  // The server ranks the offers; the list keeps its order.
  return comparison.ranking.flatMap((entry) => {
    const calculation = comparison.results.find((item) => item.calculationId === entry.calculationId);
    if (!calculation) return [];
    // Only the CTEs the eligibility check allows for this bill are offered.
    const candidate = candidates.find((item) => item.archiveId === calculation.sourceCte.archiveId && (item.finalStatus === "ELIGIBLE" || item.finalStatus === "ELIGIBLE_BY_OVERRIDE"));
    if (!candidate) return [];
    const receipt = buildQuoteReceipt({ vector: calculation.vector, offerSupplyCost: calculation.totalCommercialCost.amount, analysis: bill.analystReview.economics.economicAnalysis, domestic: context.classification.domestic, validUntil: candidate.validity.periodEnd });
    return [{ rank: entry.rank, calculation, supplier: entry.supplier, offerName: candidate.offer.name || entry.offerCode, receipt }];
  });
}

function Steps({ step }: { readonly step: Step }): ReactNode {
  const items: readonly { readonly id: Step; readonly label: string }[] = [{ id: "bill", label: "Carica la bolletta" }, { id: "review", label: "Dati letti" }, { id: "offers", label: "Scegli l'offerta" }];
  const current = items.findIndex((item) => item.id === step);
  return <ol className="quote-steps">{items.map((item, index) => <li key={item.id} className={index === current ? "active" : index < current ? "done" : ""}><span>{index + 1}</span>{item.label}</li>)}</ol>;
}

function Receipt({ offer, today }: { readonly offer: Offer; readonly today: string }): ReactNode {
  const receipt = offer.receipt;
  const left = daysUntil(receipt.validUntil, today);
  const saving = receipt.savings ?? 0;
  return <section className="ui-card quote-receipt" aria-label="Scontrino dell'energia">
    <p className="eyebrow">SCONTRINO DELL&apos;ENERGIA</p>
    <h3>{offer.supplier} · {offer.offerName}</h3>
    {receipt.status === "COMPLETE" ? <div className={saving >= 0 ? "quote-saving" : "quote-saving negative"}>
      <span>{saving >= 0 ? "Risparmio sulla bolletta caricata" : "Costo in più sulla bolletta caricata"}</span>
      <strong>{euro(Math.abs(saving))}{receipt.savingsPercent !== null ? ` (${PERCENT.format(Math.abs(receipt.savingsPercent))}%)` : ""}</strong>
    </div> : <p className="inline-warning" role="status">La bolletta non riporta la spesa per la materia energia: mostriamo solo il costo della nuova offerta.</p>}
    <div className="responsive-table"><table>
      <thead><tr><th scope="col">Voce</th><th scope="col">Bolletta attuale</th><th scope="col">Nuova offerta</th></tr></thead>
      <tbody>{receipt.rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{euro(row.current)}</td><td>{euro(row.offer)}</td></tr>)}</tbody>
      {receipt.status === "COMPLETE" ? <tfoot><tr><th scope="row">{receipt.taxesIncluded ? "Totale" : "Totale imposte escluse"}</th><td>{euro(receipt.currentTotal)}</td><td>{euro(receipt.offerTotal)}</td></tr></tfoot> : null}
    </table></div>
    <div className="quote-validity">
      <span>Offerta valida fino al</span><strong>{date(receipt.validUntil)}</strong>
      <small>{left === null ? "Verifica la scadenza sulla CTE prima di firmare." : left < 0 ? "Offerta scaduta: non può più essere firmata." : `Il cliente deve firmare il contratto entro questa data${left <= 7 ? ` (mancano ${left} giorni)` : ""}.`}</small>
    </div>
    <p className="muted quote-note">Calcolo sugli stessi consumi e sullo stesso periodo della bolletta. Trasporto, oneri di sistema e accise non dipendono dal fornitore e restano quelli della bolletta{receipt.vatRate !== null ? `; IVA al ${PERCENT.format(receipt.vatRate * 100)}%${receipt.vatRateEstimated ? " stimata" : ""}` : ""}.</p>
  </section>;
}

export default function QuickQuoteFlow({ readonly }: { readonly readonly: boolean }): ReactNode {
  const [step, setStep] = useState<Step>("bill");
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState<string>();
  const [archive, setArchive] = useState<readonly ApprovedBillSummaryModel[]>([]);
  const [draft, setDraft] = useState<BillDocumentModel | null>(null);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalModel | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const loadArchive = useCallback(async () => { try { const result = await requestJson<{ readonly documents: readonly ApprovedBillSummaryModel[] }>("/api/bills?view=approved"); setArchive(result.documents); } catch { setArchive([]); } }, []);
  useEffect(() => { void loadArchive(); }, [loadArchive]);

  const loadOffers = async (billId: string) => {
    setPending("offers"); setError(undefined); setQuote(null); setProposal(null); setStep("offers");
    try {
      const bill = (await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(billId)}?view=approved`)).document;
      const prepared = await requestJson<{ readonly context: Context; readonly candidates: readonly Candidate[] }>(`/api/simulation/context?billId=${encodeURIComponent(billId)}&taxTreatment=EXCLUDED`);
      const anchor = prepared.candidates.find((item) => item.finalStatus === "ELIGIBLE" && item.calculationReadiness === "READY" && item.cteVersionId);
      if (!anchor) { setQuote({ bill, context: prepared.context, comparison: { comparisonId: "", fingerprint: "", tenantId: "", vector: prepared.context.vector, results: [], excludedOffers: [], ranking: [], warnings: [] }, offers: [], candidates: prepared.candidates }); return; }
      const comparison = (await requestJson<{ readonly result: ComparisonModel }>("/api/comparison", { method: "POST", body: JSON.stringify({ sourceBill: { billId, version: prepared.context.billVersionId }, cteId: anchor.archiveId, cteVersionId: anchor.cteVersionId }) })).result;
      const offers = offersFrom(bill, prepared.context, prepared.candidates, comparison);
      setQuote({ bill, context: prepared.context, comparison, offers, candidates: prepared.candidates });
      setSelectedId(offers[0]?.calculation.calculationId ?? null);
    } catch (cause) { setError(cause instanceof Error && cause.message.startsWith("Dalla bolletta") ? cause.message : message(cause)); } finally { setPending(undefined); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || readonly || pending) return;
    if (file.size > MAX_BILL_BYTES) { setError("Il file supera 10 MB."); return; }
    setPending("upload"); setError(undefined);
    try {
      const body = new FormData(); body.set("file", file);
      const document = (await requestForm<{ readonly document: BillDocumentModel }>("/api/bills", body)).document;
      if (document.status === "FAILED" || document.status === "PROVIDER_NOT_CONFIGURED") throw new Error("BILL_READ_FAILED");
      setDraft(document);
      setValues(Object.fromEntries(FIELDS.map((field) => [field.name, toDisplay(field.name, document.fields[field.name]?.value)])));
      setStep("review");
    } catch (cause) { setError(cause instanceof Error && cause.message === "BILL_READ_FAILED" ? "Non siamo riusciti a leggere la bolletta. Riprova con un PDF più nitido." : message(cause)); } finally { setPending(undefined); }
  };

  // Confirms what was read, saves what the user corrected, approves the bill and moves on to the offers.
  const confirm = async () => {
    if (!draft || readonly || pending) return;
    const missing = FIELDS.filter((field) => !(values[field.name] ?? "").trim());
    if (missing.length) { setError(`Completa: ${missing.map((field) => field.label).join(", ")}.`); return; }
    setPending("confirm"); setError(undefined);
    try {
      let current = draft;
      const unchanged = FIELDS.filter((field) => values[field.name].trim() === (current.fields[field.name]?.value ?? "") && !current.fields[field.name]?.confirmed).map((field) => field.name);
      if (unchanged.length) current = (await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(current.id)}`, { method: "PATCH", body: JSON.stringify({ operation: "confirm-fields", versionId: current.currentVersionId, fields: unchanged }) })).document;
      for (const field of FIELDS.filter((item) => values[item.name].trim() !== (draft.fields[item.name]?.value ?? ""))) {
        current = (await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(current.id)}`, { method: "PATCH", body: JSON.stringify({ operation: "correct", field: field.name, value: values[field.name].trim(), versionId: current.currentVersionId }) })).document;
      }
      current = (await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(current.id)}`, { method: "PATCH", body: JSON.stringify({ operation: "approve", versionId: current.currentVersionId }) })).document;
      setDraft(null); void loadArchive();
      setPending(undefined);
      await loadOffers(current.id);
    } catch (cause) { setError(message(cause)); setPending(undefined); }
  };

  // CTEs of the same supply type that were not proposed, with the reason.
  const proposed = new Set(quote?.offers.map((offer) => offer.calculation.sourceCte.archiveId) ?? []);
  const excluded = (quote?.candidates ?? []).filter((candidate) => !proposed.has(candidate.archiveId) && candidate.compatibilityReason !== "VECTOR_MISMATCH");
  const selected = quote?.offers.find((offer) => offer.calculation.calculationId === selectedId) ?? null;

  const saveProposal = async () => {
    if (!quote || !selected || readonly || pending) return;
    const { bill, context, comparison } = quote;
    const validUntil = selected.receipt.validUntil;
    if (!validUntil || validUntil <= today) { setError("L'offerta è scaduta: non si può preparare la proposta."); return; }
    const taxCode = bill.normalized?.customer.taxIdentifiers.find((item) => item.kind === "TAX_CODE")?.value ?? null;
    const customerId = taxCode ?? bill.fields.customerName?.value ?? bill.id;
    const supplyId = context.vector === "EE" ? context.supply.pod ?? "" : context.supply.pdr ?? "";
    const result = selected.calculation;
    const ranking = comparison.ranking.find((entry) => entry.calculationId === result.calculationId);
    setPending("proposal"); setError(undefined);
    try {
      const body = { schemaVersion: 1, tenantId: comparison.tenantId, sourceType: "COMPARISON", comparisonId: comparison.comparisonId, comparisonFingerprint: comparison.fingerprint, selectedCalculationId: result.calculationId, selectedOffer: { archiveId: result.sourceCte.archiveId, cteId: result.sourceCte.cteId, versionId: result.sourceCte.versionId, version: result.sourceCte.version, supplier: result.sourceCte.supplier, offerCode: result.sourceCte.offerCode }, customer: { customerId, category: context.customerType }, supply: { supplyId, ...(context.vector === "EE" ? { pod: supplyId, voltageLevel: result.voltageLevel } : { pdr: supplyId }) }, proposalIssueDate: today, offerValidity: { periodStart: context.billingPeriod.periodStart, periodEnd: validUntil }, requestedExportFormat: "PDF" };
      const created = (await requestJson<{ readonly proposal: ProposalModel }>("/api/proposal/comparison", { method: "POST", body: JSON.stringify(body) })).proposal;
      if (created.selectedResult.calculationId !== result.calculationId || created.selectedResult.rankingPosition !== (ranking?.rank ?? null)) throw new Error("PROPOSAL_RESPONSE_INVALID");
      setProposal(created);
      await downloadExport("/api/proposal/export/pdf", { proposalId: created.proposalId }, "PDF");
    } catch (cause) { setError(message(cause)); } finally { setPending(undefined); }
  };

  const restart = () => { setStep("bill"); setDraft(null); setQuote(null); setSelectedId(null); setProposal(null); setError(undefined); };

  return <div className="content-stack quote-flow">
    <div className="section-header"><div><h2>Nuova simulazione</h2><p className="section-detail">Carica la bolletta del cliente: ti mostriamo le offerte che puoi proporgli e quanto risparmia.</p></div>{step !== "bill" ? <button className="button secondary" type="button" onClick={restart} disabled={Boolean(pending)}>Ricomincia</button> : null}</div>
    <Steps step={step} />
    {step === "bill" ? <section className="ui-card quote-upload">
      {pending === "upload" ? <LoadingState label="Lettura della bolletta in corso" /> : <>
        <label className="button primary quote-upload-button">Carica bolletta (PDF)<input className="visually-hidden" type="file" accept="application/pdf" onChange={(event) => void upload(event)} disabled={readonly || Boolean(pending)} /></label>
        {archive.length ? <label className="form-field"><span className="form-label">Oppure usa una bolletta già caricata</span><select value="" onChange={(event) => { if (event.target.value) void loadOffers(event.target.value); }} disabled={Boolean(pending)}><option value="">Scegli la bolletta</option>{archive.map((bill) => <option key={bill.id} value={bill.id}>{bill.title}{bill.supplier ? ` · ${bill.supplier}` : ""}{bill.period.periodStart ? ` · ${date(bill.period.periodStart)}` : ""}</option>)}</select></label> : null}
      </>}
    </section> : null}
    {step === "review" && draft ? <section className="ui-card">
      <h3>Dati letti dalla bolletta</h3><p className="muted">Li usiamo per trovare le CTE adatte. Se vedi un errore evidente puoi correggerlo, altrimenti prosegui.</p>
      <BillContractFacts bill={draft} />
      <div className="form-grid">{FIELDS.map((field) => <label className="form-field" key={field.name}><span className="form-label">{field.label}{unitOf(field.name, draft.resolvedVector)}</span><input value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} disabled={Boolean(pending)} /></label>)}</div>
      <div className="button-row"><button className="button primary" type="button" onClick={() => void confirm()} disabled={readonly || Boolean(pending)}>{pending === "confirm" ? "Ricerca in corso" : "Cerca le CTE utilizzabili"}</button></div>
    </section> : null}
    {step === "offers" ? pending === "offers" ? <LoadingState label="Calcolo delle offerte per questa bolletta" /> : quote ? <>
      <BillSummary context={quote.context} />
      <section className="ui-card"><h3>Offerte utilizzabili per {quote.context.vector === "EE" ? "questa fornitura di luce" : "questa fornitura di gas"}</h3>
        {quote.offers.length ? <div className="quote-offers">{quote.offers.map((offer, index) => <button key={offer.calculation.calculationId} type="button" className={`quote-offer${offer.calculation.calculationId === selectedId ? " selected" : ""}${index === 0 ? " best" : ""}`} onClick={() => { setSelectedId(offer.calculation.calculationId); setProposal(null); }} aria-pressed={offer.calculation.calculationId === selectedId}>
          {index === 0 ? <span className="status-badge positive">La più conveniente</span> : null}
          <strong>{offer.supplier}</strong><span>{offer.offerName}</span>
          <span className="quote-offer-total">{euro(offer.receipt.offerTotal ?? offer.receipt.rows[0].offer)}</span>
          {offer.receipt.savingsPercent !== null ? <small className={offer.receipt.savingsPercent >= 0 ? "positive" : "negative"}>{offer.receipt.savingsPercent >= 0 ? "Risparmio" : "Più cara"} {PERCENT.format(Math.abs(offer.receipt.savingsPercent))}%</small> : null}
          <small>Valida fino al {date(offer.receipt.validUntil)}</small>
        </button>)}</div> : <EmptyState title="Nessuna offerta utilizzabile" detail="Nessuna CTE a te assegnata è adatta a questa bolletta. Chiedi all'amministratore di assegnartene una." />}
        {excluded.length ? <details className="quote-excluded"><summary>{excluded.length} {excluded.length === 1 ? "CTE non adatta" : "CTE non adatte"} a questa bolletta</summary>
          <ul>{excluded.map((candidate) => <li key={candidate.archiveId}><strong>{candidate.offer.name || candidate.offer.code}</strong> <span className="muted">{candidate.supplier}</span> <em>{exclusion(candidate)}</em></li>)}</ul>
        </details> : null}
      </section>
      {selected ? <><Receipt offer={selected} today={today} /><div className="button-row"><button className="button primary" type="button" onClick={() => void saveProposal()} disabled={readonly || Boolean(pending)}>{pending === "proposal" ? "Preparazione" : "Scarica la proposta in PDF"}</button>{proposal ? <span className="muted" role="status">Proposta salvata in Proposte.</span> : null}</div></> : null}
    </> : null : null}
    {error ? <ErrorState message={error} /> : null}
  </div>;
}
