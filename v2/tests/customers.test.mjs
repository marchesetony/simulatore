import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CustomerService } from "../modules/customers/service.ts";
import { SupabaseCustomerRepository } from "../modules/customers/repository.ts";
import { customersHttp } from "../modules/customers/http.ts";
import { customerInput } from "../modules/customers/schema.ts";
import { customerPermissions, permissions } from "../modules/auth/schema.ts";
import { authorize } from "../modules/auth/access.ts";
import { login } from "../modules/auth/service.ts";
import { verifySession } from "../modules/auth/session.ts";
import { SupabaseHttp } from "../modules/auth/supabase-http.ts";
import { SESSION_COOKIE } from "../modules/auth/http.ts";
import { fixture, assignment, credentials } from "./fixtures.mjs";

const input = { name: "Soggetto test", taxCode: "ABCDE12345", vatNumber: null };
const businessPermissions = ["customers:list", "customers:read", "customers:create", "customers:update"];
const id = "00000000-0000-4000-8000-000000000001";
async function setup(role = "TENANT_ADMIN") {
  const f = fixture([assignment(role)]); const data = [];
  const repo = {
    list: async tenant => data.filter(row => row.tenantId === tenant),
    get: async (tenant, id) => data.find(row => row.tenantId === tenant && row.id === id) ?? null,
    create: async row => { data.push(row); return row; },
    update: async (tenant, id, value) => {
      const row = data.find(row => row.tenantId === tenant && row.id === id);
      if (!row) return null; Object.assign(row, value); return row;
    },
  };
  const result = await login(credentials, f.deps); assert.equal(result.kind, "AUTHENTICATED");
  return { ...f, token: result.token, data, repo, service: new CustomerService(f.deps, repo) };
}

for (const role of ["TENANT_ADMIN", "SALES_MANAGER", "SALES_OPERATOR", "PLATFORM_OWNER"]) {
  test(`${role}: four server-derived permissions and scoped CRUD`, async () => {
    const f = await setup(role); assert.deepEqual(customerPermissions(role), businessPermissions);
    const target = role === "PLATFORM_OWNER" ? "tenant_test" : undefined;
    assert.deepEqual(await f.service.list(f.token, target), []);
    const row = await f.service.create(f.token, input, target);
    assert.match(row.id, /^[a-f0-9-]{36}$/); assert.equal("tenantId" in row, false);
    assert.equal(f.data[0].tenantId, "tenant_test");
    assert.deepEqual(await f.service.get(f.token, row.id, target), row);
    assert.equal((await f.service.update(f.token, row.id, { ...input, name: "Aggiornato" }, target)).name, "Aggiornato");
    assert.equal((await f.service.list(f.token, target)).length, 1);
  });
}

test("tenant list/read/update never cross ownership; client target cannot override", async () => {
  const f = await setup(); f.data.push({ ...input, id, tenantId: "tenant_other" });
  assert.deepEqual(await f.service.list(f.token), []);
  await assert.rejects(() => f.service.get(f.token, id), { code: "NOT_FOUND" });
  await assert.rejects(() => f.service.update(f.token, id, input), { code: "NOT_FOUND" });
  await assert.rejects(() => f.service.list(f.token, "tenant_other"), { code: "DENIED" });
  assert.equal(f.data[0].name, input.name);
  f.repo.list = async () => f.data;
  await assert.rejects(() => f.service.list(f.token), { code: "DENIED" });
});

test("PLATFORM requires active explicit target for every operation, without mutating principal", async () => {
  const f = await setup("PLATFORM_OWNER");
  for (const target of [undefined, "tenant_other", "invalid"]) {
    for (const call of [() => f.service.list(f.token, target), () => f.service.get(f.token, id, target),
      () => f.service.create(f.token, input, target), () => f.service.update(f.token, id, input, target)]) {
      await assert.rejects(call, { code: "DENIED" });
    }
  }
  f.data.push({ ...input, id, tenantId: "tenant_other" });
  assert.deepEqual(await f.service.list(f.token, "tenant_test"), []);
  const principal = await verifySession(f.token, f.deps.sessions, f.deps.access);
  assert.equal(principal.scope, "PLATFORM"); assert.equal("tenantId" in principal, false);
});

