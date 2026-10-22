import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthRole } from "../auth/types";
import type { AccessDirectory, AccountStatus } from "../access/types";

type QueryResult<T> = PromiseLike<{ readonly data: T; readonly error: { readonly message?: string; readonly code?: string } | null }>;

async function unwrap<T>(query: QueryResult<T>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error("ACCESS_DIRECTORY_UNAVAILABLE");
  return data;
}

/** Supabase Auth logins mapped onto runtime_users / runtime_identities / runtime_memberships. Server side only. */
export class SupabaseAccessDirectory implements AccessDirectory {
  private readonly admin: SupabaseClient;
  private readonly authClient: () => SupabaseClient;
  constructor(admin: SupabaseClient, authClient: () => SupabaseClient) { this.admin = admin; this.authClient = authClient; }

  async createLogin(input: { readonly email: string; readonly password: string; readonly displayName: string }) {
    const { data, error } = await this.admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true, user_metadata: { display_name: input.displayName } });
    if (error) {
      const code = (error as { readonly code?: string }).code ?? "";
      if (code === "email_exists" || code === "user_already_exists" || /already/i.test(error.message)) throw new Error("ACCESS_EMAIL_TAKEN");
      if (code === "weak_password") throw new Error("ACCESS_PASSWORD_WEAK");
      throw new Error("ACCESS_DIRECTORY_UNAVAILABLE");
    }
    if (!data.user?.id) throw new Error("ACCESS_DIRECTORY_UNAVAILABLE");
    return { authUserId: data.user.id };
  }

  async linkUser(input: { readonly userId: string; readonly authUserId: string; readonly displayName: string }) {
    await unwrap(this.admin.from("runtime_users").insert({ user_id: input.userId, display_name: input.displayName, active: true }) as unknown as QueryResult<unknown>);
    await unwrap(this.admin.from("runtime_identities").insert({ auth_user_id: input.authUserId, user_id: input.userId, provider: "supabase" }) as unknown as QueryResult<unknown>);
  }

  async setMembership(input: { readonly userId: string; readonly tenantId: string; readonly role: AuthRole; readonly status: AccountStatus }) {
    await unwrap(this.admin.from("runtime_memberships").upsert({ user_id: input.userId, tenant_id: input.tenantId, role: input.role, status: input.status }, { onConflict: "user_id,tenant_id" }) as unknown as QueryResult<unknown>);
  }

  async removeLogin(input: { readonly userId: string; readonly authUserId: string }) {
    await unwrap(this.admin.from("runtime_memberships").delete().eq("user_id", input.userId) as unknown as QueryResult<unknown>);
    await unwrap(this.admin.from("runtime_identities").delete().eq("auth_user_id", input.authUserId) as unknown as QueryResult<unknown>);
    await unwrap(this.admin.from("runtime_users").delete().eq("user_id", input.userId) as unknown as QueryResult<unknown>);
    await this.admin.auth.admin.deleteUser(input.authUserId);
  }

  async loginFor(userId: string) {
    const identity = await unwrap(this.admin.from("runtime_identities").select("auth_user_id").eq("user_id", userId).maybeSingle() as unknown as QueryResult<{ readonly auth_user_id: string } | null>);
    if (!identity) return null;
    const { data, error } = await this.admin.auth.admin.getUserById(identity.auth_user_id);
    if (error || !data.user?.email) return null;
    return { authUserId: identity.auth_user_id, email: data.user.email.toLowerCase() };
  }

  async verifyPassword(email: string, password: string) {
    const client = this.authClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user?.id) return null;
    await client.auth.signOut().catch(() => undefined);
    return data.user.id;
  }

  async setPassword(authUserId: string, password: string) {
    const { error } = await this.admin.auth.admin.updateUserById(authUserId, { password });
    if (error) throw new Error((error as { readonly code?: string }).code === "weak_password" ? "ACCESS_PASSWORD_WEAK" : "ACCESS_DIRECTORY_UNAVAILABLE");
  }
}
