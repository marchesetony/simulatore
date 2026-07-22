# Decisioni del Product Owner — Foundation V1

Data di approvazione: **22 luglio 2026**  
Stato del documento: **AUTORITATIVO PER I FUTURI TASK CODEX**

## Finalità e autorità del documento

Questo documento registra esclusivamente le decisioni esplicitamente approvate dal Product Owner per Foundation V1.

Le decisioni riportate di seguito sono vincolanti per la pianificazione, la progettazione e i futuri task Codex relativi al progetto. In caso di conflitto con proposte, raccomandazioni o opzioni ancora aperte contenute in altri documenti, prevalgono le decisioni approvate in questo documento. Gli elementi indicati come ancora soggetti ad approvazione non devono essere interpretati come decisioni già assunte.

Questo documento non autorizza, da solo, l'avvio di modifiche al codice applicativo, l'installazione di dipendenze, la selezione di fornitori esterni o modifiche alla configurazione Git o Vercel.

## Decisione 1 — Perimetro di Foundation V1

**APPROVED BY PRODUCT OWNER**

### Funzionalità incluse

Foundation V1 include esclusivamente:

- fondamenta applicative professionali e modulari;
- autenticazione e autorizzazione;
- organizzazioni e utenti;
- database e migrazioni;
- storage documentale protetto;
- caricamento, elenco, accesso, ciclo di vita e cancellazione controllata dei documenti;
- validazione runtime;
- audit logging;
- fondamenta per gestione degli errori e monitoraggio;
- separazione degli ambienti Local, CI/Test, Preview e Production;
- test automatizzati;
- procedure CI/CD e di rollback.

### Funzionalità esplicitamente escluse

Foundation V1 esclude esplicitamente:

- OCR delle bollette;
- estrazione automatica delle CTE;
- importazione del PUN GME;
- formule di simulazione dell'energia elettrica;
- motore di simulazione GAS;
- ranking delle offerte;
- generazione di proposte commerciali.

### Conseguenze per l'architettura

Questa decisione comporta che:

- l'architettura di Foundation V1 deve concentrarsi su identità, autorizzazione, tenancy, persistenza, documenti, validazione, osservabilità, test e operazioni;
- i moduli applicativi devono avere responsabilità separate e confini espliciti;
- il ciclo documentale deve arrestarsi alla gestione protetta del file e dei relativi metadati, senza interpretarne il contenuto;
- non devono essere introdotti moduli, API, job o interfacce presentati come OCR, estrazione CTE, importazione PUN o simulazione;
- i risultati simulati o hardcoded del prototipo non devono essere trattati come funzionalità Foundation V1;
- database, storage, autenticazione, logging e ambienti devono essere progettati per controlli server-side, testabilità e rollback;
- qualsiasi milestone energetica successiva dovrà avere scope, dati, criteri di accuratezza e approvazione separati.

## Decisione 2 — Modello di business SaaS multi-tenant

**APPROVED BY PRODUCT OWNER**

L'applicazione deve essere progettata come piattaforma SaaS multi-tenant con tre livelli di responsabilità.

### 1. Platform Owner / SaaS Operator

Il Platform Owner / SaaS Operator:

- crea e gestisce le aziende clienti;
- assegna piani e limiti contrattuali;
- attiva, sospende, blocca o riattiva le aziende;
- definisce il numero massimo di agenti attivi;
- abilita o disabilita funzionalità;
- gestisce data di inizio del contratto, data di scadenza, proroghe e restrizioni personalizzate;
- può bloccare o limitare l'utilizzo in base allo stato del pagamento o dell'abbonamento.

### 2. Customer Company / Tenant

La Customer Company / Tenant:

- dispone di un workspace logicamente isolato;
- gestisce gli utenti della propria rete commerciale;
- invita, attiva, disattiva o sostituisce agenti;
- assegna permessi entro i limiti stabiliti dal Platform Owner;
- non può superare il numero autorizzato di agenti attivi;
- può accedere esclusivamente alle funzionalità abilitate dal proprio piano.

### 3. Sales Network User / Agent

Il Sales Network User / Agent:

- appartiene a una sola azienda cliente;
- accede esclusivamente ai dati e alle funzionalità autorizzati;
- può essere soggetto a restrizioni basate su ruolo, assegnazione, policy aziendale e piano di abbonamento.

### Capacità minime richieste

Il software deve supportare almeno:

- stato del tenant;
- piano assegnato;
- numero massimo di utenti o agenti attivi;
- conteggio corrente degli utenti attivi;
- funzionalità abilitate;
- data di inizio del contratto;
- data di scadenza del contratto;
- stato di sospensione o periodo di grazia;
- restrizioni contrattuali personalizzate;
- conservazione dei dati quando l'accesso è sospeso;
- enforcement lato server, non soltanto nell'interfaccia utente.

### Pagamenti e fondamenta contrattuali

La riscossione iniziale dei pagamenti può essere gestita manualmente.

Foundation V1 deve comunque includere il modello dati e le fondamenta di autorizzazione necessarie per applicare:

