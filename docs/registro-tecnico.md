# Registro tecnico del Simulatore EE

Versione registro: **1** · aggiornato il 24/11/2026 (backlog e regola permanente approvati da Tony il 24/11/2026) · codice di riferimento: commit `e3201ff` su `feature/access-management-v1`

Questo è l'unico registro tecnico del progetto. Ogni modifica approvata aggiorna questo file nello stesso commit del codice.

## 0. Come si usa
- **Fonte autorevole.** In caso di contrasto vale questo registro. Fanno eccezione le regole di calcolo e di lettura, che restano nei documenti citati al §4.
- **Documenti superati.** I documenti `FOUNDATION_V1_*.md` e `OWNER_DECISIONS_FOUNDATION_V1.md` (luglio 2026) e `GRAPHICAL_VALIDATION_PACKAGE_AUTHORIZATION.md` sono **storici**. Descrivono il piano iniziale e non lo stato attuale. Non vanno aggiornati né cancellati, ma non orientano il lavoro. `README.md` è il modello standard di Next.js.
- **Regola di aggiornamento.** Ogni voce porta la data e l'origine (decisione di Tony, verifica sul codice, test). Un dato non verificato è scritto come tale.

**Regola permanente (decisione di Tony del 24/11/2026)**
- Prima di ogni attività si consulta questo registro.
- Non si ripetono le analisi ancora valide.
- Il registro si aggiorna con:
  - risultati verificati;
  - anomalie;
  - decisioni;
  - test;
  - commit.
- Ogni attività ha uno stato tra questi: **DA FARE**, **IN LAVORAZIONE**, **BLOCCATA**, **DA COLLAUDARE**, **COMPLETATA**.
- Una modifica non è conclusa solo perché i test automatici passano. Quando serve, deve superare anche il collaudo funzionale in Preview, eseguito da Tony.

