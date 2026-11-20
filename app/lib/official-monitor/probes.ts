import type { RuntimeRepositories } from "../persistence/adapter";
import { officialDataTenants } from "../automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../market-refresh/config";
import { runPunMarketRefresh } from "../market-refresh/service";
import { runAreraCapacityRefresh } from "../regulatory-refresh/arera-capacity";
import { REQUIRED_OFFICIAL_TABLES, tableCoversYear } from "../regulatory-refresh/required-tables";
import { runRegulatoryRefresh } from "../regulatory-refresh/service";
import { runTernaCapacityRefresh, runTernaDispatchingRefresh } from "../regulatory-refresh/terna";
import { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge";
import { publishedDocuments } from "./documents";
import type { DocumentProbes } from "./monitor";

/**
 * Control Room produttore: collega il monitor ai servizi già esistenti, senza duplicarli. L'acquisizione automatica usa i
 * refresh notturni (GME, ARERA, Terna) con i loro lettori verificati; la copertura legge gli archivi approvati. I dati ufficiali
 * sono copiati in ogni azienda dai refresh esistenti; la copertura si controlla sulla prima azienda servita, come la pagina
 * "Azione richiesta".
 */
type Repositories = RuntimeRepositories;

export function liveProbes(repositories: Repositories): DocumentProbes {
  const tenants = () => officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies);
  const errorsOf = (result: unknown): readonly string[] => ((result as { readonly errors?: readonly string[] } | null)?.errors ?? []);
  const overTenants = async (run: (tenantId: string) => Promise<unknown>) => {
    const errors: string[] = [];
    for (const tenantId of await tenants()) {
      try { errors.push(...errorsOf(await run(tenantId)).map((error) => `${tenantId}: ${error}`)); }
      catch (error) { errors.push(`${tenantId}: ${error instanceof Error ? error.message : "REFRESH_FAILED"}`); }
    }
    return { ok: errors.length === 0, errors };
  };
  return {
    GME_PUN_MONTH: {
      covered: async (month) => {
        const [tenantId] = await tenants(); if (!tenantId) return false;
        const records = await repositories.marketArchiveRepository.list(tenantId);
        return records.some((record) => record.index === "PUN" && record.month === month && record.status === "APPROVED" && (() => { const value = record.record as { readonly monthly?: unknown; readonly f1?: unknown; readonly f2?: unknown; readonly f3?: unknown }; return Boolean(value.monthly && value.f1 && value.f2 && value.f3); })());
      },
      acquire: () => overTenants((tenantId) => runPunMarketRefresh({ tenantId, repositories, trigger: "CRON" })),
    },
    ARERA_REGULATED_REFRESH: {
      covered: async () => null,
      acquire: () => overTenants(async (tenantId) => ({ errors: [...errorsOf(await runRegulatoryRefresh({ tenantId, repositories, trigger: "CRON" })), ...errorsOf(await runAreraCapacityRefresh({ tenantId, repositories, trigger: "CRON" }))] })),
    },
    TERNA_DISPATCHING_CAPACITY: {
      covered: async () => null,
      acquire: () => overTenants(async (tenantId) => ({ errors: [...errorsOf(await runTernaDispatchingRefresh({ tenantId, repositories, trigger: "CRON" })), ...errorsOf(await runTernaCapacityRefresh({ tenantId, repositories, trigger: "CRON" }))] })),
    },
    ARERA_TIME_TABLES: {
      covered: async (year) => {
        const [tenantId] = await tenants(); if (!tenantId) return false;
        const approved = await new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains).list(tenantId);
        return tableCoversYear(REQUIRED_OFFICIAL_TABLES[0], approved, Number(year));
      },
    },
    ARERA_TIT_TABLE5_REACTIVE: {
      covered: async (year) => (await publishedDocuments({ documents: repositories.officialDocuments, publications: repositories.officialPublications }, "ARERA_TIT_TABLE5_REACTIVE")).some((record) => record.period === year),
    },
  };
}
