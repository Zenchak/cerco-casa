const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { processPendingSuggestions } = require('./suggestion-processor');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'suggestions.json');
const GITHUB_SYNC_FILE = path.join(DATA_DIR, 'github-synced-suggestions.json');
function loadGithubToken() {
  const fromEnv = String(process.env.GITHUB_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try { return fs.readFileSync(path.join(DATA_DIR, 'github_token'), 'utf8').trim(); } catch { return ''; }
}
const GITHUB_TOKEN = loadGithubToken();
const GITHUB_REPO = String(process.env.GITHUB_REPO || 'Zenchak/cerco-casa').trim();
const GITHUB_BRANCH = String(process.env.GITHUB_BRANCH || 'main').trim();
const LEGACY_NOTES_URL = 'https://cerco-casa-bogdan-camilla.netlify.app/api/notes';
const WATCH_FILES = [__filename, path.join(__dirname, 'suggestion-processor.js')];
const START_MTIMES = new Map(WATCH_FILES.map(f => [f, (() => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } })()]));

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


const PASSKEYS_FILE = path.join(DATA_DIR, 'hub-passkeys.json');
const SESSION_SECRET_FILE = path.join(DATA_DIR, 'hub-session-secret');
const SESSION_COOKIE = 'zenchack_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const pendingWebAuthn = new Map();

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64url(s) {
  const v = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(v + '='.repeat((4 - (v.length % 4)) % 4), 'base64');
}
function timingSafeText(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function sessionSecret() {
  try {
    const v = fs.readFileSync(SESSION_SECRET_FILE);
    if (v.length >= 32) return v;
  } catch {}
  const v = crypto.randomBytes(32);
  fs.writeFileSync(SESSION_SECRET_FILE, v, { mode: 0o600 });
  try { fs.chmodSync(SESSION_SECRET_FILE, 0o600); } catch {}
  return v;
}
const HUB_SESSION_SECRET = sessionSecret();

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}
function signSession(user) {
  const payload = b64url(Buffer.from(JSON.stringify({
    user,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    nonce: b64url(crypto.randomBytes(12))
  })));
  const sig = b64url(crypto.createHmac('sha256', HUB_SESSION_SECRET).update(payload).digest());
  return payload + '.' + sig;
}
function verifySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE] || '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', HUB_SESSION_SECRET).update(payload).digest());
  if (!timingSafeText(sig, expected)) return null;
  try {
    const data = JSON.parse(unb64url(payload).toString('utf8'));
    if (!data?.user || !data?.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (!['Bogdan', 'Camilla'].includes(data.user)) return null;
    return data;
  } catch {
    return null;
  }
}
function sessionCookie(user) {
  return `${SESSION_COOKIE}=${encodeURIComponent(signSession(user))}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
function normalizeHubUser(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (u === 'bogdan') return 'Bogdan';
  if (u === 'camilla') return 'Camilla';
  return '';
}
function rpContext(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const rpId = host.replace(/:\d+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  return { rpId, origin: `${proto}://${host}` };
}
function sha256(v) {
  return crypto.createHash('sha256').update(v).digest();
}
function cleanPending() {
  const now = Date.now();
  for (const [k, v] of pendingWebAuthn) if (!v || v.expiresAt < now) pendingWebAuthn.delete(k);
}
function newPending(kind, challenge, extra = {}) {
  cleanPending();
  const operationId = b64url(crypto.randomBytes(18));
  pendingWebAuthn.set(operationId, { kind, challenge, expiresAt: Date.now() + 5 * 60 * 1000, ...extra });
  return operationId;
}
function takePending(operationId, kind) {
  cleanPending();
  const p = pendingWebAuthn.get(String(operationId || ''));
  if (!p || p.kind !== kind) return null;
  pendingWebAuthn.delete(String(operationId || ''));
  return p;
}

