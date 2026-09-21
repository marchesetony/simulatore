import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { validateCteContract } from "../app/lib/cte/validation.ts";
import { approveCteArchive, createCteArchive, reviewCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";

const field = (path, value, sourceText = typeof value === "string" ? value : "document evidence") => ({
  path,
  value,
  confidence: 0.98,
  sourcePage: 1,
  sourceText,
  status: value === null ? "NOT_FOUND" : "CONFIRMED",
});

const extraction = normalizeProviderExtraction({
  schemaVersion: 1,
  documentType: "CTE",
  vector: "GAS",
  fields: [
    field("supplier.name", "Synthetic Gas Supplier S.p.A."),
    field("supplier.supplierId", "01234567890", "P.IVA: 01234567890"),
    field("offer.name", "Synthetic GAS Fixed"),
    field("offer.code", "GAS-FIXED-SMOKE"),
    field("validity.periodStart", "2026-01-01"),
    field("validity.periodEnd", "2026-12-31"),
    field("eligibility.customerTypes", "Clienti domestici"),
    field("pricing.mode", "Prezzo fisso"),
    field("pricing.fixedPrice.amount", "0,42 EUR/Smc"),
    field("currency", "EUR"),
    field("taxTreatment", "IVA esclusa"),
  ],
  extractionNotes: [],
}, "tenant_gas-authoritative-smoke");

const result = tryBuildAuthoritativeCteContract({
  ingestionId: "cte-gas-authoritative-smoke",
  documentId: "cte-gas-authoritative-document",
  tenantId: "tenant_gas-authoritative-smoke",
  documentType: extraction.documentType,
  vector: extraction.vector,
  fields: extraction.fields,
});

const canonicalModeResult = tryBuildAuthoritativeCteContract({
  ingestionId: "cte-gas-authoritative-canonical",
  documentId: "cte-gas-authoritative-canonical-document",
  tenantId: "tenant_gas-authoritative-smoke",
  documentType: extraction.documentType,
  vector: extraction.vector,
  fields: extraction.fields.map((candidate) => candidate.path === "pricing.mode" ? { ...candidate, value: "FIXED", normalizedValue: "FIXED" } : candidate),
});
assert.equal(canonicalModeResult.errorCode, null, JSON.stringify(canonicalModeResult));
assert.equal(canonicalModeResult.contract.pricing.mode, "FIXED");

assert.equal(result.errorCode, null);
assert.deepEqual(result.validationPaths, []);
assert.ok(result.contract);
validateCteContract(result.contract);

assert.equal(result.contract.vector, "GAS");
assert.deepEqual(result.contract.pricing, {
  mode: "FIXED",
  reference: "NONE",
  fixedPrice: { amount: 0.42, currency: "EUR", unit: "EUR_PER_SMC", taxTreatment: "EXCLUDED" },
  spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" },
});
assert.equal(result.contract.pricing.reference, "NONE");
assert.equal("PSV" in result.contract.pricing, false);

assert.throws(() => validateCteContract({ ...result.contract, pricing: { ...result.contract.pricing, fixedPrice: { ...result.contract.pricing.fixedPrice, amount: 0 } } }), /CTE_PRICE_INVALID/);
assert.throws(() => validateCteContract({ ...result.contract, pricing: { ...result.contract.pricing, fixedPrice: { ...result.contract.pricing.fixedPrice, amount: -0.01 } } }), /CTE_PRICE_INVALID/);
assert.throws(() => validateCteContract({ ...result.contract, pricing: { ...result.contract.pricing, fixedPrice: { ...result.contract.pricing.fixedPrice, amount: Number.NaN } } }), /CTE_PRICE_INVALID/);
assert.throws(() => validateCteContract({ ...result.contract, pricing: { ...result.contract.pricing, fixedPrice: { ...result.contract.pricing.fixedPrice, unit: "EUR_PER_KWH" } } }), /CTE_PRICE_UNIT_INVALID/);
const missingFixed = tryBuildAuthoritativeCteContract({ ...extraction, fields: extraction.fields.filter((candidate) => candidate.path !== "pricing.fixedPrice.amount") });
assert.equal(missingFixed.contract, null);
assert.ok(missingFixed.validationPaths.includes("pricing.fixedPrice.amount"));

const root = await mkdtemp(path.join(os.tmpdir(), "cte-gas-authoritative-"));
try {
  const repository = new LocalCteArchiveRepository(root);
  const contract = { ...structuredClone(result.contract), approval: { status: "DRAFT", reason: "READY_FOR_REVIEW" } };
  const created = await createCteArchive(repository, { tenantId: contract.tenantId, contract, actor: "gas-reviewer", now: "2026-01-01T00:00:00.000Z" });
  const reviewed = await reviewCteArchive(repository, contract.tenantId, created.archiveId, created.currentWorkingVersionId, "gas-reviewer", "2026-01-01T00:00:01.000Z");
  const approved = await approveCteArchive(repository, contract.tenantId, reviewed.archiveId, reviewed.currentWorkingVersionId, "gas-approver", "gas-decision", "2026-01-01T00:00:02.000Z", async () => {});
  assert.equal(approved.vector, "GAS");
  assert.equal(approved.currentApprovedVersionId, reviewed.currentWorkingVersionId);
  await assert.rejects(() => approveCteArchive(repository, "tenant_other", reviewed.archiveId, reviewed.currentWorkingVersionId, "gas-approver", "cross-tenant"), /CTE_ARCHIVE_NOT_FOUND/);
  await assert.rejects(() => approveCteArchive(repository, contract.tenantId, reviewed.archiveId, "stale-version", "gas-approver", "stale"), /CTE_VERSION_NOT_CURRENT/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("cte GAS authoritative contract smoke: ok (fixed GAS review path, typed EUR_PER_SMC contract, no PSV automation)");
