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

## Decisione 6 — Ciclo di vita, visibilità, retention e cancellazione dei documenti

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

### A. Bollette dei clienti

Il ciclo di vita approvato per le bollette dei clienti è:

1. `Uploaded`;
2. `Active`;
3. `Archived`;
4. `Scheduled for deletion`;
5. `Deleted`.

#### Regola di retention approvata

- una bolletta cliente archiviata deve essere cancellata definitivamente 60 giorni di calendario dopo il relativo timestamp `archived_at`;
- il periodo di retention inizia quando la bolletta entra nello stato `Archived`;
- la disattivazione dell'utente o la sospensione del tenant non deve archiviare o cancellare automaticamente una bolletta;
- le bollette archiviate non devono essere utilizzate in nuovi processi operativi, salvo applicazione di una regola di ripristino approvata separatamente;
- la cancellazione deve essere eseguita da un processo controllato lato server;
- gli eventi di cancellazione devono essere auditabili;
- devono essere rimossi il file del documento, i dati operativi estratti, le copie temporanee generate e i riferimenti storage non più necessari;
- possono rimanere esclusivamente le informazioni di audit minime necessarie a dimostrare che la cancellazione è avvenuta;
- le informazioni di audit conservate non devono contenere il documento completo, dati personali estratti o contenuti riservati del documento.

### B. Condizioni Tecnico-Economiche — CTE

Il ciclo di vita approvato per i documenti CTE è:

1. `Active`;
2. `Expired`;
3. `Archived`;
4. `Scheduled for deletion`;
5. `Deleted`.

#### Regole approvate di visibilità e utilizzo

- per impostazione predefinita, gli elenchi operativi devono mostrare esclusivamente i documenti CTE attivi;
- il motore di simulazione deve utilizzare esclusivamente documenti CTE attivi e altrimenti idonei;
- i documenti CTE scaduti o archiviati non devono essere selezionabili per nuove simulazioni;
- quando una CTE raggiunge la data di scadenza contrattuale, deve diventare automaticamente `Expired` e `Archived` tramite un processo controllato lato server;
- l'archiviazione deve conservare il riferimento storico necessario per le simulazioni generate in precedenza e per gli audit record fino alla cancellazione.

#### Regola di retention approvata

- una CTE archiviata deve essere cancellata definitivamente 12 mesi di calendario dopo il relativo timestamp `archived_at`;
- quando l'archiviazione automatica avviene alla scadenza contrattuale, `archived_at` deve registrare tale transizione;
- la cancellazione deve rimuovere il documento sorgente e i dati CTE operativi non più necessari;
- può rimanere esclusivamente una prova di audit minima e non sensibile della cancellazione;
- il contenuto di una CTE cancellata non deve rimanere disponibile tramite URL permanenti, cache, copie temporanee o normali query applicative.

### C. Autorizzazione ed enforcement

- le transizioni del ciclo di vita devono essere applicate lato server;
- gli Agent non devono poter cancellare definitivamente i documenti;
- i permessi per archiviazione, richieste di cancellazione, annullamento e ripristino devono essere granulari e auditabili;
- l'isolamento tenant deve essere applicato a ogni operazione del ciclo di vita;
- i job di cancellazione pianificata devono essere idempotenti e sicuri da ritentare;
- i job di cancellazione falliti devono essere registrati nei log senza esporre il contenuto dei documenti;
- un documento già cancellato non deve essere ricreato silenziosamente da cache o copie temporanee;
- la cancellazione non deve interrompere la catena minima di audit relativa alle simulazioni precedenti, ma tale catena non deve conservare il contenuto del documento cancellato.

### D. Conseguenze per Foundation V1

Foundation V1 deve predisporre:

- stati e timestamp del ciclo di vita;
- campi `archived_at` e `deleted_at`;
- regole di autorizzazione lato server;
- fondamenta per la cancellazione pianificata;
- audit event;
- interfacce di cancellazione sicure;
- separazione tra dati documentali operativi e metadati minimi di audit.

