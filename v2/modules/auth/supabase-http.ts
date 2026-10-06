import "server-only";
import { AuthError } from "../../core/errors/auth-error";
import type { AuthConfig } from "../../core/config/auth";

export class SupabaseHttp {
  constructor(private readonly config: AuthConfig, private readonly fetcher: typeof fetch = fetch) {}

  async request(path: string, init: RequestInit = {}, privileged = true): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.supabaseUrl}${path}`, {
        ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { apikey: privileged ? this.config.secretKey : this.config.publishableKey,
          "Content-Type": "application/json", ...init.headers },
      });
    } catch { throw new AuthError("PROVIDER_UNAVAILABLE"); }
    if (!response.ok) {
      if (!privileged && path.startsWith("/auth/v1/token") && [400, 422].includes(response.status)) {
        const error: unknown = await response.json().catch(() => null);
        if (error && typeof error === "object" && "error_code" in error &&
            ["invalid_credentials", "email_not_confirmed", "user_banned"].includes(String(error.error_code))) {
          throw new AuthError("INVALID_CREDENTIALS");
        }
      }
      throw new AuthError("PROVIDER_UNAVAILABLE");
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") return null;
    try { return await response.json(); } catch { throw new AuthError("PROVIDER_UNAVAILABLE"); }
  }

  async rows(table: string, filters: Readonly<Record<string, string>>, select = "*"): Promise<readonly unknown[]> {
    const params = new URLSearchParams({ select, ...filters, limit: "101" });
    const result = await this.request(`/rest/v1/${table}?${params}`);
    if (!Array.isArray(result) || result.length > 100) throw new AuthError("ACCESS_CONFIGURATION_INVALID");
    return result;
  }
}
