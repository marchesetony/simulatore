import { randomUUID } from "node:crypto";

import { createSupabaseProviderClient, readProductionProviderConfig } from "../app/lib/production/supabase.ts";

const TENANT_PATTERN = /^tenant_[a-z0-9-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code) { throw new Error(code); }
function required(name) { const value = process.env[name]?.trim(); if (!value) fail(`BOOTSTRAP_${name}_REQUIRED`); return value; }
function unwrap(result, fallback = "SUPABASE_PROVIDER_ERROR") { if (result.error) fail(result.error.code || fallback); return result.data; }

function readBootstrapInput() {
  const email = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const displayName = required("BOOTSTRAP_ADMIN_DISPLAY_NAME");
  const tenantId = required("BOOTSTRAP_ADMIN_TENANT_ID");
  if (!EMAIL_PATTERN.test(email) || email.length > 320) fail("BOOTSTRAP_ADMIN_EMAIL_INVALID");
  if (typeof password !== "string" || password.length < 8 || password.length > 4096) fail("BOOTSTRAP_ADMIN_PASSWORD_INVALID");
  if (displayName.length > 160) fail("BOOTSTRAP_ADMIN_DISPLAY_NAME_INVALID");
  if (!TENANT_PATTERN.test(tenantId)) fail("BOOTSTRAP_ADMIN_TENANT_ID_INVALID");
  return { email, password, displayName, tenantId };
}

async function listAllUsers(client) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = unwrap(await client.auth.admin.listUsers({ page, perPage: 1000 }));
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  fail("BOOTSTRAP_USER_LIST_LIMIT");
}

async function ensureAuthUser(client, input) {
  const existing = (await listAllUsers(client)).find((user) => user.email?.trim().toLowerCase() === input.email);
  if (existing?.id) return { id: existing.id, created: false };
  const created = unwrap(await client.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true }));
  if (!created.user?.id) fail("BOOTSTRAP_AUTH_USER_EMPTY");
  return { id: created.user.id, created: true };
}

async function ensureRuntimeIdentity(client, authUserId, input) {
  const identity = unwrap(await client.from("runtime_identities").select("auth_user_id,user_id,provider").eq("auth_user_id", authUserId).maybeSingle());
  if (identity && (identity.provider !== "supabase" || !/^user_[a-z0-9-]+$/.test(identity.user_id))) fail("BOOTSTRAP_IDENTITY_INVALID");
  const userId = identity?.user_id ?? `user_${randomUUID()}`;
  unwrap(await client.from("runtime_users").upsert({ user_id: userId, display_name: input.displayName, active: true }, { onConflict: "user_id" }));
  if (!identity) unwrap(await client.from("runtime_identities").insert({ auth_user_id: authUserId, user_id: userId, provider: "supabase" }));
  return userId;
}

async function ensureMembership(client, userId, tenantId) {
  unwrap(await client.from("runtime_memberships").upsert({ user_id: userId, tenant_id: tenantId, role: "ADMIN", status: "ACTIVE" }, { onConflict: "user_id,tenant_id" }));
}

async function main() {
  const input = readBootstrapInput();
  const provider = readProductionProviderConfig();
  if (!provider.valid) fail(`BOOTSTRAP_PROVIDER_CONFIG_INVALID:${provider.missing.join(",")}`);
  const client = createSupabaseProviderClient(provider.config);
  const authUser = await ensureAuthUser(client, input);
  const userId = await ensureRuntimeIdentity(client, authUser.id, input);
  await ensureMembership(client, userId, input.tenantId);
  console.log(`BOOTSTRAP_ADMIN_STATUS=READY\nBOOTSTRAP_AUTH_USER_STATE=${authUser.created ? "CREATED" : "EXISTING"}\nBOOTSTRAP_RUNTIME_USER_ID=${userId}\nBOOTSTRAP_TENANT_ID=${input.tenantId}\nBOOTSTRAP_SESSION_CREATED=NO`);
}

try {
  await main();
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_:,-]+$/.test(error.message) ? error.message : "BOOTSTRAP_FAILED";
  console.error(`BOOTSTRAP_ADMIN_STATUS=FAILED\nBOOTSTRAP_ADMIN_ERROR=${code}`);
  process.exitCode = 1;
}
