import type { CommercialResult, CommercialTermsSnapshot, Simulation } from "../../modules/simulations/types";
import { feeLabels, money, reasonLabels } from "./labels";
export function ScopeNotice() {
  return <p>Simulazione commerciale: comprende solo le componenti commerciali calcolate. Sono esclusi componenti regolate/passanti,
    imposte, perdite di rete ed eventuali altre componenti non calcolate.</p>;
}
function Terms({ title, terms }: { title: string; terms: CommercialTermsSnapshot | null }) {
  return <section><h3>{title}</h3>{!terms ? <p>Non disponibili</p> : <>
    <p>{terms.reference} · {terms.mode === "FIXED" ? "Prezzo fisso" : "Indicizzata PUN per fascia"} · {terms.periodStart} — {terms.periodEnd}</p>
    <ul>{[{ name: "Prezzo fisso", ...terms.fixedPrice }, { name: "Spread", ...terms.spread }, ...terms.fees.map(row => ({ name: feeLabels[row.kind], ...row }))]
      .map(row => <li key={row.name}>{row.name}: {row.applicability === "NOT_APPLICABLE" ? "Non applicabile" : row.applicability === "UNKNOWN" ? "Applicabilità non nota" : `${row.amount ?? "Importo non noto"} ${row.unit ?? "Unità non nota"}`}</li>)}</ul>
  </>}</section>;
}
function Cost({ title, result }: { title: string; result: CommercialResult | null }) {
  return <section><h3>{title}</h3><p>{money(result?.commercialTotalCents ?? null)}</p>
    {result && <ul>{result.components.map((row, i) => <li key={i}>{row.kind === "ENERGY" ? "Energia" : row.kind === "SPREAD" ? "Spread" : feeLabels[row.kind]} · {row.band} · {row.periodStart} — {row.periodEnd}: {money(row.amountCents)}</li>)}</ul>}
  </section>;
}
export default function SimulationDetail({ simulation }: { simulation: Simulation }) {
  const { inputSnapshot: input, result } = simulation;
  return <article><h2>Simulazione commerciale — {result.status === "CALCULATED" ? "Calcolata" : "Bloccata"}</h2><ScopeNotice />
    <p>Bolletta {input.billReference.documentNumber} · POD {input.supplyReference.pod}</p>
    <p>Periodo: {input.calculationPeriod.periodStart} — {input.calculationPeriod.periodEnd}, estremi inclusi.</p>
    <h3>Consumi utilizzati</h3><ul>{input.consumptionProfile.map((row, i) => <li key={i}>{row.band}: {row.energyKwh ?? "Non noto"} kWh · {row.periodStart} — {row.periodEnd}</li>)}</ul>
    <Terms title="Termini candidati" terms={input.candidateCommercialTerms} /><Terms title="Termini attuali" terms={input.currentCommercialTerms} />
    {input.marketSnapshot && <section><h3>Snapshot PUN</h3><p>{input.marketSnapshot.reference}</p><ul>{input.marketSnapshot.values.map((row, i) =>
      <li key={i}>{row.month} · {row.band}: {row.value ?? "Non noto"} €/MWh · versione {row.versionReference}</li>)}</ul></section>}
    {result.blockReason && <p role="alert">{reasonLabels[result.blockReason]}</p>}
    <Cost title="Costo commerciale candidato" result={result.candidate} /><Cost title="Costo commerciale attuale" result={result.current} />
    <h3>Confronto: {result.comparison.status === "COMPARABLE" ? "Disponibile" : "Non disponibile"}</h3>
    {result.comparison.reason && <p>{reasonLabels[result.comparison.reason]}</p>}
    <p>Differenza attuale − candidato: {money(result.comparison.savingAmountCents)}</p>
    <p>Differenza percentuale: {result.comparison.savingPercentage === null ? "Non disponibile" : `${result.comparison.savingPercentage}%`}</p>
  </article>;
}
