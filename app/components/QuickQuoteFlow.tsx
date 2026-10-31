"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "./UiStates";
import { downloadExport, requestForm, requestJson, toUiError } from "../lib/ui/client";
import { buildQuoteReceipt, effectiveBillSpread, isSameOffer, regulatedVerification, sameOfferDifferences, type QuoteReceipt, type RegulatedDomain } from "../lib/quote/receipt";
import { customerTypeOf } from "../lib/ingestion/customer-type";
import { estimatedAnnualConsumption } from "../lib/calculation/annual-consumption";
import { historyMonthTotals } from "../lib/ingestion/consumption-history";
import type { ApprovedBillSummaryModel, BillDocumentModel, CalculationModel, ComparisonModel, ProposalModel } from "../lib/ui/models";

type Step = "bill" | "review" | "offers";
type Pending = "upload" | "open" | "confirm" | "offers" | "proposal";
type Context = {
  readonly billId: string; readonly billVersionId: string; readonly vector: "EE" | "GAS"; readonly customerType: "RESIDENTIAL" | "NON_RESIDENTIAL";
  readonly supply: { readonly pod: string | null; readonly pdr: string | null; readonly voltageLevel: "LV" | "MV" | "HV" | "EHV" | null; readonly contractedPowerKw?: number | null };
  readonly consumption?: { readonly annual: number | null; readonly period: { readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly smc: number | null }; readonly monthlyProfile?: readonly { readonly f1: number; readonly f2: number; readonly f3: number }[] | null; readonly history?: readonly { readonly month: string; readonly quantity: number }[] };
  readonly currentOffer?: { readonly name: string | null; readonly code: string | null };
  readonly billingPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly currentSupplier: string;
  readonly classification: { readonly domestic: boolean };
  readonly missingRequiredData: readonly string[];
  readonly economicReconciled?: boolean;
};
type Unlisted = { readonly archiveId: string; readonly supplier: string; readonly offer: { readonly name: string; readonly code: string }; readonly reason: string };
type Candidate = { readonly archiveId: string; readonly cteVersionId: string | null; readonly supplier: string; readonly offer: { readonly name: string; readonly code: string }; readonly validity: { readonly periodStart: string; readonly periodEnd: string }; readonly finalStatus?: string; readonly calculationReadiness: string; readonly compatibilityReason?: string; readonly reasonCodes?: readonly string[]; readonly overrideRequestable?: boolean; readonly eligibilityOverrideId?: string; readonly scope?: { readonly customer: string; readonly voltage: readonly string[]; readonly consumption: string | null; readonly uses: readonly string[] }; readonly pricingType?: "INDEXED" | "FIXED" | null; readonly pricingReference?: string | null; readonly terms?: Terms };
type Terms = { readonly fixedPrice: number | null; readonly spread: number | null; readonly priceUnit: "EUR_PER_KWH" | "EUR_PER_SMC"; readonly monthlyFixedFee: number | null };
type Offer = { readonly rank: number; readonly calculation: CalculationModel; readonly supplier: string; readonly offerName: string; readonly receipt: QuoteReceipt; readonly candidate: Candidate };
type Quote = { readonly bill: BillDocumentModel; readonly context: Context; readonly comparison: ComparisonModel; readonly offers: readonly Offer[]; readonly candidates?: readonly Candidate[]; readonly unlisted?: readonly Unlisted[]; readonly canAuthorizeCte?: boolean };

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
  // A consumption read as 17.520 is seventeen thousand kWh, as the server parses it, not 17,52.
  if (name !== "totalAmount" && /^\d{1,3}(\.\d{3})+$/.test(value.trim())) return value.trim();
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
// When the bill does not print the annual consumption, it is the average monthly consumption on the bill times 12.
function estimatedAnnual(document: BillDocumentModel): string | null {
  const billed = Number(document.fields.billedConsumption?.value);
  const dates = /(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/.exec(document.fields.billingPeriod?.value ?? "");
  if (!Number.isFinite(billed) || billed <= 0 || !dates) return null;
  // Tony (30/10): the consumption history on the bill, when there is one, is the basis of the monthly average.
  const history = historyMonthTotals(document.structuredBill?.consumptionHistory);
  const annual = estimatedAnnualConsumption({ billed, periodStart: dates[1], periodEnd: dates[2], monthTotals: history.length ? history : null });
  return annual === null ? null : String(annual);
}
function readValues(document: BillDocumentModel): Record<string, string> {
  const values = Object.fromEntries(FIELDS.map((field) => [field.name, toDisplay(field.name, document.fields[field.name]?.value)]));
  if (!values.annualConsumption?.trim()) { const estimate = estimatedAnnual(document); if (estimate) values.annualConsumption = toDisplay("annualConsumption", estimate); }
  return values;
}
const MAX_BILL_BYTES = 10 * 1024 * 1024;
const DATE = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const PERCENT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function euro(value: number | null): string { return value === null ? "—" : EURO.format(value); }
function date(value: string | null): string { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? DATE.format(new Date(`${value}T00:00:00Z`)) : "Non indicata"; }
function daysUntil(value: string | null, today: string): number | null { return value ? Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null; }
// Household offers from 1/4/2026 have one spread covering commercializzazione and sbilanciamento (delibera 386/2025).
function householdSpreadOf(context: Context, calculation: CalculationModel): boolean { return context.classification.domestic && calculation.vector === "EE" && (calculation.supplyPeriod?.periodStart ?? "").slice(0, 10) >= "2026-04-01"; }
function message(cause: unknown): string { return toUiError(cause).message; }
// The server's error code, when it sends one, goes with the message so the user can report it.
function withDetail(cause: unknown): string { const error = toUiError(cause); return error.detail ? `${error.message} (codice ${error.detail})` : error.message; }
const NUMBER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
function amount(value: number | null | undefined, unit: string): string { return value === null || value === undefined ? "—" : `${NUMBER.format(value)} ${unit}`; }
const VOLTAGE: Record<string, string> = { LV: "Bassa tensione (BT)", MV: "Media tensione (MT)", HV: "Alta tensione (AT)", EHV: "Altissima tensione (AAT)" };
const MISSING: Record<string, string> = { customerType: "tipo cliente", billingPeriod: "periodo fatturato", POD: "POD", PDR: "PDR", voltageLevel: "livello di tensione", F1: "consumo F1", F2: "consumo F2", F3: "consumo F3", SMC: "consumo in Smc", technicalClassification: "uso della fornitura" };
// Tony (29/10): "proviamo ad usare 5 decimali e vedere meglio lo spread".
const RATE = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 5, maximumFractionDigits: 6 });
const PUN = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
// Price lines the agent quotes from the CTE: fixed price or spread on the index, and the monthly PCV.
function termLines(candidate: Candidate): readonly string[] {
  const terms = candidate.terms;
  if (!terms) return [];
  const unit = terms.priceUnit === "EUR_PER_SMC" ? "€/Smc" : "€/kWh";
  const index = candidate.pricingReference === "PSV" ? "PSV" : "PUN";
  return [
    terms.fixedPrice !== null ? `Prezzo fisso ${RATE.format(terms.fixedPrice)} ${unit}` : null,
    terms.spread !== null ? `${terms.fixedPrice !== null ? "Spread" : `${index} + spread`} ${RATE.format(terms.spread)} ${unit}` : terms.fixedPrice === null ? "Spread non indicato nella CTE" : null,
    `PCV mensile ${terms.monthlyFixedFee === null ? "non indicata nella CTE" : `${EURO.format(terms.monthlyFixedFee)} al mese`}`,
  ].filter((line): line is string => line !== null);
}

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
    const found = bill.structuredBill?.extendedFacts.find((fact) => fact.code === code && fact.status === "FOUND" && fact.value.trim() && !/^NOT_FOUND$/i.test(fact.value.trim()));
    if (found) return found.value.trim();
  }
  return null;
}
// Monthly PCV: the seller's fixed fee (PCV, quota fissa di vendita, commercializzazione) per month, never network or power charges.
// Over 12 months the energy part scales with the annual consumption, while fixed fees (PCV, annual options such as Flex) count once per month.
function annualProjection(offer: Offer, context: Context, bill: BillDocumentModel): { readonly saving: number; readonly current: number | null } | null {
  const basis = annualBasis(context);
  const receipt = offer.receipt;
  if (!basis || receipt.status !== "COMPLETE" || receipt.savings === null) return null;
  const days = (Date.parse(`${context.billingPeriod.periodEnd}T00:00:00Z`) - Date.parse(`${context.billingPeriod.periodStart}T00:00:00Z`)) / 86_400_000 + 1;
  const months = Math.max(1, Math.round(days / 30.4375));
  const offerFixed = offer.calculation.components.filter((component) => component.category === "FIXED_FEE").reduce((sum, component) => sum + (component.sign === "DISCOUNT" ? -1 : 1) * component.amount.amount, 0);
  const billFixed = (monthlyPcv(bill) ?? 0) * months;
  const factor = basis.annual / basis.billed;
  const fixedSaving = billFixed - offerFixed;
  const saving = (receipt.savings - fixedSaving) * factor + fixedSaving / months * 12;
  const current = receipt.currentTotal === null ? null : (receipt.currentTotal - billFixed) * factor + billFixed / months * 12;
  return { saving, current };
}
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
// A fact the reading found, even if marked to review: enough to say the bill shows it, never to price with it.
function factSeen(bill: BillDocumentModel, ...codes: readonly string[]): string | null {
  for (const code of codes) {
    const seen = bill.structuredBill?.extendedFacts.find((fact) => fact.code === code && (fact.status === "FOUND" || fact.status === "NEEDS_REVIEW") && fact.value.trim() && !/^NOT_FOUND$/i.test(fact.value.trim()));
    if (seen) return seen.value.trim();
  }
  return null;
}
// Tony (31/10, bolletta sintetica BPower "ma che cazzo dici, guarda la bolletta"): a box dell'offerta with an index
// (PUN) and a spread is an indexed offer, whatever words the seller uses for the offer type.
function indexedFromBox(bill: BillDocumentModel): boolean {
  const formula = factSeen(bill, "PRICE_FORMULA_RAW") ?? "";
  return (factSeen(bill, "INDEX_NAME") !== null && factSeen(bill, "SPREAD") !== null) || (/\bspread\b/i.test(formula) && factSeen(bill, "INDEX_NAME") !== null)
    || (bill.currentSpread?.status === "CALCULATED" && bill.currentSpread.source === "BILL" && factSeen(bill, "INDEX_NAME") !== null);
}
// Tony (31/10, fattura di dettaglio BPower "cazzo ancora errori"): a bill whose energy lines are each the official PUN of
// their band plus the same amount (0,226350 / 0,247576 / 0,217024 €/kWh = PUN F1/F2/F3 + 0,02) is indexed, even when no box
// dell'offerta says so.
function indexedFromPrices(bill: BillDocumentModel): boolean {
  const spread = bill.currentSpread;
  if (spread?.status !== "CALCULATED" || spread.source !== "CALCULATED" || !spread.lines.length) return false;
  const values = spread.lines.filter((line) => line.officialPun !== null).map((line) => line.spread);
  return values.length > 0 && values.length === spread.lines.length && Math.max(...values) - Math.min(...values) <= 0.0005 && values.every((value) => value > -0.01 && value < 0.1);
}
// The detailed invoice (fattura di dettaglio) lists only the charges: no offer name, dates or price formula.
function withoutOfferBox(bill: BillDocumentModel): boolean {
  const receipt = bill.analystReview.receipt;
  // A failed second reading is not a detailed invoice: the box may be there and simply not read.
  if (bill.structuredBill?.analystExtractionStatus === "FAILED") return false;
  return !receipt.offerName.value?.trim() && !bill.structuredBill?.documentOfferName?.trim() && !receipt.offerCode.value?.trim()
    && !receipt.contractStartDate.value && !receipt.economicConditionsStartDate.value && !billExpiry(bill)
    && factSeen(bill, "PRICE_MECHANISM_RAW", "PRICE_FORMULA_RAW", "PRICE_TIME_STRUCTURE_RAW", "CONTRACT_START_DATE", "ECONOMIC_CONDITIONS_START_DATE", "INDEX_NAME", "SPREAD", "ECONOMIC_EXPIRY", "CONTRACT_EXPIRY") === null;
}
const NOT_IN_DETAIL = "Non riportata: la fattura di dettaglio non ha il box dell'offerta";