test("create/update reject invalid payloads, ownership, client permissions and technical ids", async () => {
  const f = await setup(); const row = await f.service.create(f.token, input);
  for (const payload of [null, [], {}, { ...input, name: " " }, { ...input, taxCode: "!" },
    ...["id", "tenantId", "role", "scope", "permissions", "pod", "pdr", "consumption", "cte", "simulation"].map(key => ({ ...input, [key]: "injected" }))]) {
    await assert.rejects(() => f.service.create(f.token, payload), { code: "INVALID_INPUT" });
    await assert.rejects(() => f.service.update(f.token, row.id, payload), { code: "INVALID_INPUT" });
  }
  assert.equal(f.data.length, 1); assert.equal(f.data[0].tenantId, "tenant_test");
  assert.deepEqual(Object.keys(customerInput(input)), ["name", "taxCode", "vatNumber"]);
});

for (const role of ["PRODUCT_OWNER", "ADMIN", "ANALYST", "VIEWER"]) {
  test(`${role}: no Customer grant even with injected permission or auth:session`, async () => {
    const f = await setup(); f.rows[0].role = role; f.rows[0].permissions = ["auth:session", ...businessPermissions];
    assert.throws(() => customerPermissions(role));
    await assert.rejects(() => f.service.list(f.token));
    assert.equal(await authorize({ userId: "u", authUserId: "a", assignmentId: "i", role,
      scope: "TENANT", tenantId: "tenant_test", membershipStatus: "ACTIVE", permissions: ["auth:session"] },
    "customers:list", "TENANT", f.deps.access, "tenant_test"), false);
  });
}

test("explicit permission set rejects delete, wildcards and unknowns; canonical role is required", async () => {
  assert.deepEqual(permissions(["auth:login", "auth:session", ...businessPermissions]), ["auth:login", "auth:session", ...businessPermissions]);
  for (const value of ["customers:delete", "customers:*", "*", "other"]) assert.throws(() => permissions([value]));
  const f = await setup(); f.rows[0].status = "SUSPENDED";
  await assert.rejects(() => f.service.list(f.token));
  await assert.rejects(() => f.service.list("forged"));
});

