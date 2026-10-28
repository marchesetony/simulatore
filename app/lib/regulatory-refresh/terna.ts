import { createHash } from "node:crypto";
import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { discoverTernaCorrispettiviEndpoints, importTernaCapacityQuarter, importTernaTideQuarter, ternaQuarterFor, type TernaCapacityQuarterImport, type TernaFetcher, type TernaQuarter } from "../foundation/terna-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { applyRegulatoryRefreshCandidate, type RegulatoryRefreshDependencies } from "./service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { TERNA_CAPACITY_DOMAINS, TERNA_TIDE_DOMAIN } from "./registry.ts";

export interface TernaCapacitySourceReader {
  load(input: { readonly tenantId: string; readonly retrievedAt: string; readonly quarters: readonly TernaQuarter[] }): Promise<readonly ({ readonly quarter: TernaQuarter } & ({ readonly import: TernaCapacityQuarterImport } | { readonly error: string }))[]>;
}

export function createTernaCapacitySourceReader(input: { readonly fetcher?: TernaFetcher } = {}): TernaCapacitySourceReader {
  return {
    async load({ tenantId, retrievedAt, quarters }) {
      const discovery = await discoverTernaCorrispettiviEndpoints(input.fetcher);
      const results = [];
      for (const quarter of quarters) {
        try { results.push({ quarter, import: await importTernaCapacityQuarter({ tenantId, retrievedAt, quarter, fetcher: input.fetcher, discovery }) }); }
        catch (error) { results.push({ quarter, error: error instanceof Error ? error.message : "TERNA_CAPACITY_IMPORT_FAILED" }); }
      }
      return results;
    },
  };
}

export interface TernaCapacityRefreshSummary {
  readonly status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  readonly quarters: readonly { readonly quarter: string; readonly status: "IMPORTED" | "NOT_PUBLISHED" | "FAILED"; readonly sourceReference?: string; readonly values?: Readonly<Record<string, number>>; readonly error?: string }[];
  readonly createdCount: number;
  readonly unchangedCount: number;
  readonly replacedCount: number;
  readonly errors: readonly string[];
}

const quarterLabel = (quarter: TernaQuarter): string => `${quarter.year}Q${quarter.quarter}`;

/**
 * Keeps Terna's capacity-market charges current: the quarter in force must be
 * published, the next one is taken as soon as Terna publishes it.
 */
