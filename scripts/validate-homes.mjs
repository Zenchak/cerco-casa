import fs from 'node:fs';

const file = new URL('../homes.json', import.meta.url);
const homes = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!Array.isArray(homes)) throw new Error('homes.json deve contenere un array');

const legacyWithoutAddedAt = new Set([
  'gerosa','treviolo305','treviolo315','seriate','azzano1','azzano2','dalmine','valverde45',
  'ponteranica-monviso','pedrengo-caravaggio8','dalmine-25aprile80','bergamo-martinella19',
  'treviolo-rossini','costa-don-sturzo25','brusaporto-rossini6','brusaporto-pioppi10',
  'dalmine-bastone16','pedrengo-kennedy','villa-alme-alpini37'
]);

const required = [
  'id','name','lat','lng','price','type','sqm','beds','garden','garage','city','top',
  'status','rating','tags','note','warning','url'
];

const ids = new Map();
const urls = new Map();
const errors = [];
const warnings = [];

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
}

homes.forEach((h, i) => {
  const pos = `Elemento ${i + 1}${h?.id ? ` (${h.id})` : ''}`;
  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    errors.push(`${pos}: deve essere un oggetto`);
    return;
  }

  for (const key of required) {
    if (!(key in h)) errors.push(`${pos}: manca il campo ${key}`);
  }

  if (typeof h.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(h.id)) {
    errors.push(`${pos}: id non valido`);
  }

  if (ids.has(h.id)) errors.push(`${pos}: id duplicato con elemento ${ids.get(h.id) + 1}`);
  else ids.set(h.id, i);

  const nu = normalizeUrl(h.url);
  if (!/^https?:\/\//.test(String(h.url || ''))) errors.push(`${pos}: url non valida`);
  if (urls.has(nu)) errors.push(`${pos}: URL duplicato con elemento ${urls.get(nu) + 1}`);
  else urls.set(nu, i);

  if (!Number.isFinite(h.lat) || h.lat < -90 || h.lat > 90) errors.push(`${pos}: lat non valida`);
  if (!Number.isFinite(h.lng) || h.lng < -180 || h.lng > 180) errors.push(`${pos}: lng non valida`);
  if (!Number.isFinite(h.price) || h.price <= 0) errors.push(`${pos}: price non valido`);
  if (!Number.isInteger(h.beds) || h.beds < 0) errors.push(`${pos}: beds non valido`);
  for (const key of ['garden','garage','city','top']) {
    if (typeof h[key] !== 'boolean') errors.push(`${pos}: ${key} deve essere booleano`);
  }
  if (!Array.isArray(h.tags)) errors.push(`${pos}: tags deve essere un array`);

  if (!h.addedAt) {
    if (!legacyWithoutAddedAt.has(h.id)) errors.push(`${pos}: ogni nuovo annuncio deve avere addedAt`);
    else warnings.push(`${pos}: legacy senza addedAt`);
  } else if (!Number.isFinite(Date.parse(h.addedAt))) {
    errors.push(`${pos}: addedAt non è una data ISO valida`);
  }
});

for (const w of warnings) console.warn(`WARN: ${w}`);

if (errors.length) {
  console.error('\nValidazione homes.json FALLITA:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(`OK: ${homes.length} annunci validati. Nessun duplicato o errore bloccante.`);
