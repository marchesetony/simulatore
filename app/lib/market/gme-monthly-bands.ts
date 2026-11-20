import type { ElectricityMonthlyPunRecord } from "../energy/market-data.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { GME_PUN_BANDS_PUBLICATIONS_PAGE, assertAllowedGmeUrl, fetchGmePublicationText, type GmeFetcher } from "./gme-pun-source.ts";

// Tony (6/11): "il pun deve essere a fasce o monorario e va prelevato il dato mensile non il giornaliero". The PUN of a month is
// read from GME's monthly publication "Prezzo medio per fasce" (one PDF a month: F1, F2, F3 in €/MWh with their hours). The
// monorario is the same month's average over all hours: the hours-weighted mean of the three bands (GME's own definition).
export const GME_MONTHLY_BANDS_SOURCE_ID = "GME_PREZZO_MEDIO_FASCE";
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const fail = (code: string): never => { throw new Error(code); };
const rate = (value: number) => ({ value, currency: "EUR" as const, unit: "EUR_PER_MWH" as const });
const nextMonth = (month: string): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
const monthLabel = (referenceMonth: string): string => `${MONTHS[Number(referenceMonth.slice(5, 7)) - 1]}\\s*${referenceMonth.slice(0, 4)}`;

/** The PDF link of the month on the "Prezzo medio per fasce" page. */
export function findGmeMonthlyBandsPdf(html: string, referenceMonth: string, baseUrl = GME_PUN_BANDS_PUBLICATIONS_PAGE): string {
  const label = new RegExp(`prezzo\\s*medio\\s*per\\s*fasce\\s*[-–]?\\s*${monthLabel(referenceMonth)}`, "i");
  const fileLabel = new RegExp(`prezzomedioperfasce${MONTHS[Number(referenceMonth.slice(5, 7)) - 1]}${referenceMonth.slice(0, 4)}\\.pdf`, "i");
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (!label.test(text) && !fileLabel.test(match[1])) continue;
    const url = new URL(match[1].replace(/&amp;/g, "&"), baseUrl).toString();
    assertAllowedGmeUrl(url);
    if (/\.pdf(?:$|\?)/i.test(url)) return url;
  }
  return fail(`GME_MONTHLY_BANDS_PDF_NOT_FOUND:${referenceMonth}`);
}

/** F1, F2, F3 with their hours from the publication text; the hours must add up to the month. */
export function parseGmeMonthlyBandsText(text: string, referenceMonth: string): { readonly f1: number; readonly f2: number; readonly f3: number; readonly monthly: number; readonly hours: readonly [number, number, number] } {
  const flat = text.replace(/\s+/g, " ");
  if (!new RegExp(monthLabel(referenceMonth), "i").test(flat)) fail("GME_MONTHLY_BANDS_MONTH_MISMATCH");
  if (!/€\s*\/\s*MWh|EUR\s*\/\s*MWh/i.test(flat)) fail("GME_MONTHLY_BANDS_UNIT_MISSING");
  const number = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));
  let rows = [...flat.matchAll(/\(\s*(\d{1,4})\s*ore\s*\)\s*(\d{1,4}(?:\.\d{3})*,\d{1,6})/gi)].map((match) => ({ hours: Number(match[1]), price: number(match[2]) }));
  // The PDF text may put the price before its hours.
  if (rows.length !== 3) rows = [...flat.matchAll(/(\d{1,4}(?:\.\d{3})*,\d{1,6})\s*\(\s*(\d{1,4})\s*ore\s*\)/gi)].map((match) => ({ hours: Number(match[2]), price: number(match[1]) }));
  if (rows.length !== 3) fail(`GME_MONTHLY_BANDS_VALUES_MISSING:${rows.length}`);
  const days = new Date(Date.UTC(Number(referenceMonth.slice(0, 4)), Number(referenceMonth.slice(5, 7)), 0)).getUTCDate();
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  // Daylight saving adds or removes one hour in March and October.
  if (Math.abs(totalHours - days * 24) > 1) fail(`GME_MONTHLY_BANDS_HOURS_INVALID:${totalHours}`);
  if (rows.some((row) => !Number.isFinite(row.price) || row.price <= 0 || row.price >= 5000)) fail("GME_MONTHLY_BANDS_PRICE_INVALID");
  const monthly = rows.reduce((sum, row) => sum + row.hours * row.price, 0) / totalHours;
  return { f1: rows[0].price, f2: rows[1].price, f3: rows[2].price, monthly, hours: [rows[0].hours, rows[1].hours, rows[2].hours] };
}

export async function loadGmeMonthlyBandsRecord(input: { readonly tenantId: string; readonly referenceMonth: string; readonly retrievedAt: string; readonly fetcher?: GmeFetcher; readonly pageHtml?: string }): Promise<ElectricityMonthlyPunRecord> {
  const fetcher = input.fetcher ?? (fetch as unknown as GmeFetcher);
  const html = input.pageHtml ?? (await fetchGmePublicationText(GME_PUN_BANDS_PUBLICATIONS_PAGE, fetcher)).text;
  const pdfUrl = findGmeMonthlyBandsPdf(html, input.referenceMonth);
  const publication = await fetchGmePublicationText(pdfUrl, fetcher);
  const values = parseGmeMonthlyBandsText(publication.text, input.referenceMonth);
  return {
    schemaVersion: 1, recordId: `gme-pun-${input.referenceMonth}`, version: "1", parentVersionId: null, tenantId: input.tenantId,
    recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month: input.referenceMonth,
    monthly: rate(values.monthly), f1: rate(values.f1), f2: rate(values.f2), f3: rate(values.f3),
    source: { sourceId: GME_MONTHLY_BANDS_SOURCE_ID, name: "GME Prezzo medio per fasce (mensile)", url: pdfUrl, authority: "GME", sourceType: "OFFICIAL", sourceSha256: publication.sourceSha256, relatedUrls: [GME_PUN_BANDS_PUBLICATIONS_PAGE, pdfUrl] },
    approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" }, publicationDate: null, effectiveFrom: `${input.referenceMonth}-01`, effectiveTo: nextMonth(input.referenceMonth),
  } as ElectricityMonthlyPunRecord;
}
