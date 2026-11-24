import type { BillDocument, PublicBillDocument } from "./real-bill.ts";
import type { CustomerBillFact } from "../ui/customer-registry";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toPublicApprovedDocument, toPublicDocument } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
export { buildCustomerRegistry, searchCustomers } from "../ui/customer-registry.ts";
export type { CustomerBillFact, CustomerEntry, CustomerIdentification, CustomerRegistry, CustomerSupply } from "../ui/customer-registry";

/**
 * Tony (24/11/2026, "COMPLETAMENTO APPLICAZIONE"): anagrafica cliente e POD. It is built only from what was read in the
 * company's bills (intestatario, codice fiscale o partita IVA, POD/PDR, indirizzo di fornitura): nothing is typed in, guessed
 * or saved apart, so it can never disagree with the bills it comes from. The caller passes only the bills the user may see
 * (company and commercial branch); a bill of another company is dropped here too.
 *
 * Grouping, never by name alone:
 * - a customer is identified by the codice fiscale / partita IVA read on its bills;
 * - a bill without it joins a customer only when its POD/PDR belongs to exactly one identified customer;
 * - otherwise it stays under "cliente non identificato" for that POD/PDR (or for the bill alone when nothing is read).
 * Disagreements (different names for the same code, different addresses for the same POD, one POD under two codes) are
 * shown as they are, never resolved by choosing one.
 */

function text(value: unknown): string | null { const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""; return trimmed ? trimmed : null; }
function code(value: unknown): string | null { const compact = typeof value === "string" ? value.replace(/[\s.-]+/g, "").toUpperCase() : ""; return compact ? compact : null; }
/** Partita IVA printed with the country prefix is the same identifier: IT01234567890 = 01234567890. */
function taxCode(value: unknown): string | null { const compact = code(value); return compact && /^IT\d{11}$/.test(compact) ? compact.slice(2) : compact; }

function publicView(document: BillDocument): PublicBillDocument | null {
  try { return (document.currentApprovedVersionId ? toPublicApprovedDocument(document) : null) ?? toPublicDocument(document); } catch { return null; }
}

function addressOf(view: PublicBillDocument): string | null {
  const supply = view.analystReview?.supply;
  if (!supply) return null;
  const street = text(supply.address?.value);
  const town = [text(supply.cap?.value), text(supply.city?.value), text(supply.province?.value) ? `(${text(supply.province?.value)})` : null].filter(Boolean).join(" ");
  if (!street) return town || null;
  // The town is added only when the address as read does not already end with it.
  return town && !street.toLocaleLowerCase("it").includes((text(supply.city?.value) ?? "\u0000").toLocaleLowerCase("it")) ? `${street}, ${town}` : street;
}

/** What one bill says about its customer and supply: read values only, null where nothing was read. */
export function customerBillFact(document: BillDocument): CustomerBillFact {
  const view = publicView(document);
  const review = view?.analystReview;
  const normalized = view?.normalized ?? null;
  const vectorRead = review?.supply.vector.value;
  const vector = vectorRead === "EE" || vectorRead === "GAS" ? vectorRead : null;
  const reference = vector === "GAS" ? code(review?.supply.pdr.value) : code(review?.supply.pod.value) ?? code(normalized?.supply.reference) ?? code(view?.fields.pod?.value);
  const type = review?.customer.type.value;
  return {
    billId: document.id,
    tenantId: document.tenantId,
    customerName: text(review?.customer.name.value) ?? text(normalized?.customer.name) ?? text(view?.fields.customerName?.value),
    taxIdentifier: taxCode(review?.customer.taxIdentifier.value) ?? taxCode(normalized?.customer.taxIdentifiers?.[0]?.value),
    customerType: type === "RESIDENTIAL" || type === "NON_RESIDENTIAL" ? type : null,
    vector,
    supplyReference: reference,
    supplyAddress: view ? addressOf(view) : null,
    supplier: text(normalized?.currentSupplier) ?? text(review?.supply.supplier.value) ?? text(view?.fields.supplier?.value),
    periodEnd: text(normalized?.billingPeriod.periodEnd) ?? text(review?.dates.billingPeriodEnd.value),
    approved: Boolean(document.currentApprovedVersionId),
  };
}
