import type { BillClassification } from "./types.ts";

type Marker = readonly [string, RegExp];

const POD_PATTERN = /\bP\s*O\s*D\s*[:=#-]?\s*I\s*T\s*\d{3}\s*E\s*\d{8}(?=$|[^0-9A-Z])/i;
const PDR_PATTERN = /\bP\s*D\s*R\s*[:=#-]?\s*(?:\d\s*){14}(?=$|[^0-9])/i;

const EE_MARKERS: readonly Marker[] = [
  ["EE", /\bEE\b/i],
  ["ELECTRICITY", /\belectricity\b/i],
  ["ELECTRICITY_SUPPLY", /\bfornitura\s+(?:di\s+)?energia\s+elettrica\b/i],
  ["ENERGIA_ELETTRICA", /\benergia\s+elettrica\b/i],
  ["F1", /\bF\s*1\b/i],
  ["F2", /\bF\s*2\b/i],
  ["F3", /\bF\s*3\b/i],
  ["KWH", /\bk\s*Wh\b/i],
  ["POWER_COMMITTED", /\bpotenza\s+impegnata\b/i],
  ["KW", /\bk\s*W\b/i],
  ["ACTIVE_ENERGY", /\benergia\s+attiva\b/i],
];

const GAS_MARKERS: readonly Marker[] = [
  ["GAS_SUPPLY", /\bfornitura\s+(?:di\s+)?gas\s+naturale\b/i],
  ["SMC", /\bS\s*Mc\b/i],
  ["STANDARD_CUBIC_METERS", /\bstandard\s+(?:metri\s+cubi|cubic\s+meters?)\b/i],
  ["CORRECTION_COEFFICIENT", /\bcoefficiente\s+di\s+conversione\b|\bcorrection\s+coefficient\b/i],
];

const EE_TECHNICAL = new Set(["F1", "F2", "F3", "KWH", "POWER_COMMITTED", "KW", "ACTIVE_ENERGY"]);
const GAS_TECHNICAL = new Set(["SMC", "STANDARD_CUBIC_METERS", "CORRECTION_COEFFICIENT"]);

function normalizeBillText(text: string): string {
  return text.normalize("NFKC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function matches(markers: readonly Marker[], text: string): string[] {
  return markers.filter(([, marker]) => marker.test(text)).map(([name]) => name);
}

export function classifyBillText(text: string): BillClassification {
  const normalized = normalizeBillText(text);
  const hasPod = POD_PATTERN.test(normalized);
  const hasPdr = PDR_PATTERN.test(normalized);
  const ee = matches(EE_MARKERS, normalized);
  const gas = matches(GAS_MARKERS, normalized);

  if (hasPod && hasPdr) return { vector: "UNKNOWN", evidence: ["POD", "PDR", ...ee, ...gas] };
  if (hasPod) return { vector: "EE", evidence: ["POD", ...ee] };
  if (hasPdr) return { vector: "GAS", evidence: ["PDR", ...gas] };

  const eeTechnical = ee.filter((marker) => EE_TECHNICAL.has(marker));
  const gasTechnical = gas.filter((marker) => GAS_TECHNICAL.has(marker));
  if (eeTechnical.length > 0 && gasTechnical.length > 0) return { vector: "UNKNOWN", evidence: [...ee, ...gas] };
  if (eeTechnical.length > 0) return { vector: "EE", evidence: ee };
  if (gasTechnical.length > 0) return { vector: "GAS", evidence: gas };

  const hasElectricitySupply = ee.includes("ELECTRICITY_SUPPLY");
  const hasGasSupply = gas.includes("GAS_SUPPLY");
  if (hasElectricitySupply && !hasGasSupply) return { vector: "EE", evidence: ee };
  if (hasGasSupply && !hasElectricitySupply) return { vector: "GAS", evidence: gas };

  const hasElectricityPhrase = ee.some((marker) => ["EE", "ELECTRICITY", "ENERGIA_ELETTRICA"].includes(marker));
  const hasGenericGas = /\bgas\b|\bgas\s+naturale\b/i.test(normalized);
  if (hasElectricityPhrase && !hasGenericGas) return { vector: "EE", evidence: ee };

  return { vector: "UNKNOWN", evidence: [...ee, ...gas] };
}
