const fs = require('fs');
const path = require('path');

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

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|ref_)/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch { return String(raw || '').trim().replace(/\/$/, '').toLowerCase(); }
}
function slugify(s) {
  return String(s || 'annuncio').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,72) || `annuncio-${Date.now()}`;
}
function htmlDecode(s) {
  return String(s || '').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&apos;/gi,"'").replace(/&euro;/gi,'€').replace(/&sup2;/gi,'²').replace(/&#x27;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}
function stripHtml(s) {
  return htmlDecode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).trim();
}
function meta(html, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`, 'i');
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`, 'i');
  return htmlDecode((html.match(a)||html.match(b)||[])[1] || '');
}
function extractJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(htmlDecode(m[1].trim()));
      const walk = v => { if (!v) return; if (Array.isArray(v)) return v.forEach(walk); if (typeof v === 'object') { out.push(v); Object.values(v).forEach(walk); } };
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
function deep(objects, keys) {
  for (const o of objects) for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k];
  return null;
}
function cityFromText(text) {
  const lc = text.toLowerCase();
  return Object.keys(cityCentroids).sort((a,b)=>b.length-a.length).find(c=>lc.includes(c)) || '';
}
function prettyCity(c) {
  return String(c || '').split(' ').map(w=>w ? w[0].toUpperCase()+w.slice(1) : w).join(' ').replace("D'Alme",'d’Almè').replace('D Alme','d’Almè');
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
function parseListing(html, url, suggestion) {
  const jsonld = extractJsonLd(html);
  const text = stripHtml(html);
  const title = meta(html,'og:title') || meta(html,'twitter:title') || htmlDecode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1] || '');
  const description = meta(html,'og:description') || meta(html,'description') || '';
  const corpus = `${title} ${description} ${text}`.replace(/\s+/g,' ');

  let price = firstNumber(deep(jsonld,['price','lowPrice','highPrice']));
  if (!price) {
    const m = corpus.match(/(?:€|EUR)\s*([0-9][0-9.\s]{3,})|([0-9][0-9.\s]{3,})\s*(?:€|euro)/i);
    price = firstNumber(m?.[1] || m?.[2]);
  }
  if (price && price < 10000) price = null;

  let sqm = firstNumber(deep(jsonld,['floorSize','area','size']));
  if (!sqm) sqm = firstNumber((corpus.match(/(\d{2,4})\s*(?:m²|mq\b|m2\b)/i)||[])[1]);

  let beds = firstNumber(deep(jsonld,['numberOfBedrooms','numberOfRooms','rooms']));
  if (beds != null) beds = Math.max(0, Math.min(20, Math.round(beds)));
  if (beds == null) beds = Number((corpus.match(/(\d{1,2})\s*(?:camere|camera\s+da\s+letto|bedrooms?)/i)||[])[1] || 0);

  let cityRaw = '';
  for (const o of jsonld) { const a = o?.address; if (a && typeof a === 'object' && a.addressLocality) { cityRaw = String(a.addressLocality); break; } }
  if (!cityRaw) cityRaw = cityFromText(corpus);
  const cityKey = cityRaw.toLowerCase().trim();
  const city = prettyCity(cityRaw || 'Zona Bergamo');

  let lat = firstNumber(deep(jsonld,['latitude','lat']));
  let lng = firstNumber(deep(jsonld,['longitude','lng','lon']));
  let approximate = false;
  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    const pair = cityCentroids[cityKey] || cityCentroids[cityFromText(corpus)];
    if (pair) { [lat,lng] = pair; approximate = true; }
  }

  let street = '';
  for (const o of jsonld) { const a = o?.address; if (a && typeof a === 'object' && a.streetAddress) { street = String(a.streetAddress); break; } }
  if (!street) {
    const m = corpus.match(/\b(?:via|viale|piazza|vicolo|corso|località|loc\.)\s+[A-ZÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’ .-]{2,60}/);
    if (m) street = m[0].replace(/\s+(?:in vendita|vendita|€|\d{2,4}\s*m)/i,'').trim();
  }

  const type = deriveType(corpus);
  const garden = /\bgiardino\b|area\s+verde|verde\s+privato/i.test(corpus);
  const garage = /\bgarage\b|\bbox\b|autorimessa|posto\s+auto/i.test(corpus);
  const source = new URL(url).hostname.replace(/^www\./,'');
  const tags = [`Segnalata da ${suggestion.sender || 'voi'}`, source];
  if (beds) tags.push(`${beds} camere`);
  if (garden) tags.push('Giardino');
  if (garage) tags.push('Garage / box');
  if (sqm) tags.push(`${sqm} m² circa`);
  if (price && price > 360000) tags.push('Fuori budget');

  const warnings = [];
  if (approximate) warnings.push('Posizione indicativa a livello comunale.');
  if (!street) warnings.push('Indirizzo/civico da verificare.');
  if (!beds) warnings.push('Numero camere da verificare.');

  return { price,sqm,beds,city,lat,lng,street,type,garden,garage,tags,source,warning:warnings.join(' ') };
}

