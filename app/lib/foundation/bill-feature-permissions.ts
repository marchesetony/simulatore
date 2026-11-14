import type { AuthenticatedPrincipal } from "../auth/types.ts";
import type { RuntimeRepositories } from "../persistence/adapter.ts";
import type { FoundationMembershipRecord, TenantRecordRepository } from "../persistence/types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
import type { PublicBillDocument } from "./real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billReadingView } from "./bill-reading-view.ts";
import type { BillHierarchyRole, BillVisibilityScope } from "./bill-visibility.ts";

export const BILL_FEATURES = [
  "BILL_TECHNICAL_DETAILS",
  "REGULATORY_DETAILS",
  "EXPANDED_RECEIPT",
  "TECHNICAL_PROVENANCE",
] as const;

export type BillFeature = typeof BILL_FEATURES[number];
export type BillFeatureTargetType = "USER" | "GROUP";

export interface BillFeaturePermissionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly feature: BillFeature;
  readonly targetType: BillFeatureTargetType;
  readonly targetId: string;
  readonly enabled: boolean;
  readonly changedByUserId: string;
  readonly changedAt: string;
}

export interface BillFeatureAccessSnapshot {
  readonly role: BillHierarchyRole;
  readonly features: Readonly<Record<BillFeature, boolean>>;
  readonly defaultPolicy: "DENY";
}

export interface BillVerificationSummary {
  readonly componentsVerified: number;
  readonly componentsNotComparable: number;
  readonly anomaliesDetected: number;
  readonly status: "VERIFIED" | "REVIEW_REQUIRED" | "NOT_AVAILABLE";
  readonly message: string;
  readonly details: readonly { readonly label: string; readonly state: "COMPARABLE" | "NON_COMPARABLE"; readonly reason: string | null }[];
}

export function isBillFeature(value: unknown): value is BillFeature {
  return typeof value === "string" && BILL_FEATURES.includes(value as BillFeature);
}

export function isBillFeatureTargetType(value: unknown): value is BillFeatureTargetType {
  return value === "USER" || value === "GROUP";
}

export function permissionRecordId(tenantId: string, feature: BillFeature, targetType: BillFeatureTargetType, targetId: string): string {
  return deterministicRecordId("bill-feature-permission", tenantId, `${feature}|${targetType}|${targetId}`);
}

function emptyFeatures(): Record<BillFeature, boolean> {
  return Object.fromEntries(BILL_FEATURES.map((feature) => [feature, false])) as Record<BillFeature, boolean>;
}

function groupIdsFor(scope: BillVisibilityScope, memberships: readonly FoundationMembershipRecord[]): ReadonlySet<string> {
  const membership = memberships.find((item) => item.tenantId === scope.tenantId && item.userId === scope.userId && item.status === "ACTIVE");
  return new Set(membership?.groupIds ?? []);
}

function effectiveFeature(scope: BillVisibilityScope, feature: BillFeature, records: readonly BillFeaturePermissionRecord[], memberships: readonly FoundationMembershipRecord[]): boolean {
  if (scope.role === "SUPER_ADMIN") return true;
  const direct = records.find((record) => record.tenantId === scope.tenantId && record.feature === feature && record.targetType === "USER" && record.targetId === scope.userId);
  if (direct) return direct.enabled;
  const groups = groupIdsFor(scope, memberships);
  const groupRules = records.filter((record) => record.tenantId === scope.tenantId && record.feature === feature && record.targetType === "GROUP" && groups.has(record.targetId));
  if (groupRules.some((record) => !record.enabled)) return false;
  return groupRules.some((record) => record.enabled);
}

export function buildEffectiveBillFeaturePermissions(scope: BillVisibilityScope, records: readonly BillFeaturePermissionRecord[], memberships: readonly FoundationMembershipRecord[]): BillFeatureAccessSnapshot {
  const features = emptyFeatures();
  for (const feature of BILL_FEATURES) features[feature] = effectiveFeature(scope, feature, records, memberships);
  return { role: scope.role, features: Object.freeze(features), defaultPolicy: "DENY" };
}

export async function resolveBillFeaturePermissions(principal: AuthenticatedPrincipal, repositories: Pick<RuntimeRepositories, "billFeaturePermissions" | "foundationMemberships">, scope: BillVisibilityScope): Promise<BillFeatureAccessSnapshot> {
  const [permissionRecords, memberships] = await Promise.all([
    repositories.billFeaturePermissions.list(principal.tenantId),
    repositories.foundationMemberships.list(principal.tenantId),
  ]);
  return buildEffectiveBillFeaturePermissions(scope, permissionRecords.map((record) => record.payload), memberships.map((record) => record.payload));
}

export function permissionPayload(input: Omit<BillFeaturePermissionRecord, "id">): BillFeaturePermissionRecord {
  return { ...input, id: permissionRecordId(input.tenantId, input.feature, input.targetType, input.targetId) };
}

export function permissionRepository(repositories: Pick<RuntimeRepositories, "billFeaturePermissions">): TenantRecordRepository<BillFeaturePermissionRecord> {
  return repositories.billFeaturePermissions;
}

