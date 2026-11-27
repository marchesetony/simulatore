import { add, cmp, div, integer, max, min, mul, parseDecimal, R0, R1, sub, sum, toDecimalString, type Rational } from "./rational";
import { roundToCents, centsToRational, sumCents } from "./rounding";
import { monthShares, monthsIn, TWELVE } from "./period";
import { CATEGORY_GROUP, CATEGORY_LEAF, type V3Band, type V3Category, type V3Component, type V3Input, type V3Parameter, type V3PriceUnit, type V3QuantityUnit, type V3Source } from "./types";

/**
 * Motore V3: one calculator per kind of component. Each one states its quantity, unit price, formula, period and sources,
 * computes the exact amount and rounds it once (rounding.ts). A missing official parameter gives a component that says
 * "non determinabile" and why: never a value taken from the bill, never a guess.
 */
const BANDS: readonly V3Band[] = ["F1", "F2", "F3"];
const THOUSAND = integer(1000);

interface Draft {
  readonly id: string; readonly category: V3Category; readonly label: string;
  readonly quantity: Rational; readonly quantityUnit: V3QuantityUnit;
  readonly unitPrice: Rational; readonly priceUnit: V3PriceUnit;
  readonly formulaId: string; readonly expression: string;
  readonly sources: readonly V3Source[]; readonly vatTaxable?: boolean; readonly recurrence?: "RECURRING" | "ONE_OFF"; readonly assumptions?: readonly string[];
}

export function built(input: V3Input, draft: Draft): V3Component {
  const exact = mul(draft.quantity, draft.unitPrice);
  return {
    id: draft.id, category: draft.category, group: CATEGORY_GROUP[draft.category], leaf: CATEGORY_LEAF[draft.category], label: draft.label,
    quantity: { value: toDecimalString(draft.quantity), unit: draft.quantityUnit },
    unitPrice: { value: toDecimalString(draft.unitPrice), unit: draft.priceUnit },
    formula: { id: draft.formulaId, expression: draft.expression },
    period: input.period, sources: draft.sources, vatTaxable: draft.vatTaxable ?? true, recurrence: draft.recurrence ?? "RECURRING",
    exactAmount: toDecimalString(exact), amountCents: roundToCents(exact), completeness: "COMPLETE", provenance: "CALCULATED", assumptions: draft.assumptions ?? [],
  };
}

export function missing(input: V3Input, id: string, category: V3Category, label: string, reason: string, formulaId: string, extra: Partial<Pick<V3Component, "vatTaxable" | "recurrence" | "completeness" | "amountCents" | "exactAmount" | "sources">> = {}): V3Component {
  return {
    id, category, group: CATEGORY_GROUP[category], leaf: CATEGORY_LEAF[category], label, quantity: null, unitPrice: null,
    formula: { id: formulaId, expression: "non applicata" }, period: input.period, sources: extra.sources ?? [], vatTaxable: extra.vatTaxable ?? true, recurrence: extra.recurrence ?? "RECURRING",
    exactAmount: extra.exactAmount ?? null, amountCents: extra.amountCents ?? null, completeness: extra.completeness ?? "NOT_DETERMINABLE", reason, provenance: "CALCULATED", assumptions: [],
  };
}

export const value = (parameter: V3Parameter): Rational => parseDecimal(parameter.value);

function perKwh(parameter: V3Parameter): Rational {
  if (parameter.unit === "EUR/kWh") return value(parameter);
  if (parameter.unit === "EUR/MWh") return div(value(parameter), THOUSAND);
  throw new Error(`V3_UNIT_MISMATCH:${parameter.unit}:EUR/kWh`);
}
function perMonth(parameter: V3Parameter, expected: "EUR/POD/year" | "EUR/kW/year" | "EUR/year" | "EUR/month"): Rational {
  if (parameter.unit !== expected) throw new Error(`V3_UNIT_MISMATCH:${parameter.unit}:${expected}`);
  return expected === "EUR/month" ? value(parameter) : div(value(parameter), TWELVE);
}

export function totalKwh(input: V3Input): Rational { return sum(BANDS.map((band) => parseDecimal(input.consumption.bands[band]))); }

const lossLabel = (losses: "NET_OF_LOSSES" | "GROSS_OF_LOSSES") => losses === "NET_OF_LOSSES" ? "× (1 + λ perdite)" : "al lordo delle perdite, senza λ";

