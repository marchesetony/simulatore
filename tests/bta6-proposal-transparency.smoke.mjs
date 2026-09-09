import assert from "node:assert/strict";

import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { generateProposal } from "../app/lib/proposal/service.ts";
import { calculationPayloadForFingerprint, fingerprint } from "../app/lib/proposal/integrity.ts";
import { exportCsv, exportHtml, exportJson } from "../app/lib/export/serialization.ts";

const tenant = "tenant_bta6-proposal-4d2";
const COMPLETE = "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE";
const regulated = ["NETWORK_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "METERING_FIXED", "TRANSMISSION_ENERGY", "UC3_ENERGY", "UC6_ENERGY", "UC6_FIXED", "ARIM_FIXED", "ARIM_POWER", "ARIM_ENERGY", "ASOS_FIXED", "ASOS_POWER", "ASOS_ENERGY"];
const notice = "I valori indicati sono calcolati al netto di IVA, accise ed eventuali altre imposte, tasse o componenti fiscali applicabili. Tali importi non sono inclusi nella simulazione né nel confronto delle offerte.";
const money = (minorUnits) => ({ amount: minorUnits / 100, minorUnits, currency: "EUR" });
const request = parseSimulationRequest({ schemaVersion: 1, tenantId: tenant, vector: "EE", calculationDate: "2026-07-15", supplyPeriod: { periodStart: "2026-07-01", periodEnd: "2026-08-01" }, customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", currency: "EUR", taxTreatment: "EXCLUDED", consumption: { basis: "PERIOD", unit: "KWH", f1: 600, f2: 300, f3: 100 } }, tenant);
const states = [
  { kind: "DISPATCHING", state: "RESOLVED_EXPLICIT", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" },
  { kind: "CAPACITY_MARKET", state: "RESOLVED_INCLUDED", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" },
];
const commercialComponent = { componentId: "energy:fixed", category: "ENERGY", label: "Energia", sign: "CHARGE", amount: money(20000), formulaId: "EE_FIXED_PRICE_TIMES_KWH", formulaInputs: { taxTreatment: "EXCLUDED" } };
const regulatedComponents = regulated.map((component, index) => ({ componentId: `regulated:${component}`, category: component.endsWith("POWER") ? "REGULATED_POWER" : component.endsWith("FIXED") ? "REGULATED_FIXED" : "REGULATED_ENERGY", label: component, sign: "CHARGE", amount: money(100), formulaId: "REGULATED_TEST_RATE", formulaInputs: { component, index } }));
const base = { schemaVersion: 1, engineVersion: "1", calculationId: "calc_placeholder", fingerprint: "placeholder", calculatedAt: "2026-07-15T00:00:00.000Z", tenantId: tenant, vector: "EE", customerCategory: "NON_RESIDENTIAL", voltageLevel: "LV", calculationDate: "2026-07-15", supplyPeriod: request.supplyPeriod, currency: "EUR", taxTreatment: "EXCLUDED", normalizedInput: request, sourceCte: { archiveId: "bta6-proposal", cteId: "bta6-proposal", versionId: "bta6-proposal-v", version: "1", supplier: "BTA6 Seller", offerCode: "BTA6-OFFER" }, marketData: [], components: [commercialComponent, ...regulatedComponents], totalCommercialCost: money(20000), totalRegulatedSubsetCost: money(1400), totalCommercialPlusRegulatedSubsetCost: money(21400), costScope: COMPLETE, regulatedComponentsIncluded: regulated, regulatoryData: { references: [] }, unitCost: { amount: 0.2, unit: "EUR_PER_KWH", currency: "EUR" }, savingsVsBaseline: null, warnings: [], roundingPolicy: "ROUND_HALF_UP_TO_CENT_PER_COMPONENT", contractualPassThroughCompleteness: "COMPLETE", contractualPassThroughStates: states, bta6NetOfTaxCompleteCandidate: true };
const nextFingerprint = fingerprint(calculationPayloadForFingerprint(base));
const calculation = { ...base, calculationId: `calc_${nextFingerprint.slice(0, 32)}`, fingerprint: nextFingerprint };
const proposal = generateProposal({ schemaVersion: 1, tenantId: tenant, sourceType: "CALCULATION", calculation, selectedOffer: { archiveId: "bta6-proposal", cteId: "bta6-proposal", versionId: "bta6-proposal-v", version: "1", supplier: "BTA6 Seller", offerCode: "BTA6-OFFER" }, customer: { customerId: "customer", category: "NON_RESIDENTIAL" }, supply: { supplyId: "supply", pod: "POD-BTA6", voltageLevel: "LV" }, proposalIssueDate: "2026-07-16", offerValidity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, requestedExportFormat: "JSON" }, tenant);
assert.equal(proposal.costScope, COMPLETE);
assert.equal(proposal.comparisonCost.minorUnits, 21400);
assert.equal(proposal.commercialCost.minorUnits, 20000);
assert.equal(proposal.contractualPassThrough?.bta6NetOfTaxComplete, true);
assert.equal(proposal.contractualPassThrough?.states[0].kind, "DISPATCHING");
assert.deepEqual(proposal.notCalculated, ["VAT", "EXCISE", "OTHER_APPLICABLE_TAXES_OR_FISCAL_COMPONENTS"]);
assert.equal(proposal.disclaimer, notice);
const json = exportJson(proposal, tenant).body;
const csv = exportCsv(proposal, tenant).body;
const html = exportHtml(proposal, tenant).body;
assert.ok(json.includes('"contractualPassThrough"'));
assert.ok(csv.includes("contractualPassThroughCompleteness") && csv.includes("RESOLVED_EXPLICIT") && csv.includes("RESOLVED_INCLUDED"));
assert.ok(html.includes("Contractual pass-through") && html.includes("DISPATCHING") && html.includes("CAPACITY_MARKET") && html.includes("2026-07-01"));
assert.ok(html.includes(notice));
console.log("BTA6_PROPOSAL_COMPLETE_SCOPE=PASS");
console.log("BTA6_PROPOSAL_CONTRACTUAL_STATES=PASS");
console.log("BTA6_PROPOSAL_NOT_CALCULATED_FISCAL_ONLY=PASS");
console.log("BTA6_PROPOSAL_JSON_CSV_HTML=PASS");
console.log("bta6-proposal-transparency smoke: ok");
