import { parseDecimal } from "./rational";
import { roundToCents } from "./rounding";
import { PARENT_LEAVES, type V3LeafKey, type V3ParentKey, type V3ReconciliationKey } from "./types";
import type { V3Result } from "./simulate";

/**
 * Motore V3: analytic reconciliation with an original bill. Printed amounts stay on their own side (`printed`), calculated
 * amounts on theirs (`calculated`); the difference is calculated − printed. Printed values are read only here and never feed
 * the simulation. Differences of opposite sign are never netted: the report gives both the net difference and the sum of
 * absolute leaf differences.
 */
export interface V3PrintedItem { readonly key: V3ReconciliationKey; readonly label: string; readonly amount: string; readonly evidence: string }

export type V3ReconcileStatus = "MATCH" | "WITHIN_ROUNDING" | "DIFFERENCE" | "NOT_COMPARABLE";

export interface V3ReconcileLine {
  readonly key: V3ReconciliationKey;
  readonly level: "LEAF" | "PARENT";
  readonly printedCents: number | null;
  readonly calculatedCents: number;
  readonly differenceCents: number | null;
  /** Half a cent per rounded component in the line: the most rounding alone can explain. */
  readonly roundingToleranceCents: number;
  readonly status: V3ReconcileStatus;
  readonly calculatedComplete: boolean;
  readonly componentIds: readonly string[];
  readonly evidence: readonly string[];
  readonly note?: string;
}

export interface V3Reconciliation {
  readonly lines: readonly V3ReconcileLine[];
  readonly netDifferenceCents: number | null;
  readonly absoluteLeafDifferenceCents: number;
  readonly unprintedLeaves: readonly V3LeafKey[];
}

const LEAVES: readonly V3LeafKey[] = ["SELLER_CONSUMPTION", "SELLER_FIXED", "ONE_OFF", "NETWORK", "SYSTEM", "REACTIVE", "EXCISE", "VAT"];
const PARENTS: readonly V3ParentKey[] = ["SELLER", "NETWORK_AND_SYSTEM", "TAXES", "TOTAL"];

export function reconcileV3(result: V3Result, printed: readonly V3PrintedItem[]): V3Reconciliation {
  const printedByKey = new Map<V3ReconciliationKey, V3PrintedItem[]>();
  for (const item of printed) printedByKey.set(item.key, [...(printedByKey.get(item.key) ?? []), item]);
  const line = (key: V3ReconciliationKey, level: "LEAF" | "PARENT", leaves: readonly V3LeafKey[]): V3ReconcileLine => {
    const components = result.components.filter((component) => leaves.includes(component.leaf));
    const calculatedCents = components.reduce((total, component) => total + (component.amountCents ?? 0), 0);
    const calculatedComplete = components.every((component) => component.completeness === "COMPLETE" || component.completeness === "NOT_DUE");
    // Each rounded component can be off by half a cent; the printed side was rounded once per printed item too.
    const items = printedByKey.get(key) ?? [];
    const rounded = components.filter((component) => component.amountCents !== null && component.completeness !== "NOT_DUE").length;
    const roundingToleranceCents = Math.ceil((rounded + items.length) / 2);
    const base = { key, level, calculatedCents, calculatedComplete, roundingToleranceCents, componentIds: components.map((component) => component.id), evidence: items.map((item) => item.evidence) };
    if (!items.length) return { ...base, printedCents: null, differenceCents: null, status: "NOT_COMPARABLE", note: "importo non stampato in bolletta" };
    const printedCents = items.reduce((total, item) => total + roundToCents(parseDecimal(item.amount)), 0);
    const differenceCents = calculatedCents - printedCents;
    const incomplete = !calculatedComplete;
    const status: V3ReconcileStatus = differenceCents === 0 ? "MATCH" : !incomplete && Math.abs(differenceCents) <= roundingToleranceCents ? "WITHIN_ROUNDING" : "DIFFERENCE";
    return { ...base, printedCents, differenceCents, status, ...(incomplete ? { note: "calcolo incompleto: componenti non determinabili nella voce" } : {}) };
  };
  const lines = [
    ...LEAVES.map((leaf) => line(leaf, "LEAF", [leaf])),
    ...PARENTS.map((parent) => line(parent, "PARENT", PARENT_LEAVES[parent])),
  ];
  const total = lines.find((entry) => entry.key === "TOTAL");
  const leafLines = lines.filter((entry) => entry.level === "LEAF");
  return {
    lines,
    netDifferenceCents: total?.differenceCents ?? null,
    absoluteLeafDifferenceCents: leafLines.reduce((total, entry) => total + Math.abs(entry.differenceCents ?? 0), 0),
    unprintedLeaves: leafLines.filter((entry) => entry.printedCents === null).map((entry) => entry.key as V3LeafKey),
  };
}
