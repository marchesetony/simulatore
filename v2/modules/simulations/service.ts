import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthDependencies } from "../auth/service";
import type { BillRepository } from "../bills/repository";
import type { CustomerRepository } from "../customers/repository";
import { identifier } from "../bills/values";
import { BillError } from "../bills/types";
import { CALCULATION_VERSION, SimulationError, type Simulation, type SimulationInputSnapshot } from "./types";
import type { SimulationRepository } from "./repository";
import { simulationTenant } from "./access";
import { simulationInput } from "./schema";
import { calculate } from "./engine";

export class SimulationService {
  constructor(private readonly auth: AuthDependencies, private readonly repository: SimulationRepository,
    private readonly bills: Pick<BillRepository, "get" | "getSupply">, private readonly customers: Pick<CustomerRepository, "get">) {}

  private async store<T>(read: () => Promise<T>): Promise<T> {
    try { return await read(); }
    catch { throw new SimulationError("UNAVAILABLE"); }
  }
  private id(value: string): string {
    try { return identifier(value); }
    catch (error) { if (error instanceof BillError) throw new SimulationError("INVALID_INPUT"); throw error; }
  }
  private owned<T extends { readonly tenantId: string; readonly id: string }>(row: T | null, tenant: string, id?: string): T {
    if (!row) throw new SimulationError("NOT_FOUND");
    if (row.tenantId !== tenant || (id !== undefined && row.id !== id)) throw new SimulationError("DENIED");
    return structuredClone(row);
  }
  private result(row: Simulation | null, tenant: string, id?: string): Simulation {
    const result = this.owned(row, tenant, id);
    if (result.billId !== result.inputSnapshot.billReference.id || result.supplyId !== result.inputSnapshot.supplyReference.id) throw new SimulationError("DENIED");
    return result;
  }
  async list(token: string, target?: string): Promise<readonly Simulation[]> {
    const tenant = await simulationTenant(this.auth, token, "simulations:list", target);
    return (await this.store(() => this.repository.list(tenant))).map(row => this.result(row, tenant));
  }
  async get(token: string, id: string, target?: string): Promise<Simulation> {
    const tenant = await simulationTenant(this.auth, token, "simulations:read", target), key = this.id(id);
    return this.result(await this.store(() => this.repository.get(tenant, key)), tenant, key);
  }
  private async source(tenant: string, id: string) {
    const bill = this.owned(await this.store(() => this.bills.get(tenant, id)), tenant, id);
    const supply = this.owned(await this.store(() => this.bills.getSupply(tenant, bill.supplyId)), tenant, bill.supplyId);
    this.owned(await this.store(() => this.customers.get(tenant, bill.customerId)), tenant, bill.customerId);
    if (supply.customerId !== bill.customerId || bill.consumptions.some(row => row.tenantId !== tenant || row.billId !== id)) throw new SimulationError("DENIED");
    return { bill, supply };
  }
  async create(token: string, payload: unknown, target?: string): Promise<Simulation> {
    const tenant = await simulationTenant(this.auth, token, "simulations:create", target);
    const { billId, ...input } = simulationInput(payload);
    const { bill, supply } = await this.source(tenant, billId);
    if (input.calculationPeriod.periodStart < bill.periodStart || input.calculationPeriod.periodEnd > bill.periodEnd) throw new SimulationError("INVALID_INPUT");
    const inputSnapshot: SimulationInputSnapshot = structuredClone({ ...input,
      billReference: { id: bill.id, documentNumber: bill.documentNumber, customerId: bill.customerId },
      supplyReference: { id: supply.id, pod: supply.pod }, calculationVersion: CALCULATION_VERSION,
      consumptionProfile: bill.consumptions.map(({ periodStart, periodEnd, band, energyKwh }) => ({ periodStart, periodEnd, band, energyKwh })) });
    const result = calculate(inputSnapshot);
    const simulation: Simulation = { id: randomUUID(), tenantId: tenant, billId, supplyId: supply.id,
      scope: "COMMERCIAL_ONLY", status: result.status, inputSnapshot, result, calculationVersion: CALCULATION_VERSION };
    return this.result(await this.store(() => this.repository.create(simulation)), tenant, simulation.id);
  }
}
