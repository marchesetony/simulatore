import { randomUUID } from "node:crypto";
import type { Bill, BillInput } from "./types";
import { reconcile } from "./reconciliation";

export function snapshot(input: BillInput, ownership: Pick<Bill, "id" | "tenantId" | "customerId" | "supplyId">): Bill {
  const reconciliation = reconcile(input);
  return { ...input, ...ownership,
    completenessStatus: "INCOMPLETE",
    validationStatus: "UNVALIDATED",
    reconciliation,
    consumptions: input.consumptions.map(c => ({ ...c, id: randomUUID(), billId: ownership.id, tenantId: ownership.tenantId })),
    lines: input.lines.map(line => ({ ...line, id: randomUUID(), billId: ownership.id, tenantId: ownership.tenantId })),
  };
}
