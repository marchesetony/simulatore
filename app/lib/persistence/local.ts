import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeleteRecordInput, PutRecordInput, TenantRecord, TenantRecordRepository, UnscopedAppendRepository, UnscopedRecord } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PERSISTENCE_SCHEMA_VERSION } from "./types.ts";

const tenantPattern = /^tenant_[a-z0-9-]+$/;
const segmentPattern = /^[A-Za-z0-9._:-]{1,160}$/;

function fail(code: string): never { throw new Error(code); }
function timestamp(value?: string): string { const result = value ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(result))) return fail("PERSISTENCE_TIMESTAMP_INVALID"); return new Date(result).toISOString(); }
function assertTenant(tenantId: string): void { if (!tenantPattern.test(tenantId)) fail("PERSISTENCE_TENANT_INVALID"); }
function assertSegment(value: string): void { if (!segmentPattern.test(value) || value === "." || value === ".." || value.includes("..")) fail("PERSISTENCE_PATH_INVALID"); }
function canonical(value: unknown): string { if (value === undefined) return "null"; if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value as Record<string, unknown>).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; }
function serialized(value: unknown): string { return `${canonical(value)}\n`; }
function validRecord<T>(value: unknown, tenantId: string, recordId: string): TenantRecord<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("PERSISTENCE_DATA_INVALID");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== PERSISTENCE_SCHEMA_VERSION || item.tenantId !== tenantId || item.recordId !== recordId || typeof item.version !== "number" || !Number.isSafeInteger(item.version) || item.version < 1 || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || !("payload" in item)) return fail("PERSISTENCE_DATA_INVALID");
  timestamp(item.createdAt); timestamp(item.updatedAt);
  if (item.idempotencyKey !== undefined && (typeof item.idempotencyKey !== "string" || item.idempotencyKey.length > 160)) return fail("PERSISTENCE_DATA_INVALID");
  return structuredClone(item as unknown as TenantRecord<T>);
}

