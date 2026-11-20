import type { StructuredBillEconomicChargeLine, StructuredBillExtraction } from "../ingestion/structured-bill";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildCurrentBillEconomicAnalysis, type BillEconomicComponentInput } from "./bill-economic-analysis.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { summaryDetailComparison } from "../quote/receipt.ts";

/**
 * Tony (19/11/2026, "approvazione intervento minimo lettura fatture"): some sellers issue the bill as two PDFs, the sintetica
 * and the fattura di dettaglio. The dettaglio can be linked later to the sintetica already registered: the sintetica stays
 * authoritative for the total, the dettaglio for the split of the economic components, quantities, unit prices and VAT per
 * line. The link is made only when the two documents are shown to be the same invoice of the same supply point: same seller,
 * POD or PDR, period and, when both print them, document number and issue date, and the detail's vendita, trasporto and oneri
 * adding up to the sintetica's vendita and rete e oneri. Otherwise nothing is associated. Neither document is altered.
 */
export type BillDetailCheckCode = "VECTOR" | "SUPPLIER" | "SUPPLY_POINT" | "BILLING_PERIOD" | "INVOICE_NUMBER" | "ISSUE_DATE" | "DETAIL_LINES" | "AMOUNTS";
export interface BillDetailCheck { readonly code: BillDetailCheckCode; readonly outcome: "OK" | "FAILED" | "NOT_DETERMINABLE"; readonly message: string }
/** The fattura di dettaglio linked to a registered bill: its own stored file and its own reading, kept apart from the sintetica. */
export interface BillDetailLink {
  readonly linkId: string;
  readonly fileName: string;
  readonly objectKey: string;
  readonly size: number;
  readonly sha256: string;
  readonly linkedAt: string;
  readonly actorId: string | null;
  readonly structuredBill: StructuredBillExtraction;
  readonly checks: readonly BillDetailCheck[];
}

// Totals and the quadro sintetico's own rows are the sintetica's: the detail contributes only its charge lines.
const SUMMARY_CODES = new Set(["BILL_TOTAL", "AMOUNT_DUE", "TAX_SUBTOTAL", "PRIOR_BALANCE", "CANONE_RAI"]);
const QUOTA_SUMMARY = /^Quota (?:per consumi|fissa|potenza)(?: - di cui |$)/;
/** The detail's own charge lines, without totals or quadro-sintetico rows of its own. */
export function detailChargeLines(detail: StructuredBillExtraction): readonly StructuredBillEconomicChargeLine[] {
  return detail.economicChargeLines.filter((line) => !SUMMARY_CODES.has(line.code) && !QUOTA_SUMMARY.test(line.description));
}
/** The sintetica's reading with the detail's charge lines beside its own, as a single PDF holding both would be read. The
 *  stored readings are not changed: this is the view the analysis and the comparison use. */
export function withDetailLines(summary: StructuredBillExtraction, detail: StructuredBillExtraction): StructuredBillExtraction {
  return { ...summary, economicChargeLines: [...summary.economicChargeLines, ...detailChargeLines(detail)] };
}

const found = <T>(field: { readonly status: string; readonly value: T | null } | undefined): T | null => field && field.status === "FOUND" && field.value !== null ? field.value : null;
const fact = (bill: StructuredBillExtraction, code: string): string | null => bill.extendedFacts.find((item) => item.code === code && item.status === "FOUND" && String(item.value ?? "").trim())?.value ?? null;
const compact = (value: string): string => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// "BPower S.r.l." and "BPOWER SRL" are the same seller; the legal form is not part of the comparison.
const sellerKey = (value: string): string => compact(value).replace(/(SPA|SRL|SRLS|SAPA|SNC|SAS|SCARL|SCRL)$/, "");

