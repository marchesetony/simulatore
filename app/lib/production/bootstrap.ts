// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { readRuntimeConfig } from "../auth/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { productionSessionAdapterConfigured, registerProductionSessionAdapter } from "../auth/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { productionStorageAdapterConfigured, registerProductionStorageAdapter } from "../persistence/adapter.ts";
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

export function bootstrapProductionRuntime(env: NodeJS.ProcessEnv = process.env): ProductionBootstrapReport {
  const runtime = readRuntimeConfig(env);
  if (!runtime.valid) return { runtimeMode: "invalid", providerConfigured: false, authRegistered: false, persistenceRegistered: false, missing: [] };
  if (runtime.config.runtimeMode !== "production") return { runtimeMode: "local", providerConfigured: false, authRegistered: false, persistenceRegistered: false, missing: [] };

  const provider = readProductionProviderConfig(env);
  if (!provider.valid) return { runtimeMode: "production", providerConfigured: false, authRegistered: productionSessionAdapterConfigured(), persistenceRegistered: productionStorageAdapterConfigured(), missing: provider.missing };

  const key = `${provider.config.supabaseUrl}|${provider.config.secretKey}|${provider.config.storageBucket}|${provider.config.sessionCookieName}|${provider.config.publishableKey}`;
  if (registeredProviderKey !== key || !productionSessionAdapterConfigured() || !productionStorageAdapterConfigured()) {
    const adapters = createProductionAdapters(provider.config);
    registerProductionSessionAdapter(adapters.auth);
    registerProductionStorageAdapter(adapters.storage);
    registeredProviderKey = key;
  }
  return { runtimeMode: "production", providerConfigured: true, authRegistered: productionSessionAdapterConfigured(), persistenceRegistered: productionStorageAdapterConfigured(), missing: [] };
}
