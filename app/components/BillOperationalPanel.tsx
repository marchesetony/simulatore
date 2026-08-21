"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, FormField, LoadingState } from "./UiStates";
import { requestForm, requestJson, toUiError } from "../lib/ui/client";
import { formatBillDisplayPeriod, formatDisplayDate, formatEuro, formatNumber, statusLabel } from "../lib/ui/format";
import type { ApprovedBillSummaryModel, BillDocumentModel, SimulationDraft } from "../lib/ui/models";
import type { BillAnalystReviewDTO, BillAnalystReviewField } from "../lib/foundation/bill-analyst-review";
import type { BillRegulatoryAuditDTO } from "../lib/foundation/bill-regulatory-audit";
import type { DomesticResidentMatrix, ExpectedComponent } from "../lib/foundation/bill-domestic-resident-matrix";
import type { BillEconomicComponent } from "../lib/foundation/bill-economic-analysis";
import type { RegulatedPassThroughItem } from "../lib/foundation/bill-regulated-pass-through";

type BillAction = "upload" | "approve" | "correct" | "retry" | "delete";
type CorrectionField = "supplier" | "pod" | "customerName" | "billingPeriod" | "annualConsumption" | "billedConsumption" | "totalAmount";
type ReviewDefinition = [string, string, BillAnalystReviewField<unknown>, string?];
type DisplayRow = { readonly label: string; readonly value: ReactNode; readonly detail?: ReactNode };

