# Servizio dati ufficiali (GME, ARERA, Terna)

Servizio tecnico indipendente dal Simulatore EE commerciale (decisione di Tony del 21/11/2026, opzione A). Scarica, verifica, conserva, versiona e pubblica i dati ufficiali negli archivi condivisi su Supabase, per tutte le aziende.

## Cosa fa

| Job | Orario (UTC) | Cosa fa |
|---|---|---|
| `gme` | ogni giorno 05:20 | Per i mesi della finestra operativa acquisisce F1, F2 e F3 dal PDF GME "Prezzo medio per fasce" e il PUN Index GME mensile dalla Newsletter GME che riporta il mese (Tabella 1, riga "Baseload"). Sono due serie distinte, da due documenti conservati. |
| `regulatory` | ogni giorno 03:40 | Aggiorna ARERA (TIT, ASOS, ARIM, UC, CDISPD, capacità TIV) e Terna (TIDE, capacità) con i lettori già verificati, e conserva ogni file scaricato. |
| `audit-pun` | lunedì 06:00 | Audit di giugno–ottobre 2026: confronta i valori approvati con le pubblicazioni GME e registra le divergenze senza correggerle. Se trova una divergenza prepara la versione verificata nell'audit. |

## Regole

- **Pubblicazione**: si pubblica solo ciò che supera tutti i controlli.
  - **Fasce**: PDF, titolo, mese, €/MWh, tre fasce con le ore del mese, finestra operativa.
  - **Mensile**: intestazione del report sul mese, Tabella 1, blocco PUN INDEX GME, riga Baseload, €/MWh, commento coerente con la tabella, coerenza con le fasce entro il 3%. Quest'ultimo è solo un controllo tra documenti GME, non una fonte.
- **Mensile mai ricavato.** Un documento con le sole fasce pubblica solo le fasce.
- **Documenti non ancora pubblicati.** È la situazione normale all'inizio del mese: il job riprova il giorno dopo.
- **Ogni altra anomalia blocca il mese.** Rientrano qui un download rifiutato, un controllo fallito o documenti incoerenti. Il job apre un alert in Control Room e non pubblica nulla.
- **Versioni.** Ogni pubblicazione è una nuova versione del mese per ogni azienda, collegata alla precedente, approvata o rifiutata, che resta invariata. Gli stessi documenti non producono una nuova versione.
- **Mesi già approvati dalla vecchia automazione** (giugno–ottobre 2026): non vengono toccati e passano all'audit.

## Sicurezza

- **Identità tecnica**: `user_svc-dati-ufficiali` con ruolo `OFFICIAL_DATA_SERVICE`, accettato solo per questa identità. Nessun ADMIN fittizio e nessun login.
- **Chiamate**: solo i cron del progetto, con `Authorization: Bearer <CRON_SECRET>`. Il secret deve avere almeno 16 caratteri.
- **Fonti**: solo https verso gli host GME, ARERA e Terna. I redirect verso altri host vengono rifiutati. Ci sono un limite di tempo e uno di dimensione.
- **Archivi**: il servizio scrive solo sulle collezioni dei dati ufficiali (`src/store.ts`, `WRITABLE_COLLECTIONS`) e legge in sola lettura l'elenco delle aziende. Non può aprire bollette, CTE, clienti, offerte, proposte o utenti. Non esiste un metodo di cancellazione. Documenti, esecuzioni, controlli e audit sono append-only.
- **Contenuto della build**: contiene solo i moduli dei dati ufficiali (`build.mjs` si ferma se ne trova uno dell'app commerciale). Non include login, CTE, lettura bollette, motori V2/V3, proposte o interfaccia.
- **Modalità**: senza `OFFICIAL_DATA_SERVICE_MODE=publish` ogni esecuzione è una prova. Scarica e controlla, ma scrive solo il proprio rapporto.

## Database

Fase B (Tony 21/11/2026): il servizio si collega a Postgres **solo come ruolo `svc_dati_ufficiali`** (nessuna chiave Supabase) e può soltanto eseguire le funzioni dello schema `servizio_dati` (migrazione `20261121130000_servizio_dati_ufficiali_privilegi.sql`):
- `leggi`, `elenca`, `scrivi` su `runtime_records`, con i controlli di collezione, azienda, sola aggiunta, versione e regole PUN;
- `aziende_clienti()` per l'elenco delle aziende (solo identificativi).

Le policy RLS riservate al ruolo proprietario delle funzioni sono la seconda barriera. Ogni scrittura finisce in `servizio_dati.registro`. Codice: `src/database.ts`.

## Variabili d'ambiente (progetto Vercel del servizio)

| Nome | Valore |
|---|---|
| `SERVIZIO_DATI_DB_URL` | `postgresql://svc_dati_ufficiali.<ref>@<host pooler>:6543/postgres`, senza password (rifiutato se la contiene) |
| `SERVIZIO_DATI_DB_PASSWORD` | password del ruolo, solo come variabile protetta (sensitive) |
| `SERVIZIO_DATI_DB_CA` | certificato Supabase (PEM): TLS sempre verificato |
| `CRON_SECRET` | nuovo, casuale (≥ 32 caratteri), diverso da quello dell'app |
| `OFFICIAL_DATA_TENANT_IDS` | aziende in aggiunta a quelle create dal produttore (facoltativo) |
| `OFFICIAL_DATA_SERVICE_MODE` | assente = prova; `publish` = pubblica (solo dopo l'autorizzazione) |

## Build

`node build.mjs` genera `.vercel/output` (Build Output API v3):
- una funzione Node.js 22 `api/run`;
- i tre cron;
- `manifest.json` con l'elenco dei moduli inclusi.

I pacchetti esterni sono due, senza dipendenze: `fflate` e `postgres` 3.4.9.

## Rilascio

Vedi `/mnt/project-files/audit/archivi-ufficiali/automazione/servizio-indipendente.md`, sezione "Procedura di rilascio".

## Deployment

Automatico da GitHub (Tony, 23/11/2026): ogni push sul branch `servizio/dati-ufficiali` aggiorna la produzione del progetto Vercel `servizio-dati-ufficiali` (Root Directory `services/dati-ufficiali`, solo il branch di produzione viene costruito). Variabili, CRON_SECRET, cron e modalità prova restano quelli del progetto. Annullamento: Vercel > Deployments > deployment precedente > Instant Rollback. Esito di ogni deployment: stato del commit su GitHub.
