(() => {
  const homes = window.HOMES || [];
  const homeUrls = new Set(homes.map(h => normalizeUrl(h.url)).filter(Boolean));
  let box = null;
  let timer = null;

  function normalizeUrl(value) {
    try {
      const u = new URL(String(value || '').trim());
      u.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid'].forEach(k => u.searchParams.delete(k));
      return u.toString().replace(/\/$/, '');
    } catch { return String(value || '').trim().replace(/\/$/, ''); }
  }

  function processedUrl() {
    return location.pathname.startsWith('/casa/') ? '/casa/processed-suggestions.json' : '/processed-suggestions.json';
  }

  function ensureBox() {
    if (box && box.isConnected) return box;
    const summary = document.getElementById('summary');
    if (!summary?.parentElement) return null;
    box = document.createElement('div');
    box.id = 'pendingSuggestions';
    box.style.padding = '12px 16px 0';
    summary.parentElement.insertBefore(box, summary);
    return box;
  }

  function fmt(iso) {
    try {
      return new Intl.DateTimeFormat('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(iso));
    } catch { return ''; }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function render(items) {
    const host = ensureBox();
    if (!host) return;
    if (!items.length) {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.innerHTML = `
      <section style="display:grid;gap:10px;margin-bottom:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="font-size:18px;font-weight:800">🆕 Nuove segnalazioni</div>
          <span style="font-size:12px;font-weight:800;min-width:26px;height:26px;border-radius:999px;background:#ece7df;display:inline-flex;align-items:center;justify-content:center;color:#6f6a63">${items.length}</span>
        </div>
        <div style="display:grid;gap:10px">
          ${items.map(s => `
            <article style="background:#fff;border:1px solid #c9b7f8;box-shadow:0 4px 18px rgba(123,63,242,.08);border-radius:18px;padding:15px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="new-badge">NEW</span>
                <strong style="font-size:17px">Annuncio segnalato da ${esc(s.sender || 'voi')}</strong>
              </div>
              <div style="color:#6f6a63;font-size:13px;margin-top:6px">${esc(s.priority || 'Normale')} · ${fmt(s.createdAt)} · in elaborazione</div>
              ${s.note ? `<div style="margin-top:9px;font-size:14px;line-height:1.4">${esc(s.note)}</div>` : ''}
              <div style="margin-top:12px"><a href="${esc(s.url)}" target="_blank" rel="noopener" style="display:inline-flex;text-decoration:none;background:#1f6f5f;color:#fff;border-radius:12px;padding:10px 14px;font-weight:700">Apri annuncio</a></div>
            </article>`).join('')}
        </div>
      </section>`;
  }

  async function loadPending() {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/suggestions', { cache:'no-store' }),
        fetch(processedUrl() + '?v=' + Date.now(), { cache:'no-store' }).catch(() => null)
      ]);
      if (!sRes.ok) return;
      const suggestions = await sRes.json();
      const processed = pRes?.ok ? await pRes.json() : [];
      const doneIds = new Set(Array.isArray(processed) ? processed.map(x => x?.id).filter(Boolean) : []);
      const pending = (Array.isArray(suggestions) ? suggestions : [])
        .filter(s => !doneIds.has(s.id))
        .filter(s => !homeUrls.has(normalizeUrl(s.url)))
        .sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      render(pending);
    } catch (e) {
      console.warn('Segnalazioni pendenti non disponibili', e);
    }
  }

  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      position:'fixed', left:'50%', bottom:'24px', transform:'translateX(-50%)', zIndex:'2147483647',
      background:'#1f6f5f', color:'#fff', padding:'11px 15px', borderRadius:'12px', fontWeight:'750',
      boxShadow:'0 8px 26px rgba(0,0,0,.2)'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function wireSubmit() {
    const form = document.querySelector('#suggestDialog form');
    if (!form || form.dataset.pendingWired) return;
    form.dataset.pendingWired = '1';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const oldText = submit?.textContent || '';
      if (submit) { submit.disabled = true; submit.textContent = 'Invio…'; }
      try {
        const fd = new FormData(form);
        const payload = {
          url: fd.get('url'),
          sender: fd.get('segnalata-da'),
          priority: fd.get('priorita'),
          note: fd.get('nota')
        };
        const r = await fetch('/api/suggestions', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(payload)
        });
        if (!r.ok) throw new Error('Invio non riuscito');
        document.getElementById('suggestDialog')?.close();
        form.reset();
        toast('✅ Casa segnalata · compare subito come NEW');
        await loadPending();
      } catch (err) {
        alert('Non sono riuscito a salvare la segnalazione. Riprova tra poco.');
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = oldText; }
      }
    });
  }

  function start() {
    wireSubmit();
    loadPending();
    clearInterval(timer);
    timer = setInterval(loadPending, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPending(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
