"use client";
import { useState, type FormEvent } from "react";
import type { Bill } from "../../modules/bills/types";
import type { MarketSnapshot, SimulationCreateInput } from "../../modules/simulations/types";
import { simulationInput } from "../../modules/simulations/schema";
import { emptyTerms, TermsEditor } from "./terms-editor";
import { MarketEditor } from "./market-editor";

export default function SimulationForm({ bills, busy, create }: {
  bills: readonly Bill[]; busy: boolean; create: (input: SimulationCreateInput) => Promise<void>;
}) {
  const [billId, setBillId] = useState("");
  const [candidate, setCandidate] = useState(emptyTerms);
  const [current, setCurrent] = useState(emptyTerms);
  const [withCurrent, setWithCurrent] = useState(false);
  const [market, setMarket] = useState<MarketSnapshot>({ reference: "", values: [] });
  const [error, setError] = useState("");
  const bill = bills.find(row => row.id === billId);
  const indexed = candidate.mode === "INDEXED" || (withCurrent && current.mode === "INDEXED");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await create(simulationInput({ billId, calculationPeriod: { periodStart: fields.get("periodStart"), periodEnd: fields.get("periodEnd") },
        candidateCommercialTerms: candidate, currentCommercialTerms: withCurrent ? current : null, marketSnapshot: indexed ? market : null }));
    } catch { setError("Controlla riferimenti, date, unità e valori decimali."); }
  }
  return <form method="post" onSubmit={submit}><fieldset disabled={busy}><legend>Nuova simulazione commerciale</legend>
    <label>Bolletta di riferimento<select required value={billId} onChange={e => setBillId(e.target.value)}><option value="">Seleziona</option>
      {bills.map(row => <option key={row.id} value={row.id}>{row.documentNumber} · {row.periodStart} — {row.periodEnd}</option>)}</select></label>
    <label>Periodo dal<input key={`from-${billId}`} name="periodStart" type="date" required defaultValue={bill?.periodStart ?? ""} /></label>
    <label>Periodo al (incluso)<input key={`to-${billId}`} name="periodEnd" type="date" required defaultValue={bill?.periodEnd ?? ""} /></label>
    {bill && <p>Consumi dalla bolletta: {bill.consumptions.map(row => `${row.band}: ${row.energyKwh === null ? "non noto" : `${row.energyKwh} kWh`} (${row.periodStart} — ${row.periodEnd})`).join("; ") || "non disponibili"}.</p>}
    <TermsEditor label="Termini candidati" value={candidate} change={setCandidate} />
    <label><input type="checkbox" checked={withCurrent} onChange={e => setWithCurrent(e.target.checked)} />Disponibili termini commerciali attuali</label>
    {withCurrent && <TermsEditor label="Termini attuali" value={current} change={setCurrent} />}
    {!withCurrent && <p>Il confronto e le differenze non saranno disponibili. Il totale della bolletta non viene usato come costo attuale.</p>}
    {indexed && <MarketEditor value={market} change={setMarket} />}
    <button type="submit" disabled={!billId}>Calcola e salva snapshot</button>
  </fieldset>{error && <p role="alert">{error}</p>}</form>;
}
