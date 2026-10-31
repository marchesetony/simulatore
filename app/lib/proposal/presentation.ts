/**
 * Tony (31/10): "l'offerta deve essere formulata come una bolletta come lo scontrino elettrico, con logo dell'azienda dati
 * aziendali percentuale e importo di risparmio annuale e mensile, oltre al nome della cte utilizzata e a uno specchietto che
 * paragona l'offerta alla bolletta che è stata simulata". "in lingua italiana".
 * What the agent sees on screen (scontrino, savings, offer box), sent with the PDF request and checked against the proposal.
 */
export interface ProposalPresentationRow { readonly label: string; readonly current: number | null; readonly offer: number | null; readonly difference: number | null; readonly detail: boolean; readonly note?: string }
export interface ProposalPresentationCompare { readonly label: string; readonly bill: string; readonly offer: string }
export interface ProposalPresentation {
  readonly customerName: string;
  readonly supplyLabel: string;
  readonly billSupplier: string;
  readonly billOfferName: string;
  readonly offerSupplier: string;
  readonly offerName: string;
  readonly offerCode: string;
  readonly periodLabel: string;
  readonly consumptionLabel: string;
  readonly taxesIncluded: boolean;
  readonly sameOffer: boolean;
  readonly currentTotal: number | null;
  readonly offerTotal: number | null;
  readonly savings: number | null;
  readonly savingsPercent: number | null;
  readonly annualSaving: number | null;
  readonly annualCurrent: number | null;
  readonly annualBasisLabel: string;
  readonly validUntil: string | null;
  readonly rows: readonly ProposalPresentationRow[];
  readonly comparison: readonly ProposalPresentationCompare[];
  readonly excluded: readonly { readonly label: string; readonly amount: number }[];
}

function fail(): never { throw new Error("PROPOSAL_PRESENTATION_INVALID"); }
function text(value: unknown, max = 200): string { if (value === undefined || value === null) return ""; if (typeof value !== "string") fail(); return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function amount(value: unknown): number | null { if (value === null || value === undefined) return null; if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e9) fail(); return value; }
function list(value: unknown, max: number): readonly unknown[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) fail(); return value; }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) fail(); return value as Record<string, unknown>; }

export function parseProposalPresentation(value: unknown): ProposalPresentation | null {
  if (value === undefined || value === null) return null;
  const input = object(value);
  const validUntil = text(input.validUntil, 10);
  return {
    customerName: text(input.customerName), supplyLabel: text(input.supplyLabel), billSupplier: text(input.billSupplier), billOfferName: text(input.billOfferName),
    offerSupplier: text(input.offerSupplier), offerName: text(input.offerName), offerCode: text(input.offerCode, 80), periodLabel: text(input.periodLabel), consumptionLabel: text(input.consumptionLabel),
    taxesIncluded: input.taxesIncluded === true, sameOffer: input.sameOffer === true,
    currentTotal: amount(input.currentTotal), offerTotal: amount(input.offerTotal), savings: amount(input.savings), savingsPercent: amount(input.savingsPercent),
    annualSaving: amount(input.annualSaving), annualCurrent: amount(input.annualCurrent), annualBasisLabel: text(input.annualBasisLabel),
    validUntil: /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? validUntil : null,
    rows: list(input.rows, 80).map((item) => { const row = object(item); return { label: text(row.label, 120), current: amount(row.current), offer: amount(row.offer), difference: amount(row.difference), detail: row.detail === true, ...(row.note ? { note: text(row.note, 120) } : {}) }; }),
    comparison: list(input.comparison, 20).map((item) => { const row = object(item); return { label: text(row.label, 80), bill: text(row.bill, 160), offer: text(row.offer, 160) }; }),
    excluded: list(input.excluded, 20).map((item) => { const row = object(item); return { label: text(row.label, 120), amount: amount(row.amount) ?? 0 }; }),
  };
}

