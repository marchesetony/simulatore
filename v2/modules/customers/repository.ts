import "server-only";
import type { SupabaseHttp } from "../auth/supabase-http";
import { customerId, customerInput } from "./schema";
import { CustomerError, type Customer, type CustomerInput } from "./types";

export interface CustomerRepository {
  list(tenantId: string): Promise<readonly Customer[]>;
  get(tenantId: string, id: string): Promise<Customer | null>;
  create(customer: Customer): Promise<Customer>;
  update(tenantId: string, id: string, input: CustomerInput): Promise<Customer | null>;
}

// Contract: proposed public.v2_customers, not an existing V1 table.
export class SupabaseCustomerRepository implements CustomerRepository {
  constructor(private readonly http: SupabaseHttp) {}
  private async rows(tenantId: string, id?: string, init?: RequestInit): Promise<readonly Customer[]> {
    const params = new URLSearchParams({ select: "id,tenant_id,name,tax_code,vat_number", tenant_id: `eq.${tenantId}`,
      order: "name.asc,id.asc", limit: "101", ...(id ? { id: `eq.${id}` } : {}) });
    try {
      const result = await this.http.request(`/rest/v1/v2_customers?${params}`, init);
      if (!Array.isArray(result) || result.length > 100) throw new CustomerError("UNAVAILABLE");
      return result.map((row: unknown) => {
        if (!row || typeof row !== "object" || !("tenant_id" in row) || row.tenant_id !== tenantId ||
            !("id" in row) || typeof row.id !== "string") throw new CustomerError("UNAVAILABLE");
        const data = row as Record<string, unknown>;
        if (!("tax_code" in data) || !("vat_number" in data)) throw new CustomerError("UNAVAILABLE");
        const input = customerInput({ name: data.name, taxCode: data.tax_code, vatNumber: data.vat_number });
        if (id && row.id !== id) throw new CustomerError("UNAVAILABLE");
        return { ...input, id: customerId(row.id), tenantId };
      });
    } catch { throw new CustomerError("UNAVAILABLE"); }
  }
  list(tenantId: string) { return this.rows(tenantId); }
  async get(tenantId: string, id: string) { return this.single(await this.rows(tenantId, id)); }
  private single(rows: readonly Customer[]): Customer | null {
    if (rows.length > 1) throw new CustomerError("UNAVAILABLE");
    return rows[0] ?? null;
  }
  async create(customer: Customer): Promise<Customer> {
    const result = this.single(await this.rows(customer.tenantId, customer.id, {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id: customer.id, tenant_id: customer.tenantId, ...this.fields(customer) }),
    }));
    if (!result) throw new CustomerError("UNAVAILABLE");
    return result;
  }
  async update(tenantId: string, id: string, input: CustomerInput) {
    return this.single(await this.rows(tenantId, id, { method: "PATCH",
      headers: { Prefer: "return=representation" }, body: JSON.stringify(this.fields(input)) }));
  }
  private fields(input: CustomerInput) {
    return { name: input.name, tax_code: input.taxCode, vat_number: input.vatNumber };
  }
}
