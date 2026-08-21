import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStoredMarketArchive } from "./validation.ts";

export interface MarketBackupResult {
  readonly created: boolean;
  readonly readable: boolean;
  readonly restoreCheck: boolean;
  readonly path: string;
}

type MarketStore = { readonly schemaVersion: 1; readonly records: readonly unknown[] };

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function backupRoot(activeRoot: string): string {
  return path.resolve(activeRoot, "..", "..", ".market-archive-backups");
}

export async function backupMarketArchive(activeRoot: string, now = new Date()): Promise<MarketBackupResult> {
  const activeFile = path.join(path.resolve(activeRoot), "metadata.json");
  const directory = path.join(backupRoot(activeRoot), `market-${now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17)}`);
  await mkdir(directory, { recursive: true });
  const backupFile = path.join(directory, "metadata.json");
  let source: Uint8Array | null = null;
  try { source = new Uint8Array(await readFile(activeFile)); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (source) await copyFile(activeFile, backupFile);
  const manifest = { backupSchemaVersion: 1, createdAt: now.toISOString(), sourceMetadata: activeFile, state: source ? "PRESENT" : "ABSENT", metadataSha256: source ? sha256(source) : null };
  const manifestFile = path.join(directory, "manifest.json");
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  let readable = false;
  let restoreCheck = false;
  try {
    const manifestBytes = new Uint8Array(await readFile(manifestFile));
    const parsedManifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as typeof manifest;
    readable = parsedManifest.backupSchemaVersion === 1 && (parsedManifest.state === "ABSENT" || parsedManifest.state === "PRESENT") && (!source || sha256(new Uint8Array(await readFile(backupFile))) === parsedManifest.metadataSha256);
    if (readable && parsedManifest.state === "ABSENT") restoreCheck = true;
    if (readable && parsedManifest.state === "PRESENT") {
      const store = JSON.parse(await readFile(backupFile, "utf8")) as MarketStore;
      if (store.schemaVersion !== 1 || !Array.isArray(store.records)) throw new Error("MARKET_BACKUP_STORE_INVALID");
      for (const record of store.records) validateStoredMarketArchive(record);
      restoreCheck = true;
    }
  } catch { readable = false; restoreCheck = false; }
  return { created: true, readable, restoreCheck, path: directory };
}
