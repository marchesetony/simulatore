/**
 * Motore V3 — caso di riferimento 070789E, ottobre 2026 (BT, BTA6, altri usi, CTE Be Smile FLEX 25 v1).
 * Only measured quantities and official/contractual parameters with their source. No personal data, no printed amounts:
 * the printed amounts are in PRINTED_070789E below and are used by the reconciliation only.
 */
import { TIT_TABLE5_REACTIVE } from "../../../app/lib/engine-v3/adapters/tit-reactive-table.ts";

const src = (kind, reference, evidence) => (evidence ? { kind, reference, evidence } : { kind, reference });
const p = (value, unit, source) => ({ value, unit, source });

const TIT = src("ARERA", "Delibera 575/2025/R/eel, TIT 2026, BTA6");
const UC = src("ARERA", "Delibera 588/2025/R/eel, Tab. 7 (UC3, UC6)");
const ARIM = src("ARERA", "Delibera 588/2025/R/eel, Tab. B (ARIM, altri usi BT)");
const ASOS = src("ARERA", "Delibera 227/2026/R/eel, ASOS classe 0, altri usi BT");
const CTE = (evidence) => src("CTE", "CTE Be Smile FLEX 25, 003888ESVFL03XXXXXXXXXSMILFLEX26 v1", evidence);

export function referenceInput() {
  return {
    supply: { vector: "EE", customer: "NON_DOMESTIC", voltage: "BT", tariffClass: "BTA6", powerKw: { value: "4", source: src("MEASURE", "Potenza fatturata nella quota potenza, 4,0 kW") }, availablePowerKw: { value: "27", source: src("MEASURE", "Potenza disponibile stampata in bolletta, 27 kW (pagina 2)") } },
    period: { start: "2026-10-01", endExclusive: "2026-11-01" },
    consumption: { bands: { F1: "56", F2: "86", F3: "193" }, source: src("MEASURE", "Letture ottobre 2026 per fascia") },
    reactive: { measures: [{ kind: "INJECTED", band: "F3", kvarh: "504" }], source: src("MEASURE", "Quantità fatturata \"Energia reattiva immessa\" ottobre 2026, 504 kVArh", "fascia F3 dedotta: dal 1/4/2023 l'immessa è soggetta solo in F3 (TIT Tabella 5, delibera 232/2022/R/eel); la bolletta non stampa la fascia") },
    contract: {
      cteCode: "003888ESVFL03XXXXXXXXXSMILFLEX26", cteVersion: "1",
      energy: { index: "PUN", spread: p("0.02", "EUR/kWh", CTE("spread 0,02 €/kWh")), lossesOn: "INDEX_AND_SPREAD", lossesSource: src("RULE", "Regola perdite Tony 15/11: CTE netta o silente → +λ su PUN e spread") },
      commercialization: { rate: p("0.003", "EUR/kWh", CTE("commercializzazione 0,003 €/kWh")), losses: "NET_OF_LOSSES" },
      imbalance: { rate: p("0.008", "EUR/kWh", CTE("sbilanciamento 0,008 €/kWh")), losses: "NET_OF_LOSSES" },
      dispatching: { losses: "NET_OF_LOSSES", source: CTE("dispacciamento TIS art. 24 × fattore Tab. 4") },
      capacityRegulated: { losses: "NET_OF_LOSSES", source: CTE("capacità TIV art. 34.8 bis") },
      capacityContractual: { rate: p("0.0075", "EUR/kWh", CTE("capacity market 0,0075 €/kWh")), losses: "GROSS_OF_LOSSES" },
      fixedFees: [
        { id: "QUOTA_FISSA", label: "Quote fisse", rate: p("15", "EUR/month", CTE("15 €/mese")) },
        { id: "OPZIONE_FLEX", label: "Opzione Flex", rate: p("36", "EUR/year", CTE("36 €/anno")) },
      ],
      oneOffFees: [{ id: "ATTIVAZIONE", label: "Corrispettivo una tantum", rate: p("1.50", "EUR/contract", CTE("1,50 € una tantum, prima bolletta")) }],
    },
    market: { pun: {
      F1: p("233.39", "EUR/MWh", src("GME", "PUN medio per fasce, ottobre 2026", "F1 233,39 €/MWh")),
      F2: p("252.14", "EUR/MWh", src("GME", "PUN medio per fasce, ottobre 2026", "F2 252,14 €/MWh")),
      F3: p("215.88", "EUR/MWh", src("GME", "PUN medio per fasce, ottobre 2026", "F3 215,88 €/MWh")),
    } },
    regulated: {
      lossFactor: p("0.10", "RATIO", src("ARERA", "TIS Tabella 4 colonna A, delibera 117/2022/R/eel, confermata per il 2026 dalla delibera 430/2025/R/eel")),
      dispatching: p("0.009888", "EUR/kWh", src("TERNA", "TIDE 2026 Q4")),
      capacity: p("0.003423", "EUR/kWh", src("ARERA", "Delibera 338/2026/R/eel art. 4.1, al netto delle perdite")),
      network: {
        fixed: p("5.3471", "EUR/POD/year", TIT), power: p("32.9297", "EUR/kW/year", TIT), energy: p("0.00066", "EUR/kWh", TIT),
        transmission: p("0.0119", "EUR/kWh", src("ARERA", "Trasmissione 2026 (ARERA_TRAS_2026)")),
        metering: p("21.8469", "EUR/POD/year", src("ARERA", "Delibera 575/2025/R/eel, TIME MIS1 + RES")),
        uc3Energy: p("0.00276", "EUR/kWh", UC), uc6Energy: p("0.00007", "EUR/kWh", UC), uc6Fixed: p("1.6824", "EUR/POD/year", UC),
      },
      system: {
        arimFixed: p("3.0276", "EUR/POD/year", ARIM), arimPower: p("3.4524", "EUR/kW/year", ARIM), arimEnergy: p("0.001614", "EUR/kWh", ARIM),
        asosFixed: p("12.9924", "EUR/POD/year", ASOS), asosPower: p("14.8164", "EUR/kW/year", ASOS), asosEnergy: p("0.031875", "EUR/kWh", ASOS),
      },
      reactiveTariff: TIT_TABLE5_REACTIVE,
    },
    billing: { firstBillOfSupply: false, source: src("MEASURE", "Inizio fornitura 2026-04-01: ottobre non è la prima bolletta") },
    taxes: {
      vatRate: p("0.22", "RATIO", src("LAW", "DPR 633/1972, aliquota ordinaria 22%")),
      exciseNonDomestic: {
        tier1Rate: p("0.0125", "EUR/kWh", src("LAW", "D.Lgs. 504/1995 Allegato I, altri usi, fino a 200.000 kWh/mese")), tier1MonthlyKwh: "200000",
        tier2Rate: p("0.0075", "EUR/kWh", src("LAW", "D.Lgs. 504/1995 Allegato I, altri usi, oltre 200.000 fino a 1.200.000 kWh/mese")), tier2MonthlyKwh: "1200000",
      },
    },
  };
}

