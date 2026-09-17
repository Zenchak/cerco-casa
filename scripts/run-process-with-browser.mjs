import { chromium } from 'playwright';

const nativeFetch = globalThis.fetch;
let browser = null;

async function browserFetch(url) {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled']
    });
  }
  const context = await browser.newContext({
    locale: 'it-IT',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: {
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7'
    }
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const html = await page.content();
    const finalUrl = page.url();
    const status = response?.status() || 200;
    if (status >= 400 || html.length < 500) {
      throw new Error(`browser HTTP ${status}`);
    }
    return {
      ok: true,
      status: 200,
      url: finalUrl,
      text: async () => html
    };
  } finally {
    await context.close();
  }
}

globalThis.fetch = async function patchedFetch(input, init) {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  const r = await nativeFetch(input, init);
  if (r.ok) return r;

  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();
  if (!['idealista.it','casa.it'].includes(host)) return r;

  console.log(`HTTP ${r.status} da ${host}; riprovo con browser reale.`);
  try {
    return await browserFetch(url);
  } catch (e) {
    console.warn(`Fallback browser fallito per ${url}: ${e.message}`);
    return r;
  }
};

try {
  await import('./process-suggestions.mjs');
} finally {
  if (browser) await browser.close();
}
