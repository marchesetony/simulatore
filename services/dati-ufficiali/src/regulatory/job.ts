import { runRegulatoryRefresh } from "../../../../app/lib/regulatory-refresh/service";
import { createAreraRegulatorySourceReader } from "../../../../app/lib/regulatory-refresh/arera";
import { createAreraCapacitySourceReader, runAreraCapacityRefresh } from "../../../../app/lib/regulatory-refresh/arera-capacity";
import { createTernaCapacitySourceReader, createTernaTideSourceReader, runTernaCapacityRefresh, runTernaDispatchingRefresh } from "../../../../app/lib/regulatory-refresh/terna";
import type { AreraFetcher } from "../../../../app/lib/foundation/arera-electricity-regulatory";
import type { TernaFetcher } from "../../../../app/lib/foundation/terna-electricity-regulatory";
import { createServiceStore, memoryBackend, type ServiceStore } from "../store";
import type { FetchedDocument, OfficialFetch } from "../official-fetch";
import { conserveDocument } from "../documents";
import { raiseAnomaly, recordCheck, resolveAnomaly, type ServiceMode } from "../status";
import { SERVICE_IDENTITY } from "../identity";

/**
 * ARERA and Terna (Tony 21/11/2026): the existing verified readers (TIT, ASOS, ARIM, UC, CDISPD; capacity TIV; Terna TIDE and
 * capacity), the same validity dates read from the documents, the same versioning and approval domains, but run by the service
 * with its technical identity and with every downloaded official file conserved with its SHA-256. In a dry run the regulatory
 * refresh is read-only and Terna/capacity write into a throw-away memory copy, never into the real archive.
 */
const shadowRepositories = (store: ServiceStore) => ({
  regulatoryValues: store.writable("regulatory-values"),
  approvalDomains: store.writable("regulatory-approval-domains"),
  auditEvents: store.writable("audit-events"),
  regulatoryRefreshState: store.writable("regulatory-refresh-state"),
  regulatoryRefreshRuns: store.writable("regulatory-refresh-runs"),
});

export interface RegulatoryTenantResult { readonly tenantId: string; readonly arera: string; readonly capacity: string; readonly terna: string; readonly tide: string; readonly errors: readonly string[] }
/** Which half of the job runs: both (the daily cron), only ARERA or only Terna (manual command from the Control Room, Tony 23/11). */
export type RegulatoryScope = "arera" | "terna" | null;
/** A value read in this run, as written into the archive (publication) or into the throw-away copy (test mode). */
export interface AcquiredRegulatoryValue {
  readonly tenantId: string; readonly authority: string; readonly identifier: string; readonly component: string; readonly customerScope: string;
  readonly effectiveFrom: string; readonly effectiveTo: string | null; readonly value: number; readonly unit: string; readonly source: string; readonly sha256: string | null;
}
const text = (value: unknown) => typeof value === "string" ? value : "";

