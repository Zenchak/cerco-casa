import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const incomingDir = path.join(root, 'incoming-suggestions');
const homesFile = path.join(root, 'homes.json');
const processedFile = path.join(root, 'processed-suggestions.json');
const errorsFile = path.join(root, 'processing-errors.json');

const cityCentroids = {
  'bergamo':[45.6983,9.6773], 'seriate':[45.6856,9.7249], 'treviolo':[45.6730,9.6119],
  'dalmine':[45.6490,9.6065], 'stezzano':[45.6500,9.6510], 'azzano san paolo':[45.6570,9.6740],
  'pedrengo':[45.6953,9.7349], 'brusaporto':[45.6705,9.7590], 'costa di mezzate':[45.6630,9.7940],
  'villa d’almè':[45.7485,9.6174], "villa d'alme":[45.7485,9.6174], 'villa d almè':[45.7485,9.6174],
  'ponteranica':[45.7321,9.6516], 'sorisole':[45.7314,9.6635], 'alzano lombardo':[45.7363,9.7363],
  'nembro':[45.7447,9.7601], 'scanzorosciate':[45.7108,9.7352], 'albano sant’alessandro':[45.6870,9.7663],
  "albano sant'alessandro":[45.6870,9.7663], 'bagnatica':[45.6609,9.7817], 'grassobbio':[45.6568,9.7249],
  'zanica':[45.6390,9.6859], 'levate':[45.6258,9.6240], 'gorle':[45.7028,9.7130], 'torre boldone':[45.7168,9.7070]
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|ref_)/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch { return String(raw || '').trim().replace(/\/$/, '').toLowerCase(); }
}
function slugify(s) {
  return String(s || 'annuncio').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || `annuncio-${Date.now()}`;
}
function htmlDecode(s) {
  return String(s || '').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&apos;/gi,"'").replace(/&euro;/gi,'€').replace(/&sup2;/gi,'²').replace(/&#x27;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}
function stripHtml(s) {
  return htmlDecode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).trim();
}
function meta(html, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`, 'i')
  ];
  for (const re of patterns) { const m = html.match(re); if (m) return htmlDecode(m[1]); }
  return '';
}
function extractJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(htmlDecode(m[1].trim()));
      const walk = v => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v === 'object') { out.push(v); Object.values(v).forEach(walk); }
      };
      walk(parsed);
    } catch {}
  }
  return out;
}
function firstNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const m = String(v ?? '').replace(/\./g,'').replace(',','.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function findDeep(objects, keys) {
  for (const o of objects) {
    for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
  }
  return null;
}
function cityFromText(text) {
  const lc = text.toLowerCase();
  const cities = Object.keys(cityCentroids).sort((a,b)=>b.length-a.length);
  return cities.find(c => lc.includes(c)) || '';
}
function prettifyCity(c) {
  return c.split(' ').map(w => w ? w[0].toUpperCase()+w.slice(1) : w).join(' ').replace("D'Alme","d’Almè").replace('D Alme','d’Almè');
}
function deriveType(text) {
  const lc = text.toLowerCase();
  if (/villa\s+singola|villa\s+indipendente|casa\s+indipendente/.test(lc)) return 'Villa singola';
  if (/bifamiliare|porzione\s+di\s+villa/.test(lc)) return 'Bifamiliare';
  if (/villa\s+di\s+testa|villetta\s+di\s+testa|schiera\s+di\s+testa/.test(lc)) return 'Villa di testa';
  if (/villetta\s+a\s+schiera|villa\s+a\s+schiera|schiera/.test(lc)) return 'Villetta a schiera';
  if (/terracielo|terra\s*cielo|terratetto/.test(lc)) return 'Terratetto / terracielo';
  if (/villa/.test(lc)) return 'Villa';
  return 'Casa / villa';
}
function parsePage(html, sourceUrl, suggestion) {
  const jsonld = extractJsonLd(html);
  const text = stripHtml(html);
  const title = meta(html,'og:title') || meta(html,'twitter:title') || htmlDecode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1] || '');
  const description = meta(html,'og:description') || meta(html,'description') || '';
  const corpus = `${title} ${description} ${text}`.replace(/\s+/g,' ');

  let price = firstNumber(findDeep(jsonld,['price','lowPrice','highPrice']));
  if (!price) {
    const m = corpus.match(/(?:€|EUR)\s*([0-9][0-9.\s]{3,})|([0-9][0-9.\s]{3,})\s*(?:€|euro)/i);
    price = firstNumber(m?.[1] || m?.[2]);
  }
  if (price && price < 10000) price = null;

  let sqm = firstNumber(findDeep(jsonld,['floorSize','area','size']));
  if (!sqm) {
    const m = corpus.match(/(\d{2,4})\s*(?:m²|mq\b|m2\b)/i);
    sqm = firstNumber(m?.[1]);
  }

  let beds = firstNumber(findDeep(jsonld,['numberOfBedrooms','numberOfRooms','rooms']));
  if (beds != null) beds = Math.max(0, Math.min(20, Math.round(beds)));
  if (beds == null) {
    const m = corpus.match(/(\d{1,2})\s*(?:camere|camera\s+da\s+letto|bedrooms?)/i);
    beds = m ? Number(m[1]) : 0;
  }

  let cityRaw = '';
  for (const o of jsonld) {
    const a = o?.address;
    if (a && typeof a === 'object' && a.addressLocality) { cityRaw = String(a.addressLocality); break; }
  }
  if (!cityRaw) cityRaw = cityFromText(corpus);
  const cityKey = cityRaw.toLowerCase().trim();
  const city = prettifyCity(cityRaw || 'Zona Bergamo');

  let lat = firstNumber(findDeep(jsonld,['latitude','lat']));
  let lng = firstNumber(findDeep(jsonld,['longitude','lng','lon']));
  let approximate = false;
  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    const pair = cityCentroids[cityKey] || cityCentroids[cityFromText(corpus)];
    if (pair) { [lat,lng] = pair; approximate = true; }
  }

  let street = '';
  for (const o of jsonld) {
    const a = o?.address;
    if (a && typeof a === 'object' && a.streetAddress) { street = String(a.streetAddress); break; }
  }
  if (!street) {
    const m = corpus.match(/\b(?:via|viale|piazza|vicolo|corso|località|loc\.)\s+[A-ZÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’ .-]{2,60}/);
    if (m) street = m[0].replace(/\s+(?:in vendita|vendita|€|\d{2,4}\s*m)/i,'').trim();
  }

  const type = deriveType(corpus);
  const garden = /\bgiardino\b|area\s+verde|verde\s+privato/i.test(corpus);
  const garage = /\bgarage\b|\bbox\b|autorimessa|posto\s+auto/i.test(corpus);
  const source = new URL(sourceUrl).hostname.replace(/^www\./,'');
  const tags = [`Segnalata da ${suggestion.sender || 'voi'}`, source];
  if (beds) tags.push(`${beds} camere`);
  if (garden) tags.push('Giardino');
  if (garage) tags.push('Garage / box');
  if (sqm) tags.push(`${sqm} m² circa`);
  if (price && price > 360000) tags.push('Fuori budget');

  const warnings = [];
  if (approximate) warnings.push('Posizione indicativa a livello comunale: coordinate esatte non ricavate automaticamente.');
  if (!street) warnings.push('Indirizzo/civico non ricavati automaticamente.');
  if (!beds) warnings.push('Numero camere da verificare.');

  return {
    title, description, corpus, price, sqm, beds, city, cityKey, lat, lng, street, type, garden, garage, tags,
    warning: warnings.join(' '), source
  };
}
async function fetchListing(url) {
  const r = await fetch(url, {
    redirect:'follow',
    headers:{
      'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
      'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language':'it-IT,it;q=0.9,en;q=0.7'
    },
    signal: AbortSignal.timeout(20000)
  });
  const html = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (html.length < 500) throw new Error('pagina troppo corta/non leggibile');
  return { html, finalUrl:r.url };
}

const homes = readJson(homesFile, []);
const processed = readJson(processedFile, []);
const errors = readJson(errorsFile, []);
const done = new Set(processed.map(x=>x?.id).filter(Boolean));
const normalizedHomeUrls = new Map(homes.map(h=>[normalizeUrl(h.url),h.id]));
const ids = new Set(homes.map(h=>h.id));

if (!fs.existsSync(incomingDir)) process.exit(0);
const files = fs.readdirSync(incomingDir).filter(f=>f.endsWith('.json')).sort();
let changedHomes = false, changedProcessed = false, changedErrors = false;

for (const file of files) {
  const suggestion = readJson(path.join(incomingDir,file), null);
  if (!suggestion?.id || !suggestion?.url || done.has(suggestion.id)) continue;
  const nurl = normalizeUrl(suggestion.url);
  if (normalizedHomeUrls.has(nurl)) {
    processed.push({id:suggestion.id,status:'duplicate',homeId:normalizedHomeUrls.get(nurl),url:suggestion.url,processedAt:new Date().toISOString(),reason:'URL già presente in homes.json'});
    done.add(suggestion.id); changedProcessed = true; continue;
  }
  try {
    const {html, finalUrl} = await fetchListing(suggestion.url);
    const p = parsePage(html, finalUrl, suggestion);
    if (!p.price) throw new Error('prezzo non ricavato');
    if (!(Number.isFinite(p.lat) && Number.isFinite(p.lng))) throw new Error('località/coordinate non ricavate');

    const base = slugify(`${p.city}-${p.street || p.type}-${suggestion.id.slice(-6)}`);
    let id = base, i = 2; while (ids.has(id)) id = `${base}-${i++}`;
    const displayName = `${p.city} · ${p.street || p.type}`;
    const home = {
      id,
      name: displayName,
      lat:p.lat,
      lng:p.lng,
      price:p.price,
      type:p.type,
      sqm:p.sqm ? `${p.sqm} m² circa` : 'Da verificare',
      beds:p.beds,
      garden:p.garden,
      garage:p.garage,
      city:p.city.toLowerCase()==='bergamo',
      top:false,
      status:'da-valutare',
      rating:'Da valutare',
      tags:p.tags,
      note:`Segnalata da ${suggestion.sender || 'voi'}${suggestion.note ? ` · ${suggestion.note}` : ''}. Dati principali estratti automaticamente dall’annuncio; da rifinire se necessario.`,
      warning:p.warning,
      url:suggestion.url,
      addedAt:new Date().toISOString()
    };
    homes.push(home);
    ids.add(id);
    normalizedHomeUrls.set(nurl,id);
    processed.push({id:suggestion.id,status:'added',homeId:id,url:suggestion.url,processedAt:new Date().toISOString(),source:p.source});
    done.add(suggestion.id);
    changedHomes = changedProcessed = true;
    console.log(`ADDED ${id} <- ${suggestion.url}`);
  } catch (e) {
    const idx = errors.findIndex(x=>x?.id===suggestion.id);
    const entry = {id:suggestion.id,url:suggestion.url,sender:suggestion.sender,error:String(e?.message||e),lastAttemptAt:new Date().toISOString()};
    if (idx >= 0) errors[idx] = {...errors[idx],...entry}; else errors.push(entry);
    changedErrors = true;
    console.warn(`PENDING ${suggestion.id}: ${entry.error}`);
  }
}

if (changedHomes) writeJson(homesFile, homes);
if (changedProcessed) writeJson(processedFile, processed);
if (changedErrors) writeJson(errorsFile, errors);
console.log(`Done. homes+${changedHomes?'changed':'same'} processed+${changedProcessed?'changed':'same'} errors+${changedErrors?'changed':'same'}`);
