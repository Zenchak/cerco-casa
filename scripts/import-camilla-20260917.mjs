import fs from 'node:fs';

const homesFile = new URL('../homes.json', import.meta.url);
const processedFile = new URL('../processed-suggestions.json', import.meta.url);

const homes = JSON.parse(fs.readFileSync(homesFile, 'utf8'));
const processed = JSON.parse(fs.readFileSync(processedFile, 'utf8'));

const additions = [
  {
    suggestionId: '1789589557040-0wbksz',
    home: {
      id: 'scanzorosciate-galimberti33',
      name: 'Scanzorosciate · Via A. Galimberti 33',
      lat: 45.705408,
      lng: 9.7356466,
      price: 258000,
      type: 'Casa indipendente',
      sqm: '130 m²',
      beds: 3,
      garden: true,
      garage: false,
      city: false,
      top: false,
      status: 'da-valutare',
      rating: '8/10?',
      tags: ['Segnalata da Camilla','3 camere (1 matrimoniale + 2 camerette)','1 bagno','Giardino + cortile','Ristrutturata','Arredo incluso','Annuncio attivo'],
      note: 'Casa indipendente ristrutturata e molto sotto budget. Al piano terra ci sono cucina abitabile, bagno, soggiorno e camera matrimoniale; al piano superiore due camerette, saloncino, terrazzino e locale tecnico. Interessante per indipendenza e prezzo, ma l’annuncio non indica un vero box/garage.',
      warning: 'Da verificare in visita l’abitabilità/catasto delle due camerette al piano superiore e la possibilità di parcheggio nel cortile. L’annuncio risulta con un solo bagno.',
      url: 'https://www.idealista.it/immobile/35874338/',
      addedAt: '2026-09-17T12:30:31+02:00'
    }
  },
  {
    suggestionId: '1789589689259-j4b19n',
    home: {
      id: 'bergamo-bronzetti16',
      name: 'Bergamo · Via Fratelli Bronzetti 16',
      lat: 45.70377,
      lng: 9.687426,
      price: 349000,
      type: 'Appartamento con giardino',
      sqm: '130 m²',
      beds: 2,
      garden: true,
      garage: true,
      city: true,
      top: false,
      status: 'da-valutare',
      rating: '7/10',
      tags: ['Segnalata da Camilla','2 camere','2 bagni','Giardinetto privato','Box ~30 m²','Ristrutturato','Piano rialzato','Borgo Santa Caterina'],
      note: 'Appartamento d’epoca ristrutturato in piccolo condominio di 6 unità: due camere, due bagni, grande soggiorno con camino, cucina e sala da pranzo, sauna, giardinetto esclusivo, loggiato, box e deposito. Bello e pronto, ma rispetto ai criteri familiari principali ha solo 2 camere e uno spazio esterno piccolo.',
      warning: 'Non è una soluzione indipendente. Le fonti riportano 130 m² commerciali ma il testo dell’annuncio parla di circa 122 m² abitativi; spese condominiali indicate tra 65 e 80 €/mese a seconda del portale. Classe energetica da verificare: una copia dell’annuncio riporta G 400 kWh/m² anno.',
      url: 'https://www.casa.it/immobili/53422148/',
      addedAt: '2026-09-17T12:30:31+02:00'
    }
  }
];

const existingIds = new Set(homes.map(h => h.id));
const existingUrls = new Set(homes.map(h => String(h.url || '').replace(/[?#].*$/,'').replace(/\/$/,'')));
const processedIds = new Set(processed.map(p => p.id));
let changed = false;

for (const { suggestionId, home } of additions) {
  const cleanUrl = home.url.replace(/[?#].*$/,'').replace(/\/$/,'');
  if (!existingIds.has(home.id) && !existingUrls.has(cleanUrl)) {
    homes.push(home);
    existingIds.add(home.id);
    existingUrls.add(cleanUrl);
    changed = true;
  }
  if (!processedIds.has(suggestionId)) {
    processed.push({
      id: suggestionId,
      status: 'added',
      homeId: home.id,
      url: home.url,
      processedAt: '2026-09-17T12:30:31+02:00',
      source: 'manual-enrichment-from-user-screenshot-and-indexed-listing'
    });
    processedIds.add(suggestionId);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(homesFile, JSON.stringify(homes, null, 2) + '\n');
  fs.writeFileSync(processedFile, JSON.stringify(processed, null, 2) + '\n');
  console.log('Imported Camilla suggestions.');
} else {
  console.log('Nothing to import.');
}
