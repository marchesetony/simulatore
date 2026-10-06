import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseAuthConfig } from "../core/config/auth.ts";
import { handleLogin, handleSession, SESSION_COOKIE } from "../modules/auth/http.ts";
import { fixture, credentials } from "./fixtures.mjs";

export const env = { V2_SUPABASE_URL: "https://synthetic.supabase.co",
  V2_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test", V2_SUPABASE_SECRET_KEY: "sb_secret_synthetic_test",
  V2_AUTH_ORIGIN: "https://app.example.test", V2_AUTH_SESSION_SECONDS: "300" };

test("configuration requires every explicit value and redacts invalid values", () => {
  assert.equal(parseAuthConfig(env).sessionSeconds, 300);
  for (const key of Object.keys(env)) {
    const candidate = { ...env }; delete candidate[key];
    assert.throws(() => parseAuthConfig(candidate), { code: "CONFIGURATION_INVALID", message: "CONFIGURATION_INVALID" });
  }
  for (const [key, value] of [["V2_SUPABASE_URL", "http://unsafe.test"], ["V2_AUTH_ORIGIN", "https://x.test/path"],
    ["V2_AUTH_SESSION_SECONDS", "NaN"], ["V2_AUTH_SESSION_SECONDS", "999999"],
    ["V2_SUPABASE_PUBLISHABLE_KEY", env.V2_SUPABASE_SECRET_KEY]]) {
    assert.throws(() => parseAuthConfig({ ...env, [key]: value }), { code: "CONFIGURATION_INVALID" });
  }
});

const request = (body = credentials, origin = env.V2_AUTH_ORIGIN) => new Request(`${env.V2_AUTH_ORIGIN}/api/v2/auth/login`, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("API sets secure cookie, returns no principal/token and verifies cookie server-side", async () => {
  const { deps } = fixture();
  const response = await handleLogin(request(), env.V2_AUTH_ORIGIN, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
  const cookie = response.headers.get("set-cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(cookie.includes(flag));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const session = await handleSession(new Request("https://app.example.test/api/v2/auth/session", {
    headers: { Cookie: cookie.split(";")[0] },
  }), deps);
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true });
});

test("cross-origin, malformed/oversized payload and extra privilege claims are denied", async () => {
  const { deps, stored } = fixture();
  const requests = [request(credentials, "https://attacker.test"), request({ ...credentials, role: "PLATFORM_OWNER" }),
    request({ ...credentials, password: "x".repeat(5000) }),
    new Request("https://app.example.test", { method: "POST", headers: { Origin: env.V2_AUTH_ORIGIN,
      "Content-Type": "application/json" }, body: "{" })];
  for (const req of requests) assert.equal((await handleLogin(req, env.V2_AUTH_ORIGIN, deps)).status, 401);
  assert.equal(stored.size, 0);
});

test("provider raw errors, secrets and internal failure codes never reach API JSON", async () => {
  const { deps } = fixture();
  deps.provider.verify = async () => { throw new Error(env.V2_SUPABASE_SECRET_KEY); };
  const response = await handleLogin(request(), env.V2_AUTH_ORIGIN, deps);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { authenticated: false,
    message: "Accesso temporaneamente non disponibile. Riprova più tardi." });
});

test("forged or duplicate session cookies cannot authenticate", async () => {
  const { deps } = fixture();
  for (const cookie of ["", `${SESSION_COOKIE}=forged`, `${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`]) {
    assert.equal((await handleSession(new Request("https://app.example.test", { headers: { Cookie: cookie } }), deps)).status, 401);
  }
});

test("UI import graph is isolated from config/provider and server files are guarded", () => {
  const ui = readFileSync(new URL("../app/login/login-form.tsx", import.meta.url), "utf8");
  const imports = [...ui.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(imports, ["react", "./login.module.css"]);
  assert.doesNotMatch(ui, /process\.env|SUPABASE|localStorage|sessionStorage/);
  for (const name of ["runtime", "provider", "supabase-http", "supabase-repository", "service", "session", "access", "http"]) {
    assert.match(readFileSync(new URL(`../modules/auth/${name}.ts`, import.meta.url), "utf8"), /^import "server-only";/);
  }
  assert.match(readFileSync(new URL("../core/config/auth.ts", import.meta.url), "utf8"), /^import "server-only";/);
  for (const entry of readdirSync(new URL("../modules/auth/", import.meta.url))) {
    assert.doesNotMatch(readFileSync(new URL(`../modules/auth/${entry}`, import.meta.url), "utf8"), /process\.env|\bany\b/);
  }
});

test("rendered login form uses POST; JavaScript sends credentials in the body to a fixed URL", () => {
  const source = readFileSync(new URL("../app/login/login-form.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const require = createRequire(import.meta.url);
  const renderedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => name.endsWith(".css") ? {} : require(name), renderedModule, renderedModule.exports);
  const html = renderToStaticMarkup(createElement(renderedModule.exports.default));
  const form = html.match(/<form\b[^>]*>/)?.[0];
  assert.ok(form);
  assert.match(form, /method="post"/);
  assert.match(form, /action="\/api\/v2\/auth\/login"/);
  const syntax = ts.createSourceFile("login-form.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(syntax) === "fetch") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert.deepEqual(calls.map(call => ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text),
    ["/api/v2/auth/login", "/api/v2/auth/session"]);
  assert.match(calls[0].arguments[1].getText(syntax), /method:\s*"POST"/);
  assert.match(calls[0].arguments[1].getText(syntax), /body:\s*JSON\.stringify\(\{ email: fields\.get\("email"\), password: fields\.get\("password"\) \}\)/);
});

test("native HTML POST without JavaScript fails safely without reflecting credentials or redirecting", async () => {
  const { deps, stored } = fixture();
  const req = new Request(`${env.V2_AUTH_ORIGIN}/api/v2/auth/login`, { method: "POST",
    headers: { Origin: env.V2_AUTH_ORIGIN }, body: new URLSearchParams(credentials) });
  const response = await handleLogin(req, env.V2_AUTH_ORIGIN, deps);
  assert.equal(new URL(req.url).search, "");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("location"), null);
  assert.ok(!(await response.text()).includes(credentials.password));
  assert.equal(stored.size, 0);
});