const correctionLabels: Readonly<Record<CorrectionField, string>> = {
  supplier: "Fornitore", pod: "POD / PDR", customerName: "Cliente", billingPeriod: "Periodo",
  annualConsumption: "Consumo annuo", billedConsumption: "Consumo fatturato", totalAmount: "Totale bolletta",
};
const areraCodes = new Set(["NETWORK_FIXED", "METERING_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "TRANSMISSION_ENERGY", "ASOS", "ARIM", "UC3", "UC6"]);
const areraLabels: Readonly<Record<string, string>> = {
  NETWORK_FIXED: "Rete — quota fissa", METERING_FIXED: "Misura — quota fissa", NETWORK_POWER: "Rete — quota potenza",
  NETWORK_ENERGY: "Rete — quota energia", TRANSMISSION_ENERGY: "Trasmissione — quota energia",
  ASOS: "Oneri di sistema — ASOS", ARIM: "Oneri di sistema — ARIM", UC3: "Oneri di sistema — UC3", UC6: "Oneri di sistema — UC6",
};

function errorText(error: unknown): string { const safe = toUiError(error); return safe.message + " codice " + safe.code; }
function reviewStatus(value: string | null | undefined): string {
  if (value === "REVIEW_REQUIRED") return "Revisione richiesta";
  if (value === "OCR_PROVIDER_REQUIRED") return "Lettura da riprovare";
  if (value === "FAILED") return "Lettura non riuscita";
  if (value === "EXTRACTED") return "Dati estratti";
  return statusLabel(value);
}
function dateRange(from: string | null | undefined, to: string | null | undefined): string { return from && to ? formatDisplayDate(from) + " – " + formatDisplayDate(to) : ""; }
function inclusiveEnd(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function fieldValue(field: BillAnalystReviewField<unknown>): string | null {
  if (field.status === "NOT_FOUND" || field.status === "INVALID" || field.value === null || field.value === undefined || field.value === "") return null;
  return typeof field.value === "number" ? formatNumber(field.value) : String(field.value);
}
function rowsFrom(definitions: readonly ReviewDefinition[]): DisplayRow[] {
  return definitions.flatMap(([, label, field, unit]) => {
    const value = fieldValue(field);
    return value ? [{ label, value: <>{value}{unit ? <span className="bill-audit-unit"> {unit}</span> : null}</> }] : [];
  });
}
function DataRows({ rows }: { readonly rows: readonly DisplayRow[] }): ReactNode {
  return <div className="bill-audit-data-list">{rows.map((row) => <div className="bill-audit-data-row" key={row.label}><span>{row.label}</span><strong>{row.value}</strong>{row.detail ? <small>{row.detail}</small> : null}</div>)}</div>;
}
function AuditCard({ title, children, className = "" }: { readonly title: string; readonly children: ReactNode; readonly className?: string }): ReactNode {
  return <section className={"bill-audit-card " + className}><div className="bill-audit-card-heading"><h3>{title}</h3></div>{children}</section>;
}
function StatusBadge({ children, tone = "neutral" }: { readonly children: ReactNode; readonly tone?: "positive" | "neutral" | "warning" | "negative" }): ReactNode {
  return <span className={"status-badge bill-audit-badge " + tone}>{children}</span>;
}
function sourceText(value: string): string {
  if (value === "VERIFIED") return "Fonte verificata";
  if (value === "PARTIAL") return "Fonte parzialmente verificata";
  if (value === "MISSING") return "Fonte non ancora verificata";
  return "Non applicabile";
}
function auditabilityText(value: string): string {
  if (value === "COMPLETE") return "Completa";
  if (value === "PARTIAL") return "Parziale";
  if (value === "CONTRACT_REQUIRED") return "Contratto necessario";
  if (value === "DOCUMENT_DETAIL_REQUIRED") return "Dettaglio documento necessario";
  return "Non verificabile";
}
function sourceTone(value: string): "positive" | "neutral" | "warning" { return value === "VERIFIED" ? "positive" : value === "PARTIAL" ? "warning" : "neutral"; }
function auditTone(value: string): "positive" | "neutral" | "warning" { return value === "COMPLETE" ? "positive" : value === "PARTIAL" ? "warning" : "neutral"; }
function profileText(value: string | null, normalized: string | null, map: Readonly<Record<string, string>>): string | null { return value || normalized ? (normalized && map[normalized]) || value : null; }
function componentNumber(value: string | number | null | undefined): number | null { if (value === null || value === undefined || String(value).trim() === "") return null; const text = String(value).replace(/\s/g, "").replace(/[^0-9,.+-]/g, ""); const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text; const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : null; }
function componentValue(component: BillEconomicComponent): ReactNode { const amount = componentNumber(component.amount); if (amount !== null) return formatEuro(amount); const unitPrice = componentNumber(component.unitPrice); return unitPrice !== null ? <>{formatNumber(unitPrice)} <span className="bill-audit-unit">{component.unit ?? ""}</span></> : "Da verificare"; }
function componentRows(components: readonly BillEconomicComponent[]): DisplayRow[] { return components.map((component) => ({ label: component.description || component.rawDescription, value: componentValue(component), detail: [component.quantity, component.unitPrice, component.unit, component.period].filter(Boolean).join(" · ") || undefined })); }

function regulatedItem(audit: BillRegulatoryAuditDTO | null, code: string): RegulatedPassThroughItem | null { return audit?.regulatedPassThrough?.items.find((item) => item.code === code) ?? null; }
function regulatedOutcomeLabel(item: RegulatedPassThroughItem | null): string { if (!item) return "Non disponibile"; if (item.outcome === "COINCIDE") return item.code === "CAPACITY_MARKET" ? "Conforme al riferimento ARERA" : "Coincide con riferimento ufficiale"; if (item.outcome === "SCOSTAMENTO") return item.status === "SUPERIORE_AL_RIFERIMENTO" ? "Superiore al riferimento" : item.status === "INFERIORE_AL_RIFERIMENTO" ? item.code === "DISPATCHING" ? "Inferiore al riferimento ARERA" : "Inferiore al riferimento" : "Scostamento"; if (item.outcome === "PRESENTE_AGGREGATO") return "Presente in voce aggregata"; if (item.outcome === "NON_IDENTIFICATO_IN_BOLLETTA") return "Non identificato separatamente"; if (item.outcome === "RIFERIMENTO_UFFICIALE_NON_DISPONIBILE") return "Riferimento ufficiale non disponibile"; return "Non confrontabile direttamente"; }
function readableRateUnit(unit: string): string { return unit === "EUR/KWH" || unit === "EUR_PER_KWH" ? "€/kWh" : unit === "EUR/MWH" || unit === "EUR_PER_MWH" ? "€/MWh" : unit === "EUR/KW/MONTH" ? "€/kW/mese" : unit === "EUR/KW/YEAR" ? "€/kW/anno" : unit; }
function regulatedRate(item: RegulatedPassThroughItem | null, fallback?: BillAnalystReviewField<unknown>): ReactNode { if (item && item.billValue !== null && item.billOriginalUnit) return <>{formatNumber(item.billValue)} <span className="bill-audit-unit">{readableRateUnit(item.billOriginalUnit)}</span><small className="bill-audit-pass-through-status">{regulatedOutcomeLabel(item)}</small></>; const value = fallback ? fieldValue(fallback) : null; return value ? <>{value} <span className="bill-audit-unit">€/kWh</span><small className="bill-audit-pass-through-status">Non confrontabile direttamente</small></> : "Non esposto separatamente in bolletta"; }

function SupplyProfile({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const profile = review.supplyProfile;
  if (!profile) return null;
  const rows: DisplayRow[] = [];
  const use = profileText(profile.supplyUseCategory.rawValue, profile.supplyUseCategory.normalizedValue, { DOMESTIC: "Domestico" });
  const residence = profileText(profile.domesticResidenceStatus.rawValue, profile.domesticResidenceStatus.normalizedValue, { RESIDENT: "Residente", NON_RESIDENT: "Non residente" });
  const market = profileText(profile.marketRegime.rawValue, profile.marketRegime.normalizedValue, { MERCATO_LIBERO: "Mercato libero", MAGGIOR_TUTELA: "Maggior tutela" });
  const voltage = profileText(profile.voltageClass.rawValue, profile.voltageClass.normalizedValue, { LV: "Bassa tensione (BT)", MV: "Media tensione (MT)", HV: "Alta tensione (AT)", EHV: "Altissima tensione" });
  if (use) rows.push({ label: "Uso", value: use });
  if (residence) rows.push({ label: "Residenza", value: residence });
  if (market) rows.push({ label: "Mercato", value: market });
  if (voltage) rows.push({ label: "Tensione", value: voltage });
  if (profile.powerCommitted.rawValue) rows.push({ label: "Potenza impegnata", value: <>{profile.powerCommitted.rawValue} <span className="bill-audit-unit">kW</span></> });
  if (profile.powerAvailable.rawValue) rows.push({ label: "Potenza disponibile", value: <>{profile.powerAvailable.rawValue} <span className="bill-audit-unit">kW</span></> });
  return rows.length ? <AuditCard title="FORNITURA" className="bill-audit-profile"><DataRows rows={rows}/></AuditCard> : null;
}

function PeriodAndConsumption({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const rows = rowsFrom([
    ["billed", "Consumo totale", review.consumption.billed, "kWh"],
    ["f1", "F1", review.consumption.f1, "kWh"],
    ["f2", "F2", review.consumption.f2, "kWh"],
    ["f3", "F3", review.consumption.f3, "kWh"],
  ]);
  return rows.length ? <AuditCard title="CONSUMI"><DataRows rows={rows}/></AuditCard> : null;
}

function readableEconomicLabel(component: BillEconomicComponent): string {
  const labels: Readonly<Record<string, string>> = {
    ENERGY_INDEX: "PUN / indice applicato", ENERGY_SPREAD: "Spread", ENERGY_FIXED_PRICE: "Prezzo energia",
    PCV: "Commercializzazione / PCV", COMMERCIALIZATION_FIXED_FEE: "Quota commerciale", COMMERCIALIZATION_VARIABLE_FEE: "Quota commerciale variabile",
    SELLER_FIXED_FEE: "Quota fissa vendita", SELLER_ENERGY_FEE: "Costo energia venditore", DISPATCHING_SELLER_CHARGE: "Dispacciamento",
    CAPACITY_MARKET_SELLER_CHARGE: "Capacity Market", BALANCING_CHARGE: "Bilanciamento", OTHER_SELLER_ENERGY_CHARGE: "Altri costi energia", OTHER_SELLER_FIXED_CHARGE: "Altri costi fissi",
  };
  return labels[component.classification] ?? component.description ?? component.rawDescription;
}

function economicAmount(component: BillEconomicComponent): ReactNode {
  const amount = componentNumber(component.amount);
  return amount === null ? "Da verificare" : formatEuro(amount);
}

function CurrentOfferSummary({ review, matrix }: { readonly review: BillAnalystReviewDTO; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const analysis = review.economics.economicAnalysis;
  const commercial = [...analysis.currentSellerCostBreakdown.COMMERCIALIZATION, ...analysis.currentSellerCostBreakdown.DISPATCHING_OR_PASS_THROUGH, ...analysis.currentSellerCostBreakdown.CAPACITY_MARKET, ...analysis.currentSellerCostBreakdown.OTHER_SELLER_CHARGES];
  const pun = fieldValue(review.economics.punApplied) ?? analysis.currentSellerCostBreakdown.ENERGY_PRICE.find((item) => item.classification === "ENERGY_INDEX")?.rawValue;
  const spread = fieldValue(review.economics.spread) ?? analysis.currentSellerCostBreakdown.ENERGY_PRICE.find((item) => item.classification === "ENERGY_SPREAD")?.rawValue;
  const punRows = matrix?.pun.source.filter((reference) => reference.displayValue !== null) ?? [];
  const priceType = analysis.priceType === "INDEXED_PUN_SPREAD" ? "Indicizzato PUN + spread" : analysis.priceType === "FIXED_PRICE" ? "Prezzo fisso" : analysis.priceType === "OTHER_INDEX" ? "Altro indice" : analysis.priceType === "MIXED_FORMULA" ? "Formula mista" : "Non determinabile dalla bolletta";
  return <AuditCard title="OFFERTA ATTUALE" className="bill-audit-offer"><DataRows rows={[{ label: "Tipo prezzo", value: priceType }, ...(pun ? [{ label: "PUN / indice applicato", value: <>{pun} <span className="bill-audit-unit">€/kWh</span></> }] : []), ...(spread ? [{ label: "Spread", value: <>{spread} <span className="bill-audit-unit">€/kWh</span></> }] : []), ...commercial.map((component) => ({ label: readableEconomicLabel(component), value: economicAmount(component), detail: component.period || undefined }))]}/>{punRows.length ? <div className="bill-audit-benchmark"><span>Riferimento GME periodo bolletta</span><strong>{punRows.map((reference) => `${reference.band} ${formatNumber(reference.displayValue)} €/kWh`).join(" · ")}</strong></div> : null}</AuditCard>;
}

function LegacyEnergyReceiptCompact({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const totals = review.economics.economicAnalysis.totals;
  const currentDue = totals.amountDue ?? totals.currentPeriodTotal;
  const prior = totals.priorBalanceTotal;
  const rows: DisplayRow[] = [
    { label: "Periodo", value: formatBillDisplayPeriod(review.dates.billingPeriodStart.value, review.dates.billingPeriodEnd.value) || "Non determinabile" },
    { label: "Consumi", value: review.consumption.billed.value === null ? "Non determinabile" : `${formatNumber(review.consumption.billed.value)} kWh` },
    { label: "Vendita energia", value: totals.sellerEnergyTotal === null && totals.sellerCommercializationTotal === null ? "Da verificare" : formatEuro((totals.sellerEnergyTotal ?? 0) + (totals.sellerCommercializationTotal ?? 0)) },
    { label: "Rete e oneri", value: formatEuro((totals.regulatedNetworkTotal ?? 0) + (totals.systemChargesTotal ?? 0)) },
    { label: "Imposte", value: totals.taxTotal === null ? "Da verificare" : formatEuro(totals.taxTotal) },
    { label: "Altre partite", value: totals.otherItemsTotal === null ? "Da verificare" : formatEuro(totals.otherItemsTotal) },
    { label: "Totale bolletta", value: totals.billTotal === null ? "Da verificare" : formatEuro(totals.billTotal) },
    { label: "Totale da pagare", value: currentDue === null ? "Da verificare" : formatEuro(currentDue) },
  ];
  return <AuditCard title="SCONTRINO DELL'ENERGIA" className="bill-audit-cost-summary"><DataRows rows={rows}/><div className="bill-audit-receipt-extras">{totals.tvFeeTotal !== null ? <span>Canone TV {formatEuro(totals.tvFeeTotal)}</span> : null}{review.receipt.latePaymentStatus === "PRESENT" ? <span>Mora {fieldValue(review.receipt.latePaymentAmount) ?? "da verificare"}</span> : null}{review.receipt.cmorStatus === "PRESENT" ? <span>CMOR {fieldValue(review.receipt.cmorAmount) ?? "da verificare"}</span> : null}{prior !== null ? <span>Saldo precedente {formatEuro(prior)} · complessivo {currentDue === null ? "da verificare" : formatEuro(currentDue + prior)}</span> : null}</div></AuditCard>;
}

function CleanEnergyReceiptCompact({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const totals = review.economics.economicAnalysis.totals;
  const rows: DisplayRow[] = [
    { label: "Vendita energia", value: formatEuro((totals.sellerEnergyTotal ?? 0) + (totals.sellerCommercializationTotal ?? 0)) },
    { label: "Rete e oneri", value: formatEuro((totals.regulatedNetworkTotal ?? 0) + (totals.systemChargesTotal ?? 0)) },
    { label: "Imposte", value: totals.taxTotal === null ? "Da verificare" : formatEuro(totals.taxTotal) },
    { label: "Altre partite", value: totals.otherItemsTotal === null ? "Da verificare" : formatEuro(totals.otherItemsTotal) },
    { label: "Totale bolletta escluso Canone TV", value: totals.billTotal === null ? "Da verificare" : formatEuro(totals.billTotal) },
    { label: "Canone TV", value: totals.tvFeeTotal === null ? "Da verificare" : formatEuro(totals.tvFeeTotal) },
    { label: "TOTALE FATTURA CORRENTE DA PAGARE", value: totals.amountDue === null ? "Da verificare" : formatEuro(totals.amountDue) },
  ];
  return <AuditCard title="SCONTRINO DELL&apos;ENERGIA" className="bill-audit-cost-summary"><DataRows rows={rows}/><div className="bill-audit-receipt-extras">{review.receipt.latePaymentStatus === "PRESENT" ? <span>Mora {fieldValue(review.receipt.latePaymentAmount) ?? "Da verificare"}</span> : null}{review.receipt.cmorStatus === "PRESENT" ? <span>CMOR {fieldValue(review.receipt.cmorAmount) ?? "Da verificare"}</span> : null}</div></AuditCard>;
}

function PaymentSummary({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  if (review.receipt.priorBalance.status !== "FOUND") return null;
  const amount = componentNumber(review.receipt.priorBalance.value);
  return <AuditCard title="PAGAMENTI PREGRESSI" className="bill-audit-cost-summary"><DataRows rows={[{ label: "Fattura precedente insoluta", value: amount === null ? "Da verificare" : formatEuro(amount) }]}/><p className="bill-audit-note">Importo riferito a una fattura precedente. Non è incluso nel totale della fattura corrente.</p></AuditCard>;
}

function PassThroughSummary({ audit }: { readonly audit: BillRegulatoryAuditDTO | null }): ReactNode {
  const matrix = audit?.domesticResidentMatrix;
  if (!matrix) return null;
  const comparable = matrix.components.filter((component) => component.auditability === "COMPARABLE").length;
  return <AuditCard title="RIFERIMENTI REGOLATI" className="bill-audit-summary"><DataRows rows={[{ label: "Componenti regolate", value: `${matrix.areraNetworkReferenceCount + matrix.areraSystemChargeReferenceCount} riferimenti ARERA disponibili` }, { label: "Dispacciamento / Capacity", value: `${matrix.ternaDispatchingReferenceCount + matrix.ternaCapacityReferenceCount} riferimenti ARERA/Terna disponibili` }, { label: "Esito confronto", value: comparable === 0 ? "1 componente aggregata; confronto puntuale non disponibile" : `${comparable} componenti confrontate` }]}/></AuditCard>;
}

function CleanOfferSummary({ review, audit, matrix }: { readonly review: BillAnalystReviewDTO; readonly audit?: BillRegulatoryAuditDTO | null; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const receipt = review.receipt;
  const mechanism = receipt.priceMechanism === "INDEXED_PUN_PLUS_SPREAD" ? "Indicizzato PUN + spread" : receipt.priceMechanism === "FIXED" ? "Prezzo fisso" : receipt.priceMechanism === "INDEXED_OTHER" ? "Altro indice" : receipt.priceMechanism === "HYBRID" ? "Formula mista" : "Non determinabile dalla bolletta";
  const structure = receipt.priceTimeStructure === "F1_F2_F3" ? "F1-F2-F3" : receipt.priceTimeStructure === "F1_F23" ? "F1-F23" : receipt.priceTimeStructure === "MONORARIO" ? "Monorario" : "Non determinabile dalla bolletta";
  const rows: DisplayRow[] = [
    ...(receipt.offerName.value ? [{ label: "Nome offerta", value: receipt.offerName.value }] : []),
    { label: "Tipo prezzo", value: mechanism }, { label: "Struttura prezzo", value: structure }, { label: "Indice", value: fieldValue(receipt.indexName) ?? "Non determinabile dalla bolletta" }, { label: "Spread", value: fieldValue(receipt.spread) ? <>{fieldValue(receipt.spread)} <span className="bill-audit-unit">€/kWh</span></> : "Non presente" },
    ...(receipt.priceBands.length ? [{ label: "Prezzi rilevati in bolletta", value: <span className="bill-audit-price-bands">{receipt.priceBands.map((band, index) => <span key={`price-band-${index}`}><b>{["F1", "F2", "F3", "F23"][index] ?? "Prezzo"}</b><span>{fieldValue(band) ?? "Da verificare"} <em>€/kWh</em></span></span>)}</span> }] : []),
    { label: "Quota fissa vendita", value: formatEuro(review.economics.economicAnalysis.currentSellerCostBreakdown.COMMERCIALIZATION.filter((item) => item.classification === "SELLER_FIXED_FEE").reduce((sum, item) => sum + (componentNumber(item.amount) ?? 0), 0)) },
    { label: "Dispacciamento", value: regulatedRate(regulatedItem(audit ?? null, "DISPATCHING"), receipt.dispatching) },
    { label: "Capacity Market", value: regulatedRate(regulatedItem(audit ?? null, "CAPACITY_MARKET"), receipt.capacityMarket) },
    ...(receipt.economicConditionsExpiryDate.value ? [{ label: "Scadenza condizioni economiche", value: receipt.economicConditionsExpiryDate.value }] : []),
  ];
  const official = matrix?.pun.source.filter((reference) => reference.displayValue !== null) ?? [];
  return <AuditCard title="OFFERTA ATTUALE" className="bill-audit-offer"><DataRows rows={rows}/>{official.length ? <div className="bill-audit-benchmark"><span>Benchmark GME — luglio 2026</span><strong>{official.map((reference) => `${reference.band} ${formatNumber(reference.displayValue)} €/kWh`).join(" · ")}</strong></div> : null}</AuditCard>;
}

function CostSummary({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const totals = review.economics.economicAnalysis.totals;
  const total = totals.billTotal ?? componentNumber(review.economics.total.value);
  const amountDue = totals.amountDue ?? totals.currentPeriodTotal ?? total;
  const sellerTotal = [totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal].some((value) => value !== null) ? (totals.sellerEnergyTotal ?? 0) + (totals.sellerCommercializationTotal ?? 0) + (totals.sellerOtherTotal ?? 0) : null;
  const rows: DisplayRow[] = [
    { label: "Vendita energia", value: sellerTotal === null ? "Da verificare" : formatEuro(sellerTotal) },
    { label: "Rete e oneri di sistema", value: totals.regulatedNetworkTotal === null && totals.systemChargesTotal === null ? "Da verificare" : formatEuro((totals.regulatedNetworkTotal ?? 0) + (totals.systemChargesTotal ?? 0)) },
    { label: "Imposte", value: totals.taxTotal === null ? "Da verificare" : formatEuro(totals.taxTotal) },
    { label: "Altre partite", value: totals.otherItemsTotal === null ? "Da verificare" : formatEuro(totals.otherItemsTotal) },
    { label: "Totale bolletta", value: total === null ? "Da verificare" : formatEuro(total) },
    { label: "Totale da pagare", value: amountDue === null ? "Da verificare" : formatEuro(amountDue) },
  ];
  return <AuditCard title="COMPOSIZIONE COSTO" className="bill-audit-cost-summary"><DataRows rows={rows}/>{totals.tvFeeTotal !== null ? <p className="bill-audit-note">Canone TV separato: {formatEuro(totals.tvFeeTotal)}.</p> : null}</AuditCard>;
}

function LegacyVerificationSummary({ audit }: { readonly audit: BillRegulatoryAuditDTO | null }): ReactNode {
  const anomalies = audit?.summary.confirmedAnomalyCount ?? 0;
  const comparable = audit?.domesticResidentMatrix?.counts.comparable ?? 0;
  return <AuditCard title="VERIFICA BOLLETTA" className="bill-audit-summary"><div className="bill-audit-summary-main"><div><span className="bill-audit-overline">Esito sintetico</span><strong>ANALISI PARZIALE</strong><p>Nessuna anomalia confermata nelle componenti effettivamente confrontabili.</p></div><div className="bill-audit-anomaly-count"><span>Anomalie confermate</span><strong>{anomalies}</strong></div></div><div className="bill-audit-note">Componenti confrontate: {comparable}</div></AuditCard>;
}

function signedEuro(value: number): string { return `${value >= 0 ? "+" : ""}${formatEuro(value)}`; }

function compactPassThroughStatus(item: RegulatedPassThroughItem): string {
  if (item.status === "CONFORME") return "CONFORME";
  if (item.status === "SUPERIORE_AL_RIFERIMENTO") return "SUPERIORE AL RIFERIMENTO";
  if (item.status === "INFERIORE_AL_RIFERIMENTO") return "INFERIORE AL RIFERIMENTO";
  if (item.status === "PRESENTE_IN_VOCE_AGGREGATA") return "PRESENTE IN VOCE AGGREGATA";
  if (item.status === "NON_IDENTIFICATO_SEPARATAMENTE") return "NON IDENTIFICATA SEPARATAMENTE";
  if (item.status === "RIFERIMENTO_UFFICIALE_MANCANTE") return "RIFERIMENTO UFFICIALE MANCANTE";
  return "NON CONFRONTABILE";
}
function compactPassThroughTone(item: RegulatedPassThroughItem): "positive" | "neutral" | "warning" {
  return item.status === "CONFORME" || item.status === "INFERIORE_AL_RIFERIMENTO" ? "positive" : item.status === "SUPERIORE_AL_RIFERIMENTO" ? "warning" : "neutral";
}
function compactPassThroughBill(item: RegulatedPassThroughItem): ReactNode {
  if (item.billExposure === "AGGREGATED") return "Inclusa in voce aggregata";
  if (item.billExposure === "NOT_IDENTIFIED") return "Non identificata separatamente";
  const rate = item.billValue !== null && item.billOriginalUnit ? <>{formatNumber(item.billValue)} <span className="bill-audit-unit">{readableRateUnit(item.billOriginalUnit)}</span></> : null;
  const amount = item.billAmount !== null ? formatEuro(item.billAmount) : null;
  return amount && rate ? <>{amount}<small>{rate}</small></> : amount ?? rate ?? "Da verificare";
}
function compactPassThroughOfficial(item: RegulatedPassThroughItem): ReactNode {
  if (item.officialReferenceKind === "NONE" || item.normalizedOfficialRate === null) return "—";
  if (item.code === "NETWORK_POWER" && item.estimatedAmountAtOfficialRate !== null) return <>{formatEuro(item.estimatedAmountAtOfficialRate)}<small>ARERA</small></>;
  const unit = readableRateUnit(item.normalizedUnit ?? "");
  return <>{formatNumber(item.normalizedOfficialRate)} <span className="bill-audit-unit">{unit}</span>{item.officialReferenceKind === "CUSTOMER_FACING" ? <small>{item.authority}</small> : null}</>;
}
function compactPassThroughDifference(item: RegulatedPassThroughItem): ReactNode {
  if (item.amountDifference !== null) return signedEuro(item.amountDifference);
  if (item.unitRateDifference !== null && item.normalizedUnit) return <>{item.unitRateDifference >= 0 ? "+" : ""}{formatNumber(item.unitRateDifference)} <span className="bill-audit-unit">{readableRateUnit(item.normalizedUnit)}</span></>;
  return "—";
}
function passThroughTechnicalDisclosure({ item }: { readonly item: RegulatedPassThroughItem }): ReactNode {
  const reference = item.officialReferences[0] ?? null;
  const upstream = item.upstreamReferences[0] ?? null;
  const technicalRows: DisplayRow[] = [
    { label: "Descrizione", value: item.label },
    { label: "Rate bolletta", value: item.billValue === null ? "—" : `${formatNumber(item.billValue)} ${readableRateUnit(item.billOriginalUnit ?? item.normalizedUnit ?? "")}` },
    { label: "Importo bolletta", value: item.billAmount === null ? "—" : formatEuro(item.billAmount) },
    { label: "Rate ufficiale", value: item.normalizedOfficialRate === null ? "—" : `${formatNumber(item.normalizedOfficialRate)} ${readableRateUnit(item.normalizedUnit ?? "")}` },
    { label: "Importo ufficiale stimato", value: item.estimatedAmountAtOfficialRate === null ? "—" : formatEuro(item.estimatedAmountAtOfficialRate) },
    { label: "Unità originali", value: `${item.billOriginalUnit ?? "—"} / ${item.officialOriginalUnit ?? "—"}` },
    { label: "Unità normalizzata", value: item.normalizedUnit ?? "—" },
    { label: "Conversione", value: item.applicationBasis ?? "—" },
    { label: "Periodo", value: item.effectivePeriod ? dateRange(item.effectivePeriod.from, item.effectivePeriod.to ? inclusiveEnd(item.effectivePeriod.to) : null) : "—" },
    { label: "Autorità", value: item.authority },
    { label: "Documento", value: item.officialIdentifier ?? reference?.officialIdentifier ?? "—" },
    { label: "Differenza", value: compactPassThroughDifference(item) },
    { label: "Differenza %", value: item.unitRateDifferencePercent === null ? "—" : `${item.unitRateDifferencePercent >= 0 ? "+" : ""}${formatNumber(item.unitRateDifferencePercent)} %` },
    { label: "Differenza economica", value: item.amountDifference === null ? "—" : signedEuro(item.amountDifference) },
    { label: "Comparabilità", value: item.comparable ? "COMPARABLE" : item.status },
    { label: "Impatto cliente", value: item.comparisonResult ?? "—" },
    { label: "Fonte", value: item.sourceReference ?? reference?.sourceReference ?? "—" },
  ];
  return <div className="bill-audit-pass-through-detail"><DataRows rows={technicalRows}/>{upstream ? <p className="bill-audit-technical-note">Riferimento upstream {upstream.authority}: {formatNumber(upstream.normalizedValue)} {readableRateUnit(upstream.normalizedUnit)} — non usato come benchmark cliente.</p> : null}</div>;
}

function RegulatedCostsTable({ items }: { readonly items: readonly RegulatedPassThroughItem[] }): ReactNode {
  return <div className="bill-audit-regulated-table-wrap"><table className="bill-audit-table bill-audit-regulated-summary-table"><thead><tr><th>Voce</th><th>Bolletta</th><th>Ufficiale</th><th>Differenza</th><th>Esito</th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><th scope="row"><span>{item.label}</span><details className="bill-audit-inline-disclosure"><summary>Dettaglio</summary>{passThroughTechnicalDisclosure({ item })}</details></th><td>{compactPassThroughBill(item)}</td><td>{compactPassThroughOfficial(item)}</td><td>{compactPassThroughDifference(item)}</td><td><StatusBadge tone={compactPassThroughTone(item)}>{compactPassThroughStatus(item)}</StatusBadge></td></tr>)}</tbody></table></div>;
}

function VerificationSummary({ review, audit }: { readonly review: BillAnalystReviewDTO; readonly audit: BillRegulatoryAuditDTO | null }): ReactNode {
  const summary = audit?.regulatedPassThrough?.summary;
  const reconciliationStatus = review.economics.economicAnalysis.totals.reconciliationStatus;
  const reconciliation = reconciliationStatus === "RECONCILED" ? "CORRETTA" : reconciliationStatus === "DIFFERENCE" ? "DA VERIFICARE" : "NON DETERMINABILE";
  const verifiedDifference = audit?.regulatedPassThrough?.items.find((item) => item.outcome === "SCOSTAMENTO" && item.amountDifference !== null) ?? null;
  const rows: DisplayRow[] = summary ? [
    { label: "Riconciliazione fattura", value: reconciliation },
    { label: "Componenti confrontate", value: summary.comparableCount },
    { label: "Conformi", value: summary.matchingCount },
    { label: "Superiori al riferimento", value: summary.overReferenceCount },
    { label: "Inferiori al riferimento", value: summary.underReferenceCount },
    { label: "Maggior costo economico confermato", value: signedEuro(summary.confirmedOverchargeAmount) },
  ] : [];
  return summary ? <AuditCard title="VERIFICA COSTI E BOLLETTA" className="bill-audit-summary bill-audit-verification-summary"><div className="bill-audit-summary-main"><div><span className="bill-audit-overline">Esito complessivo</span><strong>ANALISI PARZIALE</strong><p>Gli importi della fattura sono riconciliati. {summary.comparableCount} componenti regolate sono confrontabili: {summary.matchingCount} risultano conformi, {summary.overReferenceCount} superiore e {summary.underReferenceCount} inferiore al riferimento ufficiale.</p><p>Altre componenti sono aggregate o non identificate separatamente in bolletta.</p></div></div><DataRows rows={rows}/>{verifiedDifference ? <div className="bill-audit-verified-difference"><strong>{verifiedDifference.label}</strong><div><span>Bolletta: {formatEuro(verifiedDifference.billAmount ?? 0)}</span><span>ARERA: {formatEuro(verifiedDifference.estimatedAmountAtOfficialRate ?? 0)}</span><span>Differenza: {signedEuro(verifiedDifference.amountDifference ?? 0)}</span></div><StatusBadge tone="warning">SUPERIORE AL RIFERIMENTO</StatusBadge>{verifiedDifference.unitRateDifference !== null && verifiedDifference.unitRateDifferencePercent !== null ? <small>Scostamento unitario: {verifiedDifference.unitRateDifference >= 0 ? "+" : ""}{formatNumber(verifiedDifference.unitRateDifference)} {readableRateUnit(verifiedDifference.normalizedUnit ?? "")} ({verifiedDifference.unitRateDifferencePercent >= 0 ? "+" : ""}{formatNumber(verifiedDifference.unitRateDifferencePercent)}%).</small> : null}</div> : null}</AuditCard> : null;
}

function officialValue(source: ExpectedComponent["sourceValue"]): ReactNode {
  if (!source || source.sourceOriginalValue === null || !source.sourceOriginalUnit) return <span className="bill-audit-muted">Riferimento non disponibile</span>;
  return <>{formatNumber(source.sourceOriginalValue)} <span className="bill-audit-unit">{source.sourceOriginalUnit}</span></>;
}
function normalizedValue(source: ExpectedComponent["sourceValue"]): ReactNode {
  if (!source || source.normalizedValue === null || !source.normalizedUnit) return null;
  return <small className="bill-audit-secondary-value">Normalizzato: {formatNumber(source.normalizedValue)} {source.normalizedUnit}</small>;
}
function evidenceText(value: ExpectedComponent["billEvidence"]): string {
  return value === "PRESENT_EXACT" ? "Presente" : value === "PRESENT_AGGREGATED" ? "Presente in voce aggregata" : "Non identificata separatamente";
}

function AreraSection({ matrix }: { readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const components = matrix?.components.filter((component) => areraCodes.has(component.code)) ?? [];
  if (!components.length) return null;
  return <AuditCard title="COMPONENTI REGOLATE ARERA" className="bill-audit-wide bill-audit-table-card"><p className="bill-audit-intro">Riferimenti ufficiali attesi per il profilo domestico residente in bassa tensione.</p><div className="bill-audit-table-wrap"><table className="bill-audit-table"><thead><tr><th>Componente</th><th>Valore ufficiale</th><th>Evidenza in bolletta</th><th>Verificabilità</th></tr></thead><tbody>{components.map((component) => <tr key={component.code}><th scope="row">{areraLabels[component.code] ?? component.officialName}<small>{component.code}</small></th><td>{officialValue(component.sourceValue)}{normalizedValue(component.sourceValue)}</td><td>{evidenceText(component.billEvidence)}</td><td><StatusBadge tone={component.auditability === "COMPARABLE" ? "positive" : "warning"}>{auditabilityText(component.auditability)}</StatusBadge></td></tr>)}</tbody></table></div></AuditCard>;
}

function DispatchingSection({ matrix }: { readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const components = matrix?.components.filter((component) => ["DISPATCHING_TERNA_OPERATION", "DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION"].includes(component.code)) ?? [];
  if (!components.length) return null;
  return <AuditCard title="DISPACCIAMENTO" className="bill-audit-wide"><div className="bill-audit-reference-grid">{components.map((component) => <article className="bill-audit-reference" key={component.code}><div><span>{component.code === "DISPATCHING_TERNA_OPERATION" ? "Costi funzionamento Terna" : "Unità essenziali — reintegrazione"}</span><strong>{officialValue(component.sourceValue)}</strong>{normalizedValue(component.sourceValue)}</div><div className="bill-audit-reference-meta"><span>Fonte ufficiale: ARERA · Delibera 587/2025/R/eel</span><StatusBadge tone="warning">Contratto necessario</StatusBadge></div></article>)}</div></AuditCard>;
}

function CapacitySection({ matrix }: { readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const component = matrix?.components.find((candidate) => candidate.code === "CAPACITY_MARKET_OFF_PEAK");
  if (!component?.sourceValue) return null;
  const source = component.sourceValue;
  return <AuditCard title="CAPACITY MARKET" className="bill-audit-wide"><div className="bill-audit-capacity"><div><span>Riferimento upstream TERNA</span><strong>{officialValue(source)}</strong>{normalizedValue(source)}</div><div><span>Periodo</span><strong>{dateRange(source.effectiveFrom, inclusiveEnd(source.effectiveTo))}</strong></div><div><span>Fonte</span><strong>Terna</strong></div><div><span>Uso</span><StatusBadge tone="warning">Non utilizzato per il confronto customer-facing</StatusBadge></div></div></AuditCard>;
}

function EnergyPrice({ review, matrix }: { readonly review: BillAnalystReviewDTO; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const applied = matrix?.pun.appliedDisplayValue;
  const punRows = matrix?.pun.source.filter((reference) => reference.displayValue !== null) ?? [];
  return <AuditCard title="PREZZO ENERGIA" className="bill-audit-wide bill-audit-price"><div className="bill-audit-price-hero"><span>PUN applicato</span><strong>{applied !== null && applied !== undefined ? <>{formatNumber(applied)} <small>€/kWh</small></> : fieldValue(review.economics.punApplied) ?? "Da verificare"}</strong></div><div className="bill-audit-price-reference"><div className="bill-audit-subheading"><span>Riferimenti ufficiali GME</span><StatusBadge tone="positive">Fonte: GME</StatusBadge></div><div className="bill-audit-gme-grid">{punRows.map((reference) => <div key={reference.band}><span>{reference.band}</span><strong>{formatNumber(reference.displayValue)} <small>€/kWh</small></strong></div>)}</div></div><div className="bill-audit-contract-note"><strong>Confronto economico con il contratto</strong><span>Il contratto è necessario per stabilire la corretta modalità di applicazione del prezzo.</span><StatusBadge tone="warning">Contratto necessario</StatusBadge></div></AuditCard>;
}

function LegacyAuditSummary({ audit }: { readonly audit: BillRegulatoryAuditDTO | null }): ReactNode {
  if (!audit) return null;
  const sources = [["Rete ARERA", audit.coverage.sourceCoverage.ARERA_NETWORK], ["Oneri ARERA", audit.coverage.sourceCoverage.ARERA_SYSTEM_CHARGES], ["Dispacciamento", audit.coverage.sourceCoverage.DISPATCHING], ["Capacity Market", audit.coverage.sourceCoverage.CAPACITY_MARKET], ["GME", audit.coverage.sourceCoverage.GME], ["Contratto", audit.coverage.sourceCoverage.CONTRACT], ["Imposte", audit.coverage.sourceCoverage.TAX]] as const;
  const auditability = [["Rete ARERA", audit.coverage.billAuditability.ARERA_NETWORK], ["Oneri ARERA", audit.coverage.billAuditability.ARERA_SYSTEM_CHARGES], ["Dispacciamento", audit.coverage.billAuditability.DISPATCHING], ["Capacity Market", audit.coverage.billAuditability.CAPACITY_MARKET], ["GME", audit.coverage.billAuditability.GME]] as const;
  return <><AuditCard title="STATO ANALISI" className="bill-audit-wide bill-audit-summary"><div className="bill-audit-summary-main"><div><span className="bill-audit-overline">Esito complessivo</span><strong>ANALISI PARZIALE</strong><p>Le fonti ufficiali principali sono disponibili, ma alcune componenti della bolletta sono aggregate e alcune verifiche dipendono dalle condizioni contrattuali.</p></div><div className="bill-audit-anomaly-count"><span>Anomalie confermate</span><strong>{audit.summary.confirmedAnomalyCount}</strong></div></div><div className="bill-audit-anomaly-message"><strong>ANOMALIE CONFERMATE · {audit.summary.confirmedAnomalyCount}</strong><span>Nessuna anomalia confermata nelle componenti attualmente confrontabili.</span></div></AuditCard><AuditCard title="COPERTURA FONTI UFFICIALI" className="bill-audit-wide"><div className="bill-audit-status-grid">{sources.map(([label, value]) => <div key={label}><span>{label}</span><StatusBadge tone={sourceTone(value)}>{label === "Contratto" ? "Necessario" : sourceText(value)}</StatusBadge></div>)}</div></AuditCard><AuditCard title="VERIFICABILITÀ DELLA BOLLETTA" className="bill-audit-wide"><div className="bill-audit-status-grid">{auditability.map(([label, value]) => <div key={label}><span>{label}</span><StatusBadge tone={auditTone(value)}>{auditabilityText(value)}</StatusBadge></div>)}</div></AuditCard></>;
}

function AuditSummary({ audit }: { readonly audit: BillRegulatoryAuditDTO | null }): ReactNode {
  return <><LegacyAuditSummary audit={audit}/><RegulatedPassThroughTable audit={audit}/></>;
}

function SellerSection({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const breakdown = review.economics.economicAnalysis.currentSellerCostBreakdown;
  const lines = [...breakdown.ENERGY_PRICE, ...breakdown.COMMERCIALIZATION, ...breakdown.DISPATCHING_OR_PASS_THROUGH, ...breakdown.CAPACITY_MARKET, ...breakdown.OTHER_SELLER_CHARGES];
  const priceType = review.economics.economicAnalysis.priceType === "INDEXED_PUN_SPREAD" ? "Indicizzato PUN + spread" : review.economics.economicAnalysis.priceType === "FIXED_PRICE" ? "Prezzo fisso" : review.economics.economicAnalysis.priceType === "OTHER_INDEX" ? "Altro indice" : review.economics.economicAnalysis.priceType === "MIXED_FORMULA" ? "Formula mista" : "Non determinabile";
  if (!lines.length) return <><AuditCard title="COSTI DEL VENDITORE ATTUALE"><p className="bill-audit-muted">Nessuna componente venditore rilevata separatamente.</p></AuditCard><RegulatedCostSection review={review}/><EconomicTechnicalDetail review={review}/></>;
  return <><AuditCard title="COSTI DEL VENDITORE ATTUALE"><DataRows rows={[{ label: "Tipo prezzo", value: priceType }, ...componentRows(lines)]}/><p className="bill-audit-note"><strong>Commercializzazione / PCV, dispacciamento, capacity market e altri costi restano separati.</strong> COSTI E CONDIZIONI DEL VENDITORE restano distinti da ANALISI ECONOMICA DELLA BOLLETTA. Dettaglio completo degli importi estratti. La CTE viene usata solo nel confronto successivo.</p></AuditCard><RegulatedCostSection review={review}/><EconomicTechnicalDetail review={review}/></>;
}

function RegulatedCostSection({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const costs = review.economics.economicAnalysis.regulatedAndSystemCosts;
  const lines = [...costs.ARERA_NETWORK, ...costs.ARERA_SYSTEM_CHARGES, ...costs.TERNA_DISPATCHING_REFERENCES, ...costs.GME_MARKET_REFERENCE];
  return <AuditCard title="COSTI REGOLATI E DI SISTEMA"><p className="bill-audit-overline">COMPONENTI REGOLATE</p><DataRows rows={componentRows(lines)}/>{!lines.length ? <p className="bill-audit-muted">Nessuna voce regolata distinta rilevata.</p> : null}<p className="bill-audit-note">I costi fatturati sono separati dai riferimenti ufficiali ARERA, TERNA e GME.</p></AuditCard>;
}

function TaxSection({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const groups = review.economics.economicAnalysis.taxesAndOtherItems;
  const lines = [...groups.TAXES, ...groups.OTHER_ITEMS];
  return <AuditCard title="IMPOSTE E ALTRE PARTITE"><DataRows rows={componentRows(lines)}/>{!lines.length ? <p className="bill-audit-muted">Nessuna imposta o altra partita rilevata separatamente.</p> : null}<p className="bill-audit-note"><StatusBadge tone="warning">Imposte e altre partite non sono costi venditore.</StatusBadge></p></AuditCard>;
}

function EconomicTechnicalDetail({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const components = review.economics.economicAnalysis.components;
  return <details className="bill-audit-collapsible bill-audit-wide"><summary>DETTAGLIO ECONOMICO DOCUMENTALE</summary><div className="bill-audit-table-wrap"><table className="bill-audit-table bill-audit-technical-table"><thead><tr><th>Descrizione</th><th>Classificazione</th><th>Raw value</th><th>Raw unit</th><th>Quantità</th><th>Prezzo unitario</th><th>Importo</th><th>Periodo</th><th>Calcolo</th></tr></thead><tbody>{components.map((component, index) => <tr key={`${component.code}-${index}`}><th scope="row">{component.rawDescription || component.description}</th><td>{component.classification}</td><td>{component.rawValue || "—"}</td><td>{component.rawUnit || "—"}</td><td>{component.rawQuantity || "—"}</td><td>{component.rawUnitPrice || "—"}</td><td>{component.rawAmount || "—"}</td><td>{component.rawPeriod || "—"}</td><td>{component.calculationCheck}</td></tr>)}</tbody></table></div></details>;
}

function MissingAnalysis({ audit, matrix }: { readonly audit: BillRegulatoryAuditDTO | null; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  if (!audit) return null;
  const items = [
    audit.coverage.sourceCoverage.CONTRACT !== "VERIFIED" ? "CTE / condizioni economiche del contratto per verificare le componenti contrattuali" : null,
    audit.coverage.sourceCoverage.TAX === "MISSING" ? "Fonte fiscale non ancora verificata: fonte fiscale ufficiale per verificare imposte e accise" : null,
    matrix?.components.some((component) => component.auditability === "DOCUMENT_DETAIL_REQUIRED") ? "Dettaglio documentale separato per componenti oggi aggregate, quando necessario" : null,
  ].filter((item): item is string => Boolean(item));
  return items.length ? <section className="bill-audit-missing bill-audit-wide"><h3>PER COMPLETARE L&apos;ANALISI</h3><ul>{items.map((item) => <li key={item}>{item}.</li>)}</ul><p>Non è necessario richiedere una nuova OCR o una nuova bolletta.</p></section> : null;
}

function TechnicalDetailTable({ matrix }: { readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const components = matrix?.components ?? [];
  const details = components.map((component) => ({
    key: component.code, label: component.officialName, authority: component.authority, identifier: component.sourceValue?.officialIdentifier ?? "—",
    period: component.sourceValue ? dateRange(component.sourceValue.effectiveFrom, component.sourceValue.effectiveTo ? inclusiveEnd(component.sourceValue.effectiveTo) : null) : "—",
    original: component.sourceValue ? String(component.sourceValue.sourceOriginalValue ?? "—") + " " + (component.sourceValue.sourceOriginalUnit ?? "") : "—",
    normalized: component.sourceValue ? String(component.sourceValue.normalizedValue ?? "—") + " " + (component.sourceValue.normalizedUnit ?? "") : "—",
    evidence: evidenceText(component.billEvidence), auditability: auditabilityText(component.auditability), source: component.sourceValue?.sourceReference ?? component.reference,
  }));
  return <details className="bill-audit-collapsible bill-audit-wide"><summary>DETTAGLIO TECNICO DELL&apos;ANALISI</summary><p className="bill-audit-collapsible-intro">I valori qui sotto sono la provenienza tecnica dei dati già mostrati nella sintesi.</p><div className="bill-audit-table-wrap"><table className="bill-audit-table bill-audit-technical-table"><thead><tr><th>Componente</th><th>Authority</th><th>Official identifier</th><th>Effective period</th><th>Original unit</th><th>Normalized unit</th><th>Bill evidence</th><th>Auditability</th></tr></thead><tbody>{details.map((detail) => <tr key={detail.key}><th scope="row">{detail.label}</th><td>{detail.authority}</td><td>{detail.identifier}</td><td>{detail.period}</td><td>{detail.original}</td><td>{detail.normalized}</td><td>{detail.evidence}</td><td>{detail.auditability}<small>{detail.source}</small></td></tr>)}</tbody></table></div><p className="bill-audit-technical-note">I dati estratti dalla bolletta sono disponibili nella sezione Provenienza documentale.</p></details>;
}

function TechnicalDetail({ matrix }: { readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const areraUniqueApplicableComponentCount = new Set((matrix?.components ?? []).filter((component) => component.authority === "ARERA").map((component) => component.code)).size;
  return <div><p className="bill-audit-technical-note">Componenti ARERA applicabili (codici univoci): {areraUniqueApplicableComponentCount}</p><TechnicalDetailTable matrix={matrix}/></div>;
}

function Provenance({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  if (!review.provenance.length) return null;
  return <details className="bill-audit-collapsible bill-audit-wide"><summary>PROVENIENZA DOCUMENTALE</summary><div className="bill-audit-provenance-list">{review.provenance.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.source}</strong><small>Confidenza {formatNumber(item.confidence)} · {item.reviewed ? "Confermato" : "Da verificare"}</small></div>)}</div></details>;
}

function ExpandedReceipt({ review, matrix }: { readonly review: BillAnalystReviewDTO; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const components = review.economics.economicAnalysis.components;
  const passThrough = matrix?.components ?? [];
  return <><AuditCard title="SCONTRINO AMPLIATO" className="bill-audit-wide bill-audit-table-card"><p className="bill-audit-intro">Dettaglio atomico della bolletta: le voci marcate come subtotale, totale o dettaglio incluso non vengono sommate una seconda volta.</p><div className="bill-audit-table-wrap"><table className="bill-audit-table bill-audit-technical-table"><thead><tr><th>Descrizione bolletta</th><th>Codice</th><th>Ruolo contabile</th><th>Quantità</th><th>Unità</th><th>Prezzo unitario</th><th>Importo</th><th>Periodo</th><th>Calcolo</th></tr></thead><tbody>{components.map((component, index) => <tr key={`${component.code}-${index}`}><th scope="row">{component.rawDescription || component.description}</th><td>{component.classification}</td><td>{component.accountingRole}</td><td>{component.rawQuantity || "—"}</td><td>{component.rawUnit || "—"}</td><td>{component.rawUnitPrice || "—"}</td><td>{component.rawAmount || "—"}</td><td>{component.rawPeriod || "—"}</td><td>{component.calculationCheck}</td></tr>)}</tbody></table></div></AuditCard><AuditCard title="CORRISPETTIVI REGOLATI / PASSANTI" className="bill-audit-wide bill-audit-table-card"><p className="bill-audit-intro">Il riferimento ufficiale upstream resta distinto dal corrispettivo addebitato al cliente.</p><div className="bill-audit-table-wrap"><table className="bill-audit-table bill-audit-technical-table"><thead><tr><th>Voce</th><th>Valore in bolletta</th><th>Riferimento ufficiale</th><th>Authority</th><th>Periodo</th><th>Esito</th></tr></thead><tbody>{passThrough.map((component) => <tr key={component.code}><th scope="row">{component.officialName}</th><td>{evidenceText(component.billEvidence)}</td><td>{component.sourceValue?.sourceOriginalValue ?? "—"} {component.sourceValue?.sourceOriginalUnit ?? ""}</td><td>{component.authority}</td><td>{component.sourceValue ? dateRange(component.sourceValue.effectiveFrom, component.sourceValue.effectiveTo ? inclusiveEnd(component.sourceValue.effectiveTo) : null) : "—"}</td><td>{component.auditability}</td></tr>)}</tbody></table></div></AuditCard></>;
}

function RegulatedPassThroughTable({ audit }: { readonly audit: BillRegulatoryAuditDTO | null }): ReactNode {
  const items = audit?.regulatedPassThrough?.items ?? [];
  if (!items.length) return null;
  const sourceFile = (item: RegulatedPassThroughItem): string => item.sourceReference?.split("/").pop() ?? "Archivio ufficiale";
  const officialRate = (item: RegulatedPassThroughItem): ReactNode => ["NETWORK_POWER", "CAPACITY_MARKET"].includes(item.code) && item.normalizedOfficialRate !== null ? <>{formatNumber(item.normalizedOfficialRate)} {item.normalizedUnit ?? ""}<small>Fonte originale: {item.officialOriginalValue ?? "—"} {item.officialOriginalUnit ?? ""}</small></> : item.officialReferences.length > 1 ? `${item.officialReferences.length} riferimenti upstream` : `${item.officialOriginalValue ?? "—"} ${item.officialOriginalUnit ?? ""}`;
  const rateText = (value: number | null, unit: string | null): string => value === null ? "—" : `${formatNumber(value)} ${unit ?? ""}`.trim();
  const differenceText = (value: number | null, unit: string | null): string => value === null ? "—" : `${value >= 0 ? "+" : ""}${formatNumber(value)} ${unit ?? ""}`.trim();
  return <AuditCard title="PASSANTI E COMPONENTI REGOLATE" className="bill-audit-wide bill-audit-table-card"><p className="bill-audit-intro">Il confronto è calcolato solo quando componente, profilo, periodo, base e unità sono semanticamente compatibili.</p><div className="bill-audit-table-wrap"><table className="bill-audit-table bill-audit-technical-table"><thead><tr><th>Voce</th><th>Bolletta</th><th>Ufficiale</th><th>Fonte</th><th>Periodo</th><th>Differenza</th><th>Differenza %</th><th>Differenza €</th><th>Esito</th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><th scope="row">{item.label}<small>{item.code}</small></th><td>{rateText(item.billValue, item.billOriginalUnit)}{item.billAmount !== null ? <small>Importo {formatEuro(item.billAmount)}</small> : null}</td><td>{officialRate(item)}</td><td>{item.authority}<small>{(item.officialIdentifier ?? item.officialReferences.map((reference) => reference.officialIdentifier).join(", ")) || "—"}</small>{item.upstreamReferences.length ? <small>Riferimento upstream TERNA — non utilizzato per il confronto customer-facing: {formatNumber(item.upstreamReferences[0].normalizedValue)} {item.upstreamReferences[0].normalizedUnit}</small> : null}<small>{sourceFile(item)}</small>{item.applicationBasis ? <small>{item.applicationBasis}</small> : null}</td><td>{item.effectivePeriod ? dateRange(item.effectivePeriod.from, item.effectivePeriod.to ? inclusiveEnd(item.effectivePeriod.to) : null) : "—"}</td><td>{differenceText(item.unitRateDifference, item.normalizedUnit)}</td><td>{item.unitRateDifferencePercent === null ? "—" : `${item.unitRateDifferencePercent >= 0 ? "+" : ""}${formatNumber(item.unitRateDifferencePercent)} %`}</td><td>{item.amountDifference === null ? "—" : differenceText(item.amountDifference, "EUR")}</td><td><strong>{item.outcome}</strong>{item.reason ? <small>{item.reason}</small> : null}</td></tr>)}</tbody></table></div></AuditCard>;
}

function CompactAnalysisGroup({ title, items }: { readonly title: string; readonly items: readonly RegulatedPassThroughItem[] }): ReactNode {
  if (!items.length) return null;
  return <details className="bill-audit-compact-group"><summary>{title} ({items.length})</summary><div className="bill-audit-table-wrap"><table className="bill-audit-table bill-audit-compact-group-table"><thead><tr><th>Voce</th><th>Riferimento ARERA</th><th>Esito</th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><th scope="row">{item.label}</th><td>{compactPassThroughOfficial(item)}</td><td><StatusBadge tone="neutral">{compactPassThroughStatus(item)}</StatusBadge></td></tr>)}</tbody></table></div></details>;
}

function TechnicalProvenanceDetail({ review, audit, matrix }: { readonly review: BillAnalystReviewDTO; readonly audit: BillRegulatoryAuditDTO | null; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  return <details className="bill-audit-technical-provenance"><summary>DATI TECNICI E PROVENIENZA</summary><div className="bill-audit-detail-stack"><ExpandedReceipt review={review} matrix={matrix}/><RegulatedPassThroughTable audit={audit}/><TechnicalDetail matrix={matrix}/><Provenance review={review}/><DocumentSections review={review}/></div></details>;
}

function AnalysisDetail({ review, audit, matrix }: { readonly review: BillAnalystReviewDTO; readonly audit: BillRegulatoryAuditDTO | null; readonly matrix: DomesticResidentMatrix | null | undefined }): ReactNode {
  const items = audit?.regulatedPassThrough?.items ?? [];
  const comparable = items.filter((item) => item.comparable);
  const aggregated = items.filter((item) => item.status === "PRESENTE_IN_VOCE_AGGREGATA");
  const notIdentified = items.filter((item) => item.status === "NON_IDENTIFICATO_SEPARATAMENTE");
  const summary = audit?.regulatedPassThrough?.summary;
  return <details className="bill-audit-collapsible bill-audit-wide"><summary>DETTAGLIO ANALISI</summary><div className="bill-audit-detail-stack bill-audit-compact-detail"><AuditCard title="RIEPILOGO COMPONENTI REGOLATE" className="bill-audit-compact-summary"><DataRows rows={summary ? [{ label: "Confrontabili", value: summary.comparableCount }, { label: "Conformi", value: summary.matchingCount }, { label: "Superiori", value: summary.overReferenceCount }, { label: "Inferiori", value: summary.underReferenceCount }, { label: "In voce aggregata", value: summary.aggregatedCount }, { label: "Non identificate", value: summary.notIdentifiedCount }] : []}/><h4 className="bill-audit-subsection-title">COMPONENTI CONFRONTATE ({comparable.length})</h4><RegulatedCostsTable items={comparable}/></AuditCard><CompactAnalysisGroup title="COMPONENTI PRESENTI IN VOCE AGGREGATA" items={aggregated}/><CompactAnalysisGroup title="COMPONENTI NON IDENTIFICATE SEPARATAMENTE" items={notIdentified}/><TechnicalProvenanceDetail review={review} audit={audit} matrix={matrix}/></div></details>;
}

function LegacyDocumentHeader({ bill, approved }: { readonly bill: BillDocumentModel; readonly approved: boolean }): ReactNode {
  const review = bill.analystReview;
  const total = review.economics.economicAnalysis.totals.billTotal ?? componentNumber(review.economics.total.value);
  const amountDue = review.economics.economicAnalysis.totals.amountDue ?? review.economics.economicAnalysis.totals.currentPeriodTotal ?? total;
  const consumption = review.consumption.billed.value;
  return <div className="bill-audit-document-header"><div><p className="eyebrow">SCONTRINO DELL&apos;ENERGIA</p><h3>{review.document.fileName}</h3><p>{review.customer.name.value ?? "Intestatario non presente in bolletta"}{review.receipt.invoiceNumber.value ? ` · Fattura ${review.receipt.invoiceNumber.value}` : ""}{review.dates.billDueDate.value ? ` · Scadenza ${review.dates.billDueDate.value}` : ""}</p></div><div className="bill-audit-document-meta"><div><span>Periodo</span><strong>{formatBillDisplayPeriod(review.dates.billingPeriodStart.value, review.dates.billingPeriodEnd.value) || "Da verificare"}</strong></div><div><span>Consumo</span><strong>{consumption === null || consumption === undefined ? "Da verificare" : `${formatNumber(consumption)} kWh`}</strong></div><div><span>Totale bolletta</span><strong>{total === null ? "Da verificare" : formatEuro(total)}</strong></div><div><span>Totale da pagare</span><strong>{amountDue === null ? "Da verificare" : formatEuro(amountDue)}</strong></div><div><span>Versione</span><strong>v{review.document.versionNumber}</strong></div><div><span>Stato revisione</span><strong>{approved ? "Approvata" : reviewStatus(review.document.status)}</strong></div></div></div>;
}

function DocumentHeader({ bill, approved }: { readonly bill: BillDocumentModel; readonly approved: boolean }): ReactNode {
  const review = bill.analystReview;
  const billingAddress = review.receipt.billingAddress.status === "FOUND" && review.receipt.billingAddress.value ? review.receipt.billingAddress.value : "Non rilevato";
  const meta: DisplayRow[] = [
    { label: "INTESTATARIO BOLLETTA", value: review.customer.name.value ?? "Non presente in bolletta" }, ...(review.customer.taxIdentifier.value ? [{ label: "Codice fiscale / P.IVA", value: review.customer.taxIdentifier.value }] : []), { label: "Indirizzo di fatturazione", value: billingAddress }, { label: "POD", value: review.supply.pod.value ?? "Non presente in bolletta" }, { label: "Indirizzo fornitura", value: review.supply.address.value ?? "Non presente in bolletta" },
    { label: "Periodo", value: formatBillDisplayPeriod(review.dates.billingPeriodStart.value, review.dates.billingPeriodEnd.value) || "Non determinabile" }, { label: "Scadenza pagamento", value: review.dates.billDueDate.value ?? "Non presente in bolletta" },
  ];
  return <div className="bill-audit-document-header bill-audit-clean-header"><div><p className="eyebrow">DATI BOLLETTA</p><h3>{review.document.fileName}</h3></div><div className="bill-audit-document-meta">{meta.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div><div className="bill-audit-header-secondary"><span>v{review.document.versionNumber}</span><span>{approved ? "Approvata" : reviewStatus(review.document.status)}</span></div></div>;
}

function BillReviewMain({ bill, review, audit, matrix, approved, readonly, pending, editing, corrections, onCorrection, onEdit, onCancelEdit, onSave, onApprove, onRetry, onDelete, onUseSimulation }: { readonly bill: BillDocumentModel; readonly review: BillAnalystReviewDTO; readonly audit: BillRegulatoryAuditDTO | null; readonly matrix: DomesticResidentMatrix | null | undefined; readonly approved: boolean; readonly readonly: boolean; readonly pending: BillAction | null; readonly editing: boolean; readonly corrections: Readonly<Record<string, string>>; readonly onCorrection: (field: CorrectionField, value: string) => void; readonly onEdit: () => void; readonly onCancelEdit: () => void; readonly onSave: () => void; readonly onApprove: () => void; readonly onRetry: () => void; readonly onDelete: () => void; readonly onUseSimulation: () => void }): ReactNode {
  return <div className="bill-audit-detail"><DocumentHeader bill={bill} approved={approved}/><div className="bill-audit-header-actions">{approved && review.simulationDraft ? <button className="button primary" type="button" onClick={onUseSimulation} disabled={readonly}>Usa nella simulazione</button> : null}{!approved && (review.document.status === "FAILED" || review.document.status === "OCR_PROVIDER_REQUIRED") ? <button className="button secondary" type="button" onClick={onRetry} disabled={readonly || pending !== null}>Riprova lettura</button> : null}</div><div className="bill-audit-top-grid"><SupplyProfile review={review}/><PeriodAndConsumption review={review}/></div><CleanOfferSummary review={review} audit={audit} matrix={matrix}/><CleanEnergyReceiptCompact review={review}/><PaymentSummary review={review}/><VerificationSummary review={review} audit={audit}/><AnalysisDetail review={review} audit={audit} matrix={matrix}/>{!approved && review.document.approvalReady ? <div className="button-row"><button className="button primary" type="button" onClick={onApprove} disabled={readonly || pending !== null}>Approva bolletta</button></div> : null}{!approved ? <section className="bill-audit-review-actions"><h3>AZIONI DOCUMENTO</h3><div className="button-row">{editing ? <><button className="button primary" type="button" onClick={onSave} disabled={readonly || pending !== null}>Salva modifiche</button><button className="button secondary" type="button" onClick={onCancelEdit} disabled={pending !== null}>Annulla</button></> : <button className="button secondary" type="button" onClick={onEdit} disabled={readonly || pending !== null}>Modifica dati</button>}</div>{editing ? <div className="form-grid">{(Object.keys(correctionLabels) as CorrectionField[]).map((field) => <FormField key={field} id={"bill-" + field} label={correctionLabels[field]}><input id={"bill-" + field} value={corrections[field] ?? valueForCorrection(review, field)} onChange={(event) => onCorrection(field, event.target.value)} disabled={pending !== null}/></FormField>)}</div> : null}</section> : <p className="inline-success" role="status">Bolletta approvata · sola lettura</p>}{!approved ? <button className="button danger" type="button" onClick={onDelete} disabled={readonly || pending !== null}>Cancella</button> : null}</div>;
}

function valueForCorrection(review: BillAnalystReviewDTO, field: CorrectionField): string {
  const item = field === "supplier" ? review.supply.supplier : field === "pod" ? (review.supply.vector.value === "GAS" ? review.supply.pdr : review.supply.pod) : field === "customerName" ? review.customer.name : field === "billingPeriod" ? review.dates.billingPeriodRaw : field === "annualConsumption" ? review.consumption.annual : field === "billedConsumption" ? review.consumption.billed : review.economics.total;
  return item.raw ?? fieldValue(item) ?? "";
}

function DocumentSections({ review }: { readonly review: BillAnalystReviewDTO }): ReactNode {
  const isEe = review.supply.vector.value === "EE";
  const supplyDefinitions: ReviewDefinition[] = [["supplier", "Fornitore", review.supply.supplier]];
  if (isEe) supplyDefinitions.push(["pod", "POD", review.supply.pod], ["address", "Indirizzo", review.supply.address]);
  else supplyDefinitions.push(["pdr", "PDR", review.supply.pdr], ["address", "Indirizzo", review.supply.address]);
  const rows = rowsFrom(supplyDefinitions);
  return rows.length ? <AuditCard title="DATI DOCUMENTALI" className="bill-audit-wide"><DataRows rows={rows}/></AuditCard> : null;
}

function BillDetail({ bill, approved, readonly, pending, editing, corrections, onCorrection, onEdit, onCancelEdit, onSave, onApprove, onRetry, onDelete, onUseSimulation }: { readonly bill: BillDocumentModel; readonly approved: boolean; readonly readonly: boolean; readonly pending: BillAction | null; readonly editing: boolean; readonly corrections: Readonly<Record<string, string>>; readonly onCorrection: (field: CorrectionField, value: string) => void; readonly onEdit: () => void; readonly onCancelEdit: () => void; readonly onSave: () => void; readonly onApprove: () => void; readonly onRetry: () => void; readonly onDelete: () => void; readonly onUseSimulation: () => void }): ReactNode {
  const review = bill.analystReview;
  const audit = bill.regulatoryAudit;
  const matrix = audit?.domesticResidentMatrix;
  if (Boolean(review)) return <BillReviewMain bill={bill} review={review} audit={audit} matrix={matrix} approved={approved} readonly={readonly} pending={pending} editing={editing} corrections={corrections} onCorrection={onCorrection} onEdit={onEdit} onCancelEdit={onCancelEdit} onSave={onSave} onApprove={onApprove} onRetry={onRetry} onDelete={onDelete} onUseSimulation={onUseSimulation}/>;
  if (Boolean(review)) return <div className="bill-audit-detail"><DocumentHeader bill={bill} approved={approved}/><div className="bill-audit-header-actions">{approved && review.simulationDraft ? <button className="button primary" type="button" onClick={onUseSimulation} disabled={readonly}>Usa nella simulazione</button> : null}{!approved && (review.document.status === "FAILED" || review.document.status === "OCR_PROVIDER_REQUIRED") ? <button className="button secondary" type="button" onClick={onRetry} disabled={readonly || pending !== null}>Riprova lettura</button> : null}</div><div className="bill-audit-top-grid"><SupplyProfile review={review}/><PeriodAndConsumption review={review}/></div><CleanOfferSummary review={review} matrix={matrix}/><CleanEnergyReceiptCompact review={review}/><PaymentSummary review={review}/><VerificationSummary review={review} audit={audit}/><AnalysisDetail review={review} audit={audit} matrix={matrix}/>{!approved && review.document.approvalReady ? <div className="button-row"><button className="button primary" type="button" onClick={onApprove} disabled={readonly || pending !== null}>{pending === "approve" ? "Approvazione in corso…" : "Approva bolletta"}</button></div> : null}{!approved ? <section className="bill-audit-review-actions"><h3>AZIONI DOCUMENTO</h3><div className="button-row">{editing ? <><button className="button primary" type="button" onClick={onSave} disabled={readonly || pending !== null}>{pending === "correct" ? "Salvataggio in corso…" : "Salva modifiche"}</button><button className="button secondary" type="button" onClick={onCancelEdit} disabled={pending !== null}>Annulla</button></> : <button className="button secondary" type="button" onClick={onEdit} disabled={readonly || pending !== null}>Modifica dati</button>}</div>{editing ? <div className="form-grid">{(Object.keys(correctionLabels) as CorrectionField[]).map((field) => <FormField key={field} id={"bill-" + field} label={correctionLabels[field]}><input id={"bill-" + field} value={corrections[field] ?? valueForCorrection(review, field)} onChange={(event) => onCorrection(field, event.target.value)} disabled={pending !== null}/></FormField>)}</div> : null}</section> : <p className="inline-success" role="status">Bolletta approvata · sola lettura</p>}{!approved ? <button className="button danger" type="button" onClick={onDelete} disabled={readonly || pending !== null}>{pending === "delete" ? "Cancellazione in corso…" : "Cancella"}</button> : null}</div>;
  return <div className="bill-audit-detail"><DocumentHeader bill={bill} approved={approved}/><div className="bill-audit-header-actions">{approved && review.simulationDraft ? <button className="button primary" type="button" onClick={onUseSimulation} disabled={readonly}>Usa nella simulazione</button> : null}{!approved && (review.document.status === "FAILED" || review.document.status === "OCR_PROVIDER_REQUIRED") ? <button className="button secondary" type="button" onClick={onRetry} disabled={readonly || pending !== null}>Riprova lettura</button> : null}</div><div className="bill-audit-top-grid"><SupplyProfile review={review}/><PeriodAndConsumption review={review}/></div><AuditSummary audit={audit}/><EnergyPrice review={review} matrix={matrix}/><div className="bill-audit-grid"><AreraSection matrix={matrix}/><DispatchingSection matrix={matrix}/><CapacitySection matrix={matrix}/><SellerSection review={review}/><TaxSection review={review}/></div><MissingAnalysis audit={audit} matrix={matrix}/><TechnicalDetail matrix={matrix}/><Provenance review={review}/><DocumentSections review={review}/>{!approved && review.document.approvalReady ? <div className="button-row"><button className="button primary" type="button" onClick={onApprove} disabled={readonly || pending !== null}>{pending === "approve" ? "Approvazione in corso…" : "Approva bolletta"}</button></div> : null}{!approved ? <section className="bill-audit-review-actions"><h3>AZIONI DOCUMENTO</h3><div className="button-row">{editing ? <><button className="button primary" type="button" onClick={onSave} disabled={readonly || pending !== null}>{pending === "correct" ? "Salvataggio in corso…" : "Salva modifiche"}</button><button className="button secondary" type="button" onClick={onCancelEdit} disabled={pending !== null}>Annulla</button></> : <button className="button secondary" type="button" onClick={onEdit} disabled={readonly || pending !== null}>Modifica dati</button>}</div>{editing ? <div className="form-grid">{(Object.keys(correctionLabels) as CorrectionField[]).map((field) => <FormField key={field} id={"bill-" + field} label={correctionLabels[field]}><input id={"bill-" + field} value={corrections[field] ?? valueForCorrection(review, field)} onChange={(event) => onCorrection(field, event.target.value)} disabled={pending !== null}/></FormField>)}</div> : null}</section> : <p className="inline-success" role="status">Bolletta approvata · sola lettura</p>}{!approved ? <button className="button danger" type="button" onClick={onDelete} disabled={readonly || pending !== null}>{pending === "delete" ? "Cancellazione in corso…" : "Cancella"}</button> : null}</div>;
}

function ReceivedRow({ bill, selected, onOpen, onRetry, onDelete }: { readonly bill: BillDocumentModel; readonly selected: boolean; readonly onOpen: () => void; readonly onRetry: () => void; readonly onDelete: () => void }): ReactNode {
  const status = bill.analystReview.document.status;
  const retryable = status === "FAILED" || status === "OCR_PROVIDER_REQUIRED";
  return <div className={"data-line cte-received-row" + (selected ? " selected" : "")}><button className="cte-received-document" type="button" onClick={onOpen}><span>{bill.analystReview.document.fileName}</span><small>{reviewStatus(status)}</small></button>{retryable ? <button className="button compact secondary" type="button" onClick={onRetry}>Riprova lettura</button> : null}<button className="button compact danger" type="button" onClick={onDelete}>Cancella</button></div>;
}
function ArchiveRow({ bill, selected, onOpen }: { readonly bill: ApprovedBillSummaryModel; readonly selected: boolean; readonly onOpen: () => void }): ReactNode {
  return <button className={"data-line cte-approved-archive-row" + (selected ? " selected" : "")} type="button" onClick={onOpen}><span><strong>{bill.title}</strong><small>{bill.supplier ?? "Fornitore non rilevato"} · {bill.supplyReference ?? "POD/PDR non rilevato"}</small></span><strong className="status-badge positive">Approvata</strong></button>;
}

export default function BillOperationalPanel({ readonly, onUseInSimulation }: { readonly readonly: boolean; readonly onUseInSimulation: (draft: SimulationDraft) => void }) {
  const [received, setReceived] = useState<readonly BillDocumentModel[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [archive, setArchive] = useState<readonly ApprovedBillSummaryModel[]>([]);
  const [selected, setSelected] = useState<BillDocumentModel | null>(null);
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<BillAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [corrections, setCorrections] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const busyRef = useRef(false);
  const load = useCallback(async () => {
    const [incoming, approvedList] = await Promise.all([requestJson<{ readonly documents: readonly BillDocumentModel[] }>("/api/bills"), requestJson<{ readonly documents: readonly ApprovedBillSummaryModel[] }>("/api/bills?view=approved")]);
    setReceived(incoming.documents); setArchive(approvedList.documents);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(errorText(cause))); }, [load]);
  const open = async (id: string, isApproved: boolean) => {
    try { const result = await requestJson<{ readonly document: BillDocumentModel }>("/api/bills/" + encodeURIComponent(id) + (isApproved ? "?view=approved" : "")); setSelected(result.document); setApproved(isApproved); setEditing(false); setCorrections({}); }
    catch (cause) { setError(errorText(cause)); }
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || readonly || busyRef.current) return;
    if (file.type !== "application/pdf" || file.size > 10_000_000) { setError("Il file PDF non rispetta i limiti di formato o dimensione."); return; }
    busyRef.current = true; setPending("upload"); setError(undefined);
    try { const result = await requestForm<{ readonly document: BillDocumentModel }>("/api/bills", (() => { const body = new FormData(); body.set("file", file); return body; })()); await load(); await open(result.document.id, false); setMessage("Bolletta caricata: lettura completata."); }
    catch (cause) { setError(errorText(cause)); } finally { busyRef.current = false; setPending(null); }
  };
  const approve = async () => {
    if (!selected || approved || readonly || busyRef.current) return;
    busyRef.current = true; setPending("approve");
    try { const result = await requestJson<{ readonly document: BillDocumentModel }>("/api/bills/" + encodeURIComponent(selected.id), { method: "PATCH", body: JSON.stringify({ operation: "approve", versionId: selected.currentVersionId }) }); setSelected(result.document); await load(); setMessage("Bolletta approvata e archivio aggiornato."); }
    catch (cause) { setError(errorText(cause)); } finally { busyRef.current = false; setPending(null); }
  };
  const saveCorrections = async () => {
    if (!selected || approved || readonly || busyRef.current) return;
    const entries = Object.entries(corrections).filter(([, value]) => value.trim()); if (!entries.length) { setEditing(false); return; }
    busyRef.current = true; setPending("correct");
    try { let current = selected; for (const [field, value] of entries) { const result = await requestJson<{ readonly document: BillDocumentModel }>("/api/bills/" + encodeURIComponent(current.id), { method: "PATCH", body: JSON.stringify({ operation: "correct", field, value, versionId: current.currentVersionId }) }); current = result.document; } setSelected(current); setCorrections({}); setEditing(false); await load(); setMessage("Modifiche registrate in una nuova versione."); }
    catch (cause) { setError(errorText(cause)); } finally { busyRef.current = false; setPending(null); }
  };
  const retry = async (documentId = selected?.id) => {
    if (!documentId || readonly || busyRef.current) return;
    busyRef.current = true; setPending("retry");
    try { const result = await requestJson<{ readonly document: BillDocumentModel }>("/api/bills/" + encodeURIComponent(documentId) + "/retry", { method: "POST" }); setSelected(result.document); setApproved(false); setEditing(false); setCorrections({}); await load(); setMessage("Lettura ripetuta sul documento originale."); }
    catch (cause) { setError(errorText(cause)); } finally { busyRef.current = false; setPending(null); }
  };
  const removeDocument = async (id: string) => {
    if (readonly || busyRef.current) return;
    busyRef.current = true; setPending("delete");
    try { await requestJson("/api/bills/" + encodeURIComponent(id), { method: "DELETE" }); if (selected?.id === id) { setSelected(null); setApproved(false); } await load(); setMessage("Documento cancellato."); }
    catch (cause) { setError(errorText(cause)); } finally { busyRef.current = false; setPending(null); }
  };
  return <div className="content-stack"><div className="section-header"><div><p className="eyebrow">DOCUMENTI E PROVENIENZA</p><h2>Bollette</h2><p className="section-detail">Lettura, revisione e archivio sono tenant-scoped dal server. I dati mancanti restano non rilevati.</p></div><label className="button primary">Carica bolletta<input className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={upload} disabled={readonly || pending !== null}/></label></div>{pending === "upload" ? <LoadingState label="Lettura bolletta in corso…"/> : null}{error ? <ErrorState message={error}/> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}{deleteTarget ? <div className="cte-delete-confirmation" role="alertdialog" aria-label="Conferma cancellazione"><p>Vuoi cancellare questo documento?</p><div className="button-row"><button className="button secondary" type="button" onClick={() => setDeleteTarget(null)} disabled={pending === "delete"}>Annulla</button><button className="button danger" type="button" onClick={() => { const id = deleteTarget; setDeleteTarget(null); if (id) void removeDocument(id); }} disabled={pending === "delete"}>Cancella documento</button></div></div> : null}<div className="two-columns"><section className="ui-card"><h3>Documenti ricevuti</h3>{received.length ? received.map((bill) => <ReceivedRow key={bill.id} bill={bill} selected={selected?.id === bill.id && !approved} onOpen={() => void open(bill.id, false)} onRetry={() => void retry(bill.id)} onDelete={() => setDeleteTarget(bill.id)}/>) : <EmptyState title="Nessuna bolletta da revisionare" detail="Le bollette approvate sono disponibili nell&apos;archivio approvato."/>}</section><section className="ui-card"><h3>Archivio bollette approvate</h3>{archive.length ? archive.map((bill) => <ArchiveRow key={bill.id} bill={bill} selected={selected?.id === bill.id && approved} onOpen={() => void open(bill.id, true)}/>) : <EmptyState title="Nessuna bolletta approvata" detail="Le bollette approvate compariranno qui."/>}</section></div><section className="ui-card bill-review-shell"><h3>{approved ? "Bolletta approvata" : "Revisione bolletta"}</h3>{selected ? <BillDetail bill={selected} approved={approved} readonly={readonly} pending={pending} editing={editing} corrections={corrections} onCorrection={(field, value) => setCorrections((current) => ({ ...current, [field]: value }))} onEdit={() => setEditing(true)} onCancelEdit={() => { setEditing(false); setCorrections({}); }} onSave={() => void saveCorrections()} onApprove={() => void approve()} onRetry={() => void retry()} onDelete={() => setDeleteTarget(selected.id)} onUseSimulation={() => { const draft = selected.analystReview.simulationDraft; if (draft) onUseInSimulation(draft as SimulationDraft); }}/>: <EmptyState title="Nessuna bolletta selezionata" detail="Seleziona un documento ricevuto o una bolletta approvata."/>}</section></div>;
}