function headers(token) {
  return { Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'cerco-casa-nas-processor' };
}
async function githubGet(repo, branch, token, file) {
  const u = `https://api.github.com/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(u,{headers:headers(token),signal:AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error(`GitHub GET ${file}: ${r.status}`);
  const j = await r.json();
  return { sha:j.sha, value:JSON.parse(Buffer.from(j.content,'base64').toString('utf8')) };
}
async function githubPut(repo, branch, token, file, value, sha, message) {
  const u = `https://api.github.com/repos/${repo}/contents/${file}`;
  const r = await fetch(u,{method:'PUT',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({message,content:Buffer.from(JSON.stringify(value,null,2)+'\n').toString('base64'),sha,branch}),signal:AbortSignal.timeout(15000)});
  if (!r.ok) { let d=''; try{d=(await r.json()).message||'';}catch{} throw new Error(`GitHub PUT ${file}: ${r.status}${d?` ${d}`:''}`); }
  return r.json();
}
async function fetchListing(url) {
  const r = await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'it-IT,it;q=0.9'},signal:AbortSignal.timeout(20000)});
  const html = await r.text();
  if (!r.ok) throw new Error(`annuncio HTTP ${r.status}`);
  if (html.length < 500) throw new Error('pagina annuncio non leggibile');
  return {html,url:r.url};
}

let running = false;
async function processPendingSuggestions({dataDir='/data',token,repo='Zenchak/cerco-casa',branch='main'}={}) {
  if (running || !token) return {ok:false,skipped:true};
  running = true;
  try {
    const suggestionsFile = path.join(dataDir,'suggestions.json');
    const errorsFile = path.join(dataDir,'suggestion-processing-errors.json');
    const suggestions = (()=>{try{return JSON.parse(fs.readFileSync(suggestionsFile,'utf8'));}catch{return[];}})();
    if (!suggestions.length) return {ok:true,processed:0};

    let count = 0;
    for (const suggestion of suggestions) {
      if (!suggestion?.id || !suggestion?.url) continue;
      const homesDoc = await githubGet(repo,branch,token,'homes.json');
      const processedDoc = await githubGet(repo,branch,token,'processed-suggestions.json');
      const processed = Array.isArray(processedDoc.value) ? processedDoc.value : [];
      if (processed.some(x=>x?.id===suggestion.id)) continue;
      const homes = Array.isArray(homesDoc.value) ? homesDoc.value : [];
      const nurl = normalizeUrl(suggestion.url);
      const dup = homes.find(h=>normalizeUrl(h.url)===nurl);
      if (dup) {
        processed.push({id:suggestion.id,status:'duplicate',homeId:dup.id,url:suggestion.url,processedAt:new Date().toISOString(),reason:'URL già presente'});
        await githubPut(repo,branch,token,'processed-suggestions.json',processed,processedDoc.sha,`Mark suggestion ${suggestion.id} duplicate`);
        count++; continue;
      }

      try {
        const page = await fetchListing(suggestion.url);
        const p = parseListing(page.html,page.url,suggestion);
        if (!p.price) throw new Error('prezzo non ricavato automaticamente');
        if (!(Number.isFinite(p.lat)&&Number.isFinite(p.lng))) throw new Error('località/coordinate non ricavate automaticamente');
        const base = slugify(`${p.city}-${p.street||p.type}-${suggestion.id.slice(-6)}`);
        let id=base, n=2; while(homes.some(h=>h.id===id)) id=`${base}-${n++}`;
        homes.push({
          id,name:`${p.city} · ${p.street||p.type}`,lat:p.lat,lng:p.lng,price:p.price,type:p.type,
          sqm:p.sqm?`${p.sqm} m² circa`:'Da verificare',beds:p.beds,garden:p.garden,garage:p.garage,
          city:p.city.toLowerCase()==='bergamo',top:false,status:'da-valutare',rating:'Da valutare',tags:p.tags,
          note:`Segnalata da ${suggestion.sender||'voi'}${suggestion.note?` · ${suggestion.note}`:''}. Dati estratti automaticamente dall’annuncio; da rifinire se necessario.`,
          warning:p.warning,url:suggestion.url,addedAt:new Date().toISOString()
        });
        const homeWrite = await githubPut(repo,branch,token,'homes.json',homes,homesDoc.sha,`Add house suggestion from ${suggestion.sender||'user'}`);
        const freshProcessed = await githubGet(repo,branch,token,'processed-suggestions.json');
        const ledger = Array.isArray(freshProcessed.value)?freshProcessed.value:[];
        if (!ledger.some(x=>x?.id===suggestion.id)) ledger.push({id:suggestion.id,status:'added',homeId:id,url:suggestion.url,processedAt:new Date().toISOString(),commitSha:homeWrite?.commit?.sha||null});
        await githubPut(repo,branch,token,'processed-suggestions.json',ledger,freshProcessed.sha,`Mark suggestion ${suggestion.id} processed`);
        count++;
        console.log(`Annuncio ${suggestion.id} elaborato e aggiunto come ${id}.`);
      } catch (e) {
        const errors = (()=>{try{return JSON.parse(fs.readFileSync(errorsFile,'utf8'));}catch{return[];}})();
        const entry={id:suggestion.id,url:suggestion.url,error:String(e.message||e),lastAttemptAt:new Date().toISOString()};
        const idx=errors.findIndex(x=>x?.id===suggestion.id); if(idx>=0)errors[idx]=entry;else errors.push(entry);
        fs.writeFileSync(errorsFile,JSON.stringify(errors,null,2));
        console.warn(`Elaborazione ${suggestion.id} rimandata: ${entry.error}`);
      }
    }
    return {ok:true,processed:count};
  } finally { running=false; }
}

module.exports = { processPendingSuggestions };