Foundation V1 continua a non includere OCR, estrazione automatica delle CTE, importazione PUN, formule di simulazione, motore GAS, ranking o report commerciali.

## Decisione 7 — Regola di corrispondenza mensile dell'Indice PUN GME

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

### Requisito di prodotto

L'applicazione deve acquisire e conservare i valori mensili ufficiali dell'Indice PUN GME per le tre fasce orarie:

- F1;
- F2;
- F3.

Ogni valore conservato deve mantenere:

- mese di riferimento;
- anno di riferimento;
- fascia oraria;
- valore e unità originali;
- valore normalizzato utilizzato dal motore di calcolo;
- riferimento alla fonte ufficiale;
- timestamp di acquisizione;
- stato di verifica;
- informazioni di audit dell'importazione.

### Regola di corrispondenza per la simulazione

Una simulazione deve utilizzare i valori PUN ufficiali F1, F2 e F3 appartenenti allo stesso mese e allo stesso anno del periodo di consumo della bolletta caricata.

Esempi:

- il consumo F1 di una bolletta di maggio deve utilizzare il PUN F1 di maggio;
- il consumo F2 di una bolletta di maggio deve utilizzare il PUN F2 di maggio;
- il consumo F3 di una bolletta di maggio deve utilizzare il PUN F3 di maggio.

Il sistema non deve utilizzare:

- l'ultimo mese disponibile come sostituto;
- la media dei quattro mesi precedenti;
- valori stimati;
- valori inventati;
- valori di fallback silenziosi;
- un mese diverso dal periodo di consumo della bolletta.

### Regola di eleggibilità dei quattro mesi

Alla data della simulazione, il mese di riferimento della bolletta deve appartenere a uno dei quattro mesi di calendario completi immediatamente precedenti il mese della simulazione.

Esempio:

Per una simulazione effettuata durante luglio 2026, i mesi di bolletta eleggibili sono:

- marzo 2026;
- aprile 2026;
- maggio 2026;
- giugno 2026.

Febbraio 2026 o un mese precedente è fuori dalla finestra consentita.

Luglio 2026 non è eleggibile perché non è un mese precedente completo.

### Regola per dati mancanti

Se il valore PUN GME ufficiale F1, F2 o F3 relativo al mese esatto della bolletta è mancante, non verificato o non disponibile:

- la simulazione definitiva deve essere bloccata;
- l'utente deve ricevere un messaggio di validazione chiaro;
- non deve essere applicato alcun mese alternativo, media, stima, zero o valore predefinito.

### Regola per bollette multi-mese

Se una bolletta include consumi appartenenti a più mesi di calendario:

- i consumi devono essere separati per mese quando sono disponibili dati mensili affidabili;
- ogni quantità di consumo mensile deve utilizzare i valori PUN ufficiali F1, F2 e F3 dello stesso mese;
- il sistema non deve assegnare arbitrariamente l'intera bolletta a un solo mese;
- se non è disponibile una ripartizione mensile affidabile, la simulazione definitiva deve essere bloccata in attesa di verifica.

### Conseguenze architetturali

- l'importazione PUN deve essere deterministica e indipendente dall'AI generativa;
- le importazioni devono essere idempotenti e ripetibili in sicurezza;
- i record duplicati per mese e fascia devono essere impediti;
- i valori storici non devono essere sovrascritti silenziosamente;
- la conversione delle unità deve essere esplicita e testata;
- la provenance della fonte deve essere conservata;
- soltanto valori ufficiali verificati possono essere utilizzati nelle simulazioni definitive;
- il Platform Owner / Super Admin deve poter ispezionare lo stato dell'importazione e avviare un nuovo tentativo manuale autorizzato;
- i fallimenti di importazione e validazione devono essere auditabili senza esporre il contenuto dei documenti dei clienti.

### Conseguenza per Foundation V1

