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
// Tony (2/11, IREN Citrus Juices): "Altre partite non soggette ad IVA 125,47 €" is followed by "Bollo fattura 2,00 €" and
// "Interessi di mora 123,47 €": the items are read and the heading that sums them is left out (see below).
const OTHER_ITEMS = /^(altre\s+partite|ricalcoli|canone\s+(?:di\s+abbonamento\s+)?(?:alla\s+)?(?:televisione|rai)|interessi\s+di\s+mora|bollo(?:\s+fattura)?)\b/i;
// Tony (2/11, J Fuel): "Energia reattiva prelevata 753 kVARh x 0,003772 €/kVARh 2,84 €" is printed under the quota per consumi.
const REACTIVE = /^energia\s+reattiva\b/i;
const REACTIVE_QUOTA = "Energia reattiva";
const ITEM = (row: string) => TAXES.test(row) || BONUS.test(row) || TOTAL.test(row) || OTHER_ITEMS.test(row) || REACTIVE.test(row);

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/[=+]\s*$/, "").trim();
// "3 kW per 2 mesi x 2,00 €/kW/mese + 12,00 €" under "Quota fissa e Quota potenza": the power quota has no header of its own.
const POWER_ROW = /^\d+(?:[.,]\d+)?\s*kW\s+per\b/i;
const amountOf = (text: string): string | null => { const match = AMOUNT_AT_END.exec(text); return match ? `${match[1].replace(/[+\s]/g, "").replace("−", "-")} €` : null; };
const line = (code: StructuredBillEconomicChargeLine["code"], description: string, amount: string, extra: Partial<Pick<StructuredBillEconomicChargeLine, "quantity" | "unit" | "unitPrice">> = {}): StructuredBillEconomicChargeLine =>
  ({ code, description, quantity: extra.quantity ?? "", unit: extra.unit ?? "", unitPrice: extra.unitPrice ?? "", amount, periodRaw: "", status: "FOUND" });

