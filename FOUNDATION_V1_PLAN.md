# Piano professionale di implementazione — Foundation V1

Data del piano: 22 luglio 2026  
Baseline verificata: `PROJECT_AUDIT.md`  
Branch al momento della redazione: `rebuild/foundation-v1`

## Legenda sul livello di certezza

Per evitare di confondere lo stato corrente con il disegno futuro, il documento usa tre etichette:

- **FATTO VERIFICATO**: elemento osservato direttamente nel repository e documentato in `PROJECT_AUDIT.md`.
- **RACCOMANDAZIONE**: proposta tecnica per Foundation V1, ancora modificabile durante la revisione.
- **DECISIONE PENDENTE**: scelta che richiede approvazione esplicita del proprietario prima dell'implementazione.

Questo è un piano di lavoro, non la descrizione di funzionalità già disponibili. Nessuna delle componenti raccomandate deve essere considerata implementata finché non esiste codice revisionato, verificato e integrato.

## Baseline verificata

**FATTO VERIFICATO.** Il repository è attualmente un prototipo Next.js basato su App Router, React, TypeScript e Tailwind CSS. L'applicazione è concentrata in un unico componente client. Non sono presenti backend applicativo, database, autenticazione, storage persistente, validazione runtime applicativa, test, logging strutturato o pipeline CI/CD.

**FATTO VERIFICATO.** Il comportamento denominato OCR della bolletta è simulato; l'estrazione CTE usa PDF.js e regex nel browser; i dati PUN sono hardcoded; il calcolo economico è parziale; i dati sono mantenuti solo nello stato React.

**FATTO VERIFICATO.** Al momento dell'audit `node_modules` non era presente. Build, lint e typecheck non sono quindi stati verificati e non devono essere considerati funzionanti per assunzione.

## 1. Obiettivo di Foundation V1

**RACCOMANDAZIONE.** Foundation V1 deve creare una base applicativa professionale, sicura e verificabile sulla quale sviluppare successivamente le funzioni energetiche. Il milestone deve risolvere le fondamenta trasversali, non implementare l'intelligenza documentale o il calcolo commerciale.

L'obiettivo è consegnare:

- un'applicazione Next.js organizzata in moduli e layer espliciti;
- un'identità utente e un confine di autorizzazione definiti;
- un modello dati iniziale versionato;
- un flusso sicuro di registrazione e archiviazione di documenti senza elaborazione OCR;
- validazione degli input ai confini del sistema;
- configurazione degli ambienti tipizzata e fail-fast;
- logging strutturato con regole di redazione;
- una suite minima di test e quality gate automatici;
- un workflow controllato per Preview e Production su Vercel;
- documentazione operativa, sicurezza di base e rollback verificabile.

Foundation V1 deve ridurre il rischio delle fasi successive rendendo osservabili, testabili e reversibili le modifiche.

## 2. Scope incluso nel milestone

**RACCOMANDAZIONE.** Lo scope funzionale deve rimanere intenzionalmente stretto.

### Fondazione applicativa

- verifica della build esistente dopo installazione autorizzata e riproducibile delle dipendenze;
- conferma delle convenzioni effettive di Next.js 16.2.4 attraverso la documentazione installata prima di cambiare codice;
- separazione tra UI, casi d'uso, dominio e infrastruttura;
- layout applicativo minimo, navigazione e pagine di stato;
- rimozione dal percorso attivo di dati cliente hardcoded e promesse funzionali fuorvianti;
- mantenimento del prototipo legacy come riferimento storico, non come servizio operativo.

### Identità e autorizzazione

- autenticazione utente con sessione server-side;
- logout e gestione degli stati non autenticati;
- modello minimo di organizzazione/workspace;
- associazione obbligatoria delle risorse all'organizzazione;
- ruolo iniziale minimo, da approvare, con autorizzazioni verificate lato server;
- protezione delle route e dei casi d'uso riservati.

### Dati e documenti

- database relazionale con migrazioni versionate;
- entità minime per utente, organizzazione, appartenenza, documento e audit event;
- registrazione dei metadati di un documento;
- upload di PDF nello storage tramite meccanismo controllato;
- validazione di tipo, dimensione e ownership;
- download autorizzato tramite accesso temporaneo;
- eliminazione logica o stato di cancellazione, in attesa della policy definitiva;
- checksum per integrità e deduplicazione tecnica di base;
- nessuna estrazione del contenuto del documento.

### Qualità e operazioni