Foundation V1 non implementa ancora l'importazione GME o il motore di simulazione.

Foundation V1 deve tuttavia predisporre le fondamenta architetturali necessarie per:

- job pianificati lato server;
- audit event;
- autorizzazione;
- separazione degli ambienti;
- configurazione validata;
- futura persistenza di record verificati degli indici di mercato.

## Decisione 8 — Politica internazionale di localizzazione e trasferimento dei dati

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

### Principio approvato

L'applicazione non è soggetta a una restrizione assoluta di localizzazione dei dati nell'Unione Europea o nello Spazio Economico Europeo.

Database, storage documentale privato, backup, autenticazione, monitoraggio, OCR, AI e altri servizi operativi possono essere localizzati o trattare dati:

- nell'Unione Europea o nello Spazio Economico Europeo;
- negli Stati Uniti;
- in altri Paesi.

Un provider o una localizzazione esterna all'UE/SEE può essere utilizzato soltanto dopo che i requisiti applicabili di sicurezza, privacy, contrattuali, operativi e di trasferimento internazionale sono stati valutati, documentati e approvati.

Nessun provider è approvato per il solo fatto che questa decisione generale consenta il trattamento internazionale.

### Valutazione obbligatoria del provider

Prima che un servizio possa trattare bollette reali, documenti CTE reali, dati personali, dati contrattuali o informazioni commerciali riservate, la valutazione deve coprire:

- localizzazioni di storage e trattamento;
- trasferimenti internazionali e trasferimenti successivi;
- decisione di adeguatezza applicabile, ove disponibile;
- partecipazione all'EU-US Data Privacy Framework, ove rilevante;
- Clausole Contrattuali Standard o altro meccanismo di trasferimento applicabile, ove richiesto;
- cifratura in transito e a riposo;
- controlli di accesso e responsabilità per la gestione delle chiavi;
- impegni di retention e cancellazione;
- cancellazione di copie temporanee e cache;
- utilizzo o non utilizzo dei dati cliente per l'addestramento di modelli o servizi;
- sub-responsabili e relative localizzazioni;
- notifica e risposta agli incidenti;
- auditabilità;
- uscita contrattuale e portabilità dei dati;
- cancellazione verificata dopo la cessazione del servizio.

### Stati Uniti e altri Paesi terzi

L'utilizzo di un provider degli Stati Uniti è consentito quando l'organizzazione selezionata e l'accordo di trasferimento soddisfano i requisiti applicabili.

È consentito anche l'utilizzo di provider in altri Paesi non UE/SEE quando sono documentati una decisione di adeguatezza applicabile oppure un altro meccanismo di trasferimento valido e le garanzie richieste.

Le deroghe per trasferimenti eccezionali o occasionali non devono essere trattate come meccanismo predefinito per un trattamento operativo continuativo.

### Conseguenze architetturali

- le integrazioni con i provider devono utilizzare adapter sostituibili;
- le informazioni su provider e regione devono essere documentate;
- sub-responsabili e meccanismi di trasferimento devono poter essere mantenuti in un registro dei provider;
- segreti e credenziali devono rimanere specifici per ambiente;
- i documenti reali non devono essere inviati a un provider non approvato;
- i provider OCR o AI non devono conservare documenti operativi né utilizzarli per addestramento, salvo approvazione separata;
- la sostituzione del provider e l'esportazione dei dati devono essere tecnicamente possibili;
- i log non devono esporre documenti completi o dati personali non controllati;
- le future modifiche di provider devono superare una nuova valutazione prima dell'utilizzo operativo.

### Conseguenza per Foundation V1

Foundation V1 deve rimanere indipendente dai provider e predisporre:

- adapter dei servizi;
- configurazione ambiente validata;
- registri dei provider e decision record;
- audit event;
- confini di controllo degli accessi;
- separazione degli ambienti;
- fondamenta per migrazione sicura e uscita dal provider.