export async function runRegulatoryJob(input: { readonly store: ServiceStore; readonly fetcher: OfficialFetch; readonly recorded: readonly FetchedDocument[]; readonly tenants: readonly string[]; readonly now: string; readonly mode: ServiceMode; readonly nextCheckAt: string; readonly runId: string; readonly only?: RegulatoryScope }): Promise<{ readonly tenants: readonly RegulatoryTenantResult[]; readonly conserved: number; readonly errors: readonly string[]; readonly scope: RegulatoryScope; readonly acquired: readonly AcquiredRegulatoryValue[] }> {
  const only = input.only ?? null;
  const skipped = async () => "SKIPPED";
  const fetcher = input.fetcher as unknown as AreraFetcher & TernaFetcher;
  const target = input.mode === "PUBLISH" ? input.store : createServiceStore(memoryBackend());
  const repositories = shadowRepositories(target);
  const principal = { principalId: SERVICE_IDENTITY.principalId, role: SERVICE_IDENTITY.role };
  const results: RegulatoryTenantResult[] = [];
  const areraErrors: string[] = []; const ternaErrors: string[] = [];
  for (const tenantId of input.tenants) {
    const errors: string[] = [];
    const deps = { tenantId, repositories: repositories as never, now: input.now, trigger: "CRON" as const, principal, runId: `${input.runId}-${tenantId}` };
    const step = async (name: string, run: () => Promise<{ readonly errors: readonly string[]; readonly status?: string }>, bucket: string[]): Promise<string> => {
      try { const result = await run(); const list = result.errors.map((error) => `${name}:${error}`); errors.push(...list); bucket.push(...list.map((error) => `${tenantId} ${error}`)); return result.status ?? (result.errors.length ? "PARTIAL_FAILURE" : "SUCCESS"); }
      catch (error) { const message = `${name}:${error instanceof Error ? error.message : "FAILED"}`; errors.push(message); bucket.push(`${tenantId} ${message}`); return "FAILED"; }
    };
    const doArera = only !== "terna"; const doTerna = only !== "arera";
    const arera = doArera ? await step("ARERA", () => runRegulatoryRefresh({ ...deps, runId: `${deps.runId}-arera`, dryRun: input.mode === "DRY_RUN", sourceReader: createAreraRegulatorySourceReader({ fetcher }) }), areraErrors) : await skipped();
    const capacity = doArera ? await step("ARERA_CAPACITY", () => runAreraCapacityRefresh({ ...deps, runId: `${deps.runId}-cmc`, capacitySourceReader: createAreraCapacitySourceReader({ fetcher }) }), areraErrors) : await skipped();
    const terna = doTerna ? await step("TERNA_CAPACITY", () => runTernaCapacityRefresh({ ...deps, runId: `${deps.runId}-terna`, sourceReader: createTernaCapacitySourceReader({ fetcher }) as never }), ternaErrors) : await skipped();
    const tide = doTerna ? await step("TERNA_TIDE", () => runTernaDispatchingRefresh({ ...deps, runId: `${deps.runId}-tide`, tideSourceReader: createTernaTideSourceReader({ fetcher }) }), ternaErrors) : await skipped();
    results.push({ tenantId, arera, capacity, terna, tide, errors });
  }
  // The values read in this run (retrieved now): in test mode they exist only in the throw-away copy, and they are reported so the
  // Control Room shows what the service actually acquired, without anything being written into the archive.
  const acquired: AcquiredRegulatoryValue[] = [];
  for (const tenantId of input.tenants) {
    const records = await repositories.regulatoryValues.list(tenantId).catch(() => []) as readonly { readonly payload: Record<string, unknown> }[];
    for (const { payload } of records) {
      if (payload.retrievedAt !== input.now || typeof payload.originalValue !== "number") continue;
      acquired.push({ tenantId, authority: text(payload.authority), identifier: text(payload.officialIdentifier), component: text(payload.componentCode), customerScope: text(payload.customerScope), effectiveFrom: text(payload.effectiveFrom), effectiveTo: text(payload.effectiveTo) || null, value: payload.originalValue, unit: text(payload.originalUnit), source: text(payload.sourceReference), sha256: text(payload.sourceSha256) || null });
    }
  }
  let conserved = 0;
  const period = input.now.slice(0, 10);
  if (input.mode === "PUBLISH") {
    const seen = new Set<string>();
    for (const document of input.recorded) {
      if (seen.has(document.sha256) || /text\/html/i.test(document.contentType)) continue;
      seen.add(document.sha256);
      const host = new URL(document.url).hostname;
      const source = /terna\.it$/i.test(host) ? "TERNA" : /arera\.it$/i.test(host) ? "ARERA" : null;
      if (!source) continue;
      const { reused } = await conserveDocument(input.store, { document, kind: source === "TERNA" ? "TERNA_SOURCE" : "ARERA_SOURCE", source, period, checks: [{ code: "OFFICIAL_HOST", ok: true, detail: `scaricato da ${host}` }] });
      if (!reused) conserved += 1;
    }
    // A half that did not run says nothing about its source: its alert is neither raised nor resolved.
    for (const [code, list] of ([["ARERA_REGULATED_REFRESH", areraErrors, "arera"], ["TERNA_DISPATCHING_CAPACITY", ternaErrors, "terna"]] as const).filter(([, , half]) => only === null || only === half).map(([code, list]) => [code, list] as const)) {
      const alertId = list.length ? await raiseAnomaly(input.store, code, period, `servizio automatico: ${list.slice(0, 4).join("; ")}`, input.now) : null;
      if (!list.length) await resolveAnomaly(input.store, code, period, "aggiornamento automatico riuscito", input.now);
      await recordCheck(input.store, { code, period, at: input.now, outcome: list.length ? "FAILED" : "ACQUIRED", detail: list.length ? `${list.length} errori: ${list.slice(0, 2).join("; ")}` : `aggiornamento completato per ${input.tenants.length} aziende`, nextCheckAt: input.nextCheckAt, alertId });
    }
  }
  return { tenants: results, conserved, errors: [...areraErrors, ...ternaErrors], scope: only, acquired: acquired.slice(0, 300) };
}
