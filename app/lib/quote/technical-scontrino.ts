import type { BillEconomicAnalysis } from "../foundation/bill-economic-analysis";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildQuoteReceipt, type QuoteReceipt, type QuoteReceiptQuota } from "./receipt.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { offerScontrino, pairScontrini, type ScontrinoLine, type ScontrinoPairRow } from "./offer-scontrino.ts";

// Tony (15/11/2026, "Intervento risolutivo scontrino ARERA"): the Direttore's technical simulation in derogation is shown as
// the ARERA "Scontrino dell'energia" (delibera 315/2024/R/com, Allegato A, art. 6) beside the original bill, with the same
// builders as the ordinary quotes. The simulation keeps its banner and never becomes a proposal. Nothing is invented: a
// charge or a tax the data do not give is shown as missing, and the difference is shown only between two complete totals.

export interface TechnicalComponent {
  readonly label: string;
  readonly category: string;
  readonly sign: "CHARGE" | "DISCOUNT";
  readonly amount: number;
  readonly formulaId?: string;
  readonly formulaInputs?: Readonly<Record<string, string | number | boolean>>;
}

export interface TechnicalScontrinoInput {
  readonly vector: "EE" | "GAS";
  readonly result: { readonly components: readonly TechnicalComponent[]; readonly totalCommercialCost: number; readonly costScope: string; readonly warnings: readonly string[] };
  readonly analysis: Pick<BillEconomicAnalysis, "components" | "totals"> | null;
  readonly domestic: boolean;
  /** kWh (or Smc) of the billed period, months billed and kW of the power quota, as for the ordinary quotes. */
  readonly quantity: number | null;
  readonly months: number | null;
  readonly powerKw: number | null;
  /** The bill's own altre partite left out of the comparison (given the compared bill total), printed in the bill column only. */
  readonly billExcluded?: (comparedTotal: number | null) => readonly { readonly label: string; readonly amount: number }[];
}

export interface TechnicalScontrino {
  readonly receipt: QuoteReceipt;
  /** Both columns aligned voce by voce; empty when the bill's scontrino cannot be rebuilt. */
  readonly rows: readonly ScontrinoPairRow[];
  /** The simulation alone, for a bill whose scontrino cannot be rebuilt. */
  readonly offerLines: readonly ScontrinoLine[];
  readonly billTotal: number | null;
  readonly offerTotal: number | null;
  readonly taxesIncluded: boolean;
  /** Both totals with taxes and every charge of the simulation determined. */
  readonly complete: boolean;
  readonly difference: number | null;
  readonly differencePercent: number | null;
  readonly missing: readonly string[];
}

const PARTIAL_TOTAL = "Totale parziale della simulazione (voci non determinate)";
const COMPLETE_SCOPE = "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE";
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const PERCENT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

const KIND: Readonly<Record<string, string>> = { DISPATCHING: "dispacciamento", CAPACITY_MARKET: "mercato della capacità regolato", CAPACITY_MARKET_LIBERO: "capacity market libero", LOSSES: "perdite di rete", REGULATED: "rete e oneri ARERA" };
const REASON: Readonly<Record<string, string>> = {
  OFFICIAL_VALUE_MISSING: "valore ufficiale del periodo non in archivio",
  LOSS_COEFFICIENT_UNAVAILABLE: "coefficiente perdite TIS Tabella 4 non verificato per il periodo",
  TIS_TABLE_4_NOT_VERIFIED_FOR_PERIOD: "Tabella 4 TIS non verificata per il periodo",
  NET_BASIS_UNVERIFIED: "la CTE non dice se il valore è al netto o al lordo delle perdite",
  CTE_NOT_DETERMINABLE: "la CTE non lo rende determinabile",
  PEAK_HOUR_KWH_MISSING: "mancano i kWh delle ore di picco",
  AVAILABLE_POWER_MISSING: "potenza disponibile non letta in bolletta",
  CTE_REFERENCE_MISSING: "la CTE non indica come si applica",
  CDISPD_MISSING: "CDISPD del mese non in archivio",
};

/** The charges the simulation could not price, in words, from the engine's OFFICIAL_VALUE_MISSING:<kind>:<reason> warnings. */
export function technicalMissing(warnings: readonly string[]): readonly string[] {
  const found = warnings.filter((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:")).map((warning) => {
    const [, kind = "", reason = ""] = warning.split(":");
    return `${KIND[kind] ?? kind.toLowerCase()}: ${REASON[reason] ?? (reason.toLowerCase() || "non calcolato")}`;
  });
  return [...new Set(found)];
}

