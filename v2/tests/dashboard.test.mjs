import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { login, loginFailure } from "../modules/auth/service.ts";
import { dashboardView } from "../app/dashboard/access.ts";
import { SESSION_COOKIE } from "../modules/auth/http.ts";
import { fixture, assignment, credentials } from "./fixtures.mjs";

function component(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const require = createRequire(import.meta.url);
  const renderedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name =>
    imports[name] ?? (name.endsWith(".css") ? {} : require(name)), renderedModule, renderedModule.exports);
  return renderedModule.exports.default;
}

const Dashboard = component("../app/dashboard/dashboard.tsx");
function page(deps, tokens) {
  return component("../../app/v2/dashboard/page.tsx", {
    "next/headers": { cookies: async () => ({ getAll: name => {
      assert.equal(name, SESSION_COOKIE); return tokens.map(value => ({ value }));
    } }) },
    "next/navigation": { redirect: url => { throw new Error(`REDIRECT:${url}`); } },
    "@/v2/modules/auth/runtime": { authRuntime: () => ({ dependencies: deps }) },
    "@/v2/modules/auth/http": { SESSION_COOKIE },
    "@/v2/modules/auth/service": { loginFailure },
    "@/v2/app/dashboard/access": { dashboardView },
    "@/v2/app/dashboard/dashboard": { default: Dashboard, __esModule: true },
  });
}

async function authenticated(role = "TENANT_ADMIN") {
  const f = fixture([assignment(role)]);
  const result = await login(credentials, f.deps);
  assert.equal(result.kind, "AUTHENTICATED");
  return { ...f, token: result.token };
}

test("valid tenant session opens real page with only verified identity and tenant", async () => {
  const f = await authenticated();
  assert.deepEqual(await dashboardView(f.token, f.deps), {
    userId: "user_test", roleLabel: "Amministratore azienda", scope: "TENANT", tenantId: "tenant_test",
  });
  const html = renderToStaticMarkup(await page(f.deps, [f.token])());
  assert.match(html, /<h1>Dashboard<\/h1>/);
  assert.match(html, /tenant_test/);
  assert.doesNotMatch(html, /provider-user|sessionHash|assignment-test/);
  assert.ok(!html.includes(f.token));
});

test("PLATFORM_OWNER page has platform scope and no invented tenant", async () => {
  const f = await authenticated("PLATFORM_OWNER");
  const view = await dashboardView(f.token, f.deps);
  assert.equal(view.scope, "PLATFORM");
  assert.equal("tenantId" in view, false);
  const html = renderToStaticMarkup(await page(f.deps, [f.token])());
  assert.match(html, /Piattaforma/);
  assert.doesNotMatch(html, /TENANT CORRENTE|tenant_test/);
});

for (const [name, mutate] of [
  ["missing", () => []], ["invalid", () => ["forged"]],
  ["duplicate", f => [f.token, f.token]],
  ["expired", f => { [...f.stored.values()][0].expiresAt = new Date(0).toISOString(); return [f.token]; }],
  ["revoked", f => { [...f.stored.values()][0].revokedAt = new Date().toISOString(); return [f.token]; }],
  ["inactive membership", f => { f.rows[0].status = "SUSPENDED"; return [f.token]; }],
  ["missing permission", f => { f.rows[0].permissions = ["auth:login"]; return [f.token]; }],
]) {
  test(`${name} session denies dashboard at server page`, async () => {
    const f = await authenticated();
    await assert.rejects(page(f.deps, mutate(f)), { message: "REDIRECT:/v2/login" });
  });
}

for (const role of ["PRODUCT_OWNER", "ADMIN", "ANALYST", "VIEWER"]) {
  test(`${role} cannot enter dashboard through implicit mapping`, async () => {
    const f = await authenticated(); f.rows[0].role = role;
    await assert.rejects(page(f.deps, [f.token]), { message: "REDIRECT:/v2/login" });
  });
}

test("infrastructure failure renders safe unavailable state without dashboard", async () => {
  const f = await authenticated();
  f.deps.sessions.find = async () => { throw new Error("private provider diagnostic"); };
  const html = renderToStaticMarkup(await page(f.deps, [f.token])());
  assert.match(html, /Accesso temporaneamente non disponibile/);
  assert.doesNotMatch(html, /<h1>Dashboard|user_test|tenant_test|private provider diagnostic/);
});

test("future navigation stays disabled and no synthetic commercial data is rendered", async () => {
  const f = await authenticated();
  const html = renderToStaticMarkup(await page(f.deps, [f.token])());
  assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 2);
  assert.equal((html.match(/Non ancora disponibile/g) ?? []).length, 4);
  for (const name of ["Clienti", "Bollette", "Simulazioni", "CTE", "Regolatorio / Mercato", "Proposte"]) {
    assert.ok(html.includes(name));
  }
  assert.deepEqual([...new Set([...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]))],
    ["#contenuto", "/v2/dashboard", "/v2/customers", "/v2/bills", "/v2/simulations", "/v2/cte"]);
  assert.doesNotMatch(html, /€|kWh|fatturato|risparmio|<table|<button|<input/i);
});

test("successful login connects to the fixed protected dashboard route", () => {
  const source = readFileSync(new URL("../app/login/login-form.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(session\.ok\) window\.location\.replace\("\/v2\/dashboard"\)/);
});
