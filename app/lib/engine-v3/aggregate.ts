import { sumCents } from "./rounding";
import { CATEGORY_GROUP, CATEGORY_LEAF, type V3Component, type V3Group, type V3LeafKey } from "./types";

/**
 * Motore V3: aggregation. Every component belongs to exactly one group and one leaf (checked against the canonical maps), its
 * id is unique, and totals are sums of the rounded component amounts: nothing is counted twice, nothing is rounded again.
 * A component that is not determinable is listed as missing and the total is PROVISIONAL, never silently zero.
 */
export interface V3Totals {
  readonly byGroup: Readonly<Record<V3Group, number>>;
  readonly byLeaf: Readonly<Record<V3LeafKey, number>>;
  readonly recurringCents: number;
  readonly oneOffCents: number;
  readonly taxesCents: number;
  readonly totalCents: number;
  readonly status: "COMPLETE" | "PROVISIONAL";
  readonly missing: readonly { readonly id: string; readonly label: string; readonly completeness: string; readonly reason: string }[];
  /** Calculated components resting on a value not verified at its primary source (read on a reproduction): total stays provisional. */
  readonly unverified: readonly { readonly id: string; readonly label: string; readonly sources: readonly string[] }[];
}

const GROUPS: readonly V3Group[] = ["SELLER", "NETWORK", "SYSTEM", "REACTIVE", "ONE_OFF", "TAXES"];
const LEAVES: readonly V3LeafKey[] = ["SELLER_CONSUMPTION", "SELLER_FIXED", "ONE_OFF", "NETWORK", "SYSTEM", "REACTIVE", "EXCISE", "VAT"];

export function assertCanonical(components: readonly V3Component[]): void {
  const seen = new Set<string>();
  for (const component of components) {
    if (seen.has(component.id)) throw new Error(`V3_DUPLICATE_COMPONENT:${component.id}`);
    seen.add(component.id);
    if (CATEGORY_GROUP[component.category] !== component.group) throw new Error(`V3_GROUP_MISMATCH:${component.id}`);
    if (CATEGORY_LEAF[component.category] !== component.leaf) throw new Error(`V3_LEAF_MISMATCH:${component.id}`);
    if (component.provenance !== "CALCULATED") throw new Error(`V3_NOT_CALCULATED:${component.id}`);
    if (component.completeness === "COMPLETE" && component.amountCents === null) throw new Error(`V3_COMPLETE_WITHOUT_AMOUNT:${component.id}`);
  }
}

export function aggregate(components: readonly V3Component[]): V3Totals {
  assertCanonical(components);
  const cents = (list: readonly V3Component[]) => sumCents(list.map((component) => component.amountCents ?? 0));
  const byGroup = Object.fromEntries(GROUPS.map((group) => [group, cents(components.filter((component) => component.group === group))])) as Record<V3Group, number>;
  const byLeaf = Object.fromEntries(LEAVES.map((leaf) => [leaf, cents(components.filter((component) => component.leaf === leaf))])) as Record<V3LeafKey, number>;
  const taxesCents = byGroup.TAXES;
  const oneOffCents = cents(components.filter((component) => component.recurrence === "ONE_OFF"));
  const recurringCents = cents(components.filter((component) => component.recurrence === "RECURRING" && component.group !== "TAXES"));
  const totalCents = cents(components);
  const missing = components
    .filter((component) => component.completeness === "NOT_DETERMINABLE" || component.completeness === "INCOMPLETE")
    .map((component) => ({ id: component.id, label: component.label, completeness: component.completeness, reason: component.reason ?? "" }));
  const unverified = components
    .filter((component) => component.amountCents !== null)
    .map((component) => ({ id: component.id, label: component.label, sources: component.sources.filter((source) => source.verification?.level === "REPRODUCTION").map((source) => source.reference) }))
    .filter((item) => item.sources.length > 0);
  return { byGroup, byLeaf, recurringCents, oneOffCents, taxesCents, totalCents, status: missing.length || unverified.length ? "PROVISIONAL" : "COMPLETE", missing, unverified };
}
