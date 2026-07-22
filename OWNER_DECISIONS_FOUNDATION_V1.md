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

## Decisione 3 — Ruoli utente iniziali

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

Foundation V1 deve includere i seguenti ruoli iniziali.

### 1. Platform Owner / Super Admin

Responsabilità e permessi:

- creare, attivare, sospendere, bloccare e riattivare le aziende clienti;
- assegnare piani, limiti contrattuali, limiti utenti e funzionalità abilitate;
- gestire date di inizio del contratto, date di scadenza, proroghe e restrizioni personalizzate;
- accedere ai controlli amministrativi e tecnici a livello di piattaforma;
- consultare gli audit log autorizzati;
- gestire gli aggiornamenti della piattaforma, inclusi:
  - aggiornamenti software;
  - attivazione progressiva di nuove funzionalità;
  - comunicazioni di manutenzione;
  - note di rilascio;
  - disabilitazione temporanea di funzionalità durante la manutenzione tecnica.

### 2. Tenant Admin

Responsabilità e permessi:

- gestire gli utenti appartenenti all'azienda cliente;
- invitare, attivare, disattivare e sostituire utenti;
- assegnare ruoli e permessi interni;
- visualizzare le licenze utenti disponibili e utilizzate;
- gestire la rete commerciale dell'azienda;
- accedere a tutti i dati autorizzati appartenenti al tenant;
- configurare restrizioni interne entro i limiti imposti dal Platform Owner.

Il Tenant Admin non può modificare piani commerciali, limiti contrattuali o impostazioni a livello di piattaforma.

### 3. Sales Manager / Coordinator

Responsabilità e permessi:

- gestire gli agenti assegnati;
- monitorare le attività della rete commerciale assegnata;
- accedere a clienti, documenti, simulazioni e proposte autorizzati;
- supervisionare il lavoro della struttura assegnata.

Il Sales Manager non può modificare abbonamenti, licenze, limiti contrattuali o impostazioni generali del tenant.

I riferimenti a simulazioni e proposte definiscono autorizzazioni future e non introducono tali moduli nel perimetro di Foundation V1: restano valide le esclusioni della Decisione 1.

### 4. Agent / Sales Operator

Responsabilità e permessi:

- accedere esclusivamente ai clienti e ai documenti assegnati o esplicitamente autorizzati;
- caricare documenti;
- utilizzare esclusivamente le funzionalità abilitate dal piano del tenant e dai permessi assegnati;
- creare simulazioni e proposte commerciali quando tali moduli saranno implementati.

L'Agent non può accedere ai dati appartenenti ad altri agenti, salvo autorizzazione esplicita.

I riferimenti a simulazioni e proposte commerciali definiscono autorizzazioni future e non modificano il perimetro Foundation V1 approvato nella Decisione 1.

### Conseguenze per l'architettura

Questa decisione comporta che:

- i permessi devono essere applicati lato server;
- l'isolamento dei tenant deve essere applicato a ogni ruolo;
- i nomi dei ruoli non devono sostituire controlli granulari dei permessi;
- ruoli e permessi futuri devono poter essere estesi senza riprogettare il modello tenant;
- la gestione degli aggiornamenti della piattaforma deve essere riservata agli utenti Platform Owner / Super Admin;
- assegnazioni, scope dei dati ed entitlement devono essere verificati oltre al ruolo nominale;
- i test di autorizzazione devono coprire sia i permessi consentiti sia i tentativi di accesso negati per ciascun livello.

## Decisione 4 — Modello di accesso e invito degli utenti

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

Foundation V1 deve utilizzare esclusivamente un accesso controllato.

La registrazione pubblica self-service non è consentita.

### Modello di accesso approvato

1. Il Platform Owner / Super Admin crea l'azienda cliente e provisiona o invita il primo Tenant Admin.
2. Il Tenant Admin può invitare Sales Manager e Agent autorizzati appartenenti allo stesso tenant.
3. Prima di creare o accettare un invito, il sistema deve verificare:
   - stato del tenant;
   - stato dell'abbonamento o del contratto;
   - disponibilità di licenze utente;
   - ruolo consentito;
   - indirizzo email valido;
   - assenza di membership esistenti incompatibili.