/** The scontrino lines printed in the PDF text, in the order of the bill. Empty when the text has no scontrino. */
export function printedScontrinoLines(text: string): readonly StructuredBillEconomicChargeLine[] {
  // Tony (2/11, Plenitude sample bill): the Box dell'offerta is printed in a column to the right of the scontrino
  // ("di cui spesa per la rete e gli oneri   3,75 €      Totale dovuto per la vendita ...: 642,18 €"): a row ends at its
  // first amount in euro followed by a wide gap, so the box never lends the scontrino its amounts or labels.
  // Hera prints the amount before the average price ("10 kW per 1 mesi   44,92 € 4,492000 €/kW/mese"): the price is put
  // first, so the row still ends with its amount.
  // Elios prints the amounts without "€" under an "Importi [€]" heading: there a trailing amount is in euro.
  const bareEuro = /importi\s*[\[(]\s*€\s*[\])]/i.test(text);
  const rows = text.split(/\r?\n/)
    .map((raw) => bareEuro ? raw.replace(/(\s[+\-−]?\d{1,3}(?:\.\d{3})*,\d{2})(?=\s{6,}[^\s€\d]|\s*$)/, "$1 €") : raw)
    .map((raw) => raw.replace(/(\d{1,3}(?:\.\d{3})*,\d{2}\s*€)(\s+)(\d+(?:\.\d{3})*,\d{3,}\s*€\s*\/\s*[A-Za-z]+(?:\/[A-Za-z]+)?)/g, "$3$2$1"))
    .map((raw) => raw.replace(/^(.*?\d,\d{2}\s*€)\s{6,}\S.*$/, "$1")).map(clean).filter(Boolean);
  const first = rows.findIndex((row) => DI_CUI.test(row));
  if (first < 0) return [];
  let start = first;
  for (let index = first; index >= Math.max(0, first - 6); index -= 1) if (QUOTA_HEADER.test(rows[index])) { start = index; break; }
  const totalAt = rows.findIndex((row, index) => index > first && TOTAL.test(row));
  // Tony (1/11, Loomen bill): "Totale bolletta" prints its amount on the next row, so the scan goes a few rows past it.
  const end = totalAt > 0 && totalAt - start <= 80 ? Math.min(rows.length - 1, totalAt + 3) : Math.min(rows.length - 1, start + 60);
  const lines: StructuredBillEconomicChargeLine[] = [];
  let quota: string | null = null;
  // The amount of a row is on it or on one of the next three rows (the layout splits label, price and amount).
  const gather = (from: number): { readonly text: string; readonly next: number } => {
    let joined = rows[from];
    let index = from;
    while (!amountOf(joined) && index < Math.min(end, from + 3)) { index += 1; if (QUOTA_HEADER.test(rows[index]) || DI_CUI.test(rows[index]) || ITEM(rows[index])) { index -= 1; break; } joined = `${joined} ${rows[index]}`; }
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
    // Tony (2/11, IREN Citrus Juices): "ENERGIA REATTIVA 53,00 €" is followed by its own "di cui spesa per la rete" 53,00 €:
    // that share repeats the reactive line, it is not a second quota per consumi share.
    if (share && quota === REACTIVE_QUOTA) { index = gather(index).next; continue; }
    if (share && quota) {
      const { text: joined, next } = gather(index);
      const amount = amountOf(joined);
      if (amount) {
        const price = UNIT_PRICE.exec(joined);
        const label = clean(row.replace(AMOUNT_AT_END, "").replace(UNIT_PRICE, ""));
        lines.push(line(/rete/i.test(share[1]) ? "NETWORK_SYSTEM" : "OTHER_CHARGE", `${quota} - ${label}`, amount, { unit: price ? `€/${price[2]}` : "", unitPrice: price ? price[1] : "" }));
        index = next;
      }
      continue;
    }
    // Altre partite, accise e IVA, bonus and the total: the label can span rows and the amount sits on a later row
    // (Tony, 1/11, Loomen: "Altre partite - Interessi …, Bollo, Gestione Materia Energia" then "+ 403,86 €").
    if (!ITEM(row)) continue;
    const { text: joined, next } = gather(index);
    const amount = amountOf(joined);
    if (!amount) continue;
    const label = clean(joined.replace(AMOUNT_AT_END, ""));
    if (REACTIVE.test(row)) {
      const quantity = /(\d+(?:\.\d{3})*(?:,\d+)?)\s*kVArh/i.exec(joined); const price = /(\d+,\d+)\s*€\s*\/\s*kVArh/i.exec(joined);
      lines.push(line("OTHER_CHARGE", clean(label.replace(/\d[\d.,]*\s*kVArh.*$/i, "")), amount, { quantity: quantity ? quantity[1] : "", unit: quantity ? "kVArh" : "", unitPrice: price ? price[1] : "" }));
      quota = REACTIVE_QUOTA;
      index = next;
      continue;
    }
    const code = TAXES.test(row) ? "TAX_SUBTOTAL" : BONUS.test(row) ? "BONUS" : TOTAL.test(row) ? "BILL_TOTAL" : "ALTRE_PARTITE";
    lines.push(line(code, label, amount));
    index = next;
    if (code === "BILL_TOTAL") break;
  }
  // A scontrino needs at least one "di cui" share with its amount.
  return lines.some((item) => / - di cui /i.test(item.description)) ? withoutAltrePartiteHeading(withReactiveInQuota(lines, text)) : [];
}

// Tony (2/11, Plenitude sample bill): "QUOTA PER CONSUMI 744,18 €" holds vendita 626,18 € + rete e oneri 113,60 € and the
// reactive energy of the rete detail (4,40 €), which neither "di cui" shows. The small remainder of a quota whose bill bills
// reactive energy is that reactive energy, so the bill side keeps its printed total.
function withReactiveInQuota(lines: readonly StructuredBillEconomicChargeLine[], text: string): readonly StructuredBillEconomicChargeLine[] {
  if (!/energia\s+reattiva\s+(prelevata|immessa)/i.test(text) || lines.some((item) => REACTIVE.test(item.description))) return lines;
  const cents = (amount: string) => Math.round(Number(amount.replace(/[^\d,\-]/g, "").replace(",", ".")) * 100);
  const result: StructuredBillEconomicChargeLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const item = lines[index];
    result.push(item);
    if (item.code !== "OTHER_CHARGE" || !/consumi/i.test(item.description) || / - di cui /i.test(item.description)) continue;
    let end = index + 1;
    while (end < lines.length && lines[end].description.startsWith(`${item.description} - di cui`)) end += 1;
    const shares = lines.slice(index + 1, end);
    if (shares.length < 2) continue;
    const remainder = cents(item.amount) - shares.reduce((sum, share) => sum + cents(share.amount), 0);
    if (remainder <= 0 || remainder > cents(item.amount) * 0.05) continue;
    result.push(...shares, line("OTHER_CHARGE", `Energia reattiva (compresa nella ${item.description.toLowerCase()})`, `${Math.floor(remainder / 100)},${String(remainder % 100).padStart(2, "0")} €`));
    index = end - 1;
  }
  return result;
}

