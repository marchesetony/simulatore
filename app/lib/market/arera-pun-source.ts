import { createHash } from "node:crypto";
import type { ElectricityMonthlyPunRecord, MarketRate } from "../energy/market-data.ts";

export const ARERA_PUN_PLACET_PAGE = "https://www.arera.it/consumatori/offerte-standard-per-i-clienti-finali-placet";
const monthNames: Readonly<Record<number, string>> = { 1: "gennaio", 2: "febbraio", 3: "marzo", 4: "aprile", 5: "maggio", 6: "giugno", 7: "luglio", 8: "agosto", 9: "settembre", 10: "ottobre", 11: "novembre", 12: "dicembre" };

export interface AreraPunPublicationInput {
  readonly tenantId: string;
  readonly referenceMonth: string;
  readonly publicationText: string;
  readonly sourceReference: string;
  readonly publishedAt?: string | null;
  readonly retrievedAt: string;
}

function allowedAreraUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && (url.hostname.toLowerCase() === "arera.it" || url.hostname.toLowerCase() === "www.arera.it"); } catch { return false; }
}

export function isAllowedAreraPunUrl(value: string): boolean { return allowedAreraUrl(value); }
function parseNumber(value: string): number | null { const raw = value.trim().replace(/\s/g, ""); const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw; const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : null; }
function monthLabel(referenceMonth: string): string { const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(referenceMonth); if (!match) throw new Error("ARERA_PUN_REFERENCE_MONTH_INVALID"); return `${monthNames[Number(match[2])]} ${match[1]}`; }
function clean(value: string): string { return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function toMwh(value: number): MarketRate { return { value: value * 1000, currency: "EUR", unit: "EUR_PER_MWH" }; }
function valuesAfterMonth(text: string, heading: RegExp, referenceMonth: string, count: number): number[] {
  const label = monthLabel(referenceMonth);
  const section = heading.exec(text);
  if (!section || section.index === undefined) throw new Error("ARERA_PUN_SECTION_MISSING");
  const tail = text.slice(section.index, section.index + 900);
  const match = new RegExp(`${label.replace(" ", "\\s+")}[^0-9]{0,50}((?:[0-9]{1,4}[.,][0-9]{2,6}[^0-9]*){${count}})`, "i").exec(tail);
  if (!match) throw new Error("ARERA_PUN_VALUES_MISSING");
  const values = [...match[1].matchAll(/[0-9]{1,4}(?:[.,][0-9]{2,6})?/g)].map((item) => parseNumber(item[0])).filter((item): item is number => item !== null);
  if (values.length !== count) throw new Error("ARERA_PUN_VALUES_AMBIGUOUS");
  return values;
}

export function parseAreraPunPublication(input: AreraPunPublicationInput): ElectricityMonthlyPunRecord {
  if (!allowedAreraUrl(input.sourceReference)) throw new Error("ARERA_SOURCE_DOMAIN_BLOCKED");
  const text = clean(input.publicationText);
  const month = monthLabel(input.referenceMonth);
  if (!new RegExp(`\\b${month.replace(" ", "\\s+")}\\b`, "i").test(text)) throw new Error("ARERA_PUN_PUBLICATION_MONTH_MISMATCH");
  const monthly = valuesAfterMonth(text, /P_ING\s*[_\{]?\s*M[^a-z]{0,30}monorario/i, input.referenceMonth, 1)[0];
  const bands = valuesAfterMonth(text, /P_ING\s*[_\{]?\s*M[^a-z]{0,30}per fasce/i, input.referenceMonth, 3);
  const sourceSha256 = createHash("sha256").update(input.publicationText, "utf8").digest("hex");
  return {
    schemaVersion: 1,
    recordId: `arera-pun-${input.referenceMonth}`,
    version: "1",
    parentVersionId: null,
    tenantId: input.tenantId,
    recordType: "MONTHLY_MARKET_DATA",
    vector: "EE",
    index: "PUN",
    month: input.referenceMonth,
    monthly: toMwh(monthly),
    f1: toMwh(bands[0]),
    f2: toMwh(bands[1]),
    f3: toMwh(bands[2]),
    source: { sourceId: "ARERA", name: "ARERA PLACET", url: input.sourceReference, authority: "ARERA", sourceType: "OFFICIAL", sourceSha256 },
    approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" },
    publicationDate: input.publishedAt ?? null,
    effectiveFrom: `${input.referenceMonth}-01`,
    effectiveTo: nextMonth(input.referenceMonth),
  };
}

function nextMonth(month: string): string { const [year, monthNumber] = month.split("-").map(Number); return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10); }
