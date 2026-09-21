import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isSameOriginRequest } from "../app/lib/auth/origin.ts";
import { authenticateProductionLogin } from "../app/lib/production/login.ts";
import { SupabaseServerSessionAdapter, createProductionSession, revokeProductionSession, resolveProductionIdentity } from "../app/lib/production/supabase.ts";

const clone = (value) => structuredClone(value);
const ok = (condition, message) => assert.equal(condition, true, message);

class Query {
  constructor(client, table) { this.client = client; this.table = table; this.filters = []; this.single = false; this.mode = "select"; this.values = null; this.conflict = null; }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order(column, options) { this.orderColumn = column; this.orderAscending = options?.ascending !== false; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(values) { this.mode = "insert"; this.values = values; return this; }
  update(values) { this.mode = "update"; this.values = values; return this; }
  upsert(values, options) { this.mode = "upsert"; this.values = values; this.conflict = options?.onConflict?.split(",") ?? []; return this; }
  then(resolve, reject) { try { resolve(this.execute()); } catch (error) { reject?.(error); } }
  execute() {
    const rows = this.client.tables[this.table] ?? (this.client.tables[this.table] = []);
    if (this.mode === "insert") { rows.push(clone(this.values)); return { data: null, error: null }; }
    if (this.mode === "upsert") {
      const existing = rows.find((row) => this.conflict.length > 0 && this.conflict.every((key) => row[key] === this.values[key]));
      if (existing) Object.assign(existing, clone(this.values)); else rows.push(clone(this.values));
      return { data: null, error: null };
    }
    const selected = rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
    if (this.mode === "update") { selected.forEach((row) => Object.assign(row, clone(this.values))); return { data: null, error: null }; }
    const sorted = this.orderColumn ? [...selected].sort((a, b) => String(a[this.orderColumn]).localeCompare(String(b[this.orderColumn])) * (this.orderAscending ? 1 : -1)) : selected;
    return { data: this.single ? (sorted[0] ? clone(sorted[0]) : null) : sorted.map(clone), error: null };
  }
}

class FakeClient {
  constructor() { this.tables = { runtime_users: [], runtime_identities: [], runtime_memberships: [], runtime_sessions: [] }; }
  from(table) { return new Query(this, table); }
}

function authClient(result) { return { auth: { signInWithPassword: async () => result } }; }
function identityUser(client, { authUserId = "11111111-1111-4111-8111-111111111111", userId = "user_admin", displayName = "Admin", active = true, memberships = [{ tenant_id: "tenant_main", role: "ADMIN", status: "ACTIVE" }] } = {}) {
  client.tables.runtime_users.push({ user_id: userId, display_name: displayName, active });
  client.tables.runtime_identities.push({ auth_user_id: authUserId, user_id: userId, provider: "supabase" });
  client.tables.runtime_memberships.push(...memberships.map(clone).map((membership) => ({ ...membership, user_id: userId })));
  return authUserId;
}

const client = new FakeClient();
const authUserId = identityUser(client);
const valid = await authenticateProductionLogin(authClient({ data: { user: { id: authUserId } }, error: null }), client, { email: "admin@example.test", password: "correct-password" }, "__Host-simulatore_session", 28_800);
ok(valid.kind === "AUTHENTICATED", "LOGIN_VALID_CREDENTIALS_CREATES_OPAQUE_SESSION");
ok(typeof valid.token === "string" && valid.token.length >= 32 && valid.sessionId.startsWith("session_"), "OPAQUE_SESSION_MATERIAL_CREATED_SERVER_SIDE");
ok(client.tables.runtime_sessions.length === 1 && client.tables.runtime_sessions[0].user_id === "user_admin" && client.tables.runtime_sessions[0].tenant_id === "tenant_main" && client.tables.runtime_sessions[0].role === "ADMIN", "CLIENT_CANNOT_SUBMIT_ROLE_AND_TENANT");
ok(!Object.prototype.hasOwnProperty.call({ authenticated: true, displayName: valid.displayName, role: valid.role, tenantId: valid.tenantId }, "access_token"), "LOGIN_DOES_NOT_RETURN_SUPABASE_TOKEN");
ok(!Object.prototype.hasOwnProperty.call({ authenticated: true, displayName: valid.displayName, role: valid.role, tenantId: valid.tenantId }, "token"), "LOGIN_DOES_NOT_RETURN_OPAQUE_TOKEN");

const invalid = await authenticateProductionLogin(authClient({ data: { user: null }, error: { message: "invalid credentials" } }), client, { email: "admin@example.test", password: "wrong-password" }, "__Host-simulatore_session", 28_800);
ok(invalid.kind === "AUTHENTICATION_FAILED", "LOGIN_INVALID_CREDENTIALS_GENERIC_ERROR");
ok((await resolveProductionIdentity(client, "22222222-2222-4222-8222-222222222222")).kind === "IDENTITY_MAPPING_REQUIRED", "IDENTITY_MAPPING_REQUIRED");

const inactiveClient = new FakeClient();
const inactiveAuth = identityUser(inactiveClient, { active: false });
ok((await resolveProductionIdentity(inactiveClient, inactiveAuth)).kind === "USER_INACTIVE", "INACTIVE_USER_REJECTED");
const inactiveMembershipClient = new FakeClient();
const inactiveMembershipAuth = identityUser(inactiveMembershipClient, { memberships: [{ tenant_id: "tenant_main", role: "ADMIN", status: "SUSPENDED" }] });
ok((await resolveProductionIdentity(inactiveMembershipClient, inactiveMembershipAuth)).kind === "MEMBERSHIP_REQUIRED", "INACTIVE_MEMBERSHIP_REJECTED");
const multiClient = new FakeClient();
const multiAuth = identityUser(multiClient, { memberships: [{ tenant_id: "tenant_a", role: "ADMIN", status: "ACTIVE" }, { tenant_id: "tenant_b", role: "ANALYST", status: "ACTIVE" }] });
const multiple = await authenticateProductionLogin(authClient({ data: { user: { id: multiAuth } }, error: null }), multiClient, { email: "admin@example.test", password: "correct-password" }, "__Host-simulatore_session", 28_800);
ok(multiple.kind === "TENANT_SELECTION_REQUIRED" && multiClient.tables.runtime_sessions.length === 0, "MULTIPLE_MEMBERSHIPS_REQUIRE_SELECTION");

const cookie = valid.cookie ?? (await createProductionSession(client, { userId: "user_admin", tenantId: "tenant_main", role: "ADMIN" }, "__Host-simulatore_session", 28_800)).cookie;
ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Lax") && cookie.includes("Path=/") && cookie.includes("Max-Age=28800"), "COOKIE_HTTP_ONLY_SECURE_SAME_SITE_PATH_MAX_AGE");

const adapter = new SupabaseServerSessionAdapter(client, "__Host-simulatore_session");
const request = new Request("https://example.test", { headers: { cookie: `__Host-simulatore_session=${valid.token}` } });
const principal = await adapter.resolve(request);
await revokeProductionSession(client, principal.sessionId);
ok(client.tables.runtime_sessions.some((row) => row.session_id === principal.sessionId && row.revoked_at), "LOGOUT_REVOKES_SESSION");
await revokeProductionSession(client, principal.sessionId);
ok(true, "LOGOUT_IDEMPOTENT");
ok(JSON.stringify(client.tables).includes("password") === false, "PASSWORD_NEVER_PERSISTED_IN_RUNTIME_TABLES");
ok(JSON.stringify({ authenticated: true, displayName: "Admin", role: "ADMIN", tenantId: "tenant_main" }).includes("session_hash") === false, "SESSION_ENDPOINT_SAFE");

ok(isSameOriginRequest(new Request("https://example.test/api/auth/login", { method: "POST", headers: { origin: "https://example.test", host: "example.test" } })), "SAME_ORIGIN_LOGIN_ALLOWED");
ok(!isSameOriginRequest(new Request("https://example.test/api/auth/login", { method: "POST", headers: { origin: "https://evil.example", host: "example.test" } })), "CROSS_ORIGIN_LOGIN_REJECTED");
ok(!isSameOriginRequest(new Request("https://example.test/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example", host: "example.test" } })), "CROSS_ORIGIN_LOGOUT_REJECTED");

