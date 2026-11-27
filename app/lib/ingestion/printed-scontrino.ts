import type { StructuredBillEconomicChargeLine, StructuredBillExtraction } from "./structured-bill.ts";

// Tony (5/11/2026, "cancellare e ripartire da zero"): the scontrino is no longer parsed from the PDF text layer. Claude reads
// it from the page (app/lib/reading/bill-reader.ts) and it reaches the engine as "Quota ... - di cui spesa per ..." lines.

const hasScontrino = (lines: readonly StructuredBillEconomicChargeLine[]) => lines.some((item) => /di\s+cui\s+spes[ae]\s+per/i.test(`${item.description} ${item.rawDescription ?? ""}`));

/** True when the reading holds the bill's scontrino (its "di cui" shares). */
export function readingHasScontrino(extraction: StructuredBillExtraction | null | undefined): boolean {
  return Boolean(extraction && hasScontrino(extraction.economicChargeLines));
}