function cborDecode(buf, start = 0) {
  let offset = start;
  function len(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return buf[offset++];
    if (ai === 25) { const v = buf.readUInt16BE(offset); offset += 2; return v; }
    if (ai === 26) { const v = buf.readUInt32BE(offset); offset += 4; return v; }
    if (ai === 27) {
      const v = Number(buf.readBigUInt64BE(offset)); offset += 8;
      if (!Number.isSafeInteger(v)) throw new Error('CBOR integer troppo grande');
      return v;
    }
    throw new Error('CBOR length non supportata');
  }
  function read() {
    if (offset >= buf.length) throw new Error('CBOR troncato');
    const first = buf[offset++];
    const major = first >> 5;
    const ai = first & 31;
    if (major === 0) return len(ai);
    if (major === 1) return -1 - len(ai);
    if (major === 2) { const n = len(ai); const v = buf.subarray(offset, offset + n); offset += n; return v; }
    if (major === 3) { const n = len(ai); const v = buf.subarray(offset, offset + n).toString('utf8'); offset += n; return v; }
    if (major === 4) { const n = len(ai); const a = []; for (let i = 0; i < n; i++) a.push(read()); return a; }
    if (major === 5) { const n = len(ai); const m = new Map(); for (let i = 0; i < n; i++) m.set(read(), read()); return m; }
    if (major === 6) { len(ai); return read(); }
    if (major === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22) return null;
      if (ai === 23) return undefined;
      throw new Error('CBOR simple value non supportato');
    }
    throw new Error('CBOR major type non supportato');
  }
  const value = read();
  return { value, offset };
}
function coseToPublicKey(cose) {
  if (!(cose instanceof Map)) throw new Error('Chiave COSE non valida');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    const crv = cose.get(-1), x = cose.get(-2), y = cose.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error('Chiave ES256 non valida');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) }, format: 'jwk' });
    return { alg, pem: key.export({ type: 'spki', format: 'pem' }).toString() };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1), e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error('Chiave RSA non valida');
    const key = crypto.createPublicKey({ key: { kty: 'RSA', n: b64url(n), e: b64url(e) }, format: 'jwk' });
    return { alg, pem: key.export({ type: 'spki', format: 'pem' }).toString() };
  }
  throw new Error(`Algoritmo passkey non supportato: kty=${kty}, alg=${alg}`);
}
function parseRegistrationAuthData(authData) {
  if (!Buffer.isBuffer(authData) || authData.length < 55) throw new Error('Authenticator data non valida');
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);
  if (!(flags & 0x01) || !(flags & 0x04) || !(flags & 0x40)) throw new Error('Passkey senza presenza/verifica utente');
  let offset = 37 + 16;
  const credLen = authData.readUInt16BE(offset); offset += 2;
  const credentialId = authData.subarray(offset, offset + credLen); offset += credLen;
  const decoded = cborDecode(authData, offset);
  return { rpIdHash, flags, signCount, credentialId, cose: decoded.value };
}
function parseAssertionAuthData(authData) {
  if (!Buffer.isBuffer(authData) || authData.length < 37) throw new Error('Authenticator data non valida');
  return {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32],
    signCount: authData.readUInt32BE(33)
  };
}
function readPasskeys() {
  const data = readJson(PASSKEYS_FILE, { credentials: [] });
  if (!data || !Array.isArray(data.credentials)) return { credentials: [] };
  return data;
}
function writePasskeys(data) {
  writeJson(PASSKEYS_FILE, data);
  try { fs.chmodSync(PASSKEYS_FILE, 0o600); } catch {}
}
function userHandle(user) {
  return sha256(Buffer.from('zenchack-passkey:' + user, 'utf8')).subarray(0, 32);
}
function checkClientData(encoded, expectedType, expectedChallenge, expectedOrigin) {
  const raw = unb64url(encoded);
  const data = JSON.parse(raw.toString('utf8'));
  if (data.type !== expectedType) throw new Error('Tipo WebAuthn non valido');
  if (!timingSafeText(data.challenge, expectedChallenge)) throw new Error('Challenge WebAuthn non valida');
  if (data.origin !== expectedOrigin) throw new Error('Origin WebAuthn non valida');
  return { raw, data };
}
function setNoStore(res) {
  res.setHeader('cache-control', 'no-store');
}

