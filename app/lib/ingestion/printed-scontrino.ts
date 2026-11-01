import type { StructuredBillEconomicChargeLine, StructuredBillExtraction } from "./structured-bill.ts";

// Tony (1/11, "cazzo cazzo, quante volte dobbiamo fissare le regole. leggere lo scontrino della bolletta e le condizioni
// applicate che sono riportate, se esiste leggere il dettaglio"): the scontrino dell'energia (Bolletta 2.0, delibera ARERA
// 386/2025) is read straight from the PDF text, without the AI: quota per consumi, quota fissa, quota potenza with their
// "di cui spesa per la vendita" and "di cui spesa per la rete e gli oneri generali di sistema", accise e IVA, bonus and the
// total. When the AI reading holds no scontrino line (failed, empty or partial second reading), these lines are added, so
// the bill side of the comparison is never empty while the bill prints its scontrino.

const QUOTA_HEADER = /^(quota\s+(?:per\s+)?(?:i\s+)?consumi|quota\s+energia|quota\s+fissa|quota\s+potenza)\b/i;
const DI_CUI = /^di\s+cui\s+spes[ae]\s+per\s+(?:la\s+)?(?:quota\s+\S+\s+)?(vendita|rete)/i;
const AMOUNT_AT_END = /([+\-−]?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*€\s*$/;
const UNIT_PRICE = /(\d+(?:\.\d{3})*,\d+)\s*€\s*\/\s*([A-Za-zàè]+(?:\/[A-Za-z]+)?)/;
const QUANTITY = /(\d+(?:\.\d{3})*(?:,\d+)?)\s*(kWh|Smc|mes[ei]|kW)\b/i;
const TAXES = /^(accise\s+e\s+iva|totale\s+imposte\s+e\s+iva|imposte(?:\s+e\s+iva)?)\b/i;
const BONUS = /^bonus\s+sociale\b/i;
const TOTAL = /^totale\s+(?:della\s+)?bolletta\b/i;

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/[=+]\s*$/, "").trim();
// "3 kW per 2 mesi x 2,00 €/kW/mese + 12,00 €" under "Quota fissa e Quota potenza": the power quota has no header of its own.
const POWER_ROW = /^\d+(?:[.,]\d+)?\s*kW\s+per\b/i;
const amountOf = (text: string): string | null => { const match = AMOUNT_AT_END.exec(text); return match ? `${match[1].replace(/[+\s]/g, "").replace("−", "-")} €` : null; };
const line = (code: StructuredBillEconomicChargeLine["code"], description: string, amount: string, extra: Partial<Pick<StructuredBillEconomicChargeLine, "quantity" | "unit" | "unitPrice">> = {}): StructuredBillEconomicChargeLine =>
  ({ code, description, quantity: extra.quantity ?? "", unit: extra.unit ?? "", unitPrice: extra.unitPrice ?? "", amount, periodRaw: "", status: "FOUND" });

/** The scontrino lines printed in the PDF text, in the order of the bill. Empty when the text has no scontrino. */
export function printedScontrinoLines(text: string): readonly StructuredBillEconomicChargeLine[] {
  const rows = text.split(/\r?\n/).map(clean).filter(Boolean);
  const first = rows.findIndex((row) => DI_CUI.test(row));
  if (first < 0) return [];
  let start = first;
  for (let index = first; index >= Math.max(0, first - 6); index -= 1) if (QUOTA_HEADER.test(rows[index])) { start = index; break; }
  const totalAt = rows.findIndex((row, index) => index > first && TOTAL.test(row));
  const end = totalAt > 0 && totalAt - start <= 80 ? totalAt : Math.min(rows.length - 1, start + 60);
  const lines: StructuredBillEconomicChargeLine[] = [];
  let quota: string | null = null;
  // The amount of a row is on it or on one of the next three rows (the layout splits label, price and amount).
  const gather = (from: number): { readonly text: string; readonly next: number } => {
    let joined = rows[from];
    let index = from;
    while (!amountOf(joined) && index < Math.min(end, from + 3)) { index += 1; if (QUOTA_HEADER.test(rows[index]) || DI_CUI.test(rows[index])) { index -= 1; break; } joined = `${joined} ${rows[index]}`; }
    return { text: joined, next: index };
  };
  for (let index = start; index <= end; index += 1) {
    const row = rows[index];
    const header = QUOTA_HEADER.exec(row) ?? (POWER_ROW.test(row) ? Object.assign([""], { 1: "Quota potenza" }) as unknown as RegExpExecArray : null);
    if (header) {
      quota = clean(header[1]);
      const { text: joined, next } = gather(index);
      const amount = amountOf(joined);
      if (amount) {
        const quantity = QUANTITY.exec(joined.slice(header[0].length));
        const price = UNIT_PRICE.exec(joined);
        lines.push(line("OTHER_CHARGE", quota, amount, { quantity: quantity ? quantity[1] : "", unit: quantity ? quantity[2] : "", unitPrice: price ? price[1] : "" }));
        index = next;
      }
      continue;
    }
    const share = DI_CUI.exec(row);
    if (share && quota) {
      const { text: joined, next } = gather(index);
      const amount = amountOf(joined);
      if (amount) {
        const price = UNIT_PRICE.exec(joined);
        const label = clean(row.replace(AMOUNT_AT_END, "").replace(UNIT_PRICE, ""));
        lines.push(line("OTHER_CHARGE", `${quota} - ${label}`, amount, { unit: price ? `€/${price[2]}` : "", unitPrice: price ? price[1] : "" }));
        index = next;
      }
      continue;
    }
    const amount = amountOf(row);
    if (!amount) continue;
    if (TAXES.test(row)) lines.push(line("TAX_SUBTOTAL", clean(row.replace(AMOUNT_AT_END, "")), amount));
    else if (BONUS.test(row)) lines.push(line("BONUS", clean(row.replace(AMOUNT_AT_END, "")), amount));
    else if (TOTAL.test(row)) lines.push(line("BILL_TOTAL", clean(row.replace(AMOUNT_AT_END, "")), amount));
  }
  // A scontrino needs at least one "di cui" share with its amount.
  return lines.some((item) => / - di cui /i.test(item.description)) ? lines : [];
}

const hasScontrino = (lines: readonly StructuredBillEconomicChargeLine[]) => lines.some((item) => /di\s+cui\s+spes[ae]\s+per/i.test(`${item.description} ${item.rawDescription ?? ""}`));

/** Adds the printed scontrino to a reading that holds none; a reading that already has it is left as it is. */
export function withPrintedScontrino(extraction: StructuredBillExtraction, text: string | null): StructuredBillExtraction {
  if (!text || hasScontrino(extraction.economicChargeLines)) return extraction;
  const printed = printedScontrinoLines(text);
  if (!printed.length) return extraction;
  const present = new Set(extraction.economicChargeLines.filter((item) => item.code === "BILL_TOTAL" || item.code === "TAX_SUBTOTAL").map((item) => item.code));
  return { ...extraction, economicChargeLines: [...extraction.economicChargeLines, ...printed.filter((item) => !present.has(item.code))] };
}

/** True when the reading holds the bill's scontrino (its "di cui" shares). */
export function readingHasScontrino(extraction: StructuredBillExtraction | null | undefined): boolean {
  return Boolean(extraction && hasScontrino(extraction.economicChargeLines));
}
