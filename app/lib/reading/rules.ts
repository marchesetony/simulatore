// Tony (1/11): "leggi e fissa le regole per la lettura delle bollette e delle cte". Every reading rule Tony gave, in one
// place, sent to the AI reader and verifier of bills and CTEs with every document (normative/archive.ts normativeGuidance)
// and printed for Tony in /mnt/project-files/regole/regole-lettura.md. A rule added here reaches both readers at once.

export type ReadingUse = "BILL" | "CTE";

export interface ReadingRule {
  readonly id: string;
  readonly uses: readonly ReadingUse[];
  /** When and on which document Tony gave it. */
  readonly origin: string;
  readonly text: string;
}

export const READING_RULES: readonly ReadingRule[] = [
  // General.
  { id: "READ_EVERYTHING", uses: ["BILL", "CTE"], origin: "Tony 31/10, \"devi saper leggere tutte le cte, in qualsiasi modo ti vengano presentate\"",
    text: "Leggi il documento qualunque sia il formato o l'impaginazione. Non dire mai che un dato non c'è senza averlo cercato in tutte le pagine, tabelle e note." },
  { id: "PRINTED_ONLY", uses: ["BILL", "CTE"], origin: "Tony 31/10, lettore e verificatore",
    text: "Restituisci solo valori stampati nel documento, con la citazione testuale. Un dato non stampato resta vuoto, mai stimato." },
  { id: "ONE_FIELD", uses: ["BILL", "CTE"], origin: "Tony 31/10, \"ancora errore, cazzo\"",
    text: "Un campo che non riesci a leggere resta vuoto: non deve far fallire il resto della lettura." },
  { id: "NO_ACTUAL_VALUE", uses: ["BILL", "CTE"], origin: "Tony 27/10",
    text: "I valori \"attualmente pari a\" di dispacciamento, capacità, PUN o PSV sono esempi del mese: non sono il prezzo del contratto." },

  // Bills.
  { id: "BILL_QUOTA_TOTALS", uses: ["BILL"], origin: "Tony 29/10 e 30/10, Bolletta 2.0",
    text: "Nel quadro sintetico ogni quota (per consumi, fissa, potenza) è un totale seguito da \"di cui spesa per la vendita\" e \"di cui spesa per la rete e gli oneri\": il totale non è una voce in più. \"QUOTA PER I CONSUMI\" o \"Quota potenza 6\" sono totali di quota." },
  { id: "BILL_SUMMARY_NETWORK", uses: ["BILL"], origin: "Tony 30/10 Elios, 31/10 MACRI",
    text: "Se la sintetica dà solo rete e oneri insieme, la rete è rete e oneri meno gli oneri della pagina oneri. La rete addebitata è il valore ARERA: la differenza è vendita della stessa quota." },
  { id: "BILL_OFFER_BOX", uses: ["BILL"], origin: "Tony 31/10, \"ma che cazzo dici, guarda la bolletta\"",
    text: "Leggi sempre il Box dell'offerta: nome e codice offerta, Tipologia Offerta, Tipologia Prezzo, indice, decorrenza e scadenza delle condizioni (anche \"tecnico economiche\"), scadenza del contratto. VARIABILE con indice PUN è Indicizzato PUN. I valori della formula nel box (es. \"Dispacciamento: 0,010501 €/kWh\") e \"Totale spesa dovuta per l'offerta\" sono prezzi o riassunti, non importi addebitati. La fattura di dettaglio non ha il box." },
  { id: "BILL_DETAIL_PRICE_TYPE", uses: ["BILL"], origin: "Tony 31/10, fattura di dettaglio BPower",
    text: "Nella fattura di dettaglio senza box, se ogni fascia costa PUN della fascia più lo stesso importo, l'offerta è indicizzata PUN con quello spread." },
  { id: "BILL_SELLER_NAMES", uses: ["BILL"], origin: "Tony 30/10 Plenitude, \"costi che il venditore camuffa\"",
    text: "Sono vendita: Corrispettivo Luce Index (energia), Contributo al consumo (spread), Perdite su… (perdite), articoli TIDE/TIS (dispacciamento), ARG/elt 98/11 (capacità), Quota variabile smart (CVS) e Quota variabile voci di trasporto (corrispettivi del venditore al kWh). Solo \"Spesa per la tariffa per l'uso della rete\" è trasporto ARERA." },
  { id: "BILL_SMALL_AMOUNTS", uses: ["BILL"], origin: "Tony 30/10",
    text: "Un importo piccolo (anche sotto 1 €) è denaro addebitato quando quantità × prezzo lo ritrova." },
  { id: "BILL_DAILY_FIXED", uses: ["BILL"], origin: "Tony 28/10, Casa Protetta",
    text: "Una voce in €/giorno è quota fissa." },
  { id: "BILL_COMMERCIALIZATION", uses: ["BILL"], origin: "Tony 29/10",
    text: "\"Commercializzazione\" in €/kWh non è la PCV: la PCV è in €/mese o €/POD." },
  { id: "BILL_CONSUMPTION", uses: ["BILL"], origin: "Tony 30/10, \"NON è POSSIBILE, CHE UNA VOLTA FUNZIONA E UN'ALTRA NO\"",
    text: "Il consumo del periodo è F1 + F2 + F3 quando le tre fasce sono lette. Leggi anche lo storico consumi degli ultimi 12 mesi e il consumo annuo, se stampato." },
  { id: "BILL_PERIOD", uses: ["BILL"], origin: "Tony 31/10",
    text: "Il periodo fatturato va dal primo all'ultimo giorno di fornitura (es. 01/09/2026 - 30/09/2026)." },
  { id: "BILL_CUSTOMER", uses: ["BILL"], origin: "Tony 29/10",
    text: "Domestico non residente è un cliente domestico: la residenza non è il tipo di cliente. Senza dati tecnici si deduce solo ciò che la bolletta dimostra: bonus sociale = domestico residente; potenza fatturata = potenza impegnata; domestico o fino a 30 kW = bassa tensione." },
  { id: "BILL_POWER", uses: ["BILL"], origin: "Tony 30/10, Duferco",
    text: "Leggi potenza impegnata e disponibile. Se le voci in €/kW sono fatturate su meno kW dell'impegnata, quei kW sono la potenza massima prelevata. Leggi la classe ASOS se c'è; se manca è la classe 0." },
  { id: "BILL_EXCLUDED", uses: ["BILL"], origin: "Tony 31/10",
    text: "Bonus sociale e canone RAI si leggono, ma non sono spesa della fornitura." },
  { id: "BILL_TOTAL", uses: ["BILL"], origin: "Tony 28/10 e 31/10",
    text: "Il totale della bolletta non si cambia mai. Se le voci lette non lo raggiungono, rileggi il documento sapendo la differenza." },

  // CTEs.
  { id: "CTE_VERSION", uses: ["CTE"], origin: "Tony 31/10, scelta \"Versioni diverse\"",
    text: "Leggi il codice offerta completo: un codice diverso anche solo nel numero di versione (ESVFL01, ESVFL02) è un'altra CTE." },
  { id: "CTE_PRICE_TYPE", uses: ["CTE"], origin: "Tony 31/10, direttore",
    text: "\"VARIABLE\", \"prezzo variabile\" o indice + spread = offerta indicizzata. Leggi l'indice (PUN o PSV) e lo spread in €/kWh o €/Smc." },
  { id: "BILL_REGULATORY_GROUPING", uses: ["BILL"], origin: "Tony 1/11, CTS in altre partite",
    text: "I venditori scrivono e raggruppano le voci nei modi più disparati: assegna ogni voce al gruppo previsto dalla regolazione ARERA (vendita, rete, oneri di sistema, imposte, altre partite), diverso tra clienti domestici e business, in base a cosa è e non a dove o come la bolletta la stampa. Un corrispettivo del venditore stampato tra le \"altre partite\" (es. \"Addebito CTS - Corrispettivo Tariffario Specifico\") è spesa per la vendita." },
  { id: "BILL_SUMMARY_FIRST", uses: ["BILL"], origin: "Tony 1/11, scontrino della bolletta",
    text: "Il quadro sintetico è lo scontrino della bolletta e riassume tutti i costi addebitati, comprese more e CMOR: leggi sempre per primi, esattamente come stampati, ogni \"Quota ...\" con i suoi \"di cui spesa per la vendita\" e \"di cui spesa per la rete e gli oneri generali di sistema\", \"Accise e IVA\" (o Totale imposte), le altre partite e il Totale bolletta. Il dettaglio serve solo a ripartire, mai a sostituire questi importi. Non inventare nulla." },
  { id: "BILL_SCONTRINO_THEN_DETAIL", uses: ["BILL"], origin: "Tony 1/11, \"quante volte dobbiamo fissare le regole\"",
    text: "Ordine di lettura della bolletta: 1) lo scontrino dell'energia (ogni Quota con i suoi \"di cui\", accise e IVA, bonus, altre partite, totale); 2) le condizioni applicate riportate (box dell'offerta: nome e codice offerta, prezzo o indice e spread, scadenze); 3) se esiste, il dettaglio voce per voce. Lo scontrino viene anche letto direttamente dal testo del PDF e aggiunto se la lettura non lo contiene." },
  { id: "BILL_PRINTED_SCONTRINO_WINS", uses: ["BILL"], origin: "Tony 1/11, bolletta Loomen: \"bisogna trovare soluzione definitiva, affinchè sappia leggere qualsiasi bolletta di qualsiasi azienda\"",
    text: "Quando il PDF ha il testo, lo scontrino stampato (Quote con i loro \"di cui\", altre partite, accise e IVA, totale bolletta) si legge dal testo e sostituisce la lettura AI dello stesso blocco, anche per le bollette già archiviate: l'etichetta e l'importo possono stare su righe diverse. Le altre partite (interessi, deposito cauzionale, bollo) compaiono nello scontrino della bolletta ma restano fuori dal confronto con l'offerta." },
  { id: "BILL_IMAGE_SCONTRINO_TRANSCRIPT", uses: ["BILL"], origin: "Tony 1/11, \"bisogna che anche quella letta da immagine possa essere letta allo stesso modo del pdf\"",
    text: "Bolletta senza testo (foto o scansione): lo scontrino viene copiato riga per riga esattamente come stampato, senza calcoli né correzioni, e la copia passa per la stessa lettura del testo del PDF. La copia resta salvata con la bolletta." },
  { id: "BILL_PERIOD_MULTI_MONTH", uses: ["BILL"], origin: "Tony 2/11, \"manca il periodo di riferimento, ricorda che delle bollette possono essere riferite a due mesi di fornitura\"",
    text: "Il periodo fatturato può essere di un mese o di più mesi (bimestrale) e va sempre letto: copialo come stampato (\"01/07/2026 - 31/08/2026\", \"dal 1 luglio al 31 agosto 2026\", \"luglio - agosto 2026\"). Se la lettura lo lascia vuoto, si legge dal testo del PDF; l'operatore lo conferma nel modulo." },
  { id: "BILL_PRINTED_VOLTAGE", uses: ["BILL"], origin: "Tony 2/11, bolletta in media tensione (20.000 V) calcolata come bassa tensione",
    text: "La tensione di fornitura si legge sempre dalla riga stampata (\"Tensione nominale di alimentazione 20.000 V\", \"220 V - Bassa Tensione\"): fino a 1.000 V è bassa tensione (BT), fino a 35.000 V media tensione (MT), oltre è alta tensione. Non dedurla mai dalla potenza o dal tipo di cliente quando è stampata." },
  { id: "BILL_ONERI_WITHOUT_QUOTA", uses: ["BILL"], origin: "Tony 2/11, oneri ASOS e ARIM della pagina oneri senza quota",
    text: "Gli oneri di sistema elencati senza quota (ASOS, ARIM con solo l'importo) sono già compresi nelle righe \"rete e oneri\" delle quote dello scontrino: non sono una spesa in più e non vanno tolti da una sola quota." },
  { id: "BILL_ARERA_STRUCTURE", uses: ["BILL"], origin: "Tony 1/11, guida ARERA alla bolletta dell'elettricità",
    text: "Struttura ARERA: frontespizio (pagamento, scadenza, periodo, consumo fatturato, consumo annuo, mercato libero o tutele graduali, offerta e scadenza); seconda facciata con scontrino dell'energia, box dell'offerta (codice offerta, prezzo fisso/variabile/altro, monorario o a fasce, penali, decorrenza, scadenza condizioni e contratto o tempo indeterminato, formula e parametri come il PUN; due box se le condizioni sono cambiate nel periodo) e dati della fornitura (POD di 14-15 caratteri che inizia con IT); elementi informativi essenziali (letture e consumi effettivi o stimati, caratteristiche tecniche: tipologia cliente e tensione, riquadro imposte). Voci dello scontrino: Quota consumi (quantità x prezzo medio, con spesa per la vendita e spesa per la rete e per gli oneri generali di sistema), Quota fissa (mesi x prezzo medio più mesi x kW x prezzo medio, con le stesse due quote), Ricalcoli (solo totale), Altre partite (deposito cauzionale, interessi di mora, indennizzi: causale e totale), Bonus sociale (periodo e credito), Importi collegati all'offerta (spesa per la vendita), Restituzione crediti, Importi relativi a bollette precedenti, Totale imposte e iva, Totale bolletta; poi Servizi e prodotti aggiuntivi, Canone TV (mesi e totale), Credito rimanente, Importi che saranno addebitati nella prossima bolletta, Totale da pagare. Leggi ogni voce con la sua etichetta e il suo importo esatti." },
  { id: "CTE_LOSSES", uses: ["CTE"], origin: "Tony 28/10 e 29/10",
    text: "Segna se spread e corrispettivi sono \"al lordo\" o \"al netto\" delle perdite di rete, voce per voce." },
  { id: "CTE_FEES", uses: ["CTE"], origin: "Tony 31/10, Be Smile",
    text: "Leggi ogni corrispettivo con la sua unità: quota fissa (€/mese o €/anno), commercializzazione, sbilanciamento, dispacciamento, Capacity Market libero, una tantum. Se una voce è letta 0,00 ma il testo dice \"pari a 0,003 €/kWh\", vale il testo." },
  { id: "CTE_ONE_OFF", uses: ["CTE"], origin: "Tony 1/11, Be Family Casa Protetta e Fast",
    text: "L'una tantum della prima bolletta (es. \"gestione APP e servizi … prima bolletta di €1,50\") e la penale di recesso anticipato (es. 69 € per la polizza) sono due voci diverse: leggile entrambe, anche se stanno in sezioni diverse." },
  { id: "CTE_SCHEDA", uses: ["CTE"], origin: "Tony 31/10, Scheda Sintetica",
    text: "Gli indicatori della Scheda Sintetica (Costo fisso anno, Costo per consumi, Costo per potenza, spesa annua stimata) riassumono i corrispettivi: non sono voci in più. Voltura, subentro, depositi cauzionali, costo pratica, interessi di mora e penali di recesso non sono spesa di fornitura." },
  { id: "CTE_CDISPD", uses: ["CTE"], origin: "Tony 31/10",
    text: "Una CTE domestica che cita il CDISPD (art. 48 TIV) copre dispacciamento e mercato della capacità con il valore ARERA." },
  { id: "CTE_SILENT", uses: ["CTE"], origin: "Tony 28/10",
    text: "Se la CTE non dice nulla su dispacciamento e capacità si applicano i valori ufficiali; se non dice nulla sullo sbilanciamento non si addebita." },
  { id: "CTE_TAX", uses: ["CTE"], origin: "Tony 31/10, \"si desume dal tipo di cliente\"",
    text: "Il trattamento fiscale non serve dalla CTE: i prezzi si prendono senza imposte e IVA e accise dipendono dal tipo di cliente." },
  { id: "CTE_CUSTOMERS", uses: ["CTE"], origin: "Tony 28/10 e 29/10",
    text: "Leggi a chi è rivolta (domestici, non domestici, entrambi), la tensione (solo luce), gli usi e le soglie di consumo annuo. Una CTE per \"clienti domestici e non domestici\" vale per Consumer e Business. Un campo che non appartiene al vettore (tensione su una CTE gas) si scarta." },
  { id: "CTE_VALIDITY", uses: ["CTE"], origin: "Tony 28/10",
    text: "Leggi la validità dell'offerta (adesioni dal / entro il) e la durata delle condizioni economiche." },
];

/** The reading rules for one use, as text for an AI prompt. */
export function readingRulesGuidance(use: ReadingUse): string {
  const rules = READING_RULES.filter((rule) => rule.uses.includes(use));
  return [`Regole di lettura ${use === "BILL" ? "delle bollette" : "delle CTE"} decise dal titolare, da rispettare sempre:`, ...rules.map((rule, index) => `${index + 1}. ${rule.text}`)].join(" ");
}
