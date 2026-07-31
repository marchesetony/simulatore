import type { ElectricityCteContract, GasCteContract } from "./types";

const approved = { status: "APPROVED" as const, reviewer: "fixture-reviewer", reviewedAt: "2026-07-30T09:00:00.000Z", decisionId: "fixture-decision-1" };
const fee = (feeId: string, label: string, amount: number, unit: "EUR_PER_KWH" | "EUR_PER_SMC" | "EUR_PER_MONTH") => ({ feeId, label, amount, currency: "EUR" as const, unit, taxTreatment: "EXCLUDED" as const });
const price = (amount: number, unit: "EUR_PER_KWH" | "EUR_PER_SMC") => ({ amount, currency: "EUR" as const, unit, taxTreatment: "EXCLUDED" as const });

export const syntheticElectricityCte: ElectricityCteContract = {
  schemaVersion: 1,
  recordId: "cte-ee-fixture",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "CTE",
  cteId: "cte-ee-fixture",
  vector: "EE",
  supplier: { supplierId: "supplier-ee-fixture", name: "Fornitore EE Sintetico" },
  offer: { offerId: "offer-ee-fixture", name: "EE Indicizzata Sintetica", code: "EE-PUN-001" },
  validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" },
  expiry: { status: "EXPIRES_ON", date: "2026-12-31" },
  currency: "EUR",
  taxTreatment: "EXCLUDED",
  eligibility: { customerTypes: ["NON_RESIDENTIAL"], voltageLevels: ["LV", "MV"] },
  pricing: { mode: "INDEXED", reference: "PUN", spread: price(0.012, "EUR_PER_KWH") },
  commercialTerms: {
    fixedFees: [fee("ee-fixed", "Quota fissa mensile", 8, "EUR_PER_MONTH")],
    variableFees: [fee("ee-variable", "Gestione", 0.003, "EUR_PER_KWH")],
    imbalance: { status: "NOT_DECLARED", reason: "NOT_PROVIDED" },
    oneOffFees: [],
    commercialDiscounts: [fee("ee-discount", "Sconto commerciale", 0.001, "EUR_PER_KWH")],
  },
};

export const syntheticGasCte: GasCteContract = {
  schemaVersion: 1,
  recordId: "cte-gas-fixture",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "CTE",
  cteId: "cte-gas-fixture",
  vector: "GAS",
  supplier: { supplierId: "supplier-gas-fixture", name: "Fornitore GAS Sintetico" },
  offer: { offerId: "offer-gas-fixture", name: "GAS PSV Sintetica", code: "GAS-PSV-001" },
  validity: { periodStart: "2026-01-01", periodEnd: "2027-01-01" },
  expiry: { status: "NO_EXPIRY_DECLARED", reason: "NOT_PROVIDED" },
  currency: "EUR",
  taxTreatment: "EXCLUDED",
  eligibility: { customerTypes: ["NON_RESIDENTIAL"] },
  pricing: { mode: "INDEXED", reference: "PSV", spread: price(0.08, "EUR_PER_SMC") },
  commercialTerms: {
    fixedFees: [fee("gas-fixed", "Quota fissa mensile", 7, "EUR_PER_MONTH")],
    variableFees: [fee("gas-variable", "Gestione", 0.004, "EUR_PER_SMC")],
    imbalance: { status: "DECLARED", component: fee("gas-imbalance", "Bilanciamento", 0.002, "EUR_PER_SMC") },
    oneOffFees: [],
    commercialDiscounts: [],
  },
};
