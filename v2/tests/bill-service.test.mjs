import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authorize } from "../modules/auth/access.ts";
import { billPermissions, permissions } from "../modules/auth/schema.ts";
import { BillService } from "../modules/bills/service.ts";
import { UnavailableBillRepository } from "../modules/bills/repository.ts";
import { setup, input, consumption } from "./bill-fixtures.mjs";

const grants = ["bills:list", "bills:read", "bills:create", "bills:update"];
for (const role of ["PLATFORM_OWNER", "TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR"]) {
  test(`${role}: four server-derived Bill permissions, create/list/read/update`, async () => {
    assert.deepEqual(billPermissions(role), grants);
    const f = await setup(role);
    assert.deepEqual(await f.service.list(f.token, f.target), []);
    const bill = await f.create();
    assert.equal((await f.service.get(f.token, bill.id, f.target)).id, bill.id);
    assert.equal((await f.service.update(f.token, bill.id, input({ documentNumber: "UPDATED" }), f.target)).documentNumber, "UPDATED");
    assert.equal((await f.service.list(f.token, f.target)).length, 1);
  });
}
for (const role of ["PRODUCT_OWNER", "ADMIN", "ANALYST", "VIEWER"]) {
  test(`${role}: legacy role denied even with injected Bill permissions`, async () => {
    const f = await setup(); f.rows[0].role = role; f.rows[0].permissions = ["auth:session", ...grants];
    assert.throws(() => billPermissions(role));
    await assert.rejects(() => f.service.list(f.token));
  });
}
test("auth:session alone does not authorize Bill without canonical active assignment", async () => {
  const f = await setup();
  for (const role of [undefined, "VIEWER", "UNKNOWN"]) {
    assert.equal(await authorize({ userId: "u", authUserId: "a", assignmentId: "i", role, scope: "TENANT",
      tenantId: "tenant_test", membershipStatus: "ACTIVE", permissions: ["auth:session"] }, "bills:list", "TENANT", f.deps.access, "tenant_test"), false);
  }
  f.rows[0].status = "SUSPENDED";
  await assert.rejects(() => f.service.list(f.token));
});
test("list tenant isolation and defensive denial of leaking repository rows", async () => {
  const f = await setup(); const own = await f.create();
  const other = { ...own, id: randomUUID(), tenantId: "tenant_other" }; f.repository.bills.set(other.id, other);
  assert.deepEqual((await f.service.list(f.token)).map(b => b.id), [own.id]);
  f.repository.list = async () => [other];
  await assert.rejects(() => f.service.list(f.token), { code: "DENIED" });
});
test("cross-tenant read and update denied without exposing existence", async () => {
  const f = await setup(); const b = await f.create(); f.repository.bills.get(b.id).tenantId = "tenant_other";
  await assert.rejects(() => f.service.get(f.token, b.id), { code: "NOT_FOUND" });
  await assert.rejects(() => f.service.update(f.token, b.id, input()), { code: "NOT_FOUND" });
  assert.equal(f.repository.bills.get(b.id).tenantId, "tenant_other");
});
test("create owns tenant and IDs server-side for Supply, Bill and every child", async () => {
  const f = await setup(); const b = await f.create({ consumptions: [consumption("TOTAL", "0")] });
  const rows = [f.supply, b, ...b.lines, ...b.consumptions];
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const row of rows) { assert.match(row.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); assert.equal(row.tenantId, "tenant_test"); }
  assert.notEqual(f.supply.id, f.supply.pod);
  for (const row of [...b.lines, ...b.consumptions]) assert.equal(row.billId, b.id);
});
test("PLATFORM missing/inactive/invalid target denies every Bill/Supply operation", async () => {
  const f = await setup("PLATFORM_OWNER"), bill = await f.create();
  for (const target of [undefined, "tenant_inactive", "tenant_missing", "malformed"]) {
    for (const call of [() => f.service.list(f.token, target), () => f.service.get(f.token, bill.id, target),
      () => f.service.create(f.token, { ...input(), customerId: f.customerId, supplyId: f.supply.id }, target),
      () => f.service.update(f.token, bill.id, input(), target), () => f.service.listSupplies(f.token, target),
      () => f.service.getSupply(f.token, f.supply.id, target),
      () => f.service.createSupply(f.token, { customerId: f.customerId, pod: f.supply.pod }, target)]) {
      await assert.rejects(call, { code: "DENIED" });
    }
  }
});
test("tenant target cannot override verified principal", async () => {
  const f = await setup(); f.deps.access.tenantActive = async () => true;
  await assert.rejects(() => f.service.list(f.token, "tenant_other"), { code: "DENIED" });
  await assert.rejects(() => f.service.createSupply(f.token, { customerId: f.customerId, pod: f.supply.pod }, "tenant_other"), { code: "DENIED" });
});
test("Customer must exist and own Supply in the same tenant", async () => {
  const f = await setup();
  await assert.rejects(() => f.service.createSupply(f.token, { customerId: randomUUID(), pod: f.supply.pod }), { code: "NOT_FOUND" });
  f.customers.get(f.customerId).tenantId = "tenant_other";
  await assert.rejects(() => f.service.createSupply(f.token, { customerId: f.customerId, pod: f.supply.pod }), { code: "NOT_FOUND" });
  await assert.rejects(() => f.create(), { code: "NOT_FOUND" });
});
test("Bill rejects mismatched Supply/Customer and cross-tenant Supply", async () => {
  const f = await setup(); f.repository.supplies.get(f.supply.id).customerId = randomUUID();
  await assert.rejects(() => f.create(), { code: "DENIED" });
  f.repository.supplies.get(f.supply.id).tenantId = "tenant_other";
  await assert.rejects(() => f.create(), { code: "NOT_FOUND" });
});
test("client cannot mass assign identities, authority, statuses or reconstructed totals", async () => {
  const f = await setup(), b = await f.create();
  for (const key of ["tenantId", "id", "permissions", "role", "scope", "completenessStatus", "validationStatus", "reconstructedTotal", "reconciliation", "detailCoverage"]) {
    await assert.rejects(() => f.create({ [key]: "injected" }), { code: "INVALID_INPUT" });
    await assert.rejects(() => f.service.update(f.token, b.id, input({ [key]: "injected" })), { code: "INVALID_INPUT" });
  }
  for (const key of ["customerId", "supplyId"]) {
    await assert.rejects(() => f.service.update(f.token, b.id, input({ [key]: randomUUID() })), { code: "INVALID_INPUT" });
  }
  await assert.rejects(() => f.service.createSupply(f.token, { customerId: f.customerId, pod: f.supply.pod, tenantId: "tenant_other" }), { code: "INVALID_INPUT" });
  await assert.rejects(() => f.create({ consumptions: [{ ...consumption("TOTAL", "1"), id: randomUUID() }] }), { code: "INVALID_INPUT" });
});
test("malformed UUID rejected before datastore lookup", async () => {
  const f = await setup(); f.repository.get = async () => { throw new Error("must not run"); };
  await assert.rejects(() => f.service.get(f.token, "not-uuid"), { code: "INVALID_INPUT" });
});
test("production datastore absence fails closed for all port operations", async () => {
  const repo = new UnavailableBillRepository();
  for (const method of ["list", "get", "create", "replace", "listSupplies", "getSupply", "createSupply"]) {
    await assert.rejects(() => repo[method](), { code: "UNAVAILABLE" });
  }
  const f = await setup(); const service = new BillService(f.deps, repo, f.customerRepository);
  await assert.rejects(() => service.list(f.token), { code: "UNAVAILABLE" });
});
test("empty archive is really empty and contains no seeded Bill", async () => {
  const f = await setup(); assert.deepEqual(await f.service.list(f.token), []);
  assert.equal(f.repository.bills.size, 0);
});
test("closed permission set rejects delete, wildcard and arbitrary grants", () => {
  assert.deepEqual(permissions(grants), grants);
  for (const value of ["bills:delete", "bills:*", "*", "supplies:delete"]) assert.throws(() => permissions([value]));
});
test("historical reads preserve snapshot without current external references", async () => {
  const f = await setup(); const bill = await f.create();
  const serialized = JSON.stringify(bill);
  for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(await f.service.get(f.token, bill.id)), serialized);
  bill.lines[0].amount = 999;
  assert.equal((await f.service.get(f.token, bill.id)).lines[0].amount, 1000);
});
