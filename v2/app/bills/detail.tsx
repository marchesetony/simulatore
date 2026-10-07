import type { Bill, Supply } from "../../modules/bills/types";
import { completenessLabels, kindLabels, money, validationLabels } from "./labels";

export function BillDetail({ bill, supply, edit }: { bill: Bill; supply?: Supply; edit: () => void }) {
  const categories = bill.reconciliation.categories;
  const taxLines = bill.lines.filter(line => line.kind === "VAT" || line.kind === "EXCISE");
  const otherLines = bill.lines.filter(line => ["PREVIOUS_BALANCE", "TV_LICENSE", "RECALCULATION", "OTHER_AMOUNTS"].includes(line.kind));
  return <article><h2>Bolletta {bill.documentNumber}</h2><button onClick={edit}>Modifica dati</button>
    <section><h3>Dati bolletta</h3><dl><dt>Numero documento</dt><dd>{bill.documentNumber}</dd>
      <dt>Emissione</dt><dd>{bill.issueDate}</dd><dt>Periodo, estremi inclusi</dt><dd>{bill.periodStart} — {bill.periodEnd}</dd>
      <dt>Documento originale</dt><dd>Non acquisito; inserimento manuale</dd>
      <dt>Completezza dati</dt><dd>{completenessLabels[bill.completenessStatus]}</dd>
      <dt>Validazione</dt><dd>{validationLabels[bill.validationStatus]}</dd></dl></section>
    <section><h3>Fornitura e consumi</h3><p>POD: {supply?.pod ?? "Non disponibile"}</p>
      {!bill.consumptions.length ? <p>Nessun consumo inserito.</p> : <ul>{bill.consumptions.map(row => <li key={row.id}>
        {row.periodStart} — {row.periodEnd} · {row.band === "TOTAL" ? "Totale" : row.band}: {row.energyKwh === null ? "Non noto" : `${row.energyKwh} kWh`}
      </li>)}</ul>}</section>
    <section><h3>Scontrino dell’energia</h3><dl>
      <dt>Totale dichiarato dal documento</dt><dd>{money(bill.declaredDocumentTotal)}</dd>
      <dt>Totale ricostruito</dt><dd>{money(bill.reconciliation.reconstructedTotal)}</dd>
      <dt>Riconciliazione</dt><dd>{bill.reconciliation.status === "MATCH" ? "Coincide esattamente" : bill.reconciliation.status === "DIFFERENCE" ? "Scostamento" : "Non determinabile"}</dd>
      <dt>Differenza</dt><dd>{money(bill.reconciliation.difference)}</dd>
      <dt>Addebiti correnti — dettagli disponibili</dt><dd>{money(categories.currentCharges)}</dd>
      <dt>Canone TV — dettagli disponibili</dt><dd>{money(categories.tvLicense)}</dd>
      <dt>Saldo precedente — dettagli disponibili</dt><dd>{money(categories.previousBalance)}</dd>
      <dt>Altri importi — dettagli disponibili</dt><dd>{money(categories.otherAmounts)}</dd></dl>
      <p>Le categorie restano separate e non vengono automaticamente sommate come totale fattura.</p>
      {bill.reconciliation.status === "NOT_DETERMINABLE" && <p>Il modello manuale non dimostra la copertura contabile completa né le relazioni fra aggregati e dettagli.</p>}
    </section>
    {taxLines.length > 0 && <section><h3>Imposte</h3><ul>{taxLines.map(line => <li key={line.id}>{kindLabels[line.kind]} · {line.description}: {money(line.amount)}</li>)}</ul></section>}
    <section><h3>Elementi di dettaglio</h3>{!bill.lines.length ? <p>Nessuna voce inserita.</p> :
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Voce</th><th>Livello</th><th>Periodo</th><th>Quantità</th><th>Prezzo unitario</th><th>Importo</th><th>Nel totale</th></tr></thead>
        <tbody>{bill.lines.map(line => <tr key={line.id}><th scope="row">{kindLabels[line.kind]} · {line.description}</th>
          <td>{line.level === "DETAIL" ? "Dettaglio" : "Aggregato"}</td><td>{line.periodStart} — {line.periodEnd}</td>
          <td>{line.quantity ?? "Non nota"} {line.unit ?? ""}</td><td>{line.unitPrice === null ? "Non noto" : `${line.unitPrice} €/unità`}</td>
          <td>{money(line.amount)}</td><td>{line.documentTotalParticipation === "INCLUDED" ? "Incluso" : line.documentTotalParticipation === "EXCLUDED" ? "Escluso" : "Da determinare"}</td></tr>)}</tbody></table></div>}</section>
    {otherLines.length > 0 && <section><h3>Ricalcoli / altre partite / saldi pregressi</h3><ul>{otherLines.map(line => <li key={line.id}>{line.description}: {money(line.amount)}</li>)}</ul></section>}
  </article>;
}
