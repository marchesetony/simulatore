import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { readRuntimeConfig } from "../../app/lib/auth/config.ts";

const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const runtimeRoot = path.resolve(projectRoot, "var", "phase6");
const { loadEnvConfig } = nextEnv;

function fail(reason) {
  throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
}

/**
 * Load the same .env* precedence used by Next.js before a standalone Node
 * harness touches runtimeRepositories or any local runtime repository.
 * Explicit process.env values win because @next/env does not overwrite them.
 */
export function loadLocalRuntimeEnvForTests(options = {}) {
  const expectedTenantId = options.expectedTenantId;
  loadEnvConfig(projectRoot, false);

  if (expectedTenantId !== undefined) {
    const configuredTenantId = process.env.FOUNDATION_LOCAL_TENANT_ID;
    if (configuredTenantId === undefined) process.env.FOUNDATION_LOCAL_TENANT_ID = expectedTenantId;
    else if (configuredTenantId !== expectedTenantId) fail(`TENANT_MISMATCH:${configuredTenantId}`);
  }

  const result = readRuntimeConfig(process.env);
  if (!result.valid) fail(result.errors.join(","));
  if (result.config.runtimeMode !== "local") fail("LOCAL_RUNTIME_REQUIRED");
  if (result.config.persistenceAdapter !== "filesystem") fail("FILESYSTEM_PERSISTENCE_REQUIRED");
  if (!existsSync(runtimeRoot)) fail(`REGULATORY_ROOT_MISSING:${runtimeRoot}`);

  return Object.freeze({
    config: result.config,
    projectRoot,
    runtimeRoot,
    tenantId: result.config.localTenantId,
  });
}

export function standaloneRuntimeRoot() {
  return runtimeRoot;
}
