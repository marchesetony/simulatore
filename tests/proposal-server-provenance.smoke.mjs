import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syntheticElectricityCte, syntheticGasCte } from "../app/lib/cte/synthetic-fixtures.ts";
import { createCteArchive } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { calculateApprovedOffer } from "../app/lib/calculation/engine.ts";
import { parseSimulationRequest } from "../app/lib/calculation/input.ts";
import { compareApprovedOffers } from "../app/lib/comparison/service.ts";
import { syntheticGasPsv } from "../app/lib/energy/synthetic-fixtures.ts";
import { createMarketArchive } from "../app/lib/market/service.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { generateProposal } from "../app/lib/proposal/service.ts";
import { resolveAuthoritativeProposalInput } from "../app/lib/proposal/server.ts";
import { exportPdf } from "../app/lib/export/pdf.ts";

const tenant = "tenant_proposal-security";
const otherTenant = "tenant_proposal-other";
const approval = { status: "APPROVED", reviewer: "security-smoke", reviewedAt: "2026-01-02T00:00:00.000Z", decisionId: "security-smoke-approval" };

function gasRequest(requestTenant = tenant) {
  return parseSimulationRequest({
    schemaVersion: 1,
    tenantId: requestTenant,
    vector: "GAS",
    calculationDate: "2026-01-15",
    supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" },
    customerCategory: "NON_RESIDENTIAL",
    currency: "EUR",
    taxTreatment: "EXCLUDED",
    consumption: { basis: "PERIOD", unit: "SMC", smc: 100, correctionCoefficient: { required: true, value: 1.02 } },
  }, requestTenant);
}

function eeRequest(requestTenant = tenant) {
  return parseSimulationRequest({
    schemaVersion: 1,
    tenantId: requestTenant,
    vector: "EE",
    calculationDate: "2026-01-15",
    supplyPeriod: { periodStart: "2026-01-01", periodEnd: "2026-02-01" },
    customerCategory: "NON_RESIDENTIAL",
    voltageLevel: "LV",
    currency: "EUR",
    taxTreatment: "EXCLUDED",
    consumption: { basis: "PERIOD", unit: "KWH", f1: 100, f2: 50, f3: 50 },
  }, requestTenant);
}

function selectedOffer(calculation) {
  return {
    archiveId: calculation.sourceCte.archiveId,
    cteId: calculation.sourceCte.cteId,
    versionId: calculation.sourceCte.versionId,
    version: calculation.sourceCte.version,
    supplier: calculation.sourceCte.supplier,
    offerCode: calculation.sourceCte.offerCode,
  };
}

function proposalFields(calculation) {
  return {
    schemaVersion: 1,
    tenantId: tenant,
    sourceType: "CALCULATION",
    calculationId: calculation.calculationId,
    calculationFingerprint: calculation.fingerprint,
    selectedOffer: selectedOffer(calculation),
    customer: { customerId: "customer-security", category: "NON_RESIDENTIAL" },
    supply: { supplyId: "supply-security", pdr: "PDR-SECURITY" },
    proposalIssueDate: "2026-01-16",
    offerValidity: { periodStart: "2026-01-01", periodEnd: "2026-12-31" },
    requestedExportFormat: "JSON",
  };
}

function eeProposalFields(calculation) {
  return {
    ...proposalFields(calculation),
    supply: { supplyId: "supply-security-ee", pod: "POD-SECURITY", voltageLevel: "LV" },
  };
}

