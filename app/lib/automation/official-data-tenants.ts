import type { Company } from "../access/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PLATFORM_TENANT_ID } from "../access/types.ts";
import type { TenantRecordRepository } from "../persistence/types.ts";

/**
 * Official PUN, PSV and regulated charges are stored per company, so the
 * nightly refresh covers every company the platform owner created as well as
 * any tenant listed in the environment.
 */
export async function officialDataTenants(configured: () => readonly string[], companies: Pick<TenantRecordRepository<Company>, "list">): Promise<readonly string[]> {
  let listed: readonly string[] = [];
  let configurationError: unknown = null;
  try { listed = configured(); } catch (error) { configurationError = error; }
  let created: readonly string[] = [];
  try { created = (await companies.list(PLATFORM_TENANT_ID)).map((record) => record.payload.tenantId); } catch { /* companies are optional: environments without access management keep the configured list */ }
  const tenants = [...new Set([...listed, ...created])].filter((tenantId) => /^tenant_[a-z0-9-]+$/.test(tenantId) && tenantId !== PLATFORM_TENANT_ID);
  if (tenants.length === 0 && configurationError) throw configurationError;
  return tenants;
}
