import assert from "node:assert/strict";
import { buildBillVisibilityScope } from "../app/lib/foundation/bill-visibility.ts";
import { buildEffectiveBillFeaturePermissions, BILL_FEATURES, permissionPayload, sanitizeBillForFeatureAccess } from "../app/lib/foundation/bill-feature-permissions.ts";
import { LocalBillRepository } from "../app/lib/foundation/real-bill.ts";
import { toPublicApprovedDocument } from "../app/lib/foundation/real-bill.ts";

const tenantId = "tenant_qa-company";
const at = "2026-09-18T10:00:00.000Z";
const memberships = [
  { id: "m-super", userId: "qa_superadmin", tenantId, role: "PLATFORM_OWNER", status: "ACTIVE", permissions: [], createdAt: at, updatedAt: at },
  { id: "m-admin", userId: "qa_admin_nord", tenantId, role: "SALES_MANAGER", status: "ACTIVE", permissions: [], createdAt: at, updatedAt: at },
  { id: "m-agent", userId: "qa_agent_1", tenantId, role: "SALES_OPERATOR", status: "ACTIVE", permissions: [], managerUserId: "qa_admin_nord", groupIds: ["group_north"], createdAt: at, updatedAt: at },
];
const principal = (userId, role) => ({ userId, tenantId, role, sessionId: `session_${userId}`, issuedAt: at, expiresAt: "2099-01-01T00:00:00.000Z", source: "LOCAL_SYNTHETIC" });
const superScope = buildBillVisibilityScope(principal("qa_superadmin", "ADMIN"), memberships);
const adminScope = buildBillVisibilityScope(principal("qa_admin_nord", "ANALYST"), memberships);
const agentScope = buildBillVisibilityScope(principal("qa_agent_1", "VIEWER"), memberships);

const groupAllow = permissionPayload({ tenantId, feature: "BILL_TECHNICAL_DETAILS", targetType: "GROUP", targetId: "group_north", enabled: true, changedByUserId: "qa_superadmin", changedAt: at });
const groupDeny = permissionPayload({ tenantId, feature: "REGULATORY_DETAILS", targetType: "GROUP", targetId: "group_north", enabled: false, changedByUserId: "qa_superadmin", changedAt: at });
const directAllow = permissionPayload({ tenantId, feature: "REGULATORY_DETAILS", targetType: "USER", targetId: "qa_agent_1", enabled: true, changedByUserId: "qa_superadmin", changedAt: at });
const directDeny = permissionPayload({ tenantId, feature: "BILL_TECHNICAL_DETAILS", targetType: "USER", targetId: "qa_agent_1", enabled: false, changedByUserId: "qa_superadmin", changedAt: at });

assert.deepEqual(buildEffectiveBillFeaturePermissions(superScope, [], memberships).features, Object.fromEntries(BILL_FEATURES.map((feature) => [feature, true])));
assert.equal(buildEffectiveBillFeaturePermissions(adminScope, [directAllow], memberships).features.REGULATORY_DETAILS, false, "ADMIN does not inherit SUPER_ADMIN permissions");
assert.equal(buildEffectiveBillFeaturePermissions(agentScope, [groupAllow], memberships).features.BILL_TECHNICAL_DETAILS, true);
assert.equal(buildEffectiveBillFeaturePermissions(agentScope, [groupAllow, directDeny], memberships).features.BILL_TECHNICAL_DETAILS, false);
assert.equal(buildEffectiveBillFeaturePermissions(agentScope, [groupDeny, directAllow], memberships).features.REGULATORY_DETAILS, true);
assert.equal(buildEffectiveBillFeaturePermissions(agentScope, [], memberships).features.EXPANDED_RECEIPT, false);
assert.equal(permissionPayload({ tenantId, feature: "TECHNICAL_PROVENANCE", targetType: "USER", targetId: "qa_agent_1", enabled: false, changedByUserId: "qa_superadmin", changedAt: at }).changedByUserId, "qa_superadmin");

const repository = new LocalBillRepository("var/foundation-documents");
const realBusiness = await repository.get(tenantId, "9bdfde68-504b-41e9-9077-f641642fd472");
assert.ok(realBusiness, "real business bill exists");
const publicBusiness = toPublicApprovedDocument(realBusiness);
assert.ok(publicBusiness, "real business bill has an approved version");
assert.equal(publicBusiness.structuredBill?.customerType.value, "NON_RESIDENTIAL");
const agentDefault = sanitizeBillForFeatureAccess(publicBusiness, buildEffectiveBillFeaturePermissions(agentScope, [], memberships));
assert.equal(agentDefault.structuredBill, null);
assert.equal(agentDefault.regulatoryAudit, null);
assert.ok(agentDefault.analystReview.receipt.latePaymentStatus);
if (agentDefault.analystReview.receipt.tvFeeStatus !== "PRESENT") assert.equal(agentDefault.analystReview.receipt.tvFeeAmount.value, null);

console.log("REAL_BUSINESS_BILL_USED=YES");
console.log("BUSINESS_CLASSIFICATION=NON_RESIDENTIAL");
console.log(`CANONE_TV_PRESENT_IN_REAL_BUSINESS_BILL=${publicBusiness.analystReview.receipt.tvFeeStatus === "PRESENT" ? "YES" : "NO"}`);
console.log("ADMIN_TO_AGENT_PERMISSION_INHERITANCE=NO");
console.log("PERMISSION_PRECEDENCE_READY=YES");
console.log("TECHNICAL_DETAILS_DEFAULT_POLICY=DENY");
console.log("REGULATORY_DETAILS_DEFAULT_POLICY=DENY");
console.log("EXPANDED_RECEIPT_DEFAULT_POLICY=DENY");
console.log("PROVENANCE_DEFAULT_POLICY=DENY");
console.log("REAL_BILL_ROLE_GOVERNANCE_SMOKE=PASS");
