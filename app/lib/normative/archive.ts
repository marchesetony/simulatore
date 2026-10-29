// Archivio normativo (Tony, 29/10): the ARERA rules that apply to reading bills and CTEs, simulating offers and
// presenting the simulation as a bill, split between household and business customers. The texts come from the
// documents Tony uploaded (delibera 386/2025/R/com, Codice di condotta commerciale valid from 1/4/2026 as amended by
// 189/2026/R/com and 255/2026/R/com, Allegato A 302/2016/R/com updated) and feed the AI prompts that read bills and CTEs.
// The full archive with article references is in /mnt/project-files/normative/.

export type NormativeAudience = "DOMESTIC" | "BUSINESS";
export type NormativeUse = "BILL" | "CTE" | "SIMULATION" | "PRESENTATION";

export interface NormativeSource {
  readonly id: string;
  readonly title: string;
  readonly validFrom: string;
}

export interface NormativeRule {
  readonly id: string;
  readonly audiences: readonly NormativeAudience[];
  readonly uses: readonly NormativeUse[];
  readonly source: string;
  readonly reference: string;
  readonly validFrom: string;
  readonly text: string;
}

export const NORMATIVE_SOURCES: readonly NormativeSource[] = [
  { id: "386/2025", title: "Delibera ARERA 386/2025/R/com: struttura dei corrispettivi delle offerte del mercato libero", validFrom: "2026-04-01" },
  { id: "CCC", title: "Codice di condotta commerciale (Allegato A 366/2018/R/com) valido dal 1/4/2026", validFrom: "2026-04-01" },
  { id: "189/2026", title: "Delibera ARERA 189/2026/R/com: adeguamento al D.Lgs. 7 gennaio 2026, n. 3", validFrom: "2026-07-31" },
  { id: "255/2026", title: "Delibera ARERA 255/2026/R/com: conferma con integrazioni della 189/2026", validFrom: "2026-11-01" },
  { id: "302/2016", title: "Allegato A 302/2016/R/com aggiornato: recesso dai contratti di fornitura", validFrom: "2026-07-17" },
];

const BOTH: readonly NormativeAudience[] = ["DOMESTIC", "BUSINESS"];

