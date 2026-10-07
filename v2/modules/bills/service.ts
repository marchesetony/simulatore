import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthDependencies } from "../auth/service";
import type { CustomerRepository } from "../customers/repository";
import type { BillRepository } from "./repository";
import { BillError, type Bill, type Supply } from "./types";
import { billCreateInput, billInput, supplyInput } from "./schema";
import { identifier } from "./values";
import { billTenant } from "./access";
import { snapshot } from "./snapshot";

export class BillService {
  constructor(private readonly auth: AuthDependencies, private readonly repository: BillRepository,
    private readonly customers: CustomerRepository) {}

  private async store<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { if (error instanceof BillError) throw error; throw new BillError("UNAVAILABLE"); }
  }
  private owned<T extends { readonly tenantId: string; readonly id: string }>(row: T | null, tenant: string, id?: string): T {
    if (!row) throw new BillError("NOT_FOUND");
    if (row.tenantId !== tenant || (id !== undefined && row.id !== id)) throw new BillError("DENIED");
    return structuredClone(row);
  }
  private bill(row: Bill | null, tenant: string, id?: string): Bill {
    const bill = this.owned(row, tenant, id);
    if ([...bill.lines, ...bill.consumptions].some(child => child.billId !== bill.id || child.tenantId !== tenant)) {
      throw new BillError("DENIED");
    }
    return bill;
  }
  private async customer(tenant: string, id: string): Promise<void> {
    this.owned(await this.store(() => this.customers.get(tenant, id)), tenant, id);
  }
  private async ownership(tenant: string, customerId: string, supplyId: string): Promise<Supply> {
    await this.customer(tenant, customerId);
    const supply = this.owned(await this.store(() => this.repository.getSupply(tenant, supplyId)), tenant, supplyId);
    if (supply.customerId !== customerId) throw new BillError("DENIED");
    return supply;
  }
  async list(token: string, target?: string): Promise<readonly Bill[]> {
    const tenant = await billTenant(this.auth, token, "bills:list", target);
    return (await this.store(() => this.repository.list(tenant))).map(row => this.bill(row, tenant));
  }
  async get(token: string, id: string, target?: string): Promise<Bill> {
    const tenant = await billTenant(this.auth, token, "bills:read", target);
    const key = identifier(id);
    return this.bill(await this.store(() => this.repository.get(tenant, key)), tenant, key);
  }
  async create(token: string, payload: unknown, target?: string): Promise<Bill> {
    const tenant = await billTenant(this.auth, token, "bills:create", target);
    const { customerId, supplyId, ...input } = billCreateInput(payload);
    await this.ownership(tenant, customerId, supplyId);
    const bill = snapshot(input, { id: randomUUID(), tenantId: tenant, customerId, supplyId });
    return this.bill(await this.store(() => this.repository.create(bill)), tenant, bill.id);
  }
  async update(token: string, id: string, payload: unknown, target?: string): Promise<Bill> {
    const tenant = await billTenant(this.auth, token, "bills:update", target);
    const key = identifier(id), input = billInput(payload);
    const previous = this.bill(await this.store(() => this.repository.get(tenant, key)), tenant, key);
    await this.ownership(tenant, previous.customerId, previous.supplyId);
    const bill = snapshot(input, { id: key, tenantId: tenant, customerId: previous.customerId, supplyId: previous.supplyId });
    return this.bill(await this.store(() => this.repository.replace(tenant, key, bill)), tenant, key);
  }
  async listSupplies(token: string, target?: string): Promise<readonly Supply[]> {
    const tenant = await billTenant(this.auth, token, "bills:list", target);
    return (await this.store(() => this.repository.listSupplies(tenant))).map(row => this.owned(row, tenant));
  }
  async getSupply(token: string, id: string, target?: string): Promise<Supply> {
    const tenant = await billTenant(this.auth, token, "bills:read", target);
    const key = identifier(id);
    return this.owned(await this.store(() => this.repository.getSupply(tenant, key)), tenant, key);
  }
  async createSupply(token: string, payload: unknown, target?: string): Promise<Supply> {
    const tenant = await billTenant(this.auth, token, "bills:create", target);
    const input = supplyInput(payload);
    await this.customer(tenant, input.customerId);
    const supply = { ...input, id: randomUUID(), tenantId: tenant };
    return this.owned(await this.store(() => this.repository.createSupply(supply)), tenant, supply.id);
  }
}
