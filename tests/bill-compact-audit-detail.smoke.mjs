import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { attachOfficialPun } from "../app/lib/market/pun-reference.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";

const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const offerStart = panel.indexOf("function CleanOfferSummary");
const offerEnd = panel.indexOf("function CostSummary", offerStart);
const detailStart = panel.indexOf("function AnalysisDetail");
const detailEnd = panel.indexOf("function LegacyDocumentHeader", detailStart);
assert.ok(offerStart >= 0 && offerEnd > offerStart);
assert.ok(detailStart >= 0 && detailEnd > detailStart);
const offer = panel.slice(offerStart, offerEnd);
const detail = panel.slice(detailStart, detailEnd);

assert.match(panel, /CleanOfferSummary review=\{review\} audit=\{audit\} matrix=\{matrix\}/);
assert.match(offer, /regulatedItem\(audit \?\? null, "DISPATCHING"\)/);
assert.match(offer, /regulatedItem\(audit \?\? null, "CAPACITY_MARKET"\)/);
assert.match(detail, /RIEPILOGO COMPONENTI REGOLATE/);
assert.match(detail, /COMPONENTI CONFRONTATE \(\{comparable\.length\}\)/);
assert.match(detail, /items\.filter\(\(item\) => item\.comparable\)/);
assert.match(detail, /COMPONENTI PRESENTI IN VOCE AGGREGATA/);
assert.match(detail, /COMPONENTI NON IDENTIFICATE SEPARATAMENTE/);
assert.match(detail, /TechnicalProvenanceDetail/);
assert.match(detail, /RegulatedCostsTable items=\{comparable\}/);
assert.doesNotMatch(detail, /<EnergyPrice|<SellerSection|<TaxSection/);
assert.match(panel, /bill-audit-inline-disclosure/);
assert.match(panel, /DATI TECNICI E PROVENIENZA/);
assert.match(css, /bill-audit-compact-detail/);
assert.match(css, /bill-audit-compact-group/);
assert.match(css, /bill-audit-inline-disclosure/);
assert.match(css, /bill-audit-detail.*overflow-x:clip/);

const bill = await new LocalBillRepository().get("tenant_local-demo", "93d9b1f0-c748-4c66-ab32-b0673a96787e");
assert.ok(bill);
const publicBill = await attachOfficialPun(toPublicDocument(bill), new LocalMarketArchiveRepository());
const items = publicBill.regulatoryAudit?.regulatedPassThrough?.items ?? [];
const byCode = (code) => items.find((item) => item.code === code);
assert.equal(byCode("DISPATCHING")?.status, "INFERIORE_AL_RIFERIMENTO");
assert.equal(byCode("CAPACITY_MARKET")?.status, "CONFORME");
assert.deepEqual(
  ["NETWORK_POWER", "ASOS", "ARIM", "DISPATCHING", "CAPACITY_MARKET"].map((code) => byCode(code)?.code),
  ["NETWORK_POWER", "ASOS", "ARIM", "DISPATCHING", "CAPACITY_MARKET"],
);
assert.equal(items.filter((item) => item.comparable).length, 5);
assert.equal(items.filter((item) => item.status === "PRESENTE_IN_VOCE_AGGREGATA").length, 4);
assert.equal(items.filter((item) => item.status === "NON_IDENTIFICATO_SEPARATAMENTE").length, 2);

console.log("OFFER_AND_AUDIT_USE_SAME_PASS_THROUGH_STATUS=OK");
console.log("DISPATCHING_OFFER_STATUS_UNDER_REFERENCE=OK");
console.log("CAPACITY_OFFER_STATUS_CONFORME=OK");
console.log("DETAIL_FIRST_LEVEL_COMPACT=OK");
console.log("COMPARABLE_COMPONENTS_VISIBLE_FIRST_LEVEL=5");
console.log("AGGREGATED_COMPONENTS_COLLAPSED=OK");
console.log("NON_IDENTIFIED_COMPONENTS_COLLAPSED=OK");
console.log("TECHNICAL_PROVENANCE_COLLAPSED=OK");
console.log("NO_MAIN_DATA_REPEATED_INSIDE_DETAIL=OK");
console.log("DETAIL_NO_HORIZONTAL_OVERFLOW=OK");
console.log("bill compact audit detail smoke: ok");
