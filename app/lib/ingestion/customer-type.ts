import type { CustomerType } from "../energy/types";

type Read<T> = { readonly status: string; readonly value: T | null };
/** The part of a structured bill the customer type is read from; kept apart so the browser can use it too. */
export interface CustomerTypeEvidence {
  readonly customerType: Read<CustomerType>;
  readonly customerTaxIdentifier: Read<string>;
  readonly extendedFacts: readonly { readonly code: string; readonly value: unknown; readonly status: string }[];
}
const found = <T>(field: Read<T> | undefined): T | null => field?.status === "FOUND" ? field.value : null;

/** The bill's customer type, or what its supply characteristics state when the reading left it out: Tony (28/10, bolletta
 *  BPower Casa Protetta) "Tipologia cliente: Domestico non residente" was refused as neither Consumer nor Business. */
export function customerTypeOf(extraction: CustomerTypeEvidence): CustomerType | null {
  const read = found(extraction.customerType);
  if (read) return read;
  const text = extraction.extendedFacts.filter((fact) => fact.status === "FOUND" && /SUPPLY_USE|DOMESTIC_RESIDENCE|TARIFF_CATEGORY|CUSTOMER/.test(fact.code)).map((fact) => String(fact.value ?? "")).join(" ");
  if (/non\s+domestic|altri\s+usi|illuminazione\s+pubblica|\bBTA\d?\b|business/i.test(text)) return "NON_RESIDENTIAL";
  if (/domestic|residente|\bD[23]\b|\bTD\b/i.test(text)) return "RESIDENTIAL";
  // Last resort, the holder's tax code: a VAT number is a business, a personal codice fiscale alone a household.
  const tax = String(found(extraction.customerTaxIdentifier) ?? "").replace(/\s/g, "").toUpperCase().replace(/^IT/, "");
  if (/^\d{11}$/.test(tax)) return "NON_RESIDENTIAL";
  if (/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(tax)) return "RESIDENTIAL";
  return null;
}
