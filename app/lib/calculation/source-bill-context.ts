// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { completeSupplyProfile } from "../ingestion/supply-profile-completion.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { toPublicApprovedDocument, type BillRepository, type PublicBillDocument } from "../foundation/real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildBillSupplyProfile, validateBillSupplyProfile } from "../ingestion/bill-supply-profile.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateStructuredBillExtraction } from "../ingestion/structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { resolveBillVectorFromEvidence } from "../ingestion/vector-resolution.ts";
import type { CustomerResidency, CustomerType } from "../energy/types";
import type { ElectricitySimulationRequest } from "./types";
import type { BillPeakEnergy, CurrentSupplyOffer } from "./engine";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ONE_OFF_BILL_LINE } from "../quote/same-offer.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildTrustedElectricitySupplyContext, type ElectricitySupplyContext, type TrustedElectricitySupplyContextError } from "./trusted-ee-supply-context.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildTrustedElectricityFiscalContext, type TrustedElectricityFiscalContext } from "./trusted-ee-fiscal-context.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billIndexStructure } from "../market/bill-spread.ts";

export class SourceBillContextError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "SourceBillContextError"; this.code = code; }
}

const fail = (code: string): never => { throw new SourceBillContextError(code); };

function publicApproved(document: Parameters<typeof toPublicApprovedDocument>[0], approvedVersionId: string): PublicBillDocument {
  let approved: PublicBillDocument | null;
  try { approved = toPublicApprovedDocument(document); } catch { return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE"); }
  if (!approved || approved.currentVersionId !== approvedVersionId || approved.currentApprovedVersionId !== approvedVersionId || approved.reviewState !== "APPROVED_CURRENT") return fail("SOURCE_BILL_NOT_APPROVED");
  return approved;
}

function profileFromApprovedStructuredBill(approved: PublicBillDocument) {
  const structuredBill = approved.structuredBill;
  if (!structuredBill) fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE");
  try { validateStructuredBillExtraction(structuredBill); } catch { return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE"); }
  let vectorResolution;
  try { vectorResolution = resolveBillVectorFromEvidence(structuredBill); } catch { return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE"); }
  if (structuredBill.vector.status !== "FOUND" || structuredBill.vector.value !== "EE" || vectorResolution.vector !== "EE" || vectorResolution.reviewRequired || approved.resolvedVector !== "EE") fail("SOURCE_BILL_VECTOR_MISMATCH");
  if (structuredBill.supplyProfile !== undefined) {
    try { validateBillSupplyProfile(structuredBill.supplyProfile); } catch { return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE"); }
    // Rebuild from the structured documentary facts when available so unit
    // metadata retained on the real source facts cannot be lost in a legacy
    // persisted profile projection. The persisted profile remains the
    // backwards-compatible fallback for older records without those facts.
    if (structuredBill.extendedFacts.length > 0) {
      try { return buildBillSupplyProfile(structuredBill.extendedFacts); } catch { /* use the validated stored profile */ }
    }
    return structuredBill.supplyProfile;
  }
  try { return buildBillSupplyProfile(structuredBill.extendedFacts); } catch { return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE"); }
}

function expectedClientIdentity(context: ElectricitySupplyContext): { readonly customerCategory: CustomerType; readonly residency?: CustomerResidency } {
  switch (context.regulatoryCustomerScope) {
    case "DOMESTIC_RESIDENT_BT": return { customerCategory: "RESIDENTIAL", residency: "RESIDENT" };
    case "DOMESTIC_NON_RESIDENT_BT": return { customerCategory: "RESIDENTIAL", residency: "NON_RESIDENT" };
    case "NON_DOMESTIC_BT": return { customerCategory: "NON_RESIDENTIAL" };
    case "NON_DOMESTIC_BT_BTA6": return { customerCategory: "NON_RESIDENTIAL" };
    default: return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE");
  }
}

function reconcileClientRequest(request: ElectricitySimulationRequest, context: ElectricitySupplyContext): void {
  if (request.voltageLevel !== context.voltageLevel) fail("SOURCE_BILL_VOLTAGE_MISMATCH");
  const expected = expectedClientIdentity(context);
  if (request.customerCategory !== expected.customerCategory) fail("SOURCE_BILL_CUSTOMER_CATEGORY_MISMATCH");
  if (request.residency !== undefined && request.residency !== expected.residency) fail("SOURCE_BILL_RESIDENCY_MISMATCH");
}

function trustedContextError(error: unknown): never {
  const candidate = error as Partial<TrustedElectricitySupplyContextError>;
  if (candidate && typeof candidate.code === "string") throw new SourceBillContextError(candidate.code);
  return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE");
}

async function resolveApprovedSourceBillContext(
  billRepository: Pick<BillRepository, "get">,
  tenantId: string,
  request: ElectricitySimulationRequest,
): Promise<{ readonly supplyContext: ElectricitySupplyContext; readonly structuredBill: NonNullable<PublicBillDocument["structuredBill"]>; readonly billId: string; readonly approvedVersionId: string } | null> {
  if (!request.sourceBill) return null;
  const document = await billRepository.get(tenantId, request.sourceBill.billId);
  if (!document || document.tenantId !== tenantId) return fail("SOURCE_BILL_NOT_FOUND");
  const approvedVersionId = document.currentApprovedVersionId;
  if (!approvedVersionId) return fail("SOURCE_BILL_NOT_APPROVED");
  if (request.sourceBill.version !== approvedVersionId) return fail("SOURCE_BILL_VERSION_MISMATCH");
  const approved = publicApproved(document, approvedVersionId);
  const structuredBill = approved.structuredBill;
  if (!structuredBill) return fail("SOURCE_BILL_TRUST_CONTEXT_UNAVAILABLE");
  const profile = completeSupplyProfile(profileFromApprovedStructuredBill(approved), structuredBill);
  let supplyContext: ElectricitySupplyContext;
  try {
    supplyContext = buildTrustedElectricitySupplyContext(profile, {
      simulationPeriod: request.supplyPeriod,
      sourceBillBinding: { billId: document.id, approvedVersionId },
    });
  } catch (error) { return trustedContextError(error); }
  reconcileClientRequest(request, supplyContext);
  return { supplyContext, structuredBill, billId: document.id, approvedVersionId };
}

// Technical readings that refine regulated charges (supply use, BTA6 power basis) but are often missing on a competitor bill.
const OPTIONAL_TRUST_CODES = /^(BTA6_|SUPPLY_USE|POWER_|AVAILABLE_POWER|CONTRACTED_POWER|REGULATORY_SCOPE|VOLTAGE_LEVEL|DOMESTIC_)/;

export async function resolveTrustedElectricityContextFromSourceBill(
  billRepository: Pick<BillRepository, "get">,
  tenantId: string,
  request: ElectricitySimulationRequest,
): Promise<ElectricitySupplyContext | null> {
  return (await resolveTrustedElectricityContextWithReason(billRepository, tenantId, request)).context;
}

/** Same as above, plus the code of the reading that was missing when no context could be built, so the quote can say why. */
export async function resolveTrustedElectricityContextWithReason(
  billRepository: Pick<BillRepository, "get">,
  tenantId: string,
  request: ElectricitySimulationRequest,
): Promise<{ readonly context: ElectricitySupplyContext | null; readonly reason: string | null; readonly currentOffer?: CurrentSupplyOffer; readonly billPeakEnergy?: BillPeakEnergy }> {
  try {
    const resolved = await resolveApprovedSourceBillContext(billRepository, tenantId, request);
    return { context: resolved?.supplyContext ?? null, reason: resolved ? null : "SOURCE_BILL_MISSING", ...await currentOfferOf(billRepository, tenantId, request) };
  } catch (error) {
    // Without those readings the quote still runs on the generic electricity charges instead of failing.
    if (error instanceof SourceBillContextError && OPTIONAL_TRUST_CODES.test(error.code)) return { context: null, reason: error.code, ...await currentOfferOf(billRepository, tenantId, request) };
    throw error;
  }
}

/** The source bill's supplier and offer, and whether it charges a one-off fee (only the first bill of a contract does). */
async function currentOfferOf(billRepository: Pick<BillRepository, "get">, tenantId: string, request: ElectricitySimulationRequest): Promise<{ readonly currentOffer?: CurrentSupplyOffer; readonly billPeakEnergy?: BillPeakEnergy }> {
  if (!request.sourceBill) return {};
  try {
    const document = await billRepository.get(tenantId, request.sourceBill.billId);
    const bill = document && document.tenantId === tenantId ? toPublicApprovedDocument(document)?.structuredBill : null;
    if (!bill) return {};
    const found = (field: { readonly status: string; readonly value: unknown } | undefined) => field?.status === "FOUND" && typeof field.value === "string" ? field.value : null;
    const offer = [found(bill.offerCode), found(bill.offerName), bill.documentOfferName ?? null].filter((value): value is string => !!value?.trim()).join(" ") || null;
    return { currentOffer: { supplier: found(bill.supplier), offer, oneOffBilled: bill.economicChargeLines.some((line) => ONE_OFF_BILL_LINE.test(`${line.description} ${line.rawDescription ?? ""}`)), indexStructure: billIndexStructure(bill) }, ...peakEnergyOf(bill) };
  } catch { return {}; }
}

export async function resolveTrustedElectricityFiscalContextFromSourceBill(
  billRepository: Pick<BillRepository, "get">,
  tenantId: string,
  request: ElectricitySimulationRequest,
): Promise<TrustedElectricityFiscalContext | null> {
  const resolved = await resolveApprovedSourceBillContext(billRepository, tenantId, request);
  if (!resolved) return null;
  return buildTrustedElectricityFiscalContext({
    supplyContext: resolved.supplyContext,
    extendedFacts: resolved.structuredBill.extendedFacts,
    simulationPeriod: request.supplyPeriod,
    evidenceSource: {
      sourceKind: "APPROVED_SOURCE_BILL",
      sourceReference: `bill-document:${resolved.billId}`,
      approvedBillBinding: { billId: resolved.billId, approvedVersionId: resolved.approvedVersionId },
    },
  });
}

const kwhNumber = (value: string): number | null => {
  const text = value.replace(/kwh/gi, "").replace(/\s/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  const number = /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
};

/** Tony (30/10): "errore su come calcolare il capacity". The kWh the approved bill prints in Terna's peak hours and in the
 *  other hours, read only from the bill's documentary facts (never from the request). Both must be there. */
export function peakEnergyOf(bill: Pick<NonNullable<PublicBillDocument["structuredBill"]>, "extendedFacts">): { readonly billPeakEnergy?: BillPeakEnergy } {
  const read = (code: string) => { const fact = bill.extendedFacts.find((item) => item.code === code && item.status === "FOUND" && item.value.trim() !== ""); return fact ? kwhNumber(fact.value) : null; };
  const peakKwh = read("ENERGY_PEAK_KWH"); const offPeakKwh = read("ENERGY_OFF_PEAK_KWH");
  return peakKwh !== null && offPeakKwh !== null && peakKwh + offPeakKwh > 0 ? { billPeakEnergy: { peakKwh, offPeakKwh } } : {};
}
