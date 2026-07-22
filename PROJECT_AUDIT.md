# Audit tecnico del progetto

Data dell'audit: 22 luglio 2026  
Repository: `simulatore`  
Branch esaminato: `rebuild/foundation-v1`  
Commit esaminato: `8041647` (`Refine CTE parser with advanced regex patterns`)

## 1. Executive summary

Il repository contiene un prototipo front-end di una piattaforma per la lettura di bollette, l'estrazione di condizioni tecnico-economiche (CTE), la consultazione di valori PUN e il confronto economico di offerte energetiche.

Il flusso di prodotto è comprensibile e costituisce una buona base di analisi funzionale. L'implementazione corrente, tuttavia, non è una piattaforma OCR professionale e non è idonea a produrre simulazioni economiche affidabili in produzione. L'applicazione è concentrata in un unico componente client di 715 righe, non dispone di backend, persistenza, autenticazione, storage documentale, OCR reale, validazione runtime, test o osservabilità.

La lettura della bolletta è simulata con dati fissi. L'estrazione delle CTE usa PDF.js nel browser e regex con fallback silenziosi a zero o a valori predefiniti. Il confronto economico considera solo una parte delle componenti di costo e annualizza un singolo mese moltiplicandolo per dodici.

La priorità non deve essere una riscrittura generale immediata, ma la costruzione di una base verificabile: schemi di dominio, fixture sintetiche o anonimizzate, estrazione con evidenze, validazione esplicita e un primo motore di calcolo limitato e coperto da test.

## 2. Livello di maturità attuale

**Valutazione: prototipo dimostrativo / proof of concept iniziale.**

Il progetto dimostra:

- un possibile percorso utente;
- un primo inventario dei dati di bolletta e offerta;
- un'interfaccia per caricare documenti e confrontare risultati;
- un esperimento di estrazione del testo e parsing tramite regex;
- una prima formula semplificata di confronto.

Non dimostra ancora:

- accuratezza OCR o di estrazione su un corpus documentale;
- correttezza tariffaria, fiscale o regolatoria;
- riproducibilità delle simulazioni;
- sicurezza e isolamento dei dati;
- gestione multiutente o multitenant;
- operabilità in produzione;
- conformità privacy;
- affidabilità verificata tramite build, test e CI.

La cronologia contiene 21 commit, concentrati soprattutto su modifiche iterative a `app/page.tsx`. Questo è coerente con una fase di prototipazione rapida, non con un'architettura consolidata.

## 3. Architettura corrente del repository

La struttura applicativa è minima:

```text
app/
  favicon.ico
  globals.css
  layout.tsx
  page.tsx
public/
  file.svg
  globe.svg
  next.svg
  vercel.svg
  window.svg
AGENTS.md
CLAUDE.md
README.md
eslint.config.mjs
next.config.ts
package.json
package-lock.json
postcss.config.mjs
tsconfig.json
```

Caratteristiche architetturali osservate:

- Next.js App Router con una sola route applicativa;
- `app/page.tsx` marcato `'use client'`;
- UI, stato, parsing dei PDF, tipi di dominio e calcoli nello stesso file;
- stato esclusivamente in memoria tramite React;
- elaborazione esclusivamente nel browser;
- assenza di route handler, API, servizi server, worker e job asincroni;
- assenza di database, migrazioni e repository layer;
- assenza di storage persistente dei documenti;
- `next.config.ts` privo di configurazioni applicative;
- nessun `vercel.json` e nessuna configurazione `.vercel` tracciata;
- working tree pulito al momento dell'audit.

`node_modules` e `.next` non erano presenti. Di conseguenza non è stato possibile leggere la documentazione installata di Next.js richiesta da `AGENTS.md`, né eseguire build, lint o typecheck senza installare dipendenze, operazione espressamente esclusa dall'audit.

## 4. Tecnologie e dipendenze rilevate

Dipendenze applicative dichiarate:

