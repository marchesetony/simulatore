import type { QuoteReceiptQuota } from "./receipt";

// Tony (1/11, "queste le voci che dobbiamo avere visibili nell'offerta come una fattura reale, poi il dettaglio con il
// paragone"): the new offer is shown first as the ARERA "Scontrino dell'energia" (Bolletta 2.0 facsimile, Figura 1):
// quantità × prezzo medio = importo per quota, each with "di cui spesa per la vendita" and "di cui spesa per la rete e gli
// oneri generali di sistema", then bonus, altre partite, accise e IVA and the total. The comparison table follows it.
export interface ScontrinoLine { readonly kind: "section" | "main" | "sub" | "item" | "total"; readonly label: string; readonly quantity?: string; readonly price?: string; readonly amount: number | null }

const QUANTITY = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
const PRICE = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const MONTHLY = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const cents = (value: number) => Math.round(value * 100) / 100;

/** Months billed, pro rata by day within each calendar month (1 July – 31 July = 1; 15 days of a 30-day month = 0,5). */
export function billedMonths(periodStart: string, periodEndExclusive: string): number | null {
  const start = Date.parse(`${periodStart.slice(0, 10)}T00:00:00Z`); const end = Date.parse(`${periodEndExclusive.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  let months = 0;
  for (let day = start; day < end; day += 86_400_000) { const date = new Date(day); months += 1 / new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); }
  return Math.round(months * 100) / 100;
}

export function offerScontrino(input: { readonly quotas: readonly QuoteReceiptQuota[]; readonly offerTotal: number | null; readonly taxesIncluded: boolean; readonly vector: "EE" | "GAS"; readonly quantity: number | null; readonly months: number | null; readonly powerKw: number | null; /** The company discount (negative, net of VAT), shown as its own line (Tony 1/11: visible). */ readonly discount?: number | null }): readonly ScontrinoLine[] {
  const discount = input.discount && input.discount < 0 ? input.discount : 0;
  const unit = input.vector === "EE" ? "kWh" : "Smc";
  const quota = (key: QuoteReceiptQuota["key"]) => input.quotas.find((item) => item.key === key);
  const lines: ScontrinoLine[] = [];
  const split = (row: QuoteReceiptQuota, per: (amount: number) => string | undefined) => {
    const total = row.offer ?? 0; const seller = row.offerSeller ?? 0; const regulated = cents(total - seller);
    if (Math.abs(seller) >= 0.005) lines.push({ kind: "sub", label: `di cui spesa per la vendita di ${input.vector === "EE" ? "energia elettrica" : "gas naturale"}`, price: per(seller), amount: cents(seller) });
    if (Math.abs(regulated) >= 0.005) lines.push({ kind: "sub", label: `di cui spesa per la rete e gli oneri generali di sistema`, price: per(regulated), amount: regulated });
  };
  const discounted = quota("CONSUMPTION");
  // The discount was taken off the consumption quota: shown there at full price and as its own line below.
  const consumption = discounted && discount ? { ...discounted, offer: discounted.offer === null ? null : cents(discounted.offer - discount), offerSeller: discounted.offerSeller === null ? null : cents(discounted.offerSeller - discount) } : discounted;
  if (consumption && consumption.offer !== null) {
    const per = (amount: number) => input.quantity && input.quantity > 0 ? `${PRICE.format(amount / input.quantity)} €/${unit}` : undefined;
    lines.push({ kind: "section", label: "Quota per consumi", amount: null });
    lines.push({ kind: "main", label: "", quantity: input.quantity ? `${QUANTITY.format(input.quantity)} ${unit}` : undefined, price: per(consumption.offer), amount: consumption.offer });
    split(consumption, per);
  }
  const fixed = quota("FIXED"); const power = quota("POWER");
  if ((fixed && fixed.offer) || (power && power.offer)) {
    lines.push({ kind: "section", label: input.vector === "EE" ? "Quota fissa e Quota potenza" : "Quota fissa", amount: null });
    if (fixed && fixed.offer) {
      const per = (amount: number) => input.months && input.months > 0 ? `${MONTHLY.format(amount / input.months)} €/mese` : undefined;
      lines.push({ kind: "main", label: "", quantity: input.months ? `${QUANTITY.format(input.months)} ${input.months === 1 ? "mese" : "mesi"}` : undefined, price: per(fixed.offer), amount: fixed.offer });
      split(fixed, per);
    }
    if (power && power.offer) {
      const basis = input.powerKw && input.months ? input.powerKw * input.months : null;
      const per = (amount: number) => basis ? `${MONTHLY.format(amount / basis)} €/kW/mese` : undefined;
      lines.push({ kind: "main", label: "", quantity: input.powerKw && input.months ? `${QUANTITY.format(input.powerKw)} kW per ${QUANTITY.format(input.months)} ${input.months === 1 ? "mese" : "mesi"}` : undefined, price: per(power.offer), amount: power.offer });
      split(power, per);
    }
  }
  if (discount) lines.push({ kind: "item", label: "Sconto commerciale aziendale", amount: cents(discount) });
  const other = quota("OTHER"); if (other && other.offer) lines.push({ kind: "item", label: "Altre partite", amount: other.offer });
  const bonus = quota("BONUS"); if (bonus && bonus.offer) lines.push({ kind: "item", label: "Bonus sociale", amount: bonus.offer });
  const taxes = input.quotas.filter((item) => item.key === "EXCISE" || item.key === "VAT" || item.key === "TAXES").reduce<number | null>((sum, item) => item.offer === null ? sum : (sum ?? 0) + item.offer, null);
  if (taxes !== null) lines.push({ kind: "item", label: "Accise e IVA", amount: cents(taxes) });
  const placed = cents(lines.filter((line) => line.kind !== "sub" && line.kind !== "section").reduce((sum, line) => sum + (line.amount ?? 0), 0));
  lines.push({ kind: "total", label: input.taxesIncluded ? "Totale bolletta" : "Totale imposte escluse", amount: input.offerTotal ?? placed });
  return lines;
}
