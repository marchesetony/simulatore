export function formatEuro(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "Non disponibile";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
}

export function formatNumber(value: number | null | undefined, unit = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Non disponibile";
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }).format(value)}${unit ? ` ${unit}` : ""}`;
}

export function statusLabel(value: string | null | undefined): string {
  if (!value) return "Non disponibile";
  const labels: Record<string, string> = {
    REVIEW_REQUIRED: "Revisione richiesta",
    CONFIRMED: "Confermato",
    UNCERTAIN: "Da verificare",
    NOT_FOUND: "Non rilevato",
    CORRECTED: "Corretto",
    FAILED: "Non riuscito",
    APPROVED: "Approvato",
    UPLOADED: "Caricato",
    OCR_PROCESSING: "Analisi OCR in corso",
    EXTRACTION_PROCESSING: "Estrazione in corso",
    PROVIDER_NOT_CONFIGURED: "Provider non configurato",
  };
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function safeText(value: unknown, fallback = "Non disponibile"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
