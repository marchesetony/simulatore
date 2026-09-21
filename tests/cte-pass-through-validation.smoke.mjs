import assert from "node:assert/strict";

import { normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { syntheticElectricityCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { normalizeCteReview } from "../app/lib/cte/review.ts";
import { assertPassThroughComponents, validateCteContract } from "../app/lib/cte/validation.ts";

const fee = (feeId, amount = 0.01, unit = "EUR_PER_KWH", taxTreatment = "EXCLUDED") => ({ feeId, label: feeId, amount, currency: "EUR", unit, taxTreatment });
const pass = (kind, declarationState, options = {}) => ({ componentId: options.componentId ?? `${kind.toLowerCase()}-${declarationState.toLowerCase()}`, kind, declarationState, effectiveFrom: options.effectiveFrom ?? "2026-01-01", effectiveTo: options.effectiveTo ?? "2026-03-01", ...(declarationState === "EXPLICIT_COMPONENT" ? { fee: fee(options.feeId ?? `${kind.toLowerCase()}-fee`, options.amount ?? 0.01, options.unit ?? "EUR_PER_KWH", options.taxTreatment ?? "EXCLUDED") } : {}), ...(declarationState === "EXTERNAL_PASS_THROUGH" ? { externalReference: options.externalReference ?? "approved-cte:dispatching" } : {}) });
const validContract = (components) => ({ ...structuredClone(syntheticElectricityCte), validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" }, commercialTerms: { ...structuredClone(syntheticElectricityCte.commercialTerms), passThroughComponents: components } });

validateCteContract(validContract([
  pass("DISPATCHING", "EXPLICIT_COMPONENT"),
  pass("CAPACITY_MARKET", "INCLUDED_IN_ENERGY_PRICE"),
]));
assert.throws(() => assertPassThroughComponents([pass("DISPATCHING", "EXPLICIT_COMPONENT"), pass("DISPATCHING", "INCLUDED_IN_ENERGY_PRICE", { effectiveFrom: "2026-02-01" })]), /CTE_PASS_THROUGH_OVERLAP/);
assert.throws(() => validateCteContract(validContract([pass("DISPATCHING", "EXPLICIT_COMPONENT", { taxTreatment: "INCLUDED" })])), /CTE_PASS_THROUGH_TAX_INVALID/);
assert.throws(() => validateCteContract(validContract([pass("DISPATCHING", "EXPLICIT_COMPONENT", { unit: "EUR_PER_YEAR" })])), /CTE_PASS_THROUGH_UNIT_INVALID/);
assert.throws(() => validateCteContract(validContract([pass("DISPATCHING", "NOT_DECLARED", { effectiveFrom: "2025-01-01" })])), /CTE_PASS_THROUGH_PERIOD_OUTSIDE_CTE/);

const extraction = normalizeProviderExtraction({
  schemaVersion: 1,
  documentType: "CTE",
  vector: "EE",
  fields: [{ path: "commercialTerms.passThroughComponents", value: [pass("DISPATCHING", "NOT_DECLARED"), pass("CAPACITY_MARKET", "EXTERNAL_PASS_THROUGH")], confidence: 1, sourcePage: 2, sourceText: "Condizioni contrattuali", status: "CONFIRMED" }],
  extractionNotes: [],
}, "tenant_cte-validation");
const extracted = extraction.fields.find((field) => field.path === "commercialTerms.passThroughComponents");
assert.equal(extracted?.value[0].kind, "DISPATCHING");
assert.equal(extracted?.value[1].declarationState, "EXTERNAL_PASS_THROUGH");
assert.throws(() => normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [{ path: "commercialTerms.passThroughComponents", value: [pass("DISPATCHING", "EXPLICIT_COMPONENT", { effectiveFrom: "2026-02-01", effectiveTo: "2026-01-01" })], confidence: 1, sourcePage: 1, sourceText: "ambiguous", status: "CONFIRMED" }], extractionNotes: [] }, "tenant_cte-validation"), /CTE_PASS_THROUGH_PERIOD_INVALID/);

const review = normalizeCteReview({ vector: "EE", fields: [{ path: "commercialTerms.passThroughComponents", value: [pass("DISPATCHING", "INCLUDED_IN_ENERGY_PRICE")], confidence: 1, sourcePage: 3, sourceText: "Dispacciamento incluso", status: "CONFIRMED" }] });
assert.equal(review.commercialFields.find((field) => field.fieldKey === "commercialTerms.passThroughComponents")?.normalizedValue[0].declarationState, "INCLUDED_IN_ENERGY_PRICE");

console.log("LEGACY_CTE_OPTIONAL_COLLECTION=PASS");
console.log("PASS_THROUGH_TYPED_VALIDATION=PASS");
console.log("PASS_THROUGH_OVERLAP_FAIL_CLOSED=PASS");
console.log("PASS_THROUGH_TAX_AND_UNIT_GUARDS=PASS");
console.log("INGESTION_TYPED_PASS_THROUGH=PASS");
console.log("REVIEW_TYPED_PASS_THROUGH=PASS");
