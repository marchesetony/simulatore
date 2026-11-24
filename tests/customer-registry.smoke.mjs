import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCustomerRegistry, customerBillFact, searchCustomers } from "../app/lib/foundation/customer-registry.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";

// Tony (24/11/2026, "COMPLETAMENTO APPLICAZIONE"): anagrafica cliente e POD built only from the bills already read,
// separated by company, never grouped by name alone, disagreements shown and never resolved. Synthetic data only.

const A = "tenant_a"; const B = "tenant_b";
const fact = (billId, over = {}) => ({ billId, tenantId: A, customerName: null, taxIdentifier: null, customerType: null, vector: "EE", supplyReference: null, supplyAddress: null, supplier: null, periodEnd: null, approved: false, ...over });

// 1. Grouped by codice fiscale / partita IVA; supplies by POD; last period and counts from the bills.
const facts = [
  fact("b1", { customerName: "Rossi Mario", taxIdentifier: "RSSMRA80A01H501U", customerType: "RESIDENTIAL", supplyReference: "IT001E00000001", supplyAddress: "Via Roma 1, 00100 Roma (RM)", supplier: "Fornitore X", periodEnd: "2026-08-31", approved: true }),
  fact("b2", { customerName: "ROSSI MARIO", taxIdentifier: "RSSMRA80A01H501U", supplyReference: "IT001E00000001", supplyAddress: "via roma 1, 00100 roma (rm)", periodEnd: "2026-09-30" }),
  fact("b3", { customerName: "Rossi Mario", taxIdentifier: "RSSMRA80A01H501U", vector: "GAS", supplyReference: "00880000000001", periodEnd: "2026-07-31" }),
];
let registry = buildCustomerRegistry(A, facts);
assert.equal(registry.customers.length, 1); assert.equal(registry.billCount, 3);
let rossi = registry.customers[0];
assert.equal(rossi.identification, "TAX_ID"); assert.deepEqual(rossi.names, ["Rossi Mario"], "same name in different case is one name");
assert.deepEqual(rossi.supplies.map((s) => [s.vector, s.reference, s.billIds.length, s.lastPeriodEnd]), [["GAS", "00880000000001", 1, "2026-07-31"], ["EE", "IT001E00000001", 2, "2026-09-30"]]);
assert.deepEqual(rossi.supplies[1].addresses, ["Via Roma 1, 00100 Roma (RM)"], "same address in different case is one address");
assert.equal(rossi.approvedBillCount, 1); assert.deepEqual(rossi.notes, []);
console.log("CUSTOMER_GROUPED_BY_TAX_ID=PASS");

// 2. Never by name alone: same name, different codes = two customers; no code, no POD = the bill alone.
registry = buildCustomerRegistry(A, [...facts, fact("b4", { customerName: "Rossi Mario", taxIdentifier: "RSSMRA90B02F205X", supplyReference: "IT001E00000009" }), fact("b5", { customerName: "Rossi Mario" })]);
assert.equal(registry.customers.length, 3, "homonyms are not merged");
const alone = registry.customers.find((c) => c.identification === "BILL_ONLY");
assert.ok(alone && alone.supplies[0].reference === null && /resta da sola/.test(alone.notes.join(" ")));
console.log("NEVER_GROUPED_BY_NAME=PASS");

// 3. A bill without the code joins a customer only through a POD of exactly one customer; otherwise it stays unidentified.
registry = buildCustomerRegistry(A, [...facts, fact("b6", { customerName: "Rossi M.", supplyReference: "IT001E00000001" }), fact("b7", { customerName: "Neri Srl", supplyReference: "IT001E00000077" })]);
rossi = registry.customers.find((c) => c.taxIdentifier === "RSSMRA80A01H501U");
assert.equal(rossi.billCount, 4); assert.deepEqual(rossi.names, ["Rossi Mario", "Rossi M."]);
assert.match(rossi.notes.join(" "), /collegate tramite il POD/); assert.match(rossi.notes.join(" "), /Nomi diversi/);
const neri = registry.customers.find((c) => c.names[0] === "Neri Srl");
assert.equal(neri.identification, "SUPPLY_ONLY"); assert.equal(neri.taxIdentifier, null, "no code invented");
console.log("JOINED_ONLY_BY_UNAMBIGUOUS_POD=PASS");

