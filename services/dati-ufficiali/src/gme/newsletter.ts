import { publishedPdfText } from "../../../../app/lib/market/gme-pun-source";
import { officialPdfText } from "../pdf-text";

/**
 * PUN Index GME monthly value (Tony 21/11/2026, decisione 2): read only where GME prints it with its month, the monthly
 * newsletter that reports on the month ("REPORT │ Maggio 2026"), Tabella 1 "MGP, dati di sintesi", block "PUN INDEX GME",
 * row "Baseload". Verified on newsletter n. 204 (June 2026): "Baseload 119,35 93,58 +25,78 …" for May 2026. The value is never
 * computed by the simulator: not from the bands, not from the 15-minute prices. The month comes from the report header,
 * never from the position of a bar in a chart.
 */
export const GME_NEWSLETTER_SOURCE_ID = "GME_NEWSLETTER_PUN_INDEX";
export const NEWSLETTER_HOSTS = ["www.mercatoelettrico.org", "gme.mercatoelettrico.org"] as const;
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export interface NewsletterCheck { readonly code: string; readonly ok: boolean; readonly detail: string }
export interface NewsletterReading {
  readonly checks: readonly NewsletterCheck[];
  readonly monthly: number | null;
  readonly number: string | null;
}

const isPdf = (bytes: Uint8Array) => bytes.byteLength > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
const number = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

/**
 * Candidate URLs of the newsletter that reports on `month`: GME publishes it in the following month, file named by its date
 * (e.g. 20260615Newsletter.pdf for the report on May 2026). Mid-month days first, where GME usually publishes.
 */
export function newsletterCandidates(month: string): readonly string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const y = next.getUTCFullYear(); const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const days = new Date(Date.UTC(y, next.getUTCMonth() + 1, 0)).getUTCDate();
  const order = [...Array.from({ length: days }, (_, index) => index + 1)].sort((a, b) => Math.abs(a - 15) - Math.abs(b - 15) || a - b);
  return order.flatMap((day) => NEWSLETTER_HOSTS.map((host) => `https://${host}/Portals/0/Documents/Newsletter/${y}${m}${String(day).padStart(2, "0")}Newsletter.pdf`));
}

/** The months named in the "REPORT │ <mese> <anno>" headers of the text (normally exactly one). */
export function reportMonths(text: string): readonly string[] {
  const found = [...text.matchAll(new RegExp(`REPORT\\W{0,6}(${MONTHS.join("|")})\\s*(20\\d\\d)`, "gi"))].map((match) => `${match[2]}-${String(MONTHS.indexOf(match[1].toLowerCase()) + 1).padStart(2, "0")}`);
  return [...new Set(found)];
}

