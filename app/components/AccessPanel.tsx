"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";

type Level = "AMMINISTRATORE" | "DIRETTORE" | "AREA_MANAGER" | "AGENTE" | "SUB_AGENTE";
type ChainLevel = "AZIENDA" | "DIRETTORE" | "AREA_MANAGER" | "AGENTE" | "SUB_AGENTE";
type Account = { readonly userId: string; readonly tenantId: string; readonly email: string; readonly displayName: string; readonly level: Level; readonly status: "ACTIVE" | "SUSPENDED"; readonly version?: number; readonly chainLevel?: ChainLevel | null; readonly parentUserId?: string | null };
type Company = { readonly tenantId: string; readonly name: string; readonly createdAt: string; readonly accounts: readonly Account[] };
type Capabilities = { readonly userId: string; readonly platformOwner: boolean; readonly teamManager: boolean };

const LEVEL_LABEL: Readonly<Record<Level, string>> = { DIRETTORE: "Direttore", AREA_MANAGER: "Area Manager", AGENTE: "Agente", SUB_AGENTE: "Sub-agente", AMMINISTRATORE: "Amministratore" };
const LEVELS = Object.keys(LEVEL_LABEL) as Level[];
const CHAIN_ORDER: readonly ChainLevel[] = ["AZIENDA", "DIRETTORE", "AREA_MANAGER", "AGENTE", "SUB_AGENTE"];
const CHAIN_LABEL: Readonly<Record<ChainLevel, string>> = { AZIENDA: "Azienda", DIRETTORE: "Direttore", AREA_MANAGER: "Area Manager", AGENTE: "Agente", SUB_AGENTE: "Sub-agente" };

/** Who can be the responsabile of a new account: anybody in the chain above its level. */
function parentOptions(team: readonly Account[], level: Level): readonly Account[] {
  if (level === "AMMINISTRATORE") return [];
  const limit = CHAIN_ORDER.indexOf(level);
  return team.filter((account) => account.status === "ACTIVE" && account.chainLevel && CHAIN_ORDER.indexOf(account.chainLevel) < limit).sort((left, right) => CHAIN_ORDER.indexOf(left.chainLevel as ChainLevel) - CHAIN_ORDER.indexOf(right.chainLevel as ChainLevel) || left.displayName.localeCompare(right.displayName));
}

function errorText(cause: unknown): string { return toUiError(cause).message; }

function AccountFields({ idPrefix, withLevel, value, onChange }: { readonly idPrefix: string; readonly withLevel: boolean; readonly value: { readonly displayName: string; readonly email: string; readonly password: string; readonly level: Level }; readonly onChange: (value: { readonly displayName: string; readonly email: string; readonly password: string; readonly level: Level }) => void }) {
  return <div className="form-grid">
    <div className="form-field"><label className="form-label" htmlFor={`${idPrefix}-name`}>Nome e cognome</label><input id={`${idPrefix}-name`} value={value.displayName} onChange={(event) => onChange({ ...value, displayName: event.target.value })} required /></div>
    <div className="form-field"><label className="form-label" htmlFor={`${idPrefix}-email`}>Email</label><input id={`${idPrefix}-email`} type="email" autoComplete="off" value={value.email} onChange={(event) => onChange({ ...value, email: event.target.value })} required /></div>
    {withLevel ? <div className="form-field"><label className="form-label" htmlFor={`${idPrefix}-level`}>Ruolo</label><select id={`${idPrefix}-level`} value={value.level} onChange={(event) => onChange({ ...value, level: event.target.value as Level })}>{LEVELS.map((item) => <option key={item} value={item}>{LEVEL_LABEL[item]}</option>)}</select></div> : null}
    <div className="form-field"><label className="form-label" htmlFor={`${idPrefix}-password`}>Password provvisoria</label><input id={`${idPrefix}-password`} type="text" autoComplete="new-password" value={value.password} onChange={(event) => onChange({ ...value, password: event.target.value })} required minLength={10} aria-describedby={`${idPrefix}-password-hint`} /><small id={`${idPrefix}-password-hint`}>Almeno 10 caratteri con lettere e numeri. Comunicala alla persona: potrà cambiarla da Accessi.</small></div>
  </div>;
}

const EMPTY = { displayName: "", email: "", password: "", level: "DIRETTORE" as Level };

