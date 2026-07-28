import type { TenantId } from "./types";
import type { TenantContext } from "./tenants";

export class RepositoryScope {
  private constructor(readonly context: TenantContext, readonly tenantId: TenantId) {
    Object.freeze(this);
  }

  static fromContext(context: TenantContext, tenantId: TenantId): RepositoryScope {
    if (!context.isActive() || context.tenantId !== tenantId) throw new Error("REPOSITORY_SCOPE_DENIED");
    return new RepositoryScope(context, tenantId);
  }

  isValid(): boolean {
    return this.context.isActive() && this.context.tenantId === this.tenantId;
  }
}

export type TenantOperation =
  | { readonly kind: "READ"; readonly resource: string; readonly recordId: string }
  | { readonly kind: "LIST"; readonly resource: string }
  | { readonly kind: "DELETE"; readonly resource: string; readonly recordId: string; readonly expectedVersion: number };

export class TenantTransactionPlan {
  private constructor(
    readonly scope: RepositoryScope,
    readonly operations: ReadonlyArray<TenantOperation>,
  ) {
    Object.freeze(this);
  }

  static from(scope: RepositoryScope, operations: ReadonlyArray<TenantOperation>): TenantTransactionPlan {
    if (!scope.isValid() || operations.length === 0 || operations.some((operation) => !isValidOperation(operation))) {
      throw new Error("TRANSACTION_SCOPE_DENIED");
    }
    const immutableOperations = Object.freeze(operations.map((operation) => freezeOperation(operation)));
    return new TenantTransactionPlan(scope, immutableOperations);
  }

  isValid(): boolean {
    return this.scope.isValid() && this.operations.length > 0 && this.operations.every(isValidOperation);
  }
}

function isValidOperation(operation: TenantOperation): boolean {
  if (operation.resource.trim().length === 0) return false;
  if (operation.kind === "LIST") return true;
  if (operation.recordId.trim().length === 0) return false;
  return operation.kind !== "DELETE" || (Number.isInteger(operation.expectedVersion) && operation.expectedVersion > 0);
}

function freezeOperation(operation: TenantOperation): TenantOperation {
  if (operation.kind === "READ") {
    return Object.freeze({ kind: operation.kind, resource: operation.resource, recordId: operation.recordId });
  }
  if (operation.kind === "LIST") {
    return Object.freeze({ kind: operation.kind, resource: operation.resource });
  }
  return Object.freeze({
    kind: operation.kind,
    resource: operation.resource,
    recordId: operation.recordId,
    expectedVersion: operation.expectedVersion,
  });
}

export interface TransactionPort {
  execute(plan: TenantTransactionPlan): Promise<void>;
}

export interface TenantRepository<TRecord, TId extends string> {
  get(scope: RepositoryScope, id: TId): Promise<TRecord | null>;
  list(scope: RepositoryScope): Promise<ReadonlyArray<TRecord>>;
  create(scope: RepositoryScope, record: TRecord): Promise<TRecord>;
  update(scope: RepositoryScope, id: TId, record: TRecord, version: number): Promise<TRecord>;
  remove(scope: RepositoryScope, id: TId, version: number): Promise<void>;
}

export function assertRepositoryScope(scope: RepositoryScope): void {
  if (!scope.isValid()) throw new Error("REPOSITORY_SCOPE_DENIED");
}
