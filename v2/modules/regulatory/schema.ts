import { economicState } from "../market/economic-state";
import { fail } from "../market/errors";
import { parseSource } from "../market/governance";
import { immutable } from "../market/integrity";
import { choice, distinct, list, object, text } from "../market/primitives";
import { selectionPolicy } from "../market/schema";
import { period, timestamp } from "../market/temporal";
import type { ApplicationBasis, RegulatoryComponent, RegulatoryRequest, RegulatorySource, RegulatoryUnit } from "./types";

export { parseVersion as parseRegulatoryVersion } from "../market/governance";
const units: Readonly<Record<ApplicationBasis, RegulatoryUnit>> = {
  ENERGY_KWH: "EUR_PER_KWH", ENERGY_MWH: "EUR_PER_MWH", POWER_KW: "EUR_PER_KW", POWER_KW_YEAR: "EUR_PER_KW_YEAR",
  MONTH: "EUR_PER_MONTH", YEAR: "EUR_PER_YEAR", PERIOD: "EUR_PER_PERIOD", PERCENTAGE: "PERCENT",
};
export function parseRegulatorySource(input: unknown): RegulatorySource {
  const r = object(input, ["sourceId", "institution", "dataset", "authorizedIdentity", "parserVersion", "status", "authorityReference"]);
  const { authorityReference, ...base } = r;
  return immutable({ ...parseSource(base), authorityReference: text(authorityReference) });
}
export function parseRegulatoryComponent(input: unknown): RegulatoryComponent {
  const r = object(input, ["componentId", "code", "economicDomain", "customerScope", "applicationBasis", "unit", "sourceVersionId",
    "sourceLocator", "validFrom", "validTo", "applicability", "includes", "excludes", "valueState", "value", "evidence"]);
  const applicationBasis = choice(r.applicationBasis, ["ENERGY_KWH", "ENERGY_MWH", "POWER_KW", "POWER_KW_YEAR", "MONTH", "YEAR", "PERIOD", "PERCENTAGE"]);
  if (r.unit !== units[applicationBasis]) return fail("INVALID_INPUT");
  const a = object(r.applicability, ["status", "evidence"]);
  const state = economicState({ valueState: r.valueState, value: r.value, evidence: r.evidence });
  const applicability = { status: choice(a.status, ["APPLIES", "DOES_NOT_APPLY"]), evidence: text(a.evidence) };
  if ((state.valueState === "NOT_APPLICABLE") !== (applicability.status === "DOES_NOT_APPLY")) return fail("INVALID_INPUT");
  const includes = list(r.includes, text), excludes = list(r.excludes, text), componentId = text(r.componentId);
  distinct([...includes, ...excludes]);
  if ([...includes, ...excludes].includes(componentId)) return fail("INVALID_INPUT");
  return immutable({ componentId, code: text(r.code), economicDomain: choice(r.economicDomain, ["NETWORK", "SYSTEM_CHARGE", "DISPATCH", "TAX", "COMMERCIAL", "MARKET"]),
    customerScope: text(r.customerScope), applicationBasis, unit: units[applicationBasis], sourceVersionId: text(r.sourceVersionId),
    sourceLocator: text(r.sourceLocator), ...period({ validFrom: r.validFrom, validTo: r.validTo }), applicability, includes, excludes, ...state });
}
/** No deduplication by abbreviation: basis, unit, scope and domain are part of identity. */
export function componentIdentity(c: RegulatoryComponent): string {
  return JSON.stringify([c.code, c.economicDomain, c.customerScope, c.applicationBasis, c.unit]);
}
export function parseRegulatoryRequest(input: unknown): RegulatoryRequest {
  const r = object(input, ["snapshotId", "coverage", "selectionPolicy", "asOf", "createdAt", "componentIds", "requiredIdentities"]);
  const result = { snapshotId: text(r.snapshotId), coverage: period(r.coverage), selectionPolicy: selectionPolicy(r.selectionPolicy),
    asOf: timestamp(r.asOf), createdAt: timestamp(r.createdAt), componentIds: list(r.componentIds, text), requiredIdentities: list(r.requiredIdentities, text) };
  distinct(result.componentIds); distinct(result.requiredIdentities);
  if (!result.requiredIdentities.length || result.asOf > result.createdAt) return fail("INVALID_INPUT");
  return immutable(result);
}
