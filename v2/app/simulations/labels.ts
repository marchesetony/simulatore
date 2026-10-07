import type { BlockReason, FeeKind } from "../../modules/simulations/types";
export const feeLabels: Record<FeeKind, string> = {
  COMMERCIALIZATION: "Commercializzazione fissa", IMBALANCE: "Sbilanciamento", OTHER_VARIABLE: "Altre quote variabili",
  ONE_OFF: "Una tantum", DISCOUNT: "Sconti",
};
export const reasonLabels: Record<BlockReason, string> = {
  MISSING_CONSUMPTION: "Consumi necessari mancanti", AMBIGUOUS_CONSUMPTION: "Consumi sovrapposti o ambigui",
  INCOMPATIBLE_PERIOD: "Periodi incompatibili con la formula", MISSING_CURRENT_TERMS: "Termini attuali non disponibili",
  MISSING_CANDIDATE_TERMS: "Termini candidati mancanti", MISSING_MARKET_DATA: "PUN del mese o della fascia mancante",
  AMBIGUOUS_MARKET_DATA: "Più valori PUN per la stessa fascia e mese", UNKNOWN_UNIT: "Unità mancante o incompatibile",
  MISSING_COMMERCIAL_COMPONENT: "Importo o applicabilità commerciale non noto", AMBIGUOUS_COMPONENT: "Componenti non distinguibili con certezza",
  AMOUNT_OUT_OF_RANGE: "Importo fuori dall’intervallo supportato",
};
export function money(value: number | null): string {
  if (value === null) return "Non disponibile";
  const magnitude = Math.abs(value);
  return `${value < 0 ? "−" : ""}${Math.floor(magnitude / 100)},${String(magnitude % 100).padStart(2, "0")} €`;
}
