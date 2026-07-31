import type { ElectricityCteContract } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateElectricityCte } from "./validation.ts";

export type { ElectricityCteContract, ElectricityCteEligibility, ElectricityPricing } from "./types";

export function validateElectricityCteContract(value: unknown): asserts value is ElectricityCteContract {
  validateElectricityCte(value);
}
