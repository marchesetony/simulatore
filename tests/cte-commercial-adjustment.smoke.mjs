import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive, setCteCommercialAdjustment, toPublicCteApprovedArchiveSummary } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { compareApprovedOffers } from "../app/lib/comparison/service.ts";

const tenant = "tenant_adjustment-smoke";
const approval = { status: "APPROVED", reviewer: "smoke-reviewer", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "smoke-approval" };
const fee = (feeId, label, amount, unit) => ({ feeId, label, amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });
const price = (amount, unit) => ({ amount, currency: "EUR", unit, taxTreatment: "EXCLUDED" });

function cte(id, fixedPrice) {
  return {
    ...structuredClone(syntheticElectricityCte), recordId: id, cteId: id, tenantId: tenant, approval,
    supplier: { supplierId: `${id}-supplier`, name: `${id} Supplier` }, offer: { offerId: `${id}-offer`, name: `${id} Offer`, code: `${id}-CODE` },
    validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
    eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV"] },
    pricing: { mode: "FIXED", reference: "NONE", fixedPrice: price(fixedPrice, "EUR_PER_KWH"), spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } },
    commercialTerms: { fixedFees: [fee(`${id}-fixed`, "Quota fissa", 5, "EUR_PER_MONTH")], variableFees: [], imbalance: { status: "DECLARED", component: fee(`${id}-imbalance`, "Sbilanciamento", 0.002, "EUR_PER_KWH") }, oneOffFees: [], commercialDiscounts: [] },
  };
}
const request = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-01-15", supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 } }, tenant);
const total = (result) => Number(result.totalCommercialCost.amount ?? result.totalCommercialCost);

const root = await mkdtemp(path.join(os.tmpdir(), "cte-adjustment-"));
try {
  const ctes = new LocalCteArchiveRepository(path.join(root, "cte"));
  const market = new LocalMarketArchiveRepository(path.join(root, "market"));
  const cheap = await createCteArchive(ctes, { tenantId: tenant, contract: cte("cte-cheap", 0.2), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });
  const dear = await createCteArchive(ctes, { tenantId: tenant, contract: cte("cte-dear", 0.21), now: "2026-01-02T00:00:00.000Z", actor: "SMOKE" });

  const before = await calculateApprovedOffer(ctes, market, request, dear.archiveId);
  assert.equal((await compareApprovedOffers(ctes, market, request)).ranking[0].offerCode, "cte-cheap-CODE");

  // The company lowers the energy price by 2 cents and the fixed fee by 3 €/month on the dearer CTE.
  const adjusted = await setCteCommercialAdjustment(ctes, tenant, dear.archiveId, "user_admin", { energyPriceDelta: "-0,02", monthlyFeeDelta: -3 }, "2026-01-03T00:00:00.000Z");
  assert.deepEqual(adjusted.commercialAdjustment, { energyPriceDelta: -0.02, monthlyFeeDelta: -3, updatedAt: "2026-01-03T00:00:00.000Z", updatedBy: "user_admin" });
  assert.equal(adjusted.history.at(-1).type, "COMMERCIAL_ADJUSTED");
  assert.equal(toPublicCteApprovedArchiveSummary(await ctes.get(tenant, dear.archiveId)).commercialAdjustment.monthlyFeeDelta, -3, "the adjustment survives storage");

  const after = await calculateApprovedOffer(ctes, market, request, dear.archiveId);
  assert.ok(Math.abs((total(before) - total(after)) - (200 * 0.02 + 3)) < 1e-6, `expected 7 € less, got ${total(before) - total(after)}`);
  assert.ok(after.components.some((component) => component.label === "Sconto quota fissa"));
  assert.notEqual(after.fingerprint, before.fingerprint, "a proposal built before the change cannot be reused");
  assert.equal((await compareApprovedOffers(ctes, market, request)).ranking[0].offerCode, "cte-dear-CODE", "the adjusted CTE now ranks first");

  await assert.rejects(() => setCteCommercialAdjustment(ctes, tenant, cheap.archiveId, "user_admin", { energyPriceDelta: 5 }), /CTE_ADJUSTMENT_INVALID/);
  await assert.rejects(() => setCteCommercialAdjustment(ctes, tenant, cheap.archiveId, "user_admin", { energyPriceDelta: -0.5 }).then(() => calculateApprovedOffer(ctes, market, request, cheap.archiveId)), /CTE_ADJUSTMENT_OUT_OF_RANGE/);

  // Zero on both levers clears the correttivi.
  const cleared = await setCteCommercialAdjustment(ctes, tenant, dear.archiveId, "user_admin", { energyPriceDelta: 0, monthlyFeeDelta: 0 });
  assert.equal(cleared.commercialAdjustment, null);
  assert.equal(total(await calculateApprovedOffer(ctes, market, request, dear.archiveId)), total(before));
  console.log("cte commercial adjustment smoke passed");
} finally { await rm(root, { recursive: true, force: true }); }
