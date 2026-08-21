import assert from "node:assert/strict";
import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { ARERA_227_PDF_URL, ARERA_588_IDENTIFIER, parseArera588Uc3Uc6TableRows, resolveAreraEffectiveValue } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { auditElectricityBill } from "../app/lib/foundation/bill-regulatory-audit.ts";

const records = parseArera588Uc3Uc6TableRows({
  rows: [["", "Utenza domestica in bassa tensione", "0,276", "", "19,88", "0,007"]],
  retrievedAt: "2026-08-19T00:00:00Z",
  sourceSha256: "a".repeat(64),
});
assert.equal(records.length, 3);
assert.deepEqual(records.map((record) => record.componentCode), ["UC3", "UC6", "UC6"]);
assert.equal(records[0].originalValue, 0.276);
assert.equal(records[0].originalUnit, "CENT_EUR/KWH");
assert.ok(Math.abs(records[0].normalizedValue - 0.00276) < 1e-12);
assert.equal(records[1].originalValue, 19.88);
assert.equal(records[1].originalUnit, "CENT_EUR/KW/YEAR");
assert.equal(records[2].originalValue, 0.007);
assert.equal(records[2].originalUnit, "CENT_EUR/KWH");
assert.equal(records.every((record) => record.officialIdentifier === ARERA_588_IDENTIFIER), true);
assert.equal(records.every((record) => record.effectiveFrom === "2026-07-01"), true);
assert.equal(records[0].carriedForwardFrom, "2026-01-01");
assert.equal(records[0].confirmationSource, ARERA_227_PDF_URL);
console.log("UC3_PARSER=OK");
console.log("UC6_PARSER=OK");
console.log("UC6_MULTI_COMPONENT_STRUCTURE=OK");
console.log("OFFICIAL_CARRY_FORWARD=OK");
console.log("EFFECTIVE_DATE_2026_07_01=OK");

assert.equal(resolveAreraEffectiveValue(records, "2026-07-15", "UC6", "DOMESTIC_BT", "EUR/KW/YEAR")?.originalValue, 19.88);
assert.equal(resolveAreraEffectiveValue(records, "2026-07-15", "UC6", "DOMESTIC_BT", "EUR/KWH")?.originalValue, 0.007);
console.log("UC6_UNIT_DISAMBIGUATION=OK");

const withNormalizedValue = (record, normalizedValue) => {
  const copy = { ...record, normalizedValue };
  delete copy.checksum;
  return { ...copy, checksum: checksumFor(copy) };
};
const uc3 = records.find((record) => record.componentCode === "UC3");
const uc6 = records.filter((record) => record.componentCode === "UC6");
const bill = (line) => ({ vector: "EE", customerType: "RESIDENTIAL", domesticResidenceStatus: "UNKNOWN", billingPeriod: { from: "2026-07-01", to: "2026-08-01" }, chargeLines: [line] });
const exact = auditElectricityBill(bill({ code: "UC3", description: "UC3", quantity: 1000, unit: "EUR/KWH", unitPrice: 0.00276, amount: 2.76 }), { regulatoryReferences: [uc3] });
assert.equal(exact.lines[0].auditStatus, "MATCH");
assert.equal(exact.lines[0].notComparableReason, "NONE");
console.log("SCOPE_INDEPENDENT_REGULATED_LINE=OK");
const roundedReference = withNormalizedValue(uc3, 0.0027645);
const rounding = auditElectricityBill(bill({ code: "UC3", description: "UC3", quantity: 1000, unit: "EUR/KWH", unitPrice: 0.002764, amount: 2.76 }), { regulatoryReferences: [roundedReference] });
assert.equal(rounding.lines[0].auditStatus, "ROUNDING_DIFFERENCE");
console.log("ROUNDING=OK");
const overcharge = auditElectricityBill(bill({ code: "UC3", description: "UC3", quantity: 1000, unit: "EUR/KWH", unitPrice: 0.00277, amount: 2.77 }), { regulatoryReferences: [uc3] });
assert.equal(overcharge.lines[0].auditStatus, "OVERCHARGE");
console.log("OVERCHARGE=OK");
const undercharge = auditElectricityBill(bill({ code: "UC3", description: "UC3", quantity: 1000, unit: "EUR/KWH", unitPrice: 0.00275, amount: 2.75 }), { regulatoryReferences: [uc3] });
assert.equal(undercharge.lines[0].auditStatus, "UNDERCHARGE");
console.log("UNDERCHARGE=OK");

const domesticScope = auditElectricityBill(bill({ code: "UC6", description: "UC6", quantity: 1, unit: "EUR/KW/MONTH", unitPrice: 19.88 / 1200, amount: 19.88 / 1200 }), { regulatoryReferences: uc6 });
assert.equal(domesticScope.lines[0].auditStatus, "MATCH");
console.log("SCOPE_DEPENDENT_DOMESTIC_LINE=OK");
const missingQuantity = auditElectricityBill(bill({ code: "UC3", description: "UC3", quantity: null, unit: "EUR", unitPrice: null, amount: 2 }), { regulatoryReferences: [uc3] });
assert.equal(missingQuantity.lines[0].notComparableReason, "QUANTITY_MISSING");
console.log("MISSING_QUANTITY=OK");
const aggregate = auditElectricityBill(bill({ code: "NETWORK_SYSTEM", description: "rete + oneri", quantity: 1000, unit: "EUR/KWH", unitPrice: 0.02, amount: 20 }), { regulatoryReferences: [uc3] });
assert.equal(aggregate.lines[0].auditStatus, "NOT_COMPARABLE");
assert.equal(aggregate.lines[0].notComparableReason, "AGGREGATED_BILL_LINE");
assert.equal(aggregate.summary.confirmedAnomalyCount, 0);
console.log("AGGREGATED_LINE_NO_FALSE_ANOMALY=OK");
console.log("IDEMPOTENCE_CONFLICT=VERIFIED_IN_ARERA_SMOKE");
console.log("arera UC3 UC6 smoke: ok");
