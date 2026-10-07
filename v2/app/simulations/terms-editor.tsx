import { FEE_KINDS, type CommercialTermsSnapshot, type Rate } from "../../modules/simulations/types";
import { feeLabels } from "./labels";

export function emptyTerms(): CommercialTermsSnapshot {
  const unknown: Rate = { applicability: "UNKNOWN", amount: null, unit: null };
  return { reference: "", periodStart: "", periodEnd: "", mode: "FIXED", taxTreatment: "EXCLUDED",
    fixedPrice: { ...unknown }, spread: { ...unknown }, fees: FEE_KINDS.map(kind => ({ kind, ...unknown })) };
}
function RateEditor({ label, value, change }: { label: string; value: Rate; change: (value: Rate) => void }) {
  return <fieldset><legend>{label}</legend>
    <label>Applicabilità<select value={value.applicability} onChange={e => change(e.target.value === "NOT_APPLICABLE"
      ? { applicability: "NOT_APPLICABLE", amount: null, unit: null } : { ...value, applicability: e.target.value as Rate["applicability"] })}>
      <option value="UNKNOWN">Non nota</option><option value="APPLIES">Si applica</option><option value="NOT_APPLICABLE">Esplicitamente non applicabile</option>
    </select></label>
    {value.applicability !== "NOT_APPLICABLE" && <>
      <label>Importo unitario<input inputMode="decimal" value={value.amount ?? ""} onChange={e => change({ ...value, amount: e.target.value.replace(",", ".") || null })} /></label>
      <label>Unità<select value={value.unit ?? ""} onChange={e => change({ ...value, unit: (e.target.value || null) as Rate["unit"] })}>
        <option value="">Non nota</option><option value="EUR_PER_KWH">€/kWh</option><option value="EUR_PER_MONTH">€/mese</option>
        <option value="EUR_PER_YEAR">€/anno</option><option value="EUR_PER_CONTRACT">€/contratto</option>
      </select></label></>}
  </fieldset>;
}
export function TermsEditor({ label, value, change }: {
  label: string; value: CommercialTermsSnapshot; change: (value: CommercialTermsSnapshot) => void;
}) {
  return <fieldset><legend>{label} — imposte escluse</legend>
    <label>Riferimento dei termini<input required maxLength={120} value={value.reference} onChange={e => change({ ...value, reference: e.target.value })} /></label>
    <label>Validi dal<input required type="date" value={value.periodStart} onChange={e => change({ ...value, periodStart: e.target.value })} /></label>
    <label>Validi al (incluso)<input required type="date" value={value.periodEnd} onChange={e => change({ ...value, periodEnd: e.target.value })} /></label>
    <label>Prezzo energia<select value={value.mode} onChange={e => change({ ...value, mode: e.target.value as CommercialTermsSnapshot["mode"] })}>
      <option value="FIXED">Fisso</option><option value="INDEXED">PUN per fascia + spread</option></select></label>
    <RateEditor label="Prezzo fisso (non applicabile per indicizzata)" value={value.fixedPrice} change={fixedPrice => change({ ...value, fixedPrice })} />
    <RateEditor label="Spread" value={value.spread} change={spread => change({ ...value, spread })} />
    {value.fees.map((fee, i) => <RateEditor key={fee.kind} label={feeLabels[fee.kind]} value={fee}
      change={rate => change({ ...value, fees: value.fees.map((row, j) => j === i ? { ...rate, kind: row.kind } : row) })} />)}
    <p>Altre quote variabili, sconti e una tantum applicabili richiedono una disambiguazione non disponibile: il calcolo sarà bloccato.</p>
  </fieldset>;
}
