import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260915090000_harden_runtime_acl.sql", import.meta.url), "utf8");
const supabase = await readFile(new URL("../app/lib/production/supabase.ts", import.meta.url), "utf8");
const persistence = await readFile(new URL("../app/lib/persistence/adapter.ts", import.meta.url), "utf8");

for (const table of ["runtime_records", "runtime_users", "runtime_memberships", "runtime_sessions", "runtime_identities"]) {
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`), `${table} client roles revoked`);
  assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role;`), `${table} service role granted`);
}

assert.match(migration, /runtime_sessions_membership_fk/);
assert.match(migration, /foreign key \(user_id, tenant_id\)/);
assert.match(migration, /references public\.runtime_memberships \(user_id, tenant_id\)/);
assert.match(supabase, /runtime_memberships/);
assert.match(supabase, /membership\.status !== "ACTIVE"/);
assert.match(supabase, /membership\.role !== session\.role/);
assert.match(supabase, /user\.active !== true/);
assert.match(supabase, /identity\.provider !== "supabase"/);
assert.match(supabase, /foundation-invitations/);
assert.match(supabase, /foundation-memberships/);
assert.match(persistence, /foundationInvitations/);
assert.match(persistence, /foundationMemberships/);

console.log("PRODUCTION_PERSISTENCE_SCHEMA_SMOKE=OK");
