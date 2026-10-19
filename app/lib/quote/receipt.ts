import type { BillEconomicAnalysis } from "../foundation/bill-economic-analysis";

/**
 * Bolletta 2.0 style "scontrino dell'energia" for one offer, side by side with the bill it was simulated on.
 *
 * Only the supply cost changes with the supplier: transport, system charges and excise depend on the same
 * consumption and period, so they are carried over from the bill. VAT follows the new taxable amount.
 */
export type QuoteReceiptRowKey = "ENERGY" | "NETWORK" | "SYSTEM" | "TAXES";
export interface QuoteReceiptRow { readonly key: QuoteReceiptRowKey; readonly label: string; readonly current: number | null; readonly offer: number | null }
export interface QuoteReceipt {
  readonly status: "COMPLETE" | "OFFER_ONLY";
  readonly rows: readonly QuoteReceiptRow[];
  readonly currentTotal: number | null;
  readonly offerTotal: number | null;
  readonly savings: number | null;
  readonly savingsPercent: number | null;
  readonly taxesIncluded: boolean;
  readonly vatRate: number | null;
  readonly vatRateEstimated: boolean;
  readonly validUntil: string | null;
}
export interface QuoteReceiptInput {
  readonly vector: "EE" | "GAS";
  readonly offerSupplyCost: number;
  readonly analysis: Pick<BillEconomicAnalysis, "components" | "totals"> | null;
  readonly domestic: boolean;
  readonly validUntil: string | null;
}

const VAT_RATES = [0.04, 0.05, 0.1, 0.22] as const;
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const amountOf = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const token = String(value).replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!token) return null;
  const parsed = Number(token.includes(",") ? token.replace(/\./g, "").replace(",", ".") : token);
  return Number.isFinite(parsed) ? parsed : null;
};
const sumKnown = (values: readonly (number | null)[]): number | null => values.some((value) => value !== null) ? cents(values.reduce<number>((total, value) => total + (value ?? 0), 0)) : null;

/** The VAT rate printed on the bill, else the one implied by its amounts, else null. */
export function billVatRate(analysis: Pick<BillEconomicAnalysis, "components" | "totals">): number | null {
  const vatLines = analysis.components.filter((item) => item.classification === "IVA" && !item.aggregate);
  for (const line of vatLines) {
    for (const text of [line.description, line.rawDescription, line.unitPrice ?? "", line.rawUnitPrice, line.rawValue]) {
      const match = /(\d{1,2}(?:[.,]\d+)?)\s*%/.exec(text ?? "");
      const rate = match ? Number(match[1].replace(",", ".")) / 100 : null;
      if (rate !== null && VAT_RATES.some((known) => Math.abs(known - rate) < 0.0001)) return rate;
    }
  }
  const vat = sumKnown(vatLines.map((line) => amountOf(line.amount)));
  const excise = sumKnown(analysis.components.filter((item) => item.classification === "ACCISE" && !item.aggregate).map((line) => amountOf(line.amount)));
  const totals = analysis.totals;
  const base = sumKnown([totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal, totals.regulatedNetworkTotal, totals.systemChargesTotal, excise]);
  if (vat === null || base === null || base <= 0) return null;
  const implied = vat / base;
  const nearest = VAT_RATES.find((known) => Math.abs(known - implied) <= 0.015);
  return nearest ?? null;
}

export function buildQuoteReceipt(input: QuoteReceiptInput): QuoteReceipt {
  const offerEnergy = cents(input.offerSupplyCost);
  const totals = input.analysis?.totals ?? null;
  const currentEnergy = totals ? sumKnown([totals.sellerEnergyTotal, totals.sellerCommercializationTotal, totals.sellerOtherTotal]) : null;
  const network = totals?.regulatedNetworkTotal ?? null;
  const system = totals?.systemChargesTotal ?? null;
  const currentTaxes = totals?.taxTotal ?? null;
  const printedRate = input.analysis ? billVatRate(input.analysis) : null;
  const vatRate = printedRate ?? (input.domestic && input.vector === "EE" ? 0.1 : 0.22);
  const taxesIncluded = currentTaxes !== null && currentEnergy !== null;
  const offerTaxes = taxesIncluded ? cents(currentTaxes + (offerEnergy - currentEnergy) * vatRate) : null;
  const rows: QuoteReceiptRow[] = [
    { key: "ENERGY", label: input.vector === "EE" ? "Spesa per la materia energia" : "Spesa per la materia gas naturale", current: currentEnergy, offer: offerEnergy },
    { key: "NETWORK", label: "Trasporto e gestione del contatore", current: network, offer: network },
    { key: "SYSTEM", label: "Oneri di sistema", current: system, offer: system },
    { key: "TAXES", label: "Imposte e IVA", current: taxesIncluded ? currentTaxes : null, offer: offerTaxes },
  ];
  if (currentEnergy === null) {
    return { status: "OFFER_ONLY", rows, currentTotal: null, offerTotal: null, savings: null, savingsPercent: null, taxesIncluded: false, vatRate: null, vatRateEstimated: false, validUntil: input.validUntil };
  }
  const shared = (network ?? 0) + (system ?? 0);
  const currentTotal = cents(currentEnergy + shared + (taxesIncluded ? currentTaxes : 0));
  const offerTotal = cents(offerEnergy + shared + (offerTaxes ?? 0));
  const savings = cents(currentTotal - offerTotal);
  const savingsPercent = currentTotal > 0 ? Math.round((savings / currentTotal) * 1000) / 10 : null;
  return { status: "COMPLETE", rows, currentTotal, offerTotal, savings, savingsPercent, taxesIncluded, vatRate: taxesIncluded ? vatRate : null, vatRateEstimated: taxesIncluded && printedRate === null, validUntil: input.validUntil };
}
