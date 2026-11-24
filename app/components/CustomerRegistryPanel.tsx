"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { requestJson, UiApiError } from "../lib/ui/client";
import { searchCustomers, type CustomerEntry, type CustomerRegistry } from "../lib/ui/customer-registry";

// Tony (24/11/2026, "COMPLETAMENTO APPLICAZIONE"): anagrafica cliente e POD, built by the server from the bills already read
// (company and commercial branch checked there). Read only: what is not read on the bills is shown as not available.

type Load = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly registry: CustomerRegistry };
const NOT_READ = "Non letto";
const TYPE_LABEL = { RESIDENTIAL: "Domestico", NON_RESIDENTIAL: "Altri usi" } as const;
const IDENTIFICATION_LABEL = { TAX_ID: "Identificato dal codice fiscale o partita IVA", SUPPLY_ONLY: "Cliente non identificato", BILL_ONLY: "Cliente non identificato" } as const;

function loadMessage(cause: unknown): string {
  if (cause instanceof UiApiError && cause.code === "CUSTOMER_REGISTRY_TOO_LARGE") return cause.message;
  if (cause instanceof UiApiError && /^(AUTHENTICATION_|AUTHORIZATION_DENIED|ROLE_INSUFFICIENT|TENANT_MISMATCH)/.test(cause.code)) return cause.message;
  return "Anagrafica clienti non disponibile: riprova.";
}

function italianDate(iso: string | null): string { const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null; return match ? `${match[3]}/${match[2]}/${match[1]}` : NOT_READ; }

function Customer({ customer }: { readonly customer: CustomerEntry }): ReactNode {
  return <section className="ui-card bill-month-group" aria-label={customer.names[0] ?? "Cliente non letto"}>
    <h3>{customer.names[0] ?? "Intestatario non letto"}</h3>
    <dl className="bill-month-facts">
      <div><dt>Codice fiscale o partita IVA</dt><dd>{customer.taxIdentifier ?? NOT_READ}</dd></div>
      <div><dt>Identificazione</dt><dd>{IDENTIFICATION_LABEL[customer.identification]}</dd></div>
      <div><dt>Tipo cliente</dt><dd>{customer.customerTypes.length ? customer.customerTypes.map((type) => TYPE_LABEL[type]).join(", ") : NOT_READ}</dd></div>
      <div><dt>Bollette</dt><dd>{customer.billCount} ({customer.approvedBillCount} approvate)</dd></div>
      {customer.names.length > 1 ? <div><dt>Altri nomi letti</dt><dd>{customer.names.slice(1).join("; ")}</dd></div> : null}
    </dl>
    <ul className="bill-month-list">
      {customer.supplies.map((supply) => <li key={supply.reference ?? supply.billIds[0]} className="bill-month-row"><div className="bill-month-main">
        <strong>{supply.vector === "GAS" ? "PDR" : "POD"} {supply.reference ?? NOT_READ}</strong>
        <dl className="bill-month-facts">
          <div><dt>Indirizzo di fornitura</dt><dd>{supply.addresses.length ? supply.addresses.join(" · ") : NOT_READ}</dd></div>
          <div><dt>Fornitore attuale</dt><dd>{supply.suppliers.length ? supply.suppliers.join(", ") : NOT_READ}</dd></div>
          <div><dt>Ultimo periodo letto</dt><dd>fino al {italianDate(supply.lastPeriodEnd)}</dd></div>
          <div><dt>Bollette</dt><dd>{supply.billIds.length}</dd></div>
        </dl>
      </div></li>)}
    </ul>
    {customer.notes.length ? <ul>{customer.notes.map((note) => <li key={note} className="warning-text">{note}</li>)}</ul> : null}
  </section>;
}

export default function CustomerRegistryPanel(): ReactNode {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => { setLoad({ status: "loading" }); setAttempt((value) => value + 1); }, []);
  useEffect(() => {
    let current = true;
    requestJson<CustomerRegistry>("/api/customers")
      .then((registry) => { if (current) setLoad({ status: "ready", registry }); })
      .catch((cause: unknown) => { if (current) setLoad({ status: "error", message: loadMessage(cause) }); });
    return () => { current = false; };
  }, [attempt]);
  const shown = useMemo(() => load.status === "ready" ? searchCustomers(load.registry.customers, query) : [], [load, query]);
  return <div className="content-stack bill-month-archive">
    <div className="section-header"><div><p className="eyebrow">ANAGRAFICA</p><h2>Clienti e POD</h2><p className="section-detail">Clienti e forniture come letti nelle bollette dell&apos;azienda: intestatario, codice fiscale o partita IVA, POD/PDR e indirizzo di fornitura. Si aggiorna da solo quando si caricano o si eliminano bollette.</p></div><button className="button secondary" type="button" onClick={reload}>Aggiorna</button></div>
    <section className="ui-card bill-month-filters" aria-label="Ricerca"><label className="form-field"><span className="form-label">Cerca</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, codice fiscale, partita IVA, POD o indirizzo" aria-label="Cerca per nome, codice fiscale, partita IVA, POD o indirizzo" /></label></section>
    {load.status === "loading" ? <p className="muted" role="status">Caricamento dell&apos;anagrafica…</p>
      : load.status === "error" ? <div className="warning-text" role="alert"><p>{load.message}</p><button className="button compact secondary" type="button" onClick={reload}>Riprova</button></div>
      : !load.registry.customers.length ? <p className="muted">Nessun cliente: l&apos;anagrafica si forma dalle bollette caricate.</p>
      : !shown.length ? <p className="muted">Nessun cliente corrisponde alla ricerca.</p>
      : <><p className="muted">{load.registry.customers.length === 1 ? "1 cliente" : `${load.registry.customers.length} clienti`} da {load.registry.billCount === 1 ? "1 bolletta" : `${load.registry.billCount} bollette`}.</p>{shown.map((customer) => <Customer key={customer.key} customer={customer} />)}</>}
  </div>;
}
