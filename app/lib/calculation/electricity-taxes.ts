// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { add, fromNumber, multiply, rational, roundCents, type Rational } from "./decimal.ts";

// Tony (15/11/2026, "Completamento quadratura economica autonoma"): the technical simulation computes its own excise and VAT
// from the law, the supply's use and the simulated consumption and amounts, never from the excise or VAT printed on the bill.
// What the data do not make determinable is said so, and the total with taxes is then not given.
//
// Excise on electricity (D.Lgs. 504/1995, Testo unico accise, art. 52 and Allegato I). Rates as published by the Agenzia
// delle Dogane e dei Monopoli (tabella "Aliquote di imposta" aggiornata al 1° gennaio 2024, energia elettrica):
// - locali e luoghi diversi dalle abitazioni: 0,0125 €/kWh for the first 200.000 kWh of the month; 0,0075 €/kWh for the
//   further kWh up to 1.200.000 kWh of the month; above 1.200.000 kWh of the month, 0,0125 €/kWh on the first 200.000 kWh
//   and 4.820,00 € fixed for the rest (art. 3-bis, comma 3, lett. b, D.L. 16/2012, L. 44/2012);
// - abitazioni: 0,0227 €/kWh (D.M. 30/12/2011), with the exemption of art. 52, comma 3, lett. e) for the residence with
//   committed power up to 3 kW (150 kWh/month and recovery above 150/220 kWh), not computed here.
// D.Lgs. 43/2025 (in force for electricity from 1/1/2026) rewrote articles 52-56 but left the Allegato I electricity rates
// unchanged (it amends Allegato I only for natural gas). The table is used for 2024-2026 only: a later period is not
// determinable until the rates are checked again, as for the TIS Tabella 4 losses coefficient (network-losses.ts).
//
// VAT (D.P.R. 633/1972): 10% for electricity for domestic use (Tabella A, parte III, n. 103); 22% ordinary rate (art. 16)
// for other uses. The 10% of n. 103 for extractive, agricultural and manufacturing businesses needs the customer's
// declaration: without it a business supply is priced at 22% (Tony 3/11/2026). The taxable amount is the supply cost
// plus the excise (art. 13).

export const EXCISE_SOURCE = "D.Lgs. 504/1995 art. 52 e Allegato I; aliquote ADM aggiornate al 1/1/2024 (energia elettrica), invariate dal D.Lgs. 43/2025" as const;
export const VAT_SOURCE_ORDINARY = "D.P.R. 633/1972 art. 16 (aliquota ordinaria 22%)" as const;
export const VAT_SOURCE_DOMESTIC = "D.P.R. 633/1972 Tabella A, parte III, n. 103 (energia elettrica per uso domestico, 10%)" as const;

interface ExcisePeriod {
  readonly effectiveFrom: string;
  /** Exclusive. */
  readonly effectiveTo: string;
  readonly nonDomestic: { readonly firstTierKwh: number; readonly firstTierRate: number; readonly secondTierLimitKwh: number; readonly secondTierRate: number; readonly fixedAboveSecondTier: number };
  readonly domesticRate: number;
}

export const ELECTRICITY_EXCISE_PERIODS: readonly ExcisePeriod[] = [
  { effectiveFrom: "2024-01-01", effectiveTo: "2027-01-01", nonDomestic: { firstTierKwh: 200_000, firstTierRate: 0.0125, secondTierLimitKwh: 1_200_000, secondTierRate: 0.0075, fixedAboveSecondTier: 4820 }, domesticRate: 0.0227 },
];
const VAT_PERIOD = { effectiveFrom: "2013-10-01", effectiveTo: "2027-01-01" } as const;

