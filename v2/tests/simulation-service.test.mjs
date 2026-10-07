import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authorize } from "../modules/auth/access.ts";
import { permissions, simulationPermissions } from "../modules/auth/schema.ts";
import { SimulationService } from "../modules/simulations/service.ts";
import { UnavailableSimulationRepository } from "../modules/simulations/repository.ts";
import { calculate } from "../modules/simulations/engine.ts";
import { setup, terms, rate, indexed, market } from "./simulation-fixtures.mjs";

const grants = ["simulations:list", "simulations:read", "simulations:create"];
for (const role of ["PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"]) test(`${role}: server permission matrix and real operations`, async () => {
  assert.deepEqual(simulationPermissions(role), grants);
  const f = await setup(role), row = await f.calculate();
  assert.equal((await f.simulationService.list(f.token, f.target)).length, 1);
  assert.equal((await f.simulationService.get(f.token, row.id, f.target)).id, row.id);
});
for (const role of ["PRODUCT_OWNER", "ADMIN", "ANALYST", "VIEWER"]) test(`${role}: legacy rejected despite injected grants`, async () => {
  const f = await setup(); f.rows[0].role = role; f.rows[0].permissions = grants;
  assert.throws(() => simulationPermissions(role)); await assert.rejects(() => f.calculate());
});
test("auth:session alone is insufficient without canonical active authority", async () => {
  const f = await setup();
  assert.equal(await authorize({ userId: "u", authUserId: "a", assignmentId: "i", permissions: ["auth:session"], role: "UNKNOWN",
    scope: "TENANT", tenantId: "tenant_test", membershipStatus: "ACTIVE" }, "simulations:list", "TENANT", f.deps.access, "tenant_test"), false);
  f.rows[0].status = "SUSPENDED"; await assert.rejects(() => f.simulationService.list(f.token));
});
test("list isolates tenant and defends against a leaking repository", async () => {
  const f = await setup(), row = await f.calculate(), other = { ...row, id: randomUUID(), tenantId: "tenant_other" };
  f.store.rows.set(other.id, other);
  assert.deepEqual((await f.simulationService.list(f.token)).map(row => row.id), [row.id]);
  f.store.list = async () => [other]; await assert.rejects(() => f.simulationService.list(f.token), { code: "DENIED" });
});
test("cross-tenant read does not expose record", async () => {
  const f = await setup(), row = await f.calculate(); f.store.rows.get(row.id).tenantId = "tenant_other";
  await assert.rejects(() => f.simulationService.get(f.token, row.id), { code: "NOT_FOUND" });
});
test("create uses server ID tenant and version", async () => {
  const f = await setup(), a = await f.calculate(), b = await f.calculate();
  assert.notEqual(a.id, b.id); assert.match(a.id, /^[a-f0-9-]{36}$/); assert.equal(a.tenantId, "tenant_test");
  assert.equal(a.calculationVersion, "commercial-ee-1"); assert.equal(a.inputSnapshot.calculationVersion, a.calculationVersion);
});
test("PLATFORM every operation needs explicit active target", async () => {
  const f = await setup("PLATFORM_OWNER"), row = await f.calculate();
  for (const target of [undefined, "tenant_inactive", "tenant_missing", "invalid"]) {
    for (const call of [() => f.simulationService.list(f.token, target), () => f.simulationService.get(f.token, row.id, target),
      () => f.simulationService.create(f.token, f.payload(), target)]) await assert.rejects(call, { code: "DENIED" });
  }
});
test("tenant cannot choose another tenant", async () => {
  const f = await setup(); f.deps.access.tenantActive = async () => true;
  await assert.rejects(() => f.simulationService.create(f.token, f.payload(), "tenant_other"), { code: "DENIED" });
});
for (const resource of ["bill", "supply", "customer"]) test(`ownership: cross-tenant ${resource} blocks creation`, async () => {
  const f = await setup();
  const row = resource === "bill" ? f.repository.bills.get(f.bill.id) : resource === "supply" ? f.repository.supplies.get(f.supply.id) : f.customers.get(f.customerId);
  row.tenantId = "tenant_other";
  await assert.rejects(() => f.calculate(), { code: "NOT_FOUND" }); assert.equal(f.store.rows.size, 0);
});
test("supply belongs to the Bill Customer, not just same tenant", async () => {
  const f = await setup(); f.repository.supplies.get(f.supply.id).customerId = randomUUID();
  await assert.rejects(() => f.calculate(), { code: "DENIED" });
});
test("consumption child ownership is verified", async () => {
  const f = await setup(); f.repository.bills.get(f.bill.id).consumptions[0].billId = randomUUID();
  await assert.rejects(() => f.calculate(), { code: "DENIED" });
});
test("mass assignment identity authority results and version rejected", async () => {
  const f = await setup();
  for (const key of ["id", "tenantId", "role", "permission", "permissions", "scope", "status", "result", "calculationVersion",
    "savingAmountCents", "currentCost", "supplyId", "customerId", "consumptionProfile", "inputSnapshot"]) {
    await assert.rejects(() => f.calculate({ [key]: "forged" }), { code: "INVALID_INPUT" });
  }
  assert.equal(f.store.rows.size, 0);
});
test("Bill declared total and reconciliation never authorize baseline", async () => {
  const f = await setup(); f.repository.bills.get(f.bill.id).declaredDocumentTotal = 999999;
  f.repository.bills.get(f.bill.id).validationStatus = "VALID";
  const row = await f.calculate(); assert.equal(row.result.current, null); assert.equal(row.result.comparison.savingAmountCents, null);
  assert.equal("declaredDocumentTotal" in row.inputSnapshot, false);
});
test("saved snapshot unaffected by Bill, terms or returned object changes", async () => {
  const f = await setup(), payload = f.payload({ currentCommercialTerms: terms({ fixedPrice: rate("0.3") }) });
  const row = await f.simulationService.create(f.token, payload);
  const saved = structuredClone(row);
  payload.candidateCommercialTerms.fixedPrice.amount = "999"; f.repository.bills.get(f.bill.id).consumptions[0].energyKwh = "999";
  row.result.candidate.commercialTotalCents = -1;
  assert.deepEqual(await f.simulationService.get(f.token, row.id), saved);
  assert.deepEqual(calculate(saved.inputSnapshot), saved.result);
});
test("reads never requery mutable Bill or terms", async () => {
  const f = await setup(), row = await f.calculate(); f.repository.get = async () => { throw new Error("must not reload"); };
  assert.deepEqual(await f.simulationService.get(f.token, row.id), row);
});
test("empty list has no seeds", async () => {
  const f = await setup(); assert.deepEqual(await f.simulationService.list(f.token), []);
});
test("production unavailable port fails closed for every operation", async () => {
  const repo = new UnavailableSimulationRepository(), f = await setup();
  for (const call of [() => repo.list("tenant_test"), () => repo.get("tenant_test", randomUUID()), () => repo.create({})]) await assert.rejects(call, { code: "UNAVAILABLE" });
  const service = new SimulationService(f.deps, repo, f.repository, f.customerRepository);
  await assert.rejects(() => service.create(f.token, f.payload()), { code: "UNAVAILABLE" });
});
test("closed permission contract no update delete or wildcard", () => {
  assert.deepEqual(permissions(grants), grants);
  for (const value of ["simulations:update", "simulations:delete", "simulations:*", "*"]) assert.throws(() => permissions([value]));
});
test("malformed UUID rejected and unavailable repository redacted", async () => {
  const f = await setup(); await assert.rejects(() => f.simulationService.get(f.token, "bad"), { code: "INVALID_INPUT" });
  f.store.list = async () => { throw new Error("internal secret"); };
  await assert.rejects(() => f.simulationService.list(f.token), { code: "UNAVAILABLE" });
});

test("indexed saved snapshot retains exact market values after input mutation", async () => {
  const f = await setup(), payload = f.payload({ candidateCommercialTerms: indexed(), marketSnapshot: market() });
  const row = await f.simulationService.create(f.token, payload);
  payload.marketSnapshot.values[0].value = "999"; payload.marketSnapshot.values[0].versionReference = "changed";
  const saved = await f.simulationService.get(f.token, row.id);
  assert.equal(saved.inputSnapshot.marketSnapshot.values[0].value, "100");
  assert.equal(saved.inputSnapshot.marketSnapshot.values[0].versionReference, "test-v1");
  assert.equal(saved.result.candidate.commercialTotalCents, 2200);
  assert.deepEqual(calculate(saved.inputSnapshot), saved.result);
});