4. Ogni invito deve essere:
   - associato esattamente a un tenant;
   - associato a un ruolo approvato;
   - utilizzabile una sola volta;
   - limitato nel tempo;
   - revocabile prima dell'accettazione;
   - auditabile.
5. Gli utenti non devono poter selezionare o cambiare autonomamente il proprio tenant.
6. La disattivazione di un utente deve:
   - bloccare l'accesso;
   - liberare la licenza utente attiva, quando applicabile;
   - conservare lo storico degli audit event e i riferimenti di ownership;
   - non cancellare automaticamente documenti, attività o dati storici.
7. Quando un tenant è sospeso:
   - agli utenti del tenant deve essere impedito il normale utilizzo dell'applicazione;
   - i dati del tenant devono rimanere conservati;
   - il Platform Owner / Super Admin deve mantenere il controllo amministrativo autorizzato;
   - la riattivazione deve essere possibile senza ricostruire l'account del tenant.
8. Gli eventi di invito, attivazione, disattivazione, revoca e accettazione devono essere applicati lato server e registrati nell'audit trail.

### Funzionalità escluse da Foundation V1

Foundation V1 non deve includere:

- registrazione pubblica;
- creazione autonoma di aziende;
- onboarding aperto tramite marketplace;
- checkout automatico dell'abbonamento;
- riscossione automatica dei pagamenti.

Il pagamento e l'attivazione contrattuale possono essere gestiti inizialmente in modo manuale dal Platform Owner.

### Conseguenze per l'architettura

Questa decisione comporta che:

- l'autenticazione deve essere separata dalla membership del tenant e dall'autorizzazione;
- un'identità autenticata non deve ottenere accesso a un tenant senza una membership attiva;
- i token di invito devono essere memorizzati e gestiti in modo sicuro;
- gli inviti scaduti, revocati o già utilizzati devono essere rifiutati;
- i limiti delle licenze utente devono essere verificati lato server;
- tutte le assegnazioni di tenant e ruolo devono essere auditabili;
- il supporto futuro di ulteriori metodi di onboarding non deve indebolire il modello di accesso controllato approvato.

## Decisione 5 — Trattamento di bollette reali e documenti CTE reali

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

### Requisito di prodotto

L'applicazione è destinata a trattare:

- bollette reali di energia elettrica e gas dei clienti;
- dati contrattuali e commerciali reali contenuti in tali bollette;
- documenti reali delle Condizioni Tecnico-Economiche, indicati come CTE;
- documenti CTE reali forniti o utilizzati dalle aziende clienti;
- dati strutturati necessari per eseguire simulazioni energetiche e restituire i risultati richiesti.

L'uso di documenti reali è un requisito essenziale del prodotto e non deve essere sostituito da dati sintetici nel prodotto operativo.

### Regole per gli ambienti

#### 1. Sviluppo Local

- sono consentiti esclusivamente dati sintetici e documenti PDF sintetici;
- sono vietati bollette reali dei clienti e documenti CTE reali riservati;
- gli sviluppatori non devono conservare copie locali non controllate dei documenti operativi.

#### 2. Test automatizzati e CI

- sono consentite esclusivamente fixture sintetiche;
- non devono essere presenti dati personali, contrattuali, di pagamento, bancari, di consumo, POD, PDR, fiscali o commerciali riservati reali;
- log e artefatti di test non devono contenere documenti reali.

#### 3. Ambienti Vercel Preview ordinari

- per impostazione predefinita sono consentiti esclusivamente documenti sintetici;
- i documenti reali sono vietati finché l'ambiente non viene esplicitamente classificato e approvato come ambiente pilot protetto.

#### 4. Ambiente pilot protetto

Bollette reali e documenti CTE reali possono essere utilizzati soltanto dopo che tutti i controlli richiesti sono stati implementati e verificati, inclusi:

- autenticazione;
- autorizzazione lato server;
- isolamento tenant;
- storage documentale privato;
- accesso controllato ai documenti;
- variabili d'ambiente e credenziali sicure;
- audit trail;
- cancellazione controllata;
- regole di retention approvate;
- logging operativo con redazione dei dati;
- prevenzione degli accessi cross-tenant;
- procedure documentate di incidente e rollback.

#### 5. Production

La Production è destinata a trattare bollette reali e documenti CTE reali dopo che i controlli richiesti di sicurezza, privacy, autorizzazione, storage, audit, retention, cancellazione e operatività hanno superato i relativi criteri di accettazione.

