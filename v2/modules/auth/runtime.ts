import "server-only";
import { getAuthConfig } from "../../core/config/auth";
import { SupabaseHttp } from "./supabase-http";
import { SupabaseAuthProvider } from "./provider";
import { SupabaseAccessRepository, SupabaseSessionRepository } from "./supabase-repository";
import type { AuthDependencies } from "./service";

export function authRuntime() {
  const config = getAuthConfig();
  const http = new SupabaseHttp(config);
  const dependencies: AuthDependencies = { provider: new SupabaseAuthProvider(http),
    access: new SupabaseAccessRepository(http), sessions: new SupabaseSessionRepository(http),
    sessionSeconds: config.sessionSeconds };
  return { config, dependencies };
}