- schema tipizzato delle variabili d'ambiente;
- logging strutturato senza contenuti documentali o PII non necessaria;
- gestione uniforme degli errori e correlation/request ID dove tecnicamente applicabile;
- test unitari, integrazione e smoke end-to-end del percorso Foundation;
- CI con lint, typecheck, test e build;
- ambienti Local, Preview e Production separati;
- runbook minimo di deploy e rollback.

## 3. Funzionalità esplicitamente escluse

**DECISIONE DI SCOPE PROPOSTA, DA APPROVARE.** Le seguenti funzionalità sono fuori da Foundation V1:

- OCR di bollette o altri documenti;
- estrazione di CTE, sia tramite regex sia tramite AI o servizi documentali;
- importazione, sincronizzazione o validazione dei dati PUN;
- motore di simulazione economica;
- motore GAS;
- generazione di report commerciali, preventivi o classifiche di offerte;
- calcolo completo di imposte, componenti regolate o condizioni tariffarie;
- classificazione automatica della migliore offerta;
- addestramento, valutazione o gestione di modelli AI;
- code di elaborazione documentale dedicate all'OCR;
- copertura universale di fornitori e formati PDF;
- fatturazione della piattaforma;
- integrazioni CRM o gestionali;
- rollout pubblico senza utenti e organizzazioni controllati.

Il documento può essere caricato, registrato, elencato, scaricato ed eliminato secondo autorizzazione; non viene letto, interpretato o trasformato in dati energetici durante questo milestone.

## 4. Principi architetturali

**RACCOMANDAZIONE.**

1. **Confini espliciti.** UI, applicazione, dominio e infrastruttura non condividono responsabilità.
2. **Server come autorità.** Autenticazione, autorizzazione, accesso dati e accesso documenti sono verificati sul server.
3. **Validazione ai confini.** Nessun input esterno raggiunge dominio o persistenza senza validazione runtime.
4. **Deny by default.** Una risorsa non viene restituita se ownership e autorizzazione non sono dimostrate.
5. **Tenant scope obbligatorio.** Ogni query su risorse organizzative include esplicitamente il tenant.
6. **Dipendenze verso l'interno.** Il dominio non dipende da framework, provider o SDK esterni.
7. **Adapter sostituibili.** Database, autenticazione, storage e logging sono raggiunti tramite interfacce applicative limitate.
8. **Migrazioni additive.** Le modifiche dati privilegiano compatibilità in avanti e rollout progressivi.
9. **Osservabilità senza esposizione.** Log utili operativamente, ma privi di documenti, token, segreti e PII non indispensabile.
10. **Configurazione fail-fast.** Variabili mancanti o incoerenti bloccano l'avvio in modo esplicito.
11. **Testabilità.** La logica di dominio e autorizzazione è verificabile senza dipendere dalla UI.
12. **Reversibilità.** Ogni fase ha rollback documentato e commit piccoli.
13. **Nessun fallback plausibile.** Errori e dati mancanti restano errori, non diventano valori inventati.
14. **Minimo privilegio e minima raccolta.** Si archiviano solo dati necessari allo scope approvato.
15. **Documentazione prima dell'espansione.** Le decisioni strutturali sono registrate in ADR prima dell'adozione.

## 5. Struttura modulare proposta

**RACCOMANDAZIONE CON VALIDAZIONE OBBLIGATORIA.** La struttura seguente è concettuale. Prima di implementarla deve essere confrontata con la documentazione installata di Next.js 16.2.4, come richiesto da `AGENTS.md`.

```text
app/
  (public)/
    login/
  (protected)/
    dashboard/
    documents/
  api/
    health/
  layout.tsx
  error.tsx
  not-found.tsx

src/
  modules/
    identity/
      application/
      domain/
      infrastructure/
      ui/
    organizations/
      application/
      domain/
      infrastructure/
      ui/
    documents/
      application/
      domain/
      infrastructure/
      ui/
  shared/
    application/
    domain/
    infrastructure/
    ui/
    validation/
    observability/
    config/

db/
  migrations/
  schema/

tests/
  fixtures/
  integration/
  e2e/

docs/
  adr/
  runbooks/
  security/
```

Regole proposte:

- `app/` contiene routing e composizione, non regole di business;
- ogni modulo espone un'API pubblica minima;
- `domain/` contiene entità, value object e policy senza SDK esterni;
- `application/` contiene casi d'uso e porte;
- `infrastructure/` contiene adapter per servizi approvati;
- `ui/` contiene componenti specifici del modulo;
- `shared/` ospita solo primitive realmente condivise, evitando un contenitore generico;
- test vicini al codice per le unità e cartelle dedicate per integrazione ed E2E;
- non viene creata una cartella OCR o simulation in Foundation V1.

## 6. Layer applicativi richiesti

### Presentazione

Responsabilità:

