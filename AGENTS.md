# Cerco Casa — regole operative per ChatGPT / agenti

Questo repository è la sorgente dati del sito Cerco Casa di Bogdan e Camilla.

## Regola principale
Per i NUOVI annunci non modificare direttamente il grande `homes.json`. Creare invece un piccolo file JSON autonomo nella cartella `homes/`. Il workflow GitHub Actions `Merge modular homes` rigenera automaticamente `homes.json`, che resta il file consumato dal sito/NAS.

Il lavoro NON è concluso finché il file modulare non è stato creato con successo e, quando disponibile, il workflow non ha rigenerato/validato `homes.json`.

## Flusso obbligatorio per ogni nuovo annuncio
1. Leggere `homes.json` (anche a intervalli se necessario) e i file pertinenti in `homes/` per il controllo duplicati.
2. Verificare che l'annuncio sia ancora attivo e preferire il link diretto al singolo immobile.
3. Controllare duplicati almeno per `id`, URL normalizzato e stesso immobile/indirizzo anche su portali diversi.
4. Compilare tutti i campi richiesti.
5. Creare `homes/<id>.json` come singolo oggetto JSON, con `addedAt` ISO 8601 corrente. Per un nuovo annuncio lo stato deve restare NEW/nuovo secondo lo schema usato dal sito finché non viene aperto.
6. Non riscrivere `homes.json` manualmente per aggiungere un nuovo annuncio.
7. Il workflow `.github/workflows/merge-homes.yml` esegue `scripts/merge-homes.mjs`, aggiorna `homes.json`, esegue `npm run validate:homes` e committa il file generato.
8. Verificare il file modulare appena creato; quando possibile verificare anche che il nuovo id compaia nel `homes.json` rigenerato e riportare il commit SHA.
9. Se il workflow fallisce, segnalarlo esplicitamente: il file modulare resta la sorgente del nuovo annuncio e va corretto, non va aggirato riscrivendo alla cieca `homes.json`.

## Compatibilità con gli annunci storici
Gli annunci già presenti solo in `homes.json` restano validi. Lo script di merge parte sempre dall'attuale `homes.json` e aggiunge/aggiorna gli oggetti presenti in `homes/`; quindi non serve migrare subito tutto lo storico.

## Campi richiesti
Ogni nuovo oggetto deve contenere:
- `id`
- `name`
- `lat`
- `lng`
- `price`
- `type`
- `sqm`
- `beds`
- `garden`
- `garage`
- `city`
- `top`
- `status`
- `rating`
- `tags`
- `note`
- `warning`
- `url`
- `addedAt`

## Regole dati
- Non modificare o cancellare reazioni e note personali salvate separatamente sul NAS.
- Non riutilizzare un id esistente.
- Non inserire due volte lo stesso URL.
- Se lo stesso immobile è ripubblicato su un altro portale, verificare se è davvero una nuova proposta.
- Se la posizione esatta non è pubblica, usare coordinate indicative e dichiararlo in `warning`.
- Se l'annuncio è fuori budget/parametri ma interessante, dichiararlo chiaramente.
- Le segnalazioni Bogdan/Camilla seguono anche le regole di `incoming-suggestions/` e `processed-suggestions.json`.

## Verifica tecnica
Il workflow valida automaticamente il `homes.json` generato con `npm run validate:homes`.

## Pubblicazione
Il NAS sincronizza il repository circa ogni 60 secondi. Dopo il commit del `homes.json` generato, il nuovo annuncio dovrebbe comparire sul sito entro circa un minuto.

## Verifica link annunci (obbligatoria)
- Non considerare mai un annuncio attivo solo perché compare nei risultati di Google/Bing o in una pagina categoria: gli indici possono essere obsoleti.
- Prima di aggiungere o aggiornare una casa, apri la pagina diretta dell'annuncio e verifica che non mostri messaggi come "non più pubblicato", "rimosso", "non disponibile", 404 o redirect a una pagina generica.
- Se il link diretto è morto, cerca lo stesso immobile su altri portali confrontando indirizzo, prezzo, metratura, foto/testo e riferimento annuncio. Salva solo un link diretto che risulti effettivamente utilizzabile.
- Se nessun link diretto è verificabile, non presentare la casa come annuncio attivo: marca/annota l'indisponibilità invece di sostituire il link con un risultato indicizzato non verificato.
- Per gli immobili già presenti, se viene segnalato un link rotto, verifica la pagina diretta prima di modificarlo e aggiorna il record modulare esistente; non creare un nuovo id.