## 1. Stato attuale (24/11/2026)
- **Ambienti.**
  - Production: commit `4949ba5` (branch `main`). È ferma, e qualsiasi rilascio richiede l'autorizzazione di Tony.
  - Preview: commit `e3201ff` (branch `feature/access-management-v1`, PR #23), 355 commit oltre Production. URL fisso del branch: https://simulatore-git-feature-access-management-v1-ai-manager.vercel.app
- **Funzioni presenti in Preview.**
  - accessi e permessi gerarchici, con ruoli e rami commerciali;
  - analisi della bolletta con fasi reali e interruzione;
  - revisione e approvazione dei dati letti;
  - ricerca delle CTE utilizzabili, confronto economico, scontrino e proposta PDF;
  - simulazione tecnica;
  - archivio bollette mensile;
  - anagrafica clienti e POD/PDR;
  - Control Room del produttore per i dati ufficiali GME/ARERA/Terna;
  - avanzamento visibile delle operazioni.
- **Fase.** Il simulatore è in fase di test e i dati di test sono cancellabili (decisione di Tony del 10/11).
- **Codice locale non pubblicato.** Restano 26 file esclusi, fuori da tutti i commit: il motore V3 completo e il «Passo 1» (formula prezzo CTE). Sono protetti da SHA in `/mnt/project-files/audit/archivi-ufficiali/preview-commit/sha256-esclusi.txt` e non vanno toccati senza autorizzazione.

## 2. Architettura verificata (sul codice di `e3201ff`)
| Livello | Dove | Note |
|---|---|---|
| Interfaccia | `app/components/*` (QuickQuoteFlow, BillAnalysisControl, Control Room…) | Next.js 16.2.4, React 19.2.4. La sequenza di una simulazione è oggi guidata dal client (`QuickQuoteFlow`). |
| API | `app/api/*` (bills, simulation, comparison, proposal, cte, eligibility, market, access, cron…) | Autorizzazione con `requestPrincipal` (ruolo e tenant) su ogni rotta. |
| Lettura bollette (AI) | `app/lib/reading/bill-reader*.ts` | Un solo lettore Claude con tool `leggi_bolletta`, temperatura 0 dove accettata, controlli deterministici in `bill-reader-checks.ts`, una sola rilettura se i controlli falliscono. Fasi in `bill-analysis.ts`. |
| Acquisizione | `app/lib/foundation/real-bill.ts`, `app/lib/ingestion/*` | Salvataggio, versioni, correzioni, approvazione e provenienza di ogni campo. |
| Lettura CTE (AI) | `app/lib/cte/anthropic.ts`, `cte/reading-review.ts` | Lettura e verifica dei valori non letti. Approvazione CTE separata. |
| Ammissibilità | `app/lib/eligibility/*` | Deterministica. Le forzature passano solo dai permessi «Può forzare» e «Può delegare». |
| Dati ufficiali | `app/lib/market/*` (PUN GME), `app/lib/foundation/regulatory-*`, `arera-*`, `terna-*`, `app/lib/official-monitor/*` | Archivi versionati con fonte e SHA. Il servizio di acquisizione automatica vive nel branch `servizio/dati-ufficiali` (progetto Vercel separato). |
| Calcolo (deterministico) | `app/lib/calculation/engine.ts` e moduli collegati, `app/lib/quote/*`, `app/lib/comparison/*` | Motore in uso. `app/lib/engine-v3/*` è committato solo in parte, non è collegato al flusso e ha il resto tra i file esclusi. |
| Persistenza | Supabase `mqjgxtpqrsqzqbwastts`, tabella unica `runtime_records` (collection, record_id, tenant_id, payload) | Multi-azienda per `tenant_id`. Nessuna migrazione senza autorizzazione; le migrazioni le esegue Tony. |
| Attività pianificate | `vercel.json`: regulatory-refresh, market-refresh, bill-retention, cte-expiry, official-monitor | Vercel le esegue solo in Production, quindi in Preview non sono mai partite. |

## 3. Problemi e analisi già identificati (aperti)
| # | Problema | Fonte verificata | Stato |
|---|---|---|---|
| P1 | La bolletta Elios (`747c064a-2982-4b27-8e2c-b93fa1f09809`) è letta con `supplyUseCategory` = «domestico non residente» ma con `domesticResidenceStatus` = `NOT_FOUND`. | DB `runtime_records`, letto il 24/11/2026 | Il motore gestisce il caso con il CDISPD (008a2fe). Il lettore non è stato toccato. |
| P2 | Il dato `readingReread` (seconda lettura) è salvato (`reading/bill-reader-map.ts`), ma `foundation/bill-reading-view.ts` non lo invia allo schermo. | codice `e3201ff` | Esporlo richiede una modifica all'API. |
| P3 | 57 test falliscono già sulla baseline: ambiente non configurato, file locali `var/` o fixture mancanti. | suite del 24/11/2026, Appendice A | Non corretti. |
| P4 | `eligibility-override-security.smoke.mjs` fallisce già sulla baseline perché manca la fixture `tests/fixtures/cte-product-qa.ts`. Tony lo considera un'anomalia separata. | `/mnt/project-files/audit/archivi-ufficiali/fase1-forzature-cte/esito.md` | Le sue verifiche sono coperte da un test più recente. |
| P5 | I job dei dati ufficiali dipendono da 127 file, 70 dei quali assenti in Production: il rilascio isolato in Production non è possibile. | `/mnt/project-files/audit/archivi-ufficiali/automazione/rilascio-production-blocco.md` | In attesa di una decisione di Tony. |
| P6 | Mancano ASOS gennaio–giugno 2026. Il dispacciamento ARERA si ferma a ottobre. L'ultimo refresh ARERA è del 6/11. | `/mnt/project-files/audit/archivi-ufficiali/copertura-reale/esito.md`, `/mnt/project-files/audit/archivi-ufficiali/recupero-fonti/esito.md` | Dati realmente mancanti. |
| P7 | La sostituzione versionata dei PUN mensili derivati è pronta ma spenta: il flag `OFFICIAL_DATA_REPLACE_DERIVED_PUN_ONLY` vive nel branch `servizio/dati-ufficiali` e non è attivo. | `services/dati-ufficiali/src/handler.ts` su `origin/servizio/dati-ufficiali` | In attesa di Tony. |
| P8 | La prova di ripristino completo del backup su un database isolato non è completata. È stata eseguita una prova con PostgreSQL 16.15, non con la 17.6. | `/mnt/project-files/audit/archivi-ufficiali/automazione/passo2/fase-a/post-verifica/post-verifica-fase-a-2026-11-21.md`, `.../backup/versione-1/backup-preventivo.md` | Limite registrato. |
| P9 | Le regole di calcolo e di lettura stanno in `/mnt/project-files/regole/`, fuori da git: non sono versionate. | verificato il 24/11/2026 | Da decidere. |
| P10 | La sequenza della simulazione (analisi → revisione → approvazione → CTE → confronto → proposta) è guidata dal client `QuickQuoteFlow.tsx`. Non esiste un esito di controllo qualità salvato con la simulazione. | codice `e3201ff` | Attività 02 e 07. |
| P11 | La barra di invio per i file oltre 4 MB (PUT con URL firmato) non è verificata nell'app. | rapporto `/mnt/project-files/audit/grafica/avanzamento/rapporto-progressione-operazioni.md` | Attività 04, collaudo. |

Diagnosi dettagliate: `/mnt/project-files/audit/` (un file per caso, con esito e diff).

## 4. Decisioni approvate da Tony (sintesi; il testo completo è nelle fonti)
Fonti complete:
- `/mnt/project-files/regole/regole-calcolo.md`
- `/mnt/project-files/regole/regole-lettura.md`
- `/mnt/project-files/regole/atlante-voci-bolletta.md`

L'Atlante del 2–3/11 prevale.

**Calcolo e dati ufficiali**
- **Rete e oneri (5/11):** si calcolano sempre dalle tariffe ARERA del periodo, mai copiati dalla bolletta.
- **PUN (6/11, 20–24/11):**
  - è un dato mensile, monorario o per fasce;
  - viene solo dai PDF ufficiali GME, conservati con SHA;
  - il mensile non si ricava mai da fasce, quartorari o formule;
  - il PUN stampato in fattura serve solo per confronto.
- **Agosto 2026:** vale 180,00, dal Grafico 1 della newsletter n. 207, previa validazione.
- **Perdite (15/11):** coefficiente TIS per periodo e tensione (BT 2026 = 10%). Nessun prezzo forzato per far quadrare il conto. Accise calcolate in autonomia.
- **IVA (18/11):** nella ricostruzione si usa l'aliquota esposta in bolletta. Nella simulazione si parte dalla stessa configurazione della bolletta. Mai 22% automatico, mai agevolazioni non documentate.
- **Consumo annuo (12/11):** si usa nell'ordine il valore dichiarato, poi lo storico, poi il periodo annualizzato. La stima è sempre etichettata come tale. Senza dati sufficienti non c'è stima.

**Simulazioni e archivi**
- **Finestre (17/11):**
  - l'archivio operativo PUN/PSV copre solo i 6 mesi precedenti;
  - si simulano solo bollette con periodo negli ultimi 5 mesi, con blocco lato server.
- **CDISPD e confronto (24/11):**
  - il CDISPD si applica ai domestici, anche con residenza non determinata (ARERA 386/2025), e mai ai business;
  - se manca una componente obbligatoria, il risparmio è provvisorio, «La più conveniente» non compare e il PDF è bloccato.
- **Visualizzazione (11/11):** kWh senza decimali sullo schermo, piena precisione nei calcoli.
- **Bollette con proposte (10/11):** non si cancellano (errore 409).
- **Cancellazioni:**
  - «Cancella tutte» e «Svuota archivio» sono disattivati (errore 410).
  - La cancellazione di bollette selezionate o di un mese è possibile, con conferma esplicita (decisione del 20/11).
  - Mai cancellare utenti, aziende o credenziali.

**Lettura**
- **Lettore unico (5/11):** un solo lettore Claude. Mai rileggere dal testo del PDF. Gli errori di lettura si correggono nel prompt, nello schema o nei controlli, con un test.
- **Lettori AI (1/11):**
  - temperatura 0 dove accettata;
  - mai inventare, si legge solo ciò che è stampato;
  - i valori regolati sono identici per ogni CTE.

**Processo di lavoro**
- **Rilasci:** nessun commit, push o deploy senza autorizzazione esplicita. Production solo con una nuova autorizzazione. Nessuna migrazione Supabase da parte di Claude.
- **Progressione operazioni (24/11):** percentuale solo per i byte inviati; tempi reali; il passo fallito resta visibile.

## 5. Baseline dei test (24/11/2026, commit `e3201ff`)
- **Suite:** `tests/*.smoke.mjs`, 287 file, **230 OK e 57 falliti**. I 57 sono preesistenti, con le cause in Appendice A.
- **Comando:**
  ```
  node --experimental-strip-types --experimental-loader ./tests/node-ts-extension-loader.mjs --no-warnings tests/<file>.smoke.mjs
  ```
  Variabili d'ambiente: `FOUNDATION_LOCAL_DEV=true APP_RUNTIME_MODE=local FOUNDATION_LOCAL_TENANT_ID=tenant_local-demo`.
- **Regola di non regressione:** una modifica non deve aumentare i falliti né cambiarne la causa. Le cause si confrontano a parità di dati locali (`var/`).
- **Altri controlli:**
  - `tsc --noEmit` pulito;
  - lint con 3 errori preesistenti in `QuickQuoteFlow.tsx` (apostrofi) e 1 avviso preesistente in `engine.ts`;
  - `next build` riuscita, con 1 avviso preesistente su `next.config.ts`.

## 6. Commit e versioni di riferimento
| Commit | Contenuto |
|---|---|
| `4949ba5` | `main`, Production |
| `e3201ff` | Progressione operazioni (Preview attuale) |
| `008a2fe` | CDISPD domestici senza residenza, risparmio solo se completo, scontrino a tre colonne |
| `dc355fc` | Nuova simulazione: grafica |
| `dd6bf4b` / `e7644bc` | Permessi gerarchici, analisi interrompibile, gestione delegata per ramo |
| `2fb5a38` / `1c856ab` | Anagrafica clienti e POD/PDR, modulo Clienti e Forniture |
| `5336cdf` / `d0c0f18` | Control Room PUN; servizio dati ufficiali escluso dal branch commerciale |
| `cd0700e` | Correzione doppio conteggio oneri (Nora Elios) |
| `9a80bda` | Permessi «Può forzare»/«Può delegare», archivio bollette per mese |
| `eb36c98` | Lettore bollette unico (5/11) |
| `98e70e2` | Servizio dati ufficiali V5 (branch `servizio/dati-ufficiali`) |

## 7. Backlog ordinato (ordine operativo deciso da Tony il 24/11/2026)
Ogni attività richiede l'autorizzazione di Tony prima delle modifiche applicative. La colonna «Problemi» rimanda al §3.

| # | Attività | Stato | Problemi |
|---|---|---|---|
| 01 | Affidabilità della lettura bollette | DA FARE | P1, P2 |
| 02 | Validazione e controllo qualità | DA FARE | P10 |
| 03 | Restyling grafico completo | DA FARE | — |
| 04 | Progressione delle operazioni | DA COLLAUDARE | P11 |
| 05 | Eliminazione delle bollette | DA FARE | — |
| 06 | Affidabilità CTE e simulazioni | DA FARE | P6, P7 |
| 07 | Coordinamento operativo | DA FARE | P10 |
| 08 | Collaudo finale | DA FARE | P3, P4, P5, P8 |

**01. Affidabilità della lettura bollette**
- Verificare e correggere le incongruenze di lettura ("OCR").
- Separare i dati realmente letti da quelli calcolati e da quelli stimati.
- Controllare consumi, potenze, POD, intestatario e condizioni contrattuali.
- Impedire che un valore mancante venga interpretato come zero.
- Usare i componenti esistenti dell'Agente 1 (§8.2).
- Vincolo: la lettura avviene con il solo lettore Claude, mai dal testo del PDF (§4).

**02. Validazione e controllo qualità**
- Centralizzare i controlli già presenti.
- Verificare la riconciliazione economica della fattura.
- Distinguere errori bloccanti e segnalazioni informative.
- Impedire proposte definitive con dati obbligatori non verificati.
- Attivare l'Agente 3 senza duplicare i calcoli.

**03. Restyling grafico completo**
- Progettare un'interfaccia SaaS moderna e professionale.
- Definire un design system coerente.
- Migliorare dashboard, caricamento, lettura, simulazioni, CTE, archivio e proposte.
- Garantire leggibilità e comportamento responsive.
- Evitare correzioni estetiche isolate.

**04. Progressione delle operazioni**
- Fasi effettive visibili.
- Tempi, stati, completamenti ed errori mostrati.
- Nessuna percentuale artificiale.
- Si riutilizzano i componenti di `e3201ff`.
- Stato: pubblicato in Preview il 24/11/2026, collaudo funzionale di Tony in attesa.

**05. Eliminazione delle bollette**
- Rimozione dalla simulazione.
- Eliminazione dall'archivio con conferma.
- Verifica delle autorizzazioni e dell'isolamento multi-tenant.
- Gestione di PDF, dati estratti e documenti collegati.
- Rispetto degli obblighi di conservazione applicabili.
- Vincolo in vigore (decisione del 10/11): le bollette con proposte collegate non si cancellano (errore 409).

**06. Affidabilità CTE e simulazioni**
- Verificare prezzi fissi e variabili.
- Verificare eleggibilità e condizioni contrattuali.
- Applicare correttamente i parametri ufficiali.
- Verificare le singole componenti economiche.
- Bloccare confronti e risparmi non determinabili.
- Riutilizzare il motore deterministico e l'Agente 2.

**07. Coordinamento operativo**
- Implementare progressivamente il coordinatore lato server.
- Gestire stati, attività, errori e riprese.
- Attivare solo gli agenti necessari.
- Conservare evidenze e tracciabilità.
- Nessun servizio AI aggiuntivo senza autorizzazione preventiva.

**08. Collaudo finale**
- Bollette domestiche e business.
- Offerte fisse e variabili.
- Risultati confrontati con i documenti originali.
- Ruoli Direttore, Agente e Sub-agente.
- Isolamento multi-azienda, archivi ed eliminazioni.
- Assenza di regressioni prima della Production.

## 8. Architettura degli agenti (approvata da Tony il 24/11/2026)

### 8.1 Principi vincolanti
1. **Tre livelli separati.**
   - **AI**: solo la lettura di documenti (bollette, CTE) e, se approvata, una seconda lettura indipendente nel controllo qualità.
   - **Calcolo deterministico**: tutte le cifre (motore, dati ufficiali, ammissibilità).
   - **Autorizzazioni umane**: approvazione della bolletta, approvazione della CTE, forzature, emissione della proposta.

   L'AI non approva, non calcola importi e non decide autorizzazioni.
2. **Coordinatore senza AI.** È una macchina a stati deterministica sul server: decide quale agente attivare in base allo stato della pratica, non in base a un ragionamento libero.
3. **Tre stati per ogni dato**, ciascuno con la sua origine:
   - `CERTO`: stampato e confermato da una persona, oppure ufficiale con fonte e SHA;
   - `INCERTO`: letto dall'AI con un controllo fallito, ricavato o stimato;
   - `ASSENTE`: non stampato o non disponibile.

   Nessun passaggio automatico da `INCERTO` a `CERTO`: serve un'azione dell'utente registrata nell'audit (conferma o correzione) oppure un documento ufficiale.
4. **Risultati strutturati e verificabili.** Ogni agente restituisce un oggetto versionato, salvato nella pratica, con gli input usati (versioni e hash) e l'elenco dei controlli eseguiti con il loro esito.
5. **Multi-azienda.** Ogni pratica, risultato e audit ha `tenant_id`. Un agente non legge dati di un altro tenant. I dati ufficiali sono gli unici condivisi.

### 8.2 Componenti esistenti riutilizzati
| Ruolo | Riutilizzo (già in produzione nel codice) | Da aggiungere |
|---|---|---|
| Coordinatore | `reading/bill-analysis.ts` (job con fasi, interruzione, scarto), operazioni `confirm-fields`/`correct`/`approve` di `foundation/real-bill.ts`, `api/simulation/context`, `api/comparison`, `api/proposal` | Record «pratica» con stati e risultati degli agenti; sequenza spostata dal client (`QuickQuoteFlow`) al server; ripresa dopo la chiusura della pagina |
| Agente 1, Lettura | `reading/bill-reader.ts` + `bill-reader-schema.ts` (AI), `bill-reader-checks.ts` (controlli), `bill-reader-map.ts`, `ingestion/*` (periodo, storico, tipo cliente, vettore, profilo fornitura), `readingSources`/`readingAbsent`/`readingChecks` | Stato per campo (`CERTO`/`INCERTO`/`ASSENTE`) calcolato da questi dati; controlli espliciti su intestatario, POD, potenze e importi |
| Agente 2, Energia e CTE | `cte/anthropic.ts` + `cte/reading-review.ts` (AI lettura CTE), `cte/validation.ts`, `cte/calculation-ready.ts`, `eligibility/*`, `market/*` (PUN GME), `foundation/regulatory-*`, `arera-*`, `terna-*`, `calculation/engine.ts`, `quote/receipt.ts`, `comparison/*` | Uscita unica §8.3 con elenco dei parametri ufficiali usati (fonte, periodo, SHA) e delle componenti non determinabili |
| Agente 3, Controllo qualità | `bill-reader-checks.ts`, `quote/receipt.ts` (`regulatedVerification`, `reconcileSellerFixed`, determinabilità), `QuickQuoteFlow` `incoherentOffers`/`savingDetermined`, `ingestion/monthly-bands.ts` (riconciliazioni), `calculation/technical-quadrature.ts`, `engine-v3/reconcile.ts` | Esecuzione separata sul server, esito salvato, blocco della proposta; spostare in `app/lib` i controlli oggi nel componente |

### 8.3 Contratti di input/output (TypeScript, da implementare in `app/lib/agents/`)
```ts
type Certezza = "CERTO" | "INCERTO" | "ASSENTE";
interface Dato<T> { valore: T | null; certezza: Certezza; origine: "STAMPATO" | "CONFERMATO_UTENTE" | "CORRETTO_UTENTE" | "UFFICIALE" | "STIMATO" | "ASSENTE";
  fonte?: { pagina?: number; testo?: string; documento?: string; sha256?: string }; motivo?: string }
interface Controllo { codice: string; esito: "SUPERATO" | "FALLITO" | "NON_ESEGUIBILE"; messaggio: string; campi: string[] }

// Coordinatore: la pratica
interface Pratica { id: string; tenantId: string; utenteId: string; stato: "RICEVUTA" | "LETTURA" | "REVISIONE_UTENTE" | "CALCOLO" | "CONTROLLO" | "PRONTA" | "BLOCCATA" | "ANNULLATA";
  bolletta: { id: string; versione: string }; risultati: { lettura?: string; calcolo?: string; controllo?: string }; // id dei risultati versionati
  passi: { agente: 1 | 2 | 3 | "UTENTE"; inizio: string; fine?: string; esito?: "OK" | "ERRORE"; errore?: string }[] }

// Agente 1: lettura bolletta
interface InputLettura { tenantId: string; bollettaId: string; pdfSha256: string }
interface EsitoLettura { versione: string; lettore: string; modello: string; riletta: boolean;
  intestatario: Dato<string>; codiceFiscalePiva: Dato<string>; pod: Dato<string>; indirizzoFornitura: Dato<string>;
  categoria: Dato<"DOMESTICO_RESIDENTE" | "DOMESTICO_NON_RESIDENTE" | "ALTRI_USI">; tensione: Dato<"BT" | "MT" | "AT">;
  potenzaImpegnata: Dato<number>; potenzaDisponibile: Dato<number>; periodo: Dato<{ inizio: string; fine: string }>;
  consumi: { F1: Dato<number>; F2: Dato<number>; F3: Dato<number>; totale: Dato<number>; annuo: Dato<number> };
  contratto: { fornitore: Dato<string>; offerta: Dato<string>; codiceOfferta: Dato<string> };
  importi: { totale: Dato<number>; materiaEnergia: Dato<number>; rete: Dato<number>; oneri: Dato<number>; imposte: Dato<number>; iva: Dato<number>; altrePartite: Dato<number> };
  voci: { descrizione: string; quantita: Dato<number>; prezzo: Dato<number>; importo: Dato<number>; classe: string }[];
  controlli: Controllo[] }

// Agente 2: energia e CTE (solo dati con certezza CERTO entrano nel calcolo)
interface InputCalcolo { tenantId: string; lettura: { id: string; versioneApprovata: string }; cte: { archiveId: string; versione: string }[] }
interface EsitoCalcolo { versioneMotore: string; offerte: { cte: { archiveId: string; versione: string };
  ammissibilita: { esito: "AMMESSA" | "AMMESSA_PER_FORZATURA" | "ESCLUSA"; motivi: string[] };
  componenti: { codice: string; importo: number | null; determinabile: boolean; motivo?: string; parametri: { nome: string; valore: number; fonte: string; periodo: string; sha256?: string }[] }[];
  totaleOfferta: number | null; totaleBollettaConfronto: number | null; risparmio: number | null; risparmioDeterminato: boolean }[];
  controlli: Controllo[] }

// Agente 3: controllo qualità (non modifica nulla, emette solo un verdetto)
interface InputControllo { tenantId: string; lettura: string; calcolo: string }
interface EsitoControllo { verdetto: "SUPERATO" | "SUPERATO_CON_AVVISI" | "NON_SUPERATO"; controlli: Controllo[];
  riconciliazioni: { voce: string; stampato: number | null; ricostruito: number | null; differenza: number | null; tolleranza: number }[];
  bloccaProposta: boolean; motivi: string[] }
```

### 8.4 Coordinamento
- **Sequenza.**
  1. RICEVUTA → **Agente 1**.
  2. REVISIONE_UTENTE: l'utente conferma o corregge i dati `INCERTO` e approva la bolletta. È un'azione umana con audit.
  3. **Agente 2.**
  4. **Agente 3.**
  5. PRONTA, oppure BLOCCATA con i motivi.
- **Errori.** Ogni passo registra inizio, fine ed esito. Un errore lascia la pratica nello stato in cui si trovava, con il passo fallito visibile, e si può riprendere. Nessun risultato parziale viene presentato come completo.
- **Rilettura.** Se l'utente corregge la bolletta, si ricalcola da Agente 2. Se cambia la CTE o un parametro ufficiale, i risultati precedenti restano conservati e si crea una nuova versione.
- **Fine.** Il coordinatore dichiara completata la pratica solo se l'Agente 3 ha emesso `SUPERATO` o `SUPERATO_CON_AVVISI`.

### 8.5 Controlli obbligatori
- **Agente 1:**
  - F1+F2+F3 coincide con il totale;
  - le quote «di cui» tornano;
  - la somma dello scontrino coincide con il totale;
  - quantità × prezzo coincide con l'importo;
  - periodo e consumo sono presenti;
  - formato del POD (IT + 14 caratteri);
  - intestatario e codice fiscale/P.IVA presenti;
  - potenze coerenti con la tensione;
  - categoria cliente stampata.
- **Agente 2:**
  - la CTE è approvata e valida nel periodo;
  - ammissibilità deterministica;
  - ogni parametro ufficiale ha fonte, periodo e SHA;
  - nessun valore regolato è copiato dalla bolletta;
  - i valori regolati sono identici per ogni CTE;
  - le perdite e il CDISPD seguono le regole del §4;
  - le componenti non determinabili sono elencate.
- **Agente 3:**
  - la ricostruzione della bolletta coincide con il totale stampato, entro la tolleranza in centesimi;
  - le voci regolate sono confrontate con ARERA;
  - nessun doppio conteggio;
  - coerenza tra offerte (stesso fornitore: spread e PCV più alti non costano meno);
  - il risparmio è dichiarato solo se determinato;
  - nessun dato `INCERTO` usato come `CERTO`;
  - i campioni di regressione restano invariati al centesimo.

## Appendice A. 57 test falliti sulla baseline (prima riga d'errore)
```
anthropic-cte-provider.smoke.mjs — TypeError: Cannot read properties of undefined (reading 'get')
approved-cte-archive.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/phase6/cte-archives/tenant_local-demo/cte-ingestion-c30431e0-11ab-4
asos-arim-runtime-projection-real.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
auth-role-security-runtime.smoke.mjs — Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'node_modules/next/server'
available-power-no-derivation.smoke.mjs — AssertionError [ERR_ASSERTION]: BILL_QA_DOMESTIC_3KW.pdf approved fixture missing
bill-audit-ui.smoke.mjs — AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
bill-billing-address-overflow.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/foundation-documents/tenant_local-demo/93d9b1f0-c748-4c66-
bill-compact-audit-detail.smoke.mjs — AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
bill-cost-transparency-real.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
bill-final-ui.smoke.mjs — AssertionError [ERR_ASSERTION]: The input did not match the regular expression /bill-audit-regulated-table-wrap.*overflow-x:hi
bill-header-alignment.smoke.mjs — AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
bill-pdf-layout-billing-address.smoke.mjs — AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
bill-post-ocr-diagnostics.smoke.mjs — AssertionError [ERR_ASSERTION]: The input did not match the regular expression /document: await attachOfficialPun\
bill-receipt-complete.smoke.mjs — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
bill-regulated-resolution.smoke.mjs — AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
bill-retention.smoke.mjs —   return new Error("METADATA_INVALID");
bill-role-governance-api.smoke.mjs — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
bill-role-governance.smoke.mjs — AssertionError [ERR_ASSERTION]: real business bill exists
bill-summary-commercial-context.smoke.mjs —       Error.captureStackTrace(err);
bill-summary-golden-ui-contract.smoke.mjs —       Error.captureStackTrace(err);
bill-summary-regression-recovery.smoke.mjs —       Error.captureStackTrace(err);
bta6-arim-official.smoke.mjs — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
bta6-official-sources.smoke.mjs — Error: ENOENT: no such file or directory, open '.tmp-regulatory-sources/ee-calc-3c2/575-2025-R-eel-TABELLE_TIT.xlsx'
bta6-scope-readiness.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/foundation-regulatory-data/records.json'
cte-approved-exact-review-parity.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/phase6/cte-archives/tenant_local-demo/cte-ingestion-c30
cte-authoritative-contract.smoke.mjs — Error: ENOENT: no such file or directory, scandir 'var/phase6/cte-archives'
cte-eligibility.smoke.mjs — Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'tests/fixtures/cte-product-qa.ts'
cte-http-json-boundary.smoke.mjs — AssertionError [ERR_ASSERTION]: Missing expected rejection.
cte-received-delete-snapshot.smoke.mjs — Error: ENOENT: no such file or directory, scandir 'var/phase6/cte-archives/tenant_local-demo'
cte-review-normalization.smoke.mjs — AssertionError [ERR_ASSERTION]: latest local EE CTE review or approved record is required for regression
domestic-cdispd-source.smoke.mjs — AssertionError [ERR_ASSERTION]: official workbook must be available in the system temp directory
ee-audit-gap-closure.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/foundation-documents/metadata.json'
ee-domestic-resident-matrix.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/foundation-documents/metadata.json'
ee-july-official-values.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/foundation-regulatory-data/records.json'
eligibility-override-security.smoke.mjs — Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'tests/fixtures/cte-product-qa.ts'
gme-historical-archive.smoke.mjs — Error: ENOENT: no such file or directory, open '/tmp/simulatore-gme-audit-20260911-075709/Anno2026.zip'
official-regulatory-2026-reconciliation.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
official-runtime-data-2026-acquisition.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
production-adapters.smoke.mjs — Error: ENOENT: no such file or directory, open '.env.example'
production-persistence-schema.smoke.mjs — Error: ENOENT: no such file or directory, open 'supabase/migrations/20260915090000_harden_runtime_acl.sql'
real-bill-arera-analysis-recovery.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-bill-current-cte-override-ui.smoke.mjs — AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
real-bill-economic-reconciliation.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-bill-manual-approval.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-cte-calculation-gaps-closure.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/cte-diagnostics/tenant_qa-company/cte-ingestion-a6ab55
real-cte-economic-contract-audit.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/cte-diagnostics/tenant_qa-company/cte-ingestion-a6ab55f
real-cte-eligibility.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-cte-provider-recovery.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-cte-runtime-data-closure.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/market-archive/metadata.json'
real-cte-schema-contract-reset-retry.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-cte-schema-contract-reset.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/cte-diagnostics/tenant_qa-company/cte-ingestion-a6ab55fe-
real-cte-text-protocol.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-cte-threshold-evidence.smoke.mjs — Error: ENOENT: no such file or directory, open 'var/cte-diagnostics/tenant_qa-company/cte-ingestion-a6ab55fe-713
real-regulatory-runtime-approval.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
real-regulatory-runtime-resolvers.smoke.mjs —   throw new Error(`RUNTIME_ENV_NOT_CONFIGURED:${reason}`);
regulatory-ee-economic.smoke.mjs — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
simulation-bill-driven-backend.smoke.mjs — Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'tests/fixtures/cte-product-qa.ts'
```