// An "Altre partite ..." heading whose amount is the sum of the altre partite printed right below it is their subtotal.
function withoutAltrePartiteHeading(lines: readonly StructuredBillEconomicChargeLine[]): readonly StructuredBillEconomicChargeLine[] {
  const cents = (amount: string) => Math.round(Number(amount.replace(/[^\d,\-]/g, "").replace(",", ".")) * 100);
  const dropped = new Set<number>();
  lines.forEach((item, index) => {
    if (item.code !== "ALTRE_PARTITE" || !/^altre\s+partite/i.test(item.description)) return;
    let sum = 0;
    for (let next = index + 1; next < lines.length && lines[next].code === "ALTRE_PARTITE"; next += 1) {
      sum += cents(lines[next].amount);
      if (sum === cents(item.amount) && next > index + 1) { dropped.add(index); return; }
    }
  });
  return dropped.size === 0 ? lines : lines.filter((_, index) => !dropped.has(index));
}

const hasScontrino = (lines: readonly StructuredBillEconomicChargeLine[]) => lines.some((item) => /di\s+cui\s+spes[ae]\s+per/i.test(`${item.description} ${item.rawDescription ?? ""}`));

const amountValue = (amount: string) => Number(amount.replace(/[^\d,\-]/g, "").replace(",", "."));
const SCONTRINO_ROW = /di\s+cui\s+spes[ae]\s+per|^(accise\s+e\s+iva|totale\s+(?:della\s+)?bolletta|altre\s+partite|energia\s+reattiva)\b/i;

/**
 * The printed scontrino wins over the AI reading of the same block. Tony (1/11, Loomen bill read as quota per consumi
 * 0,00 € and altre partite 882,37 €: "bisogna trovare soluzione definitiva, affinchè sappia leggere qualsiasi bolletta di
 * qualsiasi azienda. e non commetta più errori"): the scontrino is read from the PDF text, which never misreads a number,
 * and replaces the AI's "di cui" shares, quota totals, accise e IVA, altre partite and totale bolletta. The detail lines the AI
 * read elsewhere in the bill stay. Printed "altre partite" are added only when the AI read none of those items one by one.
 */
export function withPrintedScontrino(extraction: StructuredBillExtraction, text: string | null): StructuredBillExtraction {
  if (!text) return extraction;
  const printed = printedScontrinoLines(text);
  if (!printed.length) return extraction;
  const headers = new Set(printed.filter((item) => QUOTA_HEADER.test(item.description) && !/ - /.test(item.description)).map((item) => amountValue(item.amount)));
  const describe = (item: StructuredBillEconomicChargeLine) => `${item.description} ${item.rawDescription ?? ""}`.trim();
  const duplicate = (item: StructuredBillEconomicChargeLine) => item.code === "TAX_SUBTOTAL" || item.code === "BILL_TOTAL" || SCONTRINO_ROW.test(describe(item))
    || (QUOTA_HEADER.test(item.description.trim()) && headers.has(amountValue(item.amount)));
  const kept = extraction.economicChargeLines.filter((item) => !duplicate(item));
  const itemised = kept.some((item) => ["ALTRE_PARTITE", "INTERESSI_MORA", "LATE_PAYMENT", "ADMINISTRATIVE_FEES", "RICALCOLI", "ADDEBITI", "ACCREDITI", "RESTITUZIONI", "SERVIZI_AGGIUNTIVI", "CANONE_RAI", "TV_FEE", "PRIOR_BALANCE"].includes(item.code));
  return { ...extraction, economicChargeLines: [...printed.filter((item) => item.code !== "ALTRE_PARTITE" || !itemised), ...kept] };
}

/** A bill without a text layer: the transcribed scontrino goes through the same parser and is kept with the reading, so an
 *  archived image bill is shown the same way on every load. A transcript the parser cannot read is not kept. */
export function withScontrinoTranscript(extraction: StructuredBillExtraction, transcript: string | null): StructuredBillExtraction {
  if (!transcript || !printedScontrinoLines(transcript).length) return extraction;
  return { ...withPrintedScontrino(extraction, transcript), scontrinoTranscript: transcript };
}

/** The text the scontrino is read from: the PDF text layer, else the stored transcript of an image bill. */
export function scontrinoSource(extraction: StructuredBillExtraction | null | undefined, pdfText: string | null): string | null {
  return pdfText && printedScontrinoLines(pdfText).length ? pdfText : extraction?.scontrinoTranscript ?? pdfText;
}

/** True when the reading holds the bill's scontrino (its "di cui" shares). */
export function readingHasScontrino(extraction: StructuredBillExtraction | null | undefined): boolean {
  return Boolean(extraction && hasScontrino(extraction.economicChargeLines));
}