function AccountList({ accounts, tenantId, selfUserId, onChanged }: { readonly accounts: readonly Account[]; readonly tenantId?: string; readonly selfUserId?: string; readonly onChanged: () => void }) {
  const [pending, setPending] = useState<string | null>(null); const [error, setError] = useState<string>();
  async function toggle(account: Account) {
    setPending(account.userId); setError(undefined);
    try { await requestJson("/api/access/team", { method: "PATCH", body: JSON.stringify({ userId: account.userId, status: account.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", expectedVersion: account.version, ...(tenantId ? { tenantId } : {}) }) }); onChanged(); }
    catch (cause) { setError(errorText(cause)); } finally { setPending(null); }
  }
  if (!accounts.length) return <p className="muted">Nessun accesso creato.</p>;
  return <>
    <div className="responsive-table"><table><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Responsabile</th><th>Stato</th><th></th></tr></thead>
      <tbody>{accounts.map((account) => <tr key={account.userId}><td><strong>{account.displayName}</strong></td><td>{account.email}</td><td>{LEVEL_LABEL[account.level]}</td><td>{account.parentUserId ? accounts.find((item) => item.userId === account.parentUserId)?.displayName ?? "In catena" : account.chainLevel === "AZIENDA" ? "Vertice azienda" : "—"}</td><td><span className={`status-badge ${account.status === "ACTIVE" ? "positive" : "negative"}`}>{account.status === "ACTIVE" ? "Attivo" : "Sospeso"}</span></td>
        <td>{account.version !== undefined && account.userId !== selfUserId ? <button className="button secondary compact" type="button" disabled={pending !== null} onClick={() => void toggle(account)}>{pending === account.userId ? "Salvataggio" : account.status === "ACTIVE" ? "Sospendi" : "Riattiva"}</button> : null}</td></tr>)}</tbody></table></div>
    {error ? <ErrorState message={error} /> : null}
  </>;
}

function NewAccountForm({ title, tenantId, team, onCreated }: { readonly title: string; readonly tenantId?: string; readonly team: readonly Account[]; readonly onCreated: () => void }) {
  const [value, setValue] = useState(EMPTY); const [parentUserId, setParentUserId] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState<string>(); const [message, setMessage] = useState<string>();
  const parents = parentOptions(team, value.level);
  const parent = parents.some((account) => account.userId === parentUserId) ? parentUserId : "";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined); setMessage(undefined);
    try { await requestJson("/api/access/team", { method: "POST", body: JSON.stringify({ ...value, ...(parent ? { parentUserId: parent } : {}), ...(tenantId ? { tenantId } : {}) }) }); setMessage(`Accesso creato per ${value.email}.`); setValue({ ...EMPTY, level: value.level }); onCreated(); }
    catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }
  return <form onSubmit={(event) => void submit(event)}>
    <div className="card-heading"><h3>{title}</h3><button className="button primary" type="submit" disabled={pending}>{pending ? "Creazione" : "Crea accesso"}</button></div>
    <AccountFields idPrefix={`new-${tenantId ?? "team"}`} withLevel value={value} onChange={setValue} />
    {value.level !== "AMMINISTRATORE" ? <div className="form-grid"><div className="form-field"><label className="form-label" htmlFor={`new-${tenantId ?? "team"}-parent`}>Sotto a chi lavora</label><select id={`new-${tenantId ?? "team"}-parent`} value={parent} onChange={(event) => setParentUserId(event.target.value)}><option value="">Direttamente sotto l&apos;azienda</option>{parents.filter((account) => account.chainLevel !== "AZIENDA").map((account) => <option key={account.userId} value={account.userId}>{account.displayName} · {CHAIN_LABEL[account.chainLevel as ChainLevel]}</option>)}</select></div></div> : null}
    {error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
  </form>;
}

function Companies() {
  const [companies, setCompanies] = useState<readonly (Company & { readonly accounts: readonly Account[] })[] | null>(null);
  const [teams, setTeams] = useState<Readonly<Record<string, readonly Account[]>>>({});
  const [name, setName] = useState(""); const [admin, setAdmin] = useState(EMPTY);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string>(); const [message, setMessage] = useState<string>();
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const response = await requestJson<{ readonly companies: readonly Company[] }>("/api/access/companies"); setCompanies(response.companies); }
    catch (cause) { setError(errorText(cause)); }
  }, []);
  const loadTeam = useCallback(async (tenantId: string) => {
    const response = await requestJson<{ readonly accounts: readonly Account[] }>(`/api/access/team?tenantId=${encodeURIComponent(tenantId)}`);
    setTeams((current) => ({ ...current, [tenantId]: response.accounts }));
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined); setMessage(undefined);
    try { await requestJson("/api/access/companies", { method: "POST", body: JSON.stringify({ name, admin: { displayName: admin.displayName, email: admin.email, password: admin.password } }) }); setMessage(`Azienda ${name} creata. L'amministratore entra con ${admin.email}.`); setName(""); setAdmin(EMPTY); await load(); }
    catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }
  return <>
    <section className="ui-card"><form onSubmit={(event) => void submit(event)}>
      <div className="card-heading"><h3>Nuova azienda</h3><button className="button primary" type="submit" disabled={pending}>{pending ? "Creazione" : "Crea azienda"}</button></div>
      <div className="form-grid"><div className="form-field"><label className="form-label" htmlFor="company-name">Ragione sociale</label><input id="company-name" value={name} onChange={(event) => setName(event.target.value)} required /></div></div>
      <p className="muted">Amministratore dell&apos;azienda: crea poi da solo direttori, area manager, agenti e sub-agenti.</p>
      <AccountFields idPrefix="company-admin" withLevel={false} value={admin} onChange={setAdmin} />
      {error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
    </form></section>
    <section className="ui-card"><div className="card-heading"><h3>Aziende</h3></div>
      {companies === null ? <LoadingState label="Caricamento aziende" /> : companies.length === 0 ? <p className="muted">Nessuna azienda ancora. Creane una qui sopra.</p> : <ul className="chain-list">{companies.map((company) => <li key={company.tenantId}>
        <div className="chain-row"><strong>{company.name}</strong><span className="muted">{company.accounts.length} {company.accounts.length === 1 ? "accesso" : "accessi"}</span><button className="button secondary compact" type="button" onClick={() => { const next = open === company.tenantId ? null : company.tenantId; setOpen(next); if (next) void loadTeam(next); }}>{open === company.tenantId ? "Chiudi" : "Gestisci"}</button></div>
        {open === company.tenantId ? <div className="content-stack" style={{ padding: "8px 0 8px 12px" }}>
          <AccountList accounts={teams[company.tenantId] ?? company.accounts} tenantId={company.tenantId} onChanged={() => { void loadTeam(company.tenantId); void load(); }} />
          <NewAccountForm title={`Nuovo accesso per ${company.name}`} tenantId={company.tenantId} team={teams[company.tenantId] ?? []} onCreated={() => { void loadTeam(company.tenantId); void load(); }} />
        </div> : null}
      </li>)}</ul>}
    </section>
  </>;
}

function Team({ selfUserId }: { readonly selfUserId: string }) {
  const [accounts, setAccounts] = useState<readonly Account[] | null>(null); const [error, setError] = useState<string>();
  const load = useCallback(() => requestJson<{ readonly accounts: readonly Account[] }>("/api/access/team").then((response) => setAccounts(response.accounts), (cause) => setError(errorText(cause))), []);
  useEffect(() => { void load(); }, [load]);
  return <>
    <section className="ui-card"><NewAccountForm title="Nuovo accesso" team={accounts ?? []} onCreated={() => void load()} /></section>
    <section className="ui-card"><div className="card-heading"><h3>La tua squadra</h3></div>
      <p className="muted">Ogni accesso entra subito nella catena sotto il responsabile scelto. Limiti e CTE di ogni ramo si regolano da Catena e CTE.</p>
      {error ? <ErrorState message={error} /> : accounts === null ? <LoadingState label="Caricamento squadra" /> : <AccountList accounts={accounts} selfUserId={selfUserId} onChanged={() => void load()} />}
    </section>
  </>;
}

function ChangePassword() {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [repeat, setRepeat] = useState("");
  const [pending, setPending] = useState(false); const [error, setError] = useState<string>(); const [message, setMessage] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined); setMessage(undefined);
    if (next !== repeat) { setError("Le due password nuove non coincidono."); return; }
    setPending(true);
    try { await requestJson("/api/access/password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) }); setMessage("Password cambiata."); setCurrent(""); setNext(""); setRepeat(""); }
    catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }
  return <section className="ui-card"><form onSubmit={(event) => void submit(event)}>
    <div className="card-heading"><h3>Cambia la tua password</h3><button className="button primary" type="submit" disabled={pending}>{pending ? "Salvataggio" : "Cambia password"}</button></div>
    <div className="form-grid">
      <div className="form-field"><label className="form-label" htmlFor="password-current">Password attuale</label><input id="password-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required /></div>
      <div className="form-field"><label className="form-label" htmlFor="password-new">Nuova password</label><input id="password-new" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={10} /></div>
      <div className="form-field"><label className="form-label" htmlFor="password-repeat">Ripeti la nuova password</label><input id="password-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required minLength={10} /></div>
    </div>
    {error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
  </form></section>;
}

export default function AccessPanel() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null); const [error, setError] = useState<string>();
  useEffect(() => { requestJson<Capabilities>("/api/access/capabilities").then(setCapabilities, (cause) => setError(errorText(cause))); }, []);
  if (error) return <ErrorState message={error} />;
  if (!capabilities) return <LoadingState label="Caricamento accessi" />;
  const detail = capabilities.platformOwner ? "Crei le aziende clienti e il loro amministratore. Ogni azienda poi crea gli accessi per la propria squadra." : capabilities.teamManager ? "Crei gli accessi per direttori, area manager, agenti e sub-agenti della tua azienda, ognuno sotto il suo responsabile." : "Gestisci la tua password.";
  return <div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">ACCESSI</p><h2>{capabilities.platformOwner ? "Aziende e accessi" : capabilities.teamManager ? "Squadra e accessi" : "Il tuo accesso"}</h2><p className="section-detail">{detail}</p></div></div>
    {capabilities.platformOwner ? <Companies /> : capabilities.teamManager ? <Team selfUserId={capabilities.userId} /> : null}
    <ChangePassword />
  </div>;
}