| Tecnologia | Versione | Uso osservato |
|---|---:|---|
| Next.js | 16.2.4 | Framework web e App Router |
| React | 19.2.4 | UI e stato client |
| React DOM | 19.2.4 | Rendering React |
| TypeScript | 5.x | Tipizzazione statica |
| Tailwind CSS | 4.x | Stili utility tramite PostCSS |
| ESLint | 9.x | Analisi statica configurata con preset Next.js |

Ulteriori elementi:

- PDF.js 3.11.174 viene caricato dinamicamente da cdnjs, ma non è una dipendenza dichiarata o bloccata dal `package-lock.json` dell'applicazione;
- `tsconfig.json` abilita `strict: true`, `noEmit: true` e la risoluzione `bundler`;
- ESLint usa `core-web-vitals` e la configurazione TypeScript di Next.js;
- Zod compare nel lockfile come dipendenza transitiva, ma non è usato come schema applicativo;
- il README è ancora quello generato da create-next-app.

## 5. Funzionalità effettivamente implementate

Sono presenti, a livello di prototipo:

- interfaccia a quattro schede: bollette, CTE, indice PUN e simulatore;
- selezione locale di un PDF per la bolletta;
- selezione multipla di PDF per le CTE;
- caricamento dinamico di PDF.js nel browser;
- estrazione del text layer dei PDF CTE;
- tentativi di estrazione tramite regex di:
  - nome offerta;
  - spread;
  - quota fissa mensile;
  - commercializzazione variabile;
  - sbilanciamento;
  - costo una tantum;
  - data di scadenza;
  - classificazione energia elettrica o gas;
- archivio CTE in memoria e rimozione manuale di una CTE;
- filtro delle offerte per vettore elettrico, validità e tensione;
- confronto semplificato del costo materia energia sulle fasce F1, F2 e F3;
- ordinamento per risparmio mensile stimato;
- pannello di dettaglio della scomposizione;
- layout responsive basato su Tailwind CSS.

Tutti i dati caricati o estratti vengono persi al refresh della pagina.

## 6. Funzionalità simulate, hardcoded, incomplete o fuorvianti

### Lettura bolletta

La funzione presentata come lettura OCR della bolletta non legge il file. Attende 1,5 secondi e restituisce sempre lo stesso oggetto hardcoded. Sono quindi simulati:

- intestatario e dati fiscali;
- fornitore;
- POD e indirizzo di fornitura;
- contratto e modalità di pagamento;
- stato pagamenti, CMOR e interessi di mora;
- consumi e valori PUN;
- spesa materia prima corrente.

Nel sorgente sono presenti dati dall'aspetto realistico relativi a un'impresa, compresi identificativo fiscale, POD, indirizzo e IBAN mascherato. La loro provenienza non è dimostrabile dal repository e devono essere trattati come potenzialmente sensibili fino a verifica.

### CTE e documenti

- Il sistema non esegue OCR: PDF.js estrae soltanto testo già presente nel PDF.
- PDF scansionati o composti da immagini non vengono riconosciuti.
- Il fornitore è sempre impostato a `BPower Energia S.p.A.`.
- La compatibilità di tensione è sempre `ENTRAMBE`.
- Una scadenza non trovata diventa `2026-12-31`.
- Un valore economico non trovato diventa zero.
- Il riconoscimento del nome offerta è orientato a nomi che iniziano con `Be`.
- Le estrazioni non hanno confidenza, pagina, coordinate o estratto probatorio.
- Non esiste revisione o correzione umana dei campi estratti.

### PUN e simulazione

- Lo storico PUN è una costante di sei righe senza fonte o data di acquisizione.
- Il gas può essere classificato, ma viene escluso dal simulatore.
- Il costo una tantum viene mostrato ma non incluso nel calcolo del risparmio.
- Il risparmio annuale è il risultato mensile moltiplicato per dodici.
- Non sono considerate stagionalità, curve di carico o variazioni dell'indice.
- Il confronto include solo alcune componenti della materia energia.
- Non rappresenta il costo completo della bolletta e non include tutte le componenti regolatorie, fiscali o contrattuali.
- La dicitura `MIGLIOR OFFERTA` è quindi più assertiva di quanto consentito dai dati e dal modello di calcolo corrente.