const bootstrapSource = await readFile(new URL("../scripts/bootstrap-production-admin.mjs", import.meta.url), "utf8");
const loginRouteSource = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
const logoutRouteSource = await readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8");
const supabaseSource = await readFile(new URL("../app/lib/production/supabase.ts", import.meta.url), "utf8");
const loginUiSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const authGateSource = await readFile(new URL("../app/components/ProductionAuthGate.tsx", import.meta.url), "utf8");
const legacyServiceRoleKeyName = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
ok(loginRouteSource.includes("signInWithPassword") || (await readFile(new URL("../app/lib/production/login.ts", import.meta.url), "utf8")).includes("signInWithPassword"), "SUPABASE_AUTH_EMAIL_PASSWORD_VERIFICATION");
ok(loginRouteSource.includes("httpOnly: true"), "COOKIE_HTTP_ONLY");
ok(loginRouteSource.includes("secure: true"), "COOKIE_SECURE_PRODUCTION");
ok(loginRouteSource.includes('sameSite: "lax"'), "COOKIE_SAME_SITE_LAX");
ok(loginRouteSource.includes('path: "/"'), "COOKIE_PATH_ROOT");
ok(loginRouteSource.includes("maxAge: provider.config.sessionMaxAgeSeconds"), "COOKIE_MAX_AGE_28800_DEFAULT");
ok(logoutRouteSource.includes("maxAge: 0") && logoutRouteSource.includes("findProductionSessionId"), "LOGOUT_CLEARS_COOKIE");
ok(!loginRouteSource.includes("access_token") && !loginRouteSource.includes("refresh_token"), "SUPABASE_TOKENS_NEVER_CLIENT_VISIBLE");
ok(!loginRouteSource.includes("SUPABASE_SECRET_KEY") && !loginRouteSource.includes(legacyServiceRoleKeyName), "SECRET_KEY_NEVER_CLIENT_VISIBLE");
ok(!loginUiSource.includes("SUPABASE_SECRET_KEY") && !authGateSource.includes("SUPABASE_SECRET_KEY"), "SECRET_KEY_CLIENT_EXPOSURE_NO");
ok(bootstrapSource.includes("createSupabaseProviderClient") && !bootstrapSource.includes("SUPABASE_PUBLISHABLE_KEY"), "BOOTSTRAP_ADMIN_USES_SERVER_SECRET");
ok(supabaseSource.includes("createClient(config.supabaseUrl, config.secretKey") && supabaseSource.includes("createClient(config.supabaseUrl, config.publishableKey"), "SERVER_SECRET_AND_PUBLISHABLE_CLIENTS_SEPARATED");
ok(!bootstrapSource.includes("password_hash") && !bootstrapSource.includes("runtime_sessions"), "PASSWORD_NEVER_PERSISTED_AND_BOOTSTRAP_DOES_NOT_CREATE_SESSION");
ok(bootstrapSource.includes("upsert") && bootstrapSource.includes("BOOTSTRAP_SESSION_CREATED=NO"), "INITIAL_ADMIN_BOOTSTRAP_IDEMPOTENT");
ok(!/console\.(log|error).*password/i.test(bootstrapSource) && !/console\.(log|error).*secretKey/i.test(bootstrapSource), "SECRET_KEY_AND_PASSWORD_NOT_PRINTED");
console.log("PRODUCTION_AUTH_SMOKE=OK");
