/**
 * Control Room produttore (Tony, 17/11/2026, "Control Room produttore e alert archivi"): i documenti ufficiali che la
 * piattaforma deve avere per tutte le aziende, quando controllarli, dove si trovano e come si caricano a mano quando
 * l'acquisizione automatica non riesce. Un'acquisizione automatica è dichiarata solo dove esiste già un lettore di una fonte
 * ufficiale con formato verificato (refresh notturni GME, ARERA, Terna); altrove l'alert chiede il caricamento o la verifica.
 */
export type OfficialSource = "GME" | "ARERA" | "TERNA" | "ADM";
export type OfficialDocumentCode = "GME_PUN_MONTH" | "ARERA_REGULATED_REFRESH" | "ARERA_TIME_TABLES" | "ARERA_TIT_TABLE5_REACTIVE" | "TERNA_DISPATCHING_CAPACITY" | "ADM_EXCISE_RATES";
export type Acquisition = "AUTOMATIC" | "MANUAL_UPLOAD" | "MANUAL_VERIFICATION";

export interface CatalogEntry {
  readonly code: OfficialDocumentCode;
  readonly source: OfficialSource;
  readonly document: string;
  readonly periodKind: "MONTH" | "YEAR" | "CHECK_DATE";
  /** Official page or file; `linkByPeriod` holds the exact file where it is known for that period. */
  readonly officialLink: string;
  readonly linkByPeriod?: Readonly<Record<string, string>>;
  readonly acquisition: Acquisition;
  /** Steps to get the official file, written for the producer. */
  readonly instructions: readonly string[];
  /** Exact path in the app where the file is uploaded (or the check confirmed). */
  readonly uploadPath: string;
}

/** Visible only to the ADMIN of tenant_piattaforma (checked on the server). */
export const CONTROL_ROOM_PATH = "Menu Stato sistema → Control Room Produttore → Archivi ufficiali";

export const OFFICIAL_CATALOG: readonly CatalogEntry[] = [
  {
    code: "GME_PUN_MONTH", source: "GME", periodKind: "MONTH", acquisition: "AUTOMATIC",
    document: "PUN Index GME del mese: valore mensile unico e fasce F1, F2, F3 (€/MWh)",
    officialLink: "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce",
    instructions: [
      "Apri la pagina GME \"Prezzo medio per fasce\" (denominazione ufficiale dal 2025: PUN Index GME).",
      "Verifica che il mese indicato sia pubblicato con il valore mensile e le fasce F1, F2, F3.",
      "Se è pubblicato, avvia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali: il valore si legge solo dal GME, non si inserisce a mano.",
    ],
    uploadPath: "Menu Stato sistema → Aggiorna dati ufficiali → fonte PUN (nessun caricamento manuale: il PUN si legge solo dal GME)",
  },
  {
    code: "ARERA_REGULATED_REFRESH", source: "ARERA", periodKind: "CHECK_DATE", acquisition: "AUTOMATIC",
    document: "Tariffe di rete e oneri di sistema ARERA del periodo (TIT, TIME, ASOS, ARIM, UC), capacità TIV",
    officialLink: "https://www.arera.it/area-operatori/prezzi-e-tariffe/oneri-generali-di-sistema-e-ulteriori-componenti",
    instructions: [
      "Apri la pagina ARERA indicata e individua la delibera di aggiornamento del periodo.",
      "Confronta il motivo dell'errore con il documento: se ARERA ha cambiato formato, il lettore va aggiornato prima di caricare dati.",
      "Rilancia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali → fonte ARERA.",
    ],
    uploadPath: "Menu Stato sistema → Aggiorna dati ufficiali → fonte ARERA",
  },
  {
    code: "ARERA_TIME_TABLES", source: "ARERA", periodKind: "YEAR", acquisition: "MANUAL_UPLOAD",
    document: "Tabelle TIME (misura MIS1 INS-RAV + MIS1 RES, BT altri usi)",
    officialLink: "https://www.arera.it/area-operatori/prezzi-e-tariffe/tariffa-per-il-servizio-di-misura",
    instructions: [
      "Apri la pagina ARERA \"Tariffa per il servizio di misura\".",
      "Scarica il file Excel delle tabelle TIME della delibera in vigore, senza modificarlo.",
    ],
    uploadPath: "Menu Stato sistema → Azione richiesta: tabelle ARERA → Carica tabella",
  },
  {
    code: "ARERA_TIT_TABLE5_REACTIVE", source: "ARERA", periodKind: "YEAR", acquisition: "MANUAL_UPLOAD",
    document: "TIT 2024-2027, Tabella 5 \"Corrispettivi per energia reattiva\" (c€/kvarh, BT e MT)",
    officialLink: "https://www.arera.it/atti-e-provvedimenti",
    linkByPeriod: { "2026": "https://www.arera.it/fileadmin/allegati/docs/25/575-2025-R-eel-TABELLE_TIT.xlsx" },
    instructions: [
      "Apri la pagina ARERA della delibera di aggiornamento tariffario dell'anno (per il 2026: https://www.arera.it/atti-e-provvedimenti/dettaglio/25/575-25).",
      "Scarica l'allegato \"Tabelle TIT\" in formato Excel (per il 2026: 575-2025-R-eel-TABELLE_TIT.xlsx), senza aprirlo né salvarlo di nuovo.",
      "Caricalo in Archivi ufficiali e premi \"Valida documento\": l'app cerca la Tabella 5 per testo, controlla unità, anno, tensioni e fasce, conserva il file e la sua impronta SHA-256.",
      "Controlla l'anteprima (valori, celle, SHA-256, controlli) e premi \"Pubblica aggiornamento\" confermando l'impronta: solo allora la tariffa è disponibile a tutte le aziende.",
    ],
    uploadPath: `${CONTROL_ROOM_PATH} → archivio ARERA → alert \"Apri il documento\" (oppure Carica documento dal computer, documento \"TIT 2024-2027, Tabella 5\") → Valida documento → Pubblica aggiornamento`,
  },
  {
    code: "TERNA_DISPATCHING_CAPACITY", source: "TERNA", periodKind: "CHECK_DATE", acquisition: "AUTOMATIC",
    document: "Corrispettivi di dispacciamento Terna (TIDE) e capacità",
    officialLink: "https://dati.terna.it/corrispettivi",
    instructions: [
      "Apri la pagina Terna \"Corrispettivi\" e verifica la pubblicazione del periodo.",
      "Rilancia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali → fonti Terna e dispacciamento.",
    ],
    uploadPath: "Menu Stato sistema → Aggiorna dati ufficiali → fonti terna, capacity, dispatching",
  },
  {
    code: "ADM_EXCISE_RATES", source: "ADM", periodKind: "YEAR", acquisition: "MANUAL_VERIFICATION",
    document: "Aliquote di accisa sull'energia elettrica (D.Lgs. 504/1995, Allegato I) e loro variazioni",
    officialLink: "https://www.adm.gov.it/",
    instructions: [
      "Apri il portale ADM, sezione accise sull'energia elettrica, e verifica se nell'anno sono cambiate le aliquote o gli scaglioni.",
      "Non esiste ancora una lettura automatica da fonte ADM con formato verificato: la verifica è manuale.",
      "Conferma la verifica nella Control Room; se le aliquote sono cambiate, l'aggiornamento del motore va richiesto.",
    ],
    uploadPath: `${CONTROL_ROOM_PATH} → archivio ADM → alert \"Accise\" → Conferma verifica`,
  },
];

