import test from "node:test";
import assert from "node:assert/strict";
import { simulationsHttp, MAX_BODY_BYTES } from "../modules/simulations/http.ts";
import { SESSION_COOKIE } from "../modules/auth/http.ts";
import { setup } from "./simulation-fixtures.mjs";
const origin = "https://app.example.test";
function request(f, method = "GET", body, headers = {}, query = "") {
  return new Request(`${origin}/api/v2/simulations${query}`, { method, headers: { Cookie: `${SESSION_COOKIE}=${f.token}`,
    Origin: origin, "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body }) });
}
const runtime = f => () => ({ origin, service: f.simulationService });
test("API creates and reads actual immutable calculation, private no-store", async () => {
  const f = await setup(), response = await simulationsHttp(request(f, "POST", JSON.stringify(f.payload())), undefined, runtime(f));
  assert.equal(response.status, 201); const row = await response.json(); assert.equal(row.scope, "COMMERCIAL_ONLY");
  const read = await simulationsHttp(request(f), row.id, runtime(f)); assert.equal(read.status, 200); assert.deepEqual(await read.json(), row);
  assert.match(read.headers.get("cache-control"), /no-store/);
});
test("API persists business BLOCKED without claiming calculation success", async () => {
  const f = await setup(), r = await simulationsHttp(request(f, "POST", JSON.stringify(f.payload({ candidateCommercialTerms: null }))), undefined, runtime(f));
  assert.equal(r.status, 201); const row = await r.json(); assert.equal(row.status, "BLOCKED"); assert.equal(row.result.candidate, null);
});
test("API rejects malformed content JSON oversize and injected state", async () => {
  const f = await setup();
  for (const body of ["{", "x".repeat(MAX_BODY_BYTES + 1), JSON.stringify(f.payload({ result: {} }))]) {
    assert.equal((await simulationsHttp(request(f, "POST", body), undefined, runtime(f))).status, 400);
  }
  assert.equal((await simulationsHttp(request(f, "POST", "{}", { "Content-Type": "text/plain" }), undefined, runtime(f))).status, 400);
});
test("API denies forged cookies CSRF and query authority", async () => {
  const f = await setup();
  for (const cookie of ["", `${SESSION_COOKIE}=forged`, `${SESSION_COOKIE}=${f.token}; ${SESSION_COOKIE}=${f.token}`]) {
    assert.equal((await simulationsHttp(request(f, "GET", undefined, { Cookie: cookie }), undefined, runtime(f))).status, 403);
  }
  assert.equal((await simulationsHttp(request(f, "POST", "{}", { Origin: "https://other.test" }), undefined, runtime(f))).status, 403);
  for (const query of ["?tenantId=tenant_other", "?targetTenantId=tenant_test&targetTenantId=tenant_other"]) {
    assert.equal((await simulationsHttp(request(f, "GET", undefined, {}, query), undefined, runtime(f))).status, 400);
  }
});
test("API has no update recalculate or delete", async () => {
  const f = await setup();
  for (const method of ["PUT", "PATCH", "DELETE", "POST"]) {
    assert.equal((await simulationsHttp(request(f, method), f.bill.id, runtime(f))).status, 405);
  }
});
test("API outage is 503 without synthetic list or internal diagnostics", async () => {
  const f = await setup(); f.store.list = async () => { throw new Error("private-provider-secret"); };
  const r = await simulationsHttp(request(f), undefined, runtime(f)); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /private-provider-secret/);
});
