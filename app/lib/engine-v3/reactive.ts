import { built, missing } from "./components";
import { cmp, div, integer, max, min, mul, parseDecimal, R0, sub, type Rational } from "./rational";
import { monthShares } from "./period";
import type { V3Band, V3Component, V3Input, V3ReactiveMeasure, V3ReactiveTariffRow, V3Source } from "./types";

/**
 * Motore V3, energia reattiva (Tony, 16/11/2026, "V3 fase 2"). Discipline applied (TIT 2024-2027, Allegato A 616/2023/R/eel
 * as amended, Titolo VII; delibera 232/2022/R/eel):
 * - art. 32 c.1-2: the charges apply to non-domestic BT points with available power above 16,5 kW and to MT points;
 * - art. 32 c.3: they apply to the monthly reactive energy of each band, against the active energy of the same band;
 * - Tabella 5 (2024-2027): withdrawn kVArh above the threshold in F1 and F2; injected kVArh in F3 (232/2022, from 1/4/2023);
 * - art. 32 c.7: for BT, injected charges are zero when the meter does not register injected reactive energy by band.
 * The rows (bands, thresholds, rates, validity) come from the official table as published; the engine only selects and applies
 * them. A bill's printed €/kVArh is never an input: without the official row of the period the component is not determinable.
 */
const SIXTEEN_FIVE = parseDecimal("16.5");
const HUNDRED = integer(100);

function rate(row: V3ReactiveTariffRow): Rational {
  if (row.rate.unit === "EUR/kVArh") return parseDecimal(row.rate.value);
  if (row.rate.unit === "cEUR/kVArh") return div(parseDecimal(row.rate.value), HUNDRED);
  throw new Error(`V3_UNIT_MISMATCH:${row.rate.unit}:EUR/kVArh`);
}

const day = (text: string) => Date.parse(`${text}T00:00:00Z`);

export type V3ReactiveApplicability = { readonly applies: true; readonly basis: string; readonly source?: V3Source } | { readonly applies: false; readonly due: "NOT_DUE" | "NOT_DETERMINABLE"; readonly reason: string };

/** Whether the supply is subject to the reactive charges (art. 32 c.1-2 TIT). */
export function reactiveApplicability(input: V3Input): V3ReactiveApplicability {
  if (input.supply.customer === "DOMESTIC") return { applies: false, due: "NOT_DUE", reason: "cliente domestico: i corrispettivi di energia reattiva non si applicano (TIT art. 32)" };
  if (input.supply.voltage === "MT") return { applies: true, basis: "punto di prelievo in media tensione (TIT art. 32 c.2)" };
  if (input.supply.voltage !== "BT") return { applies: false, due: "NOT_DETERMINABLE", reason: `tensione ${input.supply.voltage} non gestita dal motore V3` };
  const available = input.supply.availablePowerKw;
  if (available) {
    return cmp(parseDecimal(available.value), SIXTEEN_FIVE) > 0
      ? { applies: true, basis: `BT con potenza disponibile ${available.value} kW, oltre 16,5 kW (TIT art. 32 c.1)`, source: available.source }
      : { applies: false, due: "NOT_DUE", reason: `BT con potenza disponibile ${available.value} kW, non oltre 16,5 kW: corrispettivi non applicabili (TIT art. 32 c.1)` };
  }
  // Only the available power decides (art. 32 c.1). The billed power (committed or monthly maximum) and the tariff class are not
  // a substitute: classes BTA1-BTA5 are assigned on committed power (Tony 5/11), and a billed kW says nothing about availability.
  return { applies: false, due: "NOT_DETERMINABLE", reason: "dato mancante: potenza disponibile della fornitura (soglia 16,5 kW, TIT art. 32 c.1); la potenza fatturata e la classe tariffaria non la sostituiscono" };
}

export type V3ReactiveSelection = { readonly rows: readonly V3ReactiveTariffRow[] } | { readonly rows: null; readonly reason: string };

/** Official rows of the supply's voltage whose validity covers the whole period (one tariff year). */
export function selectReactiveRows(input: V3Input): V3ReactiveSelection {
  const voltage = input.supply.voltage;
  const start = day(input.period.start); const end = day(input.period.endExclusive);
  const rows = (input.regulated.reactiveTariff ?? []).filter((row) => row.voltage === voltage);
  const touching = rows.filter((row) => day(row.validFrom) < end && (row.validToExclusive === null || day(row.validToExclusive) > start));
  const covering = touching.filter((row) => day(row.validFrom) <= start && (row.validToExclusive === null || day(row.validToExclusive) >= end));
  if (touching.length && covering.length !== touching.length) return { rows: null, reason: "il periodo attraversa due periodi tariffari dell'energia reattiva: servono i kVArh mese per mese" };
  if (!covering.length) return { rows: null, reason: `tabella ufficiale dell'energia reattiva (TIT, Tabella 5) per ${voltage} valida dal ${input.period.start} non presente nell'archivio: i kVArh sono misurati, il prezzo non è determinabile` };
  const ids = new Set<string>();
  for (const row of covering) {
    if (ids.has(row.id)) throw new Error(`V3_DUPLICATE_REACTIVE_ROW:${row.id}`);
    ids.add(row.id);
  }
  return { rows: covering };
}

