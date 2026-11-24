"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { requestJson, UiApiError } from "../lib/ui/client";
import { DOCUMENT_KIND_LABEL, simulableText, archiveMonths, BULK_DELETE_LIMIT, bulkConfirmText, bulkOutcomeText, bulkSummaryText, documentsText, filterArchiveRows, groupArchiveRows, isMultiMonth, monthLabel, NOT_AVAILABLE, periodText, proposalsText, readingLabel, totalText, type BillArchiveDocumentFilter, type BillArchiveRow, type BillBulkResult } from "../lib/ui/bill-archive-month";

// Tony (20/11/2026, "AVVIO FASE 2: ARCHIVIO BOLLETTE"): the company's bill archive, by month of the end of the consumption
// period. Search by customer, POD or invoice number; filters by month, period and documents. Deletion of one bill, of a
// selection or of a month's bills, always after an explicit confirmation, with the real outcome of each bill. The server
// decides everything (company, commercial branch, linked proposals): this screen only asks and reports.

type Load = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly rows: readonly BillArchiveRow[]; readonly canDelete: boolean };

function loadMessage(cause: unknown): string {
  if (cause instanceof UiApiError && cause.code === "BILL_LIST_TOO_LARGE") return "L'archivio supera il numero massimo di bollette mostrabili: l'elenco non viene mostrato per non presentarlo incompleto.";
  if (cause instanceof UiApiError && /^(AUTHENTICATION_|AUTHORIZATION_DENIED|ROLE_INSUFFICIENT|TENANT_MISMATCH)/.test(cause.code)) return cause.message;
  return "Archivio bollette non disponibile: riprova. Le bollette salvate non sono state modificate.";
}

function rowTitle(row: BillArchiveRow): string { return [row.customerName ?? "Cliente non letto", `POD ${row.pod ?? NOT_AVAILABLE}`, periodText(row), ...(row.invoiceNumber ? [`Fattura ${row.invoiceNumber}`] : [])].join(" · "); }

function Row({ row, monthFilter, canDelete, selected, busy, onToggle, onDeleteOne }: { readonly row: BillArchiveRow; readonly monthFilter: string; readonly canDelete: boolean; readonly selected: boolean; readonly busy: boolean; readonly onToggle: () => void; readonly onDeleteOne: () => void }): ReactNode {
  const elsewhere = monthFilter && row.archiveMonth !== monthFilter;
  return <li className="bill-month-row">
    {canDelete ? <input type="checkbox" checked={selected} onChange={onToggle} disabled={busy} aria-label={`Seleziona ${rowTitle(row)}`} /> : null}
    <div className="bill-month-main">
      <strong>{row.customerName ?? "Cliente non letto"}</strong>
      <dl className="bill-month-facts">
        <div><dt>POD</dt><dd>{row.pod ?? NOT_AVAILABLE}</dd></div>
        <div><dt>Periodo dei consumi</dt><dd>{periodText(row)}</dd></div>
        <div><dt>Mese di archivio</dt><dd>{row.archiveMonth ? monthLabel(row.archiveMonth) : "Non determinabile"}{isMultiMonth(row) ? <small className="muted"> · pluri-mensile ({row.competenceMonths.map(monthLabel).join(", ")})</small> : null}</dd></div>
        <div><dt>Totale bolletta</dt><dd>{totalText(row.totalAmount)}</dd></div>
        <div><dt>Numero fattura</dt><dd>{row.invoiceNumber ?? NOT_AVAILABLE}</dd></div>
        <div><dt>Lettura</dt><dd><span className={`bill-archive-state bill-archive-${row.readingState.toLowerCase()}`}>{readingLabel(row.readingState)}</span></dd></div>
        <div><dt>Documenti</dt><dd>{documentsText(row.documentKind)}</dd></div>
        <div><dt>Simulazione</dt><dd className={row.simulable ? undefined : "muted"}>{simulableText(row.simulable)}</dd></div>
        <div><dt>Proposte</dt><dd className={row.linkedProposals ? "warning-text" : undefined}>{proposalsText(row.linkedProposals)}</dd></div>
      </dl>
      {elsewhere ? <small className="muted">Archiviata in {monthLabel(row.archiveMonth)}: compare qui perché il periodo comprende anche {monthLabel(monthFilter)}.</small> : null}
    </div>
    {canDelete ? <button className="button compact danger" type="button" onClick={onDeleteOne} disabled={busy}>Elimina</button> : null}
  </li>;
}

