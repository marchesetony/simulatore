// Tony (5/11/2026, "continuano gli errori di lettura, ancora stiamo rattopando anziche cancellare e ripartire da zero"):
// the bill is read in one place only. Claude looks at the whole PDF (or photo) like a person does and fills this form;
// nothing is taken from the PDF text layer with patterns any more. Every value is copied as printed; a value that is not
// printed stays "" and is listed in `assenti` with the reason.

export const BILL_READER_TOOL_NAME = "leggi_bolletta";

const text = (description: string) => ({ type: "string", description });
const page = { type: "integer", description: "Pagina del PDF (da 1) dove è stampato il valore; 0 se non stampato." } as const;

const SCONTRINO_TYPES = ["QUOTA_TOTALE", "DI_CUI_VENDITA", "DI_CUI_RETE_ONERI", "ENERGIA_REATTIVA", "RICALCOLI", "ALTRE_PARTITE", "BONUS_SOCIALE", "ACCISE_IVA", "CANONE_TV", "TOTALE_BOLLETTA", "ALTRO"] as const;
const SCONTRINO_QUOTAS = ["CONSUMI", "FISSA", "POTENZA", "NESSUNA"] as const;
export const DETAIL_ITEMS = [
  "PREZZO_ENERGIA", "INDICE_PUN", "SPREAD", "PERDITE", "DISPACCIAMENTO", "CAPACITA", "SBILANCIAMENTO", "PCV", "COMMERCIALIZZAZIONE_VARIABILE", "ALTRO_VENDITA",
  "TRASPORTO_ENERGIA", "TRASPORTO_QUOTA_FISSA", "TRASPORTO_POTENZA", "ONERI_ASOS", "ONERI_ARIM", "ONERI_ALTRI", "ENERGIA_REATTIVA",
  "ACCISE", "IVA", "BONUS_SOCIALE", "ALTRE_PARTITE", "ALTRO",
] as const;
const BANDS = ["F1", "F2", "F3", "F23", "MONORARIA", "PICCO", "FUORI_PICCO", "NESSUNA"] as const;

export type ScontrinoType = typeof SCONTRINO_TYPES[number];
export type ScontrinoQuota = typeof SCONTRINO_QUOTAS[number];
export type DetailItem = typeof DETAIL_ITEMS[number];
export type Band = typeof BANDS[number];

export interface ScontrinoRow { readonly etichetta: string; readonly tipo: ScontrinoType; readonly quota: ScontrinoQuota; readonly quantita: string; readonly unita: string; readonly prezzoMedio: string; readonly unitaPrezzo: string; readonly importo: string; readonly pagina: number }
export interface DetailRow { readonly descrizione: string; readonly voce: DetailItem; readonly fascia: Band; readonly periodo: string; readonly quantita: string; readonly unita: string; readonly prezzo: string; readonly unitaPrezzo: string; readonly importo: string; readonly pagina: number }
export interface FormulaValue { readonly etichetta: string; readonly valore: string; readonly unita: string; readonly pagina: number }
export interface Source { readonly campo: string; readonly pagina: number; readonly testo: string }
export interface Absent { readonly campo: string; readonly motivo: string }

