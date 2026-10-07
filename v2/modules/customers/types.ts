export interface CustomerInput {
  readonly name: string;
  readonly taxCode: string | null;
  readonly vatNumber: string | null;
}
export interface Customer extends CustomerInput { readonly id: string; readonly tenantId: string }
export type CustomerView = CustomerInput & { readonly id: string };
export class CustomerError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "DENIED" | "NOT_FOUND" | "UNAVAILABLE") { super(code); }
}
