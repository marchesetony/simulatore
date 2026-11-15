// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { electricityTaxes, type ElectricityTaxResult } from "./electricity-taxes.ts";

// Tony (15/11/2026, "Completamento quadratura economica autonoma"): the technical simulation stands on its own. Each line says
// where its value comes from (CTE, GME, Terna, ARERA, TIS losses, fiscal rule or explicit hypothesis); rete e oneri of a
// BTA1-5 supply are complete only when every mandatory ARERA component is priced over the whole period; the ASOS class says
// whether it is documented or assumed; excise and VAT are computed from the law. Nothing here reads a bill amount.

export type ProvenanceKind = "CTE" | "GME" | "MERCATO" | "TERNA" | "ARERA" | "TIS" | "IPOTESI" | "MOTORE";
export interface ComponentProvenance { readonly kinds: readonly ProvenanceKind[]; readonly detail: string }

interface Component { readonly label: string; readonly formulaId: string; readonly formulaInputs?: Readonly<Record<string, string | number | boolean>> }

const PASS_THROUGH: Readonly<Record<string, string>> = { DISPATCHING: "dispacciamento", CAPACITY_MARKET: "mercato della capacità", LOSSES: "perdite di rete" };
const text = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

export function provenanceOf(component: Component, asosBasis: AsosBasis | null = null): ComponentProvenance {
  const inputs = component.formulaInputs ?? {};
  const losses = typeof inputs.lossFactor === "number" && inputs.lossFactor > 0 ? { kind: "TIS" as const, detail: `perdite ${text(inputs.lossPercent) || Math.round(inputs.lossFactor * 100)}%: ${text(inputs.lossSource) || "TIS Tabella 4"}` } : null;
  const withLosses = (kinds: readonly ProvenanceKind[], detail: string): ComponentProvenance => losses ? { kinds: [...kinds, "TIS"], detail: `${detail}; ${losses.detail}` } : { kinds, detail };
  const id = component.formulaId;
  if (id === "EE_PUN_MWH_TO_KWH_PLUS_SPREAD") return { kinds: ["GME", "CTE"], detail: `PUN ${text(inputs.band)} ${text(inputs.month)} (${text(inputs.marketRecordId) || "GME"}) + spread della CTE` };
  if (id.startsWith("GAS_PSV")) return { kinds: ["MERCATO", "CTE"], detail: `PSV ${text(inputs.month)} + spread della CTE` };
  if (id === "CTE_PASS_THROUGH_RATE_TIMES_KWH") {
    const source = text(inputs.source);
    const kind = PASS_THROUGH[text(inputs.kind)] ?? text(inputs.kind).toLowerCase();
    if (source.startsWith("TERNA")) return withLosses(["TERNA"], `${kind}: ${source}`);
    if (source.startsWith("ARERA")) return withLosses(["ARERA"], `${kind}: ${source}`);
    return withLosses(["CTE"], `${kind}: valore della CTE`);
  }
  if (id.startsWith("REGULATED_")) {
    const variant = text(inputs.regulatoryVariant);
    const detail = `ARERA ${text(inputs.componentCode)}${variant ? ` ${variant}` : ""} (${text(inputs.regulatoryRecordId) || "tabella del periodo"})`;
    if (text(inputs.componentCode) === "ASOS" && asosBasis === "ASSUMED_CLASS_0") return { kinds: ["ARERA", "IPOTESI"], detail: `${detail}; classe ASOS 0 ipotizzata: la bolletta non indica la classe` };
    return { kinds: ["ARERA"], detail };
  }
  if (/^(EE_|GAS_|FEE_|IMBALANCE_|ONE_OFF_)/.test(id)) return withLosses(["CTE"], `${component.label}: prezzo della CTE`);
  return withLosses(["MOTORE"], id);
}