## 7. Rischi di build e qualità del codice

Build, lint e typecheck non sono stati eseguiti perché le dipendenze non erano installate e l'audit vietava installazioni. La compilabilità del commit non è pertanto confermata.

Rischi rilevati staticamente:

- componente client monolitico di 715 righe;
- responsabilità UI, dominio, parsing e calcolo non separate;
- uso di `@ts-ignore` nell'integrazione PDF.js;
- uso esplicito di `any` per gli elementi di testo PDF;
- caricamento dello script senza cleanup, deduplicazione o stato affidabile di caricamento;
- possibile selezione del file prima che PDF.js sia disponibile;
- assenza di gestione `FileReader.onerror`;
- errori di estrazione convertiti in testo vuoto e successivamente in valori plausibili ma falsi;
- elaborazione seriale dei PDF, senza cancellazione o avanzamento per file;
- nessun limite di dimensione o numero di pagine;
- calcoli rieseguiti durante il rendering e non isolati in funzioni di dominio testate;
- uso di `number` floating-point per importi monetari;
- rischio di divisione per zero nel calcolo percentuale;
- annualizzazione non giustificata;
- gestione della data corrente tramite UTC anziché timezone di business esplicita;
- possibile visualizzazione del prefisso `+` anche per un risparmio negativo;
- card cliccabili implementate come `div`, senza semantica e tastiera;
- indici di array usati come chiavi nella tabella PUN;
- metadata ancora `Create Next App`;
- attributo HTML `lang="en"` per un'applicazione italiana;
- README e documentazione operativa assenti;
- potenziali incoerenze di contrasto tra modalità scura globale e componenti a colori chiari hardcoded.

## 8. Rischi di sicurezza, privacy, integrità dati e document processing

### Sicurezza

- Codice eseguibile PDF.js e worker caricati a runtime da un CDN di terze parti.
- Assenza di Subresource Integrity, Content Security Policy e controllo same-origin della dipendenza.
- Nessuna verifica della firma effettiva del file; `accept` nel file input non è una validazione.
- Nessun limite a dimensione, pagine, batch, memoria o tempo di elaborazione.
- PDF malevoli o molto grandi possono causare consumo eccessivo di CPU o memoria nel browser.
- Nessuna evidenza di vulnerability scanning, security header o hardening applicativo.
- Non sono stati trovati sink diretti come `dangerouslySetInnerHTML`; React effettua escaping delle stringhe renderizzate.

### Privacy

Le bollette possono contenere dati personali e commerciali, inclusi nomi, indirizzi, codici fiscali, POD/PDR, consumi, modalità di pagamento e informazioni sulla morosità.

L'elaborazione corrente avviene localmente nel browser, ma mancano:

- informativa e consenso o altra base giuridica documentata;
- classificazione dei dati;
- policy di retention e cancellazione;
- controllo degli accessi e isolamento tenant;
- audit trail;
- gestione dei diritti dell'interessato;
- regole di redazione dei log;
- garanzie formali che i documenti non vengano trasmessi a terze parti.

### Integrità dei dati e dei calcoli

- Le regex non conservano il legame con la pagina o la porzione di documento sorgente.
- La prima data generica trovata può essere interpretata come scadenza.
- Layout multicolonna, tabelle, unità, segni e formati locali possono produrre associazioni errate.
- I fallback a zero possono trasformare un errore di estrazione in un'offerta apparentemente conveniente.
- Non esistono schema validation, controlli incrociati, checksum, deduplicazione o versioning.
- Non viene distinta l'origine di un valore: estratto, inferito, predefinito, corretto o verificato.
- Non sono memorizzate versione del motore, fonti tariffarie o input immutabili della simulazione.
- Il risultato non è riproducibile né auditabile.

## 9. Componenti di produzione mancanti

Non è stata trovata evidenza di:

