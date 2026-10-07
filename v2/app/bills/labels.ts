import type { Bill, LineKind } from "../../modules/bills/types";
export const kindLabels: Record<LineKind, string> = {
  ENERGY: "Materia energia", COMMERCIALIZATION: "Commercializzazione", SELLER_OTHER: "Altri corrispettivi venditore",
  NETWORK: "Trasporto e misura", SYSTEM_CHARGES: "Oneri di sistema", EXCISE: "Accise", VAT: "IVA",
  TV_LICENSE: "Canone TV", PREVIOUS_BALANCE: "Saldo precedente", RECALCULATION: "Ricalcoli",
  OTHER_AMOUNTS: "Altre partite", UNKNOWN: "Non classificata",
};
export function money(value: number | null): string {
  if (value === null) return "Non noto";
  const absolute = Math.abs(value);
  return `${value < 0 ? "−" : ""}${Math.floor(absolute / 100).toLocaleString("it-IT")},${String(absolute % 100).padStart(2, "0")} €`;
}
export function euroInput(value: number | null): string {
  if (value === null) return "";
  return `${value < 0 ? "-" : ""}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, "0")}`;
}
export const completenessLabels: Record<Bill["completenessStatus"], string> = { COMPLETE: "Dati necessari completi", INCOMPLETE: "Dati incompleti" };
export const validationLabels: Record<Bill["validationStatus"], string> = { VALID: "Controlli superati", INVALID: "Differenza da verificare", UNVALIDATED: "Verifica non determinabile" };