- rendering e interazione;
- accessibilità e localizzazione italiana;
- invocazione dei casi d'uso;
- visualizzazione di stati espliciti di caricamento, errore e successo.

Non deve contenere query dirette al database, SDK storage o regole di autorizzazione definitive.

### Applicazione

Responsabilità:

- orchestrazione dei casi d'uso;
- verifica delle policy tramite porte dedicate;
- transazioni applicative;
- conversione tra DTO validati e dominio;
- emissione di audit event.

Casi d'uso minimi proposti:

- creare o inizializzare un'organizzazione secondo il modello approvato;
- ottenere il profilo e il contesto organizzativo corrente;
- registrare un upload;
- confermare il completamento di un upload;
- elencare i documenti accessibili;
- ottenere un accesso temporaneo autorizzato;
- richiedere la cancellazione di un documento.

### Dominio

Responsabilità:

- identità delle entità;
- stati validi del documento;
- ownership organizzativa;
- invarianti e transizioni consentite;
- errori di dominio stabili.

Non comprende campi estratti da bollette, CTE, PUN o simulazioni in questa fase.

### Infrastruttura

Responsabilità:

- implementazioni di repository e transazioni;
- adapter autenticazione;
- adapter object storage;
- logging e telemetria;
- integrazione con runtime e provider esterni.

### Persistenza

Responsabilità:

- schema e migrazioni;
- vincoli di unicità e integrità referenziale;
- query tenant-scoped;
- indici misurati sui casi d'uso reali;
- strategia di backup e ripristino concordata con il provider.

## 7. Requisiti trasversali

### Database

**RACCOMANDAZIONE.** Usare un database relazionale compatibile con transazioni, vincoli e migrazioni versionate.

Requisiti minimi:

- ambienti Preview e Production separati;
- credenziali distinte e a privilegio minimo;
- migrazioni ripetibili e revisionate;
- chiavi esterne e vincoli applicabili al modello;
- tenant ID obbligatorio sulle risorse organizzative;
- date in UTC e timezone di presentazione esplicita;
- backup e ripristino documentati prima della Production;
- nessuna modifica distruttiva automatica nel percorso di deploy;
- dati seed esclusivamente sintetici.

### Autenticazione e autorizzazione

Requisiti minimi:

- sessioni protette e validate lato server;
- cookie con attributi sicuri quando applicabili;
- protezione CSRF coerente con il meccanismo scelto;
- logout e revoca secondo capacità del provider;
- nessun token sensibile esposto nei log o nel client;
- autorizzazione per organizzazione su ogni caso d'uso;
- test negativi cross-tenant;
- modello ruoli minimo approvato prima dell'implementazione.

### Storage documentale

Requisiti minimi:

- bucket/container non pubblico;
- cifratura in transito e a riposo secondo capacità documentate del servizio;
- chiavi logiche non derivate direttamente dal nome del file;
- URL firmati o accesso mediato con scadenza breve;
- controllo server-side di dimensione, MIME dichiarato e firma del file;
- allowlist iniziale limitata ai PDF;
- checksum registrato;
- separazione tra ambienti;
- policy di retention e cancellazione da approvare;
- nessun contenuto del documento nei log;
- scansione antimalware: decisione e livello di blocco da approvare prima di accettare documenti non controllati.

### Validazione

Requisiti minimi:

- schema runtime per variabili d'ambiente, parametri, form e risposte infrastrutturali rilevanti;
- limiti espliciti su stringhe, file e paginazione;
- errori stabili e non contenenti dettagli interni;
- validazione indipendente dai tipi TypeScript;
- test per input validi, invalidi e limite;
- nessuna correzione silenziosa di input non valido.

### Logging e osservabilità

Requisiti minimi:

- log strutturati con livello, timestamp, ambiente, evento e correlation ID;
- redazione centralizzata di cookie, authorization header, token, segreti e PII;
- eventi di sicurezza e audit distinti dai log diagnostici;
- nessun PDF, testo estratto o payload completo nei log;
- error tracking con environment e release identificabili;
- health check che non riveli configurazioni o dipendenze sensibili;
- metriche minime su errori, latenza, upload riusciti/falliti e accessi negati;
- policy di retention dei log da approvare.

### Testing

Requisiti minimi:

- test unitari per dominio e validazione;
- test d'integrazione per database, repository, autorizzazione e storage adapter;
- test E2E per login e ciclo documentale senza OCR;
- test negativi per accesso cross-tenant e file non ammessi;
- build di produzione verificata in CI;
- fixture esclusivamente sintetiche e prive di dati cliente;
- test riproducibili senza dipendere dalla Production.

