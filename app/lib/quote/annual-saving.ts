// Annual projection of one bill-period comparison. Consumption-driven money scales with annual / billed consumption, the
// monthly fixed fees scale with 12 / months, and the one-off fee is paid once.
// Tony (1/11, Be Family Fast vs Casa Protetta): "perche la be family fast costa più della casa protetta, pur avendo una pcv
// più bassa?". The one-off 1,50 € of the first bill was multiplied with the consumption and ate the PCV saving of the year;
// the net fees are also brought to the VAT of the totals before being compared with them.
export interface AnnualSavingInput {
  /** Bill total minus offer total for the period, as the receipt shows it. */
  readonly savings: number;
  readonly currentTotal: number | null;
  /** Net charges billed per month (quota fissa and quota potenza: PCV, rete and oneri) of the bill and of the offer for the
   *  whole period: they are paid every month of the year, whatever the consumption. */
  readonly billFixed: number;
  readonly offerFixed: number;
  /** Net one-off fees the offer charges in this period. */
  readonly oneOff: number;
  /** 1 + VAT when the totals include taxes, else 1. */
  readonly vat: number;
  readonly months: number;
  /** Annual consumption / consumption of the period. */
  readonly factor: number;
}

export interface AnnualProjection {
  /** Annual saving: annual cost of the bill minus annual cost of the offer, one-off included once. */
  readonly saving: number;
  /** Annual cost of the current supply, or null without the bill total. */
  readonly current: number | null;
  /** The offer's one-off fees with their VAT, paid once in the year (never multiplied). */
  readonly oneOff: number;
  /** Annual saving without the one-off fees: what the offer saves on its recurring charges. */
  readonly recurringSaving: number;
}

// Tony (16/11/2026, "costi una tantum e risparmio annuo", 070789E with Be Smile 11.25): the one-off fee is paid once, on the
// first bill of the new supply; it is never spread over the consumption or multiplied by 12. The annual cost of each side is
// its monthly charges × 12 / months plus its consumption charges × annual / billed consumption (annual model from the
// consumption history, never a fixed × 12 of the bill). Taxes follow the money they are charged on.
export function annualSaving(input: AnnualSavingInput): AnnualProjection {
  const billFixed = input.billFixed * input.vat;
  const fixedSaving = billFixed - input.offerFixed * input.vat;
  const oneOff = input.oneOff * input.vat;
  const recurringSaving = (input.savings - fixedSaving + oneOff) * input.factor + fixedSaving / input.months * 12;
  const current = input.currentTotal === null ? null : (input.currentTotal - billFixed) * input.factor + billFixed / input.months * 12;
  return { saving: recurringSaving - oneOff, current, oneOff, recurringSaving };
}

/** Tony (1/11, "come scrivi risparmio e sotto costo in più sulla be smile flex"): a quote brought under the bill by the company
 *  discount keeps that saving on every bill of the year, so its annual saving is the same percentage of the annual cost and
 *  never a cost in più next to "Risparmio" on the same card. */
export function annualSavingUnderDiscount<T extends { readonly saving: number; readonly current: number | null; readonly oneOff?: number }>(projected: T, discounted: boolean, targetSavingPercent: number | null): T {
  if (!discounted || targetSavingPercent === null || projected.current === null) return projected;
  const saving = Math.round(projected.current * targetSavingPercent) / 100;
  return { ...projected, saving, ...("recurringSaving" in projected ? { recurringSaving: saving + (projected.oneOff ?? 0) } : {}) };
}

/**
 * Tony (16/11/2026, "costi una tantum e risparmio annuo"): the four amounts of a quote, kept apart and reconciled, the same on
 * screen (cards, scontrino, detail) and in the proposal PDF:
 * - the simulated cost of the period (the first bill of the new supply, one-off included);
 * - the one-off initial costs, with their VAT, due once;
 * - the comparable recurring monthly cost: the year's average month of each side, without one-off (annual / 12), or the
 *   period's recurring cost per month when the annual consumption is not determinable;
 * - the expected annual spend: recurring annual cost plus the one-off once.
 */
export interface QuoteCostSummary {
  readonly periodCurrent: number;
  readonly periodOffer: number;
  readonly periodSaving: number;
  readonly oneOff: { readonly net: number; readonly taxes: number; readonly total: number } | null;
  readonly periodOfferRecurring: number;
  readonly periodRecurringSaving: number;
  readonly monthly: { readonly current: number; readonly offer: number; readonly saving: number; readonly basis: "ANNUAL_AVERAGE" | "PERIOD" };
  readonly annual: { readonly current: number; readonly offerRecurring: number; readonly oneOff: number; readonly offer: number; readonly saving: number; readonly recurringSaving: number } | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function quoteCostSummary(receipt: { readonly currentTotal: number | null; readonly offerTotal: number | null; readonly oneOff?: { readonly net: number; readonly taxes: number; readonly total: number } | null }, months: number, projection: AnnualProjection | null): QuoteCostSummary | null {
  if (receipt.currentTotal === null || receipt.offerTotal === null || !(months > 0)) return null;
  const oneOff = receipt.oneOff ?? null;
  const periodOfferRecurring = round2(receipt.offerTotal - (oneOff?.total ?? 0));
  const annual = projection && projection.current !== null ? (() => {
    const current = round2(projection.current);
    const saving = round2(projection.saving);
    const offer = round2(current - saving);
    const oneOffAnnual = round2(oneOff?.total ?? 0);
    return { current, offerRecurring: round2(offer - oneOffAnnual), oneOff: oneOffAnnual, offer, saving, recurringSaving: round2(saving + oneOffAnnual) };
  })() : null;
  const monthly = annual
    ? { current: round2(annual.current / 12), offer: round2(annual.offerRecurring / 12), saving: round2(annual.recurringSaving / 12), basis: "ANNUAL_AVERAGE" as const }
    : { current: round2(receipt.currentTotal / months), offer: round2(periodOfferRecurring / months), saving: round2((receipt.currentTotal - periodOfferRecurring) / months), basis: "PERIOD" as const };
  return { periodCurrent: receipt.currentTotal, periodOffer: receipt.offerTotal, periodSaving: round2(receipt.currentTotal - receipt.offerTotal), oneOff, periodOfferRecurring, periodRecurringSaving: round2(receipt.currentTotal - periodOfferRecurring), monthly, annual };
}