export class LocalFilesystemRepository<TPayload> implements TenantRecordRepository<TPayload>, UnscopedAppendRepository<TPayload> {
  private static readonly locks = new Map<string, Promise<void>>();
  private readonly root: string;
  private readonly collection: string;
  constructor(root: string, collection: string) {
    this.root = path.resolve(root);
    this.collection = collection;
    assertSegment(collection);
  }
  private file(tenantId: string, recordId: string): string { assertTenant(tenantId); assertSegment(recordId); const root = path.join(this.root, this.collection, tenantId); const file = path.join(root, `${recordId}.json`); const resolvedRoot = path.resolve(root); const resolvedFile = path.resolve(file); if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) fail("PERSISTENCE_PATH_INVALID"); return file; }
  private unscopedFile(recordId: string): string { assertSegment(recordId); const root = path.join(this.root, this.collection, "_security"); const file = path.join(root, `${recordId}.json`); const resolvedRoot = path.resolve(root); const resolvedFile = path.resolve(file); if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) fail("PERSISTENCE_PATH_INVALID"); return file; }
  private async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = LocalFilesystemRepository.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    LocalFilesystemRepository.locks.set(key, current);
    await previous;
    try { return await operation(); }
    finally { release(); if (LocalFilesystemRepository.locks.get(key) === current) LocalFilesystemRepository.locks.delete(key); }
  }
  private async read(tenantId: string, recordId: string): Promise<TenantRecord<TPayload> | null> { try { return validRecord<TPayload>(JSON.parse(await readFile(this.file(tenantId, recordId), "utf8")), tenantId, recordId); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; if (error instanceof SyntaxError) return fail("PERSISTENCE_DATA_INVALID"); throw error; } }
  async get(tenantId: string, recordId: string): Promise<TenantRecord<TPayload> | null> { return this.read(tenantId, recordId); }
  async list(tenantId: string): Promise<readonly TenantRecord<TPayload>[]> {
    assertTenant(tenantId);
    const directory = path.join(this.root, this.collection, tenantId);
    let names: string[];
    try { names = (await (await import("node:fs/promises")).readdir(directory)).filter((name) => name.endsWith(".json")).sort(); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
    const records: TenantRecord<TPayload>[] = [];
    for (const name of names) {
      try { records.push(validRecord<TPayload>(JSON.parse(await readFile(path.join(directory, name), "utf8")), tenantId, name.slice(0, -5))); }
      catch (error) { if (error instanceof SyntaxError) fail("PERSISTENCE_DATA_INVALID"); throw error; }
    }
    return records;
  }
  private async putUnlocked(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>> {
    const existing = await this.read(input.tenantId, input.recordId);
    if (input.idempotencyKey !== undefined) { const match = (await this.list(input.tenantId)).find((record) => record.recordId === input.recordId && record.idempotencyKey === input.idempotencyKey); if (match) return match; }
    if (input.expectedVersion === undefined && existing) fail("PERSISTENCE_RECORD_ALREADY_EXISTS");
    if (input.expectedVersion !== undefined && (!existing || existing.version !== input.expectedVersion)) fail("PERSISTENCE_VERSION_CONFLICT");
    const now = timestamp(input.now); const next: TenantRecord<TPayload> = { schemaVersion: PERSISTENCE_SCHEMA_VERSION, recordId: input.recordId, tenantId: input.tenantId, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now, payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
    await this.atomicWrite(this.file(input.tenantId, input.recordId), next);
    return structuredClone(next);
  }
  async put(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>> { return this.exclusive(this.file(input.tenantId, input.recordId), () => this.putUnlocked(input)); }
  async append(input: PutRecordInput<TPayload>): Promise<TenantRecord<TPayload>> { return this.exclusive(this.file(input.tenantId, input.recordId), async () => { if (await this.read(input.tenantId, input.recordId)) fail("PERSISTENCE_APPEND_ONLY_CONFLICT"); return this.putUnlocked(input); }); }
  async delete(input: DeleteRecordInput): Promise<void> {
    return this.exclusive(this.file(input.tenantId, input.recordId), async () => {
      const existing = await this.read(input.tenantId, input.recordId);
      if (!existing) fail("PERSISTENCE_RECORD_NOT_FOUND");
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) fail("PERSISTENCE_VERSION_CONFLICT");
      await unlink(this.file(input.tenantId, input.recordId));
    });
  }
  async appendUnscoped(input: Omit<PutRecordInput<TPayload>, "tenantId">): Promise<UnscopedRecord<TPayload>> {
    const file = this.unscopedFile(input.recordId);
    return this.exclusive(file, async () => {
      try { await readFile(file, "utf8"); fail("PERSISTENCE_APPEND_ONLY_CONFLICT"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      const now = timestamp(input.now);
      const next: UnscopedRecord<TPayload> = { schemaVersion: PERSISTENCE_SCHEMA_VERSION, recordId: input.recordId, version: 1, createdAt: now, updatedAt: now, payload: structuredClone(input.payload), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
      await this.atomicWrite(file, next);
      return structuredClone(next);
    });
  }
  async listUnscoped(): Promise<readonly UnscopedRecord<TPayload>[]> {
    const directory = path.join(this.root, this.collection, "_security");
    let names: string[];
    try { names = (await (await import("node:fs/promises")).readdir(directory)).filter((name) => name.endsWith(".json")).sort(); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
    const records: UnscopedRecord<TPayload>[] = [];
    for (const name of names) {
      try {
        const value = JSON.parse(await readFile(path.join(directory, name), "utf8")) as Record<string, unknown>;
        if (value.schemaVersion !== PERSISTENCE_SCHEMA_VERSION || value.recordId !== name.slice(0, -5) || value.version !== 1 || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !("payload" in value)) fail("PERSISTENCE_DATA_INVALID");
        timestamp(value.createdAt); timestamp(value.updatedAt);
        records.push(structuredClone(value as unknown as UnscopedRecord<TPayload>));
      } catch (error) { if (error instanceof SyntaxError) fail("PERSISTENCE_DATA_INVALID"); throw error; }
    }
    return records;
  }
  private async atomicWrite(file: string, value: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${createHash("sha256").update(serialized(value)).digest("hex").slice(0, 16)}.tmp`; await writeFile(temp, serialized(value), { encoding: "utf8", flag: "w" }); await rename(temp, file); }
}

export class LocalFilesystemAdapter {
  readonly kind = "filesystem" as const;
  readonly root: string;
  constructor(root: string) { if (path.resolve(root) !== root && root.includes("..")) fail("PERSISTENCE_PATH_INVALID"); this.root = root; }
  collection<TPayload>(name: string): LocalFilesystemRepository<TPayload> { return new LocalFilesystemRepository<TPayload>(this.root, name); }
}
