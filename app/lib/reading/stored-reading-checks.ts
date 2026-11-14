// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { italianNumber, productAmountMatches } from "./bill-reader-checks.ts";
import type { StructuredBillEconomicChargeLine, StructuredBillExtraction } from "../ingestion/structured-bill.ts";

// Tony (11/11/2026, "correzione avvisi storici Eurocent"): the checks are stored as text when the bill is read, so a bill read
// before 28591ae keeps showing "1 × 49,020000 = 49.02 € ma l'importo letto è 0,49 €" for prices printed in Eurocent. When a
// stored bill is shown, each stored quantity × price warning is checked again, with the current check, on the charge line
// saved with the bill; it is hidden only when that line is found and now adds up. A warning whose line is missing, ambiguous
// or still wrong stays, and so does every other warning. Nothing is written back: the stored reading keeps its checks.

const PRODUCT_MESSAGE = /^"(.+)": (.+?) × (.+?) = -?[\d.]+ € ma l'importo letto è (.+?) €\.$/;

function sameNumber(left: string | undefined, right: string): boolean {
  const a = italianNumber(left); const b = italianNumber(right);
  return a !== null && b !== null && a === b;
}

/** True only when the warning is a quantity × price one and the line it names, saved with the bill, now adds up. */
export function productCheckResolved(message: string, lines: readonly StructuredBillEconomicChargeLine[]): boolean {
  const match = PRODUCT_MESSAGE.exec(message);
  if (!match) return false;
  const [, label, quantity, price, amount] = match;
  const candidates = lines.filter((line) => (line.description === label || line.rawDescription === label)
    && sameNumber(line.quantity, quantity) && sameNumber(line.unitPrice, price) && sameNumber(line.amount, amount));
  if (candidates.length === 0) return false;
  return candidates.every((line) => Boolean(line.unit?.trim())
    && productAmountMatches(italianNumber(line.quantity), italianNumber(line.unitPrice), line.unit, italianNumber(line.amount)) === true);
}

/** The stored reading as shown: the same object, without the quantity × price warnings the current check no longer raises. */
export function withCurrentReadingChecks(reading: StructuredBillExtraction): StructuredBillExtraction {
  const stored = reading.readingChecks;
  if (!stored?.length) return reading;
  const lines = reading.economicChargeLines ?? [];
  const shown = stored.filter((message) => !productCheckResolved(message, lines));
  return shown.length === stored.length ? reading : { ...reading, readingChecks: shown };
}
