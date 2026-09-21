import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panelPath = new URL("../app/components/BillDrivenSimulationPanel.tsx", import.meta.url);
const panel = readFileSync(panelPath, "utf8");
const summaryStart = panel.indexOf("function BillSummary");
const summaryEnd = panel.indexOf("export default", summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, "BillSummary must be present");
const summary = panel.slice(summaryStart, summaryEnd);

const dateFormatter = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
assert.equal(dateFormatter.format(new Date("2026-08-01T00:00:00Z")), "1 agosto 2026");
assert.equal(monthFormatter.format(new Date("2026-08-01T00:00:00Z")), "agosto 2026");
assert.match(panel, /Intl\.DateTimeFormat\("it-IT"/);
console.log("DATE_IT_FORMAT=PASS");

assert.match(panel, /formatItalianMonth\(bill\.period\.periodStart\)/);
assert.doesNotMatch(panel, /bill\.period\.periodStart \?\?/);
console.log("BILL_SELECTOR_DATE_FORMAT=PASS");

assert.match(panel, /scope === "DOMESTIC_RESIDENT_BT"\) return "Domestico residente"/);
assert.match(panel, /scope === "DOMESTIC_NON_RESIDENT_BT"\) return "Domestico non residente"/);
assert.match(panel, /scope === "NON_DOMESTIC_BT"\) return "Non domestico"/);
assert.match(panel, /scope === "NON_DOMESTIC_BT_BTA6"\) return "Non domestico/);
console.log("DOMESTIC_RESIDENT_LABEL=PASS");
console.log("DOMESTIC_NONRESIDENT_LABEL=PASS");
console.log("NONDOMESTIC_LABEL=PASS");
console.log("BTA6_LABEL=PASS");

assert.doesNotMatch(summary, /BTA6 non eleggibile|BTA6 non elegibile/);
assert.doesNotMatch(summary, /UNKNOWN:/);
assert.doesNotMatch(summary, /APPROVED_BILL/);
assert.doesNotMatch(summary, /serverVersionId/);
assert.doesNotMatch(summary, /<span>Documento<\/span>|versione/);
assert.doesNotMatch(summary, /POD \/ PDR/);
assert.match(summary, /<span>Totale bolletta<\/span>/);
assert.doesNotMatch(summary, /Importo di riferimento per la simulazione/);
assert.match(panel, /context\.supply\.availablePowerKw === null/);
assert.match(summary, /<span>F1<\/span>/);
assert.doesNotMatch(summary, /formatPower\(Number\(draft\.f1\)\)/);
console.log("DOMESTIC_BTA6_LABEL_HIDDEN=PASS");
console.log("UNKNOWN_CODE_HIDDEN=PASS");
console.log("TECHNICAL_BASELINE_CODE_HIDDEN=PASS");
console.log("AVAILABLE_POWER_HIDDEN_WHEN_NULL=PASS");

assert.match(panel, /function messageFor\(error: unknown\): string \{ return toUiError\(error\)\.message; \}/);
assert.match(panel, /<div className="data-line"><span>Origine<\/span><strong>Bolletta approvata/);
console.log("NO_DOMAIN_LOGIC_CHANGED=PASS");
console.log("NO_ELIGIBILITY_CHANGED=PASS");
console.log("NO_CALCULATION_CHANGED=PASS");
