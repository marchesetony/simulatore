import type { BillEconomicAnalysis } from "../foundation/bill-economic-analysis";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildQuoteReceipt, type QuoteReceipt, type QuoteReceiptQuota } from "./receipt.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { offerScontrino, pairScontrini, type ScontrinoLine, type ScontrinoPairRow } from "./offer-scontrino.ts";
import type { ElectricityTaxResult } from "../calculation/electricity-taxes";
import type { RegulatedCompleteness } from "../calculation/technical-quadrature";

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
  /** Where the value comes from (CTE, GME, Terna, ARERA, TIS, hypothesis), from the server. */
  readonly provenance?: { readonly kinds: readonly string[]; readonly detail: string };
}

export interface TechnicalScontrinoInput {
  readonly vector: "EE" | "GAS";
  readonly result: {
    readonly components: readonly TechnicalComponent[];
    readonly totalCommercialCost: number;
    readonly costScope: string;
    readonly warnings: readonly string[];
    /** Rete e oneri checked component by component on the server (technical-quadrature.ts). */
    readonly regulatedCompleteness: Pick<RegulatedCompleteness, "status" | "missing" | "asos" | "tariffClass" | "basis" | "checked">;
    /** Excise and VAT computed from the law on the simulated amounts (electricity-taxes.ts). */
    readonly taxes: ElectricityTaxResult;
    readonly totals: { readonly netOfTaxes: number | null; readonly taxes: number | null; readonly withTaxes: number | null };
  };
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
  /** The bill's receipt: its "current" values fill the bill column only. */
  readonly receipt: QuoteReceipt;
  /** The simulation's receipt, built without the bill: its quotas fill the simulation column. */
  readonly offerReceipt: QuoteReceipt;
  /** Both columns aligned voce by voce; empty when the bill's scontrino cannot be rebuilt. */
  readonly rows: readonly ScontrinoPairRow[];
  /** The simulation alone, for a bill whose scontrino cannot be rebuilt. */
  readonly offerLines: readonly ScontrinoLine[];
  readonly billTotal: number | null;
  readonly offerTotal: number | null;
  /** The bill prints its taxes (its total is with taxes). */
  readonly taxesIncluded: boolean;
  /** The simulation's own excise and VAT are determined. */
  readonly offerTaxesDetermined: boolean;
  /** Both totals with taxes and every charge of the simulation determined. */
  readonly complete: boolean;
  readonly difference: number | null;
  readonly differencePercent: number | null;
  readonly missing: readonly string[];
  /** Explicit hypotheses the simulation rests on (ASOS class, fiscal regime). */
  readonly assumptions: readonly string[];
}