### Gestione degli ambienti

Requisiti minimi:

- ambienti Local, Test/CI, Preview e Production distinti;
- file `.env*` non tracciati, salvo eventuale esempio privo di valori sensibili;
- schema delle variabili e documentazione dello scopo di ciascuna;
- segreti inseriti nel secret store della piattaforma, non nel repository;
- credenziali, database e storage separati tra Preview e Production;
- rotazione documentata;
- nessun fallback automatico da Preview verso risorse Production;
- controllo fail-fast all'avvio per variabili mancanti.

## 8. Decisioni tecniche che richiedono approvazione del proprietario

**DECISIONI PENDENTI.** Nessuna delle seguenti scelte è definita dal repository o da `PROJECT_AUDIT.md`:

1. Provider e regione del database.
2. ORM/query builder e formato delle migrazioni.
3. Provider di autenticazione.
4. Modello di onboarding: invito, self-service o provisioning amministrativo.
5. Modello ruoli iniziale e responsabilità dell'amministratore organizzativo.
6. Provider e regione dello storage documentale.
7. Dimensione massima, numero massimo di documenti e quote per organizzazione.
8. Retention, cancellazione, eventuale legal hold e tempi di purge.
9. Requisiti di scansione antimalware e quarantena.
10. Provider di logging/error tracking e durata di conservazione.
11. Framework di test unitario/integration ed E2E.
12. Strategia di isolamento dei dati Preview.
13. Processo di approvazione e promozione in Production.
14. Requisiti geografici, contrattuali e organizzativi sul trattamento dei dati.
15. RPO, RTO e responsabilità operative.
16. Politica di feature flag.
17. Compatibilità browser e requisiti di accessibilità da adottare.
18. Dominio, branding e messaggi da mostrare al posto delle promesse OCR/simulazione del prototipo.

Le decisioni con impatto privacy, contrattuale o regolatorio devono essere validate dal proprietario con le figure competenti; il repository non fornisce elementi sufficienti per determinarle.

## 9. Alternative per i servizi esterni non ancora decisi

Le alternative sono presentate senza preferenza definitiva. Prima della scelta occorre confrontare regione, costi, limiti, lock-in, gestione operativa, integrazione con Vercel e requisiti organizzativi.

| Area | Alternative da valutare | Criteri di decisione |
|---|---|---|
| Database PostgreSQL gestito | Vercel Postgres tramite integrazione disponibile; Neon; Supabase Postgres; AWS RDS/Aurora; Google Cloud SQL; Azure Database for PostgreSQL | Regione, pooling, backup/PITR, migrazioni, costi Preview, SLA, operatività |
| Accesso database | Prisma; Drizzle ORM; driver PostgreSQL con query layer interno; Kysely | Compatibilità Next.js/runtime, migrazioni, tipizzazione, controllo SQL, manutenzione |
| Autenticazione | Auth.js; Clerk; WorkOS; Auth0; Supabase Auth; provider OIDC aziendale | SSO futuro, sessioni server, organizzazioni, MFA, audit, regione, costo |
| Object storage | Vercel Blob; Amazon S3; Cloudflare R2; Google Cloud Storage; Azure Blob Storage; Supabase Storage | Regione, cifratura, URL firmati, lifecycle, egress, audit, scansione |
| Error tracking | Sentry; provider OpenTelemetry compatibile; Datadog; New Relic; Azure Application Insights | Redazione PII, sampling, retention, integrazione release, costi |
| Log centralizzati | Axiom; Better Stack; Datadog Logs; Grafana Cloud; cloud logging del provider scelto | Query, redazione, retention, alert, correlazione, costo |
| Test unitari/integration | Vitest; Jest; Node.js test runner, se compatibile con stack e requisiti | Integrazione TypeScript/Next.js, velocità, mocking, ecosistema |
| Test E2E | Playwright; Cypress | Browser richiesti, parallelismo, trace, stabilità in CI |
| Antimalware documenti | ClamAV gestito internamente; servizio di scanning cloud; pipeline nativa del cloud scelto; quarantena manuale nel pilot | Accuratezza, latenza, isolamento, aggiornamenti firme, costo, responsabilità operativa |
| Feature flag | Configurazione interna minimale; Vercel Flags/integrazione equivalente; LaunchDarkly; Unleash | Audit, targeting, rollback, costo, lock-in |
| Email transazionali | Resend; Postmark; Amazon SES; provider aziendale | Deliverability, regione, template, audit, dominio, costo |

La presenza di un'alternativa nella tabella non certifica che soddisfi i requisiti: serve una valutazione aggiornata al momento della decisione e basata su documentazione contrattuale e tecnica ufficiale.

