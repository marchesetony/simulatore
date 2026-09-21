import type { CalculationReadyOffer, CteContract, CteFeeComponent } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateCteContract } from "./validation.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { EnergyContractValidationError } from "../energy/validation.ts";

export function toCalculationReadyOffer(value: unknown): CalculationReadyOffer {
  validateCteContract(value);
  const contract = value as CteContract;
  if (contract.approval.status !== "APPROVED") throw new EnergyContractValidationError("OFFER_NOT_APPROVED");
  const fees = contract.commercialTerms;
  const base = {
    schemaVersion: 1 as const,
    tenantId: contract.tenantId,
    sourceCteId: contract.cteId,
    sourceCteVersion: contract.version,
    approval: contract.approval,
    offerId: contract.offer.offerId,
    supplierId: contract.supplier.supplierId,
    offerCode: contract.offer.code,
    offerName: contract.offer.name,
    currency: contract.currency,
    taxTreatment: contract.taxTreatment,
    validity: contract.validity,
    expiry: contract.expiry,
    eligibility: contract.eligibility,
    fixedFees: fees.fixedFees,
    variableFees: fees.variableFees,
    imbalance: fees.imbalance,
    oneOffFees: fees.oneOffFees,
    commercialDiscounts: fees.commercialDiscounts,
    ...(fees.passThroughComponents === undefined ? {} : { passThroughComponents: fees.passThroughComponents }),
    ...(fees.economicDuration === undefined ? {} : { economicDuration: fees.economicDuration }),
    ...(fees.lossSemantics === undefined ? {} : { lossSemantics: fees.lossSemantics }),
    ...(fees.exitFee === undefined ? {} : { exitFee: fees.exitFee }),
    ...(fees.punRule === undefined ? {} : { punRule: fees.punRule }),
    ...(fees.capacityMarketSchedule === undefined ? {} : { capacityMarketSchedule: fees.capacityMarketSchedule }),
    ...(fees.dispatchingReference === undefined ? {} : { dispatchingReference: fees.dispatchingReference }),
    ...(fees.lossReference === undefined ? {} : { lossReference: fees.lossReference }),
  };
  return contract.vector === "EE"
    ? { ...base, vector: "EE", pricing: contract.pricing }
    : { ...base, vector: "GAS", pricing: contract.pricing };
}

export function assertCalculationReadyFees(value: readonly CteFeeComponent[]): void {
  if (value.some((fee) => !Number.isFinite(fee.amount) || fee.amount < 0 || fee.currency !== "EUR")) throw new EnergyContractValidationError("CALCULATION_FEE_INVALID");
}
