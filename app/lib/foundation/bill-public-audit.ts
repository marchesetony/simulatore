import path from "node:path";
import type { PublicBillDocument } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { auditElectricityBill, parseBillNumeric, type BillRegulatoryAuditDTO, type OfficialGmeReference } from "./bill-regulatory-audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { LocalRegulatoryRepository } from "./regulatory-repository.ts";
import type { RegulatoryValueRecord } from "./regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runtimeRepositories } from "../persistence/adapter.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ProductionRegulatoryPersistenceBridge } from "../regulatory-bridge.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildBillSupplyProfile } from "../ingestion/bill-supply-profile.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildDomesticResidentMatrix } from "./bill-domestic-resident-matrix.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { verifyRegulatedPassThrough } from "./bill-regulated-pass-through.ts";

function foundValue<T>(field: { readonly value: T | null; readonly status: string } | undefined): T | null {
  return field?.status === "FOUND" ? field.value : null;
}

function periodFrom(document: PublicBillDocument): { readonly from: string; readonly to: string } | null {
  const period = document.structuredBill?.billingPeriod;
  if (period?.status === "FOUND" && period.value) return { from: period.value.from, to: period.value.to };
  const profile = document.normalized?.billingPeriod;
  return profile?.periodStart && profile.periodEnd ? { from: profile.periodStart, to: profile.periodEnd } : null;
}

function officialGmeReferences(document: PublicBillDocument): readonly OfficialGmeReference[] {
  return document.invoicePunReferences.flatMap((reference) => {
    const sourceReference = reference.sourceReference ?? "GME archive";
    const common = { month: reference.referenceMonth, unit: "EUR/MWH", sourceReference, officialIdentifier: "GME-PUN" };
    if (reference.pricingMode === "F1_F2_F3") return ([ ["F1", reference.f1], ["F2", reference.f2], ["F3", reference.f3] ] as const).filter(([, value]) => value !== null).map(([, value]) => ({ ...common, value }));
    return reference.monthly === null ? [] : [{ ...common, value: reference.monthly }];
  });
}

function appliedPun(document: PublicBillDocument): { readonly value: number | null; readonly unit: string | null } {
  const extraction = document.structuredBill;
  const facts = extraction?.extendedFacts ?? [];
  const fact = facts.find((item) => ["PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3"].includes(item.code) && item.status === "FOUND");
  const line = extraction?.economicChargeLines.find((item) => ["PUN_SINGLE", "PUN_F1", "PUN_F2", "PUN_F3"].includes(item.code) && item.status === "FOUND");
  return { value: fact ? parseBillNumeric(fact.value) : line ? parseBillNumeric(line.unitPrice) : null, unit: fact?.unit ?? line?.unit ?? null };
}

async function regulatoryValuesFor(document: PublicBillDocument, period: { readonly from: string }): Promise<readonly RegulatoryValueRecord[]> {
  const primary = await new LocalRegulatoryRepository().getRegulatoryValues(document.tenantId);
  let runtime: readonly RegulatoryValueRecord[] = [];
  try {
    const repositories = runtimeRepositories();
    runtime = await new ProductionRegulatoryPersistenceBridge(repositories.regulatoryValues, repositories.approvalDomains).list(document.tenantId, { effectiveAt: period.from });
  } catch (error) {
    if (process.env.APP_RUNTIME_MODE === "production") throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
  }
  const tenantCatalog = primary.length > 0 || process.env.APP_RUNTIME_MODE === "production"
    ? primary
    : await new LocalRegulatoryRepository(path.join(process.cwd(), "var", "foundation-regulatory-data", document.tenantId)).getRegulatoryValues(document.tenantId);
  // The legacy catalog supplements a valid runtime read for domains that are
  // intentionally not projected yet; it is never a fallback for bad runtime
  // configuration because that path now fails closed above.
  // A valid runtime read is authoritative for the semantic dimension it
  // projects. Do not mix its records with an overlapping legacy catalog
  // interval: the resolver must still fail closed for genuinely incompatible
  // records, while an equivalent legacy carry-forward cannot create a false
  // conflict for the same tenant and supply period.
  const runtimeAuthorityKeys = new Set(runtime.map((record) => [record.componentCode, record.customerScope, record.normalizedUnit, record.regulatoryVariant ?? ""].join("|")));
  const catalogSupplement = tenantCatalog.filter((record) => !runtimeAuthorityKeys.has([record.componentCode, record.customerScope, record.normalizedUnit, record.regulatoryVariant ?? ""].join("|")));
  const merged = new Map<string, RegulatoryValueRecord>();
  for (const record of [...runtime, ...catalogSupplement]) {
    if (record.tenantId !== document.tenantId) continue;
    const key = [record.componentCode, record.customerScope, record.normalizedUnit, record.regulatoryVariant ?? "", record.effectiveFrom, record.effectiveTo ?? ""].join("|");
    if (!merged.has(key)) merged.set(key, record);
  }
  return [...merged.values()];
}