function priceType(bill: BillDocumentModel): string {
  const receipt = bill.analystReview.receipt;
  const text = [factValue(bill, "PRICE_MECHANISM_RAW"), factValue(bill, "PRICE_FORMULA_RAW"), factValue(bill, "INDEX_NAME")].filter(Boolean).join(" ");
  const index = /psv/i.test(text) || bill.resolvedVector === "GAS" ? "PSV" : "PUN";
  const fixed = factValue(bill, "FIXED_PRICE", "ENERGY_FIXED_PRICE", "MONORARIO_PRICE");
  const indexed = /variabil|indicizz|pun|psv|index/i.test(text) || receipt.priceMechanism === "INDEXED_PUN_PLUS_SPREAD" || indexedFromBox(bill);
  if (indexed) return `Indicizzato ${index}`;
  if (/fiss/i.test(text) || receipt.priceMechanism === "FIXED") return `Prezzo fisso${fixed ? ` ${fixed}` : ""}`;
  if (receipt.priceMechanism === "HYBRID") return "Misto (fisso e indicizzato)";
  return indexedFromPrices(bill) ? `Indicizzato ${index} (ricavato dai prezzi in bolletta)` : "Non indicato";
}

function indexedBill(bill: BillDocumentModel): boolean {
  const text = [factValue(bill, "PRICE_MECHANISM_RAW"), factValue(bill, "PRICE_FORMULA_RAW"), factValue(bill, "INDEX_NAME")].filter(Boolean).join(" ");
  return /variabil|indicizz|pun|psv|index/i.test(text) || bill.analystReview.receipt.priceMechanism === "INDEXED_PUN_PLUS_SPREAD" || indexedFromBox(bill) || indexedFromPrices(bill);
}
// The spread is never printed on the bill: the server derives it as applied energy price minus the official GME PUN of the same months.
function billSpread(bill: BillDocumentModel): ReactNode {
  const spread = bill.currentSpread;
  if (!spread) return "Non calcolabile per questa bolletta";
  if (spread.status === "PUN_NOT_PUBLISHED") return `Non ancora calcolabile: il GME pubblica il PUN ufficiale del mese entro il ${date(spread.publishedBy ?? null)}`;
  if (spread.status === "PUN_EXPIRED") return "Non calcolabile: il PUN di quel mese non è più in archivio (lo conserviamo circa 5 mesi)";
  if (spread.status === "PUN_MISSING") return "Non calcolabile: il PUN GME del mese non è ancora in archivio, verrà acquisito al prossimo aggiornamento (ogni 15 giorni)";
  if (spread.status === "PRICE_MISSING" || spread.spread === null) return "Non calcolabile: la bolletta non mostra il prezzo dell'energia";
  // Tony (28/10): only the value; the "prezzo energia in bolletta meno PUN" working was confusing in the column.
  return `${RATE.format(spread.spread)} €/kWh`;
}
const MONTH_NAME = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
// The official PUN the spread is measured against, shown even when the bill's energy price cannot be read.
function referencePun(bill: BillDocumentModel): ReactNode {
  const spread = bill.currentSpread;
  if (!spread || !spread.months.length) return "Periodo della bolletta non letto";
  const months = spread.months.map((month) => MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`))).join(", ");
  if (spread.referencePun === undefined || spread.referencePun === null) return `${months}: ${spread.status === "PUN_NOT_PUBLISHED" ? `pubblicato dal GME entro il ${date(spread.publishedBy ?? null)}` : spread.status === "PUN_EXPIRED" ? "non più in archivio" : "non ancora in archivio"}`;
  // Monorario: the monthly PUN only; bands (and hourly offers, whose consumption is read in bands): the band values only.
  if (spread.structure === "MONO" || !spread.referenceBands?.length) return <>{PUN.format(spread.referencePun)} €/kWh <small className="quote-spread-detail">{months} (PUN mensile)</small></>;
  return <>{spread.referenceBands.map((item) => `${item.band} ${PUN.format(item.pun)}`).join(" · ")} €/kWh <small className="quote-spread-detail">{months}</small></>;
}
const STRUCTURE_LABEL: Record<string, string> = { MONO: "Monorario", F1_F2_F3: "A fasce (F1, F2, F3)", F1_F23: "Biorario (F1 e F23)", HOURLY: "PUN orario (consumi letti in F1, F2, F3)" };
// How the index is applied over time: one price, three bands, F1/F23, peak and off-peak, or hourly.
function punStructure(bill: BillDocumentModel): string {
  if (bill.currentSpread?.status === "CALCULATED") return STRUCTURE_LABEL[bill.currentSpread.structure];
  const found = (code: string) => factValue(bill, code) !== null;
  const lines = bill.structuredBill?.economicChargeLines ?? [];
  const text = [factValue(bill, "PRICE_TIME_STRUCTURE_RAW"), factValue(bill, "PRICE_MECHANISM_RAW"), factValue(bill, "PRICE_FORMULA_RAW"), factValue(bill, "INDEX_NAME"), ...lines.map((line) => `${line.description} ${line.rawDescription ?? ""}`)].filter(Boolean).join(" ");
  if (/off[\s-]?peak|fuori picco|\bpeak\b|\bpicco\b/i.test(text)) return "Peak / off-peak";
  if (/pun orario|orari[oa] gme|prezzo orario|su base oraria|(tipologia di prezzo|aggiornamento( dell')? indice|indice)\s*:?\s*orari/i.test(text) || /^\s*orari[oa]\s*$/i.test(factValue(bill, "PRICE_TIME_STRUCTURE_RAW") ?? "")) return STRUCTURE_LABEL.HOURLY;
  // Consumption read in three separate bands rules out a biorario reading unless the bill names F23 itself.
  const threeBands = ["f1Consumption", "f2Consumption", "f3Consumption"].every((key) => { const field = bill.structuredBill?.[key as "f1Consumption"]; return field?.status === "FOUND" && typeof field.value === "number" && field.value > 0; });
  if (/\bF23\b|F2\s*[-+/]\s*F3|biorari/i.test(text) || (found("PRICE_F23") && !threeBands)) return "Biorario (F1 e F23)";
  if (/fasc|multiorari|triorari|\bF1\b.*\bF2\b.*\bF3\b/i.test(text) || ["PUN_F1", "PUN_F2", "PUN_F3", "PRICE_F1", "PRICE_F2"].some(found) || lines.some((line) => /^PUN_F[123]$/.test(line.code))) return "A fasce (F1, F2, F3)";
  if (/monorari|orario unico|prezzo unico|fascia unica/i.test(text) || found("PUN_SINGLE") || found("MONORARIO_PRICE") || lines.some((line) => line.code === "PUN_SINGLE")) return "Monorario";
  return "Non indicata in bolletta";
}

// The expiry printed on the bill: the economic conditions' end, else the contract's (Tony, 28/10 and 31/10).
function billExpiry(bill: BillDocumentModel): string | null {
  const receipt = bill.analystReview.receipt;
  const shown = (value: string | null | undefined) => value && value.trim() && !/^NOT_FOUND$/i.test(value.trim()) ? value : null;
  return italianDate(shown(receipt.economicConditionsExpiryDate.value) ?? factValue(bill, "ECONOMIC_EXPIRY")) ?? italianDate(shown(receipt.contractExpiryDate.value) ?? factValue(bill, "CONTRACT_EXPIRY"));
}

function billLabel(bill: ApprovedBillSummaryModel): string {
  return `${bill.title}${bill.supplier ? ` · ${bill.supplier}` : ""}${bill.period.periodStart ? ` · ${date(bill.period.periodStart)}` : ""}`;
}
// Already uploaded bills, A to Z, narrowed by the words typed in the search field.
function billChoices(archive: readonly ApprovedBillSummaryModel[], query: string): readonly ApprovedBillSummaryModel[] {
  const words = query.toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
  return archive.filter((bill) => { const text = billLabel(bill).toLocaleLowerCase("it"); return words.every((word) => text.includes(word)); })
    .slice().sort((a, b) => a.title.localeCompare(b.title, "it", { sensitivity: "base" }) || billLabel(a).localeCompare(billLabel(b), "it"));
}

function BillContractFacts({ bill }: { readonly bill: BillDocumentModel }): ReactNode {
  const receipt = bill.analystReview.receipt;
  // Same reading as the search for CTEs, so "Domestico non residente" shows Consumer here too (Tony, 28/10).
  const type = bill.structuredBill ? customerTypeOf(bill.structuredBill) : null;
  const offerName = bill.analystReview.receipt.offerName.value?.trim() || bill.structuredBill?.documentOfferName?.trim() || null;
  const offerCode = bill.analystReview.receipt.offerCode.value?.trim() || null;
  const start = italianDate(receipt.contractStartDate.value ?? factValue(bill, "CONTRACT_START_DATE")) ?? italianDate(receipt.economicConditionsStartDate.value ?? factValue(bill, "ECONOMIC_CONDITIONS_START_DATE"));
  const pcv = monthlyPcv(bill);
  const noBox = withoutOfferBox(bill);
  const rows: readonly (readonly [string, ReactNode])[] = [
    ["Tipo contratto", type === "RESIDENTIAL" ? <span className="cte-segment-consumer">Consumer</span> : type === "NON_RESIDENTIAL" ? <span className="cte-segment-business">Business</span> : "Non indicato"],
    // Tony (28/10): "dovevamo vedere anche il nome della cte utilizzata".
    ["Offerta attuale (CTE)", offerName ? (offerCode && offerCode !== offerName ? `${offerName} · codice ${offerCode}` : offerName) : offerCode ?? (noBox ? NOT_IN_DETAIL : "Non indicata")],
    ["Attivo dal", start ?? (noBox ? "Non riportato nella fattura di dettaglio" : "Non indicato")],
    // Tony (28/10): "nella scadenza mettere solo data e nessun altro testo".
    ["Scadenza", billExpiry(bill) ?? (noBox ? "Non riportata nella fattura di dettaglio" : "Non indicata")],
    ["Tipo di prezzo", priceType(bill)],
    ...(indexedBill(bill) && bill.resolvedVector !== "GAS" ? [["PUN GME del mese di riferimento", referencePun(bill)] as const] : []),
    ...(indexedBill(bill) ? [[`Spread sul ${bill.resolvedVector === "GAS" ? "PSV" : "PUN"} (calcolato)`, bill.resolvedVector === "GAS" ? "Non calcolato per il gas" : billSpread(bill)] as const, [`Struttura del ${bill.resolvedVector === "GAS" ? "PSV" : "PUN"}`, bill.resolvedVector === "GAS" ? "Mensile" : punStructure(bill)] as const] : []),
    ["PCV mensile (quota fissa vendita)", pcv === null ? "Non indicata" : `${EURO.format(pcv)} al mese`],
  ];
  return <dl className="quote-bill-grid quote-contract-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

// The year the savings are projected on: the annual consumption printed on the bill, or the billed period averaged over 365 days.
type AnnualBasis = { readonly billed: number; readonly annual: number; readonly estimated: boolean };
function annualBasis(context: Context): AnnualBasis | null {
  const period = context.consumption?.period;
  const billed = context.vector === "EE" ? (period?.f1 ?? 0) + (period?.f2 ?? 0) + (period?.f3 ?? 0) : period?.smc ?? 0;
  if (billed <= 0) return null;
  const printed = context.consumption?.annual;
  if (printed != null && printed > 0) return { billed, annual: printed, estimated: false };
  const history = historyMonthTotals(context.consumption?.history);
  const monthTotals = history.length ? history : context.vector === "EE" ? context.consumption?.monthlyProfile?.map((month) => month.f1 + month.f2 + month.f3) ?? null : null;
  const annual = estimatedAnnualConsumption({ billed, periodStart: context.billingPeriod.periodStart, periodEnd: context.billingPeriod.periodEnd, monthTotals });
  return annual === null ? null : { billed, annual, estimated: true };
}
function estimatedFromPeriod(context: Context, ee: boolean): string {
  const basis = annualBasis(context);
  return basis?.estimated ? `${amount(basis.annual, ee ? "kWh" : "Smc")} (media mensile × 12)` : "—";
}

// How far the read lines are from the bill total, so a wrong reading is visible at once.
function readGap(bill: BillDocumentModel): string {
  const totals = bill.analystReview?.economics?.economicAnalysis?.totals;
  if (!totals || totals.billTotal === null || totals.reconstructedCurrentSupplyTotal === null) return "";
  return ` (lette ${euro(totals.reconstructedCurrentSupplyTotal)} su ${euro(totals.billTotal)}, differenza ${euro(totals.reconstructedCurrentSupplyTotal - totals.billTotal)})`;
}

function BillSummary({ context, bill }: { readonly context: Context; readonly bill: BillDocumentModel }): ReactNode {
  const ee = context.vector === "EE";
  const period = context.consumption?.period;
  const rows: readonly (readonly [string, string])[] = [
    // Tony (29/10): "non si vede il nome dell'intestatario della bolletta, deve esserci".
    ["Intestatario", bill.fields.customerName?.value?.trim() || "Non letto in bolletta"],
    ["Tipo fornitura", ee ? "Energia elettrica" : "Gas"],
    ["Cliente", context.customerType === "RESIDENTIAL" ? "Consumer" : "Business"],
    [ee ? "POD" : "PDR", (ee ? context.supply.pod : context.supply.pdr) ?? "—"],
    ...(ee ? [["Tensione", context.supply.voltageLevel ? VOLTAGE[context.supply.voltageLevel] : "—"] as const, ["Potenza impegnata", amount(context.supply.contractedPowerKw, "kW")] as const] : []),
    ["Fornitore attuale", context.currentSupplier || "—"], ["Offerta attuale", billOfferName(bill, context) ?? "Non indicata in bolletta"],
    // Tony (31/10): "devo vedere anche la data in cui scade il contratto che è scritto in fattura".
    ["Scadenza contratto", billExpiry(bill) ?? "Non indicata in bolletta"],
    ["Periodo fatturato", `${date(context.billingPeriod.periodStart)} – ${date(context.billingPeriod.periodEnd)}`],
    ["Consumo del periodo", ee ? `F1 ${amount(period?.f1, "kWh")} · F2 ${amount(period?.f2, "kWh")} · F3 ${amount(period?.f3, "kWh")}` : amount(period?.smc, "Smc")],
    ["Consumo annuo", context.consumption?.annual != null ? amount(context.consumption.annual, ee ? "kWh" : "Smc") : estimatedFromPeriod(context, ee)],
  ];
  return <section className="ui-card quote-bill-summary"><h3>Dati della bolletta usati per la scelta</h3>
    <dl className="quote-bill-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {context.economicReconciled === false ? <p className="quote-warning">Le voci di costo lette non sommano esattamente al totale della bolletta{readGap(bill)}: il risparmio mostrato è indicativo.</p> : null}
    {context.missingRequiredData.length ? <p className="quote-missing" role="alert">Mancano: {context.missingRequiredData.map((code) => MISSING[code] ?? code).join(", ")}. Ricarica una bolletta più completa.</p> : null}
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
    const receipt = buildQuoteReceipt({ vector: calculation.vector, offerSupplyCost: calculation.totalCommercialCost.amount, analysis: bill.analystReview.economics.economicAnalysis, domestic: context.classification.domestic, validUntil: candidate.validity.periodEnd, offerComponents: calculation.components, warnings: calculation.warnings, householdSpread: householdSpreadOf(context, calculation) });
    return [{ rank: entry.rank, calculation, supplier: entry.supplier, offerName: candidate.offer.name || entry.offerCode, receipt, candidate }];
  });
}

const REASON_LABEL: Readonly<Record<string, string>> = { CUSTOMER_LEGAL_TYPE_MISMATCH: "tipo di cliente non ammesso (Consumer/Business)", SUPPLY_USE_MISMATCH: "uso della fornitura non ammesso", IDENTIFIER_TYPE_MISMATCH: "tipo di identificativo non ammesso", VOLTAGE_MISMATCH: "tensione non ammessa (BT/MT)", CONSUMPTION_THRESHOLD_MISMATCH: "consumo annuo fuori dalle soglie della CTE", POWER_THRESHOLD_MISMATCH: "potenza fuori dalle soglie della CTE", VALIDITY_MISMATCH: "CTE non valida per il periodo della bolletta", CALCULATION_NOT_READY: "calcolo non pronto", REVIEW_REQUIRED: "CTE da revisionare", EXPIRED_CTE: "CTE scaduta", MISSING_REGULATORY_DATA: "mancano dati regolatori (PUN o oneri ARERA)", INVALID_CTE: "CTE non valida", MISSING_SOURCE_DOCUMENT: "documento CTE mancante", MARKET_DATA_MISSING: "manca il PUN/PSV del periodo", NOT_READY: "CTE non pronta al calcolo", CONSUMPTION_NOT_ELIGIBLE: "consumo annuo fuori dalle soglie della CTE", CUSTOMER_NOT_ELIGIBLE: "tipo di cliente non ammesso (Consumer/Business)", CONDOMINIUM_ONLY: "riservata ai condomini", CTE_NOT_ACTIVE: "CTE bloccata o non attiva", TAX_TREATMENT_INCOMPATIBLE: "prezzi CTE con imposte incluse, non confrontabili", BILL_DATA_INSUFFICIENT: "mancano dati della bolletta", CALCULATION_READY_INVALID: "la CTE non è completa per il calcolo", CTE_VALIDITY_MISMATCH: "CTE non ancora valida", CTE_EXPIRED: "CTE scaduta", VOLTAGE_NOT_ELIGIBLE: "tensione non ammessa (BT/MT)" };
const EXCLUSION_LABEL: Readonly<Record<string, string>> = { CALCULATION_READY_INVALID: "la CTE non è completa per il calcolo", MARKET_DATA_MISSING: "manca il PUN/PSV del periodo", MARKET_DATA_INVALID: "PUN/PSV del periodo non valido", COMPARISON_INCOMPATIBLE: "non confrontabile con le altre offerte", MONTHLY_PROFILE_REQUIRED: "servono i consumi mese per mese", CALCULATION_INPUT_INVALID: "dati della bolletta non validi per questa CTE", FEE_UNIT_MISMATCH: "unità di un costo della CTE non compatibile", IMBALANCE_UNAVAILABLE: "sbilanciamento non dichiarato nella CTE", CTE_VALIDITY_MISMATCH: "CTE non valida per il periodo della bolletta", CTE_EXPIRED: "CTE scaduta", CUSTOMER_NOT_ELIGIBLE: "tipo di cliente non ammesso", VOLTAGE_NOT_ELIGIBLE: "tensione non ammessa" };
// Tony (29/10): a CTE in the archive that is not offered says why, so the operator knows what to fix.
const UNLISTED_LABEL: Readonly<Record<string, string>> = { NOT_APPROVED: "CTE non ancora approvata in archivio", ASSIGNMENT_EXPIRED: "assegnazione della CTE scaduta", ASSIGNMENT_NOT_YET_VALID: "assegnazione della CTE non ancora valida", EXCLUDED_BY_LIMITS: "esclusa dai limiti impostati per il tuo profilo" };
// With no offer to show, each assigned CTE says why it was left out: the agent knows what to fix or ask for.
// Tony (29/10, "la cte di questa è la BE SMILE ma non la vedo"): the CTEs left out are listed with their reason also when
// other offers are shown.
// Tony (29/10): whoever holds the permission authorizes, for this bill, a CTE the rules leave out, giving a reason.
function AuthorizeCte({ onAuthorize }: { readonly onAuthorize: (reason: string) => Promise<void> }): ReactNode {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<string>();
  if (!open) return <button className="button secondary compact" type="button" onClick={() => setOpen(true)}>Autorizza per questa bolletta</button>;
  return <span className="quote-authorize"><input aria-label="Motivo dell'autorizzazione" placeholder="Motivo (es. contratto già firmato con questa offerta)" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} disabled={busy} /><button className="button primary compact" type="button" disabled={busy || !reason.trim()} onClick={() => { setBusy(true); setFailure(undefined); void onAuthorize(reason.trim()).catch((cause) => { setFailure(message(cause)); setBusy(false); }); }}>{busy ? "Autorizzazione" : "Conferma"}</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => setOpen(false)}>Annulla</button>{failure ? <small className="negative">{failure}</small> : null}</span>;
}

function NoOfferReasons({ quote, shown = [], onAuthorize }: { readonly quote: Quote; readonly shown?: readonly string[]; readonly onAuthorize?: (archiveId: string, reason: string) => Promise<void> }): ReactNode {
  // Only CTEs of the bill's commodity are worth explaining; a CTE of the other commodity never applies to this bill.
  const candidates = (quote.candidates ?? []).filter((candidate) => !shown.includes(candidate.archiveId) && ![...(candidate.reasonCodes ?? []), candidate.compatibilityReason ?? ""].some((code) => /VECTOR_MISMATCH/.test(code)));
  const unlisted = (quote.unlisted ?? []).map((item) => ({ key: item.archiveId, name: `${item.supplier} · ${item.offer.name || item.offer.code}`, reasons: [UNLISTED_LABEL[item.reason] ?? item.reason], authorizable: false }));
  if (!candidates.length && !unlisted.length) return null;
  const evaluated = candidates.map((candidate) => {
    const excluded = quote.comparison.excludedOffers.find((item) => item.archiveId === candidate.archiveId);
    const eligible = candidate.finalStatus === "ELIGIBLE" || candidate.finalStatus === "ELIGIBLE_BY_OVERRIDE";
    const annual = quote.context.consumption?.annual ?? null;
    const threshold = (candidate.reasonCodes ?? []).includes("CONSUMPTION_THRESHOLD_MISMATCH") || candidate.compatibilityReason === "CONSUMPTION_NOT_ELIGIBLE"
      ? ` (consumo annuo della bolletta ${annual === null ? "non letto" : `${QUANTITY.format(annual)} ${quote.context.vector === "EE" ? "kWh" : "Smc"}`}${candidate.scope?.consumption ? `, la CTE richiede ${candidate.scope.consumption}` : ""})` : "";
    const reasons = eligible
      ? excluded ? [`calcolo non riuscito: ${EXCLUSION_LABEL[excluded.code] ?? excluded.code}${/\(([^)]+)\)$/.exec(excluded.message)?.[1] ? ` (${/\(([^)]+)\)$/.exec(excluded.message)?.[1]})` : ""}`] : candidate.calculationReadiness !== "READY" ? [REASON_LABEL[candidate.calculationReadiness] ?? candidate.calculationReadiness] : ["calcolo non eseguito"]
      : [...new Set([...(candidate.reasonCodes ?? []), candidate.compatibilityReason].filter((code): code is string => Boolean(code)).map((code) => REASON_LABEL[code] ?? code))].map((label) => label === REASON_LABEL.CONSUMPTION_NOT_ELIGIBLE ? `${label}${threshold}` : label);
    const authorizable = Boolean(quote.canAuthorizeCte && onAuthorize && candidate.finalStatus === "NOT_ELIGIBLE" && candidate.overrideRequestable);
    return { key: candidate.archiveId, name: `${candidate.supplier} · ${candidate.offer.name || candidate.offer.code}`, reasons, authorizable };
  });
  const rows = [...evaluated, ...unlisted];
  return <details className="quote-cost-detail"><summary>{shown.length ? `CTE non utilizzabili per questa bolletta (${rows.length})` : `Perché nessuna CTE è utilizzabile (${rows.length})`}</summary><ul>{rows.map((row) => <li key={row.key}><strong>{row.name}</strong>: {row.reasons.join("; ")}{row.authorizable && onAuthorize ? <> <AuthorizeCte onAuthorize={(reason) => onAuthorize(row.key, reason)} /></> : null}</li>)}</ul></details>;
}

function Steps({ step }: { readonly step: Step }): ReactNode {
  const items: readonly { readonly id: Step; readonly label: string }[] = [{ id: "bill", label: "Carica la bolletta" }, { id: "review", label: "Dati letti" }, { id: "offers", label: "Scegli l'offerta" }];
  const current = items.findIndex((item) => item.id === step);
  return <ol className="quote-steps">{items.map((item, index) => <li key={item.id} className={index === current ? "active" : index < current ? "done" : ""}><span>{index + 1}</span>{item.label}</li>)}</ol>;
}

type CostLine = { readonly key: string; readonly label: string; readonly quantity: string; readonly rate: string; readonly amount: number };
const MONTH = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const CENTS = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const QUANTITY = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2, useGrouping: "always" });
const FEE_UNIT: Record<string, string> = { EUR_PER_KWH: "€/kWh", EUR_PER_SMC: "€/Smc", EUR_PER_POD: "€/POD al mese", EUR_PER_MONTH: "€/mese", EUR_PER_YEAR: "€/anno", EUR_PER_CONTRACT: "€ una tantum" };
const BASIS_UNIT: Record<string, string> = { EUR_PER_KWH: "kWh", EUR_PER_SMC: "Smc", EUR_PER_POD: "mesi", EUR_PER_MONTH: "mesi", EUR_PER_YEAR: "anni" };
function num(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
function monthLabel(value: unknown): string { return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? MONTH.format(new Date(`${value}-01T00:00:00Z`)) : String(value ?? ""); }
// Each cost of the new offer as quantity x unit price, the way a business customer checks it against the CTE.
function costLines(calculation: CalculationModel): readonly CostLine[] {
  return calculation.components.map((component, index) => {
    const inputs = component.formulaInputs ?? {};
    const sign = component.sign === "DISCOUNT" ? -1 : 1;
    const base = { key: `${index}:${component.label}`, amount: sign * component.amount.amount };
    const kwh = (value: unknown) => { const n = num(value); return n === null ? "—" : `${QUANTITY.format(n)} kWh`; };
    switch (component.formulaId) {
      case "EE_PUN_MWH_TO_KWH_PLUS_SPREAD": {
        const pun = num(inputs.punEurPerMwh); const spread = num(inputs.spreadPerKwh);
        return { ...base, label: `Energia ${inputs.band} · ${monthLabel(inputs.month)}`, quantity: kwh(inputs.quantityKwh), rate: pun === null || spread === null ? "—" : `PUN ${RATE.format(pun / 1000)} + spread ${RATE.format(spread)} = ${RATE.format(pun / 1000 + spread)} €/kWh` };
      }
      case "EE_FIXED_PRICE_TIMES_KWH": {
        const total = [inputs.f1Kwh, inputs.f2Kwh, inputs.f3Kwh].map(num).reduce<number>((sum, value) => sum + (value ?? 0), 0);
        return { ...base, label: "Energia a prezzo fisso (F1+F2+F3)", quantity: kwh(total), rate: `${RATE.format(num(inputs.pricePerKwh) ?? 0)} €/kWh` };
      }
      case "EE_SPREAD_TIMES_KWH": return { ...base, label: "Spread", quantity: kwh(inputs.totalKwh), rate: `${RATE.format(num(inputs.spreadPerKwh) ?? 0)} €/kWh` };
      case "GAS_PSV_PLUS_SPREAD_TIMES_SMC": {
        const psv = num(inputs.psvEurPerSmc); const spread = num(inputs.spreadPerSmc);
        return { ...base, label: `Gas · ${monthLabel(inputs.month)}`, quantity: `${QUANTITY.format(num(inputs.effectiveSmc) ?? 0)} Smc`, rate: psv === null || spread === null ? "—" : `PSV ${RATE.format(psv)} + spread ${RATE.format(spread)} = ${RATE.format(psv + spread)} €/Smc` };
      }
      case "GAS_FIXED_PRICE_TIMES_SMC": return { ...base, label: "Gas a prezzo fisso", quantity: `${QUANTITY.format(num(inputs.effectiveSmc) ?? 0)} Smc`, rate: `${RATE.format(num(inputs.pricePerSmc) ?? 0)} €/Smc` };
      case "GAS_SPREAD_TIMES_SMC": return { ...base, label: "Spread", quantity: `${QUANTITY.format(num(inputs.effectiveSmc) ?? 0)} Smc`, rate: `${RATE.format(num(inputs.spreadPerSmc) ?? 0)} €/Smc` };
      case "ONE_OFF_CONTRACT_FEE": return { ...base, label: component.label, quantity: "1", rate: `${EURO.format(num(inputs.feeRate) ?? 0)} una tantum` };
      default: {
        // Tony (30/10, "credo ci siano errori di calcolo, con altro simulatore risulta diversa"): every ARERA line shows its
        // official rate, the kW or kWh it applies to and the table class, so it can be checked against the bill.
        if (component.formulaId.startsWith("REGULATED_")) {
          const variant = typeof inputs.regulatoryVariant === "string" ? ` · ${String(inputs.regulatoryVariant).replace(/^ASOS_CLASS_(\d)_/, "ASOS classe $1 · ")}` : "";
          const months = num(inputs.monthsApplied);
          const kw = num(inputs.powerBasisKw) ?? num(inputs.contractedPowerKw);
          if (num(inputs.rateEurPerKwh) !== null) return { ...base, label: `${component.label}${variant}`, quantity: kwh(inputs.quantityKwh), rate: `${RATE.format(num(inputs.rateEurPerKwh) ?? 0)} €/kWh` };
          if (num(inputs.rateEurPerKwYear) !== null) return { ...base, label: `${component.label}${variant}`, quantity: `${kw === null ? "—" : `${QUANTITY.format(kw)} kW`} × ${months === null ? "—" : `${QUANTITY.format(months)} mesi`}`, rate: `${CENTS.format(num(inputs.rateEurPerKwYear) ?? 0)} €/kW all'anno` };
          if (num(inputs.rateEurPerPodYear) !== null) return { ...base, label: `${component.label}${variant}`, quantity: months === null ? "—" : `${QUANTITY.format(months)} mesi`, rate: `${CENTS.format(num(inputs.rateEurPerPodYear) ?? 0)} €/POD all'anno` };
        }
        const unit = String(inputs.feeUnit ?? "");
        const quantity = num(inputs.basisQuantity) ?? num(inputs.basisMonths);
        const rate = num(inputs.feeRate);
        const label = component.formulaId.startsWith("CONTRACTUAL_PASS_THROUGH") ? `${inputs.kind === "DISPATCHING" ? "Dispacciamento" : inputs.kind === "CAPACITY_MARKET" ? "Mercato della capacità" : "Altri corrispettivi"} (da CTE)` : component.formulaId.startsWith("IMBALANCE") ? `Sbilanciamento · ${component.label}` : component.label;
        return { ...base, label, quantity: quantity === null ? "—" : `${QUANTITY.format(quantity)} ${BASIS_UNIT[unit] ?? (component.formulaId.endsWith("MONTHS") ? "mesi" : "")}`.trim(), rate: rate === null ? "—" : `${unit === "EUR_PER_KWH" || unit === "EUR_PER_SMC" ? RATE.format(rate) : CENTS.format(rate)} ${FEE_UNIT[unit] ?? "€"}` };
      }
    }
  });
}

