"use client";
import { useState, type FormEvent } from "react";
import type { Bill, BillInput, BillCreateInput, Supply, ConsumptionInput, LineInput } from "../../modules/bills/types";
import type { CustomerView } from "../../modules/customers/types";
import { eurosToCents } from "../../modules/bills/values";
import { billInput } from "../../modules/bills/schema";
import { euroInput } from "./labels";
import { ConsumptionEditor } from "./consumption-editor";
import { LineEditor, lineAmounts } from "./line-editor";

export function BillForm({ initial, customers, supplies, busy, save, cancel }: {
  initial: Bill | null; customers: readonly CustomerView[]; supplies: readonly Supply[]; busy: boolean;
  save: (input: BillInput | BillCreateInput) => Promise<void>; cancel: () => void;
}) {
  const [customer, setCustomer] = useState(initial?.customerId ?? "");
  const [start, setStart] = useState(initial?.periodStart ?? "");
  const [end, setEnd] = useState(initial?.periodEnd ?? "");
  const [consumptions, setConsumptions] = useState<readonly ConsumptionInput[]>(() => initial?.consumptions.map(({ periodStart, periodEnd, band, energyKwh }) => ({ periodStart, periodEnd, band, energyKwh })) ?? []);
  const [lines, setLines] = useState<readonly LineInput[]>(() => initial?.lines.map(({ kind, level, description, periodStart, periodEnd, quantity, unit, unitPrice, amount, documentTotalParticipation }) =>
    ({ kind, level, description, periodStart, periodEnd, quantity, unit, unitPrice, amount, documentTotalParticipation })) ?? []);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const input = billInput({ documentNumber: data.get("documentNumber"), issueDate: data.get("issueDate"),
        periodStart: start, periodEnd: end, currency: "EUR", declaredDocumentTotal: eurosToCents(String(data.get("declaredDocumentTotal") ?? "")),
        consumptions: consumptions.map(row => ({ ...row, energyKwh: row.energyKwh?.replace(",", ".") ?? null })), lines: lineAmounts(lines, data) });
      await save(initial ? input : { ...input, customerId: customer, supplyId: String(data.get("supplyId")) });
    } catch { setError("Controlla date, importi, quantità e somma dei consumi per fascia."); }
  }
  return <form method="post" onSubmit={submit}><h2>{initial ? "Modifica bolletta" : "Nuova bolletta manuale"}</h2>
    <p>Trascrizione manuale del documento. Nessun file viene acquisito o verificato.</p>
    <fieldset disabled={busy}><legend>Dati bolletta</legend>
      {!initial && <><label>Cliente<select required value={customer} onChange={e => setCustomer(e.target.value)}>
        <option value="">Seleziona cliente</option>{customers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Fornitura<select key={customer} required name="supplyId" defaultValue=""><option value="">Seleziona fornitura</option>
          {supplies.filter(row => row.customerId === customer).map(row => <option key={row.id} value={row.id}>{row.pod}</option>)}</select></label></>}
      <label>Numero documento<input name="documentNumber" required maxLength={100} defaultValue={initial?.documentNumber ?? ""} /></label>
      <label>Data emissione<input name="issueDate" type="date" required defaultValue={initial?.issueDate ?? ""} /></label>
      <label>Periodo dal<input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>Periodo al (incluso)<input type="date" required value={end} onChange={e => setEnd(e.target.value)} /></label>
      <label>Totale dichiarato dal documento (€)<input name="declaredDocumentTotal" inputMode="decimal" defaultValue={euroInput(initial?.declaredDocumentTotal ?? null)} /></label>
      <ConsumptionEditor rows={consumptions} periodStart={start} periodEnd={end} change={setConsumptions} />
      <LineEditor lines={lines} periodStart={start} periodEnd={end} change={setLines} />
      <p>La trascrizione manuale non dimostra la completezza contabile. La riconciliazione resta non determinabile.</p>
      <button type="submit">Salva bolletta</button><button type="button" onClick={cancel}>Annulla</button>
    </fieldset>{error && <p role="alert">{error}</p>}
  </form>;
}
