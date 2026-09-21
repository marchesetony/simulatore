import assert from "node:assert/strict";

Object.assign(process.env, {
  APP_RUNTIME_MODE: "local",
  FOUNDATION_LOCAL_DEV: "true",
  AUTH_ADAPTER: "local",
  PERSISTENCE_ADAPTER: "filesystem",
  FOUNDATION_LOCAL_TENANT_ID: "tenant_qa-company",
  FOUNDATION_DOCUMENTS_ROOT: "var/qa-bill-hierarchy/foundation-documents",
});

const { registerAuditRepository, clearAuditRepository } = await import("../app/lib/persistence/audit.ts");
const auditRows = [];
registerAuditRepository({
  async get() { return null; }, async list() { return []; }, async put() { throw new Error("UNUSED"); }, async append(input) { const row = { schemaVersion: 1, recordId: input.recordId, tenantId: input.tenantId, version: 1, createdAt: input.now, updatedAt: input.now, payload: input.payload }; auditRows.push(row); return row; },
  async appendUnscoped(input) { const row = { schemaVersion: 1, recordId: input.recordId, version: 1, createdAt: input.now, updatedAt: input.now, payload: input.payload }; auditRows.push(row); return row; }, async listUnscoped() { return []; },
});
const bills = await import("../app/api/bills/[id]/route.ts");
const governance = await import("../app/api/foundation/bill-feature-permissions/route.ts");
const billId = "1a5af63d-39b2-4017-9c53-32061fd029dd";

async function callAs(userId, role, url, init = {}) {
  process.env.FOUNDATION_LOCAL_USER_ID = userId;
  process.env.FOUNDATION_LOCAL_ROLE = role;
  return bills.GET(new Request(`http://localhost/api/bills/${billId}${url}`, init), { params: Promise.resolve({ id: billId }) });
}

process.env.FOUNDATION_LOCAL_USER_ID = "qa_superadmin";
process.env.FOUNDATION_LOCAL_ROLE = "ADMIN";
const superResponse = await callAs("qa_superadmin", "ADMIN", "");
assert.equal(superResponse.status, 200);
const superBody = await superResponse.json();
assert.equal(superBody.document.featurePermissions.features.BILL_TECHNICAL_DETAILS, true);
assert.equal(superBody.document.featurePermissions.defaultPolicy, "DENY");

const agentResponse = await callAs("qa_agent_1", "VIEWER", "");
assert.equal(agentResponse.status, 200);
const agentBody = await agentResponse.json();
assert.equal(agentBody.document.featurePermissions.features.BILL_TECHNICAL_DETAILS, false);
assert.equal(agentBody.document.structuredBill, null);
assert.equal(agentBody.document.regulatoryAudit, null);

const directTechnical = await callAs("qa_agent_1", "VIEWER", "?feature=BILL_TECHNICAL_DETAILS");
assert.equal(directTechnical.status, 403);
assert.equal((await directTechnical.json()).error.code, "BILL_FEATURE_ACCESS_DENIED");

process.env.FOUNDATION_LOCAL_USER_ID = "qa_admin_nord";
process.env.FOUNDATION_LOCAL_ROLE = "ANALYST";
const adminSelfEnable = await governance.PUT(new Request("http://localhost/api/foundation/bill-feature-permissions", { method: "PUT", body: JSON.stringify({ feature: "BILL_TECHNICAL_DETAILS", targetType: "USER", targetId: "qa_admin_nord", enabled: true }) }));
assert.equal(adminSelfEnable.status, 403);
assert.equal((await adminSelfEnable.json()).error.code, "SUPER_ADMIN_ONLY_PERMISSION_MANAGEMENT");

process.env.FOUNDATION_LOCAL_USER_ID = "qa_agent_1";
process.env.FOUNDATION_LOCAL_ROLE = "VIEWER";
const agentGrant = await governance.PUT(new Request("http://localhost/api/foundation/bill-feature-permissions", { method: "PUT", body: JSON.stringify({ feature: "BILL_TECHNICAL_DETAILS", targetType: "USER", targetId: "qa_agent_2", enabled: true }) }));
assert.equal(agentGrant.status, 403);

process.env.FOUNDATION_LOCAL_USER_ID = "qa_superadmin";
process.env.FOUNDATION_LOCAL_ROLE = "ADMIN";
const tamperedGroup = await governance.PUT(new Request("http://localhost/api/foundation/bill-feature-permissions", { method: "PUT", body: JSON.stringify({ feature: "BILL_TECHNICAL_DETAILS", targetType: "GROUP", targetId: "group_other_tenant", enabled: true }) }));
assert.equal(tamperedGroup.status, 422);

assert.ok(auditRows.length > 0);
clearAuditRepository();
console.log("SUPERADMIN_API_FULL_ACCESS=PASS");
console.log("AGENT_TECHNICAL_DEFAULT_DENY=PASS");
console.log("DIRECT_API_FEATURE_DENY=PASS");
console.log("ADMIN_SELF_ENABLE_DENIED=PASS");
console.log("AGENT_OTHER_USER_GRANT_DENIED=PASS");
console.log("TAMPERED_GROUP_DENIED=PASS");
console.log("SERVER_PERMISSION_ENFORCEMENT_READY=YES");
