# Bolletta EE V2 — contratto manuale

`/v2/bills` → API `/api/v2/bills` e `/api/v2/supplies` → `BillService` → `BillRepository` → datastore.
Customer è riutilizzato attraverso il suo repository, senza modificarne campi o schema.
Nessun accesso diretto al datastore dalla UI/API, nessuna dipendenza dal Bill V1.

## Persistenza e attivazione

La baseline locale non contiene uno schema Bill V2. È adottata l'opzione **fail-closed**
prevista dal contratto: `billRuntime()` collega `UnavailableBillRepository`.
Tutte le operazioni dell'archivio restituiscono indisponibilità; non vengono confermati
salvataggi e non si mostra un elenco vuoto fittizio. Configurazione AUTH assente: errore sicuro.
L'unico adapter in memoria è in `v2/tests/bill-fixtures.mjs`, mai nel runtime.

Nessuna migration proposta o applicata. Questo mattone non dichiara pronta la persistenza
production. Per attivarla occorre uno schema revisionato e un adapter esplicito che rispetti
il port, incluse scritture atomiche dell'intero snapshot e FK tenant-aware. Non è sufficiente
abilitare una variabile ambiente. Non sono previsti fallback filesystem o memoria.

## Oggetti

- Supply: UUID generato server, tenant, Customer esistente e POD.
- Bill: UUID server, ownership immutabile, numero documento, emissione, periodo,
  totale dichiarato, EUR, stati derivati e riconciliazione.
- BillConsumption: UUID server, Bill/tenant, periodo, TOTAL/F1/F2/F3 e kWh nullable.
- BillLine: UUID server, Bill/tenant, categoria chiusa, AGGREGATE/DETAIL, descrizione,
  periodo, quantità/unità/prezzo/importo nullable e partecipazione al totale.

POD: trim, maiuscole, rimozione whitespace; pattern V1 `IT` + 6–30 alfanumerici.
È un controllo sintattico, non una verifica distributore o autorità, e non è una PK.
Non viene ricercato globalmente per derivare tenant o ownership.

Le categorie recuperano solo famiglie V1: energia, commercializzazione, altri corrispettivi
venditore, rete/misura, oneri, accise, IVA, canone TV, saldo precedente, ricalcoli, altre partite
e non classificato. Nessun prezzo, tariffa o riferimento esterno è nel modulo.
Offerta attuale non implementata: la UI non ne inventa una sezione.

## Date, quantità e denaro

Tutti i periodi sono **inclusivi a entrambi gli estremi** `[periodStart, periodEnd]`,
date ISO reali, anni 1900–2199. Un giorno singolo è valido. Inizio successivo alla fine è rifiutato.
Emissione non impone un ordine rispetto al periodo. Le righe possono riferirsi a sottoperiodi
o periodi precedenti (ricalcoli), preservati senza estensione al periodo Bill.
I consumi devono ricadere nel periodo Bill. Non sono inventati raw metadata.

`declaredDocumentTotal`, `amount`, somme e differenze sono **centesimi interi EUR**.
Limite assoluto per importo: 100.000.000.000 centesimi; massimo 100 righe. Anche somme/differenze
restano entro interi sicuri JS. Il boundary UI euro → centesimi usa decimali testuali e BigInt,
non moltiplicazioni floating point. Frazioni inferiori al centesimo sono rifiutate.

`unitPrice` è un decimale testuale esatto EUR/unità con massimo sei decimali;
`quantity` ha massimo sei decimali, `energyKwh` tre. Massimo nove cifre intere.
I kWh sono non negativi; quantità/importi/prezzi possono essere firmati per rettifiche.
Il separatore API è il punto, non sono ammessi esponenti, NaN o Infinity.
Null è ignoto e zero è noto: non esiste conversione automatica tra i due.

Per uno stesso periodo non sono ammesse fasce duplicate. Quando TOTAL/F1/F2/F3 sono tutti
noti, la somma si verifica esattamente in millesimi di kWh (tolleranza zero). Non viene
calcolata una fascia mancante. Non si aggregano fasce di periodi differenti.

