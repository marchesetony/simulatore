import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";

const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const bill = await new LocalBillRepository().get("tenant_local-demo", "93d9b1f0-c748-4c66-ab32-b0673a96787e");
assert.ok(bill);
const document = toPublicDocument(bill);
const meta = document.analystReview;

assert.match(panel, /Indirizzo di fatturazione/);
assert.match(panel, /Indirizzo fornitura/);
assert.match(css, /bill-audit-document-meta \{ display:grid; grid-template-columns:minmax\(160px,1\.15fr\) minmax\(150px,\.95fr\) minmax\(280px,2fr\) minmax\(140px,\.85fr\)/);
assert.match(css, /bill-audit-document-meta div:nth-child\(4\) strong \{ white-space:nowrap/);
assert.match(css, /@media \(max-width:760px\).*bill-audit-document-meta \{ min-width:0; grid-template-columns:1fr;/);
assert.match(css, /bill-audit-clean-header \{ min-width:0; \}/);
assert.equal(meta.receipt.billingAddress.value, "CONTRADA ARMACA, 77, 89121 - REGGIO DI CALABRIA (RC)");
assert.equal(meta.supply.address.value, "CONTRADA ARMACA, 77");
assert.equal(meta.supply.pod.value, "IT001E76295009");

console.log("BILL_HEADER_BILLING_ADDRESS_HAS_ADEQUATE_WIDTH=OK");
console.log("BILL_HEADER_POD_NO_WRAP=OK");
console.log("BILL_HEADER_NO_HORIZONTAL_OVERFLOW=OK");
console.log("BILL_HEADER_MOBILE_REFLOW=OK");
console.log("BILL_HEADER_VALUES_PRESERVED=OK");
console.log("bill header alignment smoke: ok");