// The 15 ARERA charges of a BT other-uses supply up to 16,5 kW (TIT/TIME, TIS, 588/2025 and ASOS tables), as the engine
// prices them in regulated-ee.ts: network, metering, transmission, UC3, UC6 (energy, fixed, power), ARIM and ASOS (fixed,
// power, energy).
export const BTA1_5_REQUIRED_COMPONENTS: readonly { readonly formulaId: string; readonly label: string }[] = [
  { formulaId: "REGULATED_BTA1_5_NETWORK_FIXED_RATE_TIMES_TIME", label: "distribuzione quota fissa" },
  { formulaId: "REGULATED_BTA1_5_METERING_FIXED_RATE_TIMES_TIME", label: "misura" },
  { formulaId: "REGULATED_BTA1_5_UC6_FIXED_RATE_TIMES_TIME", label: "UC6 quota fissa" },
  { formulaId: "REGULATED_BTA1_5_ARIM_FIXED_RATE_TIMES_TIME", label: "ARIM quota fissa" },
  { formulaId: "REGULATED_BTA1_5_ASOS_FIXED_RATE_TIMES_TIME", label: "ASOS quota fissa" },
  { formulaId: "REGULATED_BTA1_5_NETWORK_POWER_RATE_TIMES_COMMITTED_KW_TIME", label: "distribuzione quota potenza" },
  { formulaId: "REGULATED_BTA1_5_UC6_POWER_RATE_TIMES_COMMITTED_KW_TIME", label: "UC6 quota potenza" },
  { formulaId: "REGULATED_BTA1_5_ARIM_POWER_RATE_TIMES_COMMITTED_KW_TIME", label: "ARIM quota potenza" },
  { formulaId: "REGULATED_BTA1_5_ASOS_POWER_RATE_TIMES_COMMITTED_KW_TIME", label: "ASOS quota potenza" },
  { formulaId: "REGULATED_BTA1_5_NETWORK_ENERGY_RATE_TIMES_KWH", label: "distribuzione quota energia" },
  { formulaId: "REGULATED_TRANSMISSION_RATE_TIMES_KWH", label: "trasmissione" },
  { formulaId: "REGULATED_UC3_RATE_TIMES_KWH", label: "UC3" },
  { formulaId: "REGULATED_UC6_ENERGY_RATE_TIMES_KWH", label: "UC6 quota energia" },
  { formulaId: "REGULATED_BTA1_5_ARIM_ENERGY_RATE_TIMES_KWH", label: "ARIM quota energia" },
  { formulaId: "REGULATED_BTA1_5_ASOS_ENERGY_RATE_TIMES_KWH", label: "ASOS quota energia" },
];
const BTA1_5_PARTIAL_WARNING = "REGULATED_SUBSET_PARTIAL_BTA1_5_NETWORK_METERING_TRANSMISSION_UC3_UC6_ARIM_ASOS_ONLY";
const COMPLETE_SCOPE = "COMMERCIAL_PLUS_REGULATED_NET_OF_TAX_COMPLETE";

export type AsosBasis = "DOCUMENTED" | "ASSUMED_CLASS_0" | "NOT_APPLICABLE";
export interface TrustedAsos { readonly asosClass: string; readonly temporalStatus: string }
export interface RegulatedCompleteness {
  readonly status: "COMPLETE" | "INCOMPLETE";
  /** ENGINE: the engine itself certifies the scope (domestic resident, BTA6); BTA1_5_COMPONENTS: checked here line by line. */
  readonly basis: "ENGINE" | "BTA1_5_COMPONENTS" | "NONE";
  readonly tariffClass: string | null;
  readonly checked: readonly string[];
  readonly missing: readonly string[];
  readonly asos: { readonly class: string | null; readonly basis: AsosBasis; readonly note: string | null };
}

interface CompletenessInput {
  readonly costScope: string;
  readonly warnings: readonly string[];
  readonly components: readonly Component[];
  readonly supplyPeriod: { readonly periodStart: string; readonly periodEnd: string };
  /** The ASOS class of the trusted supply context the engine priced on (documented only when VALID and not UNKNOWN). */
  readonly asos: TrustedAsos | null;
}

const day = (value: unknown): string => text(value).slice(0, 10);

/** Whether the segments of one component cover the billed period with no gap or overlap. */
function covers(segments: readonly Component[], period: { readonly periodStart: string; readonly periodEnd: string }): boolean {
  const spans = segments.map((item) => ({ start: day(item.formulaInputs?.segmentStart), end: day(item.formulaInputs?.segmentEnd) })).sort((a, b) => a.start.localeCompare(b.start));
  if (!spans.length || spans.some((span) => !span.start || !span.end)) return false;
  let cursor = period.periodStart.slice(0, 10);
  for (const span of spans) { if (span.start !== cursor) return false; cursor = span.end; }
  return cursor === period.periodEnd.slice(0, 10);
}