// ---------------------------------------------------------------------------------------------------------------------------
// Vendita
export function sellerComponents(input: V3Input): V3Component[] {
  const out: V3Component[] = [];
  const lambda = value(input.regulated.lossFactor);
  const spread = perKwh(input.contract.energy.spread);
  const kwh = totalKwh(input);
  for (const band of BANDS) {
    const quantity = parseDecimal(input.consumption.bands[band]);
    const pun = input.market.pun[band];
    const price = add(perKwh(pun), spread);
    out.push(built(input, { id: `ENERGY:${band}`, category: "ENERGY", label: `Energia ${band}`, quantity, quantityUnit: "kWh", unitPrice: price, priceUnit: "EUR/kWh", formulaId: "V3_ENERGY_INDEX_PLUS_SPREAD", expression: `kWh ${band} × (PUN ${band} / 1000 + spread)`, sources: [input.consumption.source, pun.source, input.contract.energy.spread.source] }));
    if (input.contract.energy.lossesOn !== "NONE") {
      const lossPrice = input.contract.energy.lossesOn === "INDEX_AND_SPREAD" ? price : perKwh(pun);
      out.push(built(input, { id: `LOSSES:${band}`, category: "LOSSES", label: `Perdite di rete ${band}`, quantity: mul(quantity, lambda), quantityUnit: "kWh", unitPrice: lossPrice, priceUnit: "EUR/kWh", formulaId: input.contract.energy.lossesOn === "INDEX_AND_SPREAD" ? "V3_LOSSES_ON_INDEX_AND_SPREAD" : "V3_LOSSES_ON_INDEX", expression: `kWh ${band} × λ × ${input.contract.energy.lossesOn === "INDEX_AND_SPREAD" ? "(PUN / 1000 + spread)" : "PUN / 1000"}`, sources: [input.consumption.source, input.regulated.lossFactor.source, pun.source, input.contract.energy.lossesSource] }));
    }
  }
  const perKwhTerm = (id: string, category: V3Category, label: string, term: { readonly rate: V3Parameter; readonly losses: "NET_OF_LOSSES" | "GROSS_OF_LOSSES" } | null, extra: readonly V3Source[] = []) => {
    if (!term) return;
    const factor = term.losses === "NET_OF_LOSSES" ? add(R1, lambda) : R1;
    out.push(built(input, { id, category, label, quantity: kwh, quantityUnit: "kWh", unitPrice: mul(perKwh(term.rate), factor), priceUnit: "EUR/kWh", formulaId: `V3_PER_KWH_${term.losses}`, expression: `kWh × prezzo ${lossLabel(term.losses)}`, sources: [input.consumption.source, term.rate.source, ...(term.losses === "NET_OF_LOSSES" ? [input.regulated.lossFactor.source] : []), ...extra] }));
  };
  perKwhTerm("COMMERCIALIZATION", "COMMERCIALIZATION", "Commercializzazione", input.contract.commercialization);
  perKwhTerm("IMBALANCE", "IMBALANCE", "Sbilanciamento", input.contract.imbalance);
  const official = (id: string, category: V3Category, label: string, contract: { readonly losses: "NET_OF_LOSSES" | "GROSS_OF_LOSSES"; readonly source: V3Source } | null, parameter: V3Parameter | null) => {
    if (!contract) return;
    if (!parameter) { out.push(missing(input, id, category, label, `valore ufficiale del periodo non disponibile (${contract.source.reference})`, `V3_PER_KWH_${contract.losses}`)); return; }
    perKwhTerm(id, category, label, { rate: parameter, losses: contract.losses }, [contract.source]);
  };
  official("DISPATCHING", "DISPATCHING", "Dispacciamento", input.contract.dispatching, input.regulated.dispatching);
  official("CAPACITY_REGULATED", "CAPACITY_REGULATED", "Mercato della capacità", input.contract.capacityRegulated, input.regulated.capacity);
  perKwhTerm("CAPACITY_CONTRACTUAL", "CAPACITY_CONTRACTUAL", "Capacity market libero (CTE)", input.contract.capacityContractual);
  const months = monthsIn(input.period.start, input.period.endExclusive);
  for (const fee of input.contract.fixedFees) {
    if (fee.rate.unit !== "EUR/month" && fee.rate.unit !== "EUR/year") throw new Error(`V3_UNIT_MISMATCH:${fee.rate.unit}:EUR/month`);
    out.push(built(input, { id: `SELLER_FIXED_FEE:${fee.id}`, category: "SELLER_FIXED_FEE", label: fee.label, quantity: months, quantityUnit: "month", unitPrice: perMonth(fee.rate, fee.rate.unit), priceUnit: "EUR/month", formulaId: fee.rate.unit === "EUR/year" ? "V3_ANNUAL_FEE_PER_MONTH" : "V3_MONTHLY_FEE", expression: fee.rate.unit === "EUR/year" ? "mesi × (€/anno / 12)" : "mesi × €/mese", sources: [fee.rate.source] }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Rete e oneri (ARERA): €/POD/anno and €/kW/anno as 1/12 per month, €/kWh on the measured kWh.
export function regulatedComponents(input: V3Input): V3Component[] {
  const out: V3Component[] = [];
  const kwh = totalKwh(input);
  const months = monthsIn(input.period.start, input.period.endExclusive);
  const kw = parseDecimal(input.supply.powerKw.value);
  const add1 = (id: string, category: V3Category, label: string, parameter: V3Parameter | null, kind: "POD" | "KW" | "KWH") => {
    if (!parameter) { out.push(missing(input, id, category, label, `tariffa ARERA ${input.supply.tariffClass} del periodo non disponibile`, `V3_REGULATED_${kind}`)); return; }
    if (kind === "POD") out.push(built(input, { id, category, label, quantity: months, quantityUnit: "POD×month", unitPrice: perMonth(parameter, "EUR/POD/year"), priceUnit: "EUR/POD/month", formulaId: "V3_REGULATED_PER_POD", expression: "mesi × (€/POD/anno / 12)", sources: [parameter.source] }));
    else if (kind === "KW") out.push(built(input, { id, category, label, quantity: mul(kw, months), quantityUnit: "kW×month", unitPrice: perMonth(parameter, "EUR/kW/year"), priceUnit: "EUR/kW/month", formulaId: "V3_REGULATED_PER_KW", expression: "kW × mesi × (€/kW/anno / 12)", sources: [input.supply.powerKw.source, parameter.source] }));
    else out.push(built(input, { id, category, label, quantity: kwh, quantityUnit: "kWh", unitPrice: perKwh(parameter), priceUnit: "EUR/kWh", formulaId: "V3_REGULATED_PER_KWH", expression: "kWh × €/kWh", sources: [input.consumption.source, parameter.source] }));
  };
  const n = input.regulated.network; const s = input.regulated.system;
  add1("NETWORK_FIXED", "NETWORK_FIXED", "Trasporto: quota fissa", n.fixed, "POD");
  add1("NETWORK_POWER", "NETWORK_POWER", "Trasporto: quota potenza", n.power, "KW");
  add1("NETWORK_ENERGY", "NETWORK_ENERGY", "Trasporto: quota energia", n.energy, "KWH");
  add1("TRANSMISSION_ENERGY", "TRANSMISSION_ENERGY", "Trasmissione", n.transmission, "KWH");
  add1("METERING_FIXED", "METERING_FIXED", "Misura", n.metering, "POD");
  add1("UC3_ENERGY", "UC3_ENERGY", "UC3", n.uc3Energy, "KWH");
  add1("UC6_ENERGY", "UC6_ENERGY", "UC6 quota energia", n.uc6Energy, "KWH");
  add1("UC6_FIXED", "UC6_FIXED", "UC6 quota fissa", n.uc6Fixed, "POD");
  add1("ARIM_FIXED", "ARIM_FIXED", "ARIM quota fissa", s.arimFixed, "POD");
  add1("ARIM_POWER", "ARIM_POWER", "ARIM quota potenza", s.arimPower, "KW");
  add1("ARIM_ENERGY", "ARIM_ENERGY", "ARIM quota energia", s.arimEnergy, "KWH");
  add1("ASOS_FIXED", "ASOS_FIXED", "ASOS quota fissa", s.asosFixed, "POD");
  add1("ASOS_POWER", "ASOS_POWER", "ASOS quota potenza", s.asosPower, "KW");
  add1("ASOS_ENERGY", "ASOS_ENERGY", "ASOS quota energia", s.asosEnergy, "KWH");
  return out;
}

// Energia reattiva: see reactive.ts.

// ---------------------------------------------------------------------------------------------------------------------------
// Corrispettivi una tantum: due only on the first bill of the new supply; never spread or repeated.
export function oneOffComponents(input: V3Input): V3Component[] {
  return input.contract.oneOffFees.map((fee) => {
    const id = `ONE_OFF_FEE:${fee.id}`;
    if (fee.rate.unit !== "EUR/contract") throw new Error(`V3_UNIT_MISMATCH:${fee.rate.unit}:EUR/contract`);
    if (input.billing.firstBillOfSupply === false) return missing(input, id, "ONE_OFF_FEE", fee.label, "non dovuto: la bolletta non è la prima della fornitura", "V3_ONE_OFF_FIRST_BILL", { completeness: "NOT_DUE", amountCents: 0, exactAmount: "0", recurrence: "ONE_OFF", sources: [fee.rate.source, input.billing.source] });
    if (input.billing.firstBillOfSupply === null) return missing(input, id, "ONE_OFF_FEE", fee.label, "non determinabile: non è noto se la bolletta sia la prima della fornitura", "V3_ONE_OFF_FIRST_BILL", { recurrence: "ONE_OFF", sources: [fee.rate.source] });
    return built(input, { id, category: "ONE_OFF_FEE", label: fee.label, quantity: R1, quantityUnit: "contract", unitPrice: value(fee.rate), priceUnit: "EUR/contract", formulaId: "V3_ONE_OFF_FIRST_BILL", expression: "1 × importo una tantum (solo prima bolletta)", sources: [fee.rate.source, input.billing.source], recurrence: "ONE_OFF" });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Imposte: excise on the measured kWh by monthly tier of the law; VAT on the rounded taxable amounts plus excise.
export function exciseComponents(input: V3Input): V3Component[] {
  const kwh = totalKwh(input);
  const rule = input.taxes.exciseNonDomestic;
  if (input.supply.customer !== "NON_DOMESTIC" || !rule) return [missing(input, "EXCISE", "EXCISE", "Accise", input.supply.customer === "DOMESTIC" ? "accise domestiche non ancora implementate nel motore V3" : "aliquote di accisa non fornite", "V3_EXCISE_TIERS", { vatTaxable: true })];
  const shares = monthShares(input.period.start, input.period.endExclusive);
  const tier1Limit = parseDecimal(rule.tier1MonthlyKwh); const tier2Limit = parseDecimal(rule.tier2MonthlyKwh);
  // Tiers are monthly: one calendar month, or a longer period whose whole consumption stays inside the first tier.
  if (shares.length > 1 && cmp(kwh, tier1Limit) > 0) return [missing(input, "EXCISE", "EXCISE", "Accise", "periodo su più mesi oltre il primo scaglione: servono i kWh mese per mese", "V3_EXCISE_TIERS")];
  if (cmp(kwh, tier2Limit) > 0) return [missing(input, "EXCISE", "EXCISE", "Accise", "consumo mensile oltre il secondo scaglione: importo fisso di legge non implementato", "V3_EXCISE_TIERS")];
  const first = min(kwh, tier1Limit); const second = max(R0, sub(kwh, tier1Limit));
  const out = [built(input, { id: "EXCISE:TIER1", category: "EXCISE", label: "Accise, primo scaglione", quantity: first, quantityUnit: "kWh", unitPrice: perKwh(rule.tier1Rate), priceUnit: "EUR/kWh", formulaId: "V3_EXCISE_TIER", expression: `kWh fino a ${rule.tier1MonthlyKwh} al mese × aliquota`, sources: [input.consumption.source, rule.tier1Rate.source] })];
  if (cmp(second, R0) > 0) out.push(built(input, { id: "EXCISE:TIER2", category: "EXCISE", label: "Accise, secondo scaglione", quantity: second, quantityUnit: "kWh", unitPrice: perKwh(rule.tier2Rate), priceUnit: "EUR/kWh", formulaId: "V3_EXCISE_TIER", expression: `kWh oltre ${rule.tier1MonthlyKwh} al mese × aliquota`, sources: [input.consumption.source, rule.tier2Rate.source] }));
  return out;
}

export function vatComponent(input: V3Input, taxable: readonly V3Component[]): V3Component {
  const due = taxable.filter((component) => component.vatTaxable && component.category !== "VAT" && component.completeness !== "NOT_DUE");
  const known = due.filter((component) => component.amountCents !== null);
  const unknown = due.filter((component) => component.amountCents === null || component.completeness === "INCOMPLETE");
  const baseCents = sumCents(known.map((component) => component.amountCents ?? 0));
  const rate = value(input.taxes.vatRate);
  if (input.taxes.vatRate.unit !== "RATIO") throw new Error(`V3_UNIT_MISMATCH:${input.taxes.vatRate.unit}:RATIO`);
  const component = built(input, { id: "VAT", category: "VAT", label: `IVA ${toDecimalString(mul(rate, integer(100)))}%`, quantity: centsToRational(baseCents), quantityUnit: "EUR", unitPrice: rate, priceUnit: "ratio", formulaId: "V3_VAT_ON_ROUNDED_BASE", expression: "aliquota × somma degli importi imponibili arrotondati (accise comprese)", sources: [input.taxes.vatRate.source], vatTaxable: false });
  return unknown.length ? { ...component, completeness: "INCOMPLETE", reason: `base imponibile incompleta: ${unknown.map((item) => item.label.toLowerCase()).join(", ")} non determinabile` } : component;
}
