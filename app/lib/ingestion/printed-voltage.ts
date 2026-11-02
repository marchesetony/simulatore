import type { StructuredBillExtraction } from "./structured-bill.ts";

type VoltageLevel = "LV" | "MV" | "HV" | "EHV";

// Tony (2/11, J Fuel S.R.L., Camer: "voglio capire perchè a noi risulta molto meno il risparmio rispetto a quello che ha fatto
// bpower"): the bill prints "Tensione nominale di alimentazione 20.000 V" and 200 kW, a media tensione supply, but it was
// quoted as bassa tensione: network losses at 10% instead of 3,8% (TIS Tabella 4) and the ARERA tables of the BT. The
// voltage printed in the PDF text is the supply's: it wins over the reading (TIC: BT up to 1 kV, MT up to 35 kV, AT up to
// 150 kV).

const volts = (text: string): VoltageLevel | null => {
  const match = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\s*(kV|V)\b/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/\./g, "")) * (/^kv$/i.test(match[2]) ? 1000 : 1);
  if (!(value > 0)) return null;
  return value <= 1000 ? "LV" : value <= 35000 ? "MV" : value <= 150000 ? "HV" : "EHV";
};
const named = (text: string): VoltageLevel | null =>
  /altissima\s+tensione/i.test(text) ? "EHV" : /\balta\s+tensione/i.test(text) ? "HV" : /media\s+tensione/i.test(text) ? "MV" : /bassa\s+tensione/i.test(text) ? "LV" : null;

/** The supply voltage printed in the bill's text ("Tensione nominale di alimentazione 20.000 V", "220 V - Bassa Tensione"). */
export function voltageFromText(text: string | null): VoltageLevel | null {
  if (!text) return null;
  for (const row of text.split(/\r?\n/).map((item) => item.replace(/\s+/g, " ").trim())) {
    // Only the row of the supply's voltage: "tensione" followed by a value in V or kV, or the level named on that row.
    const at = row.search(/tensione(?:\s+nominale)?(?:\s+di)?\s+(?:alimentazione|fornitura|consegna)|livello\s+di\s+tensione|tensione\s*:/i);
    if (at < 0) continue;
    const rest = row.slice(at, at + 90);
    const level = volts(rest) ?? named(rest);
    if (level) return level;
  }
  return null;
}

/** The printed voltage replaces the reading's when they differ; a bill that prints none keeps the reading. */
export function withTextVoltage(extraction: StructuredBillExtraction, text: string | null): StructuredBillExtraction {
  const printed = voltageFromText(text);
  if (!printed || (extraction.voltageLevel.status === "FOUND" && extraction.voltageLevel.value === printed)) return extraction;
  return { ...extraction, voltageLevel: { ...extraction.voltageLevel, value: printed, status: "FOUND", confidence: 0.95, source: "DOCUMENT_AI" } };
}
