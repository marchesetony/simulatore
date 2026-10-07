import test from "node:test";
import assert from "node:assert/strict";
import { billsHttp, MAX_BILL_BODY_BYTES } from "../modules/bills/http.ts";
import { SESSION_COOKIE } from "../modules/auth/http.ts";
import { setup, input } from "./bill-fixtures.mjs";

const origin = "https://app.example.test";
function request(f, method = "GET", body, headers = {}, query = "") {
  return new Request(`${origin}/api/v2/bills${query}`, { method, headers: {
    Cookie: `${SESSION_COOKIE}=${f.token}`, Origin: origin, "Content-Type": "application/json", ...headers,
  }, ...(body === undefined ? {} : { body }) });
}
test("API manual create, detail and update execute real service with test-only store", async () => {
  const f = await setup(), runtime = () => ({ origin, service: f.service });
  const payload = { ...input(), customerId: f.customerId, supplyId: f.supply.id };
  const created = await billsHttp(request(f, "POST", JSON.stringify(payload)), "bills", undefined, runtime);
  assert.equal(created.status, 201); const bill = await created.json();
  assert.equal((await billsHttp(request(f), "bills", bill.id, runtime)).status, 200);
  const updated = await billsHttp(request(f, "PUT", JSON.stringify(input({ documentNumber: "EDIT" }))), "bills", bill.id, runtime);
  assert.equal((await updated.json()).documentNumber, "EDIT");
  assert.match(updated.headers.get("cache-control"), /no-store/);
});
test("API rejects malformed JSON, content type, size and claims", async () => {
  const f = await setup(), runtime = () => ({ origin, service: f.service });
  for (const body of ["{", "x".repeat(MAX_BILL_BODY_BYTES + 1), JSON.stringify({ ...input(), tenantId: "tenant_other" })]) {
    assert.equal((await billsHttp(request(f, "POST", body), "bills", undefined, runtime)).status, 400);
  }
  assert.equal((await billsHttp(request(f, "POST", "{}", { "Content-Type": "text/plain" }), "bills", undefined, runtime)).status, 400);
  assert.equal(f.repository.bills.size, 0);
});
test("API refuses forged/duplicate cookies, CSRF, duplicate targets and unknown query", async () => {
  const f = await setup(), runtime = () => ({ origin, service: f.service });
  for (const cookie of ["", `${SESSION_COOKIE}=forged`, `${SESSION_COOKIE}=${f.token}; ${SESSION_COOKIE}=${f.token}`]) {
    assert.equal((await billsHttp(request(f, "GET", undefined, { Cookie: cookie }), "bills", undefined, runtime)).status, 403);
  }
  assert.equal((await billsHttp(request(f, "POST", "{}", { Origin: "https://other.test" }), "bills", undefined, runtime)).status, 403);
  for (const query of ["?tenantId=tenant_other", "?targetTenantId=tenant_test&targetTenantId=tenant_other"]) {
    assert.equal((await billsHttp(request(f, "GET", undefined, {}, query), "bills", undefined, runtime)).status, 400);
  }
});
test("API datastore failure is real safe 503, never synthetic success", async () => {
  const f = await setup(); f.repository.list = async () => { throw new Error("internal database secret"); };
  const response = await billsHttp(request(f), "bills", undefined, () => ({ origin, service: f.service }));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /internal database secret/);
});
test("API no Bill/Supply delete or supply update", async () => {
  const f = await setup(), runtime = () => ({ origin, service: f.service });
  for (const resource of ["bills", "supplies"]) {
    assert.equal((await billsHttp(request(f, "DELETE"), resource, f.supply.id, runtime)).status, 405);
  }
  assert.equal((await billsHttp(request(f, "PUT", "{}"), "supplies", f.supply.id, runtime)).status, 405);
});
test("API supply list and read are tenant-scoped", async () => {
  const f = await setup(), runtime = () => ({ origin, service: f.service });
  assert.equal((await (await billsHttp(request(f), "supplies", undefined, runtime)).json()).length, 1);
  f.repository.supplies.get(f.supply.id).tenantId = "tenant_other";
  assert.equal((await billsHttp(request(f), "supplies", f.supply.id, runtime)).status, 404);
});
