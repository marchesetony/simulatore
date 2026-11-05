import type { StructuredBillPeriod } from "./structured-bill.ts";

// Tony (2/11, "manca il periodo di riferimento, ricorda che delle bollette possono essere riferite a due mesi di fornitura
// come questa"): a bill may cover one month or several, written in many ways ("01/07/2026 - 31/08/2026", "dal 1 luglio 2026
// al 31 agosto 2026", "luglio - agosto 2026", "Luglio/Agosto 2026", "lug 2026 - ago 2026"). Every form is read the same way,
// Since 5/11/2026 it is never read from the PDF text: Claude reads it from the page.

const MONTHS: Readonly<Record<string, number>> = {
  gennaio: 1, gen: 1, febbraio: 2, feb: 2, marzo: 3, mar: 3, aprile: 4, apr: 4, maggio: 5, mag: 5, giugno: 6, giu: 6,
  luglio: 7, lug: 7, agosto: 8, ago: 8, settembre: 9, set: 9, sett: 9, ottobre: 10, ott: 10, novembre: 11, nov: 11, dicembre: 12, dic: 12,
};
const MONTH = "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|sett|set|ott|nov|dic)\\.?";
const iso = (year: number, month: number, day: number): string | null => {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed.toISOString().slice(0, 10) : null;
};
const firstOf = (year: number, month: number) => iso(year, month, 1);
const nextMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
const year4 = (value: string) => { const year = Number(value); return value.length === 2 ? 2000 + year : year; };

/** A printed date: 01/07/2026, 1.7.26, 2026-07-01, 1 luglio 2026, 1 lug 2026. */
function day(text: string): string | null {
  const value = text.trim().toLowerCase();
  const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoDate) return iso(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(value);
  if (numeric) return iso(year4(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const named = new RegExp(`^(\\d{1,2})\\s+${MONTH}\\s+(\\d{4})$`, "i").exec(value);
  if (named) return iso(Number(named[3]), MONTHS[named[2].toLowerCase()], Number(named[1]));
  return null;
}

/** The period in a printed string, or null. Day dates keep the printed last day; month names end on the next month's first day. */
export function parseItalianPeriod(input: string): StructuredBillPeriod | null {
  const raw = input.trim().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ");
  const value = raw.toLowerCase().replace(/^(?:periodo(?: di)?(?: riferimento| fatturazione| fornitura)?|bolletta|fattura)(?: di| del| per)?\s*:?\s*/, "").trim();
  // One month: "luglio 2026", "07/2026".
  const single = new RegExp(`^(?:${MONTH}|(\\d{1,2}))[\\s/.\\-]+(\\d{4})$`, "i").exec(value);
  if (single) {
    const month = single[1] ? MONTHS[single[1].toLowerCase()] : Number(single[2]);
    const year = Number(single[3]);
    if (month >= 1 && month <= 12) { const from = firstOf(year, month); return from ? { from, to: nextMonth(year, month), raw } : null; }
  }
  // Months with their years: "luglio 2026 - agosto 2026", "dic 2025 / gen 2026".
  const both = new RegExp(`^(?:dal\\s+)?${MONTH}\\s+(\\d{4})\\s*(?:-|/|al|a|e)\\s*${MONTH}\\s+(\\d{4})$`, "i").exec(value);
  if (both) {
    const from = firstOf(Number(both[2]), MONTHS[both[1].toLowerCase()]);
    const to = nextMonth(Number(both[4]), MONTHS[both[3].toLowerCase()]);
    return from && from < to ? { from, to, raw } : null;
  }
  // Months sharing one year: "luglio - agosto 2026", "luglio/agosto 2026", "luglio e agosto 2026".
  const shared = new RegExp(`^(?:dal\\s+)?${MONTH}\\s*(?:-|/|al|a|e)\\s*${MONTH}\\s+(\\d{4})$`, "i").exec(value);
  if (shared) {
    const toYear = Number(shared[3]);
    const fromMonth = MONTHS[shared[1].toLowerCase()]; const toMonth = MONTHS[shared[2].toLowerCase()];
    const from = firstOf(fromMonth > toMonth ? toYear - 1 : toYear, fromMonth);
    const to = nextMonth(toYear, toMonth);
    return from && from < to ? { from, to, raw } : null;
  }
  // Two dates: "01/07/2026 - 31/08/2026", "dal 1 luglio 2026 al 31 agosto 2026".
  const range = /^(?:dal\s+)?(.+?)\s*(?:\s-\s|-(?=\s*\d)|\sal\s|\sa\s)\s*(.+)$/i.exec(value);
  if (range) {
    const from = day(range[1]); const to = day(range[2]);
    if (from && to && from < to) return { from, to, raw };
  }
  return null;
}
