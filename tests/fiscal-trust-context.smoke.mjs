import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { buildTrustedElectricitySupplyContext } from "../app/lib/calculation/trusted-ee-supply-context.ts";
import { buildTrustedElectricityFiscalContext, fiscalTreatmentFromAtecoOnly } from "../app/lib/calculation/trusted-ee-fiscal-context.ts";

const fact = (code, value, status = "FOUND") => ({ code, value, status });
const source = {
  sourceKind: "APPROVED_SOURCE_BILL",
  sourceReference: "bill-document:bill-fiscal-context",
  approvedBillBinding: { billId: "bill-fiscal-context", approvedVersionId: "version-fiscal-context" },
};

function profile({ supplyUse = "domestico", residence = "residente", committed = "3 kW", available = "6 kW" } = {}) {
  return buildBillSupplyProfile([
    fact("SUPPLY_USE_CATEGORY_RAW", supplyUse),
    fact("DOMESTIC_RESIDENCE_STATUS_RAW", residence),
    fact("VOLTAGE_CLASS_RAW", "BT"),
    ...(committed === null ? [] : [fact("POWER_COMMITTED", committed)]),
    ...(available === null ? [] : [fact("POWER_AVAILABLE", available)]),
    ...(supplyUse === "altri usi" ? [fact("POWER_BILLING_BASIS_RAW", "Potenza contrattualmente impegnata")] : []),
  ]);
}

function fiscalContext(facts, supply = profile(), options = {}) {
  return buildTrustedElectricityFiscalContext({
    supplyContext: buildTrustedElectricitySupplyContext(supply),
    extendedFacts: facts,
    simulationPeriod: { periodStart: "2026-08-01", periodEnd: "2026-09-01" },
    ...options,
  });
}

const noEvidence = fiscalContext([]);
assert.equal(noEvidence.exciseTaxTreatment, "UNKNOWN");
assert.equal(noEvidence.vatTreatment, "UNKNOWN");
assert.equal(noEvidence.mixedUseStatus, "UNKNOWN");
assert.equal(noEvidence.monthlyProfileStatus, "MONTHLY_PROFILE_MISSING");

const bta6WithoutDeclaration = fiscalContext([
  fact("VAT_TREATMENT_RAW", "QUALIFIED_BUSINESS_REDUCED"),
], profile({ supplyUse: "altri usi", committed: "17 kW", available: "18 kW" }));
assert.equal(bta6WithoutDeclaration.vatTreatment, "UNKNOWN");

const highConsumptionWithoutExciseEvidence = fiscalContext([
  fact("EXCISE_TREATMENT_RAW", "EXEMPT"),
], profile({ supplyUse: "altri usi", committed: "17 kW", available: "18 kW" }));
assert.equal(highConsumptionWithoutExciseEvidence.exciseTaxTreatment, "UNKNOWN");
assert.equal(highConsumptionWithoutExciseEvidence.exciseSpecialUse, "UNKNOWN");

const economicLineOnly = buildTrustedElectricityFiscalContext({
  supplyContext: buildTrustedElectricitySupplyContext(profile()),
  extendedFacts: [],
  economicChargeLines: [
    { code: "VAT", description: "IVA 10%", amount: "10%" },
    { code: "EXCISE", description: "ACCISA", amount: "accisa" },
  ],
});
assert.equal(economicLineOnly.exciseTaxTreatment, "UNKNOWN");
assert.equal(economicLineOnly.vatTreatment, "UNKNOWN");

const domestic = fiscalContext([fact("MONTHLY_PROFILE_RAW", "profilo mensile esplicito")]);
assert.equal(domestic.supplyContext.supplyUseCategory, "DOMESTIC");
assert.equal(domestic.supplyContext.domesticResidenceStatus, "RESIDENT");
assert.equal(domestic.supplyContext.contractedPowerKw, 3);
assert.equal(domestic.monthlyProfileStatus, "MONTHLY_PROFILE_AVAILABLE");
assert.equal(domestic.exciseTaxTreatment, "UNKNOWN");
assert.equal(domestic.vatTreatment, "UNKNOWN");

