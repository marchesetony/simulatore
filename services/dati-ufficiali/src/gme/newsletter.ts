import { publishedPdfText } from "../../../../app/lib/market/gme-pun-source";
import { officialPdfPages, officialPdfText } from "../pdf-text";
import type { FetchedDocument } from "../official-fetch";

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
  /** Page of the PDF where the value was read, when the text extractor gives pages (chart readings only). */
  readonly page?: number | null;
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

/**
 * Tony (24/11/2026, "DECISIONE GME AGOSTO"): when GME publishes no newsletter on a month (August 2026: n. 206 reports July,
 * n. 207 reports September), the month's PUN Index GME is the value GME prints for it in "Grafico 1: MGP, Pun Index GME" of
 * the following newsletter (n. 207: 180,00 €/MWh for August), validated on the original PDF. The value is the printed chart
 * label, never computed: the following month's Tabella 1 value and the commentary's change ("+27,54 €/MWh su agosto") only
 * identify which printed label belongs to the month, and the month is refused when they do not point to exactly one label.
 */
export const GME_NEWSLETTER_CHART_SOURCE_ID = "GME_NEWSLETTER_PUN_INDEX_CHART";
const MONTH_ABBREVIATIONS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export function followingMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

const cents = (value: number) => Math.round(value * 100);

/** Reads, in the newsletter reporting on the following month, the Grafico 1 label of `month`. */
export function readNewsletterChartText(text: string, month: string, pages: readonly string[] | null = null): NewsletterReading {
  const following = followingMonth(month);
  const flat = text.replace(/\s+/g, " ");
  const base = readNewsletterText(text, following);
  const checks: NewsletterCheck[] = base.checks.filter((check) => check.code === "REPORT_MONTH" || check.code === "NEWSLETTER" || check.code === "UNIT")
    .map((check) => check.code === "REPORT_MONTH" ? { ...check, detail: `${check.detail}: newsletter successiva, nessuna newsletter riporta il mese` } : check);
  const reference = base.monthly;
  checks.push({ code: "FOLLOWING_MONTH_TABLE", ok: reference !== null, detail: reference !== null ? `Tabella 1 del mese successivo valida: ${reference.toFixed(2).replace(".", ",")} €/MWh` : "Tabella 1 del mese successivo non valida: etichetta del grafico non identificabile" });
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const change = new RegExp(`([+\\-−–]\\s?\\d{1,4}(?:\\.\\d{3})*,\\d{2})\\s*(?:€|EUR)\\s*\\/\\s*MWh\\s*su\\s*${name}\\b`, "i").exec(flat);
  const delta = change ? number(change[1].replace(/[−–]/, "-").replace(/\s/g, "")) : null;
  checks.push({ code: "CHANGE_ON_MONTH", ok: delta !== null && Number.isFinite(delta), detail: change ? `commento: ${change[1]} €/MWh su ${name}` : `variazione "su ${name}" non trovata nel commento` });
  const caption = /Grafico\s*1\s*:?\s*MGP\s*,?\s*Pun\s*Index\s*GME/i.exec(flat);
  const chart = caption ? flat.slice(caption.index, caption.index + 2500) : "";
  // The page is the first page whose text carries the caption; without pages (minimal reader) it cannot be stated.
  const captionPattern = /Grafico\s*1\s*:?\s*MGP\s*,?\s*Pun\s*Index\s*GME/i;
  const pageIndex = pages ? pages.findIndex((page) => captionPattern.test(page.replace(/\s+/g, " "))) : -1;
  const page = pageIndex >= 0 ? pageIndex + 1 : null;
  checks.push({ code: "CHART", ok: Boolean(caption) && page !== null, detail: caption ? page !== null ? `Grafico 1 "MGP, Pun Index GME" trovato a pagina ${page}` : "Grafico 1 trovato ma pagina non determinabile" : "Grafico 1 \"MGP, Pun Index GME\" non trovato" });
  const axis = new RegExp(`\\b${MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1]}\\b`, "i").test(chart);
  checks.push({ code: "CHART_MONTH", ok: axis, detail: axis ? `mese "${MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1]}" presente sull'asse del grafico` : "mese non presente sull'asse del grafico" });
  let monthly: number | null = null;
  if (caption && reference !== null && delta !== null) {
    const expected = cents(reference) - cents(delta);
    const labels = [...chart.matchAll(/(?<![\d.,])(\d{1,4}[.,]\d{2})(?![\d.,])/g)].map((match) => match[1]);
    // The same number printed twice (or with a dot and with a comma) is one label; two different labels would be refused.
    const matching = [...new Set(labels.filter((label) => cents(Number(label.replace(",", "."))) === expected).map((label) => label.replace(",", ".")))];
    if (matching.length === 1) monthly = Number(matching[0]);
    checks.push({ code: "CHART_LABEL", ok: matching.length === 1, detail: matching.length === 1 ? `etichetta del grafico per ${name} ${month.slice(0, 4)}: ${matching[0]} €/MWh` : matching.length ? `più etichette compatibili: ${matching.join(", ")}` : `nessuna etichetta stampata nel grafico corrisponde a ${name}: valore non acquisito` });
  } else checks.push({ code: "CHART_LABEL", ok: false, detail: "etichetta non cercata: mancano grafico, tabella o commento" });
  const plausible = monthly !== null && monthly > 0 && monthly < 5000;
  checks.push({ code: "RANGE", ok: plausible, detail: plausible ? "valore nel campo ammesso (0–5000 €/MWh)" : "valore assente o fuori dal campo ammesso" });
  return { checks, monthly: checks.every((check) => check.ok) ? monthly : null, number: base.number, page };
}

