(() => {
  const homes = window.HOMES || [];
  if (!window.L || !homes.length) return;

  const capturedMarkers = [];
  let capturedMap = null;

  const originalMap = L.map;
  const originalMarker = L.marker;

  L.map = function (...args) {
    const map = originalMap.apply(this, args);
    capturedMap = map;
    return map;
  };

  L.marker = function (...args) {
    const marker = originalMarker.apply(this, args);
    capturedMarkers.push(marker);
    return marker;
  };

  const byId = new Map(homes.map((h, i) => [h.id, { ...h, _sourceIndex: i }]));

  const style = document.createElement('style');
  style.textContent = `
    .global-status-chip{font-weight:800}
    .global-status-chip.see{background:#e9f6f0;color:#147a54}
    .global-status-chip.eval{background:#fff4e8;color:#a5641c}
    .global-status-chip.discard{background:#efede9;color:#5f5b56}
    .global-status-chip.new{background:#eee8ff;color:#6b35d7}
    .discarded-list{margin-top:20px;padding-top:18px;border-top:1px dashed #cfc8bf}
    .discarded-list .section-title{color:#6f6a63}
    .discarded-list article.card{opacity:.72}
    .layout-hidden{display:none!important}
  `;
  document.head.appendChild(style);

  function numberFromText(value) {
    const m = String(value || '').match(/\d[\d.,]*/);
    if (!m) return 0;
    return Number(m[0].replace(/\./g, '').replace(',', '.')) || 0;
  }

  function addedValue(h) {
    const t = Date.parse(h.addedAt || h.added_at || '');
    if (Number.isFinite(t)) return t;
    return h._sourceIndex ?? 0;
  }

  function compare(a, b) {
    const sortOrder = document.getElementById('sortOrder');
    const mode = sortOrder?.value || 'added-desc';
    let diff = 0;
    if (mode === 'added-asc') diff = addedValue(a) - addedValue(b);
    else if (mode === 'price-asc') diff = (a.price || 0) - (b.price || 0);
    else if (mode === 'price-desc') diff = (b.price || 0) - (a.price || 0);
    else if (mode === 'sqm-desc') diff = numberFromText(b.sqm) - numberFromText(a.sqm);
    else if (mode === 'sqm-asc') diff = numberFromText(a.sqm) - numberFromText(b.sqm);
    else if (mode === 'rating-desc') diff = numberFromText(b.rating) - numberFromText(a.rating);
    else if (mode === 'beds-desc') diff = (b.beds || 0) - (a.beds || 0);
    else if (mode === 'name-asc') diff = String(a.name || '').localeCompare(String(b.name || ''), 'it');
    else diff = addedValue(b) - addedValue(a);
    if (diff !== 0) return diff;
    return (b._sourceIndex ?? 0) - (a._sourceIndex ?? 0);
  }

  function cardId(card) {
    return card.querySelector('[data-add-note]')?.dataset.addNote ||
      card.querySelector('[data-pref]')?.dataset.pref || '';
  }

  function isDiscarded(card) {
    const bogdan = card.querySelector('[data-pref-author="Bogdan"][data-pref-value="ignorare"].active');
    const camilla = card.querySelector('[data-pref-author="Camilla"][data-pref-value="ignorare"].active');
    return Boolean(bogdan && camilla);
  }

  function stateFor(card, discarded) {
    if (discarded) return { text: '🗑️ Scartata', cls: 'discard' };
    if (card.querySelector('.new-badge')) return { text: '🆕 Nuovo', cls: 'new' };
    const active = [...card.querySelectorAll('[data-pref].active')].map(b => b.dataset.prefValue);
    if (active.includes('da-vedere')) return { text: '👀 Da vedere', cls: 'see' };
    return { text: '🤔 Da valutare', cls: 'eval' };
  }

  function decorateCard(card, discarded) {
    const chips = card.querySelector('.chips');
    if (chips) {
      const state = stateFor(card, discarded);
      let chip = chips.querySelector('.global-status-chip');
      if (!chip) {
        chip = document.createElement('span');
        chips.prepend(chip);
      }
      const className = `chip global-status-chip ${state.cls}`;
      if (chip.className !== className) chip.className = className;
      if (chip.textContent !== state.text) chip.textContent = state.text;
    }

    card.classList.toggle('is-ignored', discarded);
    const mapButton = card.querySelector('[data-map]');
    if (mapButton) mapButton.classList.toggle('layout-hidden', discarded);
    const newBadge = card.querySelector('.new-badge');
    if (newBadge) newBadge.classList.toggle('layout-hidden', discarded);
  }

  function syncMarker(id, discarded) {
    if (!capturedMap) return;
    const home = byId.get(id);
    if (!home) return;
    const marker = capturedMarkers[home._sourceIndex];
    if (!marker) return;

    if (discarded) {
      if (capturedMap.hasLayer(marker)) capturedMap.removeLayer(marker);
    } else if (!capturedMap.hasLayer(marker)) {
      marker.addTo(capturedMap);
    }
  }

  function makeSection(kind, count) {
    const block = document.createElement('section');
    const discarded = kind === 'discarded';
    block.className = `section-block ${discarded ? 'discarded-list' : 'global-list'}`;
    block.innerHTML = `<div class="section-head"><div class="section-title"><span>${discarded ? '🗑️' : '🏠'}</span><span>${discarded ? 'Scartate' : 'Annunci'}</span></div><span class="section-count">${count}</span></div><div class="section-grid ${discarded ? 'discarded-grid' : 'global-grid'}"></div>`;
    return block;
  }

  function idsIn(selector) {
    return [...document.querySelectorAll(selector)].map(cardId).filter(Boolean);
  }

  function sameIds(a, b) {
    return a.length === b.length && a.every((id, i) => id === b[i]);
  }

  let timer = null;
  let applying = false;

  function applyLayout() {
    if (applying) return;

    const sections = document.getElementById('sections');
    const sortOrder = document.getElementById('sortOrder');
    const summary = document.getElementById('summary');
    if (!sections || !sortOrder) return;

    const cards = [...sections.querySelectorAll('article.card')];
    if (!cards.length) return;

    const rows = cards
      .map(card => {
        const id = cardId(card);
        return { card, id, home: byId.get(id), discarded: isDiscarded(card) };
      })
      .filter(x => x.home);

    const normal = rows.filter(x => !x.discarded).sort((a, b) => compare(a.home, b.home));
    const discarded = rows.filter(x => x.discarded).sort((a, b) => compare(a.home, b.home));

    rows.forEach(({ card, id, discarded }) => {
      decorateCard(card, discarded);
      syncMarker(id, discarded);
    });

    const expectedNormal = normal.map(x => x.id);
    const expectedDiscarded = discarded.map(x => x.id);
    const actualNormal = idsIn('#sections > .global-list .global-grid > article.card');
    const actualDiscarded = idsIn('#sections > .discarded-list .discarded-grid > article.card');
    const directBlocks = [...sections.querySelectorAll(':scope > .section-block')];
    const expectedBlocks = (normal.length ? 1 : 0) + (discarded.length ? 1 : 0);
    const stable = directBlocks.length === expectedBlocks &&
      sameIds(actualNormal, expectedNormal) && sameIds(actualDiscarded, expectedDiscarded);

    if (!stable) {
      applying = true;
      try {
        const fragment = document.createDocumentFragment();
        if (normal.length) {
          const block = makeSection('normal', normal.length);
          const grid = block.querySelector('.global-grid');
          normal.forEach(({ card }) => grid.appendChild(card));
          fragment.appendChild(block);
        }
        if (discarded.length) {
          const block = makeSection('discarded', discarded.length);
          const grid = block.querySelector('.discarded-grid');
          discarded.forEach(({ card }) => grid.appendChild(card));
          fragment.appendChild(block);
        }
        sections.replaceChildren(fragment);
      } finally {
        applying = false;
      }
    } else {
      const mainCount = sections.querySelector('.global-list .section-count');
      const discardedCount = sections.querySelector('.discarded-list .section-count');
      if (mainCount) mainCount.textContent = normal.length;
      if (discardedCount) discardedCount.textContent = discarded.length;
    }

    if (summary) {
      const newCount = normal.filter(x => x.card.querySelector('.new-badge')).length;
      const sortLabel = sortOrder.options[sortOrder.selectedIndex]?.text || '';
      summary.textContent = `${normal.length} ${normal.length === 1 ? 'casa' : 'case'} visibili${newCount ? ` · ${newCount} nuove` : ''}${discarded.length ? ` · ${discarded.length} scartate` : ''} · ${sortLabel}`;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(applyLayout, 50);
  }

  const start = () => {
    const sections = document.getElementById('sections');
    const sortOrder = document.getElementById('sortOrder');
    if (!sections || !sortOrder) return setTimeout(start, 50);
    const observer = new MutationObserver(schedule);
    observer.observe(sections, { childList: true, subtree: true });
    sortOrder.addEventListener('change', schedule);
    schedule();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