async function handleHubAuth(req, res, u) {
  if (!u.pathname.startsWith('/auth/')) return false;

  if (u.pathname === '/auth/check' && req.method === 'GET') {
    const session = verifySession(req);
    if (!session) { res.writeHead(401, { 'cache-control': 'no-store' }); res.end(); return true; }
    res.writeHead(204, { 'cache-control': 'no-store', 'x-auth-user': session.user });
    res.end();
    return true;
  }

  if (u.pathname === '/auth/me' && req.method === 'GET') {
    const session = verifySession(req);
    if (!session) { sendJson(res, 401, { authenticated: false }); return true; }
    const creds = readPasskeys().credentials.filter(c => c.user === session.user);
    sendJson(res, 200, { authenticated: true, user: session.user, passkeys: creds.length });
    return true;
  }

  if (u.pathname === '/auth/bootstrap' && (req.method === 'POST' || req.method === 'GET')) {
    const trusted = String(req.headers['x-auth-fallback'] || '') === '1';
    const user = normalizeHubUser(req.headers['x-auth-user']);
    if (!trusted || !user) { sendJson(res, 403, { error: 'Bootstrap non autorizzato' }); return true; }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': sessionCookie(user)
    });
    res.end(JSON.stringify({ ok: true, user }));
    return true;
  }

  if (u.pathname === '/auth/fallback' && req.method === 'GET') {
    const trusted = String(req.headers['x-auth-fallback'] || '') === '1';
    const user = normalizeHubUser(req.headers['x-auth-user']);
    if (!trusted || !user) { sendJson(res, 403, { error: 'Fallback non autorizzato' }); return true; }
    res.writeHead(302, {
      'set-cookie': sessionCookie(user),
      'cache-control': 'no-store',
      'location': '/'
    });
    res.end();
    return true;
  }

  if (u.pathname === '/auth/logout' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(302, { 'set-cookie': clearSessionCookie(), 'cache-control': 'no-store', 'location': '/login/' });
    res.end();
    return true;
  }

  if (u.pathname === '/auth/register/options' && req.method === 'POST') {
    const session = verifySession(req);
    if (!session) { sendJson(res, 401, { error: 'Login richiesto' }); return true; }
    const { rpId } = rpContext(req);
    if (!rpId) { sendJson(res, 400, { error: 'Host non valido' }); return true; }
    const challenge = b64url(crypto.randomBytes(32));
    const operationId = newPending('register', challenge, { user: session.user, rpId });
    const creds = readPasskeys().credentials.filter(c => c.user === session.user);
    sendJson(res, 200, {
      operationId,
      publicKey: {
        challenge,
        rp: { name: 'Zenchack Hub', id: rpId },
        user: { id: b64url(userHandle(session.user)), name: session.user.toLowerCase(), displayName: session.user },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: creds.map(c => ({ type: 'public-key', id: c.id, transports: c.transports || ['internal', 'hybrid'] }))
      }
    });
    return true;
  }

  if (u.pathname === '/auth/register/verify' && req.method === 'POST') {
    const session = verifySession(req);
    if (!session) { sendJson(res, 401, { error: 'Login richiesto' }); return true; }
    const payload = parseBody(req, await getBody(req));
    const pending = takePending(payload.operationId, 'register');
    if (!pending || pending.user !== session.user) { sendJson(res, 400, { error: 'Registrazione scaduta: riprova' }); return true; }
    const ctx = rpContext(req);
    if (ctx.rpId !== pending.rpId) { sendJson(res, 400, { error: 'RP ID non coerente' }); return true; }
    const cred = payload.credential || {};
    const response = cred.response || {};
    const client = checkClientData(response.clientDataJSON, 'webauthn.create', pending.challenge, ctx.origin);
    const attObj = cborDecode(unb64url(response.attestationObject)).value;
    if (!(attObj instanceof Map)) throw new Error('Attestation object non valido');
    const authData = attObj.get('authData');
    const parsed = parseRegistrationAuthData(authData);
    if (!crypto.timingSafeEqual(parsed.rpIdHash, sha256(Buffer.from(ctx.rpId, 'utf8')))) throw new Error('RP ID hash non valido');
    const rawId = unb64url(cred.rawId || cred.id);
    if (!rawId.length || !crypto.timingSafeEqual(rawId, parsed.credentialId)) throw new Error('Credential ID non coerente');
    const publicKey = coseToPublicKey(parsed.cose);
    const data = readPasskeys();
    const id = b64url(parsed.credentialId);
    const existing = data.credentials.find(c => c.id === id);
    if (existing && existing.user !== session.user) throw new Error('Passkey già associata a un altro utente');
    const record = {
      id,
      user: session.user,
      userHandle: b64url(userHandle(session.user)),
      publicKeyPem: publicKey.pem,
      alg: publicKey.alg,
      signCount: parsed.signCount,
      transports: Array.isArray(response.transports) ? response.transports.slice(0, 8) : ['internal'],
      createdAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, record); else data.credentials.push(record);
    writePasskeys(data);
    sendJson(res, 201, { ok: true, user: session.user, passkeys: data.credentials.filter(c => c.user === session.user).length });
    return true;
  }

  if (u.pathname === '/auth/login/options' && req.method === 'POST') {
    const { rpId } = rpContext(req);
    if (!rpId) { sendJson(res, 400, { error: 'Host non valido' }); return true; }
    const credentials = readPasskeys().credentials;
    if (!credentials.length) { sendJson(res, 409, { error: 'Nessuna passkey registrata', needsSetup: true }); return true; }
    const challenge = b64url(crypto.randomBytes(32));
    const operationId = newPending('login', challenge, { rpId });
    sendJson(res, 200, {
      operationId,
      publicKey: {
        challenge,
        rpId,
        timeout: 60000,
        userVerification: 'required'
      }
    });
    return true;
  }

  if (u.pathname === '/auth/login/verify' && req.method === 'POST') {
    const payload = parseBody(req, await getBody(req));
    const pending = takePending(payload.operationId, 'login');
    if (!pending) { sendJson(res, 400, { error: 'Login scaduto: riprova' }); return true; }
    const ctx = rpContext(req);
    if (ctx.rpId !== pending.rpId) { sendJson(res, 400, { error: 'RP ID non coerente' }); return true; }
    const cred = payload.credential || {};
    const response = cred.response || {};
    const data = readPasskeys();
    const id = b64url(unb64url(cred.rawId || cred.id));
    const record = data.credentials.find(c => c.id === id);
    if (!record) { sendJson(res, 401, { error: 'Passkey sconosciuta' }); return true; }
    const client = checkClientData(response.clientDataJSON, 'webauthn.get', pending.challenge, ctx.origin);
    const authData = unb64url(response.authenticatorData);
    const parsed = parseAssertionAuthData(authData);
    if (!(parsed.flags & 0x01) || !(parsed.flags & 0x04)) throw new Error('Face ID / verifica utente non confermata');
    if (!crypto.timingSafeEqual(parsed.rpIdHash, sha256(Buffer.from(ctx.rpId, 'utf8')))) throw new Error('RP ID hash non valido');
    if (response.userHandle) {
      const handle = b64url(unb64url(response.userHandle));
      if (!timingSafeText(handle, record.userHandle)) throw new Error('User handle non valido');
    }
    const signed = Buffer.concat([authData, sha256(client.raw)]);
    const ok = crypto.verify('sha256', signed, crypto.createPublicKey(record.publicKeyPem), unb64url(response.signature));
    if (!ok) { sendJson(res, 401, { error: 'Firma passkey non valida' }); return true; }
    if (record.signCount > 0 && parsed.signCount > 0 && parsed.signCount <= record.signCount) {
      sendJson(res, 401, { error: 'Contatore passkey non valido' }); return true;
    }
    record.signCount = Math.max(record.signCount || 0, parsed.signCount || 0);
    record.lastUsedAt = new Date().toISOString();
    writePasskeys(data);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': sessionCookie(record.user)
    });
    res.end(JSON.stringify({ ok: true, user: record.user }));
    return true;
  }

  sendJson(res, 404, { error: 'Auth endpoint non trovato' });
  return true;
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