export interface ElectricityTaxInput {
  readonly domestic: boolean;
  readonly resident: boolean | null;
  readonly committedPowerKw: number | null;
  /** Start inclusive, end exclusive (yyyy-mm-dd). */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalKwh: number;
  /** kWh of each calendar month of the period, when the bill gives them. */
  readonly monthlyKwh?: readonly number[] | null;
  /** The simulated supply cost net of taxes (vendita + rete e oneri), in euro. Null when it is not complete. */
  readonly taxableSupply: number | null;
  /** A VAT rate the operator documented (e.g. 10% for an eligible business); otherwise the rate follows the use. */
  readonly declaredVatRate?: number | null;
}

export interface ExciseLine { readonly label: string; readonly kwh: number | null; readonly rate: number | null; readonly amount: number }
export interface ElectricityTaxResult {
  readonly status: "DETERMINED" | "NOT_DETERMINABLE";
  readonly excise: { readonly amount: number; readonly lines: readonly ExciseLine[]; readonly source: string } | null;
  readonly vat: { readonly rate: number; readonly base: number; readonly amount: number; readonly source: string } | null;
  readonly totalTaxes: number | null;
  /** Why something is not determinable. */
  readonly reasons: readonly string[];
  /** Explicit hypotheses the result rests on. */
  readonly assumptions: readonly string[];
}

const cents = (value: Rational): number => roundCents(value) / 100;
const dayMs = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function calendarMonths(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number); const [ey, em, ed] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + (ed > 1 ? 1 : 0);
}

/** Excise of one calendar month for a non-domestic supply, by the Allegato I monthly tiers. */
function nonDomesticMonth(kwh: number, rates: ExcisePeriod["nonDomestic"]): { readonly amount: Rational; readonly lines: readonly { label: string; kwh: number | null; rate: number | null; value: Rational }[] } {
  const first = Math.min(kwh, rates.firstTierKwh);
  const lines: { label: string; kwh: number | null; rate: number | null; value: Rational }[] = [{ label: `primi ${rates.firstTierKwh.toLocaleString("it-IT")} kWh del mese`, kwh: first, rate: rates.firstTierRate, value: multiply(fromNumber(first), fromNumber(rates.firstTierRate)) }];
  if (kwh > rates.secondTierLimitKwh) lines.push({ label: `oltre ${rates.secondTierLimitKwh.toLocaleString("it-IT")} kWh del mese: importo fisso`, kwh: null, rate: null, value: fromNumber(rates.fixedAboveSecondTier) });
  else if (kwh > rates.firstTierKwh) lines.push({ label: `da ${rates.firstTierKwh.toLocaleString("it-IT")} a ${rates.secondTierLimitKwh.toLocaleString("it-IT")} kWh del mese`, kwh: kwh - rates.firstTierKwh, rate: rates.secondTierRate, value: multiply(fromNumber(kwh - rates.firstTierKwh), fromNumber(rates.secondTierRate)) });
  return { amount: lines.reduce<Rational>((sum, line) => add(sum, line.value), rational(BigInt(0))), lines };
}