## 10. Sequenza di implementazione raccomandata

### Fase 0 — Decisioni e verifica della baseline

- approvare scope e fuori scope;
- risolvere le decisioni bloccanti su database, auth, storage e ambienti;
- leggere le guide installate di Next.js 16.2.4 rilevanti;
- installare dipendenze solo dopo autorizzazione;
- eseguire build, lint e typecheck del baseline;
- registrare problemi preesistenti senza mascherarli.

### Fase 1 — Guardrail e struttura

- definire comandi di verifica riproducibili;
- introdurre struttura modulare minima;
- configurare test runner e CI;
- introdurre configurazione ambiente tipizzata;
- aggiungere error handling e health check minimi.

### Fase 2 — Dominio organizzativo e database

- creare ADR per database e access layer;
- modellare utente, organizzazione, membership e audit event;
- creare migrazioni additive;
- implementare repository tenant-scoped;
- testare vincoli, transazioni e isolamento.

### Fase 3 — Autenticazione e autorizzazione

- integrare il provider approvato;
- proteggere route e casi d'uso;
- implementare contesto organizzativo;
- testare login, logout, sessione e accessi negati;
- aggiungere audit event essenziali.

### Fase 4 — Storage e ciclo documentale senza elaborazione

- creare ADR per storage e lifecycle;
- definire stati del documento;
- implementare upload controllato e checksum;
- registrare metadati e ownership;
- implementare elenco, accesso temporaneo ed eliminazione;
- testare file invalidi, limiti e isolamento cross-tenant.

### Fase 5 — Osservabilità e sicurezza operativa

- logging strutturato e redazione;
- error tracking e metriche minime;
- security header approvati;
- rate limit sui punti sensibili;
- runbook per incidenti, deploy e rollback;
- verifica dei log per assenza di segreti e contenuti documento.

### Fase 6 — Preview, hardening e Production readiness

- configurare Preview isolata;
- eseguire test completi e smoke test;
- verificare migrazioni e rollback in ambiente non produttivo;
- revisione accessibilità e sicurezza;
- approvazione manuale del proprietario;
- deploy controllato in Production con monitoraggio.

## 11. Sequenza esatta di commit piccoli e revisionabili

**RACCOMANDAZIONE.** Ogni commit deve passare i controlli applicabili al proprio contenuto. I nomi sono proposti e possono essere approvati o modificati prima di iniziare.

1. `docs: record foundation architecture decisions`
   - ADR iniziali per scope, layering e decisioni provider approvate.
2. `chore: establish verification scripts and ci checks`
   - script lint, typecheck, test e build; pipeline CI senza cambi funzionali.
3. `refactor: introduce modular application boundaries`
   - sole cartelle, boundary e spostamenti meccanici revisionabili.
4. `chore: add typed environment validation`
   - schema environment, esempio senza segreti e test fail-fast.
5. `test: add foundation unit test harness`
   - runner, convenzioni e primi test di validazione.
6. `feat: add organization domain model`
   - entità e policy pure, senza provider.
7. `feat: add database schema and initial migration`
   - schema minimo e migrazione additiva.
8. `feat: add tenant-scoped repositories`
   - porte, adapter e test di integrazione database.
9. `feat: integrate approved authentication provider`
   - sessione, login/logout e adapter del provider scelto.
10. `feat: enforce organization authorization`
    - protezione server-side e test negativi cross-tenant.
11. `feat: add document metadata lifecycle`
    - dominio documento e casi d'uso, senza file storage.
12. `feat: add private document storage adapter`
    - upload/download temporaneo, validazioni e checksum.
13. `feat: add authorized document management ui`
    - elenco, upload, download ed eliminazione senza OCR.
14. `chore: add structured logging and audit events`
    - log redatti, correlation ID ed eventi essenziali.
15. `test: add foundation integration and e2e coverage`
    - percorsi positivi, errori e isolamento tenant.
16. `chore: define preview and production safeguards`
    - documentazione e controlli deploy, senza segreti nel repository.
17. `docs: add foundation operations and rollback runbooks`
    - runbook, limitazioni e checklist Production.
18. `chore: complete foundation v1 release readiness`
    - solo correzioni residue piccole e verifiche finali documentate.

Non si devono combinare in un singolo commit migrazioni distruttive, integrazione auth, storage e refactor UI. Se un commit richiede troppe modifiche per essere revisionato con sicurezza, deve essere ulteriormente suddiviso.

## 12. Criteri di accettazione per ogni fase

