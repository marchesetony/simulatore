import type { PublicBillDocument } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { auditElectricityBill, parseBillNumeric, type BillRegulatoryAuditDTO, type OfficialGmeReference } from "./bill-regulatory-audit.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { LocalRegulatoryRepository } from "./regulatory-repository.ts";
import type { RegulatoryValueRecord } from "./regulatory-types.ts";
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
  const input = { ...auditInput(document, period), domesticResidenceStatus: profile.domesticResidenceStatus.normalizedValue === "RESIDENT" ? "PROVEN" as const : profile.domesticResidenceStatus.normalizedValue === "NON_RESIDENT" ? "NOT_PROVEN" as const : "UNKNOWN" as const };
  const references = regulatoryReferences ?? await new LocalRegulatoryRepository().getRegulatoryValues(document.tenantId);
  const audit = auditElectricityBill(input, {
    regulatoryReferences: references,
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
    customerScope: matrix.scope === "DOMESTIC_RESIDENT_BT" ? "DOMESTIC_RESIDENT_BT" : "UNKNOWN",
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
