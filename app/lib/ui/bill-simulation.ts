import type { PublicBillProfile } from "../foundation/real-bill";
import type { SimulationDraft } from "./models";

export function simulationDraftFromBill(profile: PublicBillProfile): SimulationDraft {
  return {
    vector: profile.vector,
    calculationDate: new Date().toISOString().slice(0, 10),
    periodStart: profile.billingPeriod.periodStart ?? "",
    periodEnd: profile.billingPeriod.periodEnd ?? "",
    customerCategory: profile.customer.customerType ?? "",
    taxTreatment: "",
    customerReference: profile.customer.reference ?? "",
    supplyReference: profile.supply.reference ?? "",
    voltageLevel: profile.supply.voltageLevel ?? "",
    f1: profile.vector === "EE" && profile.consumption.f1 !== null && profile.consumption.f1 !== undefined ? String(profile.consumption.f1) : "",
    f2: profile.vector === "EE" && profile.consumption.f2 !== null && profile.consumption.f2 !== undefined ? String(profile.consumption.f2) : "",
    f3: profile.vector === "EE" && profile.consumption.f3 !== null && profile.consumption.f3 !== undefined ? String(profile.consumption.f3) : "",
    smc: profile.vector === "GAS" && profile.consumption.smc !== null && profile.consumption.smc !== undefined ? String(profile.consumption.smc) : "",
    correctionRequired: profile.vector === "GAS" && profile.consumption.correctionCoefficient !== null && profile.consumption.correctionCoefficient !== undefined,
    correctionCoefficient: profile.vector === "GAS" && profile.consumption.correctionCoefficient !== null && profile.consumption.correctionCoefficient !== undefined ? String(profile.consumption.correctionCoefficient) : "",
    baseline: "",
  };
}
