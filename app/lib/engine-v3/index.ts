/** Motore V3 (nucleo indipendente): public surface. Not wired into the existing engine, APIs or screens. */
export * from "./types";
export { parseDecimal, toDecimalString, type Rational } from "./rational";
export { MONEY_ROUNDING, roundToCents, formatCents } from "./rounding";
export { monthShares, monthsIn } from "./period";
export { sellerComponents, regulatedComponents, oneOffComponents, exciseComponents, vatComponent, totalKwh } from "./components";
export { reactiveComponents, reactiveApplicability, selectReactiveRows, type V3ReactiveApplicability, type V3ReactiveSelection } from "./reactive";
export { aggregate, assertCanonical, type V3Totals } from "./aggregate";
export { simulateV3, V3_ENGINE_VERSION, type V3Result } from "./simulate";
export { reconcileV3, type V3PrintedItem, type V3Reconciliation, type V3ReconcileLine, type V3ReconcileStatus } from "./reconcile";
export { TIT_TABLE5_REACTIVE } from "./adapters/tit-reactive-table";
