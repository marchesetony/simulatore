import { CustomerError, type CustomerInput } from "./types";

export function customerId(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new CustomerError("INVALID_INPUT");
  }
  return value;
}

export function customerInput(value: unknown): CustomerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CustomerError("INVALID_INPUT");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["name", "taxCode", "vatNumber"].includes(key)) ||
      typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 160) {
    throw new CustomerError("INVALID_INPUT");
  }
  return { name: row.name.trim(), taxCode: identifier(row.taxCode), vatNumber: identifier(row.vatNumber) };
}

// V1 format only: not a fiscal/authoritative validation; no checksum inference.
function identifier(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Z0-9 .-]{5,32}$/i.test(value.trim())) throw new CustomerError("INVALID_INPUT");
  return value.trim();
}