/** Printed amounts of the original bill (reconciliation only, never an input). */
export const PRINTED_070789E = [
  { key: "SELLER_CONSUMPTION", label: "Spesa per la materia energia, quota consumi", amount: "103,75", evidence: "dettaglio vendita, totale quota energia" },
  { key: "SELLER_FIXED", label: "Spesa per la materia energia, quota fissa", amount: "18,00", evidence: "dettaglio vendita, quote fisse 15,00 + Opzione Flex 3,00" },
  { key: "SYSTEM", label: "Oneri di sistema", amount: "18,64", evidence: "righe ASOS e ARIM del dettaglio" },
  { key: "NETWORK_AND_SYSTEM", label: "Spesa per il trasporto e oneri di sistema", amount: "37,18", evidence: "quadro sintetico: quota fissa 16,37 + quota potenza 3,74 + quota energia 17,07" },
  { key: "REACTIVE", label: "Energia reattiva", amount: "5,48", evidence: "riga energia reattiva immessa" },
  { key: "EXCISE", label: "Accise", amount: "4,19", evidence: "riga accise" },
  { key: "VAT", label: "IVA 22%", amount: "36,43", evidence: "IVA 22% su imponibile 165,60" },
  { key: "TOTAL", label: "Totale bolletta", amount: "205,03", evidence: "totale da pagare" },
];
