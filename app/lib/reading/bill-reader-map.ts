import type { StructuredBillEconomicChargeLine, StructuredBillExtraction, StructuredBillPrintedComponent, StructuredBillPrintedComponentCategory } from "../ingestion/structured-bill.ts";
import type { BillWireExtraction, BillWireField } from "../ingestion/bill-wire.ts";
import type { BillAnalystWireExtraction, BillAnalystWireItem } from "../ingestion/bill-two-stage.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { mapBillCoreToStructuredBill, mergeBillCoreAndAnalyst } from "../ingestion/bill-two-stage.ts";
import type { BillReading, DetailItem, DetailRow, PrintedComponentCategory, ScontrinoRow } from "./bill-reader-schema.ts";
import type { ReadingCheck } from "./bill-reader-checks.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { italianNumber } from "./bill-reader-checks.ts";

// Tony (5/11/2026): the reading Claude returns is turned into the structure the calculation engine already uses. Nothing is
// added from the PDF text: what the bill prints is what Claude read; what it does not print stays empty.

export const BILL_READER_ID = "CLAUDE_DIRETTO";

const found = (value: string): BillWireField => value.trim() ? { value: value.trim(), status: "FOUND" } : { value: "NOT_FOUND", status: "NOT_FOUND" };
const numberText = (value: string): string => { const parsed = italianNumber(value); return parsed === null ? "" : String(parsed); };
const foundNumber = (value: string): BillWireField => found(numberText(value));
const isoDay = (value: string): string => /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : "";

function billedConsumption(reading: BillReading): string {
  const total = italianNumber(reading.consumoFatturato);
  if (total !== null && total > 0) return String(total);
  // Tony (30/10): the period consumption is F1 + F2 + F3 when the three bands are read.
  const bands = [reading.consumoF1, reading.consumoF2, reading.consumoF3].map(italianNumber);
  if (bands.every((value) => value !== null)) return String(bands.reduce((left, right) => left! + right!, 0));
  const quota = reading.scontrino.find((row) => row.quota === "CONSUMI" && row.tipo === "QUOTA_TOTALE" && /kwh|smc/i.test(row.unita));
  const fromQuota = italianNumber(quota?.quantita);
  return fromQuota !== null && fromQuota > 0 ? String(fromQuota) : "";
}

function voltage(reading: BillReading): BillWireField {
  const level = { BT: "LV", MT: "MV", AT: "HV" } as const;
  if (reading.livelloTensione !== "NON_DETERMINABILE") return { value: level[reading.livelloTensione], status: "FOUND" };
  return reading.vettore === "EE" ? { value: "UNKNOWN", status: "NEEDS_REVIEW" } : { value: "NOT_FOUND", status: "NOT_FOUND" };
}

export function coreWire(reading: BillReading): BillWireExtraction {
  const period = isoDay(reading.periodoDal) && isoDay(reading.periodoAl) ? `${isoDay(reading.periodoDal)} - ${isoDay(reading.periodoAl)}` : "";
  return {
    schemaVersion: 1,
    vector: reading.vettore === "NON_DETERMINABILE" ? { value: "UNKNOWN", status: "NEEDS_REVIEW" } : { value: reading.vettore, status: "FOUND" },
    supplier: found(reading.fornitore),
    customerName: found(reading.intestatario),
    customerId: found(reading.codiceCliente),
    customerType: reading.tipoCliente === "NON_DETERMINABILE" ? { value: "UNKNOWN", status: "NEEDS_REVIEW" } : { value: reading.tipoCliente === "DOMESTICO" ? "RESIDENTIAL" : "NON_RESIDENTIAL", status: "FOUND" },
    customerTaxIdentifier: found(reading.codiceFiscalePartitaIva),
    billingPeriod: found(period),
    totalAmount: foundNumber(reading.totaleBolletta),
    annualConsumption: foundNumber(reading.consumoAnnuo),
    billedConsumption: found(billedConsumption(reading)),
    pod: found(reading.pod.replace(/\s+/g, "").toUpperCase()),
    pdr: found(reading.pdr.replace(/\s+/g, "")),
    voltageLevel: voltage(reading),
    powerKw: foundNumber(reading.potenzaImpegnataKw),
    f1Consumption: foundNumber(reading.consumoF1),
    f2Consumption: foundNumber(reading.consumoF2),
    f3Consumption: foundNumber(reading.consumoF3),
    smcConsumption: foundNumber(reading.consumoSmc),
    conversionCoefficient: foundNumber(reading.coefficienteC),
    pcs: foundNumber(reading.pcs),
    offerName: found(reading.offertaNome),
    offerCode: found(reading.offertaCodice.replace(/\s+/g, "")),
  };
}

