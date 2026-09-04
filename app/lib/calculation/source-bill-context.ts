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
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { buildTrustedElectricitySupplyContext, type ElectricitySupplyContext, type TrustedElectricitySupplyContextError } from "./trusted-ee-supply-context.ts";

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

export async function resolveTrustedElectricityContextFromSourceBill(
  billRepository: Pick<BillRepository, "get">,
  tenantId: string,
  request: ElectricitySimulationRequest,
): Promise<ElectricitySupplyContext | null> {
  if (!request.sourceBill) return null;
  const document = await billRepository.get(tenantId, request.sourceBill.billId);
  if (!document || document.tenantId !== tenantId) return fail("SOURCE_BILL_NOT_FOUND");
  const approvedVersionId = document.currentApprovedVersionId;
  if (!approvedVersionId) return fail("SOURCE_BILL_NOT_APPROVED");
  if (request.sourceBill.version !== approvedVersionId) return fail("SOURCE_BILL_VERSION_MISMATCH");
  const approved = publicApproved(document, approvedVersionId);
  const profile = profileFromApprovedStructuredBill(approved);
  let context: ElectricitySupplyContext;
  try { context = buildTrustedElectricitySupplyContext(profile); } catch (error) { return trustedContextError(error); }
  reconcileClientRequest(request, context);
  return context;
}