Questa decisione non seleziona né approva alcuno specifico provider di database, storage, autenticazione, monitoraggio, OCR, AI, cloud o hosting.

## Decisione 9 — Workflow controllato di rilascio Preview e Production

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

### Principio di rilascio approvato

Nessun aggiornamento applicativo può essere pubblicato direttamente in Production.

Ogni modifica deve attraversare un workflow controllato composto da:

1. sviluppo su un branch separato da `main`;
2. commit e push sul branch remoto autorizzato;
3. revisione tramite Pull Request;
4. deployment Vercel Preview isolato;
5. controlli tecnici automatizzati;
6. verifica funzionale;
7. approvazione del Product Owner;
8. merge autorizzato in `main`;
9. deployment controllato in Production;
10. verifica post-deployment.

### Modifiche dirette in Production

Durante le operazioni ordinarie sono vietati:

- lo sviluppo diretto su `main`;
- il push diretto su `main` di modifiche non revisionate;
- il deployment diretto in Production da un branch non approvato;
- l'aggiramento della verifica in Preview;
- il merge senza i controlli richiesti;
- il merge senza l'approvazione funzionale del Product Owner;
- l'utilizzo della Production come ambiente di test;
- il test dei deployment Preview ordinari con documenti reali dei clienti.

### Regole per branch e Pull Request

- lo sviluppo deve avvenire su branch dedicati;
- `main` è il branch di rilascio in Production;
- ogni modifica materiale deve utilizzare una Pull Request;
- la Pull Request deve descrivere chiaramente scope, rischi, test, migrazioni, modifiche di configurazione e considerazioni sul rollback;
- modifiche non correlate non devono essere combinate senza giustificazione;
- i rilievi di revisione irrisolti devono bloccare il merge;
- prima del merge, il branch deve essere sincronizzato e privo di conflitti;
- i controlli di protezione del branch devono essere abilitati quando tecnicamente configurati.

### Requisiti di Vercel Preview

Ogni Pull Request o branch di sviluppo autorizzato deve generare una Vercel Preview isolata, ove tecnicamente supportato.

La Preview deve essere utilizzata per verificare:

- build dell'applicazione;
- interfaccia utente;
- comportamento responsive;
- navigazione;
- comportamento delle autorizzazioni;
- isolamento dei tenant;
- gestione degli errori;
- configurazione dell'ambiente;
- compatibilità delle migrazioni del database;
- comportamento dell'integrazione con lo storage;
- comportamento degli audit event;
- aspettative di accessibilità;
- rischi di regressione.

L'approvazione della Preview non autorizza l'uso in Production di dati reali dei clienti.

### Gate automatizzati di rilascio

Prima del merge in `main`, i controlli automatizzati richiesti devono essere superati.

I gate di rilascio devono includere progressivamente:

- installazione delle dipendenze;
- analisi statica;
- validazione TypeScript;
- linting;
- test unitari;
- test di integrazione;
- test delle autorizzazioni;
- test dell'isolamento dei tenant;
- validazione delle migrazioni;
- build di Production;
- controlli di sicurezza;
- controlli sull'esposizione di segreti;
- validazione della configurazione richiesta.

Il fallimento di un controllo obbligatorio blocca il merge, salvo approvazione di una procedura di emergenza esplicitamente documentata.

### Approvazione del Product Owner

Tony Marchese, in qualità di Product Owner, deve approvare il risultato funzionale prima che un rilascio materiale venga integrato in `main`.

L'approvazione del Product Owner copre:

- coerenza con i requisiti approvati;
- comportamento business atteso;
- workflow utente;
- risultato visibile dell'applicazione;
- readiness del rilascio dal punto di vista del prodotto.

L'approvazione del Product Owner non sostituisce le verifiche tecniche, di sicurezza, privacy o migrazione.

### Separazione degli ambienti

Gli ambienti Local, CI, Preview, pilot protetto e Production devono rimanere logicamente separati.