/** What Claude returns: every value as printed ("" when not printed). */
export interface BillReading {
  readonly tipoDocumento: "BOLLETTA_SINTETICA" | "BOLLETTA_COMPLETA" | "FATTURA_DETTAGLIO" | "NON_BOLLETTA";
  readonly vettore: "EE" | "GAS" | "NON_DETERMINABILE";
  readonly fornitore: string;
  readonly intestatario: string;
  readonly codiceCliente: string;
  readonly codiceFiscalePartitaIva: string;
  readonly pod: string;
  readonly pdr: string;
  readonly tipoClienteStampato: string;
  readonly tipoCliente: "DOMESTICO" | "ALTRI_USI" | "NON_DETERMINABILE";
  readonly tensioneStampata: string;
  readonly livelloTensione: "BT" | "MT" | "AT" | "NON_DETERMINABILE";
  readonly potenzaImpegnataKw: string;
  readonly potenzaDisponibileKw: string;
  readonly potenzaMassimaPrelevataKw: string;
  readonly classeAsos: string;
  readonly mercato: string;
  readonly periodoStampato: string;
  readonly periodoDal: string;
  readonly periodoAl: string;
  readonly dataEmissione: string;
  readonly dataScadenzaPagamento: string;
  readonly consumoFatturato: string;
  readonly consumoF1: string;
  readonly consumoF2: string;
  readonly consumoF3: string;
  readonly consumoPicco: string;
  readonly consumoFuoriPicco: string;
  readonly consumoSmc: string;
  readonly coefficienteC: string;
  readonly pcs: string;
  readonly consumoAnnuo: string;
  readonly storicoConsumi: readonly { readonly mese: string; readonly consumo: string }[];
  readonly offertaNome: string;
  readonly offertaCodice: string;
  readonly tipologiaOfferta: string;
  readonly tipologiaPrezzo: string;
  readonly indice: string;
  readonly spread: string;
  readonly pcvMensile: string;
  readonly attivazioneFornitura: string;
  readonly decorrenzaCondizioni: string;
  readonly scadenzaCondizioni: string;
  readonly scadenzaContratto: string;
  readonly prezzoEnergiaF1: string;
  readonly prezzoEnergiaF2: string;
  readonly prezzoEnergiaF3: string;
  readonly prezzoEnergiaF23: string;
  readonly prezzoEnergiaMonorario: string;
  readonly coefficientePerdite: string;
  readonly valoriFormula: readonly FormulaValue[];
  readonly scontrino: readonly ScontrinoRow[];
  readonly dettaglio: readonly DetailRow[];
  readonly totaleBolletta: string;
  readonly fonti: readonly Source[];
  readonly assenti: readonly Absent[];
}

export const BILL_READER_SCALARS = [
  "fornitore", "intestatario", "codiceCliente", "codiceFiscalePartitaIva", "pod", "pdr", "tipoClienteStampato", "tensioneStampata",
  "potenzaImpegnataKw", "potenzaDisponibileKw", "potenzaMassimaPrelevataKw", "classeAsos", "mercato",
  "periodoStampato", "periodoDal", "periodoAl", "dataEmissione", "dataScadenzaPagamento",
  "consumoFatturato", "consumoF1", "consumoF2", "consumoF3", "consumoPicco", "consumoFuoriPicco", "consumoSmc", "coefficienteC", "pcs", "consumoAnnuo",
  "offertaNome", "offertaCodice", "tipologiaOfferta", "tipologiaPrezzo", "indice", "spread", "pcvMensile", "attivazioneFornitura", "decorrenzaCondizioni", "scadenzaCondizioni", "scadenzaContratto",
  "prezzoEnergiaF1", "prezzoEnergiaF2", "prezzoEnergiaF3", "prezzoEnergiaF23", "prezzoEnergiaMonorario", "coefficientePerdite", "totaleBolletta",
] as const;

