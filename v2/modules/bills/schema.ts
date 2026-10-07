import { LINE_KINDS, type BillInput, type BillCreateInput, type ConsumptionInput, type LineInput } from "./types";
import { cents, choice, decimal, identifier, invalid, period, strictObject, text, date, scaled } from "./values";

const billKeys = ["documentNumber", "issueDate", "periodStart", "periodEnd", "declaredDocumentTotal",
  "currency", "consumptions", "lines"];

export function supplyInput(value: unknown): { customerId: string; pod: string } {
  const row = strictObject(value, ["customerId", "pod"]);
  const pod = text(row.pod, 64).toUpperCase().replace(/\s+/g, "");
  // Recovered V1 syntax only. No claim of distributor/authority verification.
  if (!/^IT[A-Z0-9]{6,30}$/.test(pod)) return invalid();
  return { customerId: identifier(row.customerId), pod };
}
function consumption(value: unknown): ConsumptionInput {
  const row = strictObject(value, ["periodStart", "periodEnd", "band", "energyKwh"]);
  return { ...period(row), band: choice(row.band, ["TOTAL", "F1", "F2", "F3"]), energyKwh: decimal(row.energyKwh, 3) };
}
function line(value: unknown): LineInput {
  const row = strictObject(value, ["periodStart", "periodEnd", "kind", "level", "description", "quantity",
    "unit", "unitPrice", "amount", "documentTotalParticipation"]);
  return { ...period(row), kind: choice(row.kind, LINE_KINDS), level: choice(row.level, ["AGGREGATE", "DETAIL"]),
    description: text(row.description, 240), quantity: decimal(row.quantity, 6, true),
    unit: row.unit === null ? null : text(row.unit, 40), unitPrice: decimal(row.unitPrice, 6, true), amount: cents(row.amount),
    documentTotalParticipation: choice(row.documentTotalParticipation, ["INCLUDED", "EXCLUDED", "UNKNOWN"]) };
}
function items<T>(value: unknown, parse: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > 100) return invalid();
  return value.map(parse);
}
export function assertConsumptionInvariant(values: readonly ConsumptionInput[]): void {
  const groups = new Map<string, Map<string, string | null>>();
  for (const item of values) {
    const key = `${item.periodStart}/${item.periodEnd}`;
    const group = groups.get(key) ?? new Map<string, string | null>();
    if (group.has(item.band)) return invalid();
    group.set(item.band, item.energyKwh); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const values = ["TOTAL", "F1", "F2", "F3"].map(band => group.get(band));
    if (values.every((v): v is string => typeof v === "string")) {
      const [total, f1, f2, f3] = values.map(v => scaled(v, 3));
      if (total !== f1 + f2 + f3) return invalid();
    }
  }
}
export function billInput(value: unknown): BillInput {
  const row = strictObject(value, billKeys);
  const input: BillInput = { ...period(row), documentNumber: text(row.documentNumber, 100), issueDate: date(row.issueDate),
    declaredDocumentTotal: cents(row.declaredDocumentTotal), currency: choice(row.currency, ["EUR"]),
    consumptions: items(row.consumptions, consumption), lines: items(row.lines, line) };
  // Consumption belongs to this bill period; recalculation lines may refer to earlier periods.
  if (input.consumptions.some(c => c.periodStart < input.periodStart || c.periodEnd > input.periodEnd)) return invalid();
  assertConsumptionInvariant(input.consumptions);
  return input;
}
export function billCreateInput(value: unknown): BillCreateInput {
  const row = strictObject(value, [...billKeys, "customerId", "supplyId"]);
  const { customerId, supplyId, ...data } = row;
  return { ...billInput(data), customerId: identifier(customerId), supplyId: identifier(supplyId) };
}
