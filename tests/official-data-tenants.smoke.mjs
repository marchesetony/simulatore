import assert from "node:assert/strict";
import { officialDataTenants } from "../app/lib/automation/official-data-tenants.ts";

const companies = (tenantIds) => ({ async list(tenantId) { assert.equal(tenantId, "tenant_piattaforma"); return tenantIds.map((id) => ({ payload: { tenantId: id } })); } });

// Every company the platform owner created gets official data, plus the configured tenants.
assert.deepEqual(await officialDataTenants(() => ["tenant_demo"], companies(["tenant_energia-priva", "tenant_demo"])), ["tenant_demo", "tenant_energia-priva"]);
// Production without the environment list still covers the companies.
assert.deepEqual(await officialDataTenants(() => { throw new Error("MARKET_REFRESH_TENANTS_REQUIRED"); }, companies(["tenant_energia-priva"])), ["tenant_energia-priva"]);
// With neither, the configuration error is reported.
await assert.rejects(() => officialDataTenants(() => { throw new Error("MARKET_REFRESH_TENANTS_REQUIRED"); }, companies([])), /MARKET_REFRESH_TENANTS_REQUIRED/);
// A missing company store keeps the configured list; the platform tenant itself never gets market data.
assert.deepEqual(await officialDataTenants(() => ["tenant_demo", "tenant_piattaforma"], { async list() { throw new Error("HIERARCHY_STORAGE_UNAVAILABLE"); } }), ["tenant_demo"]);

console.log("official data tenants smoke passed");
