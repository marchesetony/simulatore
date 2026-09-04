import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { ElectricityMonthlyPunRecord, MarketRate } from "../energy/market-data";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createMarketArchive } from "./service.ts";
import type { MarketArchiveRecord, MarketArchiveRepository } from "./types";

export const GME_OFFICIAL_ORIGIN = "https://gme.mercatoelettrico.org/";
export const GME_PUN_INDEX_PUBLICATIONS_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioDel300";
export const GME_PUN_BANDS_PUBLICATIONS_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce";
export type GmePunSourceMode = "GME_API" | "GME_OFFICIAL_PUBLICATION";
export type GmePunImportStatus = "IMPORTED" | "SOURCE_BLOCKED";
export type GmeRecordAction = "CREATED" | "REUSED" | "UPDATED";

export interface GmePunImportResult {
  readonly status: GmePunImportStatus;
  readonly mode: GmePunSourceMode;
  readonly reason: string | null;
  readonly action: GmeRecordAction | null;
  readonly record: MarketArchiveRecord | null;
}

export interface GmeOfficialPublicationInput {
  readonly tenantId: string;
  readonly referenceMonth: string;
  readonly publicationText: string;
  readonly sourceReference: string;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly actor?: string;
}

export interface GmeCompletePublicationInput extends GmeOfficialPublicationInput {
  readonly monthlyPublicationText: string;
  readonly bandsPublicationText: string;
  readonly monthlySourceReference?: string;
  readonly bandsSourceReference?: string;
}

export interface GmeFetcherResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export type GmeFetcher = (input: string, init?: RequestInit) => Promise<GmeFetcherResponse>;

export interface GmePunSourceEnvironment {
  readonly GME_PUN_API_URL?: string;
  readonly GME_PUN_API_KEY?: string;
  readonly GME_PUN_SOURCE_MODE?: string;
}

const monthNames: Readonly<Record<string, number>> = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
const rate = (value: number): MarketRate => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });

export function isAllowedGmeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "gme.mercatoelettrico.org";
  } catch {
    return false;
  }
}

export function assertAllowedGmeUrl(value: string): void {
  if (!isAllowedGmeUrl(value)) throw new Error("GME_SOURCE_DOMAIN_BLOCKED");
}

