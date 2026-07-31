'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

type ExpiryState = 'present' | 'unavailable';
type LineItem = { item: string; quantity: string; averagePrice: string; current: string; proposed: string; difference: string };

const fixture = {
  seller: 'Lumenica Energia Demo S.r.l.', vat: 'IT 01234567890', simulationDate: '15/02/2027', reference: 'SIM-DEMO-2027-014',
  saving: '€ 240,00', percentage: '10%', currentCost: '€ 2.400,00', proposedCost: '€ 2.160,00',
  customer: 'Esempio Industrie S.r.l.', customerVat: 'IT 09876543210', taxCode: 'RSSMRA80A01H501X', address: 'Via delle Energie 12, 20100 Milano (MI)', service: 'Energia elettrica', podPdr: 'POD-DEMO-0001',
  annualConsumption: '12.000 kWh', periodConsumption: '4.655,1 kWh — 01/06/2026–30/06/2026', currentSupplier: 'Aurora Energia Demo', currentOffer: 'Luce Base Demo', source: 'bolletta-demo.pdf', page: '2',
  proposedOffer: 'Variabile Chiara Demo', offerCode: 'LUM-DEMO-VAR-01', priceType: 'Variabile', tariff: 'Monoraria', index: 'PUN Demo', formula: 'Indice Demo + spread', spread: '€ 0,012/kWh', fixedCharge: '€ 120/anno', conditionDuration: '12 mesi', offerValidity: '31/03/2027', contractExpiry: '31/03/2028', billing: 'Mensile', payment: 'Bonifico bancario', penalties: 'Nessuna prevista nella fixture', discounts: 'Bonus demo € 50', services: 'Assistenza demo inclusa',
  assumptions: 'Consumo annuo costante; valori economici precomputati per la sola validazione grafica.', unavailable: 'Dati fiscali dettagliati e componenti non presenti nella fixture.', calculationDate: '15/02/2027'
};

const comparisonRows: LineItem[] = [
  { item: 'Quota consumi — vendita', quantity: '12.000 kWh', averagePrice: '€ 0,120/kWh', current: '€ 1.440,00', proposed: '€ 1.320,00', difference: '€ 120,00' },
  { item: 'Quota consumi — rete e oneri', quantity: '12.000 kWh', averagePrice: '€ 0,055/kWh', current: '€ 660,00', proposed: '€ 660,00', difference: '€ 0,00' },
  { item: 'Quota fissa — vendita', quantity: '1 anno', averagePrice: '€ 80,00', current: '€ 80,00', proposed: '€ 60,00', difference: '€ 20,00' },
  { item: 'Quota fissa — rete e oneri', quantity: '1 anno', averagePrice: '€ 40,00', current: '€ 40,00', proposed: '€ 40,00', difference: '€ 0,00' },
  { item: 'Quota potenza', quantity: '3 kW', averagePrice: '€ 60,00', current: '€ 60,00', proposed: '€ 60,00', difference: '€ 0,00' },
  { item: 'Ricalcoli, se presenti', quantity: '—', averagePrice: '—', current: '€ 0,00', proposed: '€ 0,00', difference: '€ 0,00' },
  { item: 'Altre partite, se presenti', quantity: '—', averagePrice: '—', current: '€ 0,00', proposed: '€ 0,00', difference: '€ 0,00' },
  { item: 'Bonus sociale, se presente', quantity: '—', averagePrice: '—', current: '€ 0,00', proposed: '€ 0,00', difference: '€ 0,00' },
  { item: 'Prodotti o servizi aggiuntivi, se presenti', quantity: '—', averagePrice: '—', current: '€ 120,00', proposed: '€ 20,00', difference: '€ 100,00' },
  { item: 'Canone RAI, se presente', quantity: '—', averagePrice: '—', current: '€ 0,00', proposed: '€ 0,00', difference: '€ 0,00' },
  { item: 'Accise', quantity: '12.000 kWh', averagePrice: '€ 0,000', current: '€ 0,00', proposed: '€ 0,00', difference: '€ 0,00' },
  { item: 'IVA', quantity: '—', averagePrice: '—', current: '€ 0,00', proposed: '€ 0,00', difference: '€ 0,00' },
  { item: 'Totale bolletta', quantity: '—', averagePrice: '—', current: fixture.currentCost, proposed: fixture.proposedCost, difference: fixture.saving },
  { item: 'Totale da pagare', quantity: '—', averagePrice: '—', current: fixture.currentCost, proposed: fixture.proposedCost, difference: fixture.saving }
];

