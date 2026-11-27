import type { OfficialDocumentRecord } from "../../official-monitor/documents";
import type { V3ReactiveTariffRow } from "../types";

/**
 * Motore V3, adattatore: righe della Tabella 5 TIT lette dal file ufficiale VALIDATO e PUBBLICATO in Control Room Produttore → Archivi ufficiali
 * (Tony, 17/11/2026). Solo documenti con stato VALIDATED entrano; un caricamento rifiutato non produce righe. Ogni riga porta
 * foglio e cella del file, impronta SHA-256, versione e livello di provenienza. Le fasce con lo stesso valore e la stessa soglia
 * diventano una sola riga (es. prelevata F1+F2 oltre il 33%).
 */
export function reactiveRowsFromOfficialDocuments(documents: readonly OfficialDocumentRecord[]): V3ReactiveTariffRow[] {
  const rows: V3ReactiveTariffRow[] = [];
  for (const document of documents) {
    if (document.status !== "VALIDATED" || document.code !== "ARERA_TIT_TABLE5_REACTIVE") continue;
    const year = Number(document.period);
    const values = document.values.filter((value) => value.year === year && Number(value.centsPerKvarh) > 0);
    const groups = new Map<string, typeof values[number][]>();
    for (const value of values) {
      const key = `${value.voltage}|${value.kind}|${value.centsPerKvarh}|${value.thresholdRatio}`;
      groups.set(key, [...(groups.get(key) ?? []), value]);
    }
    const perKind = new Map<string, number>();
    for (const group of groups.values()) { const key = `${group[0].voltage}|${group[0].kind}`; perKind.set(key, (perKind.get(key) ?? 0) + 1); }
    for (const group of groups.values()) {
      const first = group[0];
      const kindLabel = first.kind === "INJECTED" ? "IMMESSA" : "PRELEVATA";
      const bands = group.map((value) => value.band).sort();
      const id = `TIT5-${first.voltage}-${year}-${kindLabel}${(perKind.get(`${first.voltage}|${first.kind}`) ?? 0) > 1 ? `-${bands.join("")}` : ""}`;
      rows.push({
        id, voltage: first.voltage, validFrom: `${year}-01-01`, validToExclusive: `${year + 1}-01-01`, kind: first.kind, bands, fromRatio: first.thresholdRatio, toRatio: null,
        rate: {
          value: first.centsPerKvarh, unit: "cEUR/kVArh",
          source: {
            kind: "ARERA",
            reference: `TIT Tabella 5, ${first.voltage === "BT" ? "bassa tensione" : "media tensione"}, ${first.kind === "INJECTED" ? "energia reattiva immessa" : `prelevata oltre ${Number(first.thresholdRatio) * 100}% dell'attiva`}, anno ${year}`,
            evidence: `${document.originalName} v${document.version}, ${group.map((value) => `${value.sheet}!${value.cell}`).join(", ")}, SHA-256 ${document.sha256}`,
            verification: { level: "ORIGINAL_DOCUMENT", checkedOn: document.uploadedAt.slice(0, 10), note: `file ufficiale validato e pubblicato in Archivi ufficiali; provenienza: ${document.provenance.detail}` },
          },
        },
      });
    }
  }
  return rows;
}