function selectedAsosVariantForGenericAudit(document: PublicBillDocument, references: readonly RegulatoryValueRecord[]): string | null {
  const line = document.structuredBill?.economicChargeLines.find((candidate) => candidate.status === "FOUND" && candidate.code === "ASOS" && /energia|scaglione/i.test(candidate.description));
  const rawValue = parseBillNumeric(line?.unitPrice);
  const rawUnit = line?.unit?.toUpperCase().replace(/\s/g, "");
  if (rawValue === null || !rawUnit) return null;
  const billRate = rawUnit.includes("KWH") ? rawUnit.includes("CENT") ? rawValue / 100 : rawValue : null;
  if (billRate === null) return null;
  const matches = [...new Set(references
    .filter((record) => record.componentCode === "ASOS" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.regulatoryVariant !== undefined && record.normalizedUnit === "EUR/KWH")
    .filter((record) => Math.abs(record.normalizedValue - billRate) <= 0.000001)
    .map((record) => record.regulatoryVariant as string))];
  return matches.length === 1 ? matches[0] : null;
}

function referencesForGenericAudit(document: PublicBillDocument, references: readonly RegulatoryValueRecord[]): readonly RegulatoryValueRecord[] {
  const variant = selectedAsosVariantForGenericAudit(document, references);
  const hasBta6Variants = references.some((record) => record.componentCode === "ASOS" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.regulatoryVariant !== undefined);
  if (!hasBta6Variants) return references;
  return references.filter((record) => record.componentCode !== "ASOS" || record.regulatoryVariant === undefined || record.regulatoryVariant === variant);
}

function auditInput(document: PublicBillDocument, period: { readonly from: string; readonly to: string }) {
  const extraction = document.structuredBill;
  const customerType = foundValue(extraction?.customerType);
  const pun = appliedPun(document);
  return {
    billId: document.id,
    versionId: document.currentVersionId,
    vector: "EE" as const,
    customerType: customerType === "RESIDENTIAL" || customerType === "NON_RESIDENTIAL" ? customerType : "UNKNOWN" as const,
    domesticResidenceStatus: "UNKNOWN" as const,
    billingPeriod: period,
    billedConsumptionKwh: foundValue(extraction?.billedConsumption),
    powerKw: foundValue(extraction?.powerKw),
    chargeLines: (extraction?.economicChargeLines ?? []).map((line) => ({ code: line.code, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, amount: line.amount })),
    pun,
  };
}