export const NORMATIVE_RULES: readonly NormativeRule[] = [
  // Who the rules apply to.
  { id: "SCOPE", audiences: BOTH, uses: ["BILL", "CTE", "SIMULATION"], source: "CCC", reference: "art. 2", validFrom: "2026-04-01",
    text: "Il Codice si applica ai clienti domestici e non domestici connessi in bassa tensione e ai clienti gas con consumi fino a 200.000 Smc/anno." },
  // Households: structure of the price (386/2025 art. 1).
  { id: "DOMESTIC_EE_STRUCTURE", audiences: ["DOMESTIC"], uses: ["BILL", "CTE", "SIMULATION"], source: "386/2025", reference: "art. 1.2", validFrom: "2026-04-01",
    text: "Offerte luce domestiche: il venditore applica solo un unico corrispettivo in quota annua in €/POD/anno (comprende il corrispettivo dell'art. 25 TIS) e un unico corrispettivo per consumo in €/kWh, più il CDISPD per dispacciamento e mercato della capacità e le tariffe di rete e oneri della Tabella 1 della 315/2024." },
  { id: "DOMESTIC_EE_SPREAD", audiences: ["DOMESTIC"], uses: ["BILL", "CTE", "SIMULATION"], source: "386/2025", reference: "art. 1.3", validFrom: "2026-04-01",
    text: "Nelle offerte domestiche a prezzo variabile il corrispettivo per consumo è indice più un unico corrispettivo aggiuntivo (spread) che copre tutti i costi di approvvigionamento e commercializzazione non coperti dall'indice: sbilanciamento e commercializzazione sono dentro lo spread e non vanno conteggiati a parte." },
  { id: "DOMESTIC_EE_CDISPD", audiences: ["DOMESTIC"], uses: ["BILL", "CTE", "SIMULATION"], source: "386/2025", reference: "art. 1.2.b; 555/2017 art. 18.1.c", validFrom: "2026-04-01",
    text: "Il dispacciamento domestico è il CDISPD (art. 48 TIV) fissato e aggiornato da ARERA, uguale per residenti e non residenti, comprensivo del mercato della capacità e senza perdite; solo per offerte con aggiornamento almeno orario il venditore può sostituirlo con capacità Terna più dispacciamento TIDE Sezione 4-25." },
  { id: "LOSSES", audiences: BOTH, uses: ["CTE", "SIMULATION"], source: "CCC", reference: "art. 5.1.a", validFrom: "2026-04-01",
    text: "I corrispettivi dell'energia elettrica sono espressi al netto delle imposte e al lordo delle perdite di rete: le perdite si applicano all'indice, lo spread dichiarato non si maggiora di nuovo." },
  { id: "DOMESTIC_GAS_STRUCTURE", audiences: ["DOMESTIC"], uses: ["BILL", "CTE", "SIMULATION"], source: "386/2025", reference: "art. 1.4-1.5", validFrom: "2026-04-01",
    text: "Offerte gas domestiche: un unico corrispettivo in quota annua in €/PdR/anno e un unico corrispettivo per consumo in €/Smc (indice più un unico corrispettivo aggiuntivo se variabile), più rete e oneri della Tabella 2 della 315/2024." },
  { id: "DOMESTIC_ALL_IN", audiences: ["DOMESTIC"], uses: ["CTE", "SIMULATION"], source: "386/2025", reference: "art. 1.6-1.7", validFrom: "2026-04-01",
    text: "Le offerte domestiche con corrispettivi onnicomprensivi hanno solo una quota annua e un corrispettivo per consumo che includono vendita, rete e oneri, senza ricalcoli se cambiano le tariffe: rete e oneri non si sommano a parte." },
  { id: "DOMESTIC_TRANSITION", audiences: ["DOMESTIC"], uses: ["BILL", "SIMULATION"], source: "386/2025", reference: "art. 6.1-6.4", validFrom: "2026-04-01",
    text: "Le regole valgono dal 1/4/2026 per tutte le offerte; i contratti già in essere si adeguano al primo rinnovo o variazione e comunque entro il 1/1/2027: una bolletta domestica del 2026 può ancora mostrare la struttura precedente." },
  // Business.
  { id: "BUSINESS_EE_STRUCTURE", audiences: ["BUSINESS"], uses: ["BILL", "CTE", "SIMULATION"], source: "CCC", reference: "art. 10.4.a", validFrom: "2026-04-01",
    text: "Offerte non domestiche: i corrispettivi di vendita sono liberi (anche quote fisse, quote potenza, sbilanciamento e commercializzazione separati) e il dispacciamento va esposto a parte; ogni voce va letta e simulata singolarmente con il valore unitario effettivo." },
  { id: "BUSINESS_EE_DISPATCHING", audiences: ["BUSINESS"], uses: ["CTE", "SIMULATION"], source: "386/2025", reference: "555/2017 art. 18.1.c.ii", validFrom: "2026-04-01",
    text: "Per i clienti non domestici il dispacciamento è il corrispettivo TIDE Sezione 4-25 applicato da Terna più il corrispettivo di capacità (comma 34.8 TIV), tenendo conto delle perdite di rete." },
  { id: "BUSINESS_INDICATORS", audiences: ["BUSINESS"], uses: ["CTE", "PRESENTATION"], source: "CCC", reference: "artt. 15-16, 20.1.b-c", validFrom: "2026-04-01",
    text: "La scheda sintetica non domestica riporta gli indicatori Costo fisso anno (€/anno), Costo per consumi (€/kWh o €/Smc, media ponderata per fasce o indice più altri corrispettivi) e Costo per potenza impegnata (€/kW), con 0,00 se assenti." },
  // CTE presentation (scheda sintetica).
  { id: "DOMESTIC_SCHEDA", audiences: ["DOMESTIC"], uses: ["CTE", "PRESENTATION"], source: "CCC", reference: "artt. 10.3, 19, 20.1", validFrom: "2026-04-01",
    text: "La scheda sintetica domestica riporta la tabella Corrispettivi definiti dal venditore (corrispettivo annuo e corrispettivo per il consumo, es. Indice + 0,00 €/kWh) e a parte la dicitura sul CDISPD; il riquadro Spesa annua stimata in €/anno (escluse imposte e tasse) usa i consumi tipo 1.500, 2.200, 2.700, 3.200 kWh (3 kW residente), 900 e 4.000 kWh (3 kW non residente), 3.500 kWh (4,5 kW) e 6.000 kWh (6 kW)." },
  { id: "ANNUAL_COST", audiences: BOTH, uses: ["SIMULATION", "PRESENTATION"], source: "CCC", reference: "art. 6, art. 19.2-19.5", validFrom: "2026-04-01",
    text: "La spesa annua stimata applica su base annua tutti i corrispettivi dovuti, compresi sconti automatici, con i valori vigenti alla data dell'offerta; con prezzi per fasce si usa il profilo F1 33%, F2 31%, F3 36%; per il gas P = 0,03852 GJ/Smc e C = 1; la spesa annua si riporta escluse le imposte." },
  { id: "BILL_SECTIONS", audiences: BOTH, uses: ["BILL", "PRESENTATION"], source: "386/2025", reference: "art. 4.1.b; 315/2024 Tabelle 1-2", validFrom: "2026-04-01",
    text: "Le voci di spesa della bolletta sono spesa per la vendita di energia elettrica (o gas naturale), spesa per la tariffa per l'uso della rete, spesa per gli oneri generali di sistema, imposte; corrispondono a materia energia, trasporto e gestione del contatore e oneri di sistema della Bolletta 2.0." },
  { id: "DISCOUNTS", audiences: BOTH, uses: ["CTE", "SIMULATION"], source: "CCC", reference: "art. 10.3.b, 10.4.b", validFrom: "2026-04-01",
    text: "Sconti e bonus vanno quantificati in euro, distinguendo quelli condizionati a un evento e quelli una tantum che non si ripetono." },
  { id: "FIXED_PRICE_NOTICE", audiences: BOTH, uses: ["CTE", "PRESENTATION"], source: "189/2026", reference: "punti 1.c, 1.g, 2", validFrom: "2026-07-31",
    text: "Le offerte luce a prezzo fisso riportano il messaggio che la scelta del prezzo fisso dipende anche dalla propensione al rischio e che il corrispettivo potrebbe risultare più basso o più elevato di quelli indicizzati." },
  { id: "FIXED_PRICE_NO_CHANGE", audiences: BOTH, uses: ["CTE", "SIMULATION"], source: "189/2026", reference: "CCC art. 13.1bis; 302/2016 art. 7.1bis", validFrom: "2026-07-31",
    text: "Nei contratti luce a prezzo fisso il venditore non può modificare in peggio prezzo e durata né recedere finché vale il prezzo fisso." },
  { id: "RENEWAL_SCHEDA", audiences: BOTH, uses: ["CTE", "PRESENTATION"], source: "255/2026", reference: "punto 2", validFrom: "2026-11-01",
    text: "Dal 1/11/2026 la scheda sintetica si consegna anche prima della proroga del contratto luce o delle sue condizioni economiche, e gli sconti fanno parte delle condizioni rinnovate." },
  // Exit fees.
  { id: "EXIT_FEE", audiences: BOTH, uses: ["CTE", "SIMULATION"], source: "302/2016", reference: "art. 6.5-6.6", validFrom: "2026-07-17",
    text: "Il recesso del cliente non ha penali, salvo oneri di recesso anticipato solo per imprese BT oltre 50 dipendenti o 10 milioni di fatturato e, per gli altri clienti BT, solo nei contratti luce a prezzo fisso fino alla prima scadenza delle condizioni; non valgono nelle offerte miste fisso più variabile." },
];

const AUDIENCE_LABEL: Record<NormativeAudience, string> = { DOMESTIC: "clienti domestici", BUSINESS: "clienti non domestici (business)" };

export function normativeRules(use: NormativeUse, audience?: NormativeAudience): readonly NormativeRule[] {
  return NORMATIVE_RULES.filter((rule) => rule.uses.includes(use) && (audience === undefined || rule.audiences.includes(audience)));
}

/** The rules for one use, grouped by audience, as text for an AI prompt. */
export function normativeGuidance(use: NormativeUse): string {
  const lines = NORMATIVE_RULES.filter((rule) => rule.uses.includes(use)).map((rule) => {
    const who = rule.audiences.length === 2 ? "tutti i clienti" : AUDIENCE_LABEL[rule.audiences[0]];
    return `[${rule.source} ${rule.reference}, ${who}] ${rule.text}`;
  });
  return ["Regole ARERA in vigore da applicare (distingui sempre domestico e business):", ...lines].join(" ");
}
