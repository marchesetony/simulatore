/**
 * Tony (20/11/2026, "condizioni speciali"): an offer obtained through an authorized forcing states the particular conditions
 * actually applied, on screen and in the PDF, in words meant for the customer. It names only the CTE requirements the offer
 * departs from: never who authorized it, roles or company permissions. No imports, so the screen and the server use it alike.
 */
const OFFER_CONDITION_TEXT: Readonly<Record<string, string>> = {
  CUSTOMER_LEGAL_TYPE_MISMATCH: "tipologia di cliente (consumatore o impresa) prevista dalla CTE",
  SUPPLY_USE_MISMATCH: "uso della fornitura previsto dalla CTE",
  IDENTIFIER_TYPE_MISMATCH: "tipo di identificativo fiscale previsto dalla CTE",
  VOLTAGE_MISMATCH: "livello di tensione previsto dalla CTE",
  CONSUMPTION_THRESHOLD_MISMATCH: "soglia di consumo annuo prevista dalla CTE",
  POWER_THRESHOLD_MISMATCH: "soglia di potenza prevista dalla CTE",
  CONDOMINIUM_ONLY: "riserva della CTE ai soli condomini",
};

export const SPECIAL_CONDITIONS_TITLE = "Condizioni particolari applicate";
export const SPECIAL_CONDITIONS_FOOTNOTE = "Restano fermi gli obblighi previsti dalla regolazione e i limiti tecnici della fornitura.";

/** The conditions in words, one per requirement, in a stable order; an unknown code is said as such, never dropped. */
export function specialConditionLines(codes: readonly string[] | null | undefined): readonly string[] {
  return [...new Set(codes ?? [])].map((code) => OFFER_CONDITION_TEXT[code] ?? "requisito di accesso della CTE");
}

/** One sentence for the offer: "Offerta proposta in deroga a: …." (empty when no condition applies). */
export function specialConditionsSentence(codes: readonly string[] | null | undefined): string {
  const lines = specialConditionLines(codes);
  return lines.length ? `Offerta proposta in deroga a: ${lines.join("; ")}.` : "";
}