const root = await mkdtemp(path.join(os.tmpdir(), "proposal-server-provenance-"));
try {
  const cteRepository = new LocalCteArchiveRepository(path.join(root, "cte"));
  const marketRepository = new LocalMarketArchiveRepository(path.join(root, "market"));
  const local = new LocalFilesystemAdapter(path.join(root, "records"));
  const calculationResults = local.collection("calculations");
  const comparisonResults = local.collection("comparisons");
  const gasContract = { ...structuredClone(syntheticGasCte), tenantId: tenant, approval };
  const archive = await createCteArchive(cteRepository, { tenantId: tenant, contract: gasContract, now: "2026-01-02T00:00:00.000Z", actor: "SECURITY_SMOKE" });
  const eeContract = { ...structuredClone(syntheticElectricityCte), tenantId: tenant, approval, cteId: "cte-ee-security", recordId: "cte-ee-security", offer: { ...syntheticElectricityCte.offer, offerId: "offer-ee-security", code: "EE-SECURITY-001" }, pricing: { mode: "FIXED", reference: "NONE", fixedPrice: { amount: 0.2, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" }, spread: { status: "NOT_DECLARED", reason: "NOT_APPLICABLE" } }, commercialTerms: { ...syntheticElectricityCte.commercialTerms, imbalance: { status: "DECLARED", component: { feeId: "ee-security-imbalance", label: "Bilanciamento", amount: 0.001, currency: "EUR", unit: "EUR_PER_KWH", taxTreatment: "EXCLUDED" } } } };
  const eeArchive = await createCteArchive(cteRepository, { tenantId: tenant, contract: eeContract, now: "2026-01-02T00:00:00.000Z", actor: "SECURITY_SMOKE" });
  const gasMarket = { ...structuredClone(syntheticGasPsv), tenantId: tenant, recordId: "psv-security-2026-01", month: "2026-01", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", publicationDate: "2026-02-01", approval };
  await createMarketArchive(marketRepository, { tenantId: tenant, record: gasMarket, now: "2026-01-02T00:00:00.000Z", actor: "SECURITY_SMOKE" });
  const repositories = { cteArchiveRepository: cteRepository, marketArchiveRepository: marketRepository, billRepository: {}, regulatoryValues: {}, approvalDomains: {}, regulatoryRefreshState: {}, calculationResults, comparisonResults };
  const request = gasRequest();
  const calculation = await calculateApprovedOffer(cteRepository, repositories.marketArchiveRepository, request, archive.archiveId);
  await calculationResults.put({ tenantId: tenant, recordId: calculation.calculationId, payload: { calculationId: calculation.calculationId, fingerprint: calculation.fingerprint, result: calculation }, idempotencyKey: calculation.fingerprint });

  const eeCalculation = await calculateApprovedOffer(cteRepository, repositories.marketArchiveRepository, eeRequest(), eeArchive.archiveId);
  await calculationResults.put({ tenantId: tenant, recordId: eeCalculation.calculationId, payload: { calculationId: eeCalculation.calculationId, fingerprint: eeCalculation.fingerprint, result: eeCalculation }, idempotencyKey: eeCalculation.fingerprint });
  const eeInput = await resolveAuthoritativeProposalInput(repositories, eeProposalFields(eeCalculation), tenant, "CALCULATION");
  const eeProposal = generateProposal(eeInput, tenant, "CALCULATION");
  assert.equal(eeProposal.vector, "EE");
  assert.equal(eeProposal.calculationFingerprint, eeCalculation.fingerprint);

  const validCalculationInput = await resolveAuthoritativeProposalInput(repositories, proposalFields(calculation), tenant, "CALCULATION");
  const validCalculationProposal = generateProposal(validCalculationInput, tenant, "CALCULATION");
  assert.equal(validCalculationProposal.calculationFingerprint, calculation.fingerprint);
  const sourceBillAttempt = await resolveAuthoritativeProposalInput(repositories, { ...proposalFields(calculation), sourceBill: { billId: "forged-bill", version: "forged-version" }, sourceComparison: { comparisonId: "forged-comparison", fingerprint: "f".repeat(64) } }, tenant, "CALCULATION");
  assert.equal(Object.hasOwn(sourceBillAttempt, "sourceBill"), false);
  assert.equal(Object.hasOwn(sourceBillAttempt, "sourceComparison"), false);

  const tamperedCalculationCases = [
    ["total", { ...calculation, totalCommercialCost: { amount: 0, currency: "EUR", minorUnits: 0 } }],
    ["saving", { ...calculation, savingsVsBaseline: { amount: 999, currency: "EUR", minorUnits: 99900 } }],
    ["baseline", { ...calculation, normalizedInput: { ...calculation.normalizedInput, baseline: { totalCommercialCost: 999, currency: "EUR", taxTreatment: "EXCLUDED", supplyPeriod: calculation.supplyPeriod } } }],
    ["supplier", { ...calculation, sourceCte: { ...calculation.sourceCte, supplier: "Forged Supplier" } }],
    ["offer", { ...calculation, sourceCte: { ...calculation.sourceCte, offerCode: "FORGED-OFFER" } }],
  ];
  for (const [, tamperedCalculation] of tamperedCalculationCases) {
    await assert.rejects(
      () => resolveAuthoritativeProposalInput(repositories, { ...proposalFields(calculation), calculation: tamperedCalculation }, tenant, "CALCULATION"),
      /PROPOSAL_CLIENT_RESULT_FORBIDDEN/,
    );
  }
  await assert.rejects(
    async () => generateProposal(await resolveAuthoritativeProposalInput(repositories, { ...proposalFields(calculation), selectedOffer: { ...selectedOffer(calculation), supplier: "Forged Supplier" } }, tenant, "CALCULATION"), tenant, "CALCULATION"),
    /PROPOSAL_OFFER_MISMATCH/,
  );
  await assert.rejects(
    () => resolveAuthoritativeProposalInput(repositories, { ...proposalFields(calculation), calculationFingerprint: "f".repeat(64) }, tenant, "CALCULATION"),
    /PROPOSAL_CALCULATION_RECORD_INVALID/,
  );
  await assert.rejects(
    () => resolveAuthoritativeProposalInput(repositories, { ...proposalFields(calculation), tenantId: otherTenant }, otherTenant, "CALCULATION"),
    /PROPOSAL_CALCULATION_RECORD_INVALID/,
  );

  const comparison = await compareApprovedOffers(cteRepository, repositories.marketArchiveRepository, request);
  await comparisonResults.put({ tenantId: tenant, recordId: comparison.comparisonId, payload: { comparisonId: comparison.comparisonId, fingerprint: comparison.fingerprint, result: comparison }, idempotencyKey: comparison.fingerprint });
  const selected = comparison.results[0];
  assert.ok(selected);
  const comparisonInput = {
    ...proposalFields(selected),
    sourceType: "COMPARISON",
    calculationId: undefined,
    calculationFingerprint: undefined,
    comparisonId: comparison.comparisonId,
    comparisonFingerprint: comparison.fingerprint,
    selectedCalculationId: selected.calculationId,
    selectedOffer: selectedOffer(selected),
  };
  delete comparisonInput.calculationId;
  delete comparisonInput.calculationFingerprint;
  const validComparisonInput = await resolveAuthoritativeProposalInput(repositories, comparisonInput, tenant, "COMPARISON");
  const validComparisonProposal = generateProposal(validComparisonInput, tenant, "COMPARISON");
  assert.equal(validComparisonProposal.sourceComparison.comparisonId, comparison.comparisonId);
  assert.equal(validComparisonProposal.calculationFingerprint, selected.fingerprint);
  await assert.rejects(
    () => resolveAuthoritativeProposalInput(repositories, { ...comparisonInput, comparison: { ...comparison, ranking: [] } }, tenant, "COMPARISON"),
    /PROPOSAL_CLIENT_RESULT_FORBIDDEN/,
  );
  await assert.rejects(
    () => resolveAuthoritativeProposalInput(repositories, { ...comparisonInput, comparisonFingerprint: "0".repeat(64) }, tenant, "COMPARISON"),
    /PROPOSAL_COMPARISON_RECORD_INVALID/,
  );

  const eeComparison = await compareApprovedOffers(cteRepository, repositories.marketArchiveRepository, eeRequest());
  await comparisonResults.put({ tenantId: tenant, recordId: eeComparison.comparisonId, payload: { comparisonId: eeComparison.comparisonId, fingerprint: eeComparison.fingerprint, result: eeComparison }, idempotencyKey: eeComparison.fingerprint });
  const eeSelected = eeComparison.results[0];
  assert.ok(eeSelected);
  const eeComparisonInput = { ...eeProposalFields(eeSelected), sourceType: "COMPARISON", comparisonId: eeComparison.comparisonId, comparisonFingerprint: eeComparison.fingerprint, selectedCalculationId: eeSelected.calculationId, selectedOffer: selectedOffer(eeSelected) };
  const eeComparisonTrusted = await resolveAuthoritativeProposalInput(repositories, eeComparisonInput, tenant, "COMPARISON");
  const eeComparisonProposal = generateProposal(eeComparisonTrusted, tenant, "COMPARISON");
  assert.equal(eeComparisonProposal.vector, "EE");
  assert.equal(eeComparisonProposal.sourceComparison.comparisonId, eeComparison.comparisonId);
  for (const proposal of [validComparisonProposal, eeComparisonProposal]) {
    const pdf = exportPdf(proposal, tenant);
    const pdfText = Buffer.from(pdf.body).toString("latin1");
    assert.equal(pdf.contentType, "application/pdf");
    assert.ok(pdfText.startsWith("%PDF-1.4"));
    assert.ok(pdfText.includes(proposal.proposalId));
    assert.ok(pdfText.includes(proposal.selectedOffer.supplier));
  }

  console.log("proposal server provenance smoke: ok (EE/GAS server rebuild, PDF parity, tenant/version binding, economic tampering denied)");
} finally {
  await rm(root, { recursive: true, force: true });
}