Devono utilizzare elementi separati o adeguatamente isolati per:

- variabili d'ambiente;
- credenziali;
- segreti;
- database o schemi di database, ove richiesto;
- ubicazioni di storage;
- configurazione dell'autenticazione;
- endpoint webhook;
- job pianificati;
- configurazione del monitoraggio;
- configurazione dei servizi di terze parti.

I segreti di Production non devono essere esposti agli ambienti Local, CI o Preview ordinari.

### Regole sui dati

- lo sviluppo Local deve utilizzare dati sintetici;
- la CI deve utilizzare dati sintetici;
- i deployment Vercel Preview ordinari devono utilizzare dati sintetici;
- bollette reali dei clienti e documenti CTE reali non devono essere utilizzati negli ambienti Preview ordinari;
- un pilot protetto può utilizzare documenti reali soltanto dopo l'autorizzazione operativa separata e l'adozione delle garanzie richieste dalla decisione approvata sui documenti reali;
- i dati di Production non devono essere copiati in Preview senza un processo approvato separatamente, controllato, minimizzato e documentato.

### Migrazioni del database

Ogni rilascio che contiene modifiche al database deve documentare e verificare:

- ordine delle migrazioni;
- compatibilità all'indietro;
- eventuale downtime previsto;
- rischi di trasformazione dei dati;
- strategia di rollback o roll-forward;
- validazione successiva alla migrazione;
- comportamento quando le versioni dell'applicazione e del database differiscono temporaneamente.

Le migrazioni distruttive o irreversibili richiedono un'ulteriore revisione esplicita prima del rilascio in Production.

### Registro dei rilasci

Ogni rilascio in Production deve conservare:

- identificativo del rilascio o SHA del commit;
- data e ora del rilascio;
- Pull Request approvata;
- modifiche incluse;
- informazioni sulle migrazioni;
- modifiche di configurazione rilevanti;
- esito dei test e delle verifiche;
- approvazione del Product Owner;
- approvazione tecnica, ove richiesta;
- limitazioni note;
- istruzioni di rollback o recovery;
- esito della verifica post-deployment.

### Rollback e recovery

Ogni rilascio materiale deve disporre di una strategia pratica di rollback o recovery.

La strategia deve considerare:

- rollback dell'applicazione;
- compatibilità del database;
- compatibilità dello storage;
- job in background;
- attività pianificate;
- feature flag;
- integrazioni esterne;
- dati creati dopo il deployment.

Il rollback non deve cancellare, corrompere, duplicare o esporre silenziosamente dati dei clienti.

### Rilasci di emergenza

Un rilascio di emergenza può utilizzare un processo accelerato soltanto quando necessario per affrontare:

- un incidente di sicurezza;
- un accesso non autorizzato;
- un'esposizione attiva di dati;
- una grave indisponibilità del servizio;
- un rischio di corruzione dei dati;
- un difetto critico legale od operativo.

Anche durante un'emergenza:

- la modifica deve essere isolata e minima;
- la motivazione deve essere documentata;
- l'autorizzazione deve essere registrata;
- i test devono essere eseguiti nella massima misura compatibile con la sicurezza;
- deve esistere un piano di rollback;
- deve essere completata una revisione successiva al rilascio;
- il Product Owner deve essere informato;
- i controlli normali devono essere ripristinati immediatamente dopo.

### Disabilitazione delle funzionalità e manutenzione

Il Platform Owner / Super Admin deve poter, ove tecnicamente predisposto:

- disabilitare una funzionalità interessata;
- porre una funzione in modalità manutenzione;
- mostrare una comunicazione di manutenzione appropriata;
- preservare i servizi non interessati;
- impedire elaborazioni non sicure;
- ripristinare la funzione dopo la verifica.

Questa autorità non deve consentire deployment di codice non controllati né l'aggiramento dell'isolamento dei tenant, dell'audit o dei requisiti di protezione dei dati.

### Conseguenza per Foundation V1

