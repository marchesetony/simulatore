import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";
import { deriveBillDrivenContextAlerts } from "../app/lib/calculation/bill-driven.ts";
import { LocalBillRepository } from "../app/lib/foundation/real-bill.ts";

const tenantId = "tenant_qa-company";
const facts = ({ use = "Domestico", residence = "Residente", committed = "3 kW", available = null } = {}) => [
  { code: "SUPPLY_USE_CATEGORY_RAW", value: use, status: "FOUND" },
  { code: "DOMESTIC_RESIDENCE_STATUS_RAW", value: residence, status: "FOUND" },
  { code: "VOLTAGE_CLASS_RAW", value: "BT / LV", status: "FOUND" },
  { code: "POWER_COMMITTED", value: committed, status: "FOUND" },
  ...(available === null ? [] : [{ code: "POWER_AVAILABLE", value: available, status: "FOUND" }]),
  { code: "POWER_BILLING_BASIS_RAW", value: "Potenza contrattualmente impegnata", status: "FOUND" },
];
const trusted = (input) => buildTrustedElectricitySupplyContext(buildBillSupplyProfile(facts(input)));

assert.equal(trusted({ available: "3.3 kW" }).availablePowerKw, 3.3);
console.log("AVAILABLE_POWER_PRESENT_USED_AS_IS=PASS");
assert.equal(trusted().availablePowerKw, undefined);
console.log("AVAILABLE_POWER_MISSING_NOT_DERIVED=PASS");
assert.notEqual(trusted().availablePowerKw, 3.3);
console.log("AVAILABLE_POWER_NO_10_PERCENT_RULE=PASS");
assert.throws(() => trusted({ use: "Altri usi", residence: "Non applicabile", committed: "20 kW" }), /AVAILABLE_POWER_REQUIRED_FOR_BT_TARIFF_CLASS/);
console.log("BTA6_MISSING_AVAILABLE_POWER_FAIL_CLOSED=YES");
assert.equal(deriveBillDrivenContextAlerts({ vector: "EE", domestic: true, contractedPowerKw: 20 }).length, 1);
console.log("DOMESTIC_HIGH_POWER_ALERT_STILL_WORKS=PASS");
assert.equal(trusted({ committed: "20 kW" }).regulatoryCustomerScope, "DOMESTIC_RESIDENT_BT");
console.log("DOMESTIC_20KW_NOT_AUTO_BTA6=PASS");

const repository = new LocalBillRepository("var/foundation-documents");
for (const [fileName, committed] of [["BILL_QA_DOMESTIC_3KW.pdf", "3"], ["BILL_QA_DOMESTIC_20KW.pdf", "20"]]) {
  const document = (await repository.list(tenantId)).find((item) => item.fileName === fileName && item.currentApprovedVersionId !== null);
  assert.ok(document, `${fileName} approved fixture missing`);
  const version = document.versions.find((item) => item.versionId === document.currentApprovedVersionId);
  assert.equal(version?.structuredBill?.supplyProfile?.powerAvailable.status, "NOT_FOUND");
  assert.equal(version?.structuredBill?.supplyProfile?.powerCommitted.rawValue, `${committed} kW`);
}

const panel = await readFile("app/components/BillDrivenSimulationPanel.tsx", "utf8");
assert.match(panel, /availablePowerKw === null/);
assert.doesNotMatch(panel, /disponibile \$\{text\(context\.supply\.availablePowerKw\)\}/);
console.log("AVAILABLE_POWER_UI_OMITTED_WHEN_MISSING=PASS");
console.log("AVAILABLE_POWER_NO_DERIVATION_SMOKE=PASS");