const details = [
  ['Nome offerta', fixture.proposedOffer], ['Fornitore', fixture.seller], ['Codice offerta', fixture.offerCode], ['Prezzo', fixture.priceType], ['Fascia', fixture.tariff], ['Indice e formula', `${fixture.index} · ${fixture.formula}`], ['Spread', fixture.spread], ['Quota commerciale fissa', fixture.fixedCharge], ['Durata condizioni economiche', fixture.conditionDuration], ['Offerta valida fino al', fixture.offerValidity], ['Durata/scadenza contratto', fixture.contractExpiry], ['Frequenza fatturazione', fixture.billing], ['Metodo di pagamento', fixture.payment], ['Penali recesso anticipato', fixture.penalties], ['Sconti, bonus e servizi', `${fixture.discounts} · ${fixture.services}`]
];

export default function Home() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [expiryState, setExpiryState] = useState<ExpiryState>('present');
  const foundationMode = useSyncExternalStore(
    () => () => undefined,
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('foundation') === '1',
    () => false,
  );
  useEffect(() => () => { if (logoUrl) URL.revokeObjectURL(logoUrl); }, [logoUrl]);

  function selectLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
    const nextUrl = URL.createObjectURL(file);
    setLogoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return nextUrl; });
    event.target.value = '';
  }
  function removeLogo() { setLogoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return null; }); }
  const expiry = expiryState === 'present' ? '31/12/2027' : 'Data di scadenza: non rilevata nel documento — verifica necessaria';

  if (foundationMode) return <><FoundationTestBench /><BillIngestionBench /></>;

  return <main className="demo-shell">
    <header className="topbar"><div><p className="eyebrow">SCHEDA DI COMPARABILITÀ · DEMO SINTETICA</p><h1>Proposta commerciale</h1><p className="subtitle">Presentazione grafica con valori fissi e fittizi. Nessun dato viene estratto o calcolato.</p></div><span className="status-chip">Solo dati sintetici</span></header>
    <section className="toolbar" aria-label="Controlli della demo"><div className="logo-controls"><div className="logo-stage">{logoUrl ? <img src={logoUrl} alt="Logo aziendale selezionato" /> : <div className="logo-placeholder"><span>LD</span><strong>Logo aziendale</strong><small>Anteprima locale</small></div>}</div><label className="button primary-button">{logoUrl ? 'Sostituisci logo' : 'Inserisci logo'}<input aria-label="Seleziona logo PNG JPEG o WebP" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} /></label><button className="button ghost-button" type="button" onClick={removeLogo} disabled={!logoUrl}>Rimuovi</button></div><div className="company-input"><label htmlFor="company-name">Ragione sociale da riportare nel documento</label><input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Nome azienda" /><button className="text-button" type="button" onClick={() => setCompanyName('')} disabled={!companyName}>Rimuovi ragione sociale</button></div><div className="expiry-control"><span className="control-label">Stato della scadenza condizioni attuali</span><div className="segmented" role="group" aria-label="Stato scadenza"><button className={expiryState === 'present' ? 'selected' : ''} onClick={() => setExpiryState('present')} type="button">Presente</button><button className={expiryState === 'unavailable' ? 'selected' : ''} onClick={() => setExpiryState('unavailable')} type="button">Non rilevata</button></div></div></section>
    <div className="screen-report"><ReportContent logoUrl={logoUrl} expiry={expiry} /></div>
    <section className="print-preview" aria-label="Anteprima A4 di stampa"><div className="print-toolbar"><div><p className="eyebrow">ANTEPRIMA A4</p><h2>Documento pronto per la revisione grafica</h2></div><span>Solo layout di stampa · nessun PDF generato</span></div><PrintReport logoUrl={logoUrl} expiry={expiry} companyName={companyName} /></section>
    <footer className="footer-note">Foundation V1 · package grafico · synthetic presentation only</footer>
  </main>;
}

