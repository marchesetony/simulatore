import "server-only";
import { createHash } from "node:crypto";
import { fail } from "./errors";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (value === undefined || typeof value === "symbol" || typeof value === "function" || typeof value === "bigint" || (typeof value === "number" && !Number.isFinite(value))) return fail("INVALID_INPUT");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}
export function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  }
  freeze(copy); return copy;
}
export function verifyHash<T extends { readonly hash: string }>(value: T): void {
  const { hash, ...payload } = value;
  if (digest(payload) !== hash) fail("HASH_MISMATCH");
}
