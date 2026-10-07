import "server-only";
import { CteError, type CteOfferVersion } from "./types";
export interface CteRepository { list(tenantId: string): Promise<readonly CteOfferVersion[]>; get(tenantId: string, id: string): Promise<CteOfferVersion | null>; createVersion(value: CteOfferVersion): Promise<CteOfferVersion>; }
export class UnavailableCteRepository implements CteRepository {
  async list(): Promise<readonly CteOfferVersion[]> { throw new CteError("UNAVAILABLE"); }
  async get(): Promise<CteOfferVersion | null> { throw new CteError("UNAVAILABLE"); }
  async createVersion(): Promise<CteOfferVersion> { throw new CteError("UNAVAILABLE"); }
}
export class InMemoryCteRepository implements CteRepository {
  private readonly rows = new Map<string, CteOfferVersion>();
  async list(tenantId: string): Promise<readonly CteOfferVersion[]> { return [...this.rows.values()].filter(row => row.tenantId === tenantId).map(row => structuredClone(row)); }
  async get(tenantId: string, id: string): Promise<CteOfferVersion | null> { const row = this.rows.get(id); return row && row.tenantId === tenantId ? structuredClone(row) : null; }
  async createVersion(value: CteOfferVersion): Promise<CteOfferVersion> { if (this.rows.has(value.id)) throw new CteError("INVALID_INPUT"); this.rows.set(value.id, structuredClone(value)); return structuredClone(value); }
}
