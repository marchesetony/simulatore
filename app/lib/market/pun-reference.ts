import type { PublicBillDocument } from "../foundation/real-bill";
import type { StructuredBillExtraction } from "../ingestion/structured-bill";
import type { MarketArchiveRecord, MarketArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { compareMarketVersions } from "./service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildBillAnalystReview } from "../foundation/bill-analyst-review.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { attachBillRegulatoryAudit } from "../foundation/bill-public-audit.ts";

export type PunTariffStructure = "MONO" | "F1_F2_F3";

export interface InvoicePunReference {
  readonly referenceMonth: string;
  readonly pricingMode: PunTariffStructure;
  readonly monthly: number | null;
  readonly f1: number | null;
  readonly f2: number | null;
  readonly f3: number | null;
  readonly unit: "EUR_PER_MWH";
  readonly authority: "GME" | "ARERA";
  readonly sourceType: "OFFICIAL";
  readonly sourceReference: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string | null;
  readonly status: "AVAILABLE" | "UNAVAILABLE";
  readonly billAppliedPun: number | null;
  readonly spread: number | null;
  readonly difference: number | null;
  readonly differencePercent: number | null;
}

export type OfficialPunModel = readonly InvoicePunReference[];

export interface OfficialPunBillInput {
  readonly tenantId: string;
  readonly vector: "EE" | "GAS" | "UNKNOWN";
  readonly billingPeriod: { readonly periodStart: string | null; readonly periodEnd: string | null } | null;
  readonly structure: PunTariffStructure;
}

const unavailableUnit = "EUR_PER_MWH" as const;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function monthOf(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? `${match[1]}-${match[2]}` : null;
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
}

export function deriveInvoiceReferenceMonths(period: OfficialPunBillInput["billingPeriod"]): readonly string[] {
  if (!period?.periodStart || !period.periodEnd || period.periodStart >= period.periodEnd) return [];
  const start = monthOf(period.periodStart);
  const end = monthOf(period.periodEnd);
  if (!start || !end) return [];
  const endDay = Number(period.periodEnd.slice(8, 10));
  const exclusiveEnd = endDay === 1 ? end : nextMonth(end);
  const result: string[] = [];
  for (let month = start; month < exclusiveEnd; month = nextMonth(month)) result.push(month);
  return result;
}

function isOfficialPunSource(record: MarketArchiveRecord): boolean {
  const source = record.record.source;
  if (source.authority !== undefined && source.authority !== "GME" && source.authority !== "ARERA") return false;
  if (source.sourceType !== undefined && source.sourceType !== "OFFICIAL") return false;
  let hostname = "";
  try { hostname = new URL(source.url).hostname.toLowerCase(); } catch { return false; }
  const authority = source.authority ?? (hostname === "gme.mercatoelettrico.org" ? "GME" : hostname === "arera.it" || hostname === "www.arera.it" ? "ARERA" : null);
  const namedOfficial = authority === "GME" ? [source.sourceId, source.name].some((value) => /\bGME\b/i.test(value)) : authority === "ARERA" ? [source.sourceId, source.name].some((value) => /\bARERA\b/i.test(value)) : false;
  return namedOfficial && ((authority === "GME" && hostname === "gme.mercatoelettrico.org") || (authority === "ARERA" && (hostname === "arera.it" || hostname === "www.arera.it")));
}

function unavailableReference(referenceMonth: string, pricingMode: PunTariffStructure): InvoicePunReference {
  return { referenceMonth, pricingMode, monthly: null, f1: null, f2: null, f3: null, unit: unavailableUnit, authority: "GME", sourceType: "OFFICIAL", sourceReference: null, publishedAt: null, retrievedAt: null, status: "UNAVAILABLE", billAppliedPun: null, spread: null, difference: null, differencePercent: null };
}

function availableReference(record: MarketArchiveRecord, pricingMode: PunTariffStructure): InvoicePunReference | null {
  const market = record.record;
  if (market.vector !== "EE" || market.index !== "PUN") return null;
  if (pricingMode === "MONO" && (!market.monthly || !finite(market.monthly.value))) return null;
  if (pricingMode === "F1_F2_F3" && ![market.f1, market.f2, market.f3].every((rate) => rate && finite(rate.value))) return null;
  return {
    referenceMonth: record.month,
    pricingMode,
    monthly: pricingMode === "MONO" ? market.monthly?.value ?? null : null,
    f1: pricingMode === "F1_F2_F3" ? market.f1?.value ?? null : null,
    f2: pricingMode === "F1_F2_F3" ? market.f2?.value ?? null : null,
    f3: pricingMode === "F1_F2_F3" ? market.f3?.value ?? null : null,
    unit: "EUR_PER_MWH",
    authority: market.source.authority === "ARERA" ? "ARERA" : "GME",
    sourceType: "OFFICIAL",
    sourceReference: market.source.url,
    publishedAt: market.publicationDate,
    retrievedAt: record.updatedAt,
    status: "AVAILABLE",
    billAppliedPun: null,
    spread: null,
    difference: null,
    differencePercent: null,
  };
}

export async function resolveOfficialPunForBill(repository: MarketArchiveRepository, input: OfficialPunBillInput): Promise<OfficialPunModel> {
  const months = deriveInvoiceReferenceMonths(input.billingPeriod);
  if (input.vector !== "EE" || months.length === 0) return [];
  const records = await repository.list(input.tenantId);
  return months.map((month) => {
    const candidates = records.filter((record) => record.status === "APPROVED" && record.month === month && record.vector === "EE" && record.index === "PUN" && isOfficialPunSource(record) && availableReference(record, input.structure) !== null).sort(compareMarketVersions);
    return candidates.length === 0 ? unavailableReference(month, input.structure) : availableReference(candidates[0], input.structure) ?? unavailableReference(month, input.structure);
  });
}

function structureFromExtraction(extraction: StructuredBillExtraction | null): PunTariffStructure {
  return extraction && [extraction.f1Consumption, extraction.f2Consumption, extraction.f3Consumption].every((field) => field.status === "FOUND") ? "F1_F2_F3" : "MONO";
}

export function officialPunInputFromPublicBill(document: Pick<PublicBillDocument, "tenantId" | "resolvedVector" | "normalized" | "structuredBill">): OfficialPunBillInput {
  const structuredPeriod = document.structuredBill?.billingPeriod.status === "FOUND" ? document.structuredBill.billingPeriod.value : null;
  const profilePeriod = document.normalized?.billingPeriod ?? null;
  return { tenantId: document.tenantId, vector: document.resolvedVector, billingPeriod: structuredPeriod ? { periodStart: structuredPeriod.from, periodEnd: structuredPeriod.to } : profilePeriod, structure: structureFromExtraction(document.structuredBill) };
}

export async function attachOfficialPun(document: PublicBillDocument, repository: MarketArchiveRepository): Promise<PublicBillDocument> {
  const invoicePunReferences = await resolveOfficialPunForBill(repository, officialPunInputFromPublicBill(document));
  const next = { ...document, invoicePunReferences };
  const rebuiltReview = buildBillAnalystReview(next);
  const billingAddress = document.analystReview.receipt.billingAddress;
  const reviewed = { ...next, analystReview: { ...rebuiltReview, receipt: { ...rebuiltReview.receipt, billingAddress: billingAddress.status === "FOUND" ? billingAddress : rebuiltReview.receipt.billingAddress } } };
  return attachBillRegulatoryAudit(reviewed);
}
