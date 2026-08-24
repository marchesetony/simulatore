// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { readRuntimeConfig } from "./auth/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { productionSessionAdapterConfigured } from "./auth/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { productionStorageAdapterConfigured } from "./persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { bootstrapProductionRuntime } from "./production/bootstrap.ts";

export interface ReadinessReport {
  readonly application: "running";
  readonly runtimeMode: "local" | "production" | "invalid";
  readonly authAdapterConfigured: boolean;
  readonly persistenceAdapterConfigured: boolean;
  readonly readiness: boolean;
  readonly schemaCompatibility: boolean;
  readonly timestamp: string;
}

export function readinessReport(now = new Date()): ReadinessReport {
  bootstrapProductionRuntime();
  const config = readRuntimeConfig();
  if (!config.valid) return { application: "running", runtimeMode: "invalid", authAdapterConfigured: false, persistenceAdapterConfigured: false, readiness: false, schemaCompatibility: true, timestamp: now.toISOString() };
  const authConfigured = config.config.runtimeMode === "local" || productionSessionAdapterConfigured();
  const persistenceConfigured = config.config.runtimeMode === "local" || productionStorageAdapterConfigured();
  return { application: "running", runtimeMode: config.config.runtimeMode, authAdapterConfigured: authConfigured, persistenceAdapterConfigured: persistenceConfigured, readiness: authConfigured && persistenceConfigured, schemaCompatibility: true, timestamp: now.toISOString() };
}