| Fase | Criteri di accettazione |
|---|---|
| 0 — Decisioni e baseline | Scope firmato dal proprietario; decisioni bloccanti registrate; guide Next.js lette; baseline build/lint/typecheck eseguito oppure problemi preesistenti documentati; nessun file cliente usato come fixture |
| 1 — Guardrail e struttura | CI attiva; configurazione ambiente validata; struttura rispetta i confini; nessun comportamento energetico nuovo; test minimi verdi |
| 2 — Dominio e database | Migrazione applicabile su database vuoto; vincoli verificati; repository richiedono tenant; test transazionali e cross-tenant verdi; rollback o strategia forward-fix documentata |
| 3 — Auth e autorizzazione | Login/logout funzionanti in ambiente non produttivo; sessioni validate sul server; route protette; accessi non autorizzati e cross-tenant negati nei test; nessun token nei log |
| 4 — Documenti | Solo PDF entro limiti approvati; storage privato; checksum e metadati persistiti; elenco/download/delete rispettano ownership; nessuna estrazione o OCR; errori espliciti e testati |
| 5 — Osservabilità e sicurezza | Log strutturati e redatti; audit event minimi presenti; metriche/error tracking operativi; header e rate limit verificati; nessun contenuto PDF nei log |
| 6 — Preview e Production readiness | Preview isolata; suite completa verde; migrazioni provate; smoke test documentato; rollback provato in ambiente non produttivo; approvazione manuale prima della Production |

Un criterio non verificabile deve essere trasformato in un test, una checklist con evidenza o una decisione esplicita; non può essere considerato superato per presunzione.

## 13. Baseline di sicurezza e privacy

**RACCOMANDAZIONE.** Questa baseline tecnica non sostituisce la valutazione legale o organizzativa del proprietario.

### Controlli obbligatori prima della Preview condivisa

- autenticazione e autorizzazione server-side;
- segregazione degli ambienti;
- storage non pubblico;
- TLS tramite piattaforma e servizi scelti;
- segreti fuori dal repository;
- validazione file e limiti applicativi;
- protezione dagli accessi cross-tenant;
- redazione centralizzata dei log;
- dipendenze bloccate e controllate in CI;
- dataset e account di test sintetici.

### Controlli obbligatori prima della Production

- policy approvata per accesso, retention, cancellazione e backup;
- regione dei servizi approvata;
- inventario dei dati trattati e delle finalità validato dal proprietario;
- ruoli e responsabilità operative definiti;
- scansione documentale o misura alternativa formalmente approvata;
- rate limit e protezioni degli endpoint sensibili;
- backup e ripristino provati;
- audit event per accessi e operazioni rilevanti;
- procedura di incidente e contatti di escalation;
- verifica che log, error tracking e analytics non raccolgano documenti o PII non necessaria;
- revisione aggiornata delle dipendenze e configurazioni.

### Regole sui dati

- minimizzare metadati e durata di conservazione;
- usare identificatori opachi;
- non usare dati cliente reali in test, Preview, demo o log;
- non copiare documenti Production in ambienti inferiori;
- rendere esplicita la cancellazione logica e fisica;
- tracciare chi ha effettuato operazioni sensibili senza registrare il contenuto del documento;
- non promettere conformità normativa sulla sola base di controlli tecnici.

## 14. Strategia di testing

### Piramide proposta

1. **Test statici**
   - TypeScript strict;
   - ESLint/Core Web Vitals;
   - controllo formattazione se approvato;
   - build Next.js di produzione.
2. **Test unitari**
   - value object e transizioni documento;
   - policy organizzative;
   - validazione input e environment;
   - mapping degli errori;
   - redazione dei log.
3. **Test d'integrazione**
   - migrazioni e repository;
   - transazioni e vincoli;
   - adapter auth con modalità di test supportata;
   - storage adapter contro ambiente isolato o emulatore affidabile;
   - accesso tenant-scoped.
4. **Test E2E**
   - login e logout;
   - accesso alla pagina protetta;
   - upload di PDF sintetico valido;
   - rifiuto di file invalido o sovradimensionato;
   - elenco e download autorizzato;
   - eliminazione;
   - tentativo di accesso cross-tenant negato.
5. **Smoke test di deploy**
   - health check;
   - autenticazione;
   - accesso database;
   - ciclo documento sintetico;
   - verifica assenza di errori critici nei log.

### Dati di test

- solo account, organizzazioni e PDF sintetici;
- nessun identificativo cliente reale;
- fixture piccole, deterministiche e versionate;
- documenti limite per dimensione e struttura;
- cleanup sicuro dopo i test, limitato all'ambiente di test.

### Quality gate proposto