const item = (kind: "FACT" | "CHARGE", code: string, label: string, value: string, extra: Partial<BillAnalystWireItem> = {}): BillAnalystWireItem =>
  ({ kind, code, label, value, unit: "", quantity: "", unitPrice: "", amount: "", period: "", status: "FOUND", ...extra });

const DETAIL_CODES: Readonly<Record<DetailItem, string>> = {
  PREZZO_ENERGIA: "ENERGY_INDEX", INDICE_PUN: "PUN_SINGLE", SPREAD: "SPREAD", PERDITE: "NETWORK_LOSS_CHARGE", DISPACCIAMENTO: "DISPATCHING",
  CAPACITA: "CAPACITY_MARKET", SBILANCIAMENTO: "IMBALANCE", PCV: "PCV", COMMERCIALIZZAZIONE_VARIABILE: "COMMERCIALIZATION_VARIABLE_FEE",
  ALTRO_VENDITA: "OTHER_SELLER_ENERGY_CHARGE", TRASPORTO_ENERGIA: "NETWORK_SYSTEM", TRASPORTO_QUOTA_FISSA: "NETWORK_FIXED", TRASPORTO_POTENZA: "POWER_CHARGE",
  ONERI_ASOS: "ASOS", ONERI_ARIM: "ARIM", ONERI_ALTRI: "NETWORK_SYSTEM", ENERGIA_REATTIVA: "OTHER_CHARGE", ACCISE: "EXCISE", IVA: "VAT",
  BONUS_SOCIALE: "BONUS", ALTRE_PARTITE: "ALTRE_PARTITE", ALTRO: "UNCLASSIFIED_BILL_CHARGE",
};

function detailCode(row: DetailRow): string {
  if (row.voce === "INDICE_PUN") return row.fascia === "F1" || row.fascia === "F2" || row.fascia === "F3" ? `PUN_${row.fascia}` : "PUN_SINGLE";
  if (row.voce === "ALTRO_VENDITA" && /mese|giorno|anno|pod/i.test(row.unitaPrezzo)) return "OTHER_SELLER_FIXED_CHARGE";
  return DETAIL_CODES[row.voce];
}

function detailItems(reading: BillReading): BillAnalystWireItem[] {
  return reading.dettaglio.map((row) => {
    const band = row.fascia === "NESSUNA" ? "" : row.fascia === "MONORARIA" ? " monoraria" : ` ${row.fascia}`;
    const description = /\bF[123]\b|F23|monorari|picco/i.test(row.descrizione) || !band ? row.descrizione : `${row.descrizione}${band}`;
    return item("CHARGE", detailCode(row), description, row.importo, { unit: row.unitaPrezzo || row.unita, quantity: row.quantita, unitPrice: row.prezzo, amount: row.importo, period: row.periodo });
  });
}

function factItems(reading: BillReading): BillAnalystWireItem[] {
  const facts: [string, string, string, string?][] = [
    ["BILLING_PERIOD_RAW", "Periodo fatturato", reading.periodoStampato],
    ["BILL_ISSUE_DATE", "Data emissione", reading.dataEmissione], ["BILL_DUE_DATE", "Scadenza pagamento", reading.dataScadenzaPagamento],
    ["CONTRACT_START_DATE", "Attivazione fornitura", reading.attivazioneFornitura],
    ["ECONOMIC_CONDITIONS_START_DATE", "Decorrenza condizioni economiche", reading.decorrenzaCondizioni],
    ["ECONOMIC_EXPIRY", "Scadenza condizioni economiche", reading.scadenzaCondizioni],
    [/indetermin/i.test(reading.scadenzaContratto) ? "CONTRACT_INDEFINITE" : "CONTRACT_EXPIRY", "Scadenza contratto", reading.scadenzaContratto],
    ["PRICE_MECHANISM_RAW", "Tipologia offerta", reading.tipologiaOfferta], ["PRICE_TIME_STRUCTURE_RAW", "Tipologia prezzo", reading.tipologiaPrezzo],
    ["INDEX_NAME", "Indice", reading.indice], ["SPREAD", "Spread", reading.spread, /smc/i.test(reading.spread) ? "€/Smc" : "€/kWh"],
    ["PCV", "Quota fissa vendita", reading.pcvMensile, "€/mese"],
    ["PRICE_F1", "Prezzo energia F1", reading.prezzoEnergiaF1, "€/kWh"], ["PRICE_F2", "Prezzo energia F2", reading.prezzoEnergiaF2, "€/kWh"],
    ["PRICE_F3", "Prezzo energia F3", reading.prezzoEnergiaF3, "€/kWh"], ["PRICE_F23", "Prezzo energia F23", reading.prezzoEnergiaF23, "€/kWh"],
    ["MONORARIO_PRICE", "Prezzo energia monorario", reading.prezzoEnergiaMonorario, "€/kWh"], ["LOSS_FACTOR", "Perdite di rete", reading.coefficientePerdite],
    ["ENERGY_PEAK_KWH", "Energia ore di picco", reading.consumoPicco, "kWh"], ["ENERGY_OFF_PEAK_KWH", "Energia ore fuori picco", reading.consumoFuoriPicco, "kWh"],
    ["POWER_COMMITTED", "Potenza impegnata", reading.potenzaImpegnataKw, "kW"], ["POWER_AVAILABLE", "Potenza disponibile", reading.potenzaDisponibileKw, "kW"],
    ["POWER_MAXIMUM_DRAWN", "Potenza massima prelevata", reading.potenzaMassimaPrelevataKw, "kW"],
    ["NOMINAL_VOLTAGE", "Tensione", reading.tensioneStampata], ["SUPPLY_USE_CATEGORY_RAW", "Tipologia cliente", reading.tipoClienteStampato],
    ["ASOS_CLASS_RAW", "Classe ASOS", reading.classeAsos], ["MARKET_REGIME_RAW", "Mercato", reading.mercato],
  ];
  return facts.filter(([, , value]) => value.trim()).map(([code, label, value, unit]) => item("FACT", code, label, value.trim(), unit ? { unit } : {}));
}