export async function buildBillRegulatoryAudit(document: PublicBillDocument, regulatoryReferences?: readonly RegulatoryValueRecord[]): Promise<BillRegulatoryAuditDTO | null> {
  if (document.resolvedVector !== "EE") return null;
  const period = periodFrom(document);
  if (!period) return null;
  const profile = buildBillSupplyProfile(document.structuredBill?.extendedFacts ?? []);
  const customerType = foundValue(document.structuredBill?.customerType);
  const resolvedScope = customerType === "NON_RESIDENTIAL" && profile.supplyUseCategory.normalizedValue === "OTHER_USE" && ["LV", "BT"].includes(profile.voltageClass.normalizedValue ?? "")
    ? "NON_DOMESTIC_BT_BTA6" as const
    : profile.supplyUseCategory.normalizedValue === "DOMESTIC"
    ? profile.domesticResidenceStatus.normalizedValue === "RESIDENT"
      ? "DOMESTIC_RESIDENT_BT" as const
      : profile.domesticResidenceStatus.normalizedValue === "NON_RESIDENT"
        ? "DOMESTIC_NON_RESIDENT_BT" as const
        : "UNKNOWN" as const
    : "UNKNOWN" as const;
  const input = { ...auditInput(document, period), domesticResidenceStatus: profile.domesticResidenceStatus.normalizedValue === "RESIDENT" ? "PROVEN" as const : profile.domesticResidenceStatus.normalizedValue === "NON_RESIDENT" ? "NOT_PROVEN" as const : "UNKNOWN" as const, regulatoryCustomerScope: resolvedScope };
  const references = regulatoryReferences ?? await regulatoryValuesFor(document, period);
  const audit = auditElectricityBill(input, {
    regulatoryReferences: referencesForGenericAudit(document, references),
    officialGmeReferences: officialGmeReferences(document),
    appliedPunOriginalValue: input.pun.value,
    appliedPunOriginalUnit: input.pun.unit,
    contractReference: null,
  });
  const matrix = buildDomesticResidentMatrix({
    profile,
    billingPeriod: period,
    chargeLines: document.structuredBill?.economicChargeLines ?? [],
    extendedFacts: document.structuredBill?.extendedFacts ?? [],
    regulatoryReferences: references,
    gmeReferences: document.invoicePunReferences.map((reference) => ({
      month: reference.referenceMonth,
      f1: reference.f1,
      f2: reference.f2,
      f3: reference.f3,
      unit: reference.unit === "EUR_PER_MWH" ? "EUR/MWH" : reference.unit,
      sourceReference: reference.sourceReference,
      officialIdentifier: "GME-PUN",
    })),
    contractAvailable: false,
  });
  const matrixReferenceDetails = matrix.components.flatMap((component) => component.sourceValue ? [{
    officialName: component.officialName,
    authority: component.authority,
    officialIdentifier: component.sourceValue.officialIdentifier,
    value: component.sourceValue.normalizedValue ?? component.sourceValue.sourceOriginalValue ?? 0,
    unit: component.sourceValue.normalizedUnit ?? component.sourceValue.sourceOriginalUnit ?? "",
    effectivePeriod: { from: component.sourceValue.effectiveFrom ?? period.from, to: component.sourceValue.effectiveTo },
    billEvidence: component.billEvidence,
    auditability: component.auditability,
    referenceDomain: component.sourceValue.referenceDomain ?? null,
  }] : []);
  const regulatedPassThrough = verifyRegulatedPassThrough({
    billingPeriod: period,
    chargeLines: document.structuredBill?.economicChargeLines ?? [],
    extendedFacts: document.structuredBill?.extendedFacts ?? [],
    regulatoryReferences: references,
    billedConsumptionKwh: parseBillNumeric(input.billedConsumptionKwh),
    powerKw: parseBillNumeric(input.powerKw),
    customerScope: resolvedScope === "DOMESTIC_RESIDENT_BT" || resolvedScope === "DOMESTIC_NON_RESIDENT_BT" || resolvedScope === "NON_DOMESTIC_BT_BTA6" ? resolvedScope : "UNKNOWN",
  });
  const passThroughOvercharge = regulatedPassThrough.items.reduce((sum, item) => sum + Math.max(0, item.amountDifference ?? 0), 0);
  const passThroughUndercharge = regulatedPassThrough.items.reduce((sum, item) => sum + Math.max(0, -(item.amountDifference ?? 0)), 0);
  const summary = {
    ...audit.summary,
    overallStatus: regulatedPassThrough.summary.overReferenceCount > 0 ? "ANOMALIES_FOUND" as const : audit.summary.overallStatus,
    confirmedAnomalyCount: audit.summary.confirmedAnomalyCount + regulatedPassThrough.summary.overReferenceCount,
    verifiedRegulatedCount: audit.summary.verifiedRegulatedCount + regulatedPassThrough.summary.comparableCount,
    confirmedOverchargeAmount: audit.summary.confirmedOverchargeAmount + Math.round(passThroughOvercharge * 100) / 100,
    confirmedUnderchargeAmount: audit.summary.confirmedUnderchargeAmount + Math.round(passThroughUndercharge * 100) / 100,
    confirmedDifferenceCount: regulatedPassThrough.summary.confirmedDifferenceCount,
    confirmedOverchargeCount: regulatedPassThrough.summary.confirmedOverchargeCount,
    confirmedUnderchargeCount: regulatedPassThrough.summary.confirmedUnderchargeCount,
    netConfirmedDifferenceAmount: regulatedPassThrough.summary.netConfirmedDifferenceAmount,
  };
  return {
    ...audit,
    summary,
    supplyProfile: {
      usage: profile.supplyUseCategory.normalizedValue === "DOMESTIC" ? "DOMESTIC" : profile.supplyUseCategory.normalizedValue ? "OTHER" : "UNKNOWN",
      residence: profile.domesticResidenceStatus.normalizedValue === "RESIDENT" ? "RESIDENT" : profile.domesticResidenceStatus.normalizedValue === "NON_RESIDENT" ? "NON_RESIDENT" : "UNKNOWN",
      market: profile.marketRegime.normalizedValue ?? profile.marketRegime.rawValue ?? null,
      voltage: profile.voltageClass.normalizedValue ?? profile.voltageClass.rawValue ?? null,
    },
    coverage: {
      sourceCoverage: {
        ARERA_NETWORK: matrix.coverage.ARERA_NETWORK_SOURCE_COVERAGE,
        ARERA_SYSTEM_CHARGES: matrix.coverage.ARERA_SYSTEM_CHARGES_SOURCE_COVERAGE,
        DISPATCHING: matrix.coverage.DISPATCHING_SOURCE_COVERAGE,
        CAPACITY_MARKET: matrix.coverage.CAPACITY_MARKET_SOURCE_COVERAGE,
        GME: matrix.coverage.GME_SOURCE_COVERAGE,
        CONTRACT: matrix.coverage.CONTRACT_COVERAGE === "VERIFIED" ? "VERIFIED" : "MISSING",
        TAX: "MISSING",
      },
      billAuditability: {
        ARERA_NETWORK: matrix.coverage.ARERA_NETWORK_BILL_AUDITABILITY,
        ARERA_SYSTEM_CHARGES: matrix.coverage.ARERA_SYSTEM_CHARGES_BILL_AUDITABILITY,
        DISPATCHING: matrix.coverage.DISPATCHING_BILL_AUDITABILITY,
        CAPACITY_MARKET: matrix.coverage.CAPACITY_MARKET_BILL_AUDITABILITY,
        GME: matrix.coverage.GME_BILL_AUDITABILITY,
      },
    },
    referenceDetails: matrixReferenceDetails,
    regulatedPassThrough,
    domesticResidentMatrix: matrix,
  };
}

export async function attachBillRegulatoryAudit(document: PublicBillDocument, regulatoryReferences?: readonly RegulatoryValueRecord[]): Promise<PublicBillDocument> {
  return { ...document, regulatoryAudit: await buildBillRegulatoryAudit(document, regulatoryReferences) };
}