- database, schema e migrazioni;
- autenticazione, sessioni, autorizzazione, ruoli e organizzazioni;
- isolamento multitenant;
- object storage e cifratura documentale;
- upload server-side o URL firmati;
- antivirus e controlli documentali;
- OCR reale e layout/table extraction;
- pipeline AI, versionamento dei modelli o gestione delle confidenze;
- code di lavoro, worker, retry, idempotenza e dead-letter queue;
- schemi runtime applicativi e validazione di dominio;
- revisione human-in-the-loop;
- feed autorevoli PUN/PSV e dati tariffari versionati;
- motore gas;
- motore completo di energia elettrica, imposte e componenti regolate;
- test unitari, integrazione, regressione parser, end-to-end, accessibilità e visual regression;
- corpus di PDF sintetici o anonimizzati con output attesi;
- logging strutturato, metriche, tracing, error reporting e alerting;
- CI/CD e quality gate;
- gestione dei segreti;
- backup, disaster recovery e health check;
- documentazione privacy, operativa e di deployment.

## 10. Tabella KEEP / REFACTOR / REPLACE

| Area | Decisione | Motivazione |
|---|---|---|
| Fondazione Next.js, React e TypeScript | KEEP | Base tecnologica adeguata; build ancora da verificare |
| Tailwind e direzione visuale | KEEP | Buona base per il prototipo UI |
| Flusso in quattro fasi | KEEP | Percorso di prodotto coerente |
| Vocabolario e inventario dei campi di dominio | KEEP / REFACTOR | Utile come discovery, da trasformare in schemi validati |
| Tag Git del prototipo legacy | KEEP | Riferimento storico utile |
| Struttura dei componenti UI | REFACTOR | Componente client monolitico |
| Pannello di dettaglio della simulazione | REFACTOR | Concetto utile, ma richiede dati e formule affidabili |
| Metadata, lingua e README | REFACTOR | Ancora boilerplate e incoerenti con il prodotto |
| Gestione errori e stati del documento | REFACTOR | Servono stati espliciti, errori e revisione |
| Caricamento PDF.js via CDN | REPLACE | Dipendenza non governata e integrazione fragile |
| Finto OCR della bolletta | REPLACE | Restituisce esclusivamente dati hardcoded |
| Parser regex come fonte autorevole | REPLACE | Non affidabile né auditabile |
| Fallback silenziosi a zero e valori fissi | REPLACE | Possono generare risultati materialmente falsi |
| Dataset PUN hardcoded | REPLACE | Non ha fonte o provenance |
| Motore di simulazione corrente | REPLACE | Parziale, non riproducibile e non affidabile professionalmente |
| Archivio esclusivamente in memoria | REPLACE | Nessuna persistenza, sicurezza o tracciabilità |

## 11. Architettura target raccomandata

### Applicazione web

- Next.js App Router con separazione tra presentazione, servizi applicativi e dominio.
- Autenticazione server-side e scoping per organizzazione.
- UI di revisione che mostri ogni valore estratto accanto all'evidenza sorgente.
- Route handler limitati all'orchestrazione, senza logica tariffaria incorporata.

### Dominio

- Schemi versionati per documenti, clienti, punti di fornitura, offerte, componenti tariffarie, indici e simulazioni.
- Motori distinti per elettricità e gas.
- Aritmetica decimale o importi in unità minori.
- Unità di misura esplicite, periodi di validità e provenance.
- Funzioni pure, deterministiche e coperte da test.

### Persistenza

- Database relazionale, indicativamente PostgreSQL, con migrazioni e isolamento tenant.
- Versioni immutabili di estrazioni e simulazioni.
- Audit event per modifiche e approvazioni.
- Object storage cifrato in regione appropriata per documenti e immagini pagina.
- Accesso tramite URL a vita breve e policy di retention/cancellazione.

La scelta definitiva di provider database, cloud, autenticazione e OCR richiede requisiti non presenti nel repository e non deve essere assunta in questa fase.

### Pipeline documentale

