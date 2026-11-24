// Tony (24/11/2026, "FASE 2: ANAGRAFICA CLIENTI E POD"): the persistent customer registry as the screen and the server share it.
// Customers, supplies (POD/PDR) and bill links are three record kinds of the company (tenant); nothing here is computed from
// prices or offers, and the bills themselves are never changed: a link is its own record.

export type CustomerKind = "PERSON" | "COMPANY";
export type CustomerCategory = "RESIDENTIAL" | "NON_RESIDENTIAL";

export interface FieldChange { readonly from: unknown; readonly to: unknown }
export interface RegistryChange {
  readonly at: string;
  readonly by: string;
  readonly action: string;
  readonly changes: Readonly<Record<string, FieldChange>>;
  readonly reason: string | null;
}

export interface CustomerContacts { readonly email: string | null; readonly phone: string | null; readonly postalAddress: string | null }

export interface CustomerRecord {
  readonly customerId: string;
  readonly tenantId: string;
  readonly kind: CustomerKind;
  /** Ragione sociale or nominativo. */
  readonly name: string;
  readonly taxCode: string | null;
  readonly vatNumber: string | null;
  readonly category: CustomerCategory | null;
  readonly contacts: CustomerContacts;
  /** Who registered the customer: the agent's commercial perimeter. */
  readonly ownerUserId: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly history: readonly RegistryChange[];
}

export interface SupplyTechnical { readonly voltageLevel: string | null; readonly powerKw: number | null; readonly annualConsumption: number | null; readonly distributor: string | null }

/** One holder of the supply for a period: a change of holder closes the current one and opens a new one, never overwriting. */
export interface SupplyHolder {
  readonly customerId: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly reason: string | null;
}

export interface SupplyRecord {
  readonly supplyId: string;
  readonly tenantId: string;
  readonly vector: "EE" | "GAS";
  /** POD (EE) or PDR (GAS), spaces removed, upper case. */
  readonly reference: string;
  readonly address: string | null;
  readonly technical: SupplyTechnical;
  readonly holders: readonly SupplyHolder[];
  readonly ownerUserId: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly history: readonly RegistryChange[];
}

export interface BillLinkRecord {
  readonly billId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly supplyId: string;
  readonly linkedAt: string;
  readonly linkedBy: string;
  readonly history: readonly RegistryChange[];
}

export type AnomalyCode = "MISSING_TAX_ID" | "SUPPLY_WITHOUT_HOLDER" | "SUPPLY_DIFFERENT_HOLDERS" | "ADDRESS_MISMATCH" | "POSSIBLE_DUPLICATE" | "BILL_NOT_LINKED";
export interface RegistryAnomaly {
  readonly code: AnomalyCode;
  readonly message: string;
  readonly customerIds: readonly string[];
  readonly supplyIds: readonly string[];
  readonly billIds: readonly string[];
}

/** What a bill says, as read: shown to suggest a link or a new customer, never applied by itself. */
export interface BillReadSummary {
  readonly billId: string;
  readonly customerName: string | null;
  readonly taxIdentifier: string | null;
  readonly customerType: CustomerCategory | null;
  readonly vector: "EE" | "GAS" | null;
  readonly supplyReference: string | null;
  readonly supplyAddress: string | null;
  readonly supplier: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly linked: { readonly customerId: string; readonly supplyId: string } | null;
  /** Existing customers whose codice fiscale / partita IVA or POD matches what was read: a suggestion, never a merge. */
  readonly suggestedCustomerIds: readonly string[];
}

export interface SimulationLink { readonly comparisonId: string; readonly billId: string; readonly supplyId: string; readonly calculatedAt: string | null }
export interface ProposalLink { readonly proposalId: string; readonly billId: string; readonly supplyId: string }

export interface CustomerView {
  readonly customer: CustomerRecord;
  readonly supplies: readonly (SupplyRecord & { readonly current: boolean })[];
  readonly billIds: readonly string[];
  readonly simulations: readonly SimulationLink[];
  readonly proposals: readonly ProposalLink[];
  readonly canEdit: boolean;
}

export interface RegistryView {
  readonly customers: readonly CustomerView[];
  /** Supplies visible to the user that have no current holder. */
  readonly orphanSupplies: readonly SupplyRecord[];
  readonly bills: readonly BillReadSummary[];
  readonly anomalies: readonly RegistryAnomaly[];
  readonly canCreate: boolean;
}

export const CUSTOMER_KIND_LABEL: Readonly<Record<CustomerKind, string>> = { PERSON: "Persona fisica", COMPANY: "Persona giuridica" };
export const CUSTOMER_CATEGORY_LABEL: Readonly<Record<CustomerCategory, string>> = { RESIDENTIAL: "Domestico", NON_RESIDENTIAL: "Altri usi" };

/** Customers matching every word typed: name, codice fiscale, partita IVA, POD/PDR (with or without spaces), address. */
export function searchCustomerViews(views: readonly CustomerView[], query: string): readonly CustomerView[] {
  const words = query.toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
  if (!words.length) return views;
  return views.filter((view) => {
    const haystack = [view.customer.name, view.customer.taxCode ?? "", view.customer.vatNumber ?? "", view.customer.contacts.email ?? "", ...view.supplies.flatMap((supply) => [supply.reference, supply.address ?? ""])].join(" ").toLocaleLowerCase("it");
    const compact = haystack.replace(/\s+/g, "");
    return words.every((word) => haystack.includes(word)) || compact.includes(words.join(""));
  });
}
