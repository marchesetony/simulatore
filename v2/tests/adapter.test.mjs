import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseHttp } from "../modules/auth/supabase-http.ts";
import { SupabaseAuthProvider } from "../modules/auth/provider.ts";
import { SupabaseAccessRepository, SupabaseSessionRepository } from "../modules/auth/supabase-repository.ts";
import { login } from "../modules/auth/service.ts";
import { assignment, credentials } from "./fixtures.mjs";

const config = { supabaseUrl: "https://synthetic.supabase.co", publishableKey: "sb_publishable_test",
  secretKey: "sb_secret_test", origin: "https://example.test", sessionSeconds: 300 };

test("complete login through real HTTP adapters with synthetic Supabase contract", async () => {
  const calls = []; let stored;
  const http = new SupabaseHttp(config, async (url, init) => {
    const parsed = new URL(url); calls.push(parsed.pathname);
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    const body = (() => {
      switch (parsed.pathname) {
        case "/auth/v1/token":
          assert.equal(init.headers.apikey, config.publishableKey);
          assert.equal(parsed.searchParams.get("grant_type"), "password");
          assert.deepEqual(JSON.parse(init.body), credentials);
          return { access_token: "synthetic-provider-token", user: { id: "provider-user" } };
        case "/auth/v1/user":
          assert.equal(init.headers.Authorization, "Bearer synthetic-provider-token");
          return { id: "provider-user", is_anonymous: false };
        case "/rest/v1/runtime_identities":
          assert.equal(parsed.searchParams.get("auth_user_id"), "eq.provider-user");
          return [{ auth_user_id: "provider-user", user_id: "user_test", provider: "supabase" }];
        case "/rest/v1/runtime_users": return [{ user_id: "user_test", active: true }];
        case "/rest/v1/v2_auth_assignments": return [assignment()];
        case "/rest/v1/v2_auth_tenants": return [{ tenant_id: "tenant_test", active: true }];
        case "/rest/v1/v2_auth_sessions":
          if (init.method === "POST") { stored = JSON.parse(init.body); return [stored]; }
          assert.equal(parsed.searchParams.get("session_hash"), `eq.${stored.session_hash}`);
          return [stored];
        default: assert.fail(`Unexpected path ${parsed.pathname}`);
      }
    })();
    if (parsed.pathname.startsWith("/rest/")) assert.equal(init.headers.apikey, config.secretKey);
    return Response.json(body);
  });
  const result = await login(credentials, { provider: new SupabaseAuthProvider(http),
    access: new SupabaseAccessRepository(http), sessions: new SupabaseSessionRepository(http), sessionSeconds: 300 });
  assert.equal(result.kind, "AUTHENTICATED");
  assert.equal(calls.filter(path => path === "/rest/v1/runtime_identities").length, 2);
  assert.equal(stored.session_hash.length, 64);
  assert.ok(!JSON.stringify(stored).includes(result.token));
});

test("HTTP distinguishes invalid credentials from outage, rate limit and malformed response", async () => {
  for (const [response, expected] of [
    [Response.json({ error_code: "invalid_credentials" }, { status: 400 }), "INVALID_CREDENTIALS"],
    [Response.json({ error_code: "unexpected_failure" }, { status: 500 }), "PROVIDER_UNAVAILABLE"],
    [Response.json({}, { status: 429 }), "PROVIDER_UNAVAILABLE"],
    [new Response("bad json", { status: 200 }), "PROVIDER_UNAVAILABLE"],
  ]) {
    const provider = new SupabaseAuthProvider(new SupabaseHttp(config, async () => response));
    await assert.rejects(() => provider.verify(credentials), { code: expected });
  }
  const provider = new SupabaseAuthProvider(new SupabaseHttp(config, async () => { throw new Error("network"); }));
  await assert.rejects(() => provider.verify(credentials), { code: "PROVIDER_UNAVAILABLE" });
});

test("provider user mismatch or anonymous identity denied", async () => {
  for (const user of [{ id: "other", is_anonymous: false }, { id: "provider-user", is_anonymous: true }]) {
    const http = new SupabaseHttp(config, async url => Response.json(url.includes("token?") ?
      { access_token: "synthetic", user: { id: "provider-user" } } : user));
    await assert.rejects(() => new SupabaseAuthProvider(http).verify(credentials), { code: "INVALID_CREDENTIALS" });
  }
});
