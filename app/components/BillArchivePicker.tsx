import type { ReactNode } from "react";
import { searchArchive, type ArchiveList, type BillArchiveEntry } from "../lib/ui/bill-archive";

// Tony (10/11/2026): two distinct groups of bills already uploaded, each with holder, POD, billed period, invoice number
// (when read), short archive ID and state, with explicit messages for an empty list, a search without results and a list
// that could not be loaded (never a partial list). Checkboxes appear only for users the server lets delete.

interface Selection { readonly canDelete: boolean; readonly selected: ReadonlySet<string>; readonly onToggle: (id: string) => void; readonly onToggleMany: (ids: readonly string[], select: boolean) => void }

function Group({ title, note, list, query, empty, disabled, onOpen, onRetry, selection }: { readonly title: string; readonly note: string; readonly list: ArchiveList; readonly query: string; readonly empty: string; readonly disabled: boolean; readonly onOpen: (id: string) => void; readonly onRetry: () => void; readonly selection: Selection }): ReactNode {
  const shown: readonly BillArchiveEntry[] = list.status === "ready" ? searchArchive(list.entries, query) : [];
  const allShownSelected = shown.length > 0 && shown.every((entry) => selection.selected.has(entry.id));
  return <section className="bill-archive-group" aria-label={title}>
    <h4>{title}{list.status === "ready" && list.entries.length ? <small className="muted"> {list.entries.length === 1 ? "1 bolletta" : `${list.entries.length} bollette`}</small> : null}</h4>
    <p className="muted">{note}</p>
    {list.status === "loading" ? <p className="muted" role="status">Caricamento dell&apos;elenco…</p>
      : list.status === "error" ? <div className="warning-text" role="alert"><p>{list.message}</p><button className="button compact secondary" type="button" onClick={onRetry} disabled={disabled}>Riprova</button></div>
      : !list.entries.length ? <p className="muted">{empty}</p>
      : !shown.length ? <p className="muted">Nessuna bolletta di questo gruppo corrisponde alla ricerca.</p>
      : <>
        {selection.canDelete ? <label className="bill-archive-select-all"><input type="checkbox" checked={allShownSelected} onChange={(event) => selection.onToggleMany(shown.map((entry) => entry.id), event.target.checked)} disabled={disabled} /> Seleziona {query.trim() ? "le bollette trovate" : "tutte"} di questo gruppo ({shown.length})</label> : null}
        <ul className="bill-archive-list">{shown.map((entry) => <li key={entry.id} className={selection.canDelete ? "bill-archive-item selectable" : "bill-archive-item"}>
          {selection.canDelete ? <input type="checkbox" checked={selection.selected.has(entry.id)} onChange={() => selection.onToggle(entry.id)} disabled={disabled} aria-label={`Seleziona la bolletta di ${entry.holder}, ID ${entry.shortId}`} /> : null}
          <button type="button" className="bill-archive-row" onClick={() => onOpen(entry.id)} disabled={disabled || !entry.openable} aria-label={`Apri la bolletta di ${entry.holder}, POD ${entry.pod}, ${entry.period}, ${entry.stateLabel}`}>
            <strong>{entry.holder}</strong>
            <span>POD {entry.pod}</span>
            <span>{entry.period}</span>
            <span className={`bill-archive-state bill-archive-${entry.state.toLowerCase()}`}>{entry.stateLabel}</span>
            <small className="bill-archive-ids">{entry.invoiceNumber ? `Fattura ${entry.invoiceNumber} · ` : ""}ID {entry.shortId}</small>
          </button>
          {entry.openable ? null : <small className="muted">La lettura non è riuscita: carica di nuovo il PDF.</small>}
        </li>)}</ul>
      </>}
  </section>;
}

export function BillArchivePicker({ pendingBills, approvedBills, query, disabled, onOpen, onRetry, canDelete = false, selected = new Set<string>(), onToggle = () => undefined, onToggleMany = () => undefined }: { readonly pendingBills: ArchiveList; readonly approvedBills: ArchiveList; readonly query: string; readonly disabled: boolean; readonly onOpen: (id: string) => void; readonly onRetry: () => void; readonly canDelete?: boolean; readonly selected?: ReadonlySet<string>; readonly onToggle?: (id: string) => void; readonly onToggleMany?: (ids: readonly string[], select: boolean) => void }): ReactNode {
  const selection: Selection = { canDelete, selected, onToggle, onToggleMany };
  return <div className="bill-archive">
    <Group title="Bollette da completare" note="Non ancora approvate: si aprono su «Dati letti» per completare la revisione. Le offerte si calcolano solo dopo la conferma dei dati." list={pendingBills} query={query} empty="Nessuna bolletta da completare." disabled={disabled} onOpen={onOpen} onRetry={onRetry} selection={selection} />
    <Group title="Bollette già disponibili" note="Approvate: si riaprono senza caricare di nuovo il PDF." list={approvedBills} query={query} empty="Nessuna bolletta approvata disponibile." disabled={disabled} onOpen={onOpen} onRetry={onRetry} selection={selection} />
  </div>;
}