export function regulatedCompleteness(input: CompletenessInput): RegulatedCompleteness {
  const asosLines = input.components.filter((item) => item.formulaId.startsWith("REGULATED_") && text(item.formulaInputs?.componentCode) === "ASOS");
  const variants = [...new Set(asosLines.map((item) => text(item.formulaInputs?.regulatoryVariant)))];
  const asosClass = variants.length === 1 ? (/^ASOS_CLASS_(\d)/.exec(variants[0])?.[1] ?? null) : null;
  const documented = input.asos !== null && input.asos.temporalStatus === "VALID" && input.asos.asosClass !== "UNKNOWN";
  const asos: RegulatedCompleteness["asos"] = !asosLines.length
    ? { class: null, basis: "NOT_APPLICABLE", note: null }
    : documented
      ? { class: asosClass, basis: "DOCUMENTED", note: `classe ASOS ${asosClass ?? "?"} documentata in bolletta` }
      : { class: asosClass, basis: "ASSUMED_CLASS_0", note: "classe ASOS 0 ipotizzata: la bolletta non indica la classe di agevolazione; le classi 1-3 spettano alle imprese energivore iscritte all'elenco CSEA e vanno documentate" };
  const tariffClass = text(input.components.find((item) => item.formulaId === "REGULATED_BTA1_5_NETWORK_FIXED_RATE_TIMES_TIME")?.formulaInputs?.regulatoryVariant) || null;
  const missingOfficial = input.warnings.filter((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:REGULATED")).map((warning) => `rete e oneri ARERA: valore ufficiale mancante (${warning.split(":").slice(2).join(":") || "periodo"})`);
  const incomplete = (missing: readonly string[], basis: RegulatedCompleteness["basis"] = "NONE", checked: readonly string[] = []): RegulatedCompleteness => ({ status: "INCOMPLETE", basis, tariffClass, checked, missing, asos });
  if (input.costScope === "COMMERCIAL_ONLY") return incomplete(missingOfficial.length ? missingOfficial : ["rete e oneri ARERA non calcolati"]);
  if (documented && asosClass !== null && input.asos!.asosClass !== `ASOS_CLASS_${asosClass}`) return incomplete(["ASOS: la classe applicata non è quella documentata"]);
  if (input.costScope === COMPLETE_SCOPE) return missingOfficial.length ? incomplete(missingOfficial, "ENGINE") : { status: "COMPLETE", basis: "ENGINE", tariffClass, checked: [], missing: [], asos };
  // Partial for a reason other than the BTA1-5 path (BTA6 without ASOS class, non-resident household...): left as the engine says.
  const otherPartial = input.warnings.filter((warning) => warning.startsWith("REGULATED_SUBSET_PARTIAL") || warning.startsWith("BTA6_")).filter((warning) => warning !== BTA1_5_PARTIAL_WARNING);
  if (!input.warnings.includes(BTA1_5_PARTIAL_WARNING) || otherPartial.length) return incomplete(["rete e oneri ARERA: il motore non li calcola per intero per questa tipologia di fornitura", ...missingOfficial]);
  const checked: string[] = []; const missing: string[] = [...missingOfficial];
  for (const required of BTA1_5_REQUIRED_COMPONENTS) {
    const lines = input.components.filter((item) => item.formulaId === required.formulaId);
    if (!lines.length) missing.push(`${required.label}: non calcolata`);
    else if (!covers(lines, input.supplyPeriod)) missing.push(`${required.label}: non copre tutto il periodo`);
    else checked.push(required.label);
  }
  if (input.components.some((item) => item.formulaId.startsWith("REGULATED_") && text(item.formulaInputs?.customerScope) !== "NON_DOMESTIC_BT_BTA1_5")) missing.push("rete e oneri ARERA: righe di un'altra tipologia di fornitura");
  return missing.length ? incomplete(missing, "BTA1_5_COMPONENTS", checked) : { status: "COMPLETE", basis: "BTA1_5_COMPONENTS", tariffClass, checked, missing: [], asos };
}

export interface TechnicalTaxInput {
  readonly vector: "EE" | "GAS";
  readonly taxTreatment: string;
  readonly domestic: boolean;
  readonly resident: boolean | null;
  readonly committedPowerKw: number | null;
  readonly supplyPeriod: { readonly periodStart: string; readonly periodEnd: string };
  readonly bands: { readonly f1: number; readonly f2: number; readonly f3: number } | null;
  readonly monthlyProfile?: readonly { readonly month: string; readonly f1: number; readonly f2: number; readonly f3: number }[] | null;
  readonly warnings: readonly string[];
  readonly regulated: RegulatedCompleteness;
  readonly totalNetOfTaxes: number | null;
}

/** Excise and VAT of the simulation, from the law and the simulated amounts only (never from the bill's taxes). */
export function technicalTaxes(input: TechnicalTaxInput): ElectricityTaxResult {
  const notDeterminable = (reason: string): ElectricityTaxResult => ({ status: "NOT_DETERMINABLE", excise: null, vat: null, totalTaxes: null, reasons: [reason], assumptions: [] });
  if (input.vector !== "EE") return notDeterminable("accise e IVA del gas non calcolate dal simulatore");
  if (input.taxTreatment !== "EXCLUDED") return notDeterminable("la simulazione non è al netto delle imposte");
  if (!input.bands) return notDeterminable("consumo del periodo non disponibile");
  const totalKwh = input.bands.f1 + input.bands.f2 + input.bands.f3;
  const months = [...(input.monthlyProfile ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  // The VAT base is the whole supply cost: every charge priced and rete e oneri complete.
  const whole = input.regulated.status === "COMPLETE" && !input.warnings.some((warning) => warning.startsWith("OFFICIAL_VALUE_MISSING:")) && input.totalNetOfTaxes !== null;
  const result = electricityTaxes({ domestic: input.domestic, resident: input.resident, committedPowerKw: input.committedPowerKw, periodStart: input.supplyPeriod.periodStart, periodEnd: input.supplyPeriod.periodEnd, totalKwh, monthlyKwh: months.length ? months.map((month) => month.f1 + month.f2 + month.f3) : null, taxableSupply: whole ? input.totalNetOfTaxes : null });
  return result;
}