1. Upload validato e controlli di sicurezza.
2. Registrazione immutabile del documento.
3. Job asincrono e idempotente.
4. Estrazione testo nativo quando disponibile.
5. OCR sulle pagine scansionate.
6. Estrazione layout e tabelle.
7. Adapter specifici per formato/fornitore più strategia generale.
8. Validazione di campo e controlli incrociati.
9. Confidenza ed evidenza per ogni valore.
10. Revisione umana obbligatoria sotto soglia.

### Dati di mercato e tariffe

- Ingestion pianificata da fonti autorevoli.
- Conservazione del dato sorgente e della data di efficacia.
- Versionamento, unità, provenance e riconciliazione.
- Processo esplicito di correzione dei dati.

### Sicurezza e operazioni

- Identity provider, RBAC e isolamento tenant.
- Cifratura, secret management, rate limiting e security header.
- Log strutturati con redazione PII, metriche, tracing e alert.
- CI con lint, typecheck, test, build, controllo migrazioni e dependency scanning.
- Backup, ripristino verificato, retention e procedure di incidente.

## 12. Strategia di migrazione più sicura

La migrazione dovrebbe essere incrementale e mantenere il prototipo come riferimento funzionale, senza trasformarlo direttamente nel nucleo di produzione.

1. **Congelare il comportamento legacy come riferimento.** Conservare il tag esistente e documentare chiaramente che i risultati non sono professionali.
2. **Rimuovere i dati dall'aspetto reale.** Sostituirli in una fase successiva con fixture sintetiche, dopo verifica della loro provenienza.
3. **Definire i contratti di dominio.** Stabilire campi obbligatori, unità, precisione, provenance e stati di verifica.
4. **Costruire un corpus controllato.** Usare PDF sintetici o correttamente anonimizzati con output approvati.
5. **Estrarre la logica dal componente.** Introdurre moduli puri e testati senza cambiare inizialmente il flusso UI.
6. **Sostituire i fallback silenziosi.** Un dato non trovato deve produrre un errore o una richiesta di revisione.
7. **Implementare evidenze e revisione.** Nessun valore economicamente rilevante deve diventare autorevole senza fonte.
8. **Validare il primo calcolo limitato.** Dichiarare esplicitamente ciò che include ed esclude.
9. **Aggiungere persistenza e identità solo dopo la stabilizzazione dei contratti.** Evita di cristallizzare uno schema non validato.
10. **Abilitare produzione per fasi.** Dataset controllati, utenti interni, pilot limitato e infine rollout con metriche e rollback.

Durante la migrazione, il nuovo motore dovrebbe essere confrontato con risultati attesi e, quando opportuno, eseguito in shadow mode prima di mostrare risultati operativi agli utenti.

## 13. Primo milestone proposto: Foundation V1

### Obiettivo

Costruire un nucleo affidabile e verificabile per un solo formato di bolletta elettrica e un solo formato CTE, senza pretendere copertura universale o readiness produttiva.

### Scope

- schemi versionati per bolletta elettrica, CTE, evidenze di estrazione e risultato di simulazione;
- eliminazione dei dati cliente hardcoded dal percorso applicativo;
- fixture PDF sintetiche o anonimizzate e output attesi revisionati;
- adapter per estrazione del testo nativo;
- risultato esplicito per successo, errore e campo da revisionare;
- pagina, estratto sorgente e confidenza per ogni campo;
- interfaccia di revisione e correzione;
- un solo confronto della componente materia energia, con inclusioni ed esclusioni dichiarate;
- aritmetica monetaria appropriata;
- test unitari del dominio;
- test di regressione del parser sulle fixture;
- lint, typecheck e build eseguiti in CI;
- documentazione tecnica e delle limitazioni.

### Fuori scope

- copertura di tutti i fornitori e layout;
- motore gas;
- simulazione completa di imposte e componenti regolate;
- automazione senza revisione;
- classificazione automatica di un'offerta come migliore senza criteri validati;
- rollout pubblico in produzione.

### Criteri di completamento

