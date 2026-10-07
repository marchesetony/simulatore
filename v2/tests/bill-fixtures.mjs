import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, assignment, credentials } from "./fixtures.mjs";
import { login } from "../modules/auth/service.ts";
import { BillService } from "../modules/bills/service.ts";

export const period = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
export const line = (patch = {}) => ({ ...period, kind: "ENERGY", level: "DETAIL", description: "Voce test",
  quantity: null, unit: null, unitPrice: null, amount: 1000, documentTotalParticipation: "INCLUDED", ...patch });
export const input = (patch = {}) => ({ ...period, documentNumber: "TEST-1", issueDate: "2026-08-01",
  declaredDocumentTotal: 1000, currency: "EUR", consumptions: [], lines: [line()], ...patch });
export const consumption = (band, energyKwh, patch = {}) => ({ ...period, band, energyKwh, ...patch });

/** Test-only adapter. Never imported by application runtime. */
export class MemoryBills {
  bills = new Map(); supplies = new Map();
  async list(tenant) { return structuredClone([...this.bills.values()].filter(row => row.tenantId === tenant)); }
  async get(tenant, id) { const row = this.bills.get(id); return row?.tenantId === tenant ? structuredClone(row) : null; }
  async create(row) { assert.equal(this.bills.has(row.id), false); this.bills.set(row.id, structuredClone(row)); return structuredClone(row); }
  async replace(tenant, id, row) {
    const previous = await this.get(tenant, id);
    if (!previous) return null;
    for (const key of ["id", "tenantId", "customerId", "supplyId"]) assert.equal(row[key], previous[key]);
    this.bills.set(id, structuredClone(row)); return structuredClone(row);
  }
  async listSupplies(tenant) { return structuredClone([...this.supplies.values()].filter(row => row.tenantId === tenant)); }
  async getSupply(tenant, id) { const row = this.supplies.get(id); return row?.tenantId === tenant ? structuredClone(row) : null; }
  async createSupply(row) { this.supplies.set(row.id, structuredClone(row)); return structuredClone(row); }
}
export async function setup(role = "TENANT_ADMIN") {
  const f = fixture([assignment(role)]), repository = new MemoryBills();
  const customerId = randomUUID();
  const customers = new Map([[customerId, { id: customerId, tenantId: "tenant_test", name: "Cliente test", taxCode: null, vatNumber: null }]]);
  const customerRepository = { get: async (tenant, id) => customers.get(id)?.tenantId === tenant ? structuredClone(customers.get(id)) : null };
  const service = new BillService(f.deps, repository, customerRepository);
  const result = await login(credentials, f.deps); assert.equal(result.kind, "AUTHENTICATED");
  const target = role === "PLATFORM_OWNER" ? "tenant_test" : undefined;
  const supply = await service.createSupply(result.token, { customerId, pod: " it001e12345678 " }, target);
  return { ...f, repository, customers, customerRepository, customerId, supply, service, token: result.token, target,
    create: patch => service.create(result.token, { ...input(patch), customerId, supplyId: supply.id }, target) };
}
