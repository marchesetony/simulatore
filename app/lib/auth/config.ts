import type { AuthAdapterKind, AuthRole, PersistenceAdapterKind, RuntimeConfig, RuntimeConfigResult, RuntimeMode } from "./types";

const tenantPattern = /^tenant_[a-z0-9-]+$/;
const roles = ["ADMIN", "ANALYST", "VIEWER"] as const;

function bool(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfigResult {
  const errors: string[] = [];
  const foundationLocalDev = bool(env.FOUNDATION_LOCAL_DEV);
  if (foundationLocalDev === null) errors.push("FOUNDATION_LOCAL_DEV_INVALID");
  const runtimeMode = (env.APP_RUNTIME_MODE ?? (foundationLocalDev === true ? "local" : undefined)) as RuntimeMode | undefined;
  if (runtimeMode !== "local" && runtimeMode !== "production") errors.push("APP_RUNTIME_MODE_INVALID");
  const localDev = foundationLocalDev === true;
  if (runtimeMode === "local" && !localDev) errors.push("LOCAL_MODE_REQUIRES_FOUNDATION_LOCAL_DEV");
  if (runtimeMode === "production" && localDev) errors.push("PRODUCTION_LOCAL_BYPASS_FORBIDDEN");

  const authAdapter = (env.AUTH_ADAPTER ?? (runtimeMode === "local" ? "local" : undefined)) as AuthAdapterKind | undefined;
  const persistenceAdapter = (env.PERSISTENCE_ADAPTER ?? (runtimeMode === "local" ? "filesystem" : undefined)) as PersistenceAdapterKind | undefined;
  if (authAdapter !== "local" && authAdapter !== "server-session") errors.push("AUTH_ADAPTER_INVALID");
  if (persistenceAdapter !== "filesystem" && persistenceAdapter !== "provider") errors.push("PERSISTENCE_ADAPTER_INVALID");
  if (runtimeMode === "production" && authAdapter !== "server-session") errors.push("PRODUCTION_AUTH_ADAPTER_REQUIRED");
  if (runtimeMode === "production" && persistenceAdapter !== "provider") errors.push("PRODUCTION_PERSISTENCE_ADAPTER_REQUIRED");
  if (runtimeMode === "local" && authAdapter !== "local") errors.push("LOCAL_AUTH_ADAPTER_INVALID");
  if (runtimeMode === "local" && persistenceAdapter !== "filesystem") errors.push("LOCAL_PERSISTENCE_ADAPTER_INVALID");

  const localTenantId = env.FOUNDATION_LOCAL_TENANT_ID ?? "tenant_local-demo";
  if (!tenantPattern.test(localTenantId)) errors.push("LOCAL_TENANT_ID_INVALID");
  const localRole = env.FOUNDATION_LOCAL_ROLE ?? "ADMIN";
  if (!roles.includes(localRole as AuthRole)) errors.push("LOCAL_ROLE_INVALID");
  if (errors.length > 0 || !runtimeMode || foundationLocalDev === null || !authAdapter || !persistenceAdapter || !roles.includes(localRole as AuthRole)) return { valid: false, errors: errors.length > 0 ? errors : ["RUNTIME_CONFIGURATION_INVALID"] };
  return { valid: true, config: { runtimeMode, foundationLocalDev, authAdapter, persistenceAdapter, localTenantId, localRole: localRole as AuthRole } };
}

export function getRuntimeConfig(): RuntimeConfig {
  const result = readRuntimeConfig();
  if (!result.valid) throw new Error(`AUTH_CONFIGURATION_INVALID:${result.errors.join(",")}`);
  return result.config;
}
