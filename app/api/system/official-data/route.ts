import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";
import { computeCoverage, type CoverageCopy, type CoverageReport } from "../../../lib/official-monitor/coverage";
import { allPublications, type OfficialPublicationRecord } from "../../../lib/official-monitor/documents";
import type { OfficialAlert, OfficialCheck } from "../../../lib/official-monitor/monitor";
import { officialDataOverview, PLATFORM_TENANT } from "../../../lib/official-monitor/service-overview";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Control Room Produttore → Dati ufficiali (Tony 22/11/2026). GET only, read-only: reports of the independent official data
 * service, alerts, and the PUN versions the engine uses for each company. Only the producer (ADMIN of tenant_piattaforma,
 * checked here from the session); every other role gets 403. Nothing is written, nothing is recalculated.
 */
const headers = { "cache-control": "no-store, private" };

async function producer(request: Request) {
  try { const principal = await requestPrincipal(request, "ADMIN"); return isPlatformOwner(principal) ? principal : null; } catch { return null; }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await producer(request))) return Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Riservato al produttore della piattaforma" } }, { status: 403, headers });
  const repositories = runtimeRepositories();
  const now = new Date().toISOString();
  try {
    const companies = await repositories.companies.list(PLATFORM_TENANT).catch(() => []);
    const names = new Map(companies.map((record) => [record.payload.tenantId, record.payload.name]));
    const clients = await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies).catch(() => [] as readonly string[]);
    const tenants = [{ tenantId: PLATFORM_TENANT, label: "Archivio produttore" }, ...clients.map((tenantId) => ({ tenantId, label: names.get(tenantId) ?? tenantId }))];
    const [runs, alerts] = await Promise.all([
      repositories.officialServiceRuns.list(PLATFORM_TENANT).then((records) => records.map((record) => record.payload)),
      repositories.officialAlerts.list(PLATFORM_TENANT).then((records) => records.map((record) => record.payload as OfficialAlert)).catch(() => [] as OfficialAlert[]),
    ]);
    // Dates and versions of the ARERA and Terna data in use: the same coverage the Archivi ufficiali section computes.
    let coverage: CoverageReport | null = null;
    try {
      const copies: CoverageCopy[] = await Promise.all(tenants.map(async ({ tenantId, label }) => ({
        tenantId, platform: tenantId === PLATFORM_TENANT, label,
        regulatoryValues: (await repositories.regulatoryValues.list(tenantId)).map((record) => record.payload),
        approvalDomains: (await repositories.approvalDomains.list(tenantId)).map((record) => record.payload),
        marketArchives: await repositories.marketArchiveRepository.list(tenantId),
      })));
      const [publications, checks] = await Promise.all([
        allPublications(repositories.officialPublications) as Promise<OfficialPublicationRecord[]>,
        repositories.officialChecks.list(PLATFORM_TENANT).then((records) => records.map((record) => record.payload as OfficialCheck)),
      ]);
      coverage = computeCoverage({ now, copies, publications, checks, alerts });
    } catch { coverage = null; }
    const overview = await officialDataOverview({ now, runs, alerts, market: repositories.marketArchiveRepository, tenants, coverage });
    return Response.json({ overview, coverageAvailable: coverage !== null }, { headers });
  } catch {
    return Response.json({ error: { code: "OFFICIAL_DATA_UNAVAILABLE", message: "Rapporti del servizio non leggibili in questo momento: riprova più tardi." } }, { status: 503, headers });
  }
}
