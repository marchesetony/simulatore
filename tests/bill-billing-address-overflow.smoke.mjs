import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { attachOfficialPun } from "../app/lib/market/pun-reference.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";

const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const pdfPath = new URL("../var/foundation-documents/tenant_local-demo/93d9b1f0-c748-4c66-ab32-b0673a96787e.pdf", import.meta.url);
const pdf = await readFile(pdfPath);
const headerStart = panel.indexOf("function DocumentHeader");
const headerEnd = panel.indexOf("function valueForCorrection", headerStart);
const header = panel.slice(headerStart, headerEnd);

assert.ok(pdf.length > 0);
assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
assert.match(header, /\{ label: "Indirizzo di fatturazione", value: billingAddress \}/);
assert.match(header, /: "Non rilevato"/);
assert.doesNotMatch(header, /const billingAddress[^;]*review\.supply\.address/);
assert.doesNotMatch(header, /Non esposto in bolletta/);
assert.match(css, /bill-audit-regulated-table-wrap \{[^}]*overflow-x:hidden/);
assert.match(css, /bill-audit-regulated-summary-table \{ width:100%; min-width:0; table-layout:fixed; \}/);
assert.match(css, /bill-audit-regulated-summary-table th,\.bill-audit-regulated-summary-table td \{[^}]*overflow-wrap:anywhere/);
assert.match(css, /@media \(max-width:760px\).*bill-audit-regulated-summary-table/);
assert.match(css, /bill-audit-regulated-summary-table thead \{ display:none; \}/);
assert.match(css, /bill-audit-regulated-summary-table tbody \{ display:grid; gap:9px; \}/);

const bill = await new LocalBillRepository().get("tenant_local-demo", "93d9b1f0-c748-4c66-ab32-b0673a96787e");
assert.ok(bill);
const document = await attachOfficialPun(toPublicDocument(bill), new LocalMarketArchiveRepository());
assert.equal(document.currentVersionNumber, 6);
assert.equal(document.analystReview.receipt.billingAddress.status, "FOUND");
assert.equal(document.analystReview.receipt.billingAddress.value, "CONTRADA ARMACA, 77, 89121 - REGGIO DI CALABRIA (RC)");
assert.equal(document.analystReview.supply.address.value, "CONTRADA ARMACA, 77");
assert.equal(document.regulatoryAudit?.regulatedPassThrough?.summary.comparableCount, 5);
assert.equal(document.regulatoryAudit?.regulatedPassThrough?.summary.matchingCount, 3);
assert.equal(document.regulatoryAudit?.regulatedPassThrough?.summary.overReferenceCount, 1);
assert.equal(document.regulatoryAudit?.regulatedPassThrough?.summary.underReferenceCount, 1);

console.log("BILLING_ADDRESS_FIELD_ALWAYS_VISIBLE=OK");
console.log("SUPPLY_ADDRESS_FIELD_ALWAYS_VISIBLE=OK");
console.log("BILLING_AND_SUPPLY_ADDRESS_SEPARATE=OK");
console.log("MISSING_BILLING_ADDRESS_RENDERED_AS_NON_RILEVATO=OK");
console.log("NO_SUPPLY_ADDRESS_AS_BILLING_FALLBACK=OK");
console.log("AUDIT_TABLE_NO_DESKTOP_HORIZONTAL_SCROLL=OK");
console.log("AUDIT_STATUS_BADGES_WRAP=OK");
console.log("AUDIT_TABLE_RESPONSIVE_REFLOW=OK");
console.log("AUDIT_RESULT_UNCHANGED=OK");
console.log("bill billing address and overflow smoke: ok");