// 4. Disagreements shown: a POD under two codes (change of holder), different addresses for one POD; an unlinked bill on that POD stays apart.
registry = buildCustomerRegistry(A, [
  fact("c1", { customerName: "Alfa Srl", taxIdentifier: "01234567890", supplyReference: "IT001E00000050", supplyAddress: "Via A 1" }),
  fact("c2", { customerName: "Beta Srl", taxIdentifier: "09876543210", supplyReference: "IT001E00000050", supplyAddress: "Via B 2" }),
  fact("c3", { customerName: "?", supplyReference: "IT001E00000050" }),
  fact("c4", { customerName: "Alfa Srl", taxIdentifier: "01234567890", supplyReference: "IT001E00000051", supplyAddress: "Via A 1" }),
  fact("c5", { customerName: "Alfa Srl", taxIdentifier: "01234567890", supplyReference: "IT001E00000051", supplyAddress: "Via A 3" }),
]);
const alfa = registry.customers.find((c) => c.taxIdentifier === "01234567890");
assert.ok(alfa.supplies.find((s) => s.reference === "IT001E00000050").sharedWithOtherCustomer);
assert.deepEqual(alfa.supplies.find((s) => s.reference === "IT001E00000051").addresses, ["Via A 1", "Via A 3"]);
assert.match(alfa.notes.join(" "), /altro codice fiscale/); assert.match(alfa.notes.join(" "), /Indirizzi di fornitura diversi/);
assert.equal(registry.customers.find((c) => c.key === "supply:IT001E00000050")?.billCount, 1, "ambiguous POD: the bill is not assigned to either customer");
console.log("DISAGREEMENTS_SHOWN_NOT_RESOLVED=PASS");

// 5. Company isolation: facts of another company are never in the registry.
registry = buildCustomerRegistry(A, [...facts, fact("x1", { tenantId: B, customerName: "Altra azienda", taxIdentifier: "RSSMRA80A01H501U", supplyReference: "IT001E00000001" })]);
assert.equal(registry.billCount, 3); assert.ok(!registry.customers.some((c) => c.supplies.some((s) => s.billIds.includes("x1"))));
assert.deepEqual(buildCustomerRegistry(B, facts).customers, []);
// Since the persistent registry (24/11/2026) the route reads through app/lib/customers/registry.ts, which keeps the filter.
const registrySource = await readFile(new URL("../app/lib/customers/registry.ts", import.meta.url), "utf8");
assert.match(registrySource, /ownBills\.filter\(\(bill\) => billInScope\(bill, context\.scope\)\)/, "company and branch filter on the bills");
assert.match(registrySource, /record\.tenantId === tenantId && record\.payload\?\.tenantId === tenantId/, "records of the user's company only");
console.log("COMPANY_ISOLATION=PASS");

// 6. Search by name, code, POD typed with spaces, address.
registry = buildCustomerRegistry(A, [...facts, fact("b7", { customerName: "Neri Srl", supplyReference: "IT001E00000077" })]);
const names = (query) => searchCustomers(registry.customers, query).map((c) => c.names[0]);
assert.deepEqual(names("neri"), ["Neri Srl"]); assert.deepEqual(names("rssmra80"), ["Rossi Mario"]);
assert.deepEqual(names("IT001E 0000 0077"), ["Neri Srl"]); assert.deepEqual(names("via roma"), ["Rossi Mario"]); assert.equal(names("").length, 2);
console.log("CUSTOMER_SEARCH=PASS");

// 7. From a stored bill: read values only, nothing invented for what was not read; the company of the bill is kept.
const root = await mkdtemp(path.join(os.tmpdir(), "customer-registry-"));
try {
  const repository = new LocalBillRepository(root); const storage = new LocalDocumentStorage(root);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 customer-registry", "latin1"));
  const stored = await ingestBill({ tenantId: A, fileName: "prova.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { return { text: "Supplier: Fornitore Prova; POD: it001e12345678; Customer: Cliente Prova; Periodo: 01/08/2026 - 31/08/2026; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20", pages: 1 }; } } });
  const read = customerBillFact(stored);
  assert.equal(read.tenantId, A); assert.equal(read.billId, stored.id);
  assert.equal(read.supplyReference, "IT001E12345678");
  assert.equal(read.taxIdentifier, null, "not read: null"); assert.equal(read.supplyAddress, null, "not read: null");
  const failed = await ingestBill({ tenantId: A, fileName: "vuota.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository, audit: { async record() {} }, extractor: { async extract() { throw new Error("BILL_EXTRACTION_REQUIRED_FIELD_MISSING"); } } });
  const unread = customerBillFact(failed);
  assert.equal(unread.taxIdentifier, null); assert.equal(unread.supplyAddress, null);
  assert.equal(buildCustomerRegistry(A, [read, unread]).billCount, 2, "a bill read badly is still counted, never dropped");
  console.log("FACTS_FROM_STORED_BILL=PASS");
} finally { await rm(root, { recursive: true, force: true }); }
