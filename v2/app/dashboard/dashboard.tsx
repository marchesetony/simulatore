import type { DashboardView } from "./access";
import styles from "./dashboard.module.css";

const modules = [
  { name: "Clienti", mark: "CL", description: "Anagrafiche e relazioni commerciali." },
  { name: "Bollette", mark: "BO", description: "Documenti e informazioni sulle forniture." },
  { name: "Simulazioni", mark: "SI", description: "Analisi e confronto delle condizioni economiche." },
  { name: "CTE", mark: "CT", description: "Condizioni tecnico-economiche delle offerte." },
  { name: "Regolatorio / Mercato", mark: "RM", description: "Riferimenti regolatori e dati di mercato." },
  { name: "Proposte", mark: "PR", description: "Preparazione delle proposte commerciali." },
] as const;

function Navigation() {
  return <aside className={styles.sidebar}>
    <a className={styles.brand} href="/v2/dashboard" aria-label="Energia Operativa — Dashboard">
      <span className={styles.logo} aria-hidden="true">EO</span><span>Energia<br /><strong>Operativa</strong></span>
    </a>
    <p className={styles.navLabel}>SPAZIO DI LAVORO</p>
    <nav aria-label="Navigazione principale"><ul className={styles.nav}>
      <li><a href="/v2/dashboard" aria-current="page">Dashboard <span aria-hidden="true">↗</span></a></li>
      {modules.map(item => <li key={item.name}>{item.name === "Clienti" ? <a href="/v2/customers">Clienti</a> : item.name === "Bollette" ? <a href="/v2/bills">Bollette</a> : item.name === "Simulazioni" ? <a href="/v2/simulations">Simulazioni</a> :
        <span className={styles.disabled} aria-disabled="true">{item.name}<small>Non ancora disponibile</small></span>}</li>)}
    </ul></nav>
    <p className={styles.sidebarNote}>SIMULATORE EE<span>Un ambiente, tutti i tuoi strumenti.</span></p>
  </aside>;
}

function Identity({ view }: { view: DashboardView }) {
  return <section className={styles.identity} aria-label="Identità verificata">
    <div><span className={styles.eyebrow}>ACCOUNT VERIFICATO</span><p>{view.userId}</p></div>
    <div><span className={styles.eyebrow}>RUOLO</span><p>{view.roleLabel}</p></div>
    <div><span className={styles.eyebrow}>AMBITO</span><p>{view.scope === "PLATFORM" ? "Piattaforma" : "Azienda"}</p></div>
    {view.scope === "TENANT" && <div><span className={styles.eyebrow}>TENANT CORRENTE</span><p>{view.tenantId}</p></div>}
  </section>;
}

export default function Dashboard({ view }: { view: DashboardView }) {
  return <div className={styles.shell}>
    <a className={styles.skip} href="#contenuto">Vai al contenuto</a>
    <Navigation />
    <div className={styles.workspace}>
      <header className={styles.topbar}><span>Simulatore energia elettrica</span><span className={styles.verified}>Accesso verificato</span></header>
      <main id="contenuto" className={styles.content}>
        <section className={styles.intro}><div><p className={styles.eyebrow}>IL TUO SPAZIO OPERATIVO</p>
          <h1>Dashboard</h1><p>Una visione chiara, dal primo documento alla proposta.</p></div>
          <span className={styles.edition}>ENERGIA OPERATIVA <strong>V2</strong></span></section>
        <Identity view={view} />
        <section className={styles.modules} aria-labelledby="strumenti">
          <div className={styles.sectionHeading}><div><h2 id="strumenti">Strumenti di lavoro</h2>
            <p>Clienti, Bollette e Simulazioni sono collegati. Gli altri moduli non sono ancora disponibili.</p></div><span>6 moduli previsti</span></div>
          <div className={styles.grid}>{modules.map(item => <article key={item.name} className={styles.card}>
            <span className={styles.mark} aria-hidden="true">{item.mark}</span>
            <h3>{item.name}</h3><p>{item.description}</p>{item.name === "Clienti" ? <a href="/v2/customers">Apri Clienti</a> : item.name === "Bollette" ? <a href="/v2/bills">Apri Bollette</a> : item.name === "Simulazioni" ? <a href="/v2/simulations">Apri Simulazioni</a> :
              <span className={styles.status}>Non ancora disponibile</span>}
          </article>)}</div>
        </section>
        <footer className={styles.footer}>Energia Operativa<span>Workspace · V2</span></footer>
      </main>
    </div>
  </div>;
}