function measureOf(measures: readonly V3ReactiveMeasure[], kind: V3ReactiveMeasure["kind"], band: V3Band): Rational | null {
  const found = measures.filter((measure) => measure.kind === kind && measure.band === band);
  if (found.length > 1) throw new Error(`V3_DUPLICATE_REACTIVE_MEASURE:${kind}:${band}`);
  return found.length ? parseDecimal(found[0].kvarh) : null;
}

const kindLabel = (kind: V3ReactiveMeasure["kind"]) => (kind === "INJECTED" ? "immessa" : "prelevata");

export function reactiveComponents(input: V3Input): V3Component[] {
  const measures = input.reactive?.measures ?? [];
  if (!measures.length) return [];
  const reactiveSource = input.reactive!.source;
  const notPriced = (reason: string, completeness: "NOT_DUE" | "NOT_DETERMINABLE" = "NOT_DETERMINABLE") =>
    [missing(input, "REACTIVE_ENERGY", "REACTIVE_ENERGY", "Energia reattiva", reason, "V3_REACTIVE_TIT_TAB5", { sources: [reactiveSource], completeness, ...(completeness === "NOT_DUE" ? { amountCents: 0, exactAmount: "0" } : {}) })];

  const applicability = reactiveApplicability(input);
  if (!applicability.applies) return notPriced(applicability.reason, applicability.due);
  const selection = selectReactiveRows(input);
  if (!selection.rows) return notPriced(selection.reason);
  const rows = selection.rows;

  // Thresholds above zero compare monthly kVArh with monthly kWh (art. 32 c.3): a longer period needs month-by-month data.
  const months = monthShares(input.period.start, input.period.endExclusive).length;

  const out: V3Component[] = [];
  for (const kind of ["WITHDRAWN", "INJECTED"] as const) {
    const ofKind = measures.filter((measure) => measure.kind === kind);
    if (!ofKind.length) continue;
    const kindRows = rows.filter((row) => row.kind === kind);
    if (!kindRows.length) continue; // the official table charges nothing for this kind at this voltage
    if (ofKind.some((measure) => measure.band === "ALL")) {
      out.push(missing(input, `REACTIVE_ENERGY:${kind}`, "REACTIVE_ENERGY", `Energia reattiva ${kindLabel(kind)}`, `kVArh ${kindLabel(kind)} senza fascia: la tariffa si applica per fascia (TIT art. 32 c.3${kind === "INJECTED" && input.supply.voltage === "BT" ? "; in BT l'immessa è nulla se il misuratore non la registra per fascia, art. 32 c.7" : ""})`, "V3_REACTIVE_TIT_TAB5", { sources: [reactiveSource] }));
      continue;
    }
    for (const row of kindRows) {
      const from = parseDecimal(row.fromRatio);
      const to = row.toRatio === null ? null : parseDecimal(row.toRatio);
      for (const band of row.bands) {
        const id = `REACTIVE_ENERGY:${row.id}:${band}`;
        const label = `Energia reattiva ${kindLabel(kind)} ${band}${cmp(from, R0) > 0 ? ` oltre ${row.fromRatio} dell'attiva` : ""}`;
        const kvarh = measureOf(measures, kind, band);
        if (kvarh === null) { out.push(missing(input, id, "REACTIVE_ENERGY", label, `kVArh ${kindLabel(kind)} in ${band} non disponibili`, "V3_REACTIVE_TIT_TAB5", { sources: [reactiveSource, row.rate.source] })); continue; }
        const thresholded = cmp(from, R0) > 0 || to !== null;
        if (thresholded && months > 1) { out.push(missing(input, id, "REACTIVE_ENERGY", label, "soglia mensile sull'energia attiva: per un periodo di più mesi servono kVArh e kWh mese per mese (TIT art. 32 c.3)", "V3_REACTIVE_TIT_TAB5", { sources: [reactiveSource, row.rate.source] })); continue; }
        const active = parseDecimal(input.consumption.bands[band]);
        const lower = mul(from, active);
        const upper = to === null ? kvarh : min(kvarh, mul(to, active));
        const billable = max(R0, sub(upper, lower));
        out.push(built(input, {
          id, category: "REACTIVE_ENERGY", label, quantity: billable, quantityUnit: "kVArh", unitPrice: rate(row), priceUnit: "EUR/kVArh",
          formulaId: "V3_REACTIVE_TIT_TAB5",
          expression: `max(0, min(kVArh ${kindLabel(kind)} ${band}, ${row.toRatio ?? "∞"} × kWh ${band}) − ${row.fromRatio} × kWh ${band}) × €/kVArh`,
          sources: [reactiveSource, input.consumption.source, row.rate.source, ...(applicability.source ? [applicability.source] : [])],
          assumptions: [applicability.basis, `riga ${row.id} valida dal ${row.validFrom}${row.validToExclusive ? ` al ${row.validToExclusive} escluso` : ""}`],
        }));
      }
    }
  }
  return out;
}
