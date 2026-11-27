"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ErrorState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";

type Policy = { readonly enabled: boolean; readonly maxGapPercent: number; readonly targetSavingPercent: number };
type Response = { readonly policy: Policy; readonly canManage: boolean };

const percent = (value: string): number => Number(value.replace(",", "."));

/**
 * Tony (1/11): in place of "Ricarico o sconto" on each CTE, one box "gestibile e visibile solo dall'amministratore
 * dell'azienda e a cascata chi lui autorizza": quotes costing more than the bill by at most a threshold get the company's
 * commercial discount, down to the saving it chose. The discount is printed on the quote and on the proposal.
 */
export default function CommercialDiscountPanel(): ReactNode {
  const [loaded, setLoaded] = useState<Response | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [maxGap, setMaxGap] = useState("");
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let live = true;
    requestJson<Response>("/api/company/discount").then((response) => {
      if (!live) return;
      setLoaded(response); setEnabled(response.policy.enabled);
      setMaxGap(response.policy.maxGapPercent ? String(response.policy.maxGapPercent).replace(".", ",") : "");
      setTarget(response.policy.targetSavingPercent ? String(response.policy.targetSavingPercent).replace(".", ",") : "");
    }, () => undefined);
    return () => { live = false; };
  }, []);

  if (!loaded?.canManage) return null;

  async function save(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError(undefined); setMessage(undefined);
    try {
      const response = await requestJson<Response>("/api/company/discount", { method: "PUT", body: JSON.stringify({ enabled, maxGapPercent: maxGap ? percent(maxGap) : 0, targetSavingPercent: target ? percent(target) : 0 }) });
      setLoaded(response); setMessage(response.policy.enabled ? "Sconto commerciale salvato: vale per i prossimi preventivi." : "Sconto commerciale disattivato.");
    } catch (cause) { const safe = toUiError(cause); setError(`${safe.message}  codice ${safe.code}`); } finally { setPending(false); }
  }

  return <section className="ui-card commercial-discount-card" aria-label="Sconto commerciale aziendale">
    <p className="eyebrow">SOLO AMMINISTRAZIONE</p>
    <h2>Sconto commerciale aziendale</h2>
    <p className="section-detail">Quando un preventivo costa più della bolletta entro la soglia indicata, l&apos;app applica uno sconto commerciale che lo porta al risparmio stabilito. Lo sconto compare come voce nel preventivo e nella proposta, e va applicato in fattura al cliente.</p>
    <form className="commercial-discount-form" onSubmit={(event) => void save(event)}>
      <label><input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} /> Attiva lo sconto commerciale</label>
      <div className="form-grid">
        <div className="form-field"><label className="form-label" htmlFor="discount-gap">Applica ai preventivi più cari della bolletta fino al (%)</label><input id="discount-gap" inputMode="decimal" value={maxGap} disabled={!enabled} placeholder="es. 5" onChange={(event) => setMaxGap(event.target.value)} /></div>
        <div className="form-field"><label className="form-label" htmlFor="discount-target">Risparmio da mostrare rispetto alla bolletta (%)</label><input id="discount-target" inputMode="decimal" value={target} disabled={!enabled} placeholder="es. 2" onChange={(event) => setTarget(event.target.value)} /></div>
      </div>
      {enabled && maxGap && target ? <p className="muted">Esempio: bolletta 100 €, preventivo {(100 + Math.min(percent(maxGap) || 0, 30)).toFixed(2).replace(".", ",")} € → sconto commerciale e preventivo a {(100 - (percent(target) || 0)).toFixed(2).replace(".", ",")} €.</p> : null}
      <div className="button-row"><button className="button primary" type="submit" disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</button></div>
    </form>
    {error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
  </section>;
}
