# Cerco Casa — regole operative per ChatGPT / agenti

Questo repository è la sorgente dati del sito Cerco Casa di Bogdan e Camilla.

## Regola principale
Quando una chat trova un nuovo annuncio da inserire nel sito, il lavoro NON è concluso finché `homes.json` non è stato aggiornato con successo su GitHub e il commit non è stato verificato.

## Flusso obbligatorio per ogni nuovo annuncio
1. Leggere sempre la versione corrente di `homes.json` prima di modificare il file.
2. Verificare che l'annuncio sia ancora attivo e preferire il link diretto al singolo immobile, non una pagina categoria/ricerca.
3. Controllare duplicati almeno per:
   - `id`
   - URL normalizzato
   - stesso immobile/indirizzo anche se pubblicato su un portale diverso
4. Valutare l'immobile rispetto ai criteri del progetto e compilare tutti i campi richiesti.
5. Aggiungere l'oggetto in fondo a `homes.json` con `addedAt` in formato ISO 8601, usando la data/ora dell'inserimento nel sito.
6. Aggiornare `homes.json` su GitHub.
7. Rileggere `homes.json` dopo il commit e verificare che il nuovo `id` sia realmente presente.
8. Solo dopo la verifica comunicare all'utente che l'annuncio è stato aggiunto al sito, includendo il commit SHA quando disponibile.

## Campi richiesti per i nuovi annunci
Ogni nuovo oggetto deve contenere:

- `id`: slug univoco e stabile
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

`addedAt` deve essere una data ISO valida, ad esempio `2026-09-15T12:30:00+02:00` oppure equivalente UTC.

## Regole dati
- Non modificare o cancellare reazioni e note personali dal file: sono salvate separatamente sul NAS tramite API.
- Non riutilizzare un `id` esistente.
- Non inserire due volte lo stesso URL.
- Se lo stesso immobile è ripubblicato su un altro portale, verificare se è davvero una nuova proposta prima di creare una seconda scheda.
- Se la posizione esatta non è pubblica, usare coordinate indicative e dichiararlo in `warning`.
- Se l'annuncio è fuori budget o fuori parametri ma vale la pena tenerlo nel radar, specificarlo chiaramente in `tags`, `note` e/o `warning`.

## Verifica tecnica
Dopo una modifica a `homes.json`, eseguire o controllare `npm run validate:homes`.
Il repository contiene anche un workflow GitHub Actions che valida automaticamente il file.

## Pubblicazione
Il NAS sincronizza il repository circa ogni 60 secondi. Dopo un commit valido, il nuovo annuncio dovrebbe comparire nel sito entro circa un minuto, senza deploy manuale.
