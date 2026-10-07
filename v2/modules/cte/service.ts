import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthDependencies } from "../auth/service";
import { BillError } from "../bills/types";
import { cteTenant } from "./access";
import { cteInput } from "./schema";
import { deriveReadiness } from "./readiness";
import type { CteComponent, CteOfferVersion, CteSimulationTerms } from "./types";
import { CteError } from "./types";
import type { CteRepository } from "./repository";
import type { Rate as SimulationRate } from "../simulations/types";

function id(value: string): string { if (!/^[a-f0-9-]{36}$/i.test(value)) throw new CteError("INVALID_INPUT"); return value; }
function overlap(a: CteOfferVersion, b: CteOfferVersion): boolean { return a.validFrom <= b.validTo && b.validFrom <= a.validTo; }
function duplicateAppliedComponents(rows: readonly CteComponent[]): boolean {
  const keys = rows.filter(row => row.applicability === "APPLIES").map(row => `${row.kind}:${row.unit ?? "?"}`); return new Set(keys).size !== keys.length;
}
function toError(error: unknown): never { if (error instanceof CteError) throw error; if (error instanceof BillError || error instanceof Error && error.message === "INVALID_INPUT") throw new CteError("INVALID_INPUT"); throw new CteError("UNAVAILABLE"); }
export class CteService {
  constructor(private readonly auth: AuthDependencies, private readonly repository: CteRepository) {}
  private async store<T>(run: () => Promise<T>): Promise<T> { try { return await run(); } catch (error) { return toError(error); } }
  async list(token: string, target?: string): Promise<readonly CteOfferVersion[]> { const tenant = await cteTenant(this.auth, token, "cte:list", target); return this.store(() => this.repository.list(tenant)); }
  async get(token: string, rawId: string, target?: string): Promise<CteOfferVersion> {
    const tenant = await cteTenant(this.auth, token, "cte:read", target), found = await this.store(() => this.repository.get(tenant, id(rawId))); if (!found) throw new CteError("NOT_FOUND"); return found;
  }
  async createVersion(token: string, payload: unknown, target?: string): Promise<CteOfferVersion> {
    const tenant = await cteTenant(this.auth, token, "cte:create", target); let input;
    try { input = cteInput(payload); } catch { throw new CteError("INVALID_INPUT"); }
    const existing = await this.store(() => this.repository.list(tenant));
    if (duplicateAppliedComponents(input.components)) throw new CteError("INVALID_INPUT");
    const prior = existing.filter(row => row.supplier === input.supplier && row.offerCode === input.offerCode && row.commodity === input.commodity);
    if (prior.some(row => overlap(row, { ...input, id: "", tenantId: tenant, version: "", createdAt: "", calculationReadiness: { status: "BLOCKED", reasons: [] } }))) throw new CteError("OVERLAPPING_VALIDITY");
    const numbers = prior.map(row => Number(row.version)).filter(Number.isFinite);
    const version = String((numbers.length ? Math.max(...numbers) : 0) + 1);
    const value: CteOfferVersion = { ...input, id: randomUUID(), tenantId: tenant, version, createdAt: new Date().toISOString(), calculationReadiness: { status: "BLOCKED", reasons: [] } };
    const ready = deriveReadiness(value);
    const finalized: CteOfferVersion = { ...value, calculationReadiness: ready };
    return this.store(() => this.repository.createVersion(finalized));
  }
  async toSimulationTerms(token: string, rawId: string, target?: string): Promise<CteSimulationTerms> {
    const value = await this.get(token, rawId, target); return toSimulationTerms(value);
  }
}
export function toSimulationTerms(value: CteOfferVersion): CteSimulationTerms {
  if (value.calculationReadiness.status !== "READY") throw new CteError("INVALID_INPUT");
  const pricing = value.pricing;
  const toRate = (rate: { readonly applicability: string; readonly amount: string | null; readonly unit: string | null }): SimulationRate => ({ applicability: rate.applicability === "APPLIES" ? "APPLIES" : rate.applicability === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "UNKNOWN", amount: rate.amount, unit: rate.unit === "EUR_PER_KWH" || rate.unit === "EUR_PER_MONTH" || rate.unit === "EUR_PER_YEAR" ? rate.unit : null });
  const fees = value.components.map(component => ({ kind: component.kind, ...toRate(component) }));
  return { source: { type: "CTE", cteId: value.id, cteVersion: value.version }, periodStart: value.validFrom, periodEnd: value.validTo, reference: value.offerCode,
    mode: pricing.mode, taxTreatment: "EXCLUDED", fixedPrice: pricing.mode === "FIXED" ? toRate(pricing.fixedPrice) : { applicability: "NOT_APPLICABLE" as const, amount: null, unit: null },
    spread: toRate(pricing.spread), fees };
}
