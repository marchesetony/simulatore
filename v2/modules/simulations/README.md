# Simulation EE V2 — COMMERCIAL_ONLY

UI → API → SimulationService → motore puro server-side → SimulationRepository.
Il servizio verifica le fonti, costruisce lo snapshot, calcola e richiede al port una
creazione atomica. Nessun update/delete/ricalcolo in lettura. Nuovo calcolo = nuovo ID.

## Evidenze matematiche lette prima dell'implementazione

| Formula | Evidenza V1 | Unità / comportamento recuperato |
|---|---|---|
| Fisso p × Q | app/lib/calculation/engine.ts, addElectricityEnergy, 114–120 | €/kWh × kWh; spread fisso separato, soltanto €/kWh |
| Indicizzata (PUN/1000 + spread) × q | stesso file, 122–135 | PUN €/MWh, spread €/kWh, ogni mese/fascia F1/F2/F3 |
| Fee × base | stesso file, quantityForFee/addFeeComponents, 43–55 | mese × M; anno × M/12 |
| Sbilanciamento × Q (solo evidenza V1) | stesso file, addDeclaredComponent, 57–61 | in V2 conservato come dichiarazione; se applicabile blocca, non entra nel totale |
| Arrotondamento per componente e somma centesimi | convertDrafts/totalMinor; app/lib/calculation/decimal.ts, roundSigned/roundCents | half-up, segno preservato, BigInt |

`tests/calculation-comparison.smoke.mjs` dimostra ripetibilità, mancanza PUN/fasce,
profilo mensile coerente e componenti indicizzate per mese/fascia. NON costituisce golden
numerico completo. I nuovi test verificano aspettative matematiche esplicite, senza
presentare le fixture V1 come tariffe reali. Nessun import runtime del motore legacy.
Risparmio/percentuale sono autorizzati dal contratto V2, non attribuiti a golden V1.

## Contratto

Simulation: UUID server, tenantId, billId, supplyId, scope COMMERCIAL_ONLY, status
DRAFT/CALCULATED/BLOCKED, inputSnapshot, result, calculationVersion `commercial-ee-1`.
La creazione atomica emette solo CALCULATED o BLOCKED; DRAFT non ha workflow/API.
Nessun timestamp influenza il risultato. Nessuna fonte viene recuperata dal motore.

Input API stretto: billId, calculationPeriod, currentCommercialTerms (nullable),
candidateCommercialTerms (nullable), marketSnapshot (nullable). Tutte le chiavi sono
richieste; null è esplicito. Chiavi sconosciute rifiutate anche nei sotto-oggetti.
Nessun input per tenant, scope, stato, versione, risultato, saving o costo attuale.

Snapshot: riferimenti Bill (id, numero documento, customerId), Supply (id, POD),
periodo, consumi storici con relativi periodi, termini e mercato ricevuti e validati,
versione motore. Nessun totale dichiarato Bill, approvazione Bill, OCR o payload provider.
Il servizio copia i dati; il port deve conservare l'intero snapshot immutabilmente,
rifiutare sostituzioni dello stesso ID e restituire solo record del tenant richiesto.
Lettura = risultato salvato, senza ricostruzione da Bill o offerte mutate.

## Periodi e consumi

Date ISO, estremi inclusivi. Stesso giorno valido, inversione rifiutata.
Il periodo calcolato deve essere contenuto nella Bill; nessuna conversione legacy implicita.
Tutti i record consumi della Bill sono conservati: il motore non scarta selettivamente
record che potrebbero sovrapporsi. Se non formano una copertura disgiunta e continua del
periodo richiesto, il calcolo blocca. Questo può bloccare richieste di sottoperiodi.

Per fisso: TOTAL noto oppure somma di F1/F2/F3 tutte note nello stesso gruppo temporale.
Gruppi disgiunti che coprono tutto il periodo possono essere sommati; nessun dato è scritto
nella Bill. TOTAL e fasce completi devono coincidere esattamente. Null non è zero.
Per indicizzata: un gruppo per ciascun mese (o porzione inclusiva del mese richiesta),
con F1/F2/F3 note. Un consumo multi-mese non viene distribuito. Nessun pro-rata energia.
Duplicati e sovrapposizioni tra gruppi bloccano; negativi/incoerenze numeriche rifiutati.

## Termini commerciali temporanei

Non sono una CTE: reference, validità inclusiva, mode FIXED/INDEXED, taxTreatment EXCLUDED,
fixedPrice, spread e fees. Una Rate dichiara applicability APPLIES/NOT_APPLICABLE/UNKNOWN,
amount decimale nullable e unit esplicita nullable. NOT_APPLICABLE richiede amount/unit null.
APPLIES senza importo/unità blocca; UNKNOWN blocca. Nessuna unità inferita.
Validità termini deve coprire il periodo. Nessuna richiesta a CTE o Market runtime.