### Classificazione dei documenti

Le bollette reali devono essere trattate come documenti protetti perché possono contenere:

- dati identificativi personali e aziendali;
- identificativi fiscali;
- indirizzi di fornitura;
- identificativi POD o PDR;
- informazioni di consumo e contrattuali;
- modalità di pagamento;
- riferimenti bancari;
- informazioni sullo stato dei pagamenti, morosità, CMOR o interessi.

I documenti CTE reali devono essere trattati come documenti commerciali protetti perché possono contenere:

- condizioni del fornitore;
- prezzi, spread, quote fisse e variabili;
- periodi di validità contrattuale;
- regole commerciali;
- informazioni aziendali riservate o ad accesso limitato.

### Conseguenze architetturali obbligatorie

- ogni documento deve appartenere a un tenant;
- l'accesso ai documenti deve essere autorizzato lato server;
- i documenti devono essere archiviati privatamente e non devono mai essere accessibili pubblicamente tramite URL permanente;
- metadati e contenuto del documento devono rimanere logicamente separati quando appropriato;
- i log non devono mai contenere il contenuto completo dei documenti o dati personali non controllati;
- gli eventi di accesso, download, upload, sostituzione, archiviazione e cancellazione devono essere auditabili;
- la sospensione del tenant deve bloccare il normale accesso senza cancellare automaticamente i documenti;
- i dati estratti da un documento devono conservarne la provenance e il riferimento al documento sorgente;
- le informazioni mancanti o illeggibili non devono essere inventate o sostituite silenziosamente con valori predefiniti;
- i dati estratti tramite OCR o AI devono essere verificati secondo il futuro workflow di estrazione approvato prima di essere utilizzati in calcoli definitivi;
- questa decisione non seleziona alcun provider di elaborazione documentale;
- questa decisione non approva alcuna durata specifica di retention, provider, localizzazione geografica dei dati o base giuridica.

### Conseguenza per Foundation V1

Foundation V1 deve creare le fondamenta sicure necessarie per il successivo utilizzo operativo di bollette reali e documenti CTE reali.

Foundation V1 non include ancora:

- OCR delle bollette;
- estrazione automatica delle CTE;
- formule di simulazione energetica;
- importazione del PUN;
- motore GAS;
- ranking delle offerte;
- generazione di report commerciali.

Il prototipo corrente non protetto e gli ambienti Preview ordinari non devono essere utilizzati con bollette reali dei clienti o documenti CTE riservati.

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

- identificatori tecnici e granularità definitiva dei singoli permessi associati ai quattro ruoli approvati;
- regole dettagliate di assegnazione di clienti, documenti, agenti e strutture commerciali;
- eventuali ruoli aggiuntivi oltre ai quattro ruoli iniziali approvati;

### Accesso, inviti e identità

- durata di validità degli inviti;
- limiti e regole per il reinvio degli inviti;
- provider per la consegna delle email;
- provider di identità definitivo;
- workflow dettagliato di recupero dell'account;
- supporto futuro per membership dello stesso utente in più tenant.

### Dati e documenti

- periodi esatti di retention;
- calendari e procedure di cancellazione e archiviazione;
- requisiti geografici di localizzazione dei dati;
- base giuridica, informative e documentazione privacy applicabili;
- procedura approvata per l'ambiente pilot protetto;
- provider di elaborazione documentale;
- dettagli della procedura di risposta agli incidenti;
- autorizzazione per ciascun ambiente operativo.

### Tecnologia e fornitori

- provider del database;
- ORM o query layer e strumento di migrazione;
- provider dello storage documentale;
- provider di error monitoring e logging;
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

- rispettare le cinque decisioni indicate come **APPROVED BY PRODUCT OWNER**;
- non reintrodurre nello scope Foundation V1 le funzionalità esplicitamente escluse;
- non semplificare l'architettura in un modello single-tenant;
- non scegliere autonomamente elementi indicati come ancora soggetti a futura approvazione;
- distinguere sempre tra decisioni approvate, raccomandazioni tecniche e decisioni pendenti;
- fermarsi e richiedere approvazione quando un task dipende da una decisione non ancora assunta.

Eventuali modifiche future a queste decisioni devono essere approvate esplicitamente dal Product Owner e registrate in un documento autoritativo successivo.