export async function runTernaCapacityRefresh(input: { readonly tenantId: string; readonly sourceReader?: TernaCapacitySourceReader } & RegulatoryRefreshDependencies): Promise<TernaCapacityRefreshSummary> {
  const now = new Date(input.now ?? new Date().toISOString()).toISOString();
  const runId = input.runId ?? `terna_${createHash("sha256").update(`${input.tenantId}|${input.trigger ?? "MANUAL"}|${now}`).digest("hex").slice(0, 40)}`;
  const current = ternaQuarterFor(now);
  const next = ternaQuarterFor(now, 1);
  const reader = input.sourceReader ?? createTernaCapacitySourceReader();
  let loaded: Awaited<ReturnType<TernaCapacitySourceReader["load"]>>;
  try { loaded = await reader.load({ tenantId: input.tenantId, retrievedAt: now, quarters: [current, next] }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "TERNA_CAPACITY_SOURCE_FAILED";
    return { status: "FAILED", quarters: [current, next].map((quarter) => ({ quarter: quarterLabel(quarter), status: "FAILED" as const, error: message })), createdCount: 0, unchangedCount: 0, replacedCount: 0, errors: [message] };
  }
  const errors: string[] = [];
  const quarters: TernaCapacityRefreshSummary["quarters"][number][] = [];
  let createdCount = 0; let unchangedCount = 0; let replacedCount = 0;
  for (const entry of loaded) {
    const label = quarterLabel(entry.quarter);
    const isCurrent = label === quarterLabel(current);
    if ("error" in entry) {
      // Terna publishes the next quarter shortly before it starts: its absence is expected, not a failure.
      const notPublished = entry.error === "TERNA_CAPACITY_DOCUMENT_NOT_PUBLISHED";
      quarters.push({ quarter: label, status: notPublished ? "NOT_PUBLISHED" : "FAILED", error: entry.error });
      if (isCurrent || !notPublished) errors.push(`${label}:${entry.error}`);
      continue;
    }
    const values: Record<string, number> = {};
    try {
      for (const record of entry.import.records) {
        const domain = TERNA_CAPACITY_DOMAINS.find((item) => item.componentCode === record.componentCode && item.customerScope === record.customerScope && item.normalizedUnit === record.normalizedUnit && item.regulatoryVariant === record.regulatoryVariant);
        if (!domain) throw new Error(`TERNA_CAPACITY_DOMAIN_UNREGISTERED:${record.componentCode}|${record.customerScope}|${record.normalizedUnit}`);
        const result = await applyRegulatoryRefreshCandidate(domain, record as RegulatoryValueRecord, input, input.tenantId, runId, now);
        createdCount += result.created; unchangedCount += result.unchanged; replacedCount += result.replaced;
        values[record.componentCode] = record.originalValue;
      }
      quarters.push({ quarter: label, status: "IMPORTED", sourceReference: entry.import.document.url, values });
    } catch (error) {
      const message = error instanceof Error ? error.message : "TERNA_CAPACITY_SAVE_FAILED";
      quarters.push({ quarter: label, status: "FAILED", error: message });
      errors.push(`${label}:${message}`);
    }
  }
  const status = errors.length === 0 ? "SUCCESS" : quarters.some((item) => item.status === "IMPORTED") ? "PARTIAL_FAILURE" : "FAILED";
  return { status, quarters, createdCount, unchangedCount, replacedCount, errors };
}

export interface TernaTideSourceReader {
  load(input: { readonly tenantId: string; readonly retrievedAt: string; readonly quarters: readonly TernaQuarter[] }): Promise<readonly ({ readonly quarter: TernaQuarter } & ({ readonly records: readonly RegulatoryValueRecord[]; readonly url: string } | { readonly error: string }))[]>;
}

export function createTernaTideSourceReader(input: { readonly fetcher?: TernaFetcher } = {}): TernaTideSourceReader {
  return {
    async load({ tenantId, retrievedAt, quarters }) {
      const discovery = await discoverTernaCorrispettiviEndpoints(input.fetcher);
      const results = [];
      for (const quarter of quarters) {
        try { const imported = await importTernaTideQuarter({ tenantId, retrievedAt, quarter, fetcher: input.fetcher, discovery }); results.push({ quarter, records: imported.records, url: imported.document.url }); }
        catch (error) { results.push({ quarter, error: error instanceof Error ? error.message : "TERNA_TIDE_IMPORT_FAILED" }); }
      }
      return results;
    },
  };
}

/** Keeps Terna's TIDE dispatching charge current, like the capacity charges: the quarter in force must be published
 *  (Tony, 28/10: "il valore terna lo abbiamo ... controlla"). */
export async function runTernaDispatchingRefresh(input: { readonly tenantId: string; readonly tideSourceReader?: TernaTideSourceReader } & RegulatoryRefreshDependencies): Promise<TernaCapacityRefreshSummary> {
  const now = new Date(input.now ?? new Date().toISOString()).toISOString();
  const runId = input.runId ?? `terna_tide_${createHash("sha256").update(`${input.tenantId}|${input.trigger ?? "MANUAL"}|${now}`).digest("hex").slice(0, 36)}`;
  const current = ternaQuarterFor(now); const next = ternaQuarterFor(now, 1);
  let loaded: Awaited<ReturnType<TernaTideSourceReader["load"]>>;
  try { loaded = await (input.tideSourceReader ?? createTernaTideSourceReader()).load({ tenantId: input.tenantId, retrievedAt: now, quarters: [current, next] }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "TERNA_TIDE_SOURCE_FAILED";
    return { status: "FAILED", quarters: [current, next].map((quarter) => ({ quarter: quarterLabel(quarter), status: "FAILED" as const, error: message })), createdCount: 0, unchangedCount: 0, replacedCount: 0, errors: [message] };
  }
  const errors: string[] = []; const quarters: TernaCapacityRefreshSummary["quarters"][number][] = [];
  let createdCount = 0; let unchangedCount = 0; let replacedCount = 0;
  for (const entry of loaded) {
    const label = quarterLabel(entry.quarter);
    if ("error" in entry) {
      const notPublished = entry.error === "TERNA_TIDE_DOCUMENT_NOT_PUBLISHED";
      quarters.push({ quarter: label, status: notPublished ? "NOT_PUBLISHED" : "FAILED", error: entry.error });
      if (label === quarterLabel(current) || !notPublished) errors.push(`${label}:${entry.error}`);
      continue;
    }
    try {
      const values: Record<string, number> = {};
      for (const record of entry.records) {
        const result = await applyRegulatoryRefreshCandidate(TERNA_TIDE_DOMAIN, record, input, input.tenantId, runId, now);
        createdCount += result.created; unchangedCount += result.unchanged; replacedCount += result.replaced;
        values[record.componentCode] = record.originalValue;
      }
      quarters.push({ quarter: label, status: "IMPORTED", sourceReference: entry.url, values });
    } catch (error) { const message = error instanceof Error ? error.message : "TERNA_TIDE_SAVE_FAILED"; quarters.push({ quarter: label, status: "FAILED", error: message }); errors.push(`${label}:${message}`); }
  }
  const status = errors.length === 0 ? "SUCCESS" : quarters.some((item) => item.status === "IMPORTED") ? "PARTIAL_FAILURE" : "FAILED";
  return { status, quarters, createdCount, unchangedCount, replacedCount, errors };
}
