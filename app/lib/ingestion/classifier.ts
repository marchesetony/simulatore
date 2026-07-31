import type { BillClassification } from "./types.ts";

const EE_MARKERS: readonly [string, RegExp][] = [
  ["EE", /\bEE\b|energia\s+elettrica|electricity/i],
  ["POD", /\bPOD\b/i],
  ["F1", /\bF1\b/i],
  ["F2", /\bF2\b/i],
  ["F3", /\bF3\b/i],
  ["KWH", /\bkWh\b/i],
];

const GAS_MARKERS: readonly [string, RegExp][] = [
  ["GAS", /\bGAS\b|gas\s+naturale|natural\s+gas/i],
  ["PDR", /\bPDR\b/i],
  ["SMC", /\bSmc\b/i],
  ["CORRECTION_COEFFICIENT", /coefficiente\s+di\s+conversione|correction\s+coefficient/i],
];

export function classifyBillText(text: string): BillClassification {
  const ee = EE_MARKERS.filter(([, marker]) => marker.test(text)).map(([name]) => name);
  const gas = GAS_MARKERS.filter(([, marker]) => marker.test(text)).map(([name]) => name);
  if (ee.length > 0 && gas.length === 0) return { vector: "EE", evidence: ee };
  if (gas.length > 0 && ee.length === 0) return { vector: "GAS", evidence: gas };
  return { vector: "UNKNOWN", evidence: [...ee, ...gas] };
}