// Tony (31/10): "dovresti raggruppare per fisse e variabili e sotto le voci ARIM, ASOS, UC3, UC6". The ARERA lines are split
// into fixed quotas (€/POD, €/kW) and variable ones (€/kWh), each with transport first, then UC3, UC6, ARIM and ASOS.
const REGULATED_ORDER = ["NETWORK", "METERING", "TRANSMISSION", "UC3", "UC6", "ARIM", "ASOS"] as const;
function regulatedRank(code: string): number {
  const index = REGULATED_ORDER.findIndex((prefix) => code.startsWith(prefix));
  return index < 0 ? 0 : index;
}
function costGroups(calculation: CalculationModel, lines: readonly CostLine[]): readonly { readonly title: string; readonly lines: readonly CostLine[] }[] {
  const seller: CostLine[] = []; const fixed: { line: CostLine; rank: number }[] = []; const variable: { line: CostLine; rank: number }[] = [];
  calculation.components.forEach((component, index) => {
    const line = lines[index];
    const code = String(component.formulaInputs?.componentCode ?? "");
    if (!component.category.startsWith("REGULATED_") || code === "DISPATCHING_TOTAL") { seller.push(line); return; }
    (component.category === "REGULATED_ENERGY" ? variable : fixed).push({ line, rank: regulatedRank(code) });
  });
  const sorted = (items: readonly { line: CostLine; rank: number }[]) => [...items].sort((a, b) => a.rank - b.rank).map((item) => item.line);
  return [
    { title: "Spesa per la vendita (CTE)", lines: seller },
    { title: "Rete e oneri ARERA · quote fisse (€/POD e €/kW)", lines: sorted(fixed) },
    { title: "Rete e oneri ARERA · quote variabili (€/kWh)", lines: sorted(variable) },
  ].filter((group) => group.lines.length > 0);
}