- abbonamenti;
- licenze;
- limiti al numero di utenti o agenti;
- entitlement delle funzionalità;
- sospensioni;
- accordi commerciali personalizzati.

### Conseguenze per l'architettura

Questa decisione comporta che:

- il sistema non può essere progettato come applicazione single-tenant o single-company hardcoded;
- aziende clienti, utenti, documenti, configurazioni e audit event devono avere ownership e tenant scope espliciti;
- il Platform Owner deve operare in un contesto distinto da quello delle aziende clienti;
- le query e i casi d'uso sulle risorse dei tenant devono applicare isolamento e autorizzazione lato server;
- devono esistere policy centrali per stato del tenant, stato contrattuale, limiti di licenza ed entitlement;
- il solo nascondimento di controlli nell'interfaccia non costituisce enforcement;
- l'attivazione di un agente deve verificare atomicamente il limite autorizzato;
- sospensione e blocco devono limitare l'accesso senza cancellare automaticamente i dati del tenant;
- piani, limiti, date contrattuali, proroghe, periodi di grazia e restrizioni personalizzate devono essere rappresentabili come dati versionabili o auditabili;
- il modello deve consentire pagamenti inizialmente gestiti fuori piattaforma senza confondere lo stato di pagamento con l'effettiva cancellazione dei dati;
- i test devono includere accessi cross-tenant negati, limiti utenti, funzionalità non abilitate, tenant sospesi e restrizioni personalizzate;
- log e audit event devono identificare attore, tenant, azione e risultato senza registrare segreti o contenuti documentali non necessari;
- Preview e Production devono usare dati, credenziali e risorse separate.

## Elementi ancora soggetti a futura approvazione

Le decisioni seguenti non sono assunte da questo documento e richiedono approvazione o un processo decisionale successivo:

### Prodotto e modello commerciale

- nomi, composizione e prezzi dei piani;
- unità e periodicità di fatturazione;
- regole esatte sullo stato dei pagamenti;
- durata e comportamento del periodo di grazia;
- condizioni precise di sospensione, blocco e riattivazione;
- comportamento alla scadenza del contratto;
- regole per proroghe, rinnovi e disdetta;
- limiti predefiniti e limiti personalizzati per piano;
- catalogo definitivo degli entitlement;
- eventuali funzionalità add-on;
- processo commerciale e operativo per l'approvazione delle eccezioni;
- futura automazione della riscossione dei pagamenti.

### Utenti, ruoli e autorizzazioni

- denominazione definitiva dei ruoli;
- matrice completa dei permessi del Platform Owner;
- ruoli interni alla Customer Company;
- possibilità che un utente appartenga in futuro a più tenant;
- regole di invito, provisioning, sostituzione e disattivazione degli agenti;
- requisiti MFA, SSO o identity federation;
- processo di recupero e revoca degli accessi.

### Dati e documenti

- limiti massimi di dimensione e quantità dei documenti;
- tipi di file ammessi oltre ai PDF, se previsti;
- durata della retention;
- tempi e modalità della cancellazione fisica;
- eventuali regole di legal hold;
- requisiti di backup, RPO e RTO;
- scansione antimalware e quarantena;
- classificazione definitiva dei dati e requisiti di trattamento;
- regioni ammesse per dati e servizi;
- condizioni per l'uso di dati reali in ambienti non produttivi.

### Tecnologia e fornitori

- provider del database;
- ORM o query layer e strumento di migrazione;
- provider o libreria di autenticazione;
- provider dello storage documentale;
- provider di error monitoring e logging;
- servizio email;
- framework di test unitari, integrazione ed end-to-end;
- soluzione per feature flag;
- configurazione concreta di CI/CD;
- configurazione Vercel Preview e Production;
- branch e workflow definitivo di promozione in Production.

### Milestone successive

- requisiti e provider OCR;
- strategia di estrazione delle CTE;
- fonti e processo di importazione del PUN GME;
- formule e criteri di validazione della simulazione elettrica;
- requisiti del motore GAS;
- criteri di ranking delle offerte;
- contenuto, responsabilità e formato delle proposte commerciali.

## Vincolo per i futuri task Codex

Questo documento è la fonte autoritativa per i futuri task Codex relativi al perimetro Foundation V1 e al modello SaaS multi-tenant.

I futuri task devono:

- rispettare le due decisioni indicate come **APPROVED BY PRODUCT OWNER**;
- non reintrodurre nello scope Foundation V1 le funzionalità esplicitamente escluse;
- non semplificare l'architettura in un modello single-tenant;
- non scegliere autonomamente elementi indicati come ancora soggetti a futura approvazione;
- distinguere sempre tra decisioni approvate, raccomandazioni tecniche e decisioni pendenti;
- fermarsi e richiedere approvazione quando un task dipende da una decisione non ancora assunta.

Eventuali modifiche future a queste decisioni devono essere approvate esplicitamente dal Product Owner e registrate in un documento autoritativo successivo.
