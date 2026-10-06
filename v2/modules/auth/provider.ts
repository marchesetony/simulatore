import "server-only";
import { AuthError } from "../../core/errors/auth-error";
import { record, requiredString } from "./schema";
import type { AuthProvider } from "./repository";
import type { Credentials } from "./types";
import type { SupabaseHttp } from "./supabase-http";

export class SupabaseAuthProvider implements AuthProvider {
  constructor(private readonly http: SupabaseHttp) {}

  async verify(credentials: Credentials): Promise<string> {
    const result = record(await this.http.request("/auth/v1/token?grant_type=password",
      { method: "POST", body: JSON.stringify(credentials) }, false));
    const token = result.access_token;
    if (typeof token !== "string" || !token) throw new AuthError("PROVIDER_UNAVAILABLE");
    const verified = record(await this.http.request("/auth/v1/user",
      { headers: { Authorization: `Bearer ${token}` } }, false));
    const id = requiredString(verified.id);
    if (record(result.user).id !== id || verified.is_anonymous !== false) {
      throw new AuthError("INVALID_CREDENTIALS");
    }
    return id;
  }
}