Foundation V1 deve predisporre le fondamenta tecniche e procedurali per:

- sviluppo basato su branch;
- controlli delle Pull Request;
- deployment Vercel Preview;
- separazione degli ambienti;
- configurazione validata;
- test automatizzati;
- controlli delle migrazioni;
- registri dei rilasci;
- auditabilità;
- rollback e recovery;
- futura configurazione della protezione dei branch;
- disabilitazione sicura delle funzionalità, ove applicabile.

Questa decisione definisce il workflow di rilascio, ma non autorizza in questa fase un merge in `main` né un rilascio in Production.

## Decisione 10 — Autorizzazione alla discovery tecnica e alla progettazione architetturale di Foundation V1

**APPROVED BY PRODUCT OWNER**

Data di approvazione: **22 luglio 2026**

### Scopo approvato

È autorizzata una fase controllata di discovery tecnica e progettazione architetturale.

Il suo scopo è trasformare le prime nove decisioni approvate dal Product Owner in:

- un'architettura Foundation V1 eseguibile;
- una roadmap di implementazione dettagliata;
- confini tecnici chiari;
- alternative documentate;
- criteri di accettazione verificabili;
- un piano di sviluppo ordinato;
- dipendenze, rischi e decisioni irrisolte identificati.

Questa autorizzazione copre esclusivamente analisi e documentazione tecnica.

Non autorizza l'implementazione.

### Aree di discovery autorizzate

La fase di discovery può analizzare e progettare:

- architettura applicativa modulare;
- confini lato server e lato client;
- architettura di autenticazione;
- gestione delle sessioni;
- inviti controllati;
- membership dei tenant;
- multi-tenancy SaaS;
- isolamento dei tenant;
- ruoli e permessi granulari;
- autorizzazione lato server;
- capacità del Platform Owner;
- capacità del Tenant Admin;
- capacità del Sales Manager / Coordinator;
- capacità dell'Agent / Sales Operator;
- fondamenta di abbonamenti e licenze;
- limiti dei posti utente;
- entitlement e controlli delle funzionalità;
- sospensione e ripristino dei tenant;
- architettura del database;
- strategia di migrazione;
- storage documentale privato;
- provenance dei documenti;
- stati del ciclo di vita di bollette e CTE;
- archiviazione e cancellazione pianificata;
- audit logging;
- fondamenta dell'automazione della retention;
- job pianificati lato server;
- gestione degli errori;
- osservabilità e monitoraggio con dati oscurati;
- validazione della configurazione;
- separazione degli ambienti Local, CI, Preview, pilot protetto e Production;
- strategia di test;
- continuous integration;
- gate di rilascio;
- fondamenta di rollback e recovery;
- adapter per provider futuri;
- fondamenta della futura importazione del GME PUN Index;
- confini delle future integrazioni OCR e AI;
- controlli di sicurezza e privacy;
- struttura della documentazione tecnica.

### Attività autorizzate

Codex può:

- ispezionare il repository corrente;
- ispezionare la documentazione di progetto esistente;
- identificare i confini del codice legacy;
- mappare dipendenze e debito tecnico;
- confrontare alternative architetturali;
- proporre modelli dati;
- proporre strutture di moduli e directory;
- proporre interfacce e adapter di servizio;
- proporre matrici di autorizzazione;
- proporre macchine a stati dei documenti;
- proporre sequenze di migrazione;
- proporre livelli di test;
- proporre controlli CI e di rilascio;
- proporre strutture delle variabili d'ambiente senza valori reali;
- identificare criteri di selezione dei provider;
- identificare rischi, trade-off e prerequisiti;
- creare documentazione tecnica di pianificazione nel repository soltanto quando riceve un'istruzione separata;
- raccomandare un ordine di implementazione.

### Attività vietate

Durante questa fase di discovery, Codex non deve:

