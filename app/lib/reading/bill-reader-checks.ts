import type { BillReading, PrintedComponentCategory, ScontrinoRow } from "./bill-reader-schema.ts";

// Tony (5/11/2026): before the agent sees the data, the reading must add up. These checks only compare numbers Claude copied
// from the same bill; they never replace a value. A failed check sends Claude back to that point of the bill, and what still
// does not add up is shown to the operator instead of a wrong number.

/** "1.234,56" → 1234.56, "0,207540" → 0.20754, "-12,30 €" → -12.3; null when the text holds no number. */
export function italianNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[€\s]/g, "").replace(/[−–]/g, "-").replace(/[^\d.,+-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const hasComma = cleaned.includes(",");
  const normalized = hasComma ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^[+-]?\d{1,3}(\.\d{3})+$/.test(cleaned) ? cleaned.replace(/\./g, "") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const cents = (value: number) => Math.round(value * 100);

// Tony (10/11/2026, fattura EE20369/2026: "Distribuzione fissa 49,02 Eurocent/mese → € 0,49"): a unit price printed in euro
// cents (Eurocent/mese, c€/kWh, centesimi di euro/kW) is divided by 100 before quantity × price is compared with the amount.
// Only the check converts it: the value and the unit read from the bill are kept as printed.
const CENT_UNIT = /c\s*€|\bc\.?\s*eur|cent(?:esim[oi])?\b|eurocent/i;
export function unitPriceInEuro(price: number, unit: string): number { return CENT_UNIT.test(unit) ? price / 100 : price; }

/** The quantity × price check of one printed row: true when it adds up, false when it does not, null when it cannot be checked
 *  (a number missing, quantity zero, a percentage, or "€/kW/mese" whose months are not in the quantity). */
export function productAmountMatches(quantity: number | null, price: number | null, unit: string, amount: number | null): boolean | null {
  if (quantity === null || price === null || amount === null || quantity === 0 || /%/.test(unit)) return null;
  // "kW per mesi × €/kW/mese" prints the kW only: the months are not in the quantity, so only same-unit rows are checked.
  if (/\/\s*kW\s*\/\s*mese/i.test(unit)) return null;
  const expected = quantity * unitPriceInEuro(price, unit);
  // The average price of the scontrino is rounded: 0,5% or 2 cents of tolerance.
  return Math.abs(cents(expected) - cents(amount)) <= Math.max(2, Math.abs(cents(amount)) * 0.005);
}

/** F1 + F2 + F3 against the billed consumption: a gap above 1 kWh is reported (BANDS_SUM). "Dati letti" uses the same value. */
export const BANDS_SUM_TOLERANCE_KWH = 1;

export interface ReadingCheck { readonly code: string; readonly message: string }

function quotaGroups(rows: readonly ScontrinoRow[]): Map<string, { total: number | null; shares: number[] }> {
  const groups = new Map<string, { total: number | null; shares: number[] }>();
  for (const row of rows) {
    if (row.quota === "NESSUNA") continue;
    const group = groups.get(row.quota) ?? { total: null, shares: [] };
    const amount = italianNumber(row.importo);
    if (row.tipo === "QUOTA_TOTALE" && amount !== null) group.total = amount;
    if ((row.tipo === "DI_CUI_VENDITA" || row.tipo === "DI_CUI_RETE_ONERI") && amount !== null) group.shares.push(amount);
    groups.set(row.quota, group);
  }
  return groups;
}

/** The sum of the scontrino rows that make up the bill total (each quota once). */
export function scontrinoSum(all: readonly ScontrinoRow[]): number {
  // Tony (5/11, DARVEPOST BPower): "Totale da pagare", canone TV and credits come after the Totale bolletta and are not in it.
  const end = all.findIndex((row) => row.tipo === "TOTALE_BOLLETTA");
  const rows = end >= 0 ? all.slice(0, end) : all;
  let sum = 0;
  for (const [, group] of quotaGroups(rows)) sum += group.total ?? group.shares.reduce((left, right) => left + right, 0);
  for (const row of rows) {
    // The TV licence is printed after the Totale bolletta (it is in the total to pay, not in the bill total).
    if (row.tipo === "QUOTA_TOTALE" || row.tipo === "DI_CUI_VENDITA" || row.tipo === "DI_CUI_RETE_ONERI" || row.tipo === "TOTALE_BOLLETTA" || row.tipo === "CANONE_TV") continue;
    // A reactive-energy row printed inside a quota is already in that quota's total.
    if (row.tipo === "ENERGIA_REATTIVA" && row.quota !== "NESSUNA" && quotaGroups(rows).get(row.quota)?.total !== null) continue;
    sum += italianNumber(row.importo) ?? 0;
  }
  return sum;
}

// Tony (13/11/2026, BPower 071808E): transport and system charges printed apart are parts of the "rete e oneri" the scontrino
// prints, excise and VAT parts of its "Accise e IVA". They are checked against those printed totals and never added to them.
export interface PrintedComponentSums { readonly network: number | null; readonly system: number | null; readonly excise: number | null; readonly vat: number | null }
export interface PrintedAggregates { readonly networkAndSystem: number | null; readonly taxes: number | null }

const euroText = (value: number) => value.toFixed(2).replace(".", ",");
/** The printed parts against the printed total: two parts must give the total (1 cent of rounding), one part cannot exceed it. */
export function printedComponentChecks(parts: PrintedComponentSums, totals: PrintedAggregates): readonly ReadingCheck[] {
  const checks: ReadingCheck[] = [];
  const pair = (code: string, names: readonly [string, string], values: readonly [number | null, number | null], total: number | null, totalName: string) => {
    if (total === null) return;
    const known = values.filter((value): value is number => value !== null);
    if (known.length === 0) return;
    const sum = known.reduce((left, right) => left + right, 0);
    if (known.length === 2 && Math.abs(cents(sum) - cents(total)) > 1) checks.push({ code, message: `${names[0]} ${euroText(values[0]!)} € + ${names[1]} ${euroText(values[1]!)} € = ${euroText(sum)} € ma ${totalName} stampato è ${euroText(total)} €: rileggi gli importi separati.` });
    else if (known.length === 1 && cents(sum) > cents(total) + 1) checks.push({ code, message: `${values[0] !== null ? names[0] : names[1]} ${euroText(sum)} € supera ${totalName} stampato (${euroText(total)} €): rileggi l'importo separato.` });
  };
  pair("COMPONENTS_NETWORK_SYSTEM", ["Trasporto e rete", "oneri di sistema"], [parts.network, parts.system], totals.networkAndSystem, "rete e oneri");
  pair("COMPONENTS_TAXES", ["Accise", "IVA"], [parts.excise, parts.vat], totals.taxes, "Accise e IVA");
  return checks;
}

/** Rete e oneri and Accise e IVA as the scontrino prints them: each quota's "di cui rete e oneri" (a quota potenza printed
 *  without any "di cui" is all network), and the "Accise e IVA" rows. Null when the scontrino does not print them. */
export function scontrinoAggregates(rows: readonly ScontrinoRow[]): PrintedAggregates {
  const end = rows.findIndex((row) => row.tipo === "TOTALE_BOLLETTA");
  const scoped = end >= 0 ? rows.slice(0, end) : rows;
  const sum = (items: readonly ScontrinoRow[]) => { const values = items.map((row) => italianNumber(row.importo)).filter((value): value is number => value !== null); return values.length ? values.reduce((left, right) => left + right, 0) : null; };
  const parts: number[] = [];
  for (const quota of ["CONSUMI", "FISSA", "POTENZA"] as const) {
    const ofQuota = scoped.filter((row) => row.quota === quota);
    const network = sum(ofQuota.filter((row) => row.tipo === "DI_CUI_RETE_ONERI"));
    if (network !== null) parts.push(network);
    else if (quota === "POTENZA" && !ofQuota.some((row) => row.tipo === "DI_CUI_VENDITA")) { const total = sum(ofQuota.filter((row) => row.tipo === "QUOTA_TOTALE")); if (total !== null) parts.push(total); }
  }
  return { networkAndSystem: parts.length ? parts.reduce((left, right) => left + right, 0) : null, taxes: sum(scoped.filter((row) => row.tipo === "ACCISE_IVA")) };
}

/** The printed components of one category added up (a bill may print VAT at two rates); null when none is printed. */
export function printedComponentSum(rows: readonly { readonly categoria: string; readonly importo: string }[], category: PrintedComponentCategory): number | null {
  const values = rows.filter((row) => row.categoria === category).map((row) => italianNumber(row.importo)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((left, right) => left + right, 0) : null;
}

export function checkBillReading(reading: BillReading): readonly ReadingCheck[] {
  const checks: ReadingCheck[] = [];
  const isBill = reading.tipoDocumento !== "NON_BOLLETTA";
  if (!isBill) return [{ code: "NOT_A_BILL", message: "Il documento non sembra una bolletta." }];

  if (!reading.periodoDal || !reading.periodoAl) checks.push({ code: "PERIOD_MISSING", message: "Periodo fatturato non letto: cercalo nel frontespizio o vicino ai consumi." });

  if (reading.vettore === "EE") {
    const f = [reading.consumoF1, reading.consumoF2, reading.consumoF3].map(italianNumber);
    const total = italianNumber(reading.consumoFatturato);
    if (f.every((value) => value !== null) && total !== null && Math.abs((f[0]! + f[1]! + f[2]!) - total) > BANDS_SUM_TOLERANCE_KWH) {
      checks.push({ code: "BANDS_SUM", message: `F1 ${reading.consumoF1} + F2 ${reading.consumoF2} + F3 ${reading.consumoF3} non dà il consumo fatturato ${reading.consumoFatturato} kWh: rileggi i consumi per fascia e il totale.` });
    }
    if ((total === null || total <= 0) && !f.every((value) => value !== null && value >= 0)) {
      checks.push({ code: "CONSUMPTION_MISSING", message: "Consumo fatturato (kWh) non letto o zero: cercalo nel frontespizio, nella quota per consumi dello scontrino o nella tabella letture e consumi." });
    }
    const quotaConsumi = reading.scontrino.find((row) => row.quota === "CONSUMI" && row.tipo === "QUOTA_TOTALE");
    const quotaKwh = italianNumber(quotaConsumi?.quantita);
    if (quotaKwh !== null && total !== null && Math.abs(quotaKwh - total) > 1) checks.push({ code: "CONSUMPTION_VS_SCONTRINO", message: `La quota per consumi dello scontrino stampa ${quotaConsumi?.quantita} kWh ma il consumo fatturato letto è ${reading.consumoFatturato}: verifica quale è il consumo del periodo.` });
  }
  if (reading.vettore === "GAS" && (italianNumber(reading.consumoSmc) ?? italianNumber(reading.consumoFatturato) ?? 0) <= 0) {
    checks.push({ code: "CONSUMPTION_MISSING", message: "Consumo fatturato (Smc) non letto." });
  }

  const total = italianNumber(reading.totaleBolletta);
  if (total === null) checks.push({ code: "TOTAL_MISSING", message: "Totale bolletta non letto." });
  if (reading.scontrino.length === 0 && reading.tipoDocumento !== "FATTURA_DETTAGLIO") checks.push({ code: "SCONTRINO_MISSING", message: "Scontrino dell'energia (quadro sintetico) non letto: è nella seconda facciata, con Quota per consumi, Quota fissa, Quota potenza e i loro 'di cui'." });

  for (const [quota, group] of quotaGroups(reading.scontrino)) {
    if (group.total === null || group.shares.length < 2) continue;
    const shares = group.shares.reduce((left, right) => left + right, 0);
    // Reactive energy may sit in the quota total without its own "di cui" (Plenitude): the shares may fall short, never exceed.
    if (cents(shares) > cents(group.total) + 1 || cents(group.total) - cents(shares) > Math.max(2, Math.abs(cents(group.total)) * 0.05)) {
      checks.push({ code: "QUOTA_SHARES", message: `Quota ${quota.toLowerCase()}: i 'di cui' sommano ${shares.toFixed(2)} € ma il totale della quota è ${group.total.toFixed(2)} €.` });
    }
  }
  if (total !== null && reading.scontrino.length) {
    const sum = scontrinoSum(reading.scontrino);
    if (Math.abs(cents(sum) - cents(total)) > 2) checks.push({ code: "SCONTRINO_TOTAL", message: `Le righe dello scontrino sommano ${sum.toFixed(2)} € ma il totale bolletta è ${total.toFixed(2)} €: manca o è doppia una riga (accise e IVA, altre partite, bonus, ricalcoli, reattiva).` });
    const printedTotal = reading.scontrino.find((row) => row.tipo === "TOTALE_BOLLETTA");
    const printed = italianNumber(printedTotal?.importo);
    if (printed !== null && cents(printed) !== cents(total)) checks.push({ code: "TOTAL_MISMATCH", message: `Il totale bolletta letto (${reading.totaleBolletta}) è diverso da quello dello scontrino (${printedTotal?.importo}).` });
  }

  const components = reading.componentiStampate ?? [];
  if (components.length) checks.push(...printedComponentChecks({ network: printedComponentSum(components, "TRASPORTO_RETE"), system: printedComponentSum(components, "ONERI_SISTEMA"), excise: printedComponentSum(components, "ACCISE"), vat: printedComponentSum(components, "IVA") }, scontrinoAggregates(reading.scontrino)));

  const productChecks = [...reading.scontrino.map((row) => ({ label: row.etichetta, quantity: row.quantita, price: row.prezzoMedio, amount: row.importo, unit: row.unitaPrezzo })),
    ...reading.dettaglio.map((row) => ({ label: row.descrizione, quantity: row.quantita, price: row.prezzo, amount: row.importo, unit: row.unitaPrezzo }))];
  for (const row of productChecks) {
    const quantity = italianNumber(row.quantity); const price = italianNumber(row.price); const amount = italianNumber(row.amount);
    if (productAmountMatches(quantity, price, row.unit, amount) === false) {
      const expected = quantity! * unitPriceInEuro(price!, row.unit);
      checks.push({ code: "PRODUCT", message: `"${row.label}": ${row.quantity} × ${row.price} = ${expected.toFixed(2)} € ma l'importo letto è ${row.amount} €.` });
    }
  }
  return checks;
}
