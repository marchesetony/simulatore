import type { MarketSnapshot } from "../../modules/simulations/types";
export function MarketEditor({ value, change }: { value: MarketSnapshot; change: (value: MarketSnapshot) => void }) {
  const update = (index: number, patch: Partial<MarketSnapshot["values"][number]>) => change({ ...value,
    values: value.values.map((row, i) => i === index ? { ...row, ...patch } : row) });
  return <fieldset><legend>PUN utilizzato — snapshot manuale</legend>
    <label>Riferimento snapshot<input required maxLength={120} value={value.reference} onChange={e => change({ ...value, reference: e.target.value })} /></label>
    {value.values.map((row, i) => <fieldset key={i}><legend>Valore {i + 1}</legend>
      <label>Mese<input required type="month" value={row.month} onChange={e => update(i, { month: e.target.value })} /></label>
      <label>Fascia<select value={row.band} onChange={e => update(i, { band: e.target.value as typeof row.band })}>
        <option>F1</option><option>F2</option><option>F3</option></select></label>
      <label>PUN (€/MWh)<input inputMode="decimal" value={row.value ?? ""} onChange={e => update(i, { value: e.target.value.replace(",", ".") || null })} /></label>
      <label>Riferimento versione<input required maxLength={120} value={row.versionReference} onChange={e => update(i, { versionReference: e.target.value })} /></label>
      <button type="button" onClick={() => change({ ...value, values: value.values.filter((_, j) => j !== i) })}>Rimuovi valore</button>
    </fieldset>)}
    <button type="button" disabled={value.values.length >= 360} onClick={() => change({ ...value,
      values: [...value.values, { month: "", band: "F1", value: null, unit: "EUR_PER_MWH", versionReference: "" }] })}>Aggiungi valore PUN</button>
    <p>Per ciascun mese servono tutte le fasce e i consumi corrispondenti. Nessun valore viene recuperato automaticamente.</p>
  </fieldset>;
}