/** Reads the newsletter text: report month, Tabella 1, PUN INDEX GME, Baseload, unit, and the prose value when printed. */
export function readNewsletterText(text: string, month: string): NewsletterReading {
  const flat = text.replace(/\s+/g, " ");
  const checks: NewsletterCheck[] = [];
  const months = reportMonths(flat);
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  checks.push({ code: "REPORT_MONTH", ok: months.length === 1 && months[0] === month, detail: months.length ? `intestazione del report: ${months.join(", ")} (atteso ${label})` : "intestazione \"REPORT │ mese anno\" non trovata" });
  const issue = /NUMERO\s*(\d{2,4})/i.exec(flat) ?? /\bn\.\s*(\d{2,4})\b/i.exec(flat);
  checks.push({ code: "NEWSLETTER", ok: /newsletter/i.test(flat) && Boolean(issue), detail: issue ? `Newsletter del GME n. ${issue[1]}` : "numero della newsletter non trovato" });
  const table = /Tabella\s*1\s*:?\s*MGP\s*,?\s*dati\s+di\s+sintesi/i.exec(flat);
  checks.push({ code: "TABLE", ok: Boolean(table), detail: table ? "Tabella 1 \"MGP, dati di sintesi\" trovata" : "Tabella 1 \"MGP, dati di sintesi\" non trovata" });
  let monthly: number | null = null;
  if (table) {
    const after = flat.slice(table.index);
    const block = /PUN\s*INDEX\s*GME/i.exec(after);
    const row = block ? /Baseload\s*(\d{1,4}(?:\.\d{3})*,\d{2})\b/i.exec(after.slice(block.index, block.index + 600)) : null;
    if (row) monthly = number(row[1]);
    checks.push({ code: "VALUE", ok: monthly !== null, detail: monthly !== null ? `PUN INDEX GME, Baseload: ${row![1]} €/MWh` : "riga \"Baseload\" del blocco PUN INDEX GME non trovata" });
  } else checks.push({ code: "VALUE", ok: false, detail: "valore non cercato: manca la Tabella 1" });
  const unit = /€\s*\/\s*MWh|EUR\s*\/\s*MWh/i.test(flat);
  checks.push({ code: "UNIT", ok: unit, detail: unit ? "unità €/MWh" : "unità €/MWh non trovata" });
  const plausible = monthly !== null && Number.isFinite(monthly) && monthly > 0 && monthly < 5000;
  checks.push({ code: "RANGE", ok: plausible, detail: plausible ? "valore nel campo ammesso (0–5000 €/MWh)" : "valore assente o fuori dal campo ammesso" });
  // The commentary repeats the value ("Il Pun Index GME … a 119,35 €/MWh"): when printed it must be the same number.
  const prose = /Pun\s*Index\s*GME[^.€]{0,160}?(\d{1,4}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)\s*\/\s*MWh/i.exec(flat);
  const proseValue = prose ? number(prose[1]) : null;
  checks.push({ code: "PROSE", ok: proseValue === null || proseValue === monthly, detail: proseValue === null ? "commento senza valore numerico: controllo non applicabile" : proseValue === monthly ? `commento coerente: ${prose![1]} €/MWh` : `commento diverso dalla tabella: ${prose![1]} €/MWh` });
  return { checks, monthly: checks.every((check) => check.ok) ? monthly : null, number: issue ? issue[1] : null };
}

/**
 * Reads the newsletter PDF as downloaded. The text comes first from pdf.js (real GME newsletters, Tony 24/11/2026: the minimal
 * reader returned no text on every real newsletter), then from the minimal reader; the first text that passes every check gives
 * the value. Nothing is derived: a newsletter whose text cannot be read, or whose Tabella 1 does not pass the checks, gives none.
 */
export async function readNewsletterPdf(bytes: Uint8Array, month: string): Promise<NewsletterReading> {
  if (!isPdf(bytes)) return { checks: [{ code: "FORMAT", ok: false, detail: "atteso un file PDF (intestazione %PDF-)" }], monthly: null, number: null };
  const extractors: readonly { readonly name: string; readonly read: () => Promise<string> }[] = [
    { name: "pdf.js", read: () => officialPdfText(bytes) },
    { name: "lettore interno", read: async () => publishedPdfText(bytes) },
  ];
  let best: NewsletterReading | null = null;
  const failures: string[] = [];
  for (const extractor of extractors) {
    let text = "";
    try { text = await extractor.read(); } catch (error) { failures.push(`${extractor.name}: ${error instanceof Error ? error.message.slice(0, 120) : "errore"}`); continue; }
    if (!text.trim()) { failures.push(`${extractor.name}: nessun testo`); continue; }
    const reading = readNewsletterText(text, month);
    const result = { ...reading, checks: [{ code: "FORMAT", ok: true, detail: "file PDF" }, { code: "TEXT", ok: true, detail: `testo del PDF leggibile (${extractor.name})` }, ...reading.checks] };
    if (result.monthly !== null) return result;
    best ??= result;
  }
  return best ?? { checks: [{ code: "FORMAT", ok: true, detail: "file PDF" }, { code: "TEXT", ok: false, detail: `testo del PDF non leggibile (${failures.join("; ")})` }], monthly: null, number: null };
}