/** The same extractors as readNewsletterPdf, for the chart label of a month without its own newsletter. */
export async function readNewsletterChartPdf(bytes: Uint8Array, month: string): Promise<NewsletterReading> {
  if (!isPdf(bytes)) return { checks: [{ code: "FORMAT", ok: false, detail: "atteso un file PDF (intestazione %PDF-)" }], monthly: null, number: null };
  let best: NewsletterReading | null = null;
  const failures: string[] = [];
  for (const [name, read] of [["pdf.js", () => officialPdfPages(bytes)], ["lettore interno", async () => null as readonly string[] | null]] as const) {
    let pages: readonly string[] | null = null; let text = "";
    try { pages = await read(); text = pages ? pages.join("\n") : publishedPdfText(bytes); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message.slice(0, 120) : "errore"}`); continue; }
    if (!text.trim()) { failures.push(`${name}: nessun testo`); continue; }
    const reading = readNewsletterChartText(text, month, pages);
    const result = { ...reading, checks: [{ code: "FORMAT", ok: true, detail: "file PDF" }, { code: "TEXT", ok: true, detail: `testo del PDF leggibile (${name})` }, ...reading.checks] };
    if (result.monthly !== null) return result;
    best ??= result;
  }
  return best ?? { checks: [{ code: "FORMAT", ok: true, detail: "file PDF" }, { code: "TEXT", ok: false, detail: `testo del PDF non leggibile (${failures.join("; ")})` }], monthly: null, number: null };
}

/**
 * Months on which GME published no newsletter, with the issue that carries their value in Grafico 1 (Tony 24/11/2026, "PUN
 * AGOSTO 2026"): n. 206 reports July 2026 and n. 207 reports September 2026, so no issue reports August. Only these months are
 * read from the chart; for every other month the criterion is unchanged (its own newsletter, Tabella 1), and their own dated
 * files are not searched at all, since none exists.
 */
export const MONTHS_WITHOUT_OWN_NEWSLETTER: Readonly<Record<string, string>> = { "2026-08": "207" };

export type NewsletterResolution = { readonly document: FetchedDocument; readonly reading: NewsletterReading; readonly chart?: true } | { readonly error: string };

/**
 * One criterion for the daily acquisition and the weekly audit. `fetchPdf` returns the document at the URL, null when there is
 * none (404, not a PDF); it may throw on a download error.
 */
export async function resolveMonthNewsletter(input: { readonly month: string; readonly known: string | null; readonly fetchPdf: (url: string) => Promise<FetchedDocument | null> }): Promise<NewsletterResolution> {
  const issue = MONTHS_WITHOUT_OWN_NEWSLETTER[input.month];
  const reporting = issue ? followingMonth(input.month) : input.month;
  const candidates = input.known ? [input.known, ...newsletterCandidates(reporting).filter((url) => url !== input.known)] : newsletterCandidates(reporting);
  try {
    for (const url of candidates) {
      const document = await input.fetchPdf(url);
      if (!document) continue;
      if (!issue) {
        const reading = await readNewsletterPdf(document.bytes, input.month);
        if (reading.checks.find((check) => check.code === "REPORT_MONTH")?.ok === false) continue;
        return { document, reading };
      }
      const reading = await readNewsletterChartPdf(document.bytes, input.month);
      if (reading.checks.find((check) => check.code === "REPORT_MONTH")?.ok === false) continue;
      const checks = [...reading.checks, { code: "ISSUE", ok: reading.number === issue, detail: reading.number === issue ? `newsletter n. ${issue}, indicata per ${input.month}` : `attesa la newsletter n. ${issue}, trovata n. ${reading.number ?? "non letta"}` }];
      const failed = checks.filter((check) => !check.ok);
      // No single label for the month, or not the expected issue: the monthly value stays missing and is reported.
      if (failed.length || reading.monthly === null) return { error: `GME_NEWSLETTER_MONTH_NOT_PUBLISHED:${failed.map((check) => `${check.code} ${check.detail}`).join("; ").slice(0, 300)}` };
      return { document, reading: { ...reading, checks }, chart: true };
    }
  } catch (error) { return { error: `GME_NEWSLETTER_DOWNLOAD:${error instanceof Error ? error.message : "errore"}` }; }
  return { error: issue ? "GME_NEWSLETTER_MONTH_NOT_PUBLISHED:newsletter successiva non ancora trovata" : "GME_NEWSLETTER_NOT_PUBLISHED_YET" };
}