const SCALAR_HELP: Readonly<Record<typeof BILL_READER_SCALARS[number], string>> = {
  fornitore: "Ragione sociale del venditore che emette la bolletta.",
  intestatario: "Nome e cognome o ragione sociale dell'intestatario.",
  codiceCliente: "Codice cliente.",
  codiceFiscalePartitaIva: "Codice fiscale o partita IVA del cliente.",
  pod: "POD (luce): inizia con IT, 14-15 caratteri, senza spazi.",
  pdr: "PDR (gas): 14 cifre.",
  tipoClienteStampato: "Testo stampato della tipologia cliente/uso (es. 'Domestico residente', 'Altri usi', 'BTA3').",
  tensioneStampata: "Riga stampata della tensione (es. '220 V', 'Bassa tensione', '20.000 V').",
  potenzaImpegnataKw: "Potenza impegnata in kW, solo il numero.",
  potenzaDisponibileKw: "Potenza disponibile in kW, solo il numero.",
  potenzaMassimaPrelevataKw: "Potenza massima prelevata nel periodo in kW, se stampata.",
  classeAsos: "Classe di agevolazione ASOS, se stampata.",
  mercato: "Mercato (libero, tutele graduali, servizio di tutela) come stampato.",
  periodoStampato: "Periodo di fornitura fatturato esattamente come stampato.",
  periodoDal: "Primo giorno del periodo fatturato in formato AAAA-MM-GG.",
  periodoAl: "Ultimo giorno del periodo fatturato in formato AAAA-MM-GG (es. 2026-09-30 per settembre).",
  dataEmissione: "Data di emissione AAAA-MM-GG.",
  dataScadenzaPagamento: "Scadenza del pagamento AAAA-MM-GG.",
  consumoFatturato: "Consumo totale fatturato nel periodo (kWh luce, Smc gas): solo il numero come stampato.",
  consumoF1: "kWh fatturati in F1 nel periodo (consumo, non prezzo).",
  consumoF2: "kWh fatturati in F2 nel periodo.",
  consumoF3: "kWh fatturati in F3 nel periodo.",
  consumoPicco: "kWh nelle ore di picco, se stampati.",
  consumoFuoriPicco: "kWh nelle ore fuori picco, se stampati.",
  consumoSmc: "Smc fatturati (gas).",
  coefficienteC: "Coefficiente di conversione C (gas).",
  pcs: "Potere calorifico superiore (gas).",
  consumoAnnuo: "Consumo annuo stampato (kWh o Smc), solo il numero.",
  offertaNome: "Nome commerciale dell'offerta nel Box dell'offerta.",
  offertaCodice: "Codice offerta completo, esattamente come stampato.",
  tipologiaOfferta: "Tipologia offerta come stampata (es. VARIABILE, FISSO).",
  tipologiaPrezzo: "Tipologia prezzo come stampata (monorario, per fasce, orario).",
  indice: "Indice di riferimento (es. PUN Index GME, PSV).",
  spread: "Spread/maggiorazione sull'indice con unità (es. '0,015 €/kWh').",
  pcvMensile: "Quota fissa di vendita (PCV/commercializzazione) in €/mese, se stampata.",
  attivazioneFornitura: "Data di attivazione o inizio fornitura AAAA-MM-GG.",
  decorrenzaCondizioni: "Decorrenza delle condizioni economiche AAAA-MM-GG.",
  scadenzaCondizioni: "Scadenza delle condizioni economiche (anche 'tecnico economiche') AAAA-MM-GG.",
  scadenzaContratto: "Scadenza del contratto AAAA-MM-GG oppure 'tempo indeterminato'.",
  prezzoEnergiaF1: "Prezzo dell'energia F1 in €/kWh nel dettaglio vendita (indice più maggiorazione), senza perdite, dispacciamento, capacità, rete, oneri, imposte.",
  prezzoEnergiaF2: "Come F1, per F2.",
  prezzoEnergiaF3: "Come F1, per F3.",
  prezzoEnergiaF23: "Come F1, per F23.",
  prezzoEnergiaMonorario: "Prezzo monorario dell'energia in €/kWh, se unico.",
  coefficientePerdite: "Coefficiente o percentuale perdite di rete, se stampato.",
  totaleBolletta: "Totale bolletta (o Totale da pagare se manca il primo) in euro, solo il numero con il segno.",
};

const scontrinoRow = {
  type: "object", additionalProperties: false,
  required: ["etichetta", "tipo", "quota", "quantita", "unita", "prezzoMedio", "unitaPrezzo", "importo", "pagina"],
  properties: {
    etichetta: text("Etichetta stampata della riga."),
    tipo: { type: "string", enum: [...SCONTRINO_TYPES] },
    quota: { type: "string", enum: [...SCONTRINO_QUOTAS], description: "La quota a cui appartiene la riga (per i 'di cui' quella sopra)." },
    quantita: text("Quantità stampata (es. '213'), '' se assente."),
    unita: text("Unità della quantità (kWh, mesi, kW, kVArh)."),
    prezzoMedio: text("Prezzo medio stampato (es. '0,253013'), '' se assente."),
    unitaPrezzo: text("Unità del prezzo (es. '€/kWh', '€/mese', '€/kW/mese')."),
    importo: text("Importo in euro come stampato con il segno (es. '668,46', '-12,30')."),
    pagina: page,
  },
} as const;