function parseRate(value: string): number | null {
  const raw = value.trim().replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function referenceMonthMatch(text: string, referenceMonth: string): RegExpExecArray | null {
  const [year, month] = referenceMonth.split("-").map(Number);
  const numeric = new RegExp(`\\b${year}[-/.]0?${month}\\b`, "i").exec(text);
  if (numeric) return numeric;
  const monthName = Object.entries(monthNames).find(([, number]) => number === month)?.[0];
  return monthName ? new RegExp(`\\b${monthName}(?:\\s+|[-/.])${year}\\b`, "i").exec(text) : null;
}

function hasReferenceMonth(text: string, referenceMonth: string): boolean {
  return referenceMonthMatch(text, referenceMonth) !== null;
}

function extractRate(text: string, label: string): number | null {
  const expression = new RegExp(`\\b${label}\\b\\s*[:=]?\\s*([0-9]{1,4}(?:[.,][0-9]{2,6})?)`, "i");
  const match = expression.exec(text);
  return match ? parseRate(match[1]) : null;
}

function extractExplicitBands(text: string): readonly [number, number, number] | null {
  const values = [extractRate(text, "F\\s*1"), extractRate(text, "F\\s*2"), extractRate(text, "F\\s*3")];
  return values.every((value): value is number => value !== null) ? [values[0], values[1], values[2]] : null;
}

function extractBoundedBandRows(text: string, referenceMonth: string): readonly [number, number, number] | null {
  const monthMatch = referenceMonthMatch(text, referenceMonth);
  if (!monthMatch || monthMatch.index === undefined) return null;
  const windowStart = Math.max(0, monthMatch.index - 500);
  const window = text.slice(windowStart, monthMatch.index + monthMatch[0].length + 1200);
  const pairPattern = /\(\s*\d{1,4}\s+ore?s?\s*\)\s*([0-9]{1,4}(?:[.,][0-9]{2,6})?)/gi;
  const pairs = [...window.matchAll(pairPattern)];
  if (pairs.length !== 3 || !/F\s*1[\s\S]*F\s*2[\s\S]*F\s*3/i.test(window.slice(0, pairs[0].index ?? 0))) return null;
  const values = pairs.map((pair) => parseRate(pair[1]));
  return values.every((value): value is number => value !== null) ? [values[0], values[1], values[2]] : null;
}

function hasMwhUnit(text: string): boolean {
  return /(?:EUR|€|â‚¬|euro|Ã¢â€šÂ¬)\s*(?:\/|\s)\s*M(?:Wh|@h)|\/M(?:Wh|@h)|M(?:Wh|@h)\s*(?:\/|,)?\s*(?:EUR|€|â‚¬|euro|Ã¢â€šÂ¬)/i.test(text);
}

function extractLabelledBandRows(text: string, referenceMonth: string): readonly [number, number, number] | null {
  const monthMatch = referenceMonthMatch(text, referenceMonth);
  if (!monthMatch || monthMatch.index === undefined) return null;
  const window = text.slice(monthMatch.index, monthMatch.index + 1800);
  const values: number[] = [];
  for (const label of ["F\\s*1", "F\\s*2", "F\\s*3"]) {
    const next = new RegExp(`\\b${label}\\b(?:\\s*[:=]\\s*([0-9]{1,4}(?:[.,][0-9]{2,6})?)|[\\s\\S]{0,160}?ore?s?[^0-9]{0,30}([0-9]{1,4}(?:[.,][0-9]{2,6})?))`, "i").exec(window);
    if (!next) return null;
    const value = parseRate(next[1] ?? next[2] ?? "");
    if (value === null) return null;
    values.push(value);
  }
  return [values[0], values[1], values[2]];
}

function pdfText(body: Uint8Array): string {
  const raw = Buffer.from(body).toString("latin1");
  const streams: string[] = [];
  for (const match of raw.matchAll(/(?:^|\r?\n)stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const before = raw.slice(Math.max(0, (match.index ?? 0) - 1200), match.index ?? 0);
    const bytes = new Uint8Array([...match[1]].map((char) => char.charCodeAt(0) & 255));
    try { streams.push(Buffer.from(/FlateDecode/.test(before) ? inflateSync(bytes) : bytes).toString("latin1")); } catch { /* non-content streams are ignored */ }
  }
  return streams.flatMap((stream) => [...stream.matchAll(/\(([^()]*)\)/g)].map((match) => match[1])).join(" ");
}

function sourceHash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function publishedPdfText(body: Uint8Array): string {
  const text = pdfText(body);
  if (!text.trim()) throw new Error("GME_PUBLICATION_TEXT_UNAVAILABLE");
  return text;
}

async function fetchOfficialGme(url: string, fetcher: GmeFetcher): Promise<{ readonly url: string; readonly bytes: Uint8Array; readonly contentType: string }> {
  assertAllowedGmeUrl(url);
  const response = await fetcher(url, { redirect: "manual", headers: { Accept: "text/html,application/pdf", "User-Agent": "SimulatoreMarketRefresh/1.0 (official-source-import)" } });
  if (response.status < 200 || response.status >= 300) throw new Error(`GME_HTTP_${response.status}`);
  return { url, bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
}

export async function fetchGmePublicationText(url: string, fetcher: GmeFetcher = fetch as unknown as GmeFetcher): Promise<{ readonly url: string; readonly text: string; readonly sourceSha256: string; readonly contentType: string }> {
  const response = await fetchOfficialGme(url, fetcher);
  return { url: response.url, text: /pdf/i.test(response.contentType) || /\.pdf(?:$|\?)/i.test(response.url) ? publishedPdfText(response.bytes) : new TextDecoder().decode(response.bytes), sourceSha256: sourceHash(response.bytes), contentType: response.contentType };
}

function nextMonth(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
}

export function parseGmeOfficialPublication(input: GmeOfficialPublicationInput): ElectricityMonthlyPunRecord {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(input.referenceMonth)) throw new Error("GME_REFERENCE_MONTH_INVALID");
  assertAllowedGmeUrl(input.sourceReference);
  if (!hasReferenceMonth(input.publicationText, input.referenceMonth)) throw new Error("GME_PUBLICATION_MONTH_MISMATCH");
  if (!hasMwhUnit(input.publicationText)) throw new Error("GME_PUBLICATION_UNIT_MISSING");
  const explicitBands = extractExplicitBands(input.publicationText);
  const boundedBands = explicitBands ?? extractBoundedBandRows(input.publicationText, input.referenceMonth) ?? extractLabelledBandRows(input.publicationText, input.referenceMonth);
  const monthly = extractRate(input.publicationText, "(?:PUN\\s*Index|PUN\\s*mensile|Prezzo\\s*unico|PUN\\s*medio|PUNop(?:[A-Za-z]+20\\d{2})?)");
  const hasBandEvidence = /\bF\s*[123]\b|\(\s*\d{1,4}\s+ore?s?\s*\)/i.test(input.publicationText);
  if (!boundedBands && (hasBandEvidence || monthly === null)) throw new Error("GME_PUBLICATION_VALUES_MISSING");
  const [f1, f2, f3] = boundedBands ?? [null, null, null];
  return {
    schemaVersion: 1,
    recordId: `gme-pun-${input.referenceMonth}`,
    version: "1",
    parentVersionId: null,
    tenantId: input.tenantId,
    recordType: "MONTHLY_MARKET_DATA",
    vector: "EE",
    index: "PUN",
    month: input.referenceMonth,
    ...(f1 === null ? {} : { f1: rate(f1) }),
    ...(f2 === null ? {} : { f2: rate(f2) }),
    ...(f3 === null ? {} : { f3: rate(f3) }),
    ...(monthly === null ? {} : { monthly: rate(monthly) }),
    source: { sourceId: "GME", name: "GME", url: input.sourceReference, authority: "GME", sourceType: "OFFICIAL" },
    approval: { status: "APPROVED", reviewer: input.actor ?? "GME_OFFICIAL_IMPORT", reviewedAt: input.retrievedAt, decisionId: `gme-official-${input.referenceMonth}` },
    publicationDate: input.publishedAt ?? null,
    effectiveFrom: `${input.referenceMonth}-01`,
    effectiveTo: nextMonth(input.referenceMonth),
  };
}

/** Combines the two official GME publications only after parsing every required value. */
export function parseGmeCompletePublication(input: GmeCompletePublicationInput): ElectricityMonthlyPunRecord {
  const monthlyRecord = parseGmeOfficialPublication({ ...input, publicationText: input.monthlyPublicationText, sourceReference: input.monthlySourceReference ?? input.sourceReference });
  const bandsRecord = parseGmeOfficialPublication({ ...input, publicationText: input.bandsPublicationText, sourceReference: input.bandsSourceReference ?? input.sourceReference });
  if (!monthlyRecord.monthly || !bandsRecord.f1 || !bandsRecord.f2 || !bandsRecord.f3) throw new Error("GME_PUBLICATION_VALUES_MISSING");
  const combinedSha256 = createHash("sha256").update(`${input.monthlyPublicationText}\n---GME-BANDS---\n${input.bandsPublicationText}`, "utf8").digest("hex");
  return { ...monthlyRecord, f1: bandsRecord.f1, f2: bandsRecord.f2, f3: bandsRecord.f3, source: { ...monthlyRecord.source, url: input.sourceReference, sourceSha256: combinedSha256, relatedUrls: [input.monthlySourceReference ?? input.sourceReference, input.bandsSourceReference ?? input.sourceReference] }, approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" } };
}

export function marketRateToEurPerKwh(sourceValue: number, sourceUnit: MarketRate["unit"]): { readonly value: number; readonly sourceValue: number; readonly sourceUnit: MarketRate["unit"]; readonly targetUnit: "EUR_PER_KWH" } {
  if (!Number.isFinite(sourceValue)) throw new Error("MARKET_RATE_INVALID");
  if (sourceUnit !== "EUR_PER_MWH") throw new Error("MARKET_RATE_UNIT_UNSUPPORTED");
  return { value: sourceValue / 1000, sourceValue, sourceUnit, targetUnit: "EUR_PER_KWH" };
}

function rateSignature(value: MarketRate | undefined): readonly [number, string, string] | null {
  return value ? [value.value, value.currency, value.unit] : null;
}

export function sameGmeOfficialRecord(left: MarketArchiveRecord["record"], right: MarketArchiveRecord["record"]): boolean {
  const comparable = (value: MarketArchiveRecord["record"]) => {
    const electricity = value.vector === "EE" ? value : null;
    return {
    recordType: value.recordType,
    vector: value.vector,
    index: value.index,
    month: value.month,
    monthly: rateSignature(electricity?.monthly),
    f1: rateSignature(electricity?.f1),
    f2: rateSignature(electricity?.f2),
    f3: rateSignature(electricity?.f3),
    source: { authority: value.source.authority ?? null, sourceType: value.source.sourceType ?? null, url: value.source.url, sourceId: value.source.sourceId, name: value.source.name },
    publicationDate: value.publicationDate,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export class GmePunSourceAdapter {
  readonly mode: GmePunSourceMode;
  private readonly repository: MarketArchiveRepository;
  private readonly environment: GmePunSourceEnvironment;

  constructor(repository: MarketArchiveRepository, environment: GmePunSourceEnvironment = process.env as GmePunSourceEnvironment) {
    this.repository = repository;
    this.environment = environment;
    this.mode = environment.GME_PUN_API_URL && environment.GME_PUN_API_KEY ? "GME_API" : "GME_OFFICIAL_PUBLICATION";
  }

  async importOfficialPublication(input: GmeOfficialPublicationInput): Promise<GmePunImportResult> {
    if (this.mode === "GME_API") return { status: "SOURCE_BLOCKED", mode: this.mode, reason: "GME_API_ADAPTER_REQUIRES_EXPLICIT_RESPONSE_MAPPING", action: null, record: null };
    if (this.environment.GME_PUN_SOURCE_MODE === "GME_API") return { status: "SOURCE_BLOCKED", mode: "GME_API", reason: "GME_API_CREDENTIALS_NOT_CONFIGURED", action: null, record: null };
    try {
      const parsed = parseGmeOfficialPublication(input);
      const existing = await this.repository.get(input.tenantId, parsed.recordId);
      if (existing) {
        if (existing.status === "APPROVED" && sameGmeOfficialRecord(existing.record, parsed)) return { status: "IMPORTED", mode: "GME_OFFICIAL_PUBLICATION", reason: null, action: "REUSED", record: existing };
        throw new Error("GME_RECORD_CONFLICT");
      }
      const record = await createMarketArchive(this.repository, { tenantId: input.tenantId, record: parsed, archiveId: parsed.recordId, now: input.retrievedAt, actor: input.actor ?? "GME_OFFICIAL_IMPORT" });
      return { status: "IMPORTED", mode: "GME_OFFICIAL_PUBLICATION", reason: null, action: "CREATED", record };
    } catch (error) {
      return { status: "SOURCE_BLOCKED", mode: "GME_OFFICIAL_PUBLICATION", reason: error instanceof Error ? error.message : "GME_PUBLICATION_IMPORT_FAILED", action: null, record: null };
    }
  }
}
