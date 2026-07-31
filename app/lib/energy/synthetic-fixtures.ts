import type {
  ElectricityBillContract,
  ElectricityCustomerSupplyRecord,
  GasBillContract,
  GasCustomerSupplyRecord,
} from "./types";
import type { ElectricityMonthlyPunRecord, GasMonthlyPsvRecord } from "./market-data";

const approved = { status: "APPROVED" as const, reviewer: "fixture-reviewer", reviewedAt: "2026-07-30T09:00:00.000Z", decisionId: "fixture-decision-1" };
const knownKwh = (value: number) => ({ status: "KNOWN" as const, unit: "KWH" as const, value });
const knownSmc = (value: number) => ({ status: "KNOWN" as const, unit: "SMC" as const, value });
const provenance = (field: "billingPeriod" | "customer" | "supply" | "consumption" | "supplier" | "offer" | "regulatedCharges") => ({ field, source: "BILL_DOCUMENT" as const, sourceReference: "fixture-bill.pdf", locator: `page-1:${field}`, confidence: 0.99, reviewed: true });
const provenanceFields = ["billingPeriod", "customer", "supply", "consumption", "supplier", "offer", "regulatedCharges"] as const;

export const syntheticElectricityCustomerSupply: ElectricityCustomerSupplyRecord = {
  schemaVersion: 1,
  recordId: "customer-supply-ee-fixture",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "CUSTOMER_SUPPLY",
  vector: "EE",
  customer: {
    customerId: "customer-ee-fixture",
    customerType: "NON_RESIDENTIAL",
    name: { status: "KNOWN", value: "Cliente EE Sintetico" },
    taxIdentifiers: [{ kind: "VAT_NUMBER", value: "IT12345678901" }],
  },
  supply: { vector: "EE", supplyId: "supply-ee-fixture", meterId: "meter-ee-fixture", pod: "IT001E12345678", voltageLevel: "LV" },
  annualConsumption: knownKwh(12000),
  consumptionPeriods: [
    { periodStart: "2026-01-01", periodEnd: "2026-04-01", unit: "KWH", quantity: knownKwh(3000) },
    { periodStart: "2026-04-01", periodEnd: "2026-07-01", unit: "KWH", quantity: knownKwh(4200) },
  ],
};

export const syntheticGasCustomerSupply: GasCustomerSupplyRecord = {
  schemaVersion: 1,
  recordId: "customer-supply-gas-fixture",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "CUSTOMER_SUPPLY",
  vector: "GAS",
  customer: {
    customerId: "customer-gas-fixture",
    customerType: "RESIDENTIAL",
    name: { status: "KNOWN", value: "Cliente GAS Sintetico" },
    taxIdentifiers: [{ kind: "TAX_CODE", value: "RSSMRA80A01H501X" }],
  },
  supply: { vector: "GAS", supplyId: "supply-gas-fixture", meterId: "meter-gas-fixture", pdr: "12345678901234" },
  annualConsumption: knownSmc(950),
  consumptionPeriods: [
    { periodStart: "2026-01-01", periodEnd: "2026-04-01", unit: "SMC", quantity: knownSmc(250) },
    { periodStart: "2026-04-01", periodEnd: "2026-07-01", unit: "SMC", quantity: knownSmc(300) },
  ],
};

export const syntheticElectricityBill: ElectricityBillContract = {
  schemaVersion: 1,
  recordId: "bill-ee-fixture",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "BILL",
  vector: "EE",
  billId: "bill-ee-fixture",
  customerId: "customer-ee-fixture",
  supplyId: "supply-ee-fixture",
  supply: syntheticElectricityCustomerSupply.supply,
  billingPeriod: { periodStart: "2026-06-01", periodEnd: "2026-07-01" },
  consumptionBasis: "MEASURED",
  currentSupplier: "Fornitore EE Sintetico",
  offer: { supplier: "Fornitore EE Sintetico", offerName: { status: "KNOWN", value: "EE Indicizzata Sintetica" }, offerCode: { status: "KNOWN", value: "EE-PUN-001" } },
  consumption: { vector: "EE", f1: knownKwh(1200), f2: knownKwh(800), f3: knownKwh(500), total: knownKwh(2500) },
  regulatedCharges: [{ code: "TAX-EE", label: "Imposte e oneri regolati", amount: 42.5, currency: "EUR", taxTreatment: "EXCLUDED" }],
  fieldProvenance: provenanceFields.map(provenance),
  reviewState: "APPROVED",
};

export const syntheticGasBill: GasBillContract = {
  schemaVersion: 1,
  recordId: "bill-gas-fixture",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "BILL",
  vector: "GAS",
  billId: "bill-gas-fixture",
  customerId: "customer-gas-fixture",
  supplyId: "supply-gas-fixture",
  supply: syntheticGasCustomerSupply.supply,
  billingPeriod: { periodStart: "2026-06-01", periodEnd: "2026-07-01" },
  consumptionBasis: "ESTIMATED",
  currentSupplier: "Fornitore GAS Sintetico",
  offer: { supplier: "Fornitore GAS Sintetico", offerName: { status: "KNOWN", value: "GAS PSV Sintetica" }, offerCode: { status: "KNOWN", value: "GAS-PSV-001" } },
  consumption: { vector: "GAS", smc: knownSmc(75), correctionCoefficient: { status: "KNOWN", value: 1.02 } },
  regulatedCharges: [{ code: "TAX-GAS", label: "Imposte e oneri regolati", amount: 18, currency: "EUR", taxTreatment: "EXCLUDED" }],
  fieldProvenance: provenanceFields.map(provenance),
  reviewState: "APPROVED",
};

export const syntheticElectricityPun: ElectricityMonthlyPunRecord = {
  schemaVersion: 1,
  recordId: "pun-ee-2026-06",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "MONTHLY_MARKET_DATA",
  vector: "EE",
  index: "PUN",
  month: "2026-06",
  publicationDate: "2026-07-01",
  effectiveFrom: "2026-06-01",
  effectiveTo: "2026-07-01",
  source: { sourceId: "gme-fixture", name: "GME Synthetic", url: "https://example.invalid/gme-fixture" },
  f1: { value: 105.1, currency: "EUR", unit: "EUR_PER_MWH" },
  f2: { value: 97.2, currency: "EUR", unit: "EUR_PER_MWH" },
  f3: { value: 82.3, currency: "EUR", unit: "EUR_PER_MWH" },
};

export const syntheticGasPsv: GasMonthlyPsvRecord = {
  schemaVersion: 1,
  recordId: "psv-gas-2026-06",
  version: "1",
  parentVersionId: null,
  tenantId: "tenant_energy-fixture",
  approval: approved,
  recordType: "MONTHLY_MARKET_DATA",
  vector: "GAS",
  index: "PSV",
  month: "2026-06",
  publicationDate: "2026-07-01",
  effectiveFrom: "2026-06-01",
  effectiveTo: "2026-07-01",
  source: { sourceId: "gme-fixture", name: "GME Synthetic", url: "https://example.invalid/gme-fixture" },
  value: { value: 0.38, currency: "EUR", unit: "EUR_PER_SMC" },
};
