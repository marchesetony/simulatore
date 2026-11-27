import { aggregate, type V3Totals } from "./aggregate";
import { exciseComponents, oneOffComponents, regulatedComponents, sellerComponents, vatComponent } from "./components";
import { reactiveComponents } from "./reactive";
import { MONEY_ROUNDING } from "./rounding";
import type { V3Component, V3Input } from "./types";

/**
 * Motore V3: one simulation. Input (measured quantities and official/contractual parameters) → components → VAT on the
 * rounded taxable amounts → totals. The input type has no field for a printed bill amount, so nothing printed can reach a
 * calculation; reconciliation with a bill is a separate step (reconcile.ts).
 */
export const V3_ENGINE_VERSION = "V3-core-0.2";

export interface V3Result {
  readonly engineVersion: string;
  readonly rounding: typeof MONEY_ROUNDING;
  readonly period: V3Input["period"];
  readonly contract: { readonly cteCode: string; readonly cteVersion: string };
  readonly components: readonly V3Component[];
  readonly totals: V3Totals;
}

export function simulateV3(input: V3Input): V3Result {
  if (input.supply.vector !== "EE") throw new Error("V3_VECTOR_NOT_SUPPORTED");
  if (input.supply.voltage !== "BT") throw new Error(`V3_VOLTAGE_NOT_SUPPORTED:${input.supply.voltage}`);
  const beforeVat: V3Component[] = [
    ...sellerComponents(input),
    ...regulatedComponents(input),
    ...reactiveComponents(input),
    ...oneOffComponents(input),
    ...exciseComponents(input),
  ];
  const components = [...beforeVat, vatComponent(input, beforeVat)];
  return {
    engineVersion: V3_ENGINE_VERSION, rounding: MONEY_ROUNDING, period: input.period,
    contract: { cteCode: input.contract.cteCode, cteVersion: input.contract.cteVersion },
    components, totals: aggregate(components),
  };
}