function analystWire(reading: BillReading): BillAnalystWireExtraction {
  const history = reading.storicoConsumi
    .map((row) => ({ month: row.mese.trim(), quantity: italianNumber(row.consumo) }))
    .filter((row): row is { month: string; quantity: number } => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) && row.quantity !== null && row.quantity >= 0);
  return { schemaVersion: "1", items: [...factItems(reading), ...detailItems(reading)], ...(history.length ? { consumptionHistory: history } : {}) };
}

const euro = (value: string): string => {
  const parsed = italianNumber(value);
  if (parsed === null) return "";
  const [whole, decimals] = Math.abs(parsed).toFixed(2).split(".");
  return `${parsed < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimals} €`;
};
const QUOTA_LABEL = { CONSUMI: "Quota per consumi", FISSA: "Quota fissa", POTENZA: "Quota potenza", NESSUNA: "" } as const;

/** The scontrino rows in the shape the receipt and the comparison read ("Quota per consumi - di cui spesa per la vendita"). */
export function scontrinoLines(rows: readonly ScontrinoRow[], vector: BillReading["vettore"] = "EE"): StructuredBillEconomicChargeLine[] {
  // Tony (5/11, DARVEPOST BPower: vendita 39,09 € shown as "Altre partite"): the bill-column classifier recognises the seller
  // share by "vendita" + "energia", as the bill prints it ("di cui spesa per la vendita di energia elettrica").
  const sellerShare = vector === "GAS" ? "di cui spesa per la vendita di gas naturale (materia energia)" : "di cui spesa per la vendita di energia elettrica";
  const lines: StructuredBillEconomicChargeLine[] = [];
  let afterTotal = false;
  for (const row of rows) {
    const amount = euro(row.importo);
    if (!amount) continue;
    // Tony (5/11, DARVEPOST BPower): after the Totale bolletta come the amount to pay, the TV licence and credits: never
    // altre partite of the bill.
    if (afterTotal) {
      if (row.tipo === "CANONE_TV" || /canone/i.test(row.etichetta)) lines.push({ code: "CANONE_RAI", description: row.etichetta || "Canone TV", amount, quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND", documentEvidence: `pagina ${row.pagina}` });
      else if (/da\s+pagare/i.test(row.etichetta)) lines.push({ code: "AMOUNT_DUE", description: row.etichetta, amount, quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND", documentEvidence: `pagina ${row.pagina}` });
      continue;
    }
    if (row.tipo === "TOTALE_BOLLETTA") afterTotal = true;
    // The quota is named the same way on every bill ("Quota fissa e Quota potenza - 1 mese" would read as two quotas).
    const quota = QUOTA_LABEL[row.quota];
    const base = { quantity: "", unit: "", unitPrice: "", periodRaw: "", status: "FOUND" as const, documentEvidence: `pagina ${row.pagina}` };
    const priceUnit = row.unitaPrezzo.trim();
    switch (row.tipo) {
      case "QUOTA_TOTALE": lines.push({ ...base, code: "OTHER_CHARGE", description: quota || row.etichetta, amount, quantity: row.quantita, unit: row.unita, unitPrice: row.prezzoMedio }); break;
      case "DI_CUI_VENDITA": lines.push({ ...base, code: "OTHER_CHARGE", description: `${quota} - ${sellerShare}`, amount, unit: priceUnit, unitPrice: row.prezzoMedio, rawDescription: row.etichetta }); break;
      case "DI_CUI_RETE_ONERI": lines.push({ ...base, code: "NETWORK_SYSTEM", description: `${quota} - di cui spesa per la rete e gli oneri generali di sistema`, amount, unit: priceUnit, unitPrice: row.prezzoMedio, rawDescription: row.etichetta }); break;
      case "ENERGIA_REATTIVA": lines.push({ ...base, code: "OTHER_CHARGE", description: /reattiva/i.test(row.etichetta) ? row.etichetta : `Energia reattiva ${row.etichetta}`.trim(), amount, quantity: row.quantita, unit: row.unita || "kVArh", unitPrice: row.prezzoMedio }); break;
      case "ACCISE_IVA": lines.push({ ...base, code: "TAX_SUBTOTAL", description: row.etichetta || "Accise e IVA", amount }); break;
      case "CANONE_TV": lines.push({ ...base, code: "CANONE_RAI", description: row.etichetta || "Canone TV", amount }); break;
      case "BONUS_SOCIALE": lines.push({ ...base, code: "BONUS", description: row.etichetta || "Bonus sociale", amount }); break;
      case "TOTALE_BOLLETTA": lines.push({ ...base, code: "BILL_TOTAL", description: row.etichetta || "Totale bolletta", amount }); break;
      default: lines.push({ ...base, code: "ALTRE_PARTITE", description: row.etichetta, amount }); break;
    }
  }
  return lines;
}

const COMPONENT_CATEGORY: Readonly<Record<PrintedComponentCategory, StructuredBillPrintedComponentCategory>> = { TRASPORTO_RETE: "NETWORK", ONERI_SISTEMA: "SYSTEM_CHARGES", ACCISE: "EXCISE", IVA: "VAT" };

/** Tony (13/11/2026, BPower 071808E): the amounts printed apart (transport, system charges, excise, VAT), as printed, with their
 *  page and section. A row without a known category or a readable amount is left out: nothing is guessed. They are kept apart
 *  from the economic charge lines, which the calculation and the comparison read. */
export function printedComponents(reading: BillReading): StructuredBillPrintedComponent[] {
  return (reading.componentiStampate ?? []).flatMap((row) => {
    const category = COMPONENT_CATEGORY[row.categoria as PrintedComponentCategory];
    const rawAmount = typeof row.importo === "string" ? row.importo.trim() : "";
    const amount = italianNumber(rawAmount);
    if (!category || amount === null) return [];
    const page = typeof row.pagina === "number" && Number.isInteger(row.pagina) && row.pagina > 0 ? row.pagina : 0;
    return [{ category, label: typeof row.etichetta === "string" ? row.etichetta.trim() : "", rawAmount, amount, section: typeof row.sezione === "string" ? row.sezione.trim() : "", page, source: "DOCUMENT_READING" as const }];
  });
}

export interface ReaderOutcome { readonly reading: BillReading; readonly checks: readonly ReadingCheck[]; readonly reread: boolean }

/** The structure the engine reads, with the reading, the checks still failing and the empty fields with their reason. */
export function toStructuredBill(outcome: ReaderOutcome): StructuredBillExtraction {
  const { reading } = outcome;
  const core = mapBillCoreToStructuredBill(coreWire(reading));
  const merged = mergeBillCoreAndAnalyst(core, analystWire(reading), { analystExtractionStatus: "EXTRACTED" });
  const box = { offerType: reading.tipologiaOfferta || null, priceStructure: reading.tipologiaPrezzo || null, indexName: reading.indice || null, economicConditionsStart: reading.decorrenzaCondizioni || null, economicConditionsExpiry: reading.scadenzaCondizioni || null, contractExpiry: reading.scadenzaContratto || null, spread: reading.spread || null };
  const priceRows = reading.valoriFormula.filter((row) => /kwh/i.test(row.unita) && italianNumber(row.valore) !== null).map((row) => ({ label: row.etichetta, unitPrice: row.valore.trim(), period: null, page: row.pagina }));
  return {
    ...merged,
    economicChargeLines: [...scontrinoLines(reading.scontrino, reading.vettore), ...merged.economicChargeLines],
    documentOfferName: reading.offertaNome.trim() || null,
    documentOfferBox: Object.values(box).some(Boolean) ? box : null,
    documentPriceRows: priceRows,
    reader: BILL_READER_ID,
    readingChecks: outcome.checks.map((check) => check.message),
    printedComponents: printedComponents(reading),
    readingAbsent: reading.assenti.map((absent) => ({ field: absent.campo, reason: absent.motivo })),
    readingSources: reading.fonti.map((source) => ({ field: source.campo, page: source.pagina, text: source.testo.slice(0, 200) })),
    readingReread: outcome.reread,
  };
}