export function electricityTaxes(input: ElectricityTaxInput): ElectricityTaxResult {
  const reasons: string[] = [];
  const assumptions: string[] = [];
  const start = input.periodStart.slice(0, 10); const end = input.periodEnd.slice(0, 10);
  if (!isoDay.test(start) || !isoDay.test(end) || Date.parse(end) - Date.parse(start) < dayMs) reasons.push("periodo fatturato non valido");
  if (!Number.isFinite(input.totalKwh) || input.totalKwh < 0) reasons.push("consumo del periodo non disponibile");
  const period = ELECTRICITY_EXCISE_PERIODS.find((item) => item.effectiveFrom <= start && end <= item.effectiveTo);
  if (!period) reasons.push("aliquote di accisa non verificate per il periodo fatturato");
  // Exemptions and reductions (art. 52 TUA: own production, railways, diplomatic use; reduced uses) are granted on the
  // customer's documented request: none is documented here, so the ordinary regime applies, and it is said.
  assumptions.push("accisa in regime ordinario: nessuna esenzione o agevolazione documentata");
  let excise: ElectricityTaxResult["excise"] = null;
  if (!reasons.length && period) {
    if (input.domestic) {
      if (input.committedPowerKw === null || !Number.isFinite(input.committedPowerKw)) reasons.push("accisa: potenza impegnata non letta, serve per l'esenzione dell'abitazione di residenza fino a 3 kW");
      else if (input.committedPowerKw <= 3 && input.resident !== false) reasons.push(input.resident === null ? "accisa: residenza non indicata in fattura, serve per l'esenzione fino a 3 kW (art. 52, comma 3, lett. e TUA)" : "accisa: esenzione dell'abitazione di residenza fino a 3 kW con recupero oltre 150/220 kWh mensili (art. 52, comma 3, lett. e TUA) non calcolata dal simulatore");
      else {
        const value = multiply(fromNumber(input.totalKwh), fromNumber(period.domesticRate));
        excise = { amount: cents(value), lines: [{ label: "abitazioni", kwh: input.totalKwh, rate: period.domesticRate, amount: cents(value) }], source: EXCISE_SOURCE };
      }
    } else {
      const months = calendarMonths(start, end);
      const monthly = input.monthlyKwh && input.monthlyKwh.length === months && input.monthlyKwh.every((value) => Number.isFinite(value) && value >= 0) ? input.monthlyKwh : null;
      // The tiers are monthly: one month, or the months' own kWh, or a period whose whole consumption stays in the first tier.
      const perMonth = months === 1 ? [input.totalKwh] : monthly ?? (input.totalKwh <= period.nonDomestic.firstTierKwh ? [input.totalKwh] : null);
      if (!perMonth) reasons.push("accisa: servono i kWh di ogni mese per applicare gli scaglioni mensili");
      else {
        const parts = perMonth.map((kwh) => nonDomesticMonth(kwh, period.nonDomestic));
        const value = parts.reduce<Rational>((sum, part) => add(sum, part.amount), rational(BigInt(0)));
        const lines = parts.flatMap((part) => part.lines).reduce<ExciseLine[]>((all, line) => {
          const same = all.find((item) => item.label === line.label && item.rate === line.rate);
          if (same) return all.map((item) => item === same ? { ...item, kwh: item.kwh === null || line.kwh === null ? null : item.kwh + line.kwh, amount: Math.round((item.amount + cents(line.value)) * 100) / 100 } : item);
          return [...all, { label: line.label, kwh: line.kwh, rate: line.rate, amount: cents(line.value) }];
        }, []);
        excise = { amount: cents(value), lines: lines.filter((line) => line.kwh !== 0), source: EXCISE_SOURCE };
      }
    }
  }
  let vat: ElectricityTaxResult["vat"] = null;
  if (input.taxableSupply === null || !Number.isFinite(input.taxableSupply)) reasons.push("IVA: costo della fornitura simulata non completo, manca la base imponibile");
  else if (!(VAT_PERIOD.effectiveFrom <= start && end <= VAT_PERIOD.effectiveTo)) reasons.push("IVA: aliquote non verificate per il periodo fatturato");
  else if (excise) {
    const declared = input.declaredVatRate ?? null;
    const rate = declared ?? (input.domestic ? 0.1 : 0.22);
    if (declared === null && !input.domestic) assumptions.push("IVA al 22%: l'aliquota del 10% (n. 103) richiede la dichiarazione del cliente, non documentata");
    const base = add(fromNumber(input.taxableSupply), fromNumber(excise.amount));
    vat = { rate, base: cents(base), amount: cents(multiply(base, fromNumber(rate))), source: declared !== null ? "Aliquota dichiarata dall'operatore" : input.domestic ? VAT_SOURCE_DOMESTIC : VAT_SOURCE_ORDINARY };
  }
  const determined = excise !== null && vat !== null && reasons.length === 0;
  return { status: determined ? "DETERMINED" : "NOT_DETERMINABLE", excise, vat, totalTaxes: determined ? cents(add(fromNumber(excise!.amount), fromNumber(vat!.amount))) : null, reasons, assumptions };
}