Una modifica non è promuovibile se falliscono lint, typecheck, test richiesti o build. Eccezioni temporanee richiedono approvazione esplicita, motivazione, owner e scadenza; non devono diventare bypass permanenti.

## 15. Workflow Vercel Preview e Production

**FATTO VERIFICATO.** Nel repository auditato non sono presenti `vercel.json` o configurazioni `.vercel` tracciate. Il piano non modifica la configurazione Vercel e non assume che un progetto Vercel sia già collegato.

**RACCOMANDAZIONE SOGGETTA AD APPROVAZIONE.**

### Preview

1. Ogni branch o pull request autorizzata esegue prima la CI.
2. Solo dopo i quality gate viene creato o considerato valido il deployment Preview.
3. La Preview usa credenziali, database e storage separati dalla Production.
4. Non contiene copie di dati o documenti Production.
5. Le migrazioni Preview operano solo sul database Preview assegnato.
6. L'accesso alla Preview deve essere ristretto secondo le capacità e il piano Vercel approvati.
7. Gli smoke test usano identità e file sintetici.
8. L'URL Preview e l'esito dei test vengono collegati alla revisione.

### Promozione in Production

1. Pull request revisionata e quality gate verdi.
2. Decisioni e migrazioni approvate.
3. Backup/verifica di ripristino completati secondo il runbook.
4. Merge nel branch di produzione solo tramite processo approvato; Foundation V1 non definisce automaticamente che tale branch debba essere `main`.
5. Deploy Production con approvazione manuale del proprietario.
6. Migrazioni additive eseguite secondo ordine documentato.
7. Smoke test immediato con dati sintetici o test non invasivi.
8. Monitoraggio rafforzato nella finestra successiva al deploy.
9. Rollback o forward-fix se vengono superate le soglie approvate.

### Separazione della configurazione

- variabili Vercel distinte per Development, Preview e Production;
- nessun segreto copiato nel repository;
- nomi delle variabili documentati senza valori;
- accesso alle impostazioni Production limitato;
- modifica delle impostazioni Vercel trattata come change operativo revisionabile e fuori da questo documento.

## 16. Strategia di rollback

**RACCOMANDAZIONE.**

### Applicazione

- conservare l'ultimo deployment Production noto come stabile;
- usare deploy immutabili e identificare release/commit nei log;
- disabilitare funzionalità rischiose tramite feature flag approvate;
- poter ripromuovere la release precedente senza ricostruire artefatti diversi, se supportato dal workflow scelto.

### Database

- preferire migrazioni additive ed espansione/contrazione;
- non rimuovere o reinterpretare colonne nello stesso deploy che cambia il codice;
- mantenere temporaneamente compatibilità tra versione nuova e precedente;
- testare migrazione su copia sintetica o ambiente isolato;
- definire per ogni migrazione se il rollback è reversibile o richiede forward-fix;
- eseguire backup secondo il runbook prima di operazioni approvate ad alto rischio.

### Storage

- non cancellare fisicamente un oggetto durante il primo passaggio applicativo, finché la policy non è approvata;
- usare stati espliciti e job di purge separati, solo se successivamente approvati;
- non sovrascrivere oggetti esistenti;
- registrare checksum e chiave storage per riconciliazione.

### Criteri di attivazione

Soglie esatte sono una **DECISIONE PENDENTE**. Devono almeno considerare:

- aumento degli errori applicativi;
- fallimenti di login o autorizzazione;
- accesso cross-tenant;
- impossibilità di caricare o recuperare documenti;
- errori di migrazione;
- esposizione di dati o segreti;
- degrado di latenza oltre la soglia approvata.

Un sospetto accesso cross-tenant o una possibile esposizione di dati richiede blocco della funzionalità interessata ed escalation, non il solo monitoraggio.

## 17. Rischi principali e mitigazioni

