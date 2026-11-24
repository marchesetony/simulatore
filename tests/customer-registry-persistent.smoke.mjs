import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addSupply, changeHolder, createCustomer, createFromBill, linkBill, registryView, updateCustomer, updateSupply } from "../app/lib/customers/registry.ts";
import { runRegistryAction } from "../app/lib/customers/http.ts";
import { searchCustomerViews } from "../app/lib/customers/model.ts";
import { ingestBill, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";

// Tony (24/11/2026, "FASE 2: ANAGRAFICA CLIENTI E POD"): persistent customer registry. Customer card, one or more POD per
// customer, bills linked without changing them, simulations reached through the bill, changes by authorised roles only,
// company and agent perimeter, anomalies shown and never merged, change of holder keeping the history. Synthetic data only.

const A = "tenant_azienda-a"; const B = "tenant_azienda-b";
const root = await mkdtemp(path.join(os.tmpdir(), "customer-registry-persistent-"));
try {
  const local = new LocalFilesystemAdapter(root);
  const billRepository = new LocalBillRepository(root); const storage = new LocalDocumentStorage(root);
  const comparisons = []; const proposals = [];
  const repositories = { customers: local.collection("customers"), customerSupplies: local.collection("customer-supplies"), customerBillLinks: local.collection("customer-bill-links"), billRepository, comparisonResults: { async list(tenantId) { return comparisons.filter((r) => r.tenantId === tenantId); } }, proposals: { async list(tenantId) { return proposals.filter((r) => r.tenantId === tenantId); } } };
  const audits = [];
  let clock = 0;
  const principal = (userId, role, tenantId = A) => ({ userId, tenantId, role, sessionId: `s-${userId}`, issuedAt: "2026-11-24T00:00:00.000Z", expiresAt: "2026-11-25T00:00:00.000Z", source: "LOCAL_SYNTHETIC" });
  // Admin: the whole company. Director: the branch (himself and his agents). Agent: himself only.
  const scopes = { admin: { role: "SUPER_ADMIN", owners: [] }, direttore: { role: "ADMIN", owners: ["direttore", "agente1"] }, agente1: { role: "AGENT", owners: ["agente1"] }, agente2: { role: "AGENT", owners: ["agente2"] }, adminB: { role: "SUPER_ADMIN", owners: [] } };
  const roles = { admin: "ADMIN", direttore: "ANALYST", agente1: "VIEWER", agente2: "VIEWER", adminB: "ADMIN" };
  const as = (userId) => {
    const tenantId = userId === "adminB" ? B : A;
    return { principal: principal(userId, roles[userId], tenantId), scope: { tenantId, userId, role: scopes[userId].role, ownerUserIds: new Set([userId, ...scopes[userId].owners]), groupIds: new Set() }, repositories, now: () => new Date(Date.UTC(2026, 10, 24, 12, 0, clock++)).toISOString(), audit: async (event) => { audits.push({ userId, ...event }); } };
  };
  const pdf = new Uint8Array(Buffer.from("%PDF-1.7 customer-registry-persistent", "latin1"));
  // A bill as the reader stores it (structured reading on the current version); values are synthetic.
  const found = (value) => ({ value, status: "FOUND", confidence: 0.9, source: "DOCUMENT_AI" });
  const none = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
  const reading = ({ customer, pod, cf, address }) => ({ schemaVersion: 1, vector: found("EE"), supplier: found("Fornitore Prova"), customerName: found(customer), customerId: none(), customerType: found("RESIDENTIAL"), customerTaxIdentifier: found(cf), billingPeriod: found({ from: "2026-08-01", to: "2026-08-31", raw: "01/08/2026 - 31/08/2026" }), totalAmount: found(50), annualConsumption: found(1200), billedConsumption: found(100), pod: found(pod), pdr: none(), voltageLevel: found("LV"), powerKw: found(3), f1Consumption: none(), f2Consumption: none(), f3Consumption: none(), smcConsumption: none(), conversionCoefficient: none(), pcs: none(), offerName: none(), offerCode: none(), extendedFacts: address ? [{ code: "SUPPLY_ADDRESS", value: address, status: "FOUND" }] : [], economicChargeLines: [], analystExtractionStatus: "NOT_RUN" });
  const seedBill = async (ownerUserId, read, tenantId = A) => {
    const document = await ingestBill({ tenantId, fileName: "prova.pdf", contentType: "application/pdf", bytes: pdf, maxBytes: 100_000, storage, repository: billRepository, audit: { async record() {} }, extractor: { async extract() { return { text: `Supplier: Fornitore Prova; POD: ${read.pod}; Customer: ${read.customer}; Periodo: 01/08/2026 - 31/08/2026; Consumo annuo: 1200; Consumo fatturato: 100; Totale da pagare: 50`, pages: 1 }; } } });
    const owned = { ...document, ownerUserId, versions: document.versions.map((version) => version.versionId === document.currentVersionId ? { ...version, structuredBill: reading(read) } : version) };
    await billRepository.save(owned); return owned;
  };
  const billText = (customer, pod, cf, address = null) => ({ customer, pod, cf, address });
  const code = async (promise) => { try { await promise; return "OK"; } catch (error) { return error.message; } };

  // 1. Creation: customer card with the data typed; identifiers validated and normalised; audit and history written.
  const rossi = await createCustomer(as("agente1"), { kind: "PERSON", name: "  Mario   Rossi ", taxCode: "rssmra80a01h501u", category: "RESIDENTIAL", contacts: { email: "mario@example.com", phone: "+39 333 1234567", postalAddress: null } });
  assert.equal(rossi.name, "Mario Rossi"); assert.equal(rossi.taxCode, "RSSMRA80A01H501U"); assert.equal(rossi.vatNumber, null, "nothing invented"); assert.equal(rossi.ownerUserId, "agente1");
  assert.equal(rossi.history[0].action, "CREATED"); assert.ok(audits.some((a) => a.action === "CUSTOMER_CREATED" && a.resourceId === rossi.customerId));
  assert.equal(await code(createCustomer(as("agente1"), { kind: "PERSON", name: "X", taxCode: "ABC" })), "CUSTOMER_TAX_CODE_INVALID");
  assert.equal(await code(createCustomer(as("direttore"), { kind: "PERSON", name: "Mario Rossi bis", taxCode: "RSSMRA80A01H501U" })), "CUSTOMER_ALREADY_REGISTERED", "same codice fiscale: never a second record, never a merge");
  const alfa = await createCustomer(as("direttore"), { kind: "COMPANY", name: "Alfa Srl", vatNumber: "IT01234567890", category: "NON_RESIDENTIAL" });
  assert.equal(alfa.vatNumber, "01234567890");
  console.log("CUSTOMER_CREATED=PASS");

  // 2. POD: one or more per customer, validated, unique in the company; technical data only as typed.
  const pod1 = await addSupply(as("agente1"), rossi.customerId, { vector: "EE", reference: "it001e 1234 5678", address: "Via Roma 1, 00100 Roma", technical: { voltageLevel: "BT", powerKw: "3", annualConsumption: null } });
  const pdr1 = await addSupply(as("agente1"), rossi.customerId, { vector: "GAS", reference: "00880000000001", address: "Via Roma 1, 00100 Roma" });
  assert.equal(pod1.reference, "IT001E12345678"); assert.deepEqual(pod1.technical, { voltageLevel: "BT", powerKw: 3, annualConsumption: null, distributor: null });
  assert.equal(await code(addSupply(as("direttore"), alfa.customerId, { vector: "EE", reference: "IT001E12345678" })), "SUPPLY_ALREADY_REGISTERED", "a POD already registered changes holder, it is never duplicated");
  assert.equal(await code(addSupply(as("agente1"), rossi.customerId, { vector: "EE", reference: "IT01" })), "SUPPLY_POD_INVALID");
  let view = await registryView(as("agente1"));
  assert.deepEqual(view.customers.find((v) => v.customer.customerId === rossi.customerId).supplies.map((s) => s.reference).sort(), ["00880000000001", "IT001E12345678"]);
  console.log("SUPPLY_ADDED=PASS");

  // 3. Changes: the agent changes what he registered; another agent cannot even see it; director and admin may; history kept.
  const updated = await updateCustomer(as("agente1"), rossi.customerId, { contacts: { email: "rossi@example.com", phone: "+39 333 1234567" }, reason: "nuova email" });
  assert.deepEqual(updated.history.at(-1).changes.contacts.to.email, "rossi@example.com"); assert.equal(updated.history.at(-1).reason, "nuova email");
  assert.equal(await code(updateCustomer(as("agente2"), rossi.customerId, { name: "Altro" })), "CUSTOMER_NOT_FOUND", "outside the agent's perimeter: not found");
  assert.equal(await code(updateCustomer(as("agente1"), alfa.customerId, { name: "Alfa" })), "CUSTOMER_NOT_FOUND", "director's customer not in the agent's perimeter");
  assert.equal((await updateCustomer(as("direttore"), rossi.customerId, { category: "RESIDENTIAL", name: "Mario Rossi" })).name, "Mario Rossi", "no change: nothing written");
  const byAdmin = await updateSupply(as("admin"), pod1.supplyId, { technical: { powerKw: 4.5 }, reason: "aumento potenza" });
  assert.equal(byAdmin.technical.powerKw, 4.5); assert.equal(byAdmin.technical.voltageLevel, "BT", "fields not sent stay as they are");
  assert.ok(audits.some((a) => a.action === "SUPPLY_UPDATED" && a.userId === "admin"));
  console.log("AUTHORISED_CHANGES=PASS");

  // 4. Bill link: the bill is unchanged; the POD read must be the POD linked; agent links only bills he may see.
  const billRossi = await seedBill("agente1", billText("Mario Rossi", "IT001E12345678", "RSSMRA80A01H501U"));
  const billOther = await seedBill("agente2", billText("Luca Bianchi", "IT001E87654321", "BNCLCU70B02F205Z"));
  const before = JSON.stringify(await billRepository.get(A, billRossi.id));
  const link = await linkBill(as("agente1"), { billId: billRossi.id, customerId: rossi.customerId, supplyId: pod1.supplyId });
  assert.equal(link.supplyId, pod1.supplyId); assert.equal(JSON.stringify(await billRepository.get(A, billRossi.id)), before, "bill document unchanged");
  assert.equal(await code(linkBill(as("agente1"), { billId: billRossi.id, customerId: rossi.customerId, supplyId: pdr1.supplyId })), "BILL_SUPPLY_MISMATCH");
  assert.equal(await code(linkBill(as("agente1"), { billId: billOther.id, customerId: rossi.customerId, supplyId: pod1.supplyId })), "BILL_NOT_FOUND", "another agent's bill");
  view = await registryView(as("agente1"));
  assert.deepEqual(view.customers.find((v) => v.customer.customerId === rossi.customerId).billIds, [billRossi.id]);
  // From a bill: read values only, then linked; a second time the identifier is already registered and nothing is created.
  const fromBill = await createFromBill(as("agente2"), { billId: billOther.id });
  assert.deepEqual([fromBill.customer.name, fromBill.customer.taxCode, fromBill.customer.contacts.email, fromBill.supply.reference, fromBill.link.billId], ["Luca Bianchi", "BNCLCU70B02F205Z", null, "IT001E87654321", billOther.id]);
  assert.equal(await code(createFromBill(as("agente2"), { billId: billOther.id })), "CUSTOMER_ALREADY_REGISTERED");
  console.log("BILL_LINKED=PASS");

  // 5. Simulations and proposals reached through the bill they were computed on; no calculation touched.
  comparisons.push({ tenantId: A, recordId: "cmp-1", payload: { comparisonId: "cmp-1", result: { calculatedAt: "2026-11-24T10:00:00.000Z", normalizedInput: { sourceBill: { billId: billRossi.id } } } } });
  comparisons.push({ tenantId: A, recordId: "cmp-2", payload: { comparisonId: "cmp-2", result: { normalizedInput: { sourceBill: { billId: "altra" } } } } });
  proposals.push({ tenantId: A, recordId: "prop-1", payload: { proposal: { sourceBill: { billId: billRossi.id } } } });
  const snapshot = JSON.stringify(comparisons);
  view = await registryView(as("agente1"));
  const rossiView = view.customers.find((v) => v.customer.customerId === rossi.customerId);
  assert.deepEqual(rossiView.simulations, [{ comparisonId: "cmp-1", billId: billRossi.id, supplyId: pod1.supplyId, calculatedAt: "2026-11-24T10:00:00.000Z" }]);
  assert.deepEqual(rossiView.proposals, [{ proposalId: "prop-1", billId: billRossi.id, supplyId: pod1.supplyId }]);
  assert.equal(JSON.stringify(comparisons), snapshot, "simulations unchanged");
  console.log("SIMULATION_LINKED=PASS");

  // 6. Company isolation: another company sees nothing and cannot touch anything, even knowing the ids.
  const viewB = await registryView(as("adminB"));
  assert.deepEqual([viewB.customers.length, viewB.bills.length], [0, 0]);
  assert.equal(await code(updateCustomer(as("adminB"), rossi.customerId, { name: "X" })), "CUSTOMER_NOT_FOUND");
  assert.equal(await code(linkBill(as("adminB"), { billId: billRossi.id, customerId: rossi.customerId, supplyId: pod1.supplyId })), "BILL_NOT_FOUND");
  const rossiB = await createCustomer(as("adminB"), { kind: "PERSON", name: "Mario Rossi", taxCode: "RSSMRA80A01H501U" });
  assert.notEqual(rossiB.customerId, rossi.customerId, "same codice fiscale in another company: a separate record");
  assert.ok(!(await registryView(as("admin"))).customers.some((v) => v.customer.customerId === rossiB.customerId));
  console.log("COMPANY_ISOLATION=PASS");

  // 7. Agent limits: own perimeter only; director sees his agents; admin all; edits limited to own records or WRITE roles.
  const names = async (who) => (await registryView(as(who))).customers.map((v) => v.customer.name).sort();
  assert.deepEqual(await names("agente1"), ["Mario Rossi"]); assert.deepEqual(await names("agente2"), ["Luca Bianchi"]);
  assert.deepEqual(await names("direttore"), ["Alfa Srl", "Mario Rossi"]); assert.deepEqual(await names("admin"), ["Alfa Srl", "Luca Bianchi", "Mario Rossi"]);
  assert.equal((await registryView(as("agente1"))).bills.some((b) => b.billId === billOther.id), false, "agent sees only his bills");
  const agentEditsLinked = (await registryView(as("direttore"))).customers.find((v) => v.customer.customerId === rossi.customerId).canEdit;
  assert.equal(agentEditsLinked, true, "director may edit his agents' customers");
  console.log("AGENT_LIMITS=PASS");

  // 8. Change of holder: the current holder is closed, the new one opens, history and old bills stay with the previous holder.
  const beta = await createCustomer(as("agente1"), { kind: "COMPANY", name: "Beta Srl", vatNumber: "09876543210" });
  assert.equal(await code(changeHolder(as("agente1"), pod1.supplyId, { customerId: beta.customerId, from: "2026-10-01" })), "HOLDER_CHANGE_REASON_REQUIRED");
  const changed = await changeHolder(as("agente1"), pod1.supplyId, { customerId: beta.customerId, from: "2026-10-01", reason: "voltura" });
  assert.deepEqual(changed.holders.map((h) => [h.customerId, h.from, h.to]), [[rossi.customerId, null, "2026-10-01"], [beta.customerId, "2026-10-01", null]]);
  assert.equal(changed.history.at(-1).action, "HOLDER_CHANGED");
  view = await registryView(as("agente1"));
  const rossiAfter = view.customers.find((v) => v.customer.customerId === rossi.customerId);
  assert.equal(rossiAfter.supplies.find((s) => s.supplyId === pod1.supplyId).current, false, "previous holder keeps the POD in its history");
  assert.deepEqual(rossiAfter.billIds, [billRossi.id], "old bills stay with the previous holder");
  assert.equal(view.customers.find((v) => v.customer.customerId === beta.customerId).supplies[0].current, true);
  assert.equal(await code(changeHolder(as("agente1"), pod1.supplyId, { customerId: beta.customerId, from: "2026-11-01", reason: "x" })), "HOLDER_UNCHANGED");
  console.log("HOLDER_CHANGE_KEEPS_HISTORY=PASS");

  // 9. Anomalies: missing identifiers, possible duplicates, different holders read on one POD, address read differently.
  const gamma = await createCustomer(as("admin"), { kind: "COMPANY", name: "ALFA S.R.L." });
  const billAddress = await seedBill("agente1", billText("Mario Rossi", "IT001E12345678", "RSSMRA80A01H501U", "Piazza Garibaldi 5, 00100 Roma"));
  await linkBill(as("agente1"), { billId: billAddress.id, customerId: rossi.customerId, supplyId: pod1.supplyId });
  const anomalies = (await registryView(as("admin"))).anomalies;
  const codes = (c) => anomalies.filter((a) => a.code === c);
  assert.ok(codes("MISSING_TAX_ID").some((a) => a.customerIds.includes(gamma.customerId)));
  assert.ok(codes("POSSIBLE_DUPLICATE").some((a) => a.customerIds.includes(gamma.customerId) && a.customerIds.includes(alfa.customerId)), "Alfa Srl and ALFA S.R.L.: reported, not merged");
  assert.equal((await registryView(as("admin"))).customers.filter((v) => /alfa/i.test(v.customer.name)).length, 2);
  assert.ok(anomalies.some((a) => a.code === "ADDRESS_MISMATCH" && a.billIds.includes(billAddress.id)), "address read differs from the one registered");
  const rossiCf = await seedBill("admin", billText("Neri Spa", "IT001E12345678", "NRESPA70A01H501X"));
  const anomalies2 = (await registryView(as("admin"))).anomalies;
  assert.ok(anomalies2.some((a) => a.code === "SUPPLY_DIFFERENT_HOLDERS" && a.billIds.includes(rossiCf.id)), "same POD read under two identifiers");
  assert.ok(anomalies2.some((a) => a.code === "BILL_NOT_LINKED" && a.billIds.includes(rossiCf.id)));
  assert.equal(searchCustomerViews((await registryView(as("admin"))).customers, "IT001E 1234 5678").length, 2, "search by POD typed with spaces (current and previous holder)");
  assert.equal(searchCustomerViews((await registryView(as("admin"))).customers, "01234567890")[0].customer.name, "Alfa Srl");
  console.log("ANOMALIES_SHOWN_NOT_MERGED=PASS");

  // 10. As served: commands through runRegistryAction; unknown action refused; route checks identity on every request.
  assert.equal(await code(runRegistryAction(as("agente1"), { action: "DELETE_ALL" })), "CUSTOMER_ACTION_INVALID");
  assert.ok((await runRegistryAction(as("agente1"), { action: "CREATE_CUSTOMER", kind: "PERSON", name: "Anna Verdi" })).customer.customerId);
  const route = await readFile(new URL("../app/api/customers/route.ts", import.meta.url), "utf8");
  assert.match(route, /requestPrincipal\(request, "READ"\)/); assert.match(route, /requestPrincipal\(request, "OPERATE"\)/);
  console.log("ROUTE_ACTIONS=PASS");
} finally { await rm(root, { recursive: true, force: true }); }