export const catalogEntry = (code: OfficialDocumentCode): CatalogEntry => {
  const entry = OFFICIAL_CATALOG.find((item) => item.code === code);
  if (!entry) throw new Error(`OFFICIAL_DOCUMENT_UNKNOWN:${code}`);
  return entry;
};

export const officialLinkFor = (entry: CatalogEntry, period: string): string => entry.linkByPeriod?.[period] ?? entry.officialLink;

export interface DueCheck { readonly code: OfficialDocumentCode; readonly period: string; readonly why: string }

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Checks due on a day (Europe/Rome calendar day of `now`):
 * - GME from the 5th to the 14th: the previous month's PUN, every day until it is in the archive;
 * - ARERA, Terna, ADM on the 1st and the 16th;
 * - deadlines: from 15 December the yearly ARERA tables of the next year (they apply from 1 January).
 */
export function dueChecks(now: string): readonly DueCheck[] {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("OFFICIAL_MONITOR_DATE_INVALID");
  // Calendar day in Italy (CET/CEST): the cron runs early in the morning UTC.
  const local = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const year = local.getFullYear(); const month = local.getMonth() + 1; const day = local.getDate();
  const out: DueCheck[] = [];
  if (day >= 5 && day <= 14) {
    const previous = month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
    out.push({ code: "GME_PUN_MONTH", period: previous, why: `controllo giornaliero dal 5 al 14: PUN di ${previous}` });
  }
  if (day === 1 || day === 16) {
    const today = `${year}-${pad(month)}-${pad(day)}`;
    out.push({ code: "ARERA_REGULATED_REFRESH", period: today, why: `controllo programmato del ${day}` });
    out.push({ code: "TERNA_DISPATCHING_CAPACITY", period: today, why: `controllo programmato del ${day}` });
    out.push({ code: "ARERA_TIME_TABLES", period: String(year), why: `controllo programmato del ${day}` });
    out.push({ code: "ARERA_TIT_TABLE5_REACTIVE", period: String(year), why: `controllo programmato del ${day}` });
    out.push({ code: "ADM_EXCISE_RATES", period: String(year), why: `controllo programmato del ${day}` });
  }
  if (month === 12 && day >= 15) {
    for (const code of ["ARERA_TIME_TABLES", "ARERA_TIT_TABLE5_REACTIVE"] as const) out.push({ code, period: String(year + 1), why: `scadenza: tabelle ${year + 1} in vigore dal 1° gennaio` });
  }
  return out;
}