| Rischio | Evidenza o natura | Mitigazione proposta |
|---|---|---|
| Trasformare il prototipo in produzione senza confini | Verificato: logica monolitica client | Separazione incrementale, commit piccoli, mantenimento del legacy come riferimento |
| Scope creep verso OCR e simulazione | Rischio di progetto | Fuori scope esplicito, acceptance gate e nessun modulo dedicato in V1 |
| Scelta prematura del vendor | Requisiti proprietario mancanti | ADR, confronto alternative e approvazione prima dell'SDK |
| Lock-in infrastrutturale | Rischio architetturale | Porte limitate, adapter e dominio indipendente |
| Accesso cross-tenant | Rischio critico del modello organizzativo | Tenant scope server-side, deny by default e test negativi |
| Esposizione di PDF o metadati | Natura sensibile dei documenti | Storage privato, URL brevi, logging redatto e separazione ambienti |
| Dati reali nei test | Audit rileva dati dall'aspetto realistico nel prototipo | Fixture sintetiche obbligatorie e divieto di copia Production |
| Migrazioni non reversibili | Rischio operativo | Migrazioni additive, expand/contract e prova in Preview |
| Build baseline sconosciuta | Verificato: dipendenze assenti durante audit | Verifica baseline come Fase 0, prima dei refactor |
| Uso errato di API Next.js 16 | Regole repository segnalano breaking changes | Lettura obbligatoria delle guide installate prima del codice |
| Segreti o PII nei log | Rischio trasversale | Schema log, redazione centralizzata e test automatici |
| Costi non controllati dei servizi | Decisioni vendor pendenti | Quote iniziali, alert di costo, limiti e revisione mensile |
| Preview collegata alla Production | Rischio di configurazione | Risorse e credenziali separate, fail-fast e test di isolamento |
| Rollback applicativo incompatibile col DB | Rischio di deploy | Compatibilità N/N-1 e migrazioni additive |
| Falsa percezione di capacità energetiche | UI legacy mostra promesse non reali | Messaggi espliciti, rimozione del percorso attivo e scope documentato |

## 18. Definition of Done di Foundation V1

Foundation V1 è completata solo quando tutte le condizioni seguenti sono dimostrate:

- scope e decisioni bloccanti approvati dal proprietario;
- architettura e scelte provider registrate in ADR;
- guide pertinenti di Next.js 16.2.4 lette prima dell'implementazione;
- codice organizzato secondo layer revisionabili;
- nessun dato cliente hardcoded nel percorso applicativo Foundation;
- autenticazione, logout e sessione server-side funzionanti;
- risorse organizzative protette da autorizzazione tenant-scoped;
- database versionato con migrazioni provate;
- storage privato con validazione, checksum e accesso temporaneo;
- ciclo documento limitato a upload, metadati, elenco, download ed eliminazione autorizzata;
- nessun OCR, estrazione CTE, PUN, simulazione, GAS o report commerciale implementato;
- variabili d'ambiente tipizzate e separate per ambiente;
- nessun segreto nel repository o nei log;
- logging, error tracking, audit event e metriche minime operativi;
- test unitari, integrazione, E2E e smoke previsti risultano verdi;
- lint, typecheck e build Production risultano verdi in CI;
- test cross-tenant negativi risultano verdi;
- Preview isolata verificata con dati sintetici;
- backup/ripristino e rollback provati secondo lo scope approvato;
- runbook di deploy, rollback e incidente revisionati;
- limitazioni visibili e documentate;
- approvazione finale del proprietario registrata prima della promozione Production.

Il completamento delle attività senza evidenze verificabili non soddisfa la Definition of Done.

## 19. Confine esplicito del primo milestone

**OCR, estrazione CTE, importazione PUN, motore di simulazione, motore GAS e report commerciali sono esplicitamente fuori da Foundation V1.**

Foundation V1 realizza esclusivamente le fondamenta applicative e il ciclo sicuro del documento senza interpretazione del contenuto. Queste funzionalità energetiche potranno essere pianificate soltanto in milestone successive, con requisiti, dataset, criteri di accuratezza, fonti e responsabilità approvati separatamente.

Non devono essere introdotti in modo parziale, nascosto o presentati come demo operativa all'interno dei commit Foundation V1.

## 20. Prossima decisione richiesta prima di modificare il codice applicativo

**DECISIONE PENDENTE E BLOCCANTE.** Prima di qualsiasi modifica al codice applicativo, il proprietario deve approvare un breve documento decisionale che definisca almeno:

1. conferma dello scope e dei fuori scope di Foundation V1;
2. modello iniziale di utente, organizzazione, membership e ruoli;
3. requisiti di regione e trattamento dei dati;
4. alternative da portare a proof of concept per database, autenticazione e storage;
5. limiti iniziali dei documenti e policy preliminare di retention/cancellazione;
6. workflow di branch, Preview, approvazione e Production;
7. criteri con cui scegliere i provider dopo la prova tecnica.

La prima decisione operativa raccomandata è autorizzare una **fase di discovery tecnica senza funzionalità di prodotto**, limitata a:

- lettura delle guide installate di Next.js 16.2.4;
- installazione riproducibile delle dipendenze esistenti;
- verifica della baseline con lint, typecheck e build;
- stesura degli ADR comparativi per database, autenticazione e storage;
- nessun collegamento a risorse Production;
- nessuna modifica al comportamento OCR, CTE, PUN o simulazione.

Fino a tale approvazione, questo documento non autorizza l'avvio delle modifiche al codice applicativo.
