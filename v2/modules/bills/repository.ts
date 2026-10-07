import "server-only";
import { BillError, type Bill, type Supply } from "./types";

/** All operations are tenant scoped. replace must atomically replace the complete
 * snapshot, including its children, without changing document ownership. */
export interface BillRepository {
  list(tenantId: string): Promise<readonly Bill[]>;
  get(tenantId: string, id: string): Promise<Bill | null>;
  create(bill: Bill): Promise<Bill>;
  replace(tenantId: string, id: string, bill: Bill): Promise<Bill | null>;
  listSupplies(tenantId: string): Promise<readonly Supply[]>;
  getSupply(tenantId: string, id: string): Promise<Supply | null>;
  createSupply(supply: Supply): Promise<Supply>;
}

/** The local baseline has no reviewed Bill V2 datastore schema. Production must
 * remain unavailable until an atomic tenant-aware adapter is explicitly wired.
 * This adapter never acknowledges a write or returns a fabricated empty list. */
export class UnavailableBillRepository implements BillRepository {
  private unavailable(): never { throw new BillError("UNAVAILABLE"); }
  async list(): Promise<readonly Bill[]> { return this.unavailable(); }
  async get(): Promise<Bill | null> { return this.unavailable(); }
  async create(): Promise<Bill> { return this.unavailable(); }
  async replace(): Promise<Bill | null> { return this.unavailable(); }
  async listSupplies(): Promise<readonly Supply[]> { return this.unavailable(); }
  async getSupply(): Promise<Supply | null> { return this.unavailable(); }
  async createSupply(): Promise<Supply> { return this.unavailable(); }
}
