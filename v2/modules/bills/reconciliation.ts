import type { BillInput, LineInput, Reconciliation } from "./types";
import { billInput } from "./schema";
import { cents, invalid, MAX_CENTS } from "./values";

/** Arithmetic only: does not establish completeness or authorize reconstruction. */
export function compareExactCents(reconstructed: number, declared: number): { status: "MATCH" | "DIFFERENCE"; difference: number } {
  // Reconstructed sums may contain up to 100 individually bounded amounts.
  if (!Number.isSafeInteger(reconstructed) || Math.abs(reconstructed) > 100 * MAX_CENTS || cents(declared) === null) return invalid();
  return { status: reconstructed === declared ? "MATCH" : "DIFFERENCE", difference: reconstructed - declared };
}
type Category = keyof Reconciliation["categories"];
function category(line: LineInput): Category {
  if (line.kind === "TV_LICENSE") return "tvLicense";
  if (line.kind === "PREVIOUS_BALANCE") return "previousBalance";
  if (["OTHER_AMOUNTS", "RECALCULATION", "UNKNOWN"].includes(line.kind)) return "otherAmounts";
  return "currentCharges";
}
function overlapping(lines: readonly LineInput[]): boolean {
  return lines.some((line, i) => lines.slice(i + 1).some(other =>
    line.periodStart <= other.periodEnd && other.periodStart <= line.periodEnd));
}
function knownSum(lines: readonly LineInput[]): number | null {
  if (!lines.length || overlapping(lines) || lines.some(line => line.amount === null || line.level !== "DETAIL" || line.kind === "UNKNOWN")) return null;
  return lines.reduce((sum, line) => sum + (line.amount as number), 0);
}
/** Manual lines cannot prove document coverage. No client assertion can supply that proof. */
export function reconcile(input: BillInput): Reconciliation {
  const bill = billInput(input);
  const categories = Object.fromEntries((["currentCharges", "tvLicense", "previousBalance", "otherAmounts"] as const)
    .map(key => [key, knownSum(bill.lines.filter(line => category(line) === key))])) as Reconciliation["categories"];
  const unavailable = (reason: Reconciliation["reason"]): Reconciliation => ({
    status: "NOT_DETERMINABLE", reconstructedTotal: null, difference: null, reason, categories,
  });
  if (bill.lines.some(line => line.level === "AGGREGATE")) return unavailable("AMBIGUOUS_AGGREGATION");
  if (!bill.lines.length) return unavailable("INCOMPLETE_DETAILS");
  if (bill.lines.some(line => line.amount === null || line.kind === "UNKNOWN" || line.documentTotalParticipation === "UNKNOWN")) {
    return unavailable("UNKNOWN_AMOUNT_OR_SCOPE");
  }
  const included = bill.lines.filter(line => line.documentTotalParticipation === "INCLUDED");
  if (overlapping(included)) return unavailable("AMBIGUOUS_DETAILS");
  if (bill.declaredDocumentTotal === null) return unavailable("DECLARED_TOTAL_MISSING");
  return unavailable("UNPROVEN_COVERAGE");
}
