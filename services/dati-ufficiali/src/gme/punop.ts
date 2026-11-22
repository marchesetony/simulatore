import { publishedPdfText } from "../../../../app/lib/market/gme-pun-source";

/**
 * Parametro dell'articolo 5.2 della deliberazione ARERA 300/05 (Tony 22/11/2026): a GME series of its own, published monthly on
 * "Prezzo medio delibera ARERA 300/05" as a one-page PDF ("Maggio 2026 PUNopMag2026 122,83 €/MWh"). It is neither the PUN Index
 * GME monthly value nor the F1/F2/F3 bands: it keeps its own identifier, regulatory meaning, period, source, unit and version,
 * and it is never written into the PUN archive the engine reads. A CTE uses it only when the CTE names it.
 */
export const GME_PUNOP_300_SERIES_ID = "ARERA_300_05_ART_5_2" as const;
export const GME_PUNOP_300_MEANING = "Parametro art. 5.2 della deliberazione ARERA 300/05 (PUNop), pubblicato dal GME";
export const GME_PUNOP_300_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioDel300";
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const SHORT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
const GME_HOSTS = new Set(["gme.mercatoelettrico.org", "www.mercatoelettrico.org"]);

export interface PunopCheck { readonly code: string; readonly ok: boolean; readonly detail: string }
export interface PunopReading { readonly checks: readonly PunopCheck[]; readonly value: number | null; readonly label: string | null }

const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
const isPdf = (bytes: Uint8Array) => bytes.byteLength > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
const number = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

/** The PDF of the month on the GME page: link label "Prezzo medio delibera ARERA 300/05 - <Mese> <anno>" or the file name. */
export function findPunopPdf(html: string, month: string, baseUrl = GME_PUNOP_300_PAGE): string | null {
  const name = monthName(month); const year = month.slice(0, 4);
  const label = new RegExp(`300\\s*/\\s*05\\s*[-–]\\s*${name}\\s+${year}`, "i");
  const file = new RegExp(`300\\.05\\s*-\\s*${name}\\s*${year}\\.pdf$`, "i");
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(match[1].replace(/&amp;/g, "&"), baseUrl); } catch { continue; }
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const path = decodeURIComponent(url.pathname);
    if (!(label.test(text) || file.test(path))) continue;
    if (url.protocol === "https:" && GME_HOSTS.has(url.hostname.toLowerCase()) && /\.pdf$/i.test(path)) return url.toString();
  }
  return null;
}

/** Reads the parameter from the PDF text: article 5.2, deliberation 300/05, month and year, the PUNop label of the month, €/MWh. */
export function readPunopText(text: string, month: string): PunopReading {
  const flat = text.replace(/\s+/g, " ");
  const checks: PunopCheck[] = [];
  const article = /articolo\s*5\.2/i.test(flat) && /300\s*\/\s*05/.test(flat);
  checks.push({ code: "REGULATION", ok: article, detail: article ? "articolo 5.2 della deliberazione ARERA 300/05" : "riferimento all'art. 5.2 della deliberazione 300/05 non trovato" });
  const name = monthName(month); const year = month.slice(0, 4);
  const expectedLabel = `PUNop${SHORT[Number(month.slice(5, 7)) - 1]}${year}`;
  const named = [...flat.matchAll(/\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d\d)\b/gi)].map((m) => `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`);
  const monthOk = named.length > 0 && named.every((value) => value === month);
  checks.push({ code: "MONTH", ok: monthOk, detail: named.length ? `mese indicato: ${[...new Set(named)].join(", ")} (atteso ${name} ${year})` : "mese non indicato nel documento" });
  const labels = [...flat.matchAll(/PUNop[A-Za-z]{3}\d{4}/g)].map((m) => m[0]);
  const labelOk = labels.length > 0 && labels.every((value) => value.toLowerCase() === expectedLabel.toLowerCase());
  checks.push({ code: "LABEL", ok: labelOk, detail: labels.length ? `etichetta ${labels.join(", ")} (attesa ${expectedLabel})` : "etichetta PUNop del mese non trovata" });
  // The PDF text layer can glue the label to the value ("PUNopMag2026122,83"): the label is removed before reading numbers.
  const values = [...flat.replace(/PUNop[A-Za-z]{3}\d{4}/g, " ").matchAll(/(\d{1,4}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)\s*\/\s*MWh/gi)].map((m) => m[1]);
  const unique = [...new Set(values)];
  checks.push({ code: "UNIT", ok: values.length > 0, detail: values.length ? "unità €/MWh" : "valore in €/MWh non trovato" });
  checks.push({ code: "VALUE", ok: unique.length === 1, detail: unique.length === 1 ? `valore ${unique[0]} €/MWh` : unique.length ? `più valori diversi: ${unique.join(", ")}` : "valore non trovato" });
  const value = unique.length === 1 ? number(unique[0]) : null;
  const plausible = value !== null && Number.isFinite(value) && value > 0 && value < 5000;
  checks.push({ code: "RANGE", ok: plausible, detail: plausible ? "valore nel campo ammesso (0–5000 €/MWh)" : "valore assente o fuori dal campo ammesso" });
  return { checks, value: checks.every((check) => check.ok) ? value : null, label: labels[0] ?? null };
}

export function readPunopPdf(bytes: Uint8Array, month: string): PunopReading {
  if (!isPdf(bytes)) return { checks: [{ code: "FORMAT", ok: false, detail: "atteso un file PDF (intestazione %PDF-)" }], value: null, label: null };
  let text = "";
  try { text = publishedPdfText(bytes); } catch { text = ""; }
  if (!text.trim()) return { checks: [{ code: "FORMAT", ok: true, detail: "file PDF" }, { code: "TEXT", ok: false, detail: "testo del PDF non leggibile" }], value: null, label: null };
  const reading = readPunopText(text, month);
  return { ...reading, checks: [{ code: "FORMAT", ok: true, detail: "file PDF" }, { code: "TEXT", ok: true, detail: "testo del PDF leggibile" }, ...reading.checks] };
}