const detailRow = {
  type: "object", additionalProperties: false,
  required: ["descrizione", "voce", "fascia", "periodo", "quantita", "unita", "prezzo", "unitaPrezzo", "importo", "pagina"],
  properties: {
    descrizione: text("Descrizione stampata della riga."),
    voce: { type: "string", enum: [...DETAIL_ITEMS], description: "Cosa è la voce secondo la regolazione ARERA, non dove è stampata." },
    fascia: { type: "string", enum: [...BANDS] },
    periodo: text("Periodo della riga come stampato, '' se assente."),
    quantita: text("Quantità stampata."),
    unita: text("Unità della quantità."),
    prezzo: text("Prezzo unitario stampato."),
    unitaPrezzo: text("Unità del prezzo."),
    importo: text("Importo in euro con il segno."),
    pagina: page,
  },
} as const;

export const BILL_READER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["tipoDocumento", "vettore", "tipoCliente", "livelloTensione", ...BILL_READER_SCALARS, "storicoConsumi", "valoriFormula", "scontrino", "dettaglio", "fonti", "assenti"],
  properties: {
    tipoDocumento: { type: "string", enum: ["BOLLETTA_SINTETICA", "BOLLETTA_COMPLETA", "FATTURA_DETTAGLIO", "NON_BOLLETTA"] },
    vettore: { type: "string", enum: ["EE", "GAS", "NON_DETERMINABILE"] },
    tipoCliente: { type: "string", enum: ["DOMESTICO", "ALTRI_USI", "NON_DETERMINABILE"], description: "DOMESTICO anche per domestico non residente." },
    livelloTensione: { type: "string", enum: ["BT", "MT", "AT", "NON_DETERMINABILE"], description: "Dalla tensione stampata: fino a 1.000 V BT, fino a 35.000 V MT. Se non stampata: BT solo per domestici o potenza fino a 30 kW." },
    ...Object.fromEntries(BILL_READER_SCALARS.map((name) => [name, text(`${SCALAR_HELP[name]} Stringa vuota se non stampato.`)])),
    storicoConsumi: { type: "array", description: "Storico consumi stampato, un mese per elemento.", items: { type: "object", additionalProperties: false, required: ["mese", "consumo"], properties: { mese: text("AAAA-MM"), consumo: text("Consumo del mese come stampato.") } } },
    valoriFormula: { type: "array", description: "Valori della formula del Box dell'offerta o della tabella di composizione del prezzo (es. 'PUN', 'Spread', 'Dispacciamento'): sono prezzi unitari, non importi.", items: { type: "object", additionalProperties: false, required: ["etichetta", "valore", "unita", "pagina"], properties: { etichetta: text("Etichetta stampata."), valore: text("Valore stampato con il segno."), unita: text("Unità (€/kWh)."), pagina: page } } },
    scontrino: { type: "array", description: "Lo scontrino dell'energia (quadro sintetico), riga per riga, nell'ordine stampato, fino al Totale bolletta compreso.", items: scontrinoRow },
    dettaglio: { type: "array", description: "Gli elementi di dettaglio (quantità × prezzo = importo), una riga per voce stampata.", items: detailRow },
    fonti: { type: "array", description: "Per ogni campo valorizzato: nome del campo, pagina e testo stampato da cui è copiato.", items: { type: "object", additionalProperties: false, required: ["campo", "pagina", "testo"], properties: { campo: text("Nome del campo."), pagina: page, testo: text("Testo stampato citato.") } } },
    assenti: { type: "array", description: "Per ogni campo lasciato vuoto: nome del campo e motivo (es. 'non stampato: fattura di dettaglio senza box').", items: { type: "object", additionalProperties: false, required: ["campo", "motivo"], properties: { campo: text("Nome del campo."), motivo: text("Perché è vuoto.") } } },
  },
} as const;