function CostDetail({ offer, open }: { readonly offer: Offer; readonly open: boolean }): ReactNode {
  const lines = costLines(offer.calculation);
  if (!lines.length) return null;
  const groups = costGroups(offer.calculation, lines);
  return <details className="quote-detail" open={open}>
    <summary>Dettaglio dei costi della nuova offerta</summary>
    <p className="muted">Ogni voce è calcolata sugli stessi consumi e sullo stesso periodo della bolletta, con i prezzi della CTE {offer.offerName}.</p>
    <div className="responsive-table"><table>
      <thead><tr><th scope="col">Voce</th><th scope="col">Quantità</th><th scope="col">Prezzo unitario</th><th scope="col">Importo</th></tr></thead>
      {groups.map((group) => <tbody key={group.title}>
        <tr className="quote-cost-group"><th scope="rowgroup" colSpan={3}>{group.title}</th><td>{euro(group.lines.reduce((total, line) => total + line.amount, 0))}</td></tr>
        {group.lines.map((line) => <tr key={line.key}><th scope="row">{line.label}</th><td>{line.quantity}</td><td>{line.rate}</td><td>{euro(line.amount)}</td></tr>)}
      </tbody>)}
      <tfoot><tr><th scope="row" colSpan={3}>Totale spesa per la materia energia (nuova offerta)</th><td>{euro(offer.calculation.totalCommercialCost.amount)}</td></tr></tfoot>
    </table></div>
    <p className="muted quote-note">Costo medio della materia energia: {RATE.format(offer.calculation.unitCost.amount)} {offer.calculation.unitCost.unit === "EUR_PER_SMC" ? "€/Smc" : "€/kWh"}. Imposte escluse.</p>
  </details>;
}

