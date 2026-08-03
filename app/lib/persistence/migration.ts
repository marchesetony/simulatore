// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PERSISTENCE_SCHEMA_VERSION } from "./types.ts";

export interface MigrationPlan {
  readonly dryRun: true;
  readonly fromVersion: number;
  readonly toVersion: typeof PERSISTENCE_SCHEMA_VERSION;
  readonly action: "NOOP" | "SUPPORTED_MIGRATION";
}

export function planMigration(schemaVersion: unknown): MigrationPlan {
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > PERSISTENCE_SCHEMA_VERSION) throw new Error("PERSISTENCE_SCHEMA_UNSUPPORTED");
  return { dryRun: true, fromVersion: schemaVersion, toVersion: PERSISTENCE_SCHEMA_VERSION, action: schemaVersion === PERSISTENCE_SCHEMA_VERSION ? "NOOP" : "SUPPORTED_MIGRATION" };
}