- modificare il codice applicativo;
- effettuare refactoring del codice applicativo;
- eliminare codice applicativo;
- installare o aggiornare dipendenze;
- modificare `package-lock.json`;
- creare un database;
- eseguire migrazioni del database;
- creare account presso provider esterni;
- selezionare o approvare definitivamente un provider;
- configurare Vercel;
- modificare le impostazioni GitHub;
- configurare la protezione dei branch;
- aggiungere segreti o credenziali reali;
- utilizzare bollette reali dei clienti;
- utilizzare documenti CTE reali;
- trattare dati personali o riservati dei clienti;
- abilitare servizi OCR o AI;
- implementare l'acquisizione dei dati GME;
- implementare simulazioni;
- creare una Pull Request;
- effettuare merge in `main`;
- eseguire deployment in Production;
- autorizzare l'uso in Production.

### Deliverable attesi dalla discovery

La discovery tecnica deve infine produrre una proposta di documentazione che copra almeno:

1. architettura target;
2. confini modulari;
3. struttura proposta del repository;
4. flusso di autenticazione e invito;
5. modello di tenant e membership;
6. matrice di autorizzazione;
7. fondamenta di abbonamenti, licenze, posti utente ed entitlement;
8. modello di database proposto;
9. architettura dello storage privato;
10. macchine a stati del ciclo di vita dei documenti;
11. modello degli audit event;
12. architettura della retention e cancellazione pianificata;
13. modello di separazione degli ambienti;
14. strategia degli adapter dei provider;
15. strategia di test;
16. strategia CI e dei gate di rilascio;
17. strategia di migrazione e rollback;
18. strategia di osservabilità ed errori con dati oscurati;
19. considerazioni sulle minacce per sicurezza e privacy;
20. fasi di implementazione ordinate;
21. criteri di accettazione per ogni fase;
22. rischi e dipendenze;
23. decisioni che richiedono ancora l'approvazione del Product Owner.

### Neutralità rispetto ai provider

La discovery può confrontare possibili provider e architetture.

Ogni confronto deve distinguere:

- fatti verificati;
- assunzioni;
- vantaggi;
- limitazioni;
- dipendenze operative;
- implicazioni di sicurezza e privacy;
- rischi di portabilità e vendor lock-in;
- costi che richiedono ancora una verifica aggiornata.

Nessun provider diventa approvato per il solo fatto di essere raccomandato in un documento di discovery.

Qualsiasi selezione di provider richiede una decisione separata del Product Owner e le valutazioni previste dalla Decisione 8.

### Confine del prototipo legacy

La discovery deve trattare l'applicazione corrente come un prototipo legacy.

Per ogni area rilevante deve identificare esplicitamente se l'implementazione esistente debba essere:

- mantenuta;
- sottoposta a refactoring;
- sostituita;
- isolata temporaneamente;
- rimossa soltanto durante una successiva fase di implementazione autorizzata.

Nessuna funzionalità legacy può essere trattata silenziosamente come pronta per la Production.

### Confine dello scope Foundation V1

La discovery deve rispettare la Decisione 1.

Foundation V1 predispone fondamenta professionali e un ciclo di vita documentale non interpretativo.

Foundation V1 non implementa:

- estrazione OCR;
- estrazione delle condizioni commerciali dalle CTE;
- acquisizione PUN;
- simulazioni elettriche;
- simulazioni gas;
- confronti tra offerte;
- ranking;
- report finali;
- interpretazione documentale tramite AI generativa.

I moduli futuri possono essere considerati soltanto per assicurare che Foundation V1 non crei vicoli ciechi architetturali.

### Controllo delle decisioni e della revisione

Ogni assunzione che influisce su comportamento del prodotto, regole commerciali, privacy, sicurezza, retention, permessi utente o workflow operativo deve essere identificata.

Codex non deve decidere silenziosamente questioni di business irrisolte.

Gli elementi che richiedono l'approvazione del Product Owner devono essere elencati chiaramente e rimanere pendenti fino all'approvazione esplicita del Product Owner.