const PARTIAL_TOTAL = "Totale parziale della simulazione (voci non determinate)";
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
function withTaxBreakdown(lines: readonly ScontrinoLine[], excise: number | null, vat: number | null, vatRate: number | null): readonly ScontrinoLine[] {
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

const COMPARED_QUOTAS: readonly QuoteReceiptQuota["key"][] = ["CONSUMPTION", "FIXED", "POWER", "REACTIVE", "ONE_OFF", "OTHER", "BONUS"];
const TAX_QUOTAS: readonly QuoteReceiptQuota["key"][] = ["EXCISE", "VAT", "TAXES"];
const TAX_SUBS: readonly string[] = ["accise e IVA non separate in fattura", "di cui accise", "di cui IVA"];

export function technicalScontrino(input: TechnicalScontrinoInput): TechnicalScontrino {
  const components = input.result.components.map((component) => ({ category: component.category, sign: component.sign, label: component.label, ...(component.formulaId ? { formulaId: component.formulaId } : {}), amount: { amount: component.amount }, ...(component.formulaInputs ? { formulaInputs: component.formulaInputs } : {}) }));
  const common = { vector: input.vector, offerSupplyCost: input.result.totalCommercialCost, domestic: input.domestic, validUntil: null, offerComponents: components, warnings: input.result.warnings } as const;
  // Tony (15/11/2026, quadratura autonoma): the bill fills its own column only. The simulation's quotas come from a receipt
  // built without the bill, and its taxes from the server's fiscal calculation: no bill amount can reach that column.
  const receipt = buildQuoteReceipt({ ...common, analysis: input.analysis });
  const offerReceipt = buildQuoteReceipt({ ...common, analysis: null });
  const taxes = input.result.taxes;
  const regulated = input.result.regulatedCompleteness;
  const billComplete = receipt.status === "COMPLETE";
  const taxesIncluded = billComplete && receipt.taxesIncluded;
  const offerTaxesDetermined = taxes.status === "DETERMINED" && taxes.excise !== null && taxes.vat !== null && input.result.totals.withTaxes !== null;
  const missing: string[] = [];
  if (!billComplete) missing.push("la fattura non riporta la spesa per la vendita: la sua colonna non si può ricostruire");
  if (regulated.status !== "COMPLETE") missing.push(...regulated.missing.map((text) => text.startsWith("rete e oneri") ? text : `rete e oneri ARERA, ${text}`));
  for (const text of technicalMissing(input.result.warnings)) if (!missing.includes(text)) missing.push(text);
  for (const item of offerReceipt.undetermined ?? []) if (!missing.some((text) => text.toLowerCase().startsWith(item.toLowerCase()))) missing.push(`${item.toLowerCase()}: non determinabile dalla CTE`);
  if (!offerTaxesDetermined) for (const reason of taxes.reasons) { const text = /^(accisa|IVA)/i.test(reason) ? reason : `imposte della simulazione: ${reason}`; if (!missing.includes(text)) missing.push(text); }
  if (billComplete && !taxesIncluded) missing.push("accise e IVA: la fattura non le riporta, il suo totale non comprende le imposte");
  // A bill charge the simulation does not price (reactive energy, social bonus, altre partite) would enter the comparison
  // only as a bill amount: it is said, and the totals are not compared.
  const quotaOf = (source: QuoteReceipt, key: QuoteReceiptQuota["key"]) => source.quotas.find((item) => item.key === key)?.offer ?? 0;
  if (billComplete && COMPARED_QUOTAS.some((key) => Math.abs(quotaOf(receipt, key) - quotaOf(offerReceipt, key)) >= 0.005)) missing.push("la fattura contiene voci che la simulazione non calcola (energia reattiva, bonus o altre partite): sono importi della sola fattura");
  const complete = billComplete && taxesIncluded && offerTaxesDetermined && missing.length === 0;
  const scontrino = { vector: input.vector, quantity: input.quantity, months: input.months, powerKw: input.powerKw } as const;
  // The simulation column: its own quotas, then its own excise and VAT.
  const offerQuotas: QuoteReceiptQuota[] = offerReceipt.quotas.filter((item) => !TAX_QUOTAS.includes(item.key));
  if (offerTaxesDetermined) offerQuotas.push({ key: "EXCISE", label: "Accise", basis: "", current: null, offer: taxes.excise!.amount, difference: null, currentSeller: null, offerSeller: null, details: [] }, { key: "VAT", label: "IVA", basis: "", current: null, offer: taxes.vat!.amount, difference: null, currentSeller: null, offerSeller: null, details: [] });
  const offerWhole = regulated.status === "COMPLETE" && !input.result.warnings.some((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:")) && !(offerReceipt.undetermined ?? []).length;
  let offerLines = offerScontrino({ ...scontrino, quotas: offerQuotas, taxesIncluded: offerTaxesDetermined, side: "offer", offerTotal: offerTaxesDetermined ? input.result.totals.withTaxes : offerWhole ? input.result.totals.netOfTaxes : null });
  offerLines = offerTaxesDetermined ? withTaxBreakdown(offerLines, taxes.excise!.amount, taxes.vat!.amount, taxes.vat!.rate) : withTaxesMissing(offerLines);
  if (!offerWhole) offerLines = relabelTotal(offerLines, PARTIAL_TOTAL);
  // The bill column: the bill's own figures, as printed.
  let billLines = billComplete ? offerScontrino({ ...scontrino, quotas: receipt.quotas, taxesIncluded, side: "current", offerTotal: receipt.currentTotal, excluded: input.billExcluded?.(receipt.currentTotal) ?? [] }) : [];
  if (billLines.length) {
    const current = (key: QuoteReceiptQuota["key"]) => receipt.quotas.find((item) => item.key === key)?.current ?? null;
    billLines = taxesIncluded ? withTaxBreakdown(billLines, current("EXCISE"), current("VAT"), receipt.billVatRate ?? null) : withTaxesMissing(billLines);
  }
  const billTotal = billComplete ? receipt.currentTotal : null;
  const offerTotal = offerLines.find((line) => line.kind === "total")?.amount ?? null;
  const difference = complete && billTotal !== null && offerTotal !== null ? cents(offerTotal - billTotal) : null;
  const differencePercent = difference !== null && billTotal ? Math.round((difference / billTotal) * 1000) / 10 : null;
  const assumptions = [...(regulated.asos.basis === "ASSUMED_CLASS_0" && regulated.asos.note ? [regulated.asos.note] : []), ...taxes.assumptions];
  return { receipt, offerReceipt, rows: billLines.length ? pairedTotals(pairScontrini(billLines, offerLines), billLines, offerLines) : [], offerLines, billTotal, offerTotal, taxesIncluded, offerTaxesDetermined, complete, difference, differencePercent, missing, assumptions };
}

// One label column serves both sides: when the two totals are of a different kind (with taxes, net of taxes, partial) the
// row is called "Totale" and the kind of each is said right under it, on its own side.
function pairedTotals(paired: readonly ScontrinoPairRow[], bill: readonly ScontrinoLine[], offer: readonly ScontrinoLine[]): readonly ScontrinoPairRow[] {
  // The tax breakdown sits under "Accise e IVA" on both sides, whatever quotas each side has above it.
  const taxSubs = paired.filter((row) => row.kind === "sub" && TAX_SUBS.includes(row.label));
  const merged = TAX_SUBS.map((label) => taxSubs.filter((row) => row.label === label)).filter((group) => group.length).map((group) => ({ kind: "sub" as const, label: group[0].label, bill: group.find((row) => row.bill)?.bill ?? null, offer: group.find((row) => row.offer)?.offer ?? null }));
  const rest = paired.filter((row) => !taxSubs.includes(row));
  const at = rest.findIndex((row) => row.kind === "item" && row.label === "Accise e IVA");
  const rows = at < 0 ? paired : [...rest.slice(0, at + 1), ...merged, ...rest.slice(at + 1)];
  const billLabel = bill.find((line) => line.kind === "total")?.label; const offerLabel = offer.find((line) => line.kind === "total")?.label;
  if (!billLabel || !offerLabel || billLabel === offerLabel) return rows;
  return rows.flatMap((row) => row.kind !== "total" ? [row] : [{ ...row, label: "Totale" }, { kind: "sub" as const, label: "tipo di totale", bill: { price: billLabel, amount: null }, offer: { price: offerLabel, amount: null } }]);
}
