const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'suggestions.json');
const GITHUB_SYNC_FILE = path.join(DATA_DIR, 'github-synced-suggestions.json');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const GITHUB_REPO = String(process.env.GITHUB_REPO || 'Zenchak/cerco-casa').trim();
const GITHUB_BRANCH = String(process.env.GITHUB_BRANCH || 'main').trim();
const LEGACY_NOTES_URL = 'https://cerco-casa-bogdan-camilla.netlify.app/api/notes';

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
async function migrateNotesOnce() {
  if (fs.existsSync(NOTES_FILE)) return;
  try {
    const r = await fetch(LEGACY_NOTES_URL, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        writeJson(NOTES_FILE, data);
        console.log('Note migrate da Netlify al NAS.');
        return;
      }
    }
  } catch (e) {
    console.warn('Migrazione note Netlify non riuscita:', e.message);
  }
  writeJson(NOTES_FILE, {});
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}
function sendHtml(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function getBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > max) reject(new Error('Payload troppo grande'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function parseBody(req, raw) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') return JSON.parse(raw || '{}');
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  return {};
}

function saveSuggestion(payload) {
  const url = String(payload.url || '').trim().slice(0, 2000);
  const sender = String(payload['segnalata-da'] || payload.sender || 'Camilla').trim().slice(0, 40);
  const priority = String(payload.priorita || payload.priority || 'Normale').trim().slice(0, 80);
  const note = String(payload.nota || payload.note || '').trim().slice(0, 2000);
  if (!/^https?:\/\//i.test(url)) throw new Error('Link annuncio non valido');
  const items = readJson(SUGGESTIONS_FILE, []);
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, url, sender, priority, note, createdAt: new Date().toISOString() };
  items.push(item);
  writeJson(SUGGESTIONS_FILE, items);
  return item;
}

async function pushSuggestionToGitHub(item) {
  if (!GITHUB_TOKEN) return { ok: false, skipped: true, reason: 'token-missing' };
  const filePath = `incoming-suggestions/${item.id}.json`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const body = {
    message: `Queue house suggestion from ${item.sender || 'unknown'}`,
    content: Buffer.from(JSON.stringify(item, null, 2) + '\n', 'utf8').toString('base64'),
    branch: GITHUB_BRANCH
  };
  const r = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'cerco-casa-nas-bridge'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (r.status === 201 || r.status === 200 || r.status === 422) return { ok: true, status: r.status };
  let details = '';
  try { details = (await r.json()).message || ''; } catch {}
  throw new Error(`GitHub ${r.status}${details ? `: ${details}` : ''}`);
}

let flushRunning = false;
async function flushSuggestionsToGitHub() {
  if (flushRunning || !GITHUB_TOKEN) return;
  flushRunning = true;
  try {
    const items = readJson(SUGGESTIONS_FILE, []);
    const synced = new Set(readJson(GITHUB_SYNC_FILE, []));
    let changed = false;
    for (const item of items) {
      if (!item?.id || synced.has(item.id)) continue;
      try {
        await pushSuggestionToGitHub(item);
        synced.add(item.id);
        changed = true;
        console.log(`Segnalazione ${item.id} copiata su GitHub.`);
      } catch (e) {
        console.warn(`Bridge GitHub fallito per ${item.id}:`, e.message);
      }
    }
    if (changed) writeJson(GITHUB_SYNC_FILE, [...synced]);
  } finally {
    flushRunning = false;
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        githubBridgeConfigured: Boolean(GITHUB_TOKEN),
        pendingSuggestions: readJson(SUGGESTIONS_FILE, []).length,
        githubSyncedSuggestions: readJson(GITHUB_SYNC_FILE, []).length
      });
    }

    if (u.pathname === '/api/notes' && req.method === 'GET') {
      return sendJson(res, 200, readJson(NOTES_FILE, {}));
    }
    if (u.pathname === '/api/notes' && req.method === 'POST') {
      const payload = parseBody(req, await getBody(req));
      const homeId = String(payload.homeId || '').trim().slice(0, 120);
      const author = String(payload.author || '').trim().slice(0, 40);
      const text = String(payload.text || '').trim().slice(0, 1000);
      if (!homeId || !text || !['Bogdan', 'Camilla'].includes(author)) return sendJson(res, 400, { error: 'Dati nota non validi' });
      const notes = readJson(NOTES_FILE, {});
      if (!Array.isArray(notes[homeId])) notes[homeId] = [];
      notes[homeId].push({ author, text, createdAt: new Date().toISOString() });
      writeJson(NOTES_FILE, notes);
      return sendJson(res, 201, { ok: true });
    }

    if (u.pathname === '/api/suggestions' && req.method === 'GET') {
      return sendJson(res, 200, readJson(SUGGESTIONS_FILE, []));
    }
    if (u.pathname === '/api/suggestions' && req.method === 'POST') {
      const item = saveSuggestion(parseBody(req, await getBody(req)));
      flushSuggestionsToGitHub().catch(e => console.warn('Bridge GitHub:', e.message));
      return sendJson(res, 201, { ok: true, id: item.id });
    }

    if (u.pathname === '/grazie.html' && req.method === 'POST') {
      saveSuggestion(parseBody(req, await getBody(req)));
      flushSuggestionsToGitHub().catch(e => console.warn('Bridge GitHub:', e.message));
      return sendHtml(res, 200, `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Segnalazione ricevuta</title><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f7f5f1;color:#222;padding:32px"><main style="max-width:620px;margin:auto;background:#fff;border:1px solid #ded8d0;border-radius:18px;padding:24px"><h1>✅ Segnalazione ricevuta</h1><p>La casa è stata salvata sul NAS e messa in coda per l'elaborazione.</p><p><a href="/" style="color:#1f6f5f;font-weight:700">← Torna a Cerco Casa</a></p></main></body></html>`);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: e.message || 'Errore interno' });
  }
});

migrateNotesOnce().finally(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Cerco Casa API in ascolto su ${PORT}`);
    console.log(`Bridge GitHub: ${GITHUB_TOKEN ? 'configurato' : 'NON configurato'}`);
    flushSuggestionsToGitHub().catch(e => console.warn('Bridge GitHub iniziale:', e.message));
    setInterval(() => flushSuggestionsToGitHub().catch(e => console.warn('Bridge GitHub periodico:', e.message)), 60 * 1000);
  });
});
