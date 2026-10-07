import type { ConsumptionInput } from "../../modules/bills/types";

export function ConsumptionEditor({ rows, periodStart, periodEnd, change }: {
  rows: readonly ConsumptionInput[]; periodStart: string; periodEnd: string; change: (rows: readonly ConsumptionInput[]) => void;
}) {
  const update = (index: number, patch: Partial<ConsumptionInput>) => change(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section><h3>Consumi</h3><p>kWh con massimo tre decimali. Nessun valore mancante viene ricavato dalle altre fasce.</p>
    {rows.map((row, i) => <fieldset key={i}><legend>Consumo {i + 1}</legend>
      <label>Fascia<select value={row.band} onChange={e => update(i, { band: e.target.value as ConsumptionInput["band"] })}>
        {["TOTAL", "F1", "F2", "F3"].map(band => <option key={band} value={band}>{band === "TOTAL" ? "Totale" : band}</option>)}</select></label>
      <label>Dal<input required type="date" value={row.periodStart} onChange={e => update(i, { periodStart: e.target.value })} /></label>
      <label>Al (incluso)<input required type="date" value={row.periodEnd} onChange={e => update(i, { periodEnd: e.target.value })} /></label>
      <label>Energia (kWh)<input inputMode="decimal" value={row.energyKwh ?? ""} onChange={e => update(i, { energyKwh: e.target.value || null })} /></label>
    </fieldset>)}
    <button type="button" disabled={rows.length >= 100} onClick={() => change([...rows, { band: "TOTAL", energyKwh: null, periodStart, periodEnd }])}>Aggiungi consumo</button>
  </section>;
}
