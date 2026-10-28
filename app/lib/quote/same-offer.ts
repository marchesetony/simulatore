const normalizedOffer = (value: string | null | undefined): string => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** The bill was issued with the simulated CTE: same supplier and same offer code (or the CTE's code inside the bill's offer). */
export function isSameOffer(input: { readonly billSupplier: string | null; readonly billOffer: string | null; readonly offerSupplier: string | null; readonly offerCode: string | null; readonly offerName: string | null }): boolean {
  const supplier = (value: string | null) => normalizedOffer(value).replace(/(SPA|SRL)$/, "").replace(/ENERGIA$/, "");
  if (!supplier(input.billSupplier) || supplier(input.billSupplier) !== supplier(input.offerSupplier)) return false;
  const bill = normalizedOffer(input.billOffer);
  return bill !== "" && [input.offerCode, input.offerName].some((value) => { const offer = normalizedOffer(value); return offer.length >= 4 && (bill === offer || bill.includes(offer) || offer.includes(bill)); });
}

/** A one-off fee the bill itself charges (first bill of the contract). */
export const ONE_OFF_BILL_LINE = /una\s*tantum|attivazion|contributo\s+(?:di\s+)?(?:allaccio|ingresso|adesione)/i;