assert.throws(() => buildTrustedElectricitySupplyContext(profile({ committed: null, available: "6 kW" })), /CONTRACTED_POWER_REQUIRED/);
assert.deepEqual(fiscalTreatmentFromAtecoOnly(), { exciseTaxTreatment: "UNKNOWN", vatTreatment: "UNKNOWN" });

const explicit = fiscalContext([
  fact("EXCISE_TREATMENT_RAW", "TAXABLE"),
  fact("EXCISE_SPECIAL_USE_RAW", "ORDINARY"),
  fact("EXCISE_EVIDENCE_RAW", "ADM-EXC-2026-01::Accisa applicata secondo la dichiarazione approvata"),
  fact("VAT_TREATMENT_RAW", "STANDARD"),
  fact("VAT_DECLARATION_REFERENCE", "VAT-DECL-2026-01"),
  fact("VAT_EVIDENCE_RAW", "Trattamento standard esplicitamente dichiarato nel documento approvato"),
  fact("MIXED_USE_RAW", "SINGLE_USE"),
  fact("MIXED_USE_EVIDENCE_RAW", "BILL-MIX-2026-01::Uso singolo esplicitamente dichiarato nel documento approvato"),
  fact("FISCAL_EVIDENCE_EFFECTIVE_FROM", "2026-01-01"),
], profile(), { evidenceSource: source });
assert.equal(explicit.exciseTaxTreatment, "TAXABLE");
assert.equal(explicit.exciseSpecialUse, "ORDINARY");
assert.equal(explicit.vatTreatment, "STANDARD");
assert.equal(explicit.mixedUseStatus, "SINGLE_USE");
assert.equal(explicit.exciseEvidence?.approvedBillBinding?.approvedVersionId, "version-fiscal-context");
assert.equal(explicit.vatEvidence?.evidenceReference, "VAT-DECL-2026-01");
assert.equal(explicit.mixedUseEvidence?.sourceKind, "APPROVED_SOURCE_BILL");
assert.equal(explicit.fiscalEvidenceTemporalStatus, "VALID");

const expired = fiscalContext([
  fact("EXCISE_TREATMENT_RAW", "EXEMPT"),
  fact("EXCISE_EVIDENCE_RAW", "ADM-EXC-OLD::Esenzione autorizzata per uso documentato"),
  fact("FISCAL_EVIDENCE_EFFECTIVE_FROM", "2025-01-01"),
  fact("FISCAL_EVIDENCE_EFFECTIVE_TO", "2026-01-07"),
], profile(), { evidenceSource: source });
assert.equal(expired.exciseTaxTreatment, "UNKNOWN");
assert.equal(expired.exciseEvidence?.status, "EXPIRED");

const invalidBareEvidence = fiscalContext([
  fact("EXCISE_TREATMENT_RAW", "EXEMPT"),
  fact("EXCISE_EVIDENCE_RAW", "ADM-EXC-BARE::Esente accisa"),
  fact("FISCAL_EVIDENCE_EFFECTIVE_FROM", "2026-01-01"),
], profile(), { evidenceSource: source });
assert.equal(invalidBareEvidence.exciseTaxTreatment, "UNKNOWN");

const fiscalSource = await readFile(new URL("../app/lib/calculation/trusted-ee-fiscal-context.ts", import.meta.url), "utf8");
assert.doesNotMatch(fiscalSource, /economicChargeLines|taxTreatment|0\.0227|0\.0125|0\.0075|4820|IVA\s*10|IVA\s*22/);
assert.doesNotMatch(fiscalSource, /fetch\s*\(|https?:\/\//i);

console.log("FISCAL_UNKNOWN_DEFAULTS=PASS");
console.log("ATECO_ONLY_GATE=PASS");
console.log("POWER_COMMITTED_REUSED=PASS");
console.log("AVAILABLE_POWER_CANNOT_REPLACE_COMMITTED=PASS");
console.log("EXPLICIT_APPROVED_EVIDENCE=PASS");
console.log("EXPIRED_EVIDENCE_FAIL_CLOSED=PASS");
console.log("ORDINARY_DISTINCT_FROM_UNKNOWN=PASS");
console.log("MONTHLY_PROFILE_STATUS_ONLY=PASS");
