// Tony (24/11/2026, "UNIFICAZIONE MODULI"): «Archivio bollette» and «Clienti e POD» become one module, «Clienti e Forniture».
// Targeted checks: navigation, unified search, bill upload and reading kept, links, permissions and company isolation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = read("app/components/OperationalShell.tsx");
const panel = read("app/components/CustomerRegistryPanel.tsx");
const archive = read("app/components/BillArchivePanel.tsx");

// 1. Navigation: one menu entry, old section id still opens the module (on the archive view).
const labels = [...shell.matchAll(/\{ id: "([a-z]+)", label: "([^"]+)"/g)].map((match) => [match[1], match[2]]);
assert.deepEqual(labels.filter(([, label]) => /Archivio bollette|Clienti e POD|Clienti e Forniture/.test(label)), [["customers", "Clienti e Forniture"]], "one entry only");
for (const name of ["SALES_SECTIONS", "COMPANY_ADMIN_SECTIONS", "COMPANY_MANAGER_SECTIONS"]) {
  const list = JSON.parse(shell.match(new RegExp(`const ${name}: readonly string\\[\\] = (\\[[^\\]]*\\]);`))[1]);
  assert.ok(list.includes("customers") && !list.includes("archive"), `${name}: Clienti e Forniture, no separate archive`);
}
assert.match(shell, /section === "customers" \|\| section === "archive" \? <CustomerRegistryPanel key=\{section\} readonly=\{operateReadonly\} initialTab=\{section === "archive" \? "bills" : "customers"\} onUploadBill=\{\(\) => setSection\("quote"\)\} \/>/);
assert.match(panel, /\{ id: "customers", label: "Clienti" \}, \{ id: "toLink", label: "Bollette da collegare" \}, \{ id: "bills", label: "Archivio bollette" \}/);
console.log("NAVIGATION=PASS");

// 2. Unified search: name, codice fiscale, partita IVA, POD/PDR (with or without spaces) on customers and bills to link,
// and the archive uses the same query instead of its own field.
const { searchCustomerViews, searchBillSummaries } = await import("../app/lib/customers/model.ts");
const customer = (id, name, taxCode, vatNumber, reference) => ({ customer: { customerId: id, name, taxCode, vatNumber, contacts: { email: null } }, supplies: [{ reference, address: "Via Roma 1" }] });
const views = [customer("c1", "Mario Rossi", "RSSMRA80A01H501U", null, "IT001E12345678"), customer("c2", "Alfa Srl", null, "01234567890", "01234567890123")];
const ids = (query) => searchCustomerViews(views, query).map((view) => view.customer.customerId);
assert.deepEqual(ids("rossi"), ["c1"]);
assert.deepEqual(ids("rssmra80a01h501u"), ["c1"]);
assert.deepEqual(ids("01234567890"), ["c2"]);
assert.deepEqual(ids("IT001 E123 45678"), ["c1"], "POD typed with spaces");
assert.deepEqual(ids("01234567890123"), ["c2"], "PDR");
assert.deepEqual(ids(""), ["c1", "c2"]);
const bill = (billId, customerName, taxIdentifier, supplyReference) => ({ billId, customerName, taxIdentifier, supplyReference, supplyAddress: null });
const bills = [bill("b1", "Mario Rossi", "RSSMRA80A01H501U", "IT001E12345678"), bill("b2", null, "01234567890", null)];
assert.deepEqual(searchBillSummaries(bills, "it001e 12345678").map((item) => item.billId), ["b1"]);
assert.deepEqual(searchBillSummaries(bills, "01234567890").map((item) => item.billId), ["b2"]);
assert.deepEqual(searchBillSummaries(bills, "bianchi"), []);
assert.match(panel, /searchBillSummaries\(toLinkAll, query\)/);
assert.match(archive, /const query = searchQuery \?\? ownQuery;/);
assert.match(archive, /\{searchQuery === undefined \? <label className="form-field"><span className="form-label">Cerca<\/span>/, "no second search field inside the module");
console.log("SEARCH=PASS");

// 3. Upload and reading of bills unchanged: still the «Nuova simulazione» flow, opened from the module's button.
assert.match(shell, /<div hidden=\{section !== "quote"\}><QuickQuoteFlow readonly=\{operateReadonly\} showExcluded=\{companyAdmin\} \/><\/div>/);
assert.match(panel, /\{onUploadBill \? <button className="button" type="button" disabled=\{readonly\} onClick=\{onUploadBill\}>Carica bolletta<\/button> : null\}/);
assert.match(read("app/api/bills/route.ts"), /export async function POST/);
console.log("UPLOAD_READING=PASS");

// 4. Links and records: the module only reads /api/customers and /api/bills/archive and posts registry actions; no bill
// is copied or rewritten, and the archive deletion keeps its confirmation.
assert.match(panel, /requestJson<RegistryView>\("\/api\/customers"\)/);
assert.match(panel, /requestJson\("\/api\/customers", \{ method: "POST"/);
assert.doesNotMatch(panel, /requestJson[^(]*\("\/api\/bills/, "the customer view never calls the bill routes itself");
assert.match(panel, /onAction\(\{ action: "LINK_BILL", billId: bill\.billId, customerId, supplyId \}\)/);
assert.match(archive, /if \(!canDelete \|\| deleting \|\| !confirming/);
for (const heading of ["Anagrafica", "Punti di fornitura", "Bollette collegate", "Simulazioni", "Proposte"]) assert.match(panel, new RegExp(`<h4>${heading}`), `scheda cliente: ${heading}`);
console.log("LINKS=PASS");

// 5. Permissions and isolation stay on the server routes, unchanged by this screen.
const customersRoute = read("app/api/customers/route.ts");
assert.match(customersRoute, /"READ"/); assert.match(customersRoute, /"OPERATE"/);
const archiveRoute = read("app/api/bills/archive/route.ts");
assert.match(archiveRoute, /billInScope\(document, scope\)/); assert.match(archiveRoute, /document\.tenantId === principal\.tenantId/);
assert.match(panel, /view\.canEdit \?/, "edit buttons only where the server says so");
assert.match(panel, /view\?\.canCreate \?/);
console.log("PERMISSIONS=PASS");
console.log("clienti-forniture-unified: ok");

// 6. Tony (24/11/2026, "AUTORIZZAZIONE CLIENTI E FORNITURE"): in the archive view a codice fiscale / partita IVA finds the
// bills linked to the customer registered with it, and among the bills not yet linked only those whose reading carries it.
{
  const { billIdsForTaxSearch } = await import("../app/lib/customers/model.ts");
  const linked = (customerId, supplyId) => ({ customerId, supplyId });
  const view = {
    customers: [
      { customer: { customerId: "c1", taxCode: "RSSMRA80A01H501U", vatNumber: null }, billIds: ["b1", "b2"] },
      { customer: { customerId: "c2", taxCode: null, vatNumber: "01234567890" }, billIds: ["b3"] },
      { customer: { customerId: "c3", taxCode: null, vatNumber: null }, billIds: ["b6"] },
    ],
    bills: [
      { billId: "b1", taxIdentifier: null, linked: linked("c1", "s1") },
      { billId: "b2", taxIdentifier: "01234567890", linked: linked("c1", "s1") },
      { billId: "b3", taxIdentifier: null, linked: linked("c2", "s2") },
      { billId: "b4", taxIdentifier: "RSSMRA80A01H501U", linked: null },
      { billId: "b5", taxIdentifier: null, linked: null },
      { billId: "b6", taxIdentifier: "RSSMRA80A01H501U", linked: linked("c3", "s3") },
    ],
  };
  const found = (query) => [...billIdsForTaxSearch(view, query)].sort();
  assert.deepEqual(found("RSSMRA80A01H501U"), ["b1", "b2", "b4"], "linked bills of the customer + unlinked bill read with that code; b6 is linked to another customer, so its reading is not used");
  assert.deepEqual(found("rssmra80a01h501u"), ["b1", "b2", "b4"], "case-insensitive");
  assert.deepEqual(found("01234567890"), ["b3"], "a linked bill is not found through its own reading (b2 belongs to c1)");
  assert.deepEqual(found("IT01234567890"), ["b3"], "partita IVA with country prefix");
  assert.deepEqual(found("0123 4567 890"), ["b3"], "typed with spaces");
  assert.deepEqual(found("NESSUNO99"), [], "no invented match");
  assert.deepEqual(found("RS"), [], "too short to identify anyone");
  const archive = read("app/components/BillArchivePanel.tsx");
  assert.match(archive, /filterArchiveRows\(rows\.filter\(\(row\) => alsoMatching\.has\(row\.id\)\), \{ \.\.\.filters, query: "" \}\)/, "month, period and document filters still apply");
  assert.match(read("app/components/CustomerRegistryPanel.tsx"), /<BillArchivePanel readonly=\{readonly\} searchQuery=\{query\} embedded alsoMatching=\{taxMatches\} \/>/);
  console.log("ARCHIVE_TAX_SEARCH=PASS");
}
