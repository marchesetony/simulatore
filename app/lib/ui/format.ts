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
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function safeText(value: unknown, fallback = "Non disponibile"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
