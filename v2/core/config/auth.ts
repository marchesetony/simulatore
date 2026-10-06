import "server-only";
import { AuthError } from "../errors/auth-error";

export interface AuthConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly secretKey: string;
  readonly origin: string;
  readonly sessionSeconds: number;
}

export function parseAuthConfig(env: Readonly<Record<string, string | undefined>>): AuthConfig {
  const url = env.V2_SUPABASE_URL;
  const publishableKey = env.V2_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.V2_SUPABASE_SECRET_KEY;
  const origin = env.V2_AUTH_ORIGIN;
  const lifetime = env.V2_AUTH_SESSION_SECONDS;
  if (!url || !origin || !publishableKey || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) ||
      !secretKey || !/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey) || !lifetime || !/^\d+$/.test(lifetime)) {
    throw new AuthError("CONFIGURATION_INVALID");
  }
  const sessionSeconds = Number(lifetime);
  if (!Number.isSafeInteger(sessionSeconds) || sessionSeconds < 60 || sessionSeconds > 86400 ||
      !isHttpsOrigin(url) || !isHttpsOrigin(origin) || /\s/.test(publishableKey + secretKey)) {
    throw new AuthError("CONFIGURATION_INVALID");
  }
  return Object.freeze({ supabaseUrl: new URL(url).origin, publishableKey, secretKey,
    origin: new URL(origin).origin, sessionSeconds });
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

export function getAuthConfig(): AuthConfig { return parseAuthConfig(process.env); }