### Autorizzazione all'implementazione

Il completamento della documentazione di discovery non autorizzerà automaticamente l'implementazione.

Deve essere rilasciata un'autorizzazione separata all'implementazione dopo:

- revisione tecnica;
- revisione del Product Owner;
- risoluzione o rinvio esplicito delle decisioni bloccanti;
- approvazione della prima fase di implementazione;
- conferma dei controlli sui branch e sui rilasci.

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

- regole di retention differenti per altre categorie future di documenti;
- procedure di legal hold;
- regole di ripristino dei documenti archiviati;
- retention contrattuale eccezionale;
- tempistiche di eliminazione delle copie presenti nei backup;
- runbook dettagliati di cancellazione;
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
- configurazione concreta di CI/CD.

### Architettura e autorizzazione all'implementazione

- approvazione dell'architettura finale;
- selezione dei provider;
- provider e regione del database;
- provider di autenticazione;
- provider dello storage;
- provider di monitoraggio;
- meccanismo dei job pianificati;
- modello dati esatto;
- matrice di autorizzazione esatta;
- ristrutturazione esatta del repository;
- aggiunte esatte alle dipendenze;
- autorizzazione della fase di implementazione;
- approvazione della sequenza di implementazione;
- identità del revisore tecnico;
- scope della prima Pull Request;
- autorizzazione a modificare il codice applicativo.

### Workflow di rilascio

- configurazione esatta della protezione dei branch GitHub;
- numero richiesto e identità dei revisori tecnici;
- controlli CI obbligatori esatti;
- strategia di merge esatta;
- meccanismo esatto di autorizzazione del deployment in Production;
- autorizzazione dettagliata dei rilasci di emergenza;
- runbook dettagliato di rollback;
- convenzione di versionamento dei rilasci;
- configurazione infrastrutturale specifica del provider per Preview e Production.

### Provider, localizzazione e trasferimenti internazionali

- selezione di ciascun provider;
- regioni selezionate;
- meccanismo di trasferimento applicabile a ciascun provider;
- valutazione contrattuale e privacy;
- sub-responsabili;
- configurazione di cifratura e gestione delle chiavi;
- condizioni di retention e cancellazione;
- impostazioni relative all'utilizzo dei dati per addestramento;
- autorizzazione operativa al trattamento di documenti reali;
- runbook di uscita dal provider e migrazione.

### Indice PUN GME

- meccanismo ufficiale esatto di acquisizione dal GME;
- frequenza e pianificazione dell'importazione;
- formato della fonte ed endpoint tecnico;
- workflow di verifica manuale;
- trattamento di correzioni o ripubblicazioni da parte del GME;
- workflow dettagliato di ripartizione multi-mese quando la bolletta non contiene consumi mensili affidabili.

### Milestone successive

- requisiti e provider OCR;
- strategia di estrazione delle CTE;
- formule e criteri di validazione della simulazione elettrica;
- requisiti del motore GAS;
- criteri di ranking delle offerte;
- contenuto, responsabilità e formato delle proposte commerciali.

## Vincolo per i futuri task Codex

Questo documento è la fonte autoritativa per i futuri task Codex relativi al perimetro Foundation V1 e al modello SaaS multi-tenant.

I futuri task devono:

- rispettare le dieci decisioni indicate come **APPROVED BY PRODUCT OWNER**;
- non reintrodurre nello scope Foundation V1 le funzionalità esplicitamente escluse;
- non semplificare l'architettura in un modello single-tenant;
- non scegliere autonomamente elementi indicati come ancora soggetti a futura approvazione;
- distinguere sempre tra decisioni approvate, raccomandazioni tecniche e decisioni pendenti;
- fermarsi e richiedere approvazione quando un task dipende da una decisione non ancora assunta.

Eventuali modifiche future a queste decisioni devono essere approvate esplicitamente dal Product Owner e registrate in un documento autoritativo successivo.
