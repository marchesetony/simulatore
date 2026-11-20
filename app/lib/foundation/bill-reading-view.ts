import type { StructuredBillExtraction } from "../ingestion/structured-bill.ts";
import type { BillSupplyProfile } from "../ingestion/bill-supply-profile.ts";

// Tony (10/11/2026, "visibilità dati bolletta per ruolo"): every commercial user who may open a bill (company administrator,
// director, area manager, agent: only the bills their scope lets them consult) sees what the bill prints, the four sections
// of "Dati letti": supply, consumption F1/F2/F3, powers, price structure, spread, PCV, economic components. It grants no
// management, CTE or administration right. "Dettaglio tecnico" (BILL_TECHNICAL_DETAILS) keeps guarding the full reading
// and the advanced functions it was made for; this view is a closed list of what the bill prints, never the reading's
// internals (pages and texts each value was copied from, document evidence, transcripts, reader diagnostics).

function supplyProfileView(profile: BillSupplyProfile | undefined): BillSupplyProfile | undefined {
  if (!profile) return undefined;
  return {
    supplyUseCategory: profile.supplyUseCategory,
    domesticResidenceStatus: profile.domesticResidenceStatus,
    contractualTariffCategory: profile.contractualTariffCategory,
    marketRegime: profile.marketRegime,
    voltageClass: profile.voltageClass,
    nominalVoltage: profile.nominalVoltage,
    powerCommitted: profile.powerCommitted,
    powerAvailable: profile.powerAvailable,
    powerMaximumDrawn: profile.powerMaximumDrawn,
    powerBillingBasis: profile.powerBillingBasis,
  };
}

/** The bill data shown in "Dati letti", copied field by field from the reading: a field not listed here is never sent. */
export function billReadingView(reading: StructuredBillExtraction | null | undefined): StructuredBillExtraction | null {
  if (!reading) return null;
  const supplyProfile = supplyProfileView(reading.supplyProfile);
  return {
    schemaVersion: reading.schemaVersion,
    vector: reading.vector,
    supplier: reading.supplier,
    customerName: reading.customerName,
    customerId: reading.customerId,
    customerType: reading.customerType,
    customerTaxIdentifier: reading.customerTaxIdentifier,
    billingPeriod: reading.billingPeriod,
    totalAmount: reading.totalAmount,
    annualConsumption: reading.annualConsumption,
    billedConsumption: reading.billedConsumption,
    pod: reading.pod,
    pdr: reading.pdr,
    voltageLevel: reading.voltageLevel,
    powerKw: reading.powerKw,
    f1Consumption: reading.f1Consumption,
    f2Consumption: reading.f2Consumption,
    f3Consumption: reading.f3Consumption,
    smcConsumption: reading.smcConsumption,
    conversionCoefficient: reading.conversionCoefficient,
    pcs: reading.pcs,
    offerName: reading.offerName,
    offerCode: reading.offerCode,
    extendedFacts: reading.extendedFacts,
    economicChargeLines: reading.economicChargeLines,
    ...(reading.monthlyBands ? { monthlyBands: reading.monthlyBands } : {}),
    ...(reading.consumptionHistory ? { consumptionHistory: reading.consumptionHistory } : {}),
    ...(reading.documentOfferName !== undefined ? { documentOfferName: reading.documentOfferName } : {}),
    ...(reading.documentOfferBox !== undefined ? { documentOfferBox: reading.documentOfferBox } : {}),
    ...(supplyProfile ? { supplyProfile } : {}),
    ...(reading.readingChecks ? { readingChecks: reading.readingChecks } : {}),
    ...(reading.readingAbsent ? { readingAbsent: reading.readingAbsent } : {}),
    ...(reading.printedComponents ? { printedComponents: reading.printedComponents } : {}),
    ...(reading.analystExtractionStatus ? { analystExtractionStatus: reading.analystExtractionStatus } : {}),
  };
}
