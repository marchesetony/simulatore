import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { officialPunInputFromPublicBill, resolveOfficialPunForBill } from "../app/lib/market/pun-reference.ts";

const gmeSource = { sourceId: "GME", name: "GME", url: "https://gme.mercatoelettrico.org/mercati/energia" };
const otherSource = { sourceId: "OTHER", name: "Other official source", url: "https://example.test/market" };
const rate = (value) => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });
const archiveRecord = (month, values, overrides = {}, source = gmeSource) => ({
  archiveId: `pun-${month}`,
  tenantId: "tenant_test",
  vector: "EE",
  index: "PUN",
  month,
  status: "APPROVED",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  approvals: [],
  history: [],
  record: { recordId: `pun-${month}`, tenantId: "tenant_test", version: "1", parentVersionId: null, recordType: "MONTHLY_MARKET_DATA", publicationDate: `${month}-05`, effectiveFrom: `${month}-01`, effectiveTo: null, vector: "EE", index: "PUN", month, f1: rate(values[0]), f2: rate(values[1]), f3: rate(values[2]), source, approval: { status: "APPROVED", reviewer: "fixture", reviewedAt: "2026-08-01T00:00:00.000Z", decisionId: "fixture-decision" }, ...overrides },
});
const repository = (...records) => ({ async list() { return records; } });
const period = (periodStart, periodEnd) => ({ periodStart, periodEnd });
const input = (billingPeriod, structure = "F1_F2_F3") => ({ tenantId: "tenant_test", vector: "EE", billingPeriod, structure });

const authoritativeInput = officialPunInputFromPublicBill({ tenantId: "tenant_test", resolvedVector: "EE", normalized: { billingPeriod: period("2026-07-01", "2026-08-01") }, structuredBill: { billingPeriod: { status: "FOUND", value: { from: "2026-06-01", to: "2026-07-01" } }, f1Consumption: { status: "NOT_FOUND" }, f2Consumption: { status: "NOT_FOUND" }, f3Consumption: { status: "NOT_FOUND" } } });
assert.deepEqual(authoritativeInput.billingPeriod, period("2026-06-01", "2026-07-01"));
console.log("INVOICE_BILLING_PERIOD_AUTHORITATIVE=OK");

const mono = await resolveOfficialPunForBill(repository(archiveRecord("2026-06", [101.1, 99.2, 97.3], { monthly: rate(100.5) })), input(period("2026-06-01", "2026-07-01"), "MONO"));
assert.equal(mono.length, 1);
assert.equal(mono[0].referenceMonth, "2026-06");
assert.equal(mono[0].pricingMode, "MONO");
assert.equal(mono[0].monthly, 100.5);
assert.equal(mono[0].f1, null);
console.log("MONO_PUN_REFERENCE=OK");

const multi = await resolveOfficialPunForBill(repository(archiveRecord("2026-07", [101.1, 99.2, 97.3], { monthly: rate(100.5) })), input(period("2026-07-01", "2026-08-01")));
assert.equal(multi.length, 1);
assert.equal(multi[0].pricingMode, "F1_F2_F3");
assert.deepEqual([multi[0].f1, multi[0].f2, multi[0].f3], [101.1, 99.2, 97.3]);
assert.equal(multi[0].monthly, null);
console.log("F1_F2_F3_REFERENCE=OK");

assert.equal(multi[0].referenceMonth, "2026-07");
assert.equal(multi[0].unit, "EUR_PER_MWH");
assert.equal(multi[0].authority, "GME");
assert.equal(multi[0].sourceType, "OFFICIAL");
assert.equal(multi[0].publishedAt, "2026-07-05");
assert.equal(multi[0].retrievedAt, "2026-08-02T00:00:00.000Z");
console.log("GME_OFFICIAL_SOURCE_ONLY=OK");

const multiMonth = await resolveOfficialPunForBill(repository(archiveRecord("2026-06", [101, 99, 97]), archiveRecord("2026-07", [102, 98, 96]), archiveRecord("2026-08", [103, 97, 95])), input(period("2026-06-15", "2026-07-15")));
assert.deepEqual(multiMonth.map((reference) => reference.referenceMonth), ["2026-06", "2026-07"]);
assert.equal(multiMonth.some((reference) => reference.referenceMonth === "2026-08"), false);
console.log("MULTI_MONTH_INVOICE_PUN=OK");
console.log("INVOICE_REFERENCE_PUN_ONLY=OK");

const onlyLatest = await resolveOfficialPunForBill(repository(archiveRecord("2026-08", [103, 97, 95])), input(period("2026-06-01", "2026-07-01")));
assert.deepEqual(onlyLatest.map((reference) => reference.referenceMonth), ["2026-06"]);
assert.equal(onlyLatest[0].status, "UNAVAILABLE");
console.log("NO_LATEST_COMPLETE_MONTH_REFERENCE=OK");
console.log("NO_CURRENT_MONTH_FALLBACK=OK");

const noMonthly = await resolveOfficialPunForBill(repository(archiveRecord("2026-06", [100, 100, 100])), input(period("2026-06-01", "2026-07-01"), "MONO"));
assert.equal(noMonthly[0].status, "UNAVAILABLE");
assert.equal(noMonthly[0].monthly, null);

const nonGme = await resolveOfficialPunForBill(repository(archiveRecord("2026-06", [100, 100, 100], { monthly: rate(100) }, otherSource)), input(period("2026-06-01", "2026-07-01"), "MONO"));
assert.equal(nonGme[0].status, "UNAVAILABLE");

const panel = await readFile(new URL("../app/components/BillOperationalPanel.tsx", import.meta.url), "utf8");
const detailRoute = await readFile(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8");
assert.match(panel, /Riferimento GME periodo bolletta/);
assert.match(panel, /OFFERTA ATTUALE/);
assert.match(panel, /Riferimento GME periodo bolletta/);
assert.doesNotMatch(panel, /latestCompleteMonthPun|currentMonth|lastCompleteMonth/);
assert.ok(panel.indexOf("Riferimento GME periodo bolletta") > panel.indexOf("function CurrentOfferSummary"));
assert.match(detailRoute, /attachOfficialPun/);

console.log("bill pun header smoke: ok (invoice-period-only GME references, mono/multioraria, no latest/current fallback)");
