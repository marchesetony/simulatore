const normalizedOffer = (value: string | null | undefined): string => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** The bill was issued with the simulated CTE: same supplier and same offer code (or the CTE's code inside the bill's offer). */
export function isSameOffer(input: { readonly billSupplier: string | null; readonly billOffer: string | null; readonly offerSupplier: string | null; readonly offerCode: string | null; readonly offerName: string | null }): boolean {
  const supplier = (value: string | null) => normalizedOffer(value).replace(/(SPA|SRL)$/, "").replace(/ENERGIA$/, "");
  if (!supplier(input.billSupplier) || supplier(input.billSupplier) !== supplier(input.offerSupplier)) return false;
  const bill = normalizedOffer(input.billOffer);
  if (bill === "") return false;
  if ([input.offerCode, input.offerName].some((value) => { const offer = normalizedOffer(value); return offer.length >= 4 && (bill === offer || bill.includes(offer) || offer.includes(bill)); })) return true;
  // Tony (31/10, scelta "Versioni diverse"): 003888ESVFL01XXXXXXXCASAPROTETTA and 003888ESVFL02XXXXXXXCASAPROTETTA are two
  // versions of BE Family CASA PROTETTA with different formulas in the Box dell'offerta (01: PUN + spread + dispacciamento +
  // capacità + commercializzazione + sbilanciamento; 02: PUN + 0,03 + CDISPD), each bill matching its own. A CTE whose code is
  // known and differs from the bill's code, even only in the version digits, is another CTE. The commercial name decides only
  // when the CTE has no code.
  const tail = (value: string | null) => { const code = normalizedOffer(value); const match = /X{3,}([A-Z0-9]{6,})$/.exec(code); return match ? match[1] : null; };
  const billTail = tail(input.billOffer);
  if (!billTail || normalizedOffer(input.offerCode).length >= 4) return false;
  return normalizedOffer(input.offerName).endsWith(billTail);
}

/** A one-off fee the bill itself charges (first bill of the contract). */
export const ONE_OFF_BILL_LINE = /una\s*tantum|attivazion|contributo\s+(?:di\s+)?(?:allaccio|ingresso|adesione)/i;
