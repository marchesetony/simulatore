import { LINE_KINDS, type LineInput } from "../../modules/bills/types";
import { eurosToCents } from "../../modules/bills/values";
import { euroInput, kindLabels } from "./labels";

export function LineEditor({ lines, periodStart, periodEnd, change }: {
  lines: readonly LineInput[]; periodStart: string; periodEnd: string; change: (rows: readonly LineInput[]) => void;
}) {
  const update = (index: number, patch: Partial<LineInput>) => change(lines.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section><h3>Elementi di dettaglio</h3><p>Importi in euro. Vuoto significa non noto. Indica esplicitamente se la voce concorre al totale dichiarato.</p>
    {lines.map((line, i) => <fieldset key={i}><legend>Voce {i + 1}</legend>
      <label>Categoria<select value={line.kind} onChange={e => update(i, { kind: e.target.value as LineInput["kind"] })}>
        {LINE_KINDS.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
      <label>Livello<select value={line.level} onChange={e => update(i, { level: e.target.value as LineInput["level"] })}>
        <option value="DETAIL">Dettaglio</option><option value="AGGREGATE">Aggregato</option></select></label>
      <label>Descrizione<input required maxLength={240} value={line.description} onChange={e => update(i, { description: e.target.value })} /></label>
      <label>Dal<input required type="date" value={line.periodStart} onChange={e => update(i, { periodStart: e.target.value })} /></label>
      <label>Al (incluso)<input required type="date" value={line.periodEnd} onChange={e => update(i, { periodEnd: e.target.value })} /></label>
      <label>Quantità<input inputMode="decimal" value={line.quantity ?? ""} onChange={e => update(i, { quantity: e.target.value || null })} /></label>
      <label>Unità<input maxLength={40} value={line.unit ?? ""} onChange={e => update(i, { unit: e.target.value || null })} /></label>
      <label>Prezzo unitario (€/unità)<input inputMode="decimal" value={line.unitPrice ?? ""} onChange={e => update(i, { unitPrice: e.target.value || null })} /></label>
      <label>Importo (€)<input name={`amount-${i}`} inputMode="decimal" defaultValue={euroInput(line.amount)} /></label>
      <label>Nel totale dichiarato<select value={line.documentTotalParticipation} onChange={e => update(i, { documentTotalParticipation: e.target.value as LineInput["documentTotalParticipation"] })}>
        <option value="UNKNOWN">Da determinare</option><option value="INCLUDED">Incluso</option><option value="EXCLUDED">Escluso</option></select></label>
    </fieldset>)}
    <button type="button" disabled={lines.length >= 100} onClick={() => change([...lines, { kind: "UNKNOWN", level: "DETAIL", description: "",
      periodStart, periodEnd, quantity: null, unit: null, unitPrice: null, amount: null, documentTotalParticipation: "UNKNOWN" }])}>Aggiungi voce</button>
  </section>;
}
export function lineAmounts(lines: readonly LineInput[], form: FormData): readonly LineInput[] {
  return lines.map((line, i) => ({ ...line, amount: eurosToCents(String(form.get(`amount-${i}`) ?? "")),
    quantity: line.quantity?.replace(",", ".") ?? null, unitPrice: line.unitPrice?.replace(",", ".") ?? null }));
}
