import { isPlatformOwner } from "../../../lib/access/service";
import { requestPrincipal } from "../../../lib/auth/request";
import { officialDataTenants } from "../../../lib/automation/official-data-tenants";
import { parseArera575Bta6MeasurementXlsx } from "../../../lib/foundation/arera-electricity-regulatory";
import { configuredMarketRefreshTenants } from "../../../lib/market-refresh/config";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { deterministicRecordId } from "../../../lib/persistence/types";
import { createAreraRegulatorySourceReader } from "../../../lib/regulatory-refresh/arera";
import { regulatoryDomainKey } from "../../../lib/regulatory-refresh/registry";
import { REQUIRED_OFFICIAL_TABLES, requiredTableAlerts, uploadedTableFetcher } from "../../../lib/regulatory-refresh/required-tables";
import { runRegulatoryRefresh } from "../../../lib/regulatory-refresh/service";
import { ProductionRegulatoryPersistenceBridge } from "../../../lib/regulatory-bridge";

export const runtime = "nodejs";
export const maxDuration = 300;

const headers = { "cache-control": "no-store, private" };
const denied = () => Response.json({ error: { code: "AUTHORIZATION_DENIED", message: "Solo il proprietario della piattaforma" } }, { status: 403, headers });

async function platformOwner(request: Request): Promise<boolean> {
  try { return isPlatformOwner(await requestPrincipal(request, "ADMIN")); } catch { return false; }
}

/** Official ARERA tables the app needs and that are missing from the archive: the platform owner sees them as "Azione richiesta" (Tony, 6/11). */
export async function GET(request: Request): Promise<Response> {
  if (!(await platformOwner(request))) return denied();
  const repositories = runtimeRepositories();
  const tenants = await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies);
  const tenantId = tenants[0];
  if (!tenantId) return Response.json({ alerts: [] }, { headers });
  const approved = await new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains).list(tenantId);
  const stored = await repositories.regulatoryRefreshState.get(tenantId, deterministicRecordId("regulatory-refresh-state", tenantId, "regulatory-refresh"));
  const lastErrors = (stored?.payload as { readonly errors?: readonly string[] } | undefined)?.errors ?? [];
  return Response.json({ alerts: requiredTableAlerts(approved, lastErrors, new Date().toISOString()) }, { headers });
}

/** Upload of an official ARERA table downloaded by hand: checked with the refresh parser, then archived for every company
 *  through the same refresh (only the domains the table feeds). */
export async function POST(request: Request): Promise<Response> {
  if (!(await platformOwner(request))) return denied();
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: { code: "OFFICIAL_TABLE_FILE_MISSING", message: "Seleziona il file Excel scaricato da ARERA" } }, { status: 400, headers }); }
  const table = REQUIRED_OFFICIAL_TABLES.find((item) => item.code === form.get("code"));
  const file = form.get("file");
  if (!table) return Response.json({ error: { code: "OFFICIAL_TABLE_UNKNOWN", message: "Tabella non prevista" } }, { status: 400, headers });
  if (!(file instanceof Blob) || file.size === 0 || file.size > 10 * 1024 * 1024) return Response.json({ error: { code: "OFFICIAL_TABLE_FILE_MISSING", message: "Seleziona il file Excel scaricato da ARERA (massimo 10 MB)" } }, { status: 400, headers });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const now = new Date().toISOString();
  try { parseArera575Bta6MeasurementXlsx({ body: bytes, retrievedAt: now, requiredYear: new Date(now).getUTCFullYear() }); }
  catch (error) {
    return Response.json({ error: { code: "OFFICIAL_TABLE_UNREADABLE", message: `Il file non contiene le tabelle TIME dell'anno in corso (${error instanceof Error ? error.message : "illeggibile"}). Scarica il file indicato nelle istruzioni.` } }, { status: 422, headers });
  }
  const repositories = runtimeRepositories();
  const tenants = await officialDataTenants(() => configuredMarketRefreshTenants(), repositories.companies);
  const domainKeys = table.domains.map((domain) => regulatoryDomainKey(domain as Parameters<typeof regulatoryDomainKey>[0]));
  const results = [];
  for (const tenantId of tenants) {
    const run = await runRegulatoryRefresh({ tenantId, repositories, trigger: "MANUAL", now, domainKeys, sourceReader: createAreraRegulatorySourceReader({ fetcher: uploadedTableFetcher(table, bytes) }) }).catch((error: unknown) => ({ status: "FAILED", errors: [error instanceof Error ? error.message : "REFRESH_FAILED"], createdCount: 0, replacedCount: 0, unchangedCount: 0 }));
    results.push({ tenantId, status: run.status, errors: run.errors, created: run.createdCount, replaced: run.replacedCount, unchanged: run.unchangedCount });
  }
  return Response.json({ uploadedAt: now, table: table.code, results }, { headers });
}
