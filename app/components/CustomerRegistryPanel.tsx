"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { requestJson, UiApiError } from "../lib/ui/client";
import BillArchivePanel from "./BillArchivePanel";
import { CUSTOMER_CATEGORY_LABEL, CUSTOMER_KIND_LABEL, billIdsForTaxSearch, searchBillSummaries, searchCustomerViews, type BillReadSummary, type CustomerView, type RegistryView, type SupplyRecord } from "../lib/customers/model";

// Tony (24/11/2026, "FASE 2: ANAGRAFICA CLIENTI E POD"): persistent customer registry. The server decides everything (company,
// commercial perimeter, who may change what, duplicates, POD read on the bill); this screen only asks and shows the outcome.

type Load = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly view: RegistryView };
type Form =
  | { readonly kind: "customer"; readonly customer: CustomerView["customer"] | null }
  | { readonly kind: "supply"; readonly customerId: string; readonly supply: SupplyRecord | null }
  | { readonly kind: "holder"; readonly supply: SupplyRecord };
const NOT_READ = "Non indicato";

function message(cause: unknown): string { return cause instanceof UiApiError ? cause.message : "Operazione non riuscita: riprova."; }
function italianDate(iso: string | null | undefined): string { const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null; return match ? `${match[3]}/${match[2]}/${match[1]}` : NOT_READ; }
const value = (data: FormData, key: string) => { const raw = data.get(key); return typeof raw === "string" && raw.trim() ? raw.trim() : null; };

