// Annual projection of one bill-period comparison. Consumption-driven money scales with annual / billed consumption, the
// monthly fixed fees scale with 12 / months, and the one-off fee is paid once.
// Tony (1/11, Be Family Fast vs Casa Protetta): "perche la be family fast costa più della casa protetta, pur avendo una pcv
// più bassa?". The one-off 1,50 € of the first bill was multiplied with the consumption and ate the PCV saving of the year;
// the net fees are also brought to the VAT of the totals before being compared with them.
export interface AnnualSavingInput {
  /** Bill total minus offer total for the period, as the receipt shows it. */
  readonly savings: number;
  readonly currentTotal: number | null;
  /** Net fixed fees (PCV) of the bill and of the offer for the whole period. */
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

export function annualSaving(input: AnnualSavingInput): { readonly saving: number; readonly current: number | null } {
  const billFixed = input.billFixed * input.vat;
  const fixedSaving = billFixed - input.offerFixed * input.vat;
  const oneOff = input.oneOff * input.vat;
  const saving = (input.savings - fixedSaving + oneOff) * input.factor + fixedSaving / input.months * 12 - oneOff;
  const current = input.currentTotal === null ? null : (input.currentTotal - billFixed) * input.factor + billFixed / input.months * 12;
  return { saving, current };
}
