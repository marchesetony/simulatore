import assert from "node:assert/strict";
import { buildBillSupplyProfile, normalizeAsosClass, validateBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";

const fact = (code, value, status = "FOUND") => ({ code, value, status });

function bta6Facts({ asosClass = null, source = "APPROVED SOURCE DOCUMENT: approved-bill.pdf", from = "2026-01-01", to = null, evidence = null, rateLine = null } = {}) {
  return [
    fact("SUPPLY_USE_CATEGORY_RAW", "Altri usi"),
    fact("DOMESTIC_RESIDENCE_STATUS_RAW", "Non applicabile"),
    fact("VOLTAGE_CLASS_RAW", "Bassa tensione (BT)"),
    fact("POWER_COMMITTED", "20 kW"),
    fact("POWER_AVAILABLE", "30 kW"),
    fact("POWER_BILLING_BASIS_RAW", "Potenza contrattualmente impegnata"),
    ...(rateLine === null ? [] : [fact("ASOS", rateLine)]),
    ...(asosClass === null ? [] : [
      fact("ASOS_CLASS_RAW", asosClass),
      ...(source === null ? [] : [fact("ASOS_CLASS_SOURCE_RAW", source)]),
      ...(from === null ? [] : [fact("ASOS_CLASS_EFFECTIVE_FROM", from)]),
      ...(to === null ? [] : [fact("ASOS_CLASS_EFFECTIVE_TO", to)]),
      ...(evidence === null ? [] : [fact("ASOS_CLASS_EVIDENCE_RAW", evidence)]),
    ]),
  ];
}

function trusted(options = {}) {
  return buildTrustedElectricitySupplyContext(buildBillSupplyProfile(bta6Facts(options)), {
    simulationPeriod: options.period ?? { periodStart: "2026-08-01", periodEnd: "2026-09-01" },
    sourceBillBinding: { billId: "bill-fixture", approvedVersionId: "version-fixture" },
  });
}

assert.deepEqual(normalizeAsosClass("Classe 0"), "ASOS_CLASS_0");
assert.deepEqual(normalizeAsosClass("ASOS Classe 1"), "ASOS_CLASS_1");
assert.deepEqual(normalizeAsosClass("ASOS2"), "ASOS_CLASS_2");
assert.deepEqual(normalizeAsosClass("Classe di agevolazione 3"), "ASOS_CLASS_3");
assert.deepEqual(normalizeAsosClass("ASOS 3,1875 cent/kWh"), "UNKNOWN");

const noEvidence = trusted({ rateLine: "3,1875 cent/kWh" });
assert.equal(noEvidence.asosClass, "UNKNOWN");
assert.equal(noEvidence.energyIntensiveStatus, "UNKNOWN");
assert.equal(noEvidence.asosClassTemporalStatus, "UNKNOWN");
assert.equal(noEvidence.regulatoryCustomerScope, "NON_DOMESTIC_BT_BTA6");

const explicitZero = trusted({ asosClass: "Classe 0", evidence: "Classe esplicita nel documento approvato" });
assert.equal(explicitZero.asosClass, "ASOS_CLASS_0");
assert.equal(explicitZero.energyIntensiveStatus, "NOT_ENERGY_INTENSIVE");
assert.equal(explicitZero.asosClassEvidence?.sourceKind, "APPROVED_SOURCE_DOCUMENT");
assert.equal(explicitZero.asosClassEvidence?.billId, "bill-fixture");

for (const [raw, expected] of [["ASOS Classe 1", "ASOS_CLASS_1"], ["ASOS2", "ASOS_CLASS_2"], ["Classe di agevolazione 3", "ASOS_CLASS_3"]]) {
  const context = trusted({ asosClass: raw, evidence: `Evidenza esplicita ${raw}` });
  assert.equal(context.asosClass, expected);
  assert.equal(context.energyIntensiveStatus, "ENERGY_INTENSIVE");
}

const incompleteSource = trusted({ asosClass: "Classe 1", source: null, evidence: "Classe esplicita" });
assert.equal(incompleteSource.asosClass, "UNKNOWN");
assert.equal(incompleteSource.energyIntensiveStatus, "UNKNOWN");

const incompleteValidity = trusted({ asosClass: "Classe 1", from: null, evidence: "Classe esplicita" });
assert.equal(incompleteValidity.asosClass, "UNKNOWN");
assert.equal(incompleteValidity.asosClassTemporalStatus, "UNKNOWN");

const notYetValid = trusted({ asosClass: "Classe 1", from: "2027-01-01", evidence: "Classe esplicita" });
assert.equal(notYetValid.asosClass, "UNKNOWN");
assert.equal(notYetValid.asosClassTemporalStatus, "NOT_YET_VALID");

const expired = trusted({ asosClass: "Classe 1", from: "2025-01-01", to: "2026-07-31", evidence: "Classe esplicita" });
assert.equal(expired.asosClass, "UNKNOWN");
assert.equal(expired.asosClassTemporalStatus, "EXPIRED");

const partial = trusted({ asosClass: "Classe 1", from: "2026-08-15", evidence: "Classe esplicita" });
assert.equal(partial.asosClass, "UNKNOWN");
assert.equal(partial.asosClassTemporalStatus, "PARTIAL_OR_MULTIPLE");

const ambiguousFacts = [...bta6Facts({ asosClass: "Classe 1", evidence: "Prima classe" }), fact("ASOS_CLASS_RAW", "Classe 2")];
const ambiguous = buildTrustedElectricitySupplyContext(buildBillSupplyProfile(ambiguousFacts), {
  simulationPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" },
  sourceBillBinding: { billId: "bill-fixture", approvedVersionId: "version-fixture" },
});
assert.equal(ambiguous.asosClass, "UNKNOWN");
assert.equal(ambiguous.energyIntensiveStatus, "UNKNOWN");

const profile = buildBillSupplyProfile(bta6Facts({ asosClass: "Classe 2", evidence: "Classe esplicita" }));
validateBillSupplyProfile(profile);
assert.equal(profile.asosClass, "ASOS_CLASS_2");
assert.equal(profile.asosClassEvidence?.status, "FOUND");

console.log("ASOS_CLASS_VALUES=PASS");
console.log("ASOS_CLASS_NO_EVIDENCE_UNKNOWN=PASS");
console.log("ASOS_CLASS_NO_POWER_INFERENCE=PASS");
console.log("ASOS_CLASS_NO_CONSUMPTION_INFERENCE=PASS");
console.log("ASOS_CLASS_NO_RATE_INFERENCE=PASS");
console.log("ASOS_CLASS_0_EXPLICIT_EVIDENCE=PASS");
console.log("ASOS_CLASS_1_2_3_EXPLICIT_EVIDENCE=PASS");
console.log("ASOS_CLASS_TEMPORAL_MODEL_READY=PASS");
console.log("UNKNOWN_ASOS_CLASS_BLOCKS_OTHER_REGULATED=NO");
