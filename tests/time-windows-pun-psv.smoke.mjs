import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKET_OPERATIONAL_MONTHS, isRetentionRetirement, operationalMarketMonths, operationalMarketView, romeToday } from "../app/lib/market/operational-window.ts";
import { createMarketArchive, queryApprovedHistoricalMarketData, retireMarketArchive } from "../app/lib/market/service.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { prepareBillDrivenSimulation, resolveBillDrivenExecution, simulationPeriodOf } from "../app/lib/calculation/bill-driven.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { syntheticElectricityPun, syntheticGasPsv } from "../app/lib/energy/synthetic-fixtures.ts";
import { computeCoverage } from "../app/lib/official-monitor/coverage.ts";
import { ensureOfficialPunForBill } from "../app/lib/market/pun-reference.ts";

/*
 * Tony, 17/11/2026 (binding): PUN and PSV usable only for the six months before the current date; simulations only on bills
 * whose whole supply period lies in the last five months, server side, for every company; monthly and bimonthly bills.
 */
const TODAY = "2026-11-17";

// 1. The operational window: six calendar months before the current Italian month, current month excluded.
assert.equal(MARKET_OPERATIONAL_MONTHS, 6);
assert.deepEqual(operationalMarketMonths(TODAY), ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
assert.deepEqual(operationalMarketMonths("2026-11-01"), operationalMarketMonths("2026-11-30"), "the whole month shares the window");
assert.deepEqual(operationalMarketMonths("2027-02-03"), ["2027-01", "2026-12", "2026-11", "2026-10", "2026-09", "2026-08"], "across New Year");
assert.equal(romeToday(new Date("2026-10-31T23:30:00.000Z")), "2026-11-01", "Italian date, not UTC");
assert.equal(romeToday(new Date("2026-07-31T21:59:00.000Z")), "2026-07-31");
assert.equal(romeToday(new Date("2026-07-31T22:00:00.000Z")), "2026-08-01", "summer time");

// 2. PUN/PSV outside the window are never usable, even when no refresh has retired them; inside, the verified ones are.
const tenantId = "tenant_window-a";
const approval = { status: "APPROVED", reviewer: "window-smoke", reviewedAt: "2026-06-02T00:00:00.000Z", decisionId: "window-smoke" };
const punOf = (tenant, month, monthly, f = [monthly, monthly, monthly]) => {
  const [year, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
  const rate = (value) => ({ value, currency: "EUR", unit: "EUR_PER_MWH" });
  return { ...structuredClone(syntheticElectricityPun), tenantId: tenant, recordId: `pun-${tenant}-${month}`, month, effectiveFrom: `${month}-01`, effectiveTo: next, publicationDate: next, approval, monthly: rate(monthly), f1: rate(f[0]), f2: rate(f[1]), f3: rate(f[2]) };
};
const psvOf = (tenant, month, value) => {
  const [year, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
  return { ...structuredClone(syntheticGasPsv), tenantId: tenant, recordId: `psv-${tenant}-${month}`, month, effectiveFrom: `${month}-01`, effectiveTo: next, publicationDate: next, approval, value: { ...syntheticGasPsv.value, value } };
};
const root = await mkdtemp(path.join(os.tmpdir(), "time-windows-"));
try {
  const market = new LocalMarketArchiveRepository(path.join(root, "market"));
  for (const [month, value] of [["2026-04", 90], ["2026-05", 95], ["2026-07", 100], ["2026-08", 200], ["2026-10", 120]]) await createMarketArchive(market, { tenantId, record: punOf(tenantId, month, value), now: "2026-06-02T00:00:00.000Z", actor: "WINDOW_SMOKE" });
  for (const [month, value] of [["2026-04", 0.49], ["2026-09", 0.84]]) await createMarketArchive(market, { tenantId, record: psvOf(tenantId, month, value), now: "2026-06-02T00:00:00.000Z", actor: "WINDOW_SMOKE" });
  const view = operationalMarketView(market, TODAY);
  assert.deepEqual((await view.list(tenantId)).map((record) => `${record.index}:${record.month}`).sort(), ["PSV:2026-09", "PUN:2026-05", "PUN:2026-07", "PUN:2026-08", "PUN:2026-10"]);
  assert.equal((await queryApprovedHistoricalMarketData(view, tenantId, "2026-04-15", "EE")).length, 0, "April PUN approved but outside the window");
  assert.equal((await queryApprovedHistoricalMarketData(view, tenantId, "2026-04-15", "GAS")).length, 0, "April PSV approved but outside the window");
  assert.equal((await queryApprovedHistoricalMarketData(market, tenantId, "2026-04-15", "EE")).length, 1, "the archive itself still holds it (no write)");
  assert.equal((await queryApprovedHistoricalMarketData(view, tenantId, "2026-10-15", "EE"))[0].record.monthly.value, 120);
  assert.equal(await view.get(tenantId, `pun-${tenantId}-2026-04`), null);
  await assert.rejects(() => view.save({}), /MARKET_OPERATIONAL_VIEW_READ_ONLY/);
  // The window moves: on 3 December May leaves it, November is not in yet.
  assert.equal((await queryApprovedHistoricalMarketData(operationalMarketView(market, "2026-12-03"), tenantId, "2026-05-15", "EE")).length, 0);

  // 3. Retirement keeps traceability and is told apart from a wrong record.
  const retired = await retireMarketArchive(market, tenantId, `pun-${tenantId}-2026-04`, "market-regulatory-auto-refresh", "PUN_RETENTION_6_MONTHS", "2026-11-17T04:15:00.000Z");
  assert.equal(retired.status, "REJECTED"); assert.equal(retired.record.monthly.value, 90); assert.equal(retired.record.source.name, syntheticElectricityPun.source.name);
  assert.equal(retired.history.at(-1).reason, "PUN_RETENTION_6_MONTHS"); assert.ok(retired.history.length >= 2);
  assert.equal(isRetentionRetirement(retired), true);
  assert.equal(isRetentionRetirement({ ...retired, approvals: [{ decisionId: "rejected-x" }], record: { ...retired.record, approval: { status: "REJECTED", reason: "VALORE ERRATO" } } }), false, "a rejection for a wrong value is not a retirement");

  // 4. Bimonthly bill with documented monthly data: two months, each with its own PUN; without the split, not determinable.
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const contract = { ...structuredClone(syntheticElectricityCte), tenantId, approval };
  const cte = await createCteArchive(cteRepository, { tenantId, contract, now: "2026-06-02T00:00:00.000Z", actor: "WINDOW_SMOKE" });
  const eeRequest = (supplyPeriod, consumption) => parseSimulationRequest({ schemaVersion: 1, tenantId, vector: "EE", calculationDate: TODAY, supplyPeriod, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption }, tenantId);
  const bimonthly = { periodStart: "2026-07-01", periodEnd: "2026-09-01" };
  const split = await calculateApprovedOffer(cteRepository, view, eeRequest(bimonthly, { basis: "PERIOD", unit: "KWH", f1: 600, f2: 200, f3: 200, monthlyProfile: [{ month: "2026-07", f1: 300, f2: 100, f3: 200 }, { month: "2026-08", f1: 300, f2: 100, f3: 0 }] }), cte.archiveId);
  const energy = split.components.filter((component) => component.formulaInputs?.band);
  assert.deepEqual(energy.map((component) => [component.formulaInputs.month, component.formulaInputs.band, component.formulaInputs.quantityKwh, component.formulaInputs.punEurPerMwh, component.formulaInputs.marketRecordId]), [
    ["2026-07", "F1", 300, 100, `pun-${tenantId}-2026-07`], ["2026-07", "F2", 100, 100, `pun-${tenantId}-2026-07`], ["2026-07", "F3", 200, 100, `pun-${tenantId}-2026-07`],
    ["2026-08", "F1", 300, 200, `pun-${tenantId}-2026-08`], ["2026-08", "F2", 100, 200, `pun-${tenantId}-2026-08`], ["2026-08", "F3", 0, 200, `pun-${tenantId}-2026-08`],
  ], "each month with its own PUN and its own documented consumption, traced to its record");
  // Fixed quota on the effective duration: two whole months.
  const fixedQuota = split.components.find((component) => component.formulaInputs?.feeId === "ee-fixed");
  assert.deepEqual([fixedQuota.formulaInputs.basisQuantity, fixedQuota.amount.minorUnits], [2, 1600]);
  await assert.rejects(() => calculateApprovedOffer(cteRepository, view, eeRequest(bimonthly, { basis: "PERIOD", unit: "KWH", f1: 600, f2: 200, f3: 200 }), cte.archiveId), /MONTHLY_PROFILE_REQUIRED/, "never divided by two");
  // A month outside the window is not determinable, even though its PUN is still approved in the archive.
  await assert.rejects(() => calculateApprovedOffer(cteRepository, view, eeRequest({ periodStart: "2026-04-01", periodEnd: "2026-05-01" }, { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 }), cte.archiveId), /MARKET_DATA_MISSING/);
} finally {
  await rm(root, { recursive: true, force: true });
}

// 5. Bill admission, server side, for every company: the whole supply period in the last five months (17/06–17/11/2026).
const known = (value) => ({ status: "KNOWN", value });
const found = (value) => ({ value, status: "FOUND", confidence: 0.99, source: "DOCUMENT_AI" });
const notFound = () => ({ value: null, status: "NOT_FOUND", confidence: 0, source: "DOCUMENT_AI" });
const billFor = (tenant, id, period, issueDate = "2026-11-10") => {
  const versionId = `${id}-v1`;
  const contract = { schemaVersion: 1, recordId: `${id}::energy::${versionId}`, version: "1", parentVersionId: null, tenantId: tenant, approval: { status: "DRAFT", reason: "BILL_PENDING_REVIEW" }, recordType: "BILL", billId: id, vector: "EE",
    billingPeriod: period, currentSupplier: "QA Supplier", customer: { customerId: `customer-${id}`, customerType: "NON_RESIDENTIAL", name: known("QA Customer"), taxIdentifiers: [] },
    offer: { supplier: "QA Supplier", offerName: known("QA Offer"), offerCode: known("QA-OFFER") }, regulatedCharges: [], fieldProvenance: [], reviewState: "APPROVED",
    supply: { vector: "EE", pod: "ITQA00000000001", voltageLevel: "LV" }, consumption: { vector: "EE", f1: known(100), f2: known(50), f3: known(25), total: known(175) } };
  const structuredBill = { schemaVersion: 1, vector: found("EE"), supplier: found("QA Supplier"), customerName: found("QA Customer"), customerId: found(`customer-${id}`), customerType: found("NON_RESIDENTIAL"), customerTaxIdentifier: notFound(),
    billingPeriod: found({ from: period.periodStart ?? null, to: period.periodEnd ?? null }), totalAmount: found(20), annualConsumption: found(2100), billedConsumption: found(175), pod: found("ITQA00000000001"), pdr: notFound(), voltageLevel: found("LV"), powerKw: found(10),
    f1Consumption: found(100), f2Consumption: found(50), f3Consumption: found(25), smcConsumption: notFound(), conversionCoefficient: notFound(), pcs: notFound(), offerName: found("QA Offer"), offerCode: found("QA-OFFER"),
    extendedFacts: [{ code: "SUPPLY_USE_CATEGORY_RAW", value: "Altri usi", status: "FOUND" }, { code: "POWER_COMMITTED", value: "10 kW", status: "FOUND" }, { code: "POWER_AVAILABLE", value: "10 kW", status: "FOUND" }, { code: "VOLTAGE_CLASS_RAW", value: "BT", status: "FOUND" }, { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: "Altri usi", status: "FOUND" }, { code: "BILL_ISSUE_DATE", value: issueDate, status: "FOUND" }],
    economicChargeLines: [] };
  return { id, tenantId: tenant, ownerUserId: "qa_admin", fileName: `${id}.pdf`, objectKey: `${id}.pdf`, size: 100, createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", currentVersionId: versionId, currentApprovedVersionId: versionId, lifecycleState: "ACTIVE", lifecycleVersion: 1,
    retention: { retentionClass: "FISCAL_DOCUMENT", policyId: "FISCAL_15_MONTHS", policyVersion: 2, archivedAt: null, deletionDueAt: null, deletedAt: null }, lifecycleHistory: [],
    versions: [{ versionId, versionNumber: 1, supersedesVersionId: null, status: "EXTRACTED", fields: {}, createdAt: "2026-11-10T00:00:00.000Z", origin: "INGESTION", energyContract: contract, structuredBill }],
    provenance: [], approvals: [{ approvalId: `${id}-approval`, tenantId: tenant, documentId: id, versionId, versionNumber: 1, approvedAt: "2026-11-10T00:00:00.000Z", origin: "LOCAL_APPROVAL", supersedesApprovalId: null, actorId: "qa_admin", auditEventId: `${id}-audit` }] };
};
const cases = [
  ["monthly", { periodStart: "2026-10-01", periodEnd: "2026-10-31" }, "ADMITTED"],
  ["bimonthly", { periodStart: "2026-08-01", periodEnd: "2026-09-30" }, "ADMITTED"],
  ["first-day", { periodStart: "2026-06-17", periodEnd: "2026-08-16" }, "ADMITTED"],
  ["bimonthly-before-threshold", { periodStart: "2026-06-01", periodEnd: "2026-07-31" }, "SOURCE_BILL_TOO_OLD"],
  ["recent-issue-old-consumption", { periodStart: "2026-04-01", periodEnd: "2026-05-31" }, "SOURCE_BILL_TOO_OLD"],
  ["missing-start", { periodStart: "", periodEnd: "2026-10-31" }, "SOURCE_BILL_PERIOD_MISSING"],
  ["inverted", { periodStart: "2026-10-31", periodEnd: "2026-10-01" }, "SOURCE_BILL_PERIOD_INVALID"],
  ["impossible", { periodStart: "2026-09-31", periodEnd: "2026-10-30" }, "SOURCE_BILL_PERIOD_INVALID"],
  ["future", { periodStart: "2026-11-01", periodEnd: "2026-11-30" }, "SOURCE_BILL_PERIOD_FUTURE"],
];
for (const tenant of ["tenant_window-a", "tenant_window-b"]) {
  const principal = { userId: "qa_admin", tenantId: tenant, role: "ADMIN", sessionId: "session_local-dev", issuedAt: "2026-11-17T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" };
  const bills = new Map(cases.map(([id, period]) => [`${tenant}:${id}`, billFor(tenant, id, period)]));
  const repositories = {
    billRepository: { async get(t, id) { return bills.get(`${t}:${id}`) ?? null; }, async list(t) { return [...bills.values()].filter((item) => item.tenantId === t); } },
    foundationMemberships: { async list() { return []; } },
    cteArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() {} },
    marketArchiveRepository: { async get() { return null; }, async list() { return []; }, async save() { throw new Error("NO_WRITE_EXPECTED"); } },
  };
  for (const [id, , expected] of cases) {
    const outcome = await prepareBillDrivenSimulation(principal, repositories, id, "EXCLUDED", TODAY, TODAY).then(() => "ADMITTED", (error) => error.code ?? error.message);
    assert.equal(outcome, expected, `${tenant} ${id}`);
  }
  // The window is measured on the server date: a client calculation date in the past does not reopen an old bill.
  await assert.rejects(() => resolveBillDrivenExecution(principal, repositories, { billId: "recent-issue-old-consumption", billVersionId: "recent-issue-old-consumption-v1", cteId: "x", cteVersionId: "x", taxTreatment: "EXCLUDED", calculationDate: "2026-06-15", today: TODAY }), /SOURCE_BILL_TOO_OLD/);
}

// 5b. Partial months (existing V2 rule, unchanged here): the calculation runs on whole months, a partial month is rounded to the
// nearer boundary and fixed quotas count whole months. Day-by-day proration needs an engine change Tony has not authorized.
assert.deepEqual(simulationPeriodOf({ periodStart: "2026-07-10", periodEnd: "2026-09-09" }), { periodStart: "2026-07-01", periodEnd: "2026-09-01" });
assert.deepEqual(simulationPeriodOf({ periodStart: "2026-07-20", periodEnd: "2026-09-19" }), { periodStart: "2026-08-01", periodEnd: "2026-10-01" });

// 5c. Showing an old bill never refreshes or reads PUN outside the window (the bill itself stays readable).
{
  let refreshed = 0;
  const oldBill = { tenantId: "tenant_window-a", resolvedVector: "EE", normalized: { billingPeriod: { periodStart: "2026-03-01", periodEnd: "2026-04-30" } }, structuredBill: null };
  await ensureOfficialPunForBill(oldBill, { async get() { return null; }, async list() { return []; }, async save() { throw new Error("NO_WRITE_EXPECTED"); } }, async () => { refreshed += 1; });
  assert.equal(refreshed, 0, "months outside the window are not fetched");
}

// 6. Control Room: PUN/PSV anomalies only inside the window; retired months are not missing, unverified or divergent.
{
  const rec = (tenant, index, month, { status = "APPROVED", retired = false, value = 0.5 } = {}) => ({
    archiveId: `${tenant}-${index}-${month}`, tenantId: tenant, vector: index === "PUN" ? "EE" : "GAS", index, month, status, updatedAt: "2026-11-10T00:00:00.000Z",
    approvals: retired ? [{ decisionId: `retired-${tenant}-${index}-${month}` }] : [],
    record: index === "PUN"
      ? { version: "1", publicationDate: `${month}-28`, approval: retired ? { status: "REJECTED", reason: "PUN_RETENTION_6_MONTHS" } : { status }, monthly: { value: 110 }, f1: { value: 120 }, f2: { value: 110 }, f3: { value: 100 } }
      : { version: "1", publicationDate: `${month}-28`, approval: retired ? { status: "REJECTED", reason: "PSV_RETENTION_6_MONTHS" } : { status }, value: { value, unit: "EUR_PER_SMC", currency: "EUR" } },
  });
  const window = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const full = (tenant, index, psvValue = () => 0.5) => window.map((month) => rec(tenant, index, month, { value: psvValue(month) }));
  const copyOf = (tenantId, label, platform, marketArchives) => ({ tenantId, label, platform, regulatoryValues: [], approvalDomains: [], marketArchives });
  const base = (extraPlatform = [], extraCompany = [], psvCompany = () => 0.5) => [
    copyOf("tenant_piattaforma", "Archivio produttore", true, [...full("tenant_piattaforma", "PUN"), ...full("tenant_piattaforma", "PSV"), ...extraPlatform]),
    copyOf("tenant_energia-priva", "Energia Priva", false, [...full("tenant_energia-priva", "PUN"), ...full("tenant_energia-priva", "PSV", psvCompany), ...extraCompany]),
  ];
  const marketIssues = (report) => report.alerts.filter((alert) => alert.component === "GME:PUN" || alert.component === "ARERA:PSV");
  // Complete window, January–April retired in one copy and absent in the other: no anomaly at all.
  const retiredOld = ["2026-01", "2026-02", "2026-03", "2026-04"].flatMap((month) => [rec("tenant_energia-priva", "PUN", month, { status: "REJECTED", retired: true }), rec("tenant_energia-priva", "PSV", month, { status: "REJECTED", retired: true })]);
  const clean = computeCoverage({ now: "2026-11-17T10:00:00Z", copies: base([], retiredOld), publications: [], checks: [], alerts: [] });
  assert.deepEqual(marketIssues(clean), [], "retired months are neither missing nor unverified nor divergent");
  assert.equal(clean.archives.find((archive) => archive.source === "GME").status, "COMPLETE");
  const pun = clean.archives.find((archive) => archive.source === "GME").components[0];
  assert.equal(pun.expectedLabel.includes("gennaio"), false); assert.equal(pun.expected[0], "2026-05"); assert.equal(pun.expected.at(-1), "2026-10");
  // Before the 15th the previous month is not expected yet (GME check of the 5th–14th unchanged).
  assert.deepEqual(computeCoverage({ now: "2026-11-10T10:00:00Z", copies: base(), publications: [], checks: [], alerts: [] }).archives.find((archive) => archive.source === "GME").components[0].expected, ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  // Approved but outside the window and not yet retired: an informative notice, not an anomaly, not counted.
  const lingering = computeCoverage({ now: "2026-11-17T10:00:00Z", copies: base([rec("tenant_piattaforma", "PUN", "2026-03")]), publications: [], checks: [], alerts: [] });
  const notice = marketIssues(lingering);
  assert.deepEqual(notice.map((item) => [item.kind, item.severity, item.periods.join(",")]), [["OUTSIDE_WINDOW", "INFO", "2026-03"]]);
  assert.equal(lingering.archives.find((archive) => archive.source === "GME").status, "COMPLETE");
  assert.deepEqual(lingering.counts, clean.counts, "the notice adds nothing to the anomaly counters");
  // Real anomalies still show: a missing month in the window, a wrong (non-retention) rejection, a PSV value divergence.
  const realCopies = base([], [], (month) => month === "2026-09" ? 0.84 : 0.5);
  realCopies[0].marketArchives = realCopies[0].marketArchives.filter((record) => !(record.index === "PUN" && record.month === "2026-07"));
  realCopies[1].marketArchives = realCopies[1].marketArchives.map((record) => record.index === "PUN" && record.month === "2026-06" ? { ...record, status: "REJECTED", record: { ...record.record, approval: { status: "REJECTED", reason: "VALORE ERRATO" } } } : record);
  const real = computeCoverage({ now: "2026-11-17T10:00:00Z", copies: realCopies, publications: [], checks: [], alerts: [] });
  const kinds = marketIssues(real).map((item) => `${item.component}:${item.kind}:${item.periods.join(",")}`).sort();
  assert.ok(kinds.includes("GME:PUN:MISSING:2026-07"), kinds.join(" | "));
  assert.ok(kinds.includes("GME:PUN:UNVERIFIED:2026-06"), kinds.join(" | "));
  assert.ok(kinds.includes("ARERA:PSV:DIVERGENT:2026-09"), "the PSV value is read from its own field: " + kinds.join(" | "));
}

console.log("time windows pun/psv smoke: ok");