function processHouseQueue() {
  return processPendingSuggestions({ dataDir: DATA_DIR, token: GITHUB_TOKEN, repo: GITHUB_REPO, branch: GITHUB_BRANCH });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (await handleHubAuth(req, res, u)) return;

    if (u.pathname === '/health') {
      const processingErrors = readJson(path.join(DATA_DIR, 'suggestion-processing-errors.json'), []);
      return sendJson(res, 200, {
        ok: true,
        githubBridgeConfigured: Boolean(GITHUB_TOKEN),
        pendingSuggestions: readJson(SUGGESTIONS_FILE, []).length,
        githubSyncedSuggestions: readJson(GITHUB_SYNC_FILE, []).length,
        suggestionProcessingErrors: Array.isArray(processingErrors) ? processingErrors.length : 0
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
      processHouseQueue().catch(e => console.warn('Elaborazione annuncio:', e.message));
      return sendJson(res, 201, { ok: true, id: item.id });
    }

    if (u.pathname === '/grazie.html' && req.method === 'POST') {
      saveSuggestion(parseBody(req, await getBody(req)));
      flushSuggestionsToGitHub().catch(e => console.warn('Bridge GitHub:', e.message));
      processHouseQueue().catch(e => console.warn('Elaborazione annuncio:', e.message));
      return sendHtml(res, 200, `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Segnalazione ricevuta</title><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f7f5f1;color:#222;padding:32px"><main style="max-width:620px;margin:auto;background:#fff;border:1px solid #ded8d0;border-radius:18px;padding:24px"><h1>✅ Segnalazione ricevuta</h1><p>La casa è stata salvata sul NAS e messa in coda per l'elaborazione automatica.</p><p><a href="/" style="color:#1f6f5f;font-weight:700">← Torna a Cerco Casa</a></p></main></body></html>`);
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
    processHouseQueue().catch(e => console.warn('Elaborazione iniziale annunci:', e.message));
    setInterval(() => flushSuggestionsToGitHub().catch(e => console.warn('Bridge GitHub periodico:', e.message)), 60 * 1000);
    setInterval(() => processHouseQueue().catch(e => console.warn('Elaborazione periodica annunci:', e.message)), 60 * 1000);
    setInterval(() => {
      for (const f of WATCH_FILES) {
        let now = 0; try { now = fs.statSync(f).mtimeMs; } catch {}
        if (now && now !== START_MTIMES.get(f)) {
          console.log('Codice backend aggiornato: riavvio automatico del container.');
          process.exit(0);
        }
      }
    }, 30 * 1000);
  });
});