function CustomerForm({ customer, busy, onSubmit, onCancel }: { readonly customer: CustomerView["customer"] | null; readonly busy: boolean; readonly onSubmit: (body: Record<string, unknown>) => void; readonly onCancel: () => void }): ReactNode {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({ ...(customer ? { action: "UPDATE_CUSTOMER", customerId: customer.customerId } : { action: "CREATE_CUSTOMER" }), kind: value(data, "kind"), name: value(data, "name"), taxCode: value(data, "taxCode"), vatNumber: value(data, "vatNumber"), category: value(data, "category"), contacts: { email: value(data, "email"), phone: value(data, "phone"), postalAddress: value(data, "postalAddress") }, reason: value(data, "reason") });
  }
  return <form className="ui-card bill-month-filters" onSubmit={submit} aria-label={customer ? "Modifica cliente" : "Nuovo cliente"}>
    <label className="form-field"><span className="form-label">Tipo</span><select name="kind" defaultValue={customer?.kind ?? "PERSON"}>{Object.entries(CUSTOMER_KIND_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="form-field"><span className="form-label">Ragione sociale o nominativo</span><input name="name" required defaultValue={customer?.name ?? ""} /></label>
    <label className="form-field"><span className="form-label">Codice fiscale</span><input name="taxCode" defaultValue={customer?.taxCode ?? ""} /></label>
    <label className="form-field"><span className="form-label">Partita IVA</span><input name="vatNumber" defaultValue={customer?.vatNumber ?? ""} /></label>
    <label className="form-field"><span className="form-label">Tipologia</span><select name="category" defaultValue={customer?.category ?? ""}><option value="">Non indicata</option>{Object.entries(CUSTOMER_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="form-field"><span className="form-label">Email</span><input name="email" type="email" defaultValue={customer?.contacts.email ?? ""} /></label>
    <label className="form-field"><span className="form-label">Telefono</span><input name="phone" defaultValue={customer?.contacts.phone ?? ""} /></label>
    <label className="form-field"><span className="form-label">Indirizzo di corrispondenza</span><input name="postalAddress" defaultValue={customer?.contacts.postalAddress ?? ""} /></label>
    {customer ? <label className="form-field"><span className="form-label">Motivo della modifica</span><input name="reason" /></label> : null}
    <div className="button-row"><button className="button compact" type="submit" disabled={busy}>{customer ? "Salva modifiche" : "Crea cliente"}</button><button className="button compact secondary" type="button" onClick={onCancel} disabled={busy}>Annulla</button></div>
  </form>;
}

function SupplyForm({ customerId, supply, busy, onSubmit, onCancel }: { readonly customerId: string; readonly supply: SupplyRecord | null; readonly busy: boolean; readonly onSubmit: (body: Record<string, unknown>) => void; readonly onCancel: () => void }): ReactNode {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const technical = { voltageLevel: value(data, "voltageLevel"), powerKw: value(data, "powerKw"), annualConsumption: value(data, "annualConsumption"), distributor: value(data, "distributor") };
    onSubmit(supply ? { action: "UPDATE_SUPPLY", supplyId: supply.supplyId, address: value(data, "address"), technical, reason: value(data, "reason") } : { action: "ADD_SUPPLY", customerId, vector: value(data, "vector"), reference: value(data, "reference"), address: value(data, "address"), technical, from: value(data, "from") });
  }
  return <form className="ui-card bill-month-filters" onSubmit={submit} aria-label={supply ? "Modifica POD" : "Aggiungi POD"}>
    {supply ? null : <><label className="form-field"><span className="form-label">Fornitura</span><select name="vector" defaultValue="EE"><option value="EE">Energia elettrica (POD)</option><option value="GAS">Gas (PDR)</option></select></label>
      <label className="form-field"><span className="form-label">POD o PDR</span><input name="reference" required /></label>
      <label className="form-field"><span className="form-label">Intestatario dal</span><input name="from" type="date" /></label></>}
    <label className="form-field"><span className="form-label">Indirizzo di fornitura</span><input name="address" defaultValue={supply?.address ?? ""} /></label>
    <label className="form-field"><span className="form-label">Tensione</span><input name="voltageLevel" defaultValue={supply?.technical.voltageLevel ?? ""} /></label>
    <label className="form-field"><span className="form-label">Potenza (kW)</span><input name="powerKw" inputMode="decimal" defaultValue={supply?.technical.powerKw ?? ""} /></label>
    <label className="form-field"><span className="form-label">Consumo annuo</span><input name="annualConsumption" inputMode="decimal" defaultValue={supply?.technical.annualConsumption ?? ""} /></label>
    <label className="form-field"><span className="form-label">Distributore</span><input name="distributor" defaultValue={supply?.technical.distributor ?? ""} /></label>
    {supply ? <label className="form-field"><span className="form-label">Motivo della modifica</span><input name="reason" /></label> : null}
    <div className="button-row"><button className="button compact" type="submit" disabled={busy}>{supply ? "Salva POD" : "Aggiungi POD"}</button><button className="button compact secondary" type="button" onClick={onCancel} disabled={busy}>Annulla</button></div>
  </form>;
}

function HolderForm({ supply, customers, busy, onSubmit, onCancel }: { readonly supply: SupplyRecord; readonly customers: readonly CustomerView[]; readonly busy: boolean; readonly onSubmit: (body: Record<string, unknown>) => void; readonly onCancel: () => void }): ReactNode {
  const current = supply.holders.find((holder) => holder.to === null)?.customerId;
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit({ action: "CHANGE_HOLDER", supplyId: supply.supplyId, customerId: value(data, "customerId"), from: value(data, "from"), reason: value(data, "reason") }); }
  return <form className="ui-card bill-month-filters" onSubmit={submit} aria-label="Cambio di intestatario">
    <p className="muted">Cambio di intestatario di {supply.reference}: l&apos;intestatario attuale viene chiuso alla data indicata e resta nella storia con le sue bollette.</p>
    <label className="form-field"><span className="form-label">Nuovo intestatario</span><select name="customerId" required defaultValue="">{[<option key="" value="" disabled>Scegli il cliente</option>, ...customers.filter((view) => view.customer.customerId !== current).map((view) => <option key={view.customer.customerId} value={view.customer.customerId}>{view.customer.name}{view.customer.taxCode || view.customer.vatNumber ? ` · ${view.customer.taxCode ?? view.customer.vatNumber}` : ""}</option>)]}</select></label>
    <label className="form-field"><span className="form-label">Dal</span><input name="from" type="date" required /></label>
    <label className="form-field"><span className="form-label">Motivo</span><input name="reason" required placeholder="Voltura, subentro…" /></label>
    <div className="button-row"><button className="button compact" type="submit" disabled={busy}>Registra cambio</button><button className="button compact secondary" type="button" onClick={onCancel} disabled={busy}>Annulla</button></div>
  </form>;
}

function billLine(bill: BillReadSummary | undefined, billId: string): string {
  if (!bill) return "Bolletta non visibile";
  return [bill.supplyReference ? `${bill.vector === "GAS" ? "PDR" : "POD"} ${bill.supplyReference}` : null, bill.periodStart || bill.periodEnd ? `${italianDate(bill.periodStart)} - ${italianDate(bill.periodEnd)}` : `bolletta ${billId.slice(0, 8)}`, bill.supplier].filter(Boolean).join(" · ");
}

// Tony (24/11/2026, "UNIFICAZIONE MODULI"): one card per customer. Closed it shows who the customer is and its supplies;
// opened it adds anagrafica, punti di fornitura, bollette, simulazioni e proposte, with the actions the server allows.
function Customer({ view, names, bills, busy, onForm, onShowBills }: { readonly view: CustomerView; readonly names: ReadonlyMap<string, string>; readonly bills: ReadonlyMap<string, BillReadSummary>; readonly busy: boolean; readonly onForm: (form: Form) => void; readonly onShowBills: (reference: string) => void }): ReactNode {
  const { customer } = view;
  const references = view.supplies.filter((supply) => supply.current).map((supply) => supply.reference);
  return <details className="ui-card bill-month-group customer-card">
    <summary><strong>{customer.name}</strong> <span className="muted">{[customer.taxCode ?? customer.vatNumber, references.length ? references.join(", ") : "nessun POD/PDR", `${view.billIds.length === 1 ? "1 bolletta" : `${view.billIds.length} bollette`}`].filter(Boolean).join(" · ")}</span></summary>
    <h4>Anagrafica</h4>
    <dl className="bill-month-facts">
      <div><dt>Tipo</dt><dd>{CUSTOMER_KIND_LABEL[customer.kind]}{customer.category ? ` · ${CUSTOMER_CATEGORY_LABEL[customer.category]}` : ""}</dd></div>
      <div><dt>Codice fiscale</dt><dd>{customer.taxCode ?? NOT_READ}</dd></div>
      <div><dt>Partita IVA</dt><dd>{customer.vatNumber ?? NOT_READ}</dd></div>
      <div><dt>Recapiti</dt><dd>{[customer.contacts.email, customer.contacts.phone, customer.contacts.postalAddress].filter(Boolean).join(" · ") || NOT_READ}</dd></div>
    </dl>
    {view.canEdit ? <div className="button-row"><button className="button compact secondary" type="button" disabled={busy} onClick={() => onForm({ kind: "customer", customer })}>Modifica cliente</button><button className="button compact secondary" type="button" disabled={busy} onClick={() => onForm({ kind: "supply", customerId: customer.customerId, supply: null })}>Aggiungi POD/PDR</button></div> : null}
    <h4>Punti di fornitura</h4>
    {view.supplies.length ? <ul className="bill-month-list">{view.supplies.map((supply) => <li key={supply.supplyId} className="bill-month-row"><div className="bill-month-main">
      <strong>{supply.vector === "GAS" ? "PDR" : "POD"} {supply.reference}{supply.current ? "" : " · intestatario precedente"}</strong>
      <dl className="bill-month-facts">
        <div><dt>Indirizzo di fornitura</dt><dd>{supply.address ?? NOT_READ}</dd></div>
        <div><dt>Dati tecnici</dt><dd>{[supply.technical.voltageLevel, supply.technical.powerKw !== null ? `${supply.technical.powerKw.toLocaleString("it-IT")} kW` : null, supply.technical.annualConsumption !== null ? `${supply.technical.annualConsumption.toLocaleString("it-IT")} annui` : null, supply.technical.distributor].filter(Boolean).join(" · ") || NOT_READ}</dd></div>
        <div><dt>Intestatari</dt><dd>{supply.holders.map((holder) => `${names.get(holder.customerId) ?? "cliente non visibile"} (${holder.from ? `dal ${italianDate(holder.from)}` : "dall'inizio"}${holder.to ? ` al ${italianDate(holder.to)}` : ", attuale"})`).join("; ")}</dd></div>
      </dl>
    </div><div className="button-row"><button className="button compact secondary" type="button" onClick={() => onShowBills(supply.reference)}>Bollette in archivio</button>{view.canEdit && supply.current ? <><button className="button compact secondary" type="button" disabled={busy} onClick={() => onForm({ kind: "supply", customerId: customer.customerId, supply })}>Modifica</button><button className="button compact secondary" type="button" disabled={busy} onClick={() => onForm({ kind: "holder", supply })}>Cambio intestatario</button></> : null}</div></li>)}</ul> : <p className="muted">Nessun punto di fornitura registrato.</p>}
    <h4>Bollette collegate ({view.billIds.length})</h4>
    {view.billIds.length ? <ul>{view.billIds.map((billId) => <li key={billId}>{billLine(bills.get(billId), billId)}</li>)}</ul> : <p className="muted">Nessuna bolletta collegata.</p>}
    <h4>Simulazioni ({view.simulations.length})</h4>
    {view.simulations.length ? <ul>{view.simulations.map((item) => <li key={item.comparisonId}>{item.calculatedAt ? `Calcolata il ${italianDate(item.calculatedAt)}` : "Data non indicata"} · {billLine(bills.get(item.billId), item.billId)}</li>)}</ul> : <p className="muted">Nessuna simulazione sulle bollette collegate.</p>}
    <h4>Proposte ({view.proposals.length})</h4>
    {view.proposals.length ? <ul>{view.proposals.map((item) => <li key={item.proposalId}>Proposta {item.proposalId.slice(0, 8)} · {billLine(bills.get(item.billId), item.billId)}</li>)}</ul> : <p className="muted">Nessuna proposta: le proposte si consultano e si inviano dalla sezione «Proposte».</p>}
    {customer.history.length > 1 ? <details><summary>Storia delle modifiche ({customer.history.length})</summary><ul>{customer.history.map((change, index) => <li key={index}>{italianDate(change.at)} · {change.action === "CREATED" ? "creato" : `modificati: ${Object.keys(change.changes).join(", ")}`}{change.reason ? ` · ${change.reason}` : ""}</li>)}</ul></details> : null}
  </details>;
}

function BillToLink({ bill, view, busy, onAction }: { readonly bill: BillReadSummary; readonly view: RegistryView; readonly busy: boolean; readonly onAction: (body: Record<string, unknown>) => void }): ReactNode {
  const [target, setTarget] = useState("");
  const options = view.customers.flatMap((customer) => customer.supplies.filter((supply) => !bill.supplyReference || supply.reference === bill.supplyReference).map((supply) => ({ key: `${customer.customer.customerId}|${supply.supplyId}`, label: `${customer.customer.name} · ${supply.reference}${bill.suggestedCustomerIds.includes(customer.customer.customerId) ? " (suggerito)" : ""}` })));
  return <li className="bill-month-row"><div className="bill-month-main">
    <strong>{bill.customerName ?? "Intestatario non letto"}</strong>
    <dl className="bill-month-facts">
      <div><dt>Codice fiscale / P. IVA letto</dt><dd>{bill.taxIdentifier ?? "Non letto"}</dd></div>
      <div><dt>POD/PDR letto</dt><dd>{bill.supplyReference ?? "Non letto"}</dd></div>
      <div><dt>Indirizzo letto</dt><dd>{bill.supplyAddress ?? "Non letto"}</dd></div>
      <div><dt>Periodo</dt><dd>{bill.periodStart || bill.periodEnd ? `${italianDate(bill.periodStart)} - ${italianDate(bill.periodEnd)}` : "Non letto"}</dd></div>
    </dl>
  </div><div className="button-row">
    {options.length ? <><select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Cliente e POD a cui collegare"><option value="">Collega a…</option>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><button className="button compact" type="button" disabled={busy || !target} onClick={() => { const [customerId, supplyId] = target.split("|"); onAction({ action: "LINK_BILL", billId: bill.billId, customerId, supplyId }); }}>Collega</button></> : null}
    {bill.customerName && bill.supplyReference && !bill.suggestedCustomerIds.length ? <button className="button compact secondary" type="button" disabled={busy} onClick={() => onAction({ action: "CREATE_FROM_BILL", billId: bill.billId })}>Crea cliente dai dati letti</button> : null}
  </div></li>;
}

type Tab = "customers" | "toLink" | "bills";
const TABS: readonly { readonly id: Tab; readonly label: string }[] = [{ id: "customers", label: "Clienti" }, { id: "toLink", label: "Bollette da collegare" }, { id: "bills", label: "Archivio bollette" }];

/**
 * Tony (24/11/2026, "UNIFICAZIONE MODULI"): «Clienti e Forniture» joins «Archivio bollette» and «Clienti e POD» in one
 * module: one search (cliente, codice fiscale, partita IVA, POD/PDR) over three views of the same records. Nothing is copied:
 * customers and links come from /api/customers, the archive from /api/bills/archive, each server route with its own
 * company and branch checks. Uploading and reading a bill stay in «Nuova simulazione» (onUploadBill opens it).
 */
export default function CustomerRegistryPanel({ readonly = false, initialTab = "customers", onUploadBill }: { readonly readonly?: boolean; readonly initialTab?: Tab; readonly onUploadBill?: () => void }): ReactNode {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const reload = useCallback(() => { setLoad({ status: "loading" }); setAttempt((value) => value + 1); }, []);
  useEffect(() => {
    let current = true;
    requestJson<RegistryView>("/api/customers")
      .then((view) => { if (current) setLoad({ status: "ready", view }); })
      .catch((cause: unknown) => { if (current) setLoad({ status: "error", message: message(cause) }); });
    return () => { current = false; };
  }, [attempt]);
  const run = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setNotice(null);
    try { await requestJson("/api/customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); setForm(null); setNotice({ ok: true, text: "Salvato." }); reload(); }
    catch (cause) { setNotice({ ok: false, text: message(cause) }); }
    finally { setBusy(false); }
  }, [reload]);
  const view = load.status === "ready" ? load.view : null;
  const shown = useMemo(() => view ? searchCustomerViews(view.customers, query) : [], [view, query]);
  const names = useMemo(() => new Map((view?.customers ?? []).map((item) => [item.customer.customerId, item.customer.name])), [view]);
  const bills = useMemo(() => new Map((view?.bills ?? []).map((bill) => [bill.billId, bill])), [view]);
  const toLinkAll = useMemo(() => view ? view.bills.filter((bill) => !bill.linked) : [], [view]);
  const toLink = useMemo(() => searchBillSummaries(toLinkAll, query), [toLinkAll, query]);
  const taxMatches = useMemo(() => view ? billIdsForTaxSearch(view, query) : undefined, [view, query]);
  const showBills = (reference: string) => { setQuery(reference); setTab("bills"); };
  return <div className="content-stack bill-month-archive">
    <div className="section-header"><div><p className="eyebrow">CLIENTI, FORNITURE E BOLLETTE</p><h2>Clienti e Forniture</h2><p className="section-detail">I clienti dell&apos;azienda con i loro punti di fornitura, le bollette, le simulazioni e le proposte. I dati letti nelle bollette sono solo suggerimenti: niente viene unito o modificato senza conferma.</p></div><div className="button-row">{onUploadBill ? <button className="button" type="button" disabled={readonly} onClick={onUploadBill}>Carica bolletta</button> : null}{view?.canCreate ? <button className="button secondary" type="button" disabled={busy} onClick={() => { setTab("customers"); setForm({ kind: "customer", customer: null }); }}>Nuovo cliente</button> : null}<button className="button secondary" type="button" onClick={reload}>Aggiorna</button></div></div>
    <section className="ui-card bill-month-filters" aria-label="Ricerca"><label className="form-field"><span className="form-label">Cerca</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, codice fiscale, partita IVA o POD/PDR" aria-label="Cerca per cliente, codice fiscale, partita IVA o POD/PDR" /></label></section>
    <div className="button-row" role="tablist" aria-label="Viste">{TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "button compact" : "button compact secondary"} onClick={() => setTab(item.id)}>{item.label}{item.id === "customers" && view ? ` (${shown.length})` : item.id === "toLink" && view ? ` (${toLink.length})` : ""}</button>)}</div>
    {notice ? <p className={notice.ok ? "inline-success" : "warning-text"} role={notice.ok ? "status" : "alert"}>{notice.text}</p> : null}
    {form?.kind === "customer" ? <CustomerForm customer={form.customer} busy={busy} onSubmit={(body) => void run(body)} onCancel={() => setForm(null)} /> : null}
    {form?.kind === "supply" ? <SupplyForm customerId={form.customerId} supply={form.supply} busy={busy} onSubmit={(body) => void run(body)} onCancel={() => setForm(null)} /> : null}
    {form?.kind === "holder" && view ? <HolderForm supply={form.supply} customers={view.customers} busy={busy} onSubmit={(body) => void run(body)} onCancel={() => setForm(null)} /> : null}
    {tab === "bills" ? <BillArchivePanel readonly={readonly} searchQuery={query} embedded alsoMatching={taxMatches} />
      : load.status === "loading" ? <p className="muted" role="status">Caricamento dei clienti…</p>
      : load.status === "error" ? <div className="warning-text" role="alert"><p>{load.message}</p><button className="button compact secondary" type="button" onClick={reload}>Riprova</button></div>
      : tab === "customers" ? <>
        {load.view.anomalies.length ? <details className="ui-card" aria-label="Anomalie"><summary className="warning-text">Da verificare ({load.view.anomalies.length})</summary><ul>{load.view.anomalies.map((anomaly, index) => <li key={`${anomaly.code}-${index}`} className="warning-text">{anomaly.message}</li>)}</ul></details> : null}
        {!load.view.customers.length ? <p className="muted">Nessun cliente registrato: crealo a mano o dai dati letti in una bolletta, nella vista «Bollette da collegare».</p> : !shown.length ? <p className="muted">Nessun cliente corrisponde alla ricerca.</p> : shown.map((item) => <Customer key={item.customer.customerId} view={item} names={names} bills={bills} busy={busy} onForm={setForm} onShowBills={showBills} />)}
      </>
      : !toLinkAll.length ? <p className="muted">Tutte le bollette visibili sono collegate a un cliente.</p>
      : !toLink.length ? <p className="muted">Nessuna bolletta da collegare corrisponde alla ricerca.</p>
      : <section className="ui-card bill-month-group" aria-label="Bollette da collegare"><p className="muted">Bollette lette ma non ancora collegate a un cliente e a un punto di fornitura. Il collegamento non modifica la bolletta.</p><ul className="bill-month-list">{toLink.map((bill) => <BillToLink key={bill.billId} bill={bill} view={load.view} busy={busy} onAction={(body) => void run(body)} />)}</ul></section>}
  </div>;
}
