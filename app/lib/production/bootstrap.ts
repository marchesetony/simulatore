// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { readRuntimeConfig } from "../auth/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { clearProductionSessionAdapter, productionSessionAdapterConfigured, registerProductionSessionAdapter } from "../auth/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { clearProductionStorageAdapter, productionStorageAdapterConfigured, registerProductionStorageAdapter } from "../persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createProductionAdapters, readProductionProviderConfig } from "./supabase.ts";

export type ProductionBootstrapReport = {
  readonly runtimeMode: "local" | "production" | "invalid";
  readonly providerConfigured: boolean;
  readonly authRegistered: boolean;
  readonly persistenceRegistered: boolean;
  readonly missing: readonly string[];
};

let registeredProviderKey: string | null = null;

function clearRegisteredProductionRuntime(): void {
  clearProductionSessionAdapter();
  clearProductionStorageAdapter();
  registeredProviderKey = null;
}

function clearStaleProductionRuntime(): void {
  if (registeredProviderKey !== null) clearRegisteredProductionRuntime();
}

export function bootstrapProductionRuntime(env: NodeJS.ProcessEnv = process.env): ProductionBootstrapReport {
  const runtime = readRuntimeConfig(env);
  if (!runtime.valid) {
    clearStaleProductionRuntime();
    return { runtimeMode: "invalid", providerConfigured: false, authRegistered: false, persistenceRegistered: false, missing: runtime.errors };
  }
  if (runtime.config.runtimeMode !== "production") {
    return { runtimeMode: "local", providerConfigured: false, authRegistered: false, persistenceRegistered: false, missing: [] };
  }

  const provider = readProductionProviderConfig(env);
  if (!provider.valid) {
    clearStaleProductionRuntime();
    return { runtimeMode: "production", providerConfigured: false, authRegistered: false, persistenceRegistered: false, missing: provider.missing };
  }

  const key = `${provider.config.supabaseUrl}|${provider.config.secretKey}|${provider.config.storageBucket}|${provider.config.sessionCookieName}|${provider.config.publishableKey}`;
  if (registeredProviderKey !== key || !productionSessionAdapterConfigured() || !productionStorageAdapterConfigured()) {
    const adapters = createProductionAdapters(provider.config);
    registerProductionSessionAdapter(adapters.auth);
    registerProductionStorageAdapter(adapters.storage);
    registeredProviderKey = key;
  }
  return { runtimeMode: "production", providerConfigured: true, authRegistered: productionSessionAdapterConfigured(), persistenceRegistered: productionStorageAdapterConfigured(), missing: [] };
}
