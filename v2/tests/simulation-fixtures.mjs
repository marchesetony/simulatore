import assert from "node:assert/strict";
import { setup as billSetup, consumption } from "./bill-fixtures.mjs";
import { CALCULATION_VERSION, FEE_KINDS } from "../modules/simulations/types.ts";
import { SimulationService } from "../modules/simulations/service.ts";
export const period = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
export const absent = () => ({ applicability: "NOT_APPLICABLE", amount: null, unit: null });
export const rate = (amount = "0.2", unit = "EUR_PER_KWH") => ({ applicability: "APPLIES", amount, unit });
export const terms = (patch = {}) => ({ ...period, reference: "manual-test-v1", mode: "FIXED", taxTreatment: "EXCLUDED",
  fixedPrice: rate(), spread: absent(), fees: FEE_KINDS.map(kind => ({ kind, ...absent() })), ...patch });
export const indexed = () => terms({ mode: "INDEXED", fixedPrice: absent(), spread: rate("0.01") });
export const market = (month = "2026-07") => ({ reference: "test-market-v1", values: ["F1", "F2", "F3"].map(band =>
  ({ month, band, value: "100", unit: "EUR_PER_MWH", versionReference: "test-v1" })) });
export const profile = () => [consumption("F1", "100"), consumption("F2", "50"), consumption("F3", "50")];
export const snapshot = (patch = {}) => ({ billReference: { id: "00000000-0000-4000-8000-000000000001", documentNumber: "TEST", customerId: "test" },
  supplyReference: { id: "supply-test", pod: "IT001E12345678" }, calculationVersion: CALCULATION_VERSION, calculationPeriod: period,
  consumptionProfile: profile(), candidateCommercialTerms: terms(), currentCommercialTerms: null, marketSnapshot: null, ...patch });
export function feeTerms(kind, amount, unit) {
  return terms({ fees: terms().fees.map(row => row.kind === kind ? { kind, ...rate(amount, unit) } : row) });
}
/** Only tests have a memory adapter; no mutation operation is part of the port. */
export class MemorySimulations {
  rows = new Map();
  async list(tenantId) { return structuredClone([...this.rows.values()].filter(row => row.tenantId === tenantId)); }
  async get(tenantId, id) { const row = this.rows.get(id); return row?.tenantId === tenantId ? structuredClone(row) : null; }
  async create(row) { assert.equal(this.rows.has(row.id), false); this.rows.set(row.id, structuredClone(row)); return structuredClone(row); }
}
export async function setup(role = "TENANT_ADMIN") {
  const f = await billSetup(role), bill = await f.create({ consumptions: profile() });
  const store = new MemorySimulations();
  const service = new SimulationService(f.deps, store, f.repository, f.customerRepository);
  const payload = (patch = {}) => ({ billId: bill.id, calculationPeriod: period, candidateCommercialTerms: terms(), currentCommercialTerms: null, marketSnapshot: null, ...patch });
  return { ...f, bill, store, simulationService: service, payload, calculate: patch => service.create(f.token, payload(patch), f.target) };
}