- nessun campo obbligatorio viene sostituito silenziosamente con zero o valori predefiniti;
- ogni valore estratto è collegato a un'evidenza;
- i calcoli sono deterministici e riproducibili;
- il corpus Foundation V1 supera i test concordati;
- errori e documenti non supportati sono riconosciuti esplicitamente;
- build, lint, typecheck e test sono automatizzati;
- i risultati riportano versione del motore e limitazioni.

## 14. Stato della riscrittura

**Nessuna riscrittura di produzione è ancora iniziata.**

Questo documento registra esclusivamente lo stato del repository, i rischi rilevati e una proposta di direzione. Durante l'audit non sono stati modificati codice applicativo, dipendenze, configurazione Next.js, configurazione Vercel o configurazione Git. La creazione di questo file di documentazione non costituisce l'avvio della riscrittura.

## 15. Comandi eseguiti durante l'audit

I comandi seguenti sono stati eseguiti in modalità di sola lettura. Il tentativo di elencare la documentazione Next.js installata ha segnalato che `node_modules/next/dist/docs` non esisteva.

```powershell
Get-Location
rg --files -g '!node_modules' -g '!.next' -g '!dist' -g '!build'
git status --short --branch
git log -8 --date=iso --pretty=format:'%h%x09%ad%x09%an%x09%s'
Get-Content -Raw package.json
```

```powershell
Get-ChildItem -Force | Select-Object Mode,Length,LastWriteTime,Name
Get-ChildItem node_modules\next\dist\docs -Recurse -File | Select-Object -First 80 -ExpandProperty FullName
Get-Content -Raw next.config.ts
Get-Content -Raw tsconfig.json
Get-Content -Raw eslint.config.mjs
Get-Content -Raw postcss.config.mjs
Get-Content -Raw README.md
Get-Content -Raw CLAUDE.md
Get-Content -Raw AGENTS.md
```

```powershell
Get-Content -Raw app\page.tsx
Get-Content -Raw app\layout.tsx
Get-Content -Raw app\globals.css
Get-Content -Raw .gitignore
git status --porcelain=v2 --branch
git ls-tree -r --name-only HEAD
git show --stat --oneline --decorate HEAD
git log -12 --stat --oneline
git branch -vv
git remote -v
git tag --list
```

```powershell
(Get-Content app\page.tsx).Count
rg -n "use client|interface |useState|useEffect|cdnjs|pdfjs|ts-ignore|any|setTimeout|storicoPUN|BPower|2026-12-31|E2E COMPANY|PASTICCERIA|IT001|IBAN|console\.|FileReader|parseFloat|toISOString|risparmioAnnuo|costoUnaTantum" app
rg -n "TODO|FIXME|HACK|api|route|fetch\(|axios|prisma|drizzle|supabase|firebase|auth|session|cookie|upload|storage|database|ocr|openai|anthropic|zod|valibot|test|vitest|jest|playwright|sentry|logger|telemetry|vercel" -g '!package-lock.json' -g '!.git/**' .
rg --files | rg "(^|\\)(test|tests|__tests__|api|lib|components|server|db|prisma|migrations|\.github)(\\|$)|\.(test|spec)\.|vercel\.json|Dockerfile|middleware|instrumentation|\.env"
Select-String -Path package-lock.json -Pattern '"lockfileVersion"','"next":','"react":','pdfjs','ocr','prisma','zod','vitest','playwright' | Select-Object -First 40
git grep -n -I -E "(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|secret|password|token)" HEAD
```

```powershell
$lines = Get-Content app\page.tsx
for ($i=120; $i -le 295; $i++) { '{0,4}: {1}' -f $i, $lines[$i-1] }
for ($i=1; $i -le 45; $i++) { '{0,4}: {1}' -f $i, (Get-Content app\layout.tsx)[$i-1] }
git rev-list --count HEAD
git log --reverse -1 --date=iso --pretty=format:'%h%x09%ad%x09%an%x09%s'
git log -20 --date=short --pretty=format:'%h%x09%ad%x09%s'
git diff --check
git diff --stat
git diff --cached --stat
git ls-files -s
Test-Path node_modules
Test-Path .next
Test-Path vercel.json
Test-Path .github
```