type ApiErrorShape = {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly correlationId?: unknown;
};

type IngestedBill = {
  id: string;
  status: string;
  fileName: string;
  currentVersionId: string;
  currentVersionNumber: number;
  reviewState: string;
  currentApprovedVersionId: string | null;
  currentApprovedVersionNumber: number | null;
  currentApprovedAt: string | null;
  versionCount: number;
  approvalCount: number;
  requiredFields: readonly string[];
  approvalReady: boolean;
  approvalIssues: {
    missingFields: readonly string[];
    unconfirmedFields: readonly string[];
  };
  versions: ReadonlyArray<{
    versionId: string;
    versionNumber: number;
    reviewState: string;
    approvedAt: string | null;
  }>;
  fields: Record<string, { value: string | null; confidence: number; source: string; confirmed: boolean }>;
};

function formatApiError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const structured = error as ApiErrorShape;
    const message = typeof structured.message === 'string' && structured.message.trim() ? structured.message.trim() : null;
    const code = typeof structured.code === 'string' && structured.code.trim() ? structured.code.trim() : null;
    const correlationId = typeof structured.correlationId === 'string' && structured.correlationId.trim() ? structured.correlationId.trim() : null;
    if (message || code || correlationId) {
      return [message ?? 'Errore non specificato', code ? `code: ${code}` : null, correlationId ? `correlationId: ${correlationId}` : null].filter(Boolean).join(' · ');
    }
  }
  return 'Errore non supportato';
}