// The current offer's name as read on the uploaded bill, without the long offer code (Tony, 26/10: "rendilo leggibile").
function billOfferName(bill: BillDocumentModel | null, context: Context): string | null {
  const receipt = bill?.analystReview.receipt ?? null;
  const name = context.currentOffer?.name?.trim() || receipt?.offerName.value?.trim() || bill?.structuredBill?.documentOfferName?.trim() || null;
  return name ? name.replace(/\s*\((?=[A-Z0-9]*\d)[A-Z0-9]{10,}\)\s*$/, "").replace(/\s+/g, " ").trim() || null : null;
}
// Official check of the regulated charges, shown under each section and charge it covers.
const SOURCE_OF: Readonly<Record<RegulatedDomain, string>> = { NETWORK: "ARERA", SYSTEM_CHARGES: "ARERA", DISPATCHING: "Terna/ARERA", CAPACITY_MARKET: "Terna" };
const DOMAIN_OF_ROW: Readonly<Record<string, RegulatedDomain>> = { NETWORK: "NETWORK", SYSTEM: "SYSTEM_CHARGES", DISPATCHING: "DISPATCHING", CAPACITY: "CAPACITY_MARKET" };
function VerificationNote({ bill, rowKey, receipt }: { readonly bill: BillDocumentModel; readonly rowKey: string; readonly receipt?: QuoteReceipt }): ReactNode {
  const domain = DOMAIN_OF_ROW[rowKey];
  if (!domain) return null;
  // Transport and system charges: the bill's aggregates against the official ARERA amounts on the same consumption.
  const official = rowKey === "NETWORK" || rowKey === "SYSTEM" ? receipt?.officialCheck?.[rowKey] : undefined;
  if (official?.status === "VERIFIED") return <small className="quote-check ok">✓ Verificato sui valori ARERA del periodo ({EURO.format(official.official ?? 0)})</small>;
  // Tony (31/10): the note says how the bill and the simulation each stand against ARERA, not the gap between the two columns.
  if (official?.status === "DIFFERENCE" && official.difference !== null) {
    const arera = official.official ?? 0;
    const row = receipt?.rows.find((item) => item.key === rowKey);
    const apart = row?.current != null ? Math.round((row.current - arera - official.difference) * 100) / 100 : 0;
    return <small className="quote-check bad">⚠ Valori ARERA del periodo {EURO.format(arera)}: la bolletta addebita {EURO.format(arera + official.difference)}, cioè {EURO.format(Math.abs(official.difference))} {official.difference > 0 ? "in più" : "in meno"} di ARERA; la simulazione applica i valori ARERA ({EURO.format(arera)}){Math.abs(apart) >= 0.01 ? `. Energia reattiva ${EURO.format(apart)} a parte, uguale nelle due colonne` : ""}.</small>;
  }
  const check = regulatedVerification(bill.regulatoryAudit, domain);
  const source = SOURCE_OF[domain];
  if (check.status === "VERIFIED") return <small className="quote-check ok">✓ Verificato sui valori {source} del periodo ({check.checked} {check.checked === 1 ? "voce" : "voci"})</small>;
  if (check.status === "DIFFERENCE") return <small className="quote-check bad">⚠ La bolletta non corrisponde ai valori {source}: {EURO.format(Math.abs(check.difference))} addebitati {check.difference > 0 ? "in più" : "in meno"}</small>;
  return <small className="quote-check open">Non verificato su {source}: {official?.reason ?? check.reason}</small>;
}
// A lower cost is green, a higher one red: the difference reads CTE minus bill.
function difference(value: number | null): string | undefined { return value === null || Math.abs(value) < 0.01 ? undefined : value < 0 ? "positive" : "negative"; }
function signedEuro(value: number | null): string { return value === null ? "—" : Math.abs(value) < 0.01 ? "=" : `${value > 0 ? "+" : "−"}${EURO.format(Math.abs(value))}`; }
// Tony (28/10): when the bill was issued with the simulated CTE the two columns must match; every difference is listed with
// its likely cause, and each case is a correction to make in the shared calculation, valid for every company.
function SameOfferCheck({ offer, bill, context }: { readonly offer: Offer; readonly bill: BillDocumentModel; readonly context: Context }): ReactNode {
  if (!isSameOffer({ billSupplier: context.currentSupplier, billOffer: billOfferName(bill, context), offerSupplier: offer.supplier, offerCode: offer.calculation.sourceCte.offerCode, offerName: offer.offerName })) return null;
  const all = sameOfferDifferences(offer.receipt);
  const differences = all.filter((item) => !item.accepted);
  const accepted = all.filter((item) => item.accepted);
  const real = differences.filter((item) => !item.consequence).length;
  // Household bills (Tony, 29/10): when the gap is the spread, say which spread the bill really applies and why it can
  // differ from the CTE (contracts in force adapt by 1/1/2027, delibera 386/2025 art. 6.3).
  const effective = context.vector === "EE" ? effectiveBillSpread(offer.receipt, offer.calculation.components) : null;
  const cteSpread = offer.candidate.terms?.spread ?? null;
  const spreadGap = effective !== null && cteSpread !== null && Math.abs(cteSpread - effective) >= 0.0005 ? cteSpread - effective : null;
  const kwh = annualBasis(context)?.billed ?? null;
  const line = (item: (typeof all)[number]) => <li key={item.label}><strong>{item.label}</strong>: bolletta {euro(item.current)}, simulazione {euro(item.offer)}{item.difference === null ? "" : ` (${item.difference > 0 ? "+" : ""}${EURO.format(item.difference)})`}. {item.cause}.</li>;
  return <div className={differences.length ? "same-offer-check differs" : "same-offer-check"} role="status">
    <p className="eyebrow">VERIFICA STESSA CTE</p>
    {differences.length === 0 ? <p>La bolletta è emessa con questa CTE e la simulazione coincide voce per voce{accepted.length ? ", salvo gli arrotondamenti accettati qui sotto" : ""}.</p> : <>
      <p>La bolletta è emessa con questa CTE: le due colonne devono coincidere. {real === 1 ? "Una voce è diversa" : `${real} voci sono diverse`}:</p>
      <ul>{differences.map(line)}</ul>
      {spreadGap !== null ? <p>La bolletta applica sull&apos;indice uno spread effettivo di {RATE.format(effective!)} €/kWh (perdite comprese), la CTE {RATE.format(cteSpread!)} €/kWh{kwh ? `: ${RATE.format(spreadGap)} €/kWh per ${amount(kwh, "kWh")} fanno circa ${euro(spreadGap * kwh)}` : ""}. Il fornitore ha fatturato con uno spread diverso da questa CTE: o il contratto del cliente è ancora alle condizioni precedenti (i contratti in essere si adeguano entro il 1/1/2027, delibera 386/2025 art. 6.3), o la CTE caricata non è quella del contratto.</p> : null}
      <p className="muted">Mandaci questo caso: la correzione vale per tutte le aziende e resta nei test.</p>
    </>}
    {accepted.length ? <><p className="muted">Differenze accettate:</p><ul className="muted">{accepted.map(line)}</ul></> : null}
  </div>;
}

