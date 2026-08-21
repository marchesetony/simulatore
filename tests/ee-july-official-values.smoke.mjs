import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const archive = JSON.parse(await readFile("var/foundation-regulatory-data/records.json", "utf8"));
const values = archive.regulatoryValues.filter((item) => item.tenantId === "tenant_local-demo");
const key = (item) => [item.componentCode, item.customerScope, item.effectiveFrom, item.normalizedUnit].join("|");
assert.equal(new Set(values.map(key)).size, values.length);
const july = values.find((item) => item.componentCode === "NETWORK_FIXED" && item.customerScope === "DOMESTIC_RESIDENT_BT");
assert.deepEqual({ value: july.originalValue, unit: july.originalUnit, normalized: july.normalizedValue, normalizedUnit: july.normalizedUnit }, { value: 23.04, unit: "EUR/POD/YEAR", normalized: 23.04, normalizedUnit: "EUR/POD/YEAR" });
const capacity = values.find((item) => item.componentCode === "CAPACITY_MARKET_OFF_PEAK");
assert.deepEqual({ value: capacity.originalValue, unit: capacity.originalUnit, normalized: capacity.normalizedValue, normalizedUnit: capacity.normalizedUnit }, { value: 3.197, unit: "EUR/MWH", normalized: 0.003197, normalizedUnit: "EUR/KWH" });
assert.equal(values.filter((item) => item.officialIdentifier === "587/2025/R/eel").length, 2);
assert.equal(values.some((item) => item.authority === "TERNA" && item.componentCode === "DISPATCHING_TOTAL"), false);
assert.ok(values.every((item) => /^[a-f0-9]{64}$/.test(item.sourceSha256)));
console.log("ARERA_JULY_ORIGINAL_UNITS_PRESERVED=PASS");
console.log("ARERA_587_VALUES_IMPORTED=PASS");
console.log("TERNA_CAPACITY_Q3_OFF_PEAK_IMPORTED=PASS");
console.log("TERNA_TIDE_NO_FAKE_VALUE_WHEN_PDF_HAS_NO_TEXT=PASS");
console.log("REGULATORY_SEMANTIC_DUPLICATES=0");