export function billVerificationSummary(document: PublicBillDocument): BillVerificationSummary | null {
  const audit = document.regulatoryAudit;
  if (!audit) return null;
  const passThrough = audit.regulatedPassThrough?.summary;
  const componentsVerified = passThrough?.comparableCount ?? audit.summary.verifiedRegulatedCount;
  const componentsNotComparable = passThrough
    ? passThrough.nonComparableCount + passThrough.notIdentifiedCount + passThrough.officialReferenceMissingCount
    : audit.summary.notComparableCount;
  const anomaliesDetected = audit.summary.confirmedAnomalyCount;
  const status = anomaliesDetected > 0 || componentsNotComparable > 0 ? "REVIEW_REQUIRED" : "VERIFIED";
  const details = (audit.regulatedPassThrough?.items ?? []).map((item) => ({ label: item.label, state: item.comparable ? "COMPARABLE" as const : "NON_COMPARABLE" as const, reason: item.comparable ? null : item.humanReason ?? "La voce richiede verifica amministrativa." }));
  return {
    componentsVerified,
    componentsNotComparable,
    anomaliesDetected,
    status,
    message: anomaliesDetected > 0 ? `${anomaliesDetected} componenti richiedono verifica amministrativa` : componentsNotComparable > 0 ? `${componentsNotComparable} componenti non sono confrontabili automaticamente` : "Componenti verificate senza anomalie rilevate",
    details,
  };
}

function scrubRawValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => scrubRawValues(item)) as T;
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = key === "raw" || key === "rawDescription" || key === "rawValue" || key === "rawUnit" || key === "rawQuantity" || key === "rawUnitPrice" || key === "rawAmount" || key === "rawPeriod" ? null : scrubRawValues(item);
  return output as T;
}

type EconomicComponent = PublicBillDocument["analystReview"]["economics"]["economicAnalysis"]["components"][number];
const NOT_FOR_COMPARISON = new Set(["BILL_TOTAL", "AMOUNT_DUE", "PRIOR_BALANCE", "TAX_SUBTOTAL"]);

// Tony (12/11, "Fase A confronto ELIOS"): without the technical detail the comparison showed the bill's Quota consumi at 0 and
// the whole supply (971,57 €) as "Altre partite", because the receipt places the bill's money by its priced lines and those
// were emptied. The comparison column gets back only the bill's own priced lines (description, quantity, unit price, unit,
// amount, classification): no raw text, no evidence, no subtotals or balances, no new permission. They come from the same
// bill the user is already allowed to see, so tenant and branch isolation are those of the bill itself.
export function comparisonComponentsOf(components: readonly EconomicComponent[]): readonly EconomicComponent[] {
  return components.filter((line) => !line.aggregate && !NOT_FOR_COMPARISON.has(line.classification)).map((line) => ({
    lineId: line.lineId, code: line.code, normalizedCode: line.normalizedCode, classification: line.classification, group: line.group,
    accountingRole: line.accountingRole, includedInReconciliation: line.includedInReconciliation, aggregate: false, atomic: line.atomic,
    parentComponent: null, childComponents: [], description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
    unit: line.unit, amount: line.amount, period: line.period, rawDescription: "", rawValue: "", rawUnit: "", rawQuantity: "",
    rawUnitPrice: "", rawAmount: "", rawPeriod: "", documentEvidence: "", calculationCheck: line.calculationCheck, status: line.status,
  }));
}

function hideTechnicalReview(review: PublicBillDocument["analystReview"], hideEconomicDetail: boolean): PublicBillDocument["analystReview"] {
  const next = scrubRawValues(structuredClone(review));
  if (!hideEconomicDetail) return next;
  const analysis = next.economics.economicAnalysis;
  return {
    ...next,
    economics: {
      ...next.economics,
      comparisonComponents: comparisonComponentsOf(analysis.components),
      chargeLines: [],
      economicAnalysis: {
        ...analysis,
        components: [],
        currentSellerCostBreakdown: { ENERGY_PRICE: [], COMMERCIALIZATION: [], DISPATCHING_OR_PASS_THROUGH: [], CAPACITY_MARKET: [], OTHER_SELLER_CHARGES: [] },
        regulatedAndSystemCosts: { ARERA_NETWORK: [], ARERA_SYSTEM_CHARGES: [], TERNA_DISPATCHING_REFERENCES: [], GME_MARKET_REFERENCE: [] },
        taxesAndOtherItems: { TAXES: [], OTHER_ITEMS: [] },
      },
    },
    provenance: [],
  };
}

export function sanitizeBillForFeatureAccess(document: PublicBillDocument, access: BillFeatureAccessSnapshot): PublicBillDocument {
  const fullSummary = billVerificationSummary(document);
  const technical = access.features.BILL_TECHNICAL_DETAILS;
  const regulatory = access.features.REGULATORY_DETAILS;
  const expandedReceipt = access.features.EXPANDED_RECEIPT;
  const provenance = access.features.TECHNICAL_PROVENANCE;
  const review = hideTechnicalReview(document.analystReview, !technical || !expandedReceipt);
  return {
    ...document,
    featurePermissions: access,
    structuredBill: technical ? document.structuredBill : null,
    // Tony (10/11/2026): the bill data of "Dati letti" go to everyone who may open the bill, whatever "Dettaglio tecnico" says.
    billReading: billReadingView(document.structuredBill),
    invoicePunReferences: regulatory ? document.invoicePunReferences : [],
    regulatoryAudit: regulatory ? document.regulatoryAudit : null,
    verificationSummary: fullSummary,
    analystReview: {
      ...review,
      provenance: provenance ? review.provenance : [],
    },
  };
}