function BillIngestionBench() {
  const [bill, setBill] = useState<IngestedBill | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bill) {
      setDrafts({});
      return;
    }
    setDrafts(Object.fromEntries(Object.entries(bill.fields).map(([name, field]) => [name, field.value ?? ''])));
  }, [bill]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData();
    form.set('file', file);
    try {
      const response = await fetch('/api/bills', { method: 'POST', headers: { 'x-foundation-tenant-id': 'tenant_local-demo' }, body: form });
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== 'object' || body === null || !('document' in body)) {
        throw new Error(formatApiError(typeof body === 'object' && body !== null && 'error' in body ? (body as { error?: unknown }).error : 'INGESTION_FAILED'));
      }
      const nextBill = (body as { document: IngestedBill }).document;
      setBill(nextBill);
      setNotice(`Documento caricato · versione corrente v${nextBill.currentVersionNumber}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'INGESTION_FAILED');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  async function correct(field: string) {
    if (!bill) return;
    const value = drafts[field]?.trim() ?? '';
    if (!value) {
      setError(`Valore mancante per ${field}`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/bills/${bill.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-foundation-tenant-id': 'tenant_local-demo' },
        body: JSON.stringify({ operation: 'correct', field, value, versionId: bill.currentVersionId }),
      });
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== 'object' || body === null || !('document' in body)) {
        throw new Error(formatApiError(typeof body === 'object' && body !== null && 'error' in body ? (body as { error?: unknown }).error : 'CORRECTION_FAILED'));
      }
      const nextBill = (body as { document: IngestedBill }).document;
      setBill(nextBill);
      setNotice(`Correzione salvata · nuova versione v${nextBill.currentVersionNumber}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'CORRECTION_FAILED');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!bill) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/bills/${bill.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-foundation-tenant-id': 'tenant_local-demo' },
        body: JSON.stringify({ operation: 'approve', versionId: bill.currentVersionId }),
      });
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== 'object' || body === null || !('document' in body)) {
        throw new Error(formatApiError(typeof body === 'object' && body !== null && 'error' in body ? (body as { error?: unknown }).error : 'APPROVAL_FAILED'));
      }
      const nextBill = (body as { document: IngestedBill }).document;
      setBill(nextBill);
      setNotice(`Versione approvata · v${nextBill.currentVersionNumber}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'APPROVAL_FAILED');
    } finally {
      setBusy(false);
    }
  }

  return <section className="foundation-ingestion">
    <div className="bench-header">
      <div>
        <p className="eyebrow">REAL PDF INGESTION V1 · LOCAL</p>
        <h1>Revisione bolletta</h1>
        <p>Carica un PDF reale in ambiente locale. Nessun confronto, calcolo o PDF viene generato.</p>
      </div>
      <label className="button primary-button">
        {busy ? 'Validazione…' : 'Seleziona PDF'}
        <input type="file" accept="application/pdf" onChange={upload} disabled={busy} />
      </label>
    </div>
    {error && <div className="bench-error">Operazione negata: {error}</div>}
    {notice && <div className="bench-notice"><strong>Esito locale</strong><span>{notice}</span></div>}
    {bill && <div className="ingestion-card">
      <strong>{bill.fileName}</strong>
      <span>Stato estrazione: {bill.status}</span>
      <span>Stato revisione: {bill.reviewState}</span>
      <span>Versione corrente: v{bill.currentVersionNumber} · {bill.currentVersionId}</span>
      <span>Versioni salvate: {bill.versionCount} · approvazioni: {bill.approvalCount}</span>
      <span>Versione approvata corrente: {bill.currentApprovedVersionNumber ? `v${bill.currentApprovedVersionNumber}` : 'nessuna'}</span>
      {bill.currentApprovedAt && <span>Approvata il: {bill.currentApprovedAt}</span>}
      {!bill.approvalReady && <small>Approvazione bloccata · mancanti: {bill.approvalIssues.missingFields.join(', ') || 'nessuno'} · non confermati: {bill.approvalIssues.unconfirmedFields.join(', ') || 'nessuno'}</small>}
      {Object.entries(bill.fields).map(([name, field]) => {
        const draft = drafts[name] ?? '';
        const changed = draft !== (field.value ?? '');
        const required = bill.requiredFields.includes(name);
        return <label className="review-field" key={`${bill.currentVersionId}:${name}`}>
          <span>{name}{required ? ' · obbligatorio' : ''} · confidenza {Math.round(field.confidence * 100)}% · {field.source}</span>
          <input value={draft} placeholder="Non rilevato" onChange={(event) => setDrafts((current) => ({ ...current, [name]: event.target.value }))} />
          <small>{field.confirmed ? 'Confermato' : 'Richiede revisione'}</small>
          <button className="button ghost-button" type="button" onClick={() => void correct(name)} disabled={busy || !draft.trim()}>
            {changed ? 'Salva correzione' : 'Conferma valore'}
          </button>
        </label>;
      })}
      <button className="button primary-button" type="button" onClick={() => void approve()} disabled={busy || !bill.approvalReady}>
        Approva versione locale
      </button>
      <small>Cronologia locale: {bill.versions.map((version) => `v${version.versionNumber} ${version.reviewState}`).join(' · ')}</small>
    </div>}
  </section>;
}

type BenchResult = {
  scenario: string;
  request: string;
  expected: string;
  actual: string;
  passed: boolean;
  evidence: unknown;
  error?: unknown;
};

type BenchGroup = { title: string; endpoint: string; scenarios: ReadonlyArray<{ id: string; label: string }> };

const benchGroups: ReadonlyArray<BenchGroup> = [
  { title: 'Sessioni', endpoint: '/api/foundation/session', scenarios: [
    { id: 'valid-session', label: 'Sessione valida' }, { id: 'expired-session', label: 'Sessione scaduta' },
    { id: 'revoked-session', label: 'Sessione revocata' }, { id: 'rotated-session', label: 'Sessione già ruotata' },
    { id: 'malformed-request', label: 'Richiesta malformata' },
  ] },
  { title: 'Inviti', endpoint: '/api/foundation/invitations', scenarios: [
    { id: 'valid-invitation', label: 'Invito valido' }, { id: 'expired-invitation', label: 'Invito scaduto' },
    { id: 'revoked-invitation', label: 'Invito revocato' }, { id: 'replayed-invitation', label: 'Replay invito' },
    { id: 'wrong-tenant-invitation', label: 'Invito tenant errato' }, { id: 'malformed-request', label: 'Richiesta malformata' },
  ] },
  { title: 'Membership', endpoint: '/api/foundation/memberships', scenarios: [
    { id: 'active-membership', label: 'Membership attiva' }, { id: 'inactive-membership', label: 'Membership inattiva' },
    { id: 'cross-tenant-membership', label: 'Membership cross-tenant' }, { id: 'malformed-request', label: 'Richiesta malformata' },
  ] },
  { title: 'Ruoli e permessi', endpoint: '/api/foundation/authorization', scenarios: [
    { id: 'product-owner-allowed', label: 'Product Owner · consentito' }, { id: 'product-owner-denied', label: 'Product Owner · negato' },
    { id: 'platform-owner-allowed', label: 'Platform Owner · consentito' }, { id: 'platform-owner-denied', label: 'Platform Owner · negato' },
    { id: 'tenant-admin-allowed', label: 'Tenant Admin · consentito' }, { id: 'tenant-admin-denied', label: 'Tenant Admin · negato' },
    { id: 'sales-manager-allowed', label: 'Sales Manager · consentito' }, { id: 'sales-manager-denied', label: 'Sales Manager · negato' },
    { id: 'sales-operator-allowed', label: 'Sales Operator · consentito' }, { id: 'sales-operator-denied', label: 'Sales Operator · negato' },
    { id: 'malformed-request', label: 'Richiesta malformata' },
  ] },
];

function formatBenchError(error: unknown): string {
  return formatApiError(error);
}

function FoundationTestBench() {
  const [results, setResults] = useState<Record<string, BenchResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  async function runScenario(group: BenchGroup, scenario: string): Promise<void> {
    const key = `${group.endpoint}:${scenario}`;
    setRunning(key);
    try {
      const response = await fetch(`${group.endpoint}?scenario=${encodeURIComponent(scenario)}`, { method: 'POST' });
      const body: unknown = await response.json();
      const result = isBenchResult(body) ? body : {
        scenario, request: `POST ${group.endpoint}`, expected: 'DENIED', actual: 'DENIED', passed: false,
        evidence: { safe: true }, error: 'Risposta non valida',
      };
      setResults((current) => ({ ...current, [key]: result }));
    } catch {
      setResults((current) => ({ ...current, [key]: {
        scenario, request: `POST ${group.endpoint}`, expected: 'DENIED', actual: 'DENIED', passed: false,
        evidence: { safe: true }, error: 'Endpoint non disponibile',
      } }));
    } finally { setRunning(null); }
  }

  return <main className="foundation-bench-shell">
    <header className="bench-header"><div><p className="eyebrow">FOUNDATION V1 · TEST BENCH</p><h1>Verifica SaaS sintetica</h1><p>Solo scenari fissi, provider-neutral e senza persistenza. Il report grafico principale resta invariato su <code>/</code>.</p></div><span className="status-chip">Synthetic-only</span></header>
    <div className="bench-notice"><strong>Decision 13 · perimetro controllato</strong><span>Nessun login reale, provider, database, dato reale o attivazione Production. I risultati vivono solo nella memoria del browser.</span></div>
    <div className="bench-grid">{benchGroups.map((group) => <section className="bench-group" key={group.endpoint}><div className="bench-group-heading"><div><p className="eyebrow">API CLOSED-SCENARIO</p><h2>{group.title}</h2></div><code>{group.endpoint}</code></div><div className="bench-scenarios">{group.scenarios.map((scenario) => { const key = `${group.endpoint}:${scenario.id}`; const result = results[key]; return <article className="bench-card" key={scenario.id}><div className="bench-card-top"><strong>{scenario.label}</strong><span className={result?.passed ? 'pass-pill' : result ? 'fail-pill' : 'pending-pill'}>{result ? (result.passed ? 'PASS' : 'FAIL') : 'NON ESEGUITO'}</span></div><p className="bench-scenario-id">Scenario: <code>{scenario.id}</code></p><button className="button primary-button" type="button" onClick={() => void runScenario(group, scenario.id)} disabled={running !== null}>Esegui test</button>{result && <div className="bench-result"><div><span>Request</span><code>{result.request}</code></div><div><span>Expected</span><strong>{result.expected}</strong></div><div><span>Actual</span><strong>{result.actual}</strong></div><div><span>Evidence</span><pre>{JSON.stringify(result.evidence, null, 2)}</pre></div>{result.error !== undefined && <small className="bench-error">{formatBenchError(result.error)}</small>}</div>}</article>; })}</div></section>)}</div>
    <footer className="bench-footer">Foundation V1 · test bench sintetico · <Link href="/">Torna al report grafico</Link></footer>
  </main>;
}

function isBenchResult(value: unknown): value is BenchResult {
  if (typeof value !== 'object' || value === null) return false;
  return 'scenario' in value && 'expected' in value && 'actual' in value && 'passed' in value && 'evidence' in value;
}

function ReportContent({ logoUrl, expiry, print = false }: { logoUrl: string | null; expiry: string; print?: boolean }) {
  return <div className={print ? 'report report-print' : 'report'}>
    <section className="report-section proposal-section"><div className="section-heading"><span className="step">01</span><div><p className="eyebrow">PROPOSTA COMMERCIALE</p><h2>Una sintesi chiara dell&apos;offerta</h2></div></div><div className="proposal-head"><div className="report-logo">{logoUrl ? <img src={logoUrl} alt="Logo nel report" /> : <span>LD</span>}</div><div><strong>{fixture.seller}</strong><span>Partita IVA {fixture.vat}</span><span>Simulazione {fixture.simulationDate} · Rif. {fixture.reference}</span></div><div className="headline-saving"><small>Risparmio annuo stimato</small><strong>{fixture.saving}</strong><b>{fixture.percentage}</b></div></div><div className="cost-strip"><Metric label="Costo annuo attuale" value={fixture.currentCost} /><Metric label="Costo annuo nuova offerta" value={fixture.proposedCost} /></div></section>
    <section className="report-section"><SectionTitle number="02" title="Cliente e fornitura" /><div className="info-grid">{[['Cliente / società', fixture.customer], ['Partita IVA', fixture.customerVat], ['Codice fiscale', fixture.taxCode], ['Indirizzo fornitura', fixture.address], ['Servizio', fixture.service], ['POD / PDR', fixture.podPdr], ['Fornitore attuale', fixture.currentSupplier], ['Consumo annuo (dato sintetico fisso)', fixture.annualConsumption], ['Consumo rilevato nel periodo (dato sintetico fisso)', fixture.periodConsumption], ['Nome offerta attuale', fixture.currentOffer], ['Scadenza pagamento bolletta', '15/03/2027'], ['Scadenza condizioni economiche attuali', expiry], ['Documento fonte', `${fixture.source} · pagina ${fixture.page}`]].map(([label, value]) => <Info key={label} label={label} value={value} />)}</div></section>
    <section className="report-section"><SectionTitle number="03" title="Confronto economico" /><div className="economic-grid"><Metric label="Costo annuo attuale" value={fixture.currentCost} /><Metric label="Costo annuo proposto" value={fixture.proposedCost} /><Metric label="Differenza annua" value={fixture.saving} accent /><Metric label="Differenza percentuale" value={fixture.percentage} accent /></div></section>
    <section className="report-section"><SectionTitle number="04" title="Scontrino dell'energia comparato" /><p className="arera-note">Relazione ARERA di lettura: <strong>Quantità × prezzo medio = importo</strong>. I valori sono esclusivamente sintetici.</p><ComparisonTable /></section>
    <section className="report-section"><SectionTitle number="05" title="Partite escluse dalla comparazione" /><div className="excluded-list"><div><strong>Imposte e dati fiscali dettagliati</strong><span>Importo: non disponibile</span><small>Esclusi perché non presenti nella fixture grafica.</small></div><div><strong>Componenti non documentate</strong><span>Importo: non disponibile</span><small>Esclusi per evitare interpretazioni o inferenze.</small></div></div></section>
    <section className="report-section offer-box"><SectionTitle number="06" title="Box offerta proposta" /><div className="detail-grid">{details.map(([label, value]) => <Info key={label} label={label} value={value} />)}</div></section>
    <section className="report-section"><SectionTitle number="07" title="Date" /><div className="dates-grid"><Info label="Scadenza pagamento bolletta" value="15/03/2027" /><Info label="Scadenza condizioni economiche attuali" value={expiry} /><Info label="Offerta proposta valida fino al" value={fixture.offerValidity} /><Info label="Durata/scadenza nuovo contratto" value={fixture.contractExpiry} /></div><span className="source-tag">Evidenza scadenza attuale: {fixture.source} · pagina {fixture.page}</span></section>
    <section className="report-section compact-notes"><SectionTitle number="08" title="Note finali" /><div className="notes-grid"><Info label="Assunzioni" value={fixture.assumptions} /><Info label="Dati non disponibili" value={fixture.unavailable} /><Info label="Data di simulazione" value={fixture.calculationDate} /></div></section>
  </div>;
}

function PrintReport({ logoUrl, expiry, companyName }: { logoUrl: string | null; expiry: string; companyName: string }) {
  return <div className="print-pages">
    <PrintPage logoUrl={logoUrl} companyName={companyName} pageNumber="1"><ReportContent logoUrl={logoUrl} expiry={expiry} print /></PrintPage>
    <PrintPage logoUrl={logoUrl} companyName={companyName} pageNumber="2"><div className="report report-print"><section className="report-section"><SectionTitle number="04" title="Scontrino dell&apos;energia comparato" /><p className="arera-note">Relazione ARERA di lettura: <strong>Quantità × prezzo medio = importo</strong>. I valori sono esclusivamente sintetici.</p><ComparisonTable /></section><section className="report-section"><SectionTitle number="05" title="Partite escluse dalla comparazione" /><div className="excluded-list"><div><strong>Imposte e dati fiscali dettagliati</strong><span>Importo: non disponibile</span><small>Esclusi perché non presenti nella fixture grafica.</small></div><div><strong>Componenti non documentate</strong><span>Importo: non disponibile</span><small>Esclusi per evitare interpretazioni o inferenze.</small></div></div></section></div></PrintPage>
    <PrintPage logoUrl={logoUrl} companyName={companyName} pageNumber="3"><div className="report report-print"><section className="report-section offer-box"><SectionTitle number="06" title="Box offerta proposta" /><div className="detail-grid">{details.map(([label, value]) => <Info key={label} label={label} value={value} />)}</div></section><section className="report-section"><SectionTitle number="07" title="Date" /><div className="dates-grid"><Info label="Scadenza pagamento bolletta" value="15/03/2027" /><Info label="Scadenza condizioni economiche attuali" value={expiry} /><Info label="Offerta proposta valida fino al" value={fixture.offerValidity} /><Info label="Durata/scadenza nuovo contratto" value={fixture.contractExpiry} /></div><span className="source-tag">Evidenza scadenza attuale: {fixture.source} · pagina {fixture.page}</span></section><section className="report-section compact-notes"><SectionTitle number="08" title="Note finali" /><div className="notes-grid"><Info label="Assunzioni" value={fixture.assumptions} /><Info label="Dati non disponibili" value={fixture.unavailable} /><Info label="Data di simulazione" value={fixture.calculationDate} /></div></section></div></PrintPage>
  </div>;
}

function PrintPage({ logoUrl, companyName, pageNumber, children }: { logoUrl: string | null; companyName: string; pageNumber: string; children: React.ReactNode }) {
  return <article className="print-page"><header className="print-page-header"><div className="running-logo">{logoUrl ? <img src={logoUrl} alt="" /> : <span>LD</span>}</div><span>Proposta commerciale · demo sintetica</span><small>Pagina {pageNumber}/3</small></header><div className="print-page-content">{children}</div><footer className={`print-page-footer ${companyName.trim() ? '' : 'footer-empty'}`}><span>{companyName.trim()}</span></footer></article>;
}

function SectionTitle({ number, title }: { number: string; title: string }) { return <div className="section-heading"><span className="step">{number}</span><h2>{title}</h2></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info"><span>{label}</span><strong>{value}</strong></div>; }
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`metric ${accent ? 'accent-metric' : ''}`}><span>{label}</span><strong>{value}</strong></div>; }
function ComparisonTable() { return <div className="table-scroll"><table className="comparison-table"><caption>Voci sintetiche della bolletta e della nuova offerta</caption><thead><tr>{['Voce', 'Quantità', 'Prezzo medio', 'Bolletta attuale', 'Nuova offerta', 'Differenza'].map((head) => <th key={head}>{head}</th>)}</tr></thead><tbody>{comparisonRows.map((row) => <tr key={row.item}>{Object.values(row).map((cell, index) => <td className={index === 5 ? 'difference-cell' : ''} key={`${row.item}-${index}`}>{cell}</td>)}</tr>)}</tbody></table></div>; }
