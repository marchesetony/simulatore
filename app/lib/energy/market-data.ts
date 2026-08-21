import type { ApprovalMetadata, VersionMetadata } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertApprovalMetadata, assertEffectivePeriod, assertVersionMetadata, EnergyContractValidationError } from "./validation.ts";

export type MarketDataSource = {
  readonly sourceId: string;
  readonly name: string;
  readonly url: string;
  readonly authority?: "GME";
  readonly sourceType?: "OFFICIAL";
};

export type MarketRate = {
  readonly value: number;
  readonly currency: "EUR";
  readonly unit: "EUR_PER_MWH" | "EUR_PER_SMC";
};

export interface MonthlyMarketDataBase extends VersionMetadata {
  readonly recordType: "MONTHLY_MARKET_DATA";
  readonly publicationDate: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly source: MarketDataSource;
}

export interface ElectricityMonthlyPunRecord extends MonthlyMarketDataBase {
  readonly vector: "EE";
  readonly index: "PUN";
  readonly month: string;
  readonly f1?: MarketRate;
  readonly f2?: MarketRate;
  readonly f3?: MarketRate;
  readonly monthly?: MarketRate;
}

export interface GasMonthlyPsvRecord extends MonthlyMarketDataBase {
  readonly vector: "GAS";
  readonly index: "PSV";
  readonly month: string;
  readonly value: MarketRate;
}

export type MonthlyMarketDataRecord = ElectricityMonthlyPunRecord | GasMonthlyPsvRecord;

const fail = (code: string): never => { throw new EnergyContractValidationError(code); };
const record = (value: unknown, code: string): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);
const nonEmpty = (value: unknown, code: string): string => typeof value === "string" && value.trim() ? value as string : fail(code);
const dateOnly = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code);
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) fail(code);
  return value as string;
};
const month = (value: unknown): string => typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : fail("MARKET_MONTH_INVALID");
const nextMonth = (value: string): string => {
  const [year, monthNumber] = value.split("-").map((part) => Number.parseInt(part, 10));
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return next.toISOString().slice(0, 10);
};

function assertSource(value: unknown): asserts value is MarketDataSource {
  const item = record(value, "MARKET_SOURCE_INVALID");
  nonEmpty(item.sourceId, "MARKET_SOURCE_INVALID");
  nonEmpty(item.name, "MARKET_SOURCE_INVALID");
  const url = nonEmpty(item.url, "MARKET_SOURCE_INVALID");
  if (!/^https:\/\//.test(url)) fail("MARKET_SOURCE_INVALID");
  if (item.authority !== undefined && item.authority !== "GME") fail("MARKET_SOURCE_INVALID");
  if (item.sourceType !== undefined && item.sourceType !== "OFFICIAL") fail("MARKET_SOURCE_INVALID");
}

function assertRate(value: unknown, unit: MarketRate["unit"]): asserts value is MarketRate {
  const item = record(value, "MARKET_RATE_INVALID");
  if (typeof item.value !== "number" || !Number.isFinite(item.value)) fail("MARKET_RATE_INVALID");
  if (item.currency !== "EUR" || item.unit !== unit) fail("MARKET_RATE_UNIT_INVALID");
}

function assertBase(value: unknown): Record<string, unknown> {
  assertVersionMetadata(value);
  const item = value as unknown as Record<string, unknown>;
  if (item.recordType !== "MONTHLY_MARKET_DATA") fail("RECORD_TYPE_INVALID");
  if (item.publicationDate !== null) dateOnly(item.publicationDate, "PUBLICATION_DATE_INVALID");
  assertEffectivePeriod({ effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo });
  assertSource(item.source);
  return item;
}

function assertApproval(value: ApprovalMetadata): void {
  assertApprovalMetadata(value);
}

export function validateElectricityMonthlyPun(value: unknown): asserts value is ElectricityMonthlyPunRecord {
  const item = assertBase(value);
  if (item.vector !== "EE" || item.index !== "PUN") fail("MARKET_VECTOR_INDEX_MISMATCH");
  if (Object.prototype.hasOwnProperty.call(item, "value")) fail("EE_SCHEMA_MIXED");
  const marketMonth = month(item.month);
  if (item.f1 !== undefined) assertRate(item.f1, "EUR_PER_MWH");
  if (item.f2 !== undefined) assertRate(item.f2, "EUR_PER_MWH");
  if (item.f3 !== undefined) assertRate(item.f3, "EUR_PER_MWH");
  if (item.monthly !== undefined) assertRate(item.monthly, "EUR_PER_MWH");
  if (item.f1 === undefined && item.f2 === undefined && item.f3 === undefined && item.monthly === undefined) fail("MARKET_VALUES_MISSING");
  assertApproval(item.approval as ApprovalMetadata);
  if (item.effectiveFrom !== `${marketMonth}-01` || item.effectiveTo !== nextMonth(marketMonth)) fail("MARKET_PERIOD_MISMATCH");
}

export function validateGasMonthlyPsv(value: unknown): asserts value is GasMonthlyPsvRecord {
  const item = assertBase(value);
  if (item.vector !== "GAS" || item.index !== "PSV") fail("MARKET_VECTOR_INDEX_MISMATCH");
  const marketMonth = month(item.month);
  assertRate(item.value, "EUR_PER_SMC");
  assertApproval(item.approval as ApprovalMetadata);
  if (item.effectiveFrom !== `${marketMonth}-01` || item.effectiveTo !== nextMonth(marketMonth)) fail("MARKET_PERIOD_MISMATCH");
  if (Object.prototype.hasOwnProperty.call(item, "f1") || Object.prototype.hasOwnProperty.call(item, "f2") || Object.prototype.hasOwnProperty.call(item, "f3")) fail("GAS_SCHEMA_MIXED");
}

export function validateMonthlyMarketData(value: unknown): asserts value is MonthlyMarketDataRecord {
  const item = record(value, "RECORD_INVALID");
  if (item.vector === "EE") validateElectricityMonthlyPun(value);
  else if (item.vector === "GAS") validateGasMonthlyPsv(value);
  else fail("VECTOR_INVALID");
}
