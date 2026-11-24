// Tony (24/11/2026, "COMPLETAMENTO APPLICAZIONE"): the anagrafica cliente e POD as the screen and the server share it. The
// facts come from the bills only (app/lib/foundation/customer-registry.ts); this file groups and searches them.

export type CustomerIdentification = "TAX_ID" | "SUPPLY_ONLY" | "BILL_ONLY";

export interface CustomerBillFact {
  readonly billId: string;
  readonly tenantId: string;
  readonly customerName: string | null;
  readonly taxIdentifier: string | null;
  readonly customerType: "RESIDENTIAL" | "NON_RESIDENTIAL" | null;
  readonly vector: "EE" | "GAS" | null;
  /** POD for electricity, PDR for gas, as read (spaces removed, upper case). */
  readonly supplyReference: string | null;
  readonly supplyAddress: string | null;
  readonly supplier: string | null;
  readonly periodEnd: string | null;
  readonly approved: boolean;
}

export interface CustomerSupply {
  readonly reference: string | null;
  readonly vector: "EE" | "GAS" | null;
  /** Every distinct address read for this supply; more than one is shown as a disagreement. */
  readonly addresses: readonly string[];
  readonly suppliers: readonly string[];
  readonly billIds: readonly string[];
  readonly lastPeriodEnd: string | null;
  /** Also read under another customer's codice fiscale / partita IVA. */
  readonly sharedWithOtherCustomer: boolean;
}

export interface CustomerEntry {
  readonly key: string;
  readonly identification: CustomerIdentification;
  readonly taxIdentifier: string | null;
  /** Every distinct name read; more than one is shown as a disagreement. */
  readonly names: readonly string[];
  readonly customerTypes: readonly ("RESIDENTIAL" | "NON_RESIDENTIAL")[];
  readonly supplies: readonly CustomerSupply[];
  readonly billCount: number;
  readonly approvedBillCount: number;
  readonly notes: readonly string[];
}

export interface CustomerRegistry {
  readonly customers: readonly CustomerEntry[];
  readonly billCount: number;
}

const distinct = <T,>(values: readonly (T | null)[]): T[] => [...new Set(values.filter((value): value is T => value !== null))];
const sameText = (values: readonly string[]): string[] => {
  const seen = new Map<string, string>();
  for (const value of values) { const key = value.toLocaleLowerCase("it"); if (!seen.has(key)) seen.set(key, value); }
  return [...seen.values()];
};

/** The registry of one company from its bills' facts. Facts of another tenant are ignored. */
export function buildCustomerRegistry(tenantId: string, facts: readonly CustomerBillFact[]): CustomerRegistry {
  const own = facts.filter((fact) => fact.tenantId === tenantId);
  const taxIdsBySupply = new Map<string, Set<string>>();
  for (const fact of own) if (fact.taxIdentifier && fact.supplyReference) taxIdsBySupply.set(fact.supplyReference, (taxIdsBySupply.get(fact.supplyReference) ?? new Set()).add(fact.taxIdentifier));

  const groups = new Map<string, { identification: CustomerIdentification; taxIdentifier: string | null; facts: CustomerBillFact[] }>();
  const add = (key: string, identification: CustomerIdentification, taxIdentifier: string | null, fact: CustomerBillFact) => {
    const group = groups.get(key) ?? { identification, taxIdentifier, facts: [] };
    group.facts.push(fact);
    groups.set(key, group);
  };
  for (const fact of own) {
    if (fact.taxIdentifier) { add(`tax:${fact.taxIdentifier}`, "TAX_ID", fact.taxIdentifier, fact); continue; }
    const owners = fact.supplyReference ? taxIdsBySupply.get(fact.supplyReference) : undefined;
    if (owners && owners.size === 1) { const only = [...owners][0]; add(`tax:${only}`, "TAX_ID", only, fact); continue; }
    if (fact.supplyReference) { add(`supply:${fact.supplyReference}`, "SUPPLY_ONLY", null, fact); continue; }
    add(`bill:${fact.billId}`, "BILL_ONLY", null, fact);
  }

  const customers = [...groups.entries()].map(([key, group]): CustomerEntry => {
    const bySupply = new Map<string, CustomerBillFact[]>();
    for (const fact of group.facts) { const supplyKey = fact.supplyReference ?? `bill:${fact.billId}`; bySupply.set(supplyKey, [...(bySupply.get(supplyKey) ?? []), fact]); }
    const supplies = [...bySupply.values()].map((items): CustomerSupply => {
      const reference = items[0].supplyReference;
      const ends = distinct(items.map((item) => item.periodEnd)).sort();
      return {
        reference,
        vector: distinct(items.map((item) => item.vector))[0] ?? null,
        addresses: sameText(distinct(items.map((item) => item.supplyAddress))),
        suppliers: sameText(distinct(items.map((item) => item.supplier))),
        billIds: items.map((item) => item.billId),
        lastPeriodEnd: ends.at(-1) ?? null,
        sharedWithOtherCustomer: reference ? (taxIdsBySupply.get(reference)?.size ?? 0) > 1 : false,
      };
    }).sort((a, b) => (a.reference ?? "￿").localeCompare(b.reference ?? "￿"));
    const names = sameText(distinct(group.facts.map((fact) => fact.customerName)));
    const notes: string[] = [];
    if (group.identification === "SUPPLY_ONLY") notes.push("Codice fiscale o partita IVA non letto: le bollette sono raggruppate per POD/PDR.");
    if (group.identification === "BILL_ONLY") notes.push("Né codice fiscale/partita IVA né POD/PDR letti: la bolletta resta da sola.");
    if (group.facts.some((fact) => !fact.taxIdentifier) && group.taxIdentifier) notes.push("Alcune bollette non riportano il codice fiscale o la partita IVA: sono collegate tramite il POD/PDR.");
    if (names.length > 1) notes.push("Nomi diversi letti per lo stesso cliente: verificare.");
    if (supplies.some((supply) => supply.addresses.length > 1)) notes.push("Indirizzi di fornitura diversi letti per lo stesso POD/PDR: verificare.");
    if (supplies.some((supply) => supply.sharedWithOtherCustomer)) notes.push("Un POD/PDR compare anche sotto un altro codice fiscale o partita IVA (es. cambio di intestatario): verificare.");
    return {
      key,
      identification: group.identification,
      taxIdentifier: group.taxIdentifier,
      names,
      customerTypes: distinct(group.facts.map((fact) => fact.customerType)),
      supplies,
      billCount: group.facts.length,
      approvedBillCount: group.facts.filter((fact) => fact.approved).length,
      notes,
    };
  }).sort((a, b) => (a.names[0] ?? "￿").localeCompare(b.names[0] ?? "￿", "it", { sensitivity: "base" }) || a.key.localeCompare(b.key));

  return { customers, billCount: own.length };
}

/** Customers matching every word typed (name, codice fiscale/partita IVA, POD/PDR with or without spaces, address). */
export function searchCustomers(customers: readonly CustomerEntry[], query: string): readonly CustomerEntry[] {
  const words = query.toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
  if (!words.length) return customers;
  return customers.filter((customer) => {
    const haystack = [...customer.names, customer.taxIdentifier ?? "", ...customer.supplies.flatMap((supply) => [supply.reference ?? "", ...supply.addresses, ...supply.suppliers])].join(" ").toLocaleLowerCase("it");
    const compact = haystack.replace(/\s+/g, "");
    return words.every((word) => haystack.includes(word)) || compact.includes(words.join(""));
  });
}