// Box offerta of the scontrino, side by side: how the bill prices energy and how the simulated CTE would, line by line.
function OfferBox({ offer, bill, context }: { readonly offer: Offer; readonly bill: BillDocumentModel; readonly context: Context }): ReactNode {
  const ee = context.vector === "EE";
  const unit = ee ? "€/kWh" : "€/Smc";
  const basis = annualBasis(context);
  const terms = offer.candidate.terms;
  const energyRow = offer.receipt.rows.find((row) => row.key === "ENERGY");
  const fees = offer.calculation.components.filter((component) => component.category === "FIXED_FEE");
  const extras = fees.filter((component) => /flex|opzion|servizi/i.test(component.label));
  // A fixed-price bill has no spread on an index: its fixed price is shown instead (Tony, 28/10, Be FIX RELAX: -0,028542).
  const billFixed = !indexedBill(bill) && /^Prezzo fisso/.test(priceType(bill)) ? factValue(bill, "FIXED_PRICE", "ENERGY_FIXED_PRICE", "MONORARIO_PRICE") : null;
  const billSpread = !billFixed && bill.currentSpread?.status === "CALCULATED" ? bill.currentSpread.spread : null;
  // What the household bill really charges above the index, against the CTE's single spread (Tony, 29/10).
  const effective = ee && billSpread !== null ? effectiveBillSpread(offer.receipt, offer.calculation.components) : null;
  const billPcv = monthlyPcv(bill);
  const billUnit = energyRow?.current != null && basis ? energyRow.current / basis.billed : null;
  const index = offer.candidate.pricingReference === "PSV" || !ee ? "PSV" : "PUN";
  const offerType = offer.candidate.pricingType === "FIXED" ? "Prezzo fisso" : offer.candidate.pricingType === "INDEXED" ? `Indicizzato ${index}` : "Non indicato";
  const rows: readonly (readonly [string, ReactNode, ReactNode, string | undefined])[] = [
    ["Offerta", billOfferName(bill, context) ?? "non indicata in bolletta", offer.offerName, undefined],
    ["Tipo di prezzo", priceType(bill), offerType, undefined],
    ...(ee && indexedBill(bill) ? [["Indice nel periodo (GME)", referencePun(bill), "stesso indice e stesso periodo", undefined] as const] : []),
    ["Spread sull'indice", billSpread === null ? "—" : `${RATE.format(billSpread)} ${unit}`, terms?.spread == null ? "—" : `${RATE.format(terms.spread)} ${unit}`, billSpread !== null && terms?.spread != null ? difference(terms.spread - billSpread) : undefined],
    ...(effective !== null && terms?.spread != null ? [["Spread effettivo (perdite comprese, delibera 386/2025)", `${RATE.format(effective)} ${unit}`, `${RATE.format(terms.spread)} ${unit}`, difference(terms.spread - effective)] as const] : []),
    ...(terms?.fixedPrice != null || billFixed ? [["Prezzo fisso energia", billFixed ? `${billFixed} ${unit}` : "—", terms?.fixedPrice == null ? "—" : `${RATE.format(terms.fixedPrice)} ${unit}`, undefined] as const] : []),
    ["Quota fissa di vendita", billPcv === null ? "—" : `${EURO.format(billPcv)} al mese`, terms?.monthlyFixedFee == null ? "—" : `${EURO.format(terms.monthlyFixedFee)} al mese`, billPcv !== null && terms?.monthlyFixedFee != null ? difference(terms.monthlyFixedFee - billPcv) : undefined],
    ["Opzioni e servizi a pagamento", "—", extras.length ? extras.map((component) => `${component.label} ${EURO.format(component.amount.amount)}`).join(" · ") : "nessuno", extras.length ? "negative" : undefined],
    ["Costo medio della materia", billUnit === null ? "—" : `${RATE.format(billUnit)} ${unit}`, `${RATE.format(offer.calculation.unitCost.amount)} ${unit}`, billUnit === null ? undefined : difference(offer.calculation.unitCost.amount - billUnit)],
    ["Spesa per l'offerta (vendita)", euro(energyRow?.current ?? null), euro(energyRow?.offer ?? null), energyRow?.current == null || energyRow.offer === null ? undefined : difference(energyRow.offer - energyRow.current)],
  ];
  return <div className="quote-offer-box">
    <p className="eyebrow">BOX OFFERTA · CONFRONTO BOLLETTA / CTE</p>
    <div className="responsive-table"><table>
      <thead><tr><th scope="col">Caratteristica</th><th scope="col">Bolletta: {[context.currentSupplier, billOfferName(bill, context)].filter(Boolean).join(" · ")}</th><th scope="col">{offer.offerName}</th></tr></thead>
      <tbody>{rows.map(([label, current, simulated, tone]) => <tr key={label} className={tone ? "changed" : undefined}><th scope="row">{label}</th><td>{current}</td><td className={tone}>{simulated}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

// VAT rates the agent can apply to the new offer when the company qualifies for a reduced rate (e.g. 10% for some business uses).
const VAT_CHOICES = [0.22, 0.1, 0.05, 0.04] as const;
function Receipt({ offer: quoted, today, business, context, bill }: { readonly offer: Offer; readonly today: string; readonly business: boolean; readonly context: Context; readonly bill: BillDocumentModel }): ReactNode {
  const [offerVatRate, setOfferVatRate] = useState<number | null>(null);
  const receipt = offerVatRate === null ? quoted.receipt : buildQuoteReceipt({ vector: quoted.calculation.vector, offerSupplyCost: quoted.calculation.totalCommercialCost.amount, analysis: bill.analystReview.economics.economicAnalysis, domestic: context.classification.domestic, validUntil: quoted.candidate.validity.periodEnd, offerComponents: quoted.calculation.components, warnings: quoted.calculation.warnings, offerVatRate, householdSpread: householdSpreadOf(context, quoted.calculation) });
  const offer: Offer = { ...quoted, receipt };
  // Same saving per kWh (or Smc) as on the bill, simulated over 12 months of the annual consumption.
  const basis = annualBasis(context);
  const factor = basis ? basis.annual / basis.billed : null;
  const projection = annualProjection(offer, context, bill);
  const annualSaving = projection?.saving ?? null;
  const annualCurrent = projection?.current ?? (receipt.currentTotal !== null && factor !== null ? receipt.currentTotal * factor : null);
  const unit = context.vector === "EE" ? "kWh" : "Smc";
  const left = daysUntil(receipt.validUntil, today);
  const saving = receipt.savings ?? 0;
  const currentOffer = billOfferName(bill, context);
  return <section className="ui-card quote-receipt" aria-label="Scontrino dell'energia">
    <p className="eyebrow">SCONTRINO DELL&apos;ENERGIA</p>
    <h3>{offer.supplier} · {offer.offerName}</h3>
    {receipt.status === "COMPLETE" ? <div className={saving >= 0 ? "quote-saving" : "quote-saving negative"}>
      <span>{saving >= 0 ? "Risparmio sulla bolletta caricata" : "Costo in più sulla bolletta caricata"}</span>
      <strong>{euro(Math.abs(saving))}{receipt.savingsPercent !== null ? ` (${PERCENT.format(Math.abs(receipt.savingsPercent))}%)` : ""}</strong>
    </div> : null}
    {annualSaving !== null && basis ? <div className={annualSaving >= 0 ? "quote-saving annual" : "quote-saving annual negative"}>
      <span>{annualSaving >= 0 ? "Risparmio annuo previsto" : "Costo in più annuo previsto"}<small>Simulato su 12 mesi con {amount(basis.annual, unit)} di consumo annuo{basis.estimated ? " stimato: media mensile della bolletta × 12" : " letto in bolletta"}</small>
        {/* Annual saving in euro and in percent with both annual costs, as the scheda sintetica's spesa annua (Codice art. 19; Tony, 29/10). */}
        {annualCurrent ? <small>Spesa annua attuale {euro(annualCurrent)} · con la nuova offerta {euro(annualCurrent - annualSaving)}{receipt.taxesIncluded ? " (imposte comprese)" : " (imposte escluse)"}</small> : null}</span>
      <strong>{euro(Math.abs(annualSaving))}{annualCurrent ? ` (${PERCENT.format(Math.abs(annualSaving / annualCurrent * 100))}%)` : ""}</strong>
    </div> : null}
    {receipt.status === "COMPLETE" ? null : <p className="inline-warning" role="status">La bolletta non riporta la spesa per la vendita di energia: mostriamo solo il costo della nuova offerta.</p>}
    {/* Scontrino (Tony, 26/10): materia energia, trasporto e gestione del contatore, oneri di sistema, imposte e accise aggregated first,
        then every charge they contain (energia, dispacciamento, capacity, sbilanciamento, PCV, Flex, accise, IVA…) on its own line. */}
    <div className="responsive-table"><table className="quote-scontrino">
      <caption>Periodo della bolletta: {date(context.billingPeriod.periodStart)} – {date(context.billingPeriod.periodEnd)} · stessi consumi per entrambe le colonne</caption>
      <thead><tr><th scope="col">Voce</th><th scope="col">Bolletta attuale{currentOffer ? <small>{context.currentSupplier} · {currentOffer}</small> : null}</th><th scope="col">CTE simulata<small>{offer.supplier} · {offer.offerName}</small></th><th scope="col">Differenza</th></tr></thead>
      <tbody>{receipt.rows.flatMap((row) => [<tr key={row.key} className={`quote-section-row${row.difference != null && Math.abs(row.difference) >= 0.01 ? " changed" : ""}`}>
        <th scope="row">{row.label}<VerificationNote bill={bill} rowKey={row.key} receipt={receipt} /></th><td>{euro(row.current)}</td><td>{euro(row.offer)}</td><td className={difference(row.difference ?? null)}>{signedEuro(row.difference ?? null)}</td>
      </tr>, ...(row.details ?? []).map((item) => <tr key={`${row.key}-${item.key}`} className={`quote-detail-row${item.difference !== null && Math.abs(item.difference) >= 0.01 ? " changed" : ""}`}>
        <th scope="row">{item.label}{row.key === "ENERGY" && item.current !== null ? <VerificationNote bill={bill} rowKey={item.key} /> : null}</th>
        <td>{item.current === null ? (item.currentNote ? <small className="muted">{item.currentNote}</small> : receipt.status === "COMPLETE" ? "non in bolletta" : "—") : euro(item.current)}</td><td>{item.offer !== null ? euro(item.offer) : item.missingReason ? <small className="quote-check open">Non calcolato: {item.missingReason}</small> : "non nella CTE"}</td><td className={difference(item.difference)}>{signedEuro(item.difference)}</td>
      </tr>)])}</tbody>
      {receipt.status === "COMPLETE" ? <tfoot><tr><th scope="row">{receipt.taxesIncluded ? "Totale" : "Totale imposte escluse"}</th><td>{euro(receipt.currentTotal)}</td><td>{euro(receipt.offerTotal)}</td><td className={difference(receipt.savings === null ? null : -receipt.savings)}>{signedEuro(receipt.savings === null ? null : -receipt.savings)}</td></tr></tfoot> : null}
    </table></div>
    {receipt.excluded?.length ? <div className="quote-excluded"><strong>Partite escluse dal confronto</strong><ul>{receipt.excluded.map((item, index) => <li key={index}>{item.label}: {euro(item.amount)}</li>)}</ul></div> : null}
    {/* The same totals by ARERA quota (consumi, fissa, potenza), for the scontrino dell'energia of the revised Bolletta 2.0. */}
    <details className="quote-detail">
      <summary>Riepilogo per quote (quota energia, quota fissa, quota potenza)</summary>
      <div className="responsive-table"><table>
        <thead><tr><th scope="col">Quota</th><th scope="col">Bolletta attuale</th><th scope="col">CTE simulata</th><th scope="col">Differenza</th></tr></thead>
        <tbody>{receipt.quotas.map((row) => <tr key={row.key}><th scope="row">{row.label}<small>{row.basis}</small></th><td>{euro(row.current)}</td><td>{euro(row.offer)}</td><td className={difference(row.difference)}>{signedEuro(row.difference)}</td></tr>)}</tbody>
      </table></div>
    </details>
    {receipt.taxesIncluded ? <label className="quote-vat">
      <span>Aliquota IVA della nuova offerta</span>
      <select value={offerVatRate ?? ""} onChange={(event) => setOfferVatRate(event.target.value === "" ? null : Number(event.target.value))}>
        <option value="">Come in bolletta ({PERCENT.format((receipt.billVatRate ?? quoted.receipt.vatRate ?? 0.22) * 100)}%)</option>
        {VAT_CHOICES.map((rate) => <option key={rate} value={rate}>{PERCENT.format(rate * 100)}%{rate < 0.22 ? " (aliquota agevolata)" : ""}</option>)}
      </select>
      <small>Accise uguali alla bolletta: non dipendono dal fornitore. Cambia l&apos;IVA solo se l&apos;azienda ha diritto all&apos;aliquota agevolata.</small>
    </label> : null}
    <SameOfferCheck offer={offer} bill={bill} context={context} />
    <OfferBox offer={offer} bill={bill} context={context} />
    <div className="quote-validity">
      <span>Offerta valida fino al</span><strong>{date(receipt.validUntil)}</strong>
      <small>{left === null ? "Verifica la scadenza sulla CTE prima di firmare." : left < 0 ? "Offerta scaduta: non può più essere firmata." : `Il cliente deve firmare il contratto entro questa data${left <= 7 ? ` (mancano ${left} giorni)` : ""}.`}</small>
    </div>
    <CostDetail offer={offer} open={business} />
    <p className="muted quote-note">Calcolo sugli stessi consumi e sullo stesso periodo della bolletta, con le voci di spesa della delibera ARERA 386/2025. Tariffa per l'uso della rete, oneri generali di sistema e accise non dipendono dal fornitore e restano quelli della bolletta{receipt.vatRate !== null ? `; IVA della nuova offerta al ${PERCENT.format(receipt.vatRate * 100)}%${receipt.vatRateEstimated ? " stimata" : ""}${offerVatRate !== null && receipt.billVatRate != null && Math.abs(offerVatRate - receipt.billVatRate) > 0.0001 ? ` (in bolletta ${PERCENT.format(receipt.billVatRate * 100)}%)` : ""}` : ""}.</p>
  </section>;
}

export default function QuickQuoteFlow({ readonly }: { readonly readonly: boolean }): ReactNode {
  const [step, setStep] = useState<Step>("bill");
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState<string>();
  const [archive, setArchive] = useState<readonly ApprovedBillSummaryModel[]>([]);
  const [billQuery, setBillQuery] = useState("");
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
      const prepared = await requestJson<{ readonly context: Context; readonly candidates: readonly Candidate[]; readonly unlisted?: readonly Unlisted[]; readonly canAuthorizeCte?: boolean }>(`/api/simulation/context?billId=${encodeURIComponent(billId)}&taxTreatment=EXCLUDED`);
      // A CTE authorized for this bill can anchor the comparison when no other CTE fits.
      const ready = (item: Candidate) => item.calculationReadiness === "READY" && Boolean(item.cteVersionId);
      const anchor = prepared.candidates.find((item) => item.finalStatus === "ELIGIBLE" && ready(item)) ?? prepared.candidates.find((item) => item.finalStatus === "ELIGIBLE_BY_OVERRIDE" && item.eligibilityOverrideId && ready(item));
      if (!anchor) { setQuote({ bill, context: prepared.context, comparison: { comparisonId: "", fingerprint: "", tenantId: "", vector: prepared.context.vector, results: [], excludedOffers: [], ranking: [], warnings: [] }, offers: [], candidates: prepared.candidates, unlisted: prepared.unlisted ?? [], canAuthorizeCte: prepared.canAuthorizeCte === true }); return; }
      const comparison = (await requestJson<{ readonly result: ComparisonModel }>("/api/comparison", { method: "POST", body: JSON.stringify({ sourceBill: { billId, version: prepared.context.billVersionId }, cteId: anchor.archiveId, cteVersionId: anchor.cteVersionId, ...(anchor.finalStatus === "ELIGIBLE_BY_OVERRIDE" && anchor.eligibilityOverrideId ? { eligibilityOverrideId: anchor.eligibilityOverrideId } : {}) }) })).result;
      const offers = offersFrom(bill, prepared.context, prepared.candidates, comparison);
      setQuote({ bill, context: prepared.context, comparison, offers, candidates: prepared.candidates, unlisted: prepared.unlisted ?? [], canAuthorizeCte: prepared.canAuthorizeCte === true });
      setSelectedId(offers[0]?.calculation.calculationId ?? null);
    } catch (cause) { setError(cause instanceof Error && cause.message.startsWith("Dalla bolletta") ? cause.message : message(cause)); } finally { setPending(undefined); }
  };

  const authorizeCte = async (archiveId: string, reason: string) => {
    if (!quote) return;
    await requestJson("/api/eligibility/override", { method: "POST", body: JSON.stringify({ action: "grant", billId: quote.context.billId, billVersionId: quote.context.billVersionId, cteId: archiveId, reason }) });
    await loadOffers(quote.context.billId);
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
      setValues(readValues(document));
      setStep("review");
    } catch (cause) { setError(cause instanceof Error && cause.message === "BILL_READ_FAILED" ? "Non siamo riusciti a leggere la bolletta. Riprova con un PDF più nitido." : withDetail(cause)); } finally { setPending(undefined); }
  };

  // An already loaded bill opens on its read data first, like a new upload.
  const openBill = async (billId: string) => {
    if (pending) return;
    setPending("open"); setError(undefined);
    try {
      const document = (await requestJson<{ readonly document: BillDocumentModel }>(`/api/bills/${encodeURIComponent(billId)}`)).document;
      setDraft(document);
      setValues(readValues(document));
      setStep("review");
    } catch (cause) { setError(message(cause)); } finally { setPending(undefined); }
  };

  // Confirms what was read, saves what the user corrected, approves the bill and moves on to the offers.
  const confirm = async () => {
    if (!draft || readonly || pending) return;
    const missing = FIELDS.filter((field) => !(values[field.name] ?? "").trim());
    if (missing.length) { setError(`Completa: ${missing.map((field) => field.label).join(", ")}.`); return; }
    setPending("confirm"); setError(undefined);
    try {
      let current = draft;
      const machineValue = (name: string) => toMachine(name, values[name] ?? "", draft.fields[name]?.value);
      // An already approved bill with nothing corrected goes straight to the CTE search.
      if (draft.currentApprovedVersionId && draft.currentApprovedVersionId === draft.currentVersionId && FIELDS.every((field) => machineValue(field.name) === (draft.fields[field.name]?.value ?? ""))) {
        setDraft(null); setPending(undefined); await loadOffers(draft.id); return;
      }
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
      {pending === "upload" || pending === "open" ? <LoadingState label={pending === "open" ? "Apertura della bolletta" : "Lettura della bolletta in corso"} /> : <>
        <label className="button primary quote-upload-button">Carica bolletta (PDF)<input className="visually-hidden" type="file" accept="application/pdf" onChange={(event) => void upload(event)} disabled={readonly || Boolean(pending)} /></label>
        {archive.length ? <div className="form-field"><span className="form-label">Oppure usa una bolletta già caricata</span>
          {/* Tony (31/10): "inserire un campo ricerca, e elencare in ordine alfabetico crescente". */}
          <input type="search" value={billQuery} onChange={(event) => setBillQuery(event.target.value)} placeholder="Cerca per intestatario, fornitore o file" aria-label="Cerca bolletta" disabled={Boolean(pending)} />
          <select value="" onChange={(event) => { if (event.target.value) void openBill(event.target.value); }} disabled={Boolean(pending)} aria-label="Scegli la bolletta"><option value="">Scegli la bolletta</option>{billChoices(archive, billQuery).map((bill) => <option key={bill.id} value={bill.id}>{billLabel(bill)}</option>)}</select></div> : null}
      </>}
    </section> : null}
    {step === "review" && draft ? <section className="ui-card">
      <h3>Dati letti dalla bolletta</h3><p className="muted">Li usiamo per trovare le CTE adatte. Se vedi un errore evidente puoi correggerlo, altrimenti prosegui.</p>
      <BillContractFacts bill={draft} />
      <div className="form-grid">{FIELDS.map((field) => <label className="form-field" key={field.name}><span className="form-label">{field.label}{unitOf(field.name, draft.resolvedVector)}{field.name === "annualConsumption" && !draft.fields.annualConsumption?.value && values.annualConsumption ? historyMonthTotals(draft.structuredBill?.consumptionHistory).length ? " · media dello storico consumi × 12" : " · media mensile × 12" : ""}</span><input value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} disabled={Boolean(pending)} /></label>)}</div>
      <div className="button-row"><button className="button primary" type="button" onClick={() => void confirm()} disabled={readonly || Boolean(pending)}>{pending === "confirm" ? "Ricerca in corso" : "Cerca le CTE utilizzabili"}</button></div>
    </section> : null}
    {step === "offers" ? pending === "offers" ? <LoadingState label="Calcolo delle offerte per questa bolletta" /> : quote ? <>
      <BillSummary context={quote.context} bill={quote.bill} />
      <section className="ui-card"><h3>Offerte utilizzabili per {quote.context.vector === "EE" ? "questa fornitura di luce" : "questa fornitura di gas"}</h3>
        {quote.offers.length ? <div className="quote-offers">{quote.offers.map((offer, index) => <button key={offer.calculation.calculationId} type="button" className={`quote-offer${offer.calculation.calculationId === selectedId ? " selected" : ""}${index === 0 ? " best" : ""}`} onClick={() => { setSelectedId(offer.calculation.calculationId); setProposal(null); }} aria-pressed={offer.calculation.calculationId === selectedId}>
          {index === 0 ? <span className="status-badge positive">La più conveniente</span> : null}
          {offer.candidate.finalStatus === "ELIGIBLE_BY_OVERRIDE" ? <span className="status-badge">Autorizzata per questa bolletta</span> : null}
          <strong>{offer.supplier}</strong><span>{offer.offerName}</span>
          {termLines(offer.candidate).map((line) => <span key={line} className="quote-offer-term">{line}</span>)}
          {offer.candidate.scope ? <small className="quote-offer-scope">Per {offer.candidate.scope.customer}{offer.candidate.scope.voltage.length ? ` · ${offer.candidate.scope.voltage.map((level) => level === "LV" ? "BT" : level === "MV" ? "MT" : level === "HV" ? "AT" : level).join("/")}` : ""}{offer.candidate.scope.consumption ? ` · consumo ${offer.candidate.scope.consumption}` : ""}</small> : null}
          <span className="quote-offer-total">{euro(offer.receipt.offerTotal ?? offer.receipt.rows[0].offer)}</span>
          {offer.receipt.savingsPercent !== null ? <small className={offer.receipt.savingsPercent >= 0 ? "positive" : "negative"}>{offer.receipt.savingsPercent >= 0 ? "Risparmio" : "Più cara"} {PERCENT.format(Math.abs(offer.receipt.savingsPercent))}%</small> : null}
          {(() => { const projection = annualProjection(offer, quote.context, quote.bill); return projection ? <small className={projection.saving >= 0 ? "positive" : "negative"}>{projection.saving >= 0 ? "Risparmio annuo previsto" : "Costo in più annuo"} {euro(Math.abs(projection.saving))}</small> : null; })()}
          <small>Valida fino al {date(offer.receipt.validUntil)}</small>
        </button>)}</div> : null}
        {quote.offers.length ? <NoOfferReasons quote={quote} shown={quote.offers.map((offer) => offer.candidate.archiveId)} onAuthorize={readonly ? undefined : authorizeCte} /> : null}
        {quote.offers.length ? null : <><EmptyState title="Nessuna offerta utilizzabile" detail="Nessuna CTE a te assegnata è adatta a questa bolletta. Chiedi all'amministratore di assegnartene una." /><NoOfferReasons quote={quote} onAuthorize={readonly ? undefined : authorizeCte} /></>}
      </section>
      {selected ? <><Receipt offer={selected} today={today} business={quote.context.customerType === "NON_RESIDENTIAL"} context={quote.context} bill={quote.bill} /><div className="button-row"><button className="button primary" type="button" onClick={() => void saveProposal()} disabled={readonly || Boolean(pending)}>{pending === "proposal" ? "Preparazione" : "Scarica la proposta in PDF"}</button>{proposal ? <span className="muted" role="status">Proposta salvata in Proposte.</span> : null}</div></> : null}
    </> : null : null}
    {error ? <ErrorState message={error} /> : null}
  </div>;
}
