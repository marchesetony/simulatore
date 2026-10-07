import "server-only";
import { randomUUID } from "node:crypto";
import { verifySession } from "../auth/session";
import { authorize } from "../auth/access";
import type { AuthDependencies } from "../auth/service";
import type { CustomerPermission } from "../auth/types";
import type { CustomerRepository } from "./repository";
import { customerId, customerInput } from "./schema";
import { CustomerError, type Customer, type CustomerView } from "./types";

export class CustomerService {
  constructor(private readonly auth: AuthDependencies, private readonly repository: CustomerRepository) {}
  private async tenant(token: string, permission: CustomerPermission, target?: string): Promise<string> {
    const principal = await verifySession(token, this.auth.sessions, this.auth.access);
    const tenantId = principal.scope === "TENANT" ? principal.tenantId : target;
    if (!tenantId || !/^tenant_[a-z0-9-]+$/.test(tenantId) ||
        (principal.scope === "TENANT" && target !== undefined && target !== tenantId) ||
        !await authorize(principal, permission, "TENANT", this.auth.access, tenantId)) throw new CustomerError("DENIED");
    return tenantId;
  }
  private view(row: Customer | null, tenantId: string): CustomerView {
    if (!row) throw new CustomerError("NOT_FOUND");
    if (row.tenantId !== tenantId) throw new CustomerError("DENIED");
    return { id: row.id, name: row.name, taxCode: row.taxCode, vatNumber: row.vatNumber };
  }
  async list(token: string, target?: string) {
    const tenant = await this.tenant(token, "customers:list", target);
    return (await this.repository.list(tenant)).map(row => this.view(row, tenant));
  }
  async get(token: string, id: string, target?: string) {
    const tenant = await this.tenant(token, "customers:read", target);
    return this.view(await this.repository.get(tenant, customerId(id)), tenant);
  }
  async create(token: string, payload: unknown, target?: string) {
    const tenant = await this.tenant(token, "customers:create", target);
    return this.view(await this.repository.create({ ...customerInput(payload), id: randomUUID(), tenantId: tenant }), tenant);
  }
  async update(token: string, id: string, payload: unknown, target?: string) {
    const tenant = await this.tenant(token, "customers:update", target);
    return this.view(await this.repository.update(tenant, customerId(id), customerInput(payload)), tenant);
  }
}
