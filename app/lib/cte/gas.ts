import type { GasCteContract } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateGasCte } from "./validation.ts";

export type { GasCteContract, GasCteEligibility, GasPricing } from "./types";

export function validateGasCteContract(value: unknown): asserts value is GasCteContract {
  validateGasCte(value);
}