// Tony (24/11/2026, "UNIFICAZIONE MODULI"): the archive also lives inside «Clienti e Forniture»; there the search typed at
// the top of the module (searchQuery) is used and the archive's own search field is not shown twice.
// alsoMatching: bills the module found by codice fiscale / partita IVA (see billIdsForTaxSearch); the archive rows do not
// carry those identifiers, so they are shown when the typed text matches them or the row's own name, POD or invoice.
export default function BillArchivePanel({ readonly, searchQuery, embedded = false, alsoMatching }: { readonly readonly: boolean; readonly searchQuery?: string; readonly embedded?: boolean; readonly alsoMatching?: ReadonlySet<string> }): ReactNode {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [ownQuery, setQuery] = useState("");
  const query = searchQuery ?? ownQuery;
  const [month, setMonth] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [documents, setDocuments] = useState<BillArchiveDocumentFilter>("ALL");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [report, setReport] = useState<{ readonly results: readonly BillBulkResult[]; readonly titles: Readonly<Record<string, string>> } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try { const body = await requestJson<{ readonly rows: readonly BillArchiveRow[]; readonly canDelete: boolean }>("/api/bills/archive"); setLoad({ status: "ready", rows: body.rows, canDelete: body.canDelete === true }); }
    catch (cause) { setLoad({ status: "error", message: loadMessage(cause) }); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const rows = useMemo(() => load.status === "ready" ? load.rows : [], [load]);
  const canDelete = load.status === "ready" && load.canDelete && !readonly;
  const shown = useMemo(() => {
    const filters = { month: month || null, periodFrom: periodFrom || null, periodTo: periodTo || null, documents };
    const byText = filterArchiveRows(rows, { ...filters, query });
    if (!query.trim() || !alsoMatching?.size) return byText;
    const found = new Set([...byText, ...filterArchiveRows(rows.filter((row) => alsoMatching.has(row.id)), { ...filters, query: "" })].map((row) => row.id));
    return rows.filter((row) => found.has(row.id));
  }, [rows, query, month, periodFrom, periodTo, documents, alsoMatching]);
  const groups = useMemo(() => groupArchiveRows(shown, month || null), [shown, month]);
  const months = useMemo(() => archiveMonths(rows), [rows]);
  // A selection only ever holds bills of the list just loaded.
  useEffect(() => { const ids = new Set(rows.map((row) => row.id)); setSelected((current) => { const next = new Set([...current].filter((id) => ids.has(id))); return next.size === current.size ? current : next; }); }, [rows]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const busy = deleting || load.status !== "ready";

  const toggle = (id: string) => { setConfirming(false); setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const toggleMany = (ids: readonly string[], select: boolean) => { setConfirming(false); setSelected((current) => { const next = new Set(current); for (const id of ids) { if (select) next.add(id); else next.delete(id); } return next; }); };
  const askOne = (id: string) => { setReport(null); setDeleteError(null); setSelected(new Set([id])); setConfirming(true); };

  const confirmDelete = async () => {
    if (!canDelete || deleting || !confirming || !selectedRows.length || selectedRows.length > BULK_DELETE_LIMIT) return;
    setDeleting(true); setDeleteError(null);
    const titles = Object.fromEntries(selectedRows.map((row) => [row.id, rowTitle(row)]));
    try {
      const body = await requestJson<{ readonly results: readonly BillBulkResult[] }>("/api/bills/archive/delete", { method: "POST", body: JSON.stringify({ ids: selectedRows.map((row) => row.id), confirmed: true }) });
      setReport({ results: body.results, titles });
      setSelected(new Set(body.results.filter((item) => item.outcome !== "DELETED").map((item) => item.id)));
      await reload();
    } catch (cause) {
      setDeleteError(cause instanceof UiApiError ? cause.message : "Eliminazione non riuscita: nessun esito ricevuto. Ricarica l'archivio per vedere cosa è rimasto.");
    } finally { setConfirming(false); setDeleting(false); }
  };

  return <div className="content-stack bill-month-archive">
    {embedded ? <div className="card-heading"><p className="muted">Le bollette dell&apos;azienda per mese di fine del periodo dei consumi. Una bolletta su più mesi è archiviata una sola volta e si ritrova anche negli altri mesi che copre.</p><button className="button compact secondary" type="button" onClick={() => void reload()} disabled={deleting}>Aggiorna</button></div>
      : <div className="section-header"><div><p className="eyebrow">ARCHIVIO</p><h2>Archivio bollette</h2><p className="section-detail">Le bollette dell&apos;azienda per mese di fine del periodo dei consumi. Una bolletta su più mesi è archiviata una sola volta e si ritrova anche negli altri mesi che copre.</p></div><button className="button secondary" type="button" onClick={() => void reload()} disabled={deleting}>Aggiorna</button></div>}
    <section className="ui-card bill-month-filters" aria-label="Ricerca e filtri">
      {searchQuery === undefined ? <label className="form-field"><span className="form-label">Cerca</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, POD o numero fattura" aria-label="Cerca per cliente, POD o numero fattura" /></label> : null}
      <label className="form-field"><span className="form-label">Mese</span><select value={month} onChange={(event) => { setConfirming(false); setMonth(event.target.value); }}><option value="">Tutti i mesi</option>{months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}</select></label>
      <label className="form-field"><span className="form-label">Periodo dal</span><input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} /></label>
      <label className="form-field"><span className="form-label">al</span><input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} /></label>
      <label className="form-field"><span className="form-label">Documenti</span><select value={documents} onChange={(event) => setDocuments(event.target.value as BillArchiveDocumentFilter)}><option value="ALL">Tutti</option>{(Object.keys(DOCUMENT_KIND_LABEL) as (keyof typeof DOCUMENT_KIND_LABEL)[]).map((kind) => <option key={kind} value={kind}>{DOCUMENT_KIND_LABEL[kind]}</option>)}</select></label>
    </section>
    {canDelete && selectedRows.length ? <section className="ui-card bill-archive-delete" role="group" aria-label="Eliminazione delle bollette selezionate">
      {confirming ? <>
        <p className="warning-text"><strong>{bulkConfirmText(selectedRows)}</strong></p>
        {selectedRows.length > BULK_DELETE_LIMIT ? <p className="warning-text">Puoi eliminare al massimo {BULK_DELETE_LIMIT} bollette per volta: riduci la selezione.</p> : null}
        <ul>{selectedRows.map((row) => <li key={row.id} className={row.linkedProposals ? "warning-text" : undefined}>{rowTitle(row)}{row.linkedProposals ? ` · bloccata: ${proposalsText(row.linkedProposals)}` : ""}</li>)}</ul>
        <div className="button-row"><button className="button compact danger" type="button" onClick={() => void confirmDelete()} disabled={deleting || selectedRows.length > BULK_DELETE_LIMIT}>{deleting ? "Eliminazione…" : "Conferma eliminazione"}</button><button className="button compact secondary" type="button" onClick={() => setConfirming(false)} disabled={deleting}>Annulla</button></div>
      </> : <div className="button-row"><span>{selectedRows.length === 1 ? "1 bolletta selezionata" : `${selectedRows.length} bollette selezionate`}</span><button className="button compact danger" type="button" onClick={() => { setReport(null); setDeleteError(null); setConfirming(true); }} disabled={busy}>Elimina selezionate</button><button className="button compact secondary" type="button" onClick={() => setSelected(new Set())} disabled={deleting}>Deseleziona</button></div>}
    </section> : null}
    {deleteError ? <p className="warning-text" role="alert">{deleteError}</p> : null}
    {report ? <section className="ui-card bill-archive-report" role="status"><p><strong>{bulkSummaryText(report.results)}</strong></p><ul>{report.results.map((item) => <li key={item.id} className={item.outcome === "DELETED" ? "inline-success" : "warning-text"}>{report.titles[item.id] ?? item.id}: {bulkOutcomeText(item)}</li>)}</ul></section> : null}
    {load.status === "loading" ? <p className="muted" role="status">Caricamento dell&apos;archivio…</p>
      : load.status === "error" ? <div className="warning-text" role="alert"><p>{load.message}</p><button className="button compact secondary" type="button" onClick={() => void reload()}>Riprova</button></div>
      : !rows.length ? <p className="muted">Nessuna bolletta in archivio.</p>
      : !shown.length ? <p className="muted">Nessuna bolletta corrisponde alla ricerca e ai filtri.</p>
      : groups.map((group) => {
        const ids = group.rows.map((row) => row.id);
        const all = ids.every((id) => selected.has(id));
        return <section key={group.month ?? "none"} className="ui-card bill-month-group" aria-label={group.label}>
          <h3>{group.label} <small className="muted">{group.rows.length === 1 ? "1 bolletta" : `${group.rows.length} bollette`}</small></h3>
          {canDelete ? <label className="bill-archive-select-all"><input type="checkbox" checked={all} onChange={(event) => toggleMany(ids, event.target.checked)} disabled={busy} /> Seleziona le bollette di {group.month ? group.label : "questo gruppo"} ({ids.length})</label> : null}
          <ul className="bill-month-list">{group.rows.map((row) => <Row key={row.id} row={row} monthFilter={month} canDelete={canDelete} selected={selected.has(row.id)} busy={busy} onToggle={() => toggle(row.id)} onDeleteOne={() => askOne(row.id)} />)}</ul>
        </section>;
      })}
  </div>;
}