test("API boundary keeps tenant private, rejects CSRF/claims and returns safe outage, never demo rows", async () => {
  const f = await setup(); const runtime = () => ({ service: f.service, origin: "https://app.example.test" });
  const req = (method = "GET", payload, origin = "https://app.example.test") => new Request("https://app.example.test/api/v2/customers", {
    method, headers: { Cookie: `${SESSION_COOKIE}=${f.token}`, Origin: origin, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  assert.deepEqual(await (await customersHttp(req(), undefined, runtime)).json(), []);
  assert.equal((await customersHttp(req("POST", { ...input, permissions: businessPermissions }), undefined, runtime)).status, 400);
  assert.equal((await customersHttp(req("POST", input, "https://attacker.test"), undefined, runtime)).status, 403);
  const created = await customersHttp(req("POST", input), undefined, runtime);
  assert.equal(created.status, 201); assert.equal("tenantId" in await created.json(), false);
  f.repo.list = async () => { throw new Error("private database diagnostic"); };
  const failed = await customersHttp(req(), undefined, runtime);
  assert.equal(failed.status, 503); assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { message: "Servizio clienti temporaneamente non disponibile." });
});

test("real Supabase adapter filters every query by tenant and never writes ownership on update", async () => {
  const calls = []; let returnedTenant = "tenant_test";
  const http = new SupabaseHttp({ supabaseUrl: "https://synthetic.supabase.co", secretKey: "synthetic", publishableKey: "synthetic" },
    async (url, init) => { calls.push({ url: new URL(url), init }); return Response.json([
      { id, tenant_id: returnedTenant, name: input.name, tax_code: input.taxCode, vat_number: null },
    ]); });
  const repo = new SupabaseCustomerRepository(http);
  await repo.list("tenant_test"); await repo.get("tenant_test", id);
  await repo.create({ ...input, id, tenantId: "tenant_test" }); await repo.update("tenant_test", id, input);
  for (const call of calls) assert.equal(call.url.searchParams.get("tenant_id"), "eq.tenant_test");
  assert.equal(calls[3].url.searchParams.get("id"), `eq.${id}`);
  assert.deepEqual(Object.keys(JSON.parse(calls[3].init.body)), ["name", "tax_code", "vat_number"]);
  returnedTenant = "tenant_other"; await assert.rejects(() => repo.list("tenant_test"), { code: "UNAVAILABLE" });
});

test("rendered form has no ownership or business fields; real empty list contains no demo", () => {
  const source = readFileSync(new URL("../app/customers/customers.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const require = createRequire(import.meta.url); const renderedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => name.endsWith(".css") ? {} : require(name), renderedModule, renderedModule.exports);
  const html = renderToStaticMarkup(createElement(renderedModule.exports.CustomerForm, { initial: null, busy: false, save: async () => {}, cancel: () => {} }));
  assert.deepEqual([...html.matchAll(/name="([^"]+)"/g)].map(match => match[1]), ["name", "taxCode", "vatNumber"]);
  assert.match(html, /method="post"/);
  assert.match(renderToStaticMarkup(createElement(renderedModule.exports.CustomerList, { rows: [], busy: false, open: () => {} })), /Nessun cliente presente/);
  for (const path of ["../../app/api/v2/customers/route.ts", "../../app/api/v2/customers/[id]/route.ts"]) {
    const route = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(route, /repository|Supabase|JSON\.parse|DELETE/); assert.match(route, /customersHttp/);
  }
});

test("API get/update enforce isolation and reject malformed JSON, oversized bodies and duplicate cookies", async () => {
  const f = await setup(); f.data.push({ ...input, id, tenantId: "tenant_other" });
  const runtime = () => ({ service: f.service, origin: "https://app.example.test" });
  const request = (method, body, cookie = `${SESSION_COOKIE}=${f.token}`) => new Request(`https://app.example.test/api/v2/customers/${id}`, {
    method, headers: { Cookie: cookie, Origin: runtime().origin, "Content-Type": "application/json" }, body,
  });
  assert.equal((await customersHttp(request("GET"), id, runtime)).status, 404);
  assert.equal((await customersHttp(request("PUT", JSON.stringify(input)), id, runtime)).status, 404);
  for (const body of ["{", "x".repeat(5000), JSON.stringify({ ...input, tenantId: "tenant_test" })]) {
    assert.equal((await customersHttp(request("PUT", body), id, runtime)).status, 400);
  }
  for (const cookie of ["", `${SESSION_COOKIE}=forged`, `${SESSION_COOKIE}=${f.token}; ${SESSION_COOKIE}=${f.token}`]) {
    assert.equal((await customersHttp(request("GET", undefined, cookie), id, runtime)).status, 403);
  }
  assert.equal(f.data[0].tenantId, "tenant_other");
});

test("Customer SQL proposal denies public roles and restricts server updates to anagraphic fields", () => {
  const sql = readFileSync(new URL("../migrations/20261007000000_customers_v2.proposed.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.v2_customers from public, anon, authenticated, service_role/);
  assert.match(sql, /grant update\(name, tax_code, vat_number\) on public\.v2_customers to service_role/);
  assert.doesNotMatch(sql, /grant (?:delete|all|update on)|create policy|security definer/i);
});

test("datastore missing, malformed rows and excessive lists fail explicitly instead of returning demo/partial data", async () => {
  for (const response of [() => new Response(null, { status: 404 }), () => Response.json({ message: "raw" }),
    () => Response.json([{ id, tenant_id: "tenant_test", name: "test" }]), () => Response.json(Array(101).fill({}))]) {
    const http = new SupabaseHttp({ supabaseUrl: "https://synthetic.supabase.co", secretKey: "synthetic" }, async () => response());
    await assert.rejects(() => new SupabaseCustomerRepository(http).list("tenant_test"), { code: "UNAVAILABLE" });
  }
});