function analysisOf(bill: StructuredBillExtraction) {
  const inputs: BillEconomicComponentInput[] = bill.economicChargeLines.map((line) => ({ code: line.code, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount, period: line.periodRaw, rawDescription: line.rawDescription, rawValue: line.rawValue, rawUnit: line.rawUnit, rawQuantity: line.rawQuantity, rawUnitPrice: line.rawUnitPrice, rawAmount: line.rawAmount, rawPeriod: line.rawPeriod, documentEvidence: line.documentEvidence, status: line.status }));
  const period = found(bill.billingPeriod);
  return buildCurrentBillEconomicAnalysis(inputs, found(bill.totalAmount), { billingPeriodStart: period?.from ?? null });
}

/** Whether the detail is the same invoice as the sintetica. Every check is reported; any FAILED blocks the link. */
export function billDetailCoherence(summary: StructuredBillExtraction, detail: StructuredBillExtraction): { readonly coherent: boolean; readonly checks: readonly BillDetailCheck[] } {
  const checks: BillDetailCheck[] = [];
  const same = (code: BillDetailCheckCode, label: string, left: string | null, right: string | null, key: (value: string) => string, required: boolean) => {
    if (left === null || right === null) { checks.push({ code, outcome: required ? "FAILED" : "NOT_DETERMINABLE", message: `${label} non letto ${left === null && right === null ? "in nessuno dei due documenti" : left === null ? "nella sintetica" : "nella fattura di dettaglio"}` }); return; }
    checks.push(key(left) === key(right) ? { code, outcome: "OK", message: `${label} uguale nei due documenti` } : { code, outcome: "FAILED", message: `${label} diverso tra sintetica e fattura di dettaglio` });
  };
  const vector = found(summary.vector);
  same("VECTOR", "Vettore", vector, found(detail.vector), (value) => value, true);
  same("SUPPLIER", "Fornitore", found(summary.supplier), found(detail.supplier), sellerKey, true);
  same("SUPPLY_POINT", vector === "GAS" ? "PDR" : "POD", vector === "GAS" ? found(summary.pdr) : found(summary.pod), vector === "GAS" ? found(detail.pdr) : found(detail.pod), compact, true);
  const period = (bill: StructuredBillExtraction) => { const value = found(bill.billingPeriod); return value ? `${value.from}/${value.to}` : null; };
  same("BILLING_PERIOD", "Periodo fatturato", period(summary), period(detail), (value) => value, true);
  // Not printed by every reading: compared when both documents give it, never assumed.
  same("INVOICE_NUMBER", "Numero documento", fact(summary, "INVOICE_NUMBER"), fact(detail, "INVOICE_NUMBER"), compact, false);
  same("ISSUE_DATE", "Data di emissione", fact(summary, "BILL_ISSUE_DATE"), fact(detail, "BILL_ISSUE_DATE"), compact, false);
  const lines = detailChargeLines(detail);
  checks.push(lines.length ? { code: "DETAIL_LINES", outcome: "OK", message: `${lines.length} voci di dettaglio lette` } : { code: "DETAIL_LINES", outcome: "FAILED", message: "nessuna voce di dettaglio letta nel documento" });
  if (lines.length) {
    const split = summaryDetailComparison({ analysis: analysisOf(withDetailLines(summary, detail)) });
    const money = (value: number | null) => value === null ? "—" : `${value.toFixed(2).replace(".", ",")} €`;
    const detailSupply = split.detail.seller === null || split.detail.network === null || split.detail.system === null ? null : Math.round((split.detail.seller + split.detail.network + split.detail.system) * 100) / 100;
    const summarySupply = split.summary.seller === null || split.summary.networkAndSystem === null ? null : Math.round((split.summary.seller + split.summary.networkAndSystem) * 100) / 100;
    checks.push(split.status === "DETAIL_PREVAILS" && summarySupply !== null
      ? { code: "AMOUNTS", outcome: "OK", message: `vendita, trasporto e oneri del dettaglio ${money(detailSupply)} = vendita e rete e oneri della sintetica ${money(summarySupply)}` }
      : { code: "AMOUNTS", outcome: "FAILED", message: split.status === "SUMMARY_ONLY" ? "il documento non stampa voci separate di vendita, trasporto e oneri" : split.note ?? "importi non coerenti con la sintetica" });
  }
  return { coherent: !checks.some((check) => check.outcome === "FAILED"), checks };
}
