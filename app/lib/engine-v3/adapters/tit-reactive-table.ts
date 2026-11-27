import type { V3Source, V3ReactiveTariffRow, V3Band } from "../types";

/**
 * Motore V3, adattatore: TIT 2024-2027, Tabella 5 "Corrispettivi per energia reattiva" (centesimi di euro/kvarh), nel testo
 * aggiornato per il 2026 dalla deliberazione 575/2025/R/eel (punto 1: sostituzione delle tabelle 1, 3, 4 e 5 del TIT).
 *
 * Verifica (Tony, 16/11/2026, "V3: completamento energia reattiva 2026"):
 * - Allegato originale ARERA (575-2025-R-eel-TABELLE_TIT.xlsx e 575-2025-R-eel_Testo_integrato_tabelle_TIT.xlsx, pagine
 *   arera.it delle delibere 575/25 e 616/23): NON letto. Dall'ambiente di sviluppo arera.it è rifiutato dalla rete (proxy 403)
 *   e la lettura web del file restituisce solo dati binari. Nessun valore qui è verificato sull'originale.
 * - Riproduzione del distributore Edyna, PDF "575-2025-R-eel-TABELLE_TIT.pdf" (edyna.net, area venditori, tariffe 2025), letta il
 *   16/11/2026: Tabella 5 con colonne 2024/2025/2026/2027, per F1/F2 "energia reattiva prelevata eccedente il 33% dell'energia
 *   attiva" e per F3 "energia reattiva immessa". Il testo estratto separa i numeri dalle etichette di riga: l'attribuzione dei
 *   blocchi a BT e MT è dedotta (BT 2025 = 1,046 come riportato da fonte secondaria per la 585/2024; rapporto BT/MT ≈ 2,9 come nelle tabelle
 *   precedenti), non letta accanto all'etichetta.
 * Quindi ogni riga è marcata REPRODUCTION: il calcolo è possibile, il totale resta provvisorio finché l'originale non è verificato.
 * Le righe "quota parte che concorre ai ricavi effettivi" (perequazione, art. 34) non sono corrispettivi al cliente e non sono qui.
 */
const CHECKED_ON = "2026-11-16";
const REPRODUCTION_URL = "https://www.edyna.net/fileadmin/filemount/Pdf/04_venditori/2025_Tariffe/575-2025-R-eel-TABELLE_TIT.pdf";

function source(voltage: "BT" | "MT", year: number, column: "prelevata eccedente il 33%" | "immessa"): V3Source {
  return {
    kind: "ARERA",
    reference: `TIT 2024-2027 Tabella 5 (${year === 2026 ? "testo aggiornato dalla delibera 575/2025/R/eel" : year === 2025 ? "valori 2025" : "valori 2024"}), ${voltage === "BT" ? "punti di prelievo in bassa tensione" : "punti di prelievo in media tensione"}, ${column}, anno ${year}`,
    evidence: `riproduzione Edyna ${REPRODUCTION_URL}`,
    verification: { level: "REPRODUCTION", checkedOn: CHECKED_ON, note: `allegato originale ARERA non letto (arera.it non raggiungibile dall'ambiente); attribuzione ${voltage} dedotta dall'ordine dei blocchi e dai valori 2025` },
  };
}

/** c€/kvarh as published, per voltage and year: the same value applies to withdrawn F1/F2 above 33% and to injected F3. */
const VALUES: readonly { readonly voltage: "BT" | "MT"; readonly year: number; readonly cents: string }[] = [
  { voltage: "BT", year: 2024, cents: "1.169" }, { voltage: "BT", year: 2025, cents: "1.046" }, { voltage: "BT", year: 2026, cents: "1.088" },
  { voltage: "MT", year: 2024, cents: "0.408" }, { voltage: "MT", year: 2025, cents: "0.361" }, { voltage: "MT", year: 2026, cents: "0.377" },
];

function rows(): V3ReactiveTariffRow[] {
  const out: V3ReactiveTariffRow[] = [];
  for (const entry of VALUES) {
    const validFrom = `${entry.year}-01-01`; const validToExclusive = `${entry.year + 1}-01-01`;
    const withdrawn: readonly V3Band[] = ["F1", "F2"];
    out.push({ id: `TIT5-${entry.voltage}-${entry.year}-PRELEVATA`, voltage: entry.voltage, validFrom, validToExclusive, kind: "WITHDRAWN", bands: withdrawn, fromRatio: "0.33", toRatio: null, rate: { value: entry.cents, unit: "cEUR/kVArh", source: source(entry.voltage, entry.year, "prelevata eccedente il 33%") } });
    out.push({ id: `TIT5-${entry.voltage}-${entry.year}-IMMESSA`, voltage: entry.voltage, validFrom, validToExclusive, kind: "INJECTED", bands: ["F3"], fromRatio: "0", toRatio: null, rate: { value: entry.cents, unit: "cEUR/kVArh", source: source(entry.voltage, entry.year, "immessa") } });
  }
  return out;
}

/** The table rows on file (2024-2026; 2027 not yet published in the reproduction read). */
export const TIT_TABLE5_REACTIVE: readonly V3ReactiveTariffRow[] = rows();