## Presenza, completezza, validazione e riconciliazione

**Presenza documento**: questo MVP conserva una trascrizione manuale, non il file originale.
La UI lo dichiara; nessuna approvazione o attestazione di acquisizione viene dedotta.

Il flag client di completezza è rimosso: anche `detailCoverage` è un campo sconosciuto
rifiutato dall’API. `documentTotalParticipation` conserva soltanto la classificazione
manuale INCLUDED/EXCLUDED/UNKNOWN; non prova la sommabilità o copertura documentale.

`reconcile()` valida gli input, rileva aggregati e sovrapposizioni inclusive fra DETAIL
inclusi e restituisce NOT_DETERMINABLE. Anche dettagli disgiunti e importi tutti noti
non dimostrano che non manchino voci del documento: il modello manuale attuale non
possiede una prova strutturale della copertura. reconstructedTotal e difference restano
null. Non si inventano relazioni, pro-rata o deduplicazioni testuali.

`compareExactCents()` è soltanto confronto aritmetico di importi noti: uguaglianza esatta
produce MATCH, qualsiasi differenza produce DIFFERENCE. Non autorizza ricostruzioni;
non è un endpoint né un input client e non viene usato per aggirare la copertura mancante.

Completezza: INCOMPLETE finché il modello non dimostra copertura sufficiente.
Validazione: UNVALIDATED, indipendentemente da qualsiasi uguaglianza aritmetica.
Non esiste nel MVP un processo di validazione documentale. MATCH/DIFFERENCE restano nel
contratto, ma non sono raggiungibili dalla trascrizione manuale attuale.
Gli input sintatticamente invalidi o con fasce incoerenti sono rifiutati.

Consumi della stessa fascia su periodi parzialmente sovrapposti sono conservati senza
sommarli o inventare TOTAL; permane il rischio di copertura energetica ambigua.
Non viene attestata completezza dei consumi. Duplicati identici fascia/periodo rifiutati.

Le categorie `currentCharges`, `tvLicense`, `previousBalance`, `otherAmounts` sono somme
del dettaglio disponibile, **non totali dichiarati**. Nessuna riga, importo ignoto,
categoria UNKNOWN, aggregato o intervalli sovrapposti nella categoria → null. Non sono sommate automaticamente.
I periodi non vengono prorati. IVA/accise sono dati trascritti, non calcolati fiscalmente.

## Accesso e mutazioni

Quattro permission Bill server-derived dai soli quattro ruoli canonici. AUTH/sessione
viene riverificata per ogni richiesta; auth:session da sola non concede autorità business.
Per PLATFORM è obbligatorio targetTenantId valido, esistente e attivo per ogni operazione.
Tenant-scoped usa solo il tenant verificato; un target diverso viene rifiutato.
Customer e Supply vengono riletti e confrontati prima di create/update Bill.

POST Bill richiede Customer/Supply come selettori da verificare. PUT accetta solo campi
documentali e righe/consumi; ownership, ID e stati client sono rifiutati.
PUT sostituisce atomicamente lo snapshot nel contratto repository; genera nuovi ID figli.
Non è un archivio delle revisioni e non applica merge concorrenti: questa limitazione
è esplicita, senza riprodurre il lifecycle V1. Nessun delete Bill/Supply né update Supply.
Le letture restituiscono lo snapshot salvato senza arricchimenti esterni.

API: schema chiuso ricorsivo, JSON massimo 128 KiB, origine esatta per mutazioni,
cookie unico, no-store/private, nessuna diagnostica provider nella risposta.
404 copre anche documenti/forniture di altri tenant senza rivelarne l'esistenza.

## Verifica

Test Bill: `node --experimental-transform-types --import ./v2/tests/register.mjs --test v2/tests/bill-*.test.mjs`.
I test usano esclusivamente fixture sintetiche dichiarate e adapter di test.
Nessun browser E2E, visual QA o accesso database remoto è incluso.
