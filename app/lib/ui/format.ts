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

export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function formatInclusivePeriodEnd(endExclusive: string | null | undefined): string | null {
  if (!endExclusive) return null;
  const date = new Date(`${endExclusive}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return endExclusive;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function formatBillDisplayPeriod(start: string | null | undefined, endExclusive: string | null | undefined): string {
  const inclusiveEnd = formatInclusivePeriodEnd(endExclusive);
  return start && inclusiveEnd ? `${formatDisplayDate(start)} – ${formatDisplayDate(inclusiveEnd)}` : "";
}
