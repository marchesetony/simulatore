import { decimal, object, text } from "./primitives";
import { fail } from "./errors";
import { timestamp } from "./temporal";

export type EconomicState =
  | { readonly valueState: "KNOWN"; readonly value: string; readonly evidence: null }
  | { readonly valueState: "NOT_APPLICABLE"; readonly value: null; readonly evidence: string }
  | { readonly valueState: "NOT_PROVIDED" | "MISSING" | "INVALID"; readonly value: null; readonly evidence: null };
export type Freshness = { readonly status: "CURRENT" | "STALE"; readonly checkedAt: string; readonly reason: string };
export function parseFreshness(value: unknown): Freshness {
  const row = object(value, ["status", "checkedAt", "reason"]);
  if (row.status !== "CURRENT" && row.status !== "STALE") return fail("INVALID_INPUT");
  return Object.freeze({ status: row.status, checkedAt: timestamp(row.checkedAt), reason: text(row.reason) });
}
export function economicState(value: unknown): EconomicState {
  const row = object(value, ["valueState", "value", "evidence"]);
  if (row.valueState === "KNOWN" && row.evidence === null) return { valueState: "KNOWN", value: decimal(row.value), evidence: null };
  if (row.value !== null) return fail("INVALID_INPUT");
  if (row.valueState === "NOT_APPLICABLE") return { valueState: "NOT_APPLICABLE", value: null, evidence: text(row.evidence) };
  if (row.evidence !== null || typeof row.valueState !== "string" || !["NOT_PROVIDED", "MISSING", "INVALID"].includes(row.valueState)) return fail("INVALID_INPUT");
  return { valueState: row.valueState as "NOT_PROVIDED" | "MISSING" | "INVALID", value: null, evidence: null };
}