Identità semantica: una sola voce per ciascuno dei ruoli COMMERCIALIZATION, IMBALANCE,
OTHER_VARIABLE, ONE_OFF, DISCOUNT. Tutti i ruoli devono essere dichiarati, anche quando
non applicabili. Nessun ID o descrizione permette duplicati dello stesso ruolo.
COMMERCIALIZATION applicabile: soltanto €/mese o €/anno e mesi completi. IMBALANCE
resta un campo dichiarato: disgiunzione economica da spread e altre componenti
NON_VERIFICATA. APPLIES blocca il lato interessato con AMBIGUOUS_COMPONENT, anche
senza spread; NOT_APPLICABLE non aggiunge costi; UNKNOWN resta fail-closed.
Candidate ambiguo: nessun totale. Current ambiguo: Candidate valido conservato,
comparison NOT_AVAILABLE e risparmio/percentuale null. Nessun flag client prova disgiunzione.
OTHER_VARIABLE, ONE_OFF e DISCOUNT applicabili bloccano AMBIGUOUS_COMPONENT: questo
modello minimo non dimostra disgiunzione delle voci generiche né evento della una tantum.
Non vengono omessi né stimati. Esplicita non applicabilità consente di proseguire.
Più quote di commercializzazione non sono aggregate automaticamente.

Fisso: fixedPrice APPLIES; spread esplicitamente applicabile o non applicabile.
Indicizzata: fixedPrice NOT_APPLICABLE e spread APPLIES, anche quando noto zero.
Nessuna tassa o componente regolata entra nel modello; enum sconosciuti rifiutati.
L'input manuale dichiara condizioni economiche: la validazione non ne certifica
l'autenticità documentale. Non esiste approvazione commerciale o workflow CTE.

## MarketSnapshot

Reference e values: month YYYY-MM, band F1/F2/F3, value decimale nullable (anche negativo),
unit EUR_PER_MWH e versionReference. Ogni mese/fascia necessario deve essere noto.
Duplicati mese/fascia bloccano anche con versioni diverse. Un mese differente non è un
fallback. Nessun PUN monorario. Nessuna acquisizione o selezione di versione automatica.
I riferimenti sono manuali e non attestano provenienza ufficiale.

## Precisione e confronto

Coefficienti/prezzi: stringhe esatte, fino a 9 cifre intere e 6 decimali; consumi 3 decimali
come Bill V2. PUN può essere negativo; prezzi/fee commerciali e kWh non negativi.
Intermedi razionali BigInt; half-up al centesimo per componente (negativi: metà lontano
 da zero). Somma dei centesimi arrotondati; overflow fuori safe integer blocca.
Fisso e spread arrotondati separatamente; indicizzata PUN+spread insieme per mese/fascia.
Nessun epsilon o tolleranza monetaria. Nessuna annualizzazione/proiezione.
La fee annua usa M/12 solo come formula recuperata, non come proiezione del risultato.

Stesso periodo, profilo, modello componenti e rounding per current e candidate.
Candidate incompleto → BLOCKED, nessun costo. Current assente/non calcolabile → candidate
può essere CALCULATED; comparison NOT_AVAILABLE e savings null. Non si usa la Bill come
baseline monetaria. Risparmio = current cents − candidate cents, anche negativo.
Percentuale solo con confronto disponibile e current > 0: saving/current × 100.

DECISIONE_TECNICA_DA_VALIDARE: percentuale stringa con due decimali, half-up; limiti di
precisione input e granulosità delle componenti recuperata. Non sono golden business.
Rounding monetario segue V1, ma richiede validazione commerciale delle casistiche reali.

## Sicurezza, API e persistenza

Tre permission simulations:list/read/create derivate dal ruolo canonico verificato.
Tenant autorevole dalla sessione; Platform richiede target esistente e attivo ad ogni
operazione. Customer, Supply e Bill vengono verificati nello stesso tenant prima del
calcolo; ownership consumi verificata. UUID server. Nessun endpoint update/delete.
JSON massimo 128 KiB, origine esatta sulle scritture, cookie unico, risposte no-store,
errori sicuri e reason code business chiusi. Nessuna diagnostica tecnica in UI ordinaria.

Production: UnavailableSimulationRepository e Bill repository già fail-closed.
Archivio non disponibile → errore reale; nessun successo, elenco vuoto artificiale,
filesystem JSON o memoria production. In-memory solo v2/tests/simulation-fixtures.mjs.
Nessuna migration creata. Per attivare produzione serviranno schema/adapter revisionati,
atomicità, vincoli tenant-aware e verifica integrata; nessuno di questi è dichiarato pronto.
Visual QA e Browser E2E non eseguiti. Limiti AUTH/Customer/Bill precedenti restano aperti.