/** The screen and the proposal must describe the same offer: same supplier and same offer code. */
export function presentationMatches(presentation: ProposalPresentation, proposal: { readonly selectedOffer: { readonly supplier: string; readonly offerCode: string } }): boolean {
  const norm = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm(presentation.offerSupplier) === norm(proposal.selectedOffer.supplier) && (presentation.offerCode === "" || norm(presentation.offerCode) === norm(proposal.selectedOffer.offerCode));
}

/** A proposal saved before the scontrino PDF (no screen figures): the offer's own components, in Italian. */
export function fallbackPresentation(proposal: { readonly customer: { readonly customerId?: string; readonly displayName?: string }; readonly normalizedConsumption?: { readonly basis?: string; readonly f1?: number; readonly f2?: number; readonly f3?: number; readonly smc?: number }; readonly supply: { readonly pod?: string; readonly pdr?: string }; readonly selectedOffer: { readonly supplier: string; readonly offerCode: string }; readonly simulationPeriod: { readonly periodStart: string; readonly periodEnd: string }; readonly offerValidity: { readonly periodEnd: string }; readonly components: readonly { readonly label: string; readonly sign: string; readonly amount: { readonly amount: number } }[]; readonly comparisonCost: { readonly amount: number } | null; readonly commercialCost: { readonly amount: number }; readonly baseline: { readonly amount: number } | null; readonly savings: { readonly amount: number } | null }): ProposalPresentation {
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;
  // Tony (31/10, "solitamente la fornitura finisce l'ultimo del mese, come mai metti sempre giorno 1"): the simulation period
  // ends the day after the last supplied day (01/10 for September); the proposal prints the last supplied day (30/09).
  const lastDay = (value: string) => { const time = Date.parse(`${value.slice(0, 10)}T00:00:00Z`); return Number.isFinite(time) ? new Date(time - 86_400_000).toISOString().slice(0, 10) : value; };
  const consumption = proposal.normalizedConsumption;
  const kwh = consumption && consumption.basis === "PERIOD" ? (consumption.f1 ?? 0) + (consumption.f2 ?? 0) + (consumption.f3 ?? 0) : 0;
  const smc = consumption && consumption.basis === "PERIOD" ? consumption.smc ?? 0 : 0;
  const number = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
  return {
    customerName: proposal.customer.displayName ?? proposal.customer.customerId ?? "", supplyLabel: proposal.supply.pod ? `POD ${proposal.supply.pod}` : proposal.supply.pdr ? `PDR ${proposal.supply.pdr}` : "",
    billSupplier: "", billOfferName: "", offerSupplier: proposal.selectedOffer.supplier, offerName: proposal.selectedOffer.offerCode, offerCode: proposal.selectedOffer.offerCode,
    periodLabel: `${date(proposal.simulationPeriod.periodStart)} - ${date(lastDay(proposal.simulationPeriod.periodEnd))}`, consumptionLabel: kwh > 0 ? `${number.format(kwh)} kWh (F1 ${number.format(consumption?.f1 ?? 0)}, F2 ${number.format(consumption?.f2 ?? 0)}, F3 ${number.format(consumption?.f3 ?? 0)})` : smc > 0 ? `${number.format(smc)} Smc` : "", taxesIncluded: false, sameOffer: false,
    currentTotal: proposal.baseline?.amount ?? null, offerTotal: proposal.comparisonCost?.amount ?? proposal.commercialCost.amount, savings: proposal.savings?.amount ?? null, savingsPercent: null,
    annualSaving: null, annualCurrent: null, annualBasisLabel: "", validUntil: /^\d{4}-\d{2}-\d{2}$/.test(proposal.offerValidity.periodEnd) ? proposal.offerValidity.periodEnd : null,
    rows: proposal.components.slice(0, 80).map((component) => ({ label: component.label, current: null, offer: component.sign === "CREDIT" ? -component.amount.amount : component.amount.amount, difference: null, detail: true })),
    comparison: [], excluded: [],
  };
}