// ARERA keeps "Accise e IVA" on one line of the scontrino (art. 6) with rates and amounts apart in the tax box (art. 8.19):
// the two amounts are shown under that line, each side with its own VAT rate.
function withTaxBreakdown(lines: readonly ScontrinoLine[], quotas: readonly QuoteReceiptQuota[], side: "current" | "offer", vatRate: number | null): readonly ScontrinoLine[] {
  const value = (key: QuoteReceiptQuota["key"]) => { const quota = quotas.find((item) => item.key === key); return quota ? (side === "current" ? quota.current : quota.offer) : null; };
  const excise = value("EXCISE"); const vat = value("VAT");
  const at = lines.findIndex((line) => line.kind === "item" && line.label === "Accise e IVA");
  if (at < 0) return lines;
  const breakdown: ScontrinoLine[] = excise !== null && vat !== null
    ? [{ kind: "sub", label: "di cui accise", amount: cents(excise) }, { kind: "sub", label: "di cui IVA", price: vatRate === null ? undefined : `${PERCENT.format(vatRate * 100)}%`, amount: cents(vat) }]
    : [{ kind: "sub", label: "accise e IVA non separate in fattura", amount: null }];
  return [...lines.slice(0, at + 1), ...breakdown, ...lines.slice(at + 1)];
}

// Taxes the data do not give stay visible as missing, on both sides, before the total (which is then "imposte escluse").
function withTaxesMissing(lines: readonly ScontrinoLine[]): readonly ScontrinoLine[] {
  const at = lines.findIndex((line) => line.kind === "total");
  const missing: ScontrinoLine = { kind: "item", label: "Accise e IVA", price: "non determinabili", amount: null };
  return at < 0 ? [...lines, missing] : [...lines.slice(0, at), missing, ...lines.slice(at)];
}

function relabelTotal(lines: readonly ScontrinoLine[], label: string): readonly ScontrinoLine[] {
  return lines.map((line) => line.kind === "total" ? { ...line, label } : line);
}

export function technicalScontrino(input: TechnicalScontrinoInput): TechnicalScontrino {
  const components = input.result.components.map((component) => ({ category: component.category, sign: component.sign, label: component.label, ...(component.formulaId ? { formulaId: component.formulaId } : {}), amount: { amount: component.amount }, ...(component.formulaInputs ? { formulaInputs: component.formulaInputs } : {}) }));
  const receipt = buildQuoteReceipt({ vector: input.vector, offerSupplyCost: input.result.totalCommercialCost, analysis: input.analysis, domestic: input.domestic, validUntil: null, offerComponents: components, warnings: input.result.warnings });
  const billComplete = receipt.status === "COMPLETE";
  const taxesIncluded = billComplete && receipt.taxesIncluded;
  const missing: string[] = [];
  if (!billComplete) missing.push("la fattura non riporta la spesa per la vendita: la sua colonna non si può ricostruire");
  if (input.result.costScope !== COMPLETE_SCOPE) missing.push("rete e oneri ARERA della simulazione non calcolati per intero");
  missing.push(...technicalMissing(input.result.warnings));
  for (const item of receipt.undetermined ?? []) if (!missing.some((text) => text.toLowerCase().startsWith(item.toLowerCase()))) missing.push(`${item.toLowerCase()}: non determinabile dalla CTE`);
  if (billComplete && !taxesIncluded) missing.push("accise e IVA: la fattura non le riporta, non sono calcolabili");
  const complete = billComplete && taxesIncluded && missing.length === 0;
  const common = { quotas: receipt.quotas, taxesIncluded, vector: input.vector, quantity: input.quantity, months: input.months, powerKw: input.powerKw } as const;
  // The offer's charges are always added up from its own lines; the total keeps the receipt's figure only when it is whole.
  let offerLines = offerScontrino({ ...common, offerTotal: receipt.offerTotal, side: "offer" });
  let billLines = billComplete ? offerScontrino({ ...common, offerTotal: receipt.currentTotal, side: "current", excluded: input.billExcluded?.(receipt.currentTotal) ?? [] }) : [];
  if (taxesIncluded) {
    offerLines = withTaxBreakdown(offerLines, receipt.quotas, "offer", receipt.vatRate);
    billLines = withTaxBreakdown(billLines, receipt.quotas, "current", receipt.billVatRate ?? null);
  } else {
    offerLines = withTaxesMissing(offerLines);
    if (billLines.length) billLines = withTaxesMissing(billLines);
  }
  // One label column serves both sides: the bill's total keeps its name and the partial simulation says so on its own row.
  if (!complete && taxesIncluded) offerLines = [...relabelTotal(offerLines, PARTIAL_TOTAL), { kind: "sub", label: `${PARTIAL_TOTAL}: non confrontabile con la fattura`, amount: null }];
  const billTotal = billComplete ? receipt.currentTotal : null;
  const offerTotal = offerLines.find((line) => line.kind === "total")?.amount ?? null;
  const difference = complete && billTotal !== null && offerTotal !== null ? cents(offerTotal - billTotal) : null;
  const differencePercent = difference !== null && billTotal ? Math.round((difference / billTotal) * 1000) / 10 : null;
  return { receipt, rows: billLines.length ? pairScontrini(billLines, offerLines) : [], offerLines, billTotal, offerTotal, taxesIncluded, complete, difference, differencePercent, missing };
}
