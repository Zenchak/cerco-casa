(() => {
  const sections = document.getElementById('sections');
  const sortOrder = document.getElementById('sortOrder');
  const homes = window.HOMES || [];
  if (!sections || !sortOrder || !homes.length) return;

  const byId = new Map(homes.map((h, i) => [h.id, { ...h, _sourceIndex: i }]));

  const style = document.createElement('style');
  style.textContent = `
    .global-status-chip{font-weight:800}
    .global-status-chip.see{background:#e9f6f0;color:#147a54}
    .global-status-chip.eval{background:#fff4e8;color:#a5641c}
    .global-status-chip.ignore{background:#efede9;color:#5f5b56}
    .global-status-chip.new{background:#eee8ff;color:#6b35d7}
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
    const mode = sortOrder.value;
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

  function cardState(card) {
    if (card.querySelector('.new-badge')) return { text: '🆕 Nuovo', cls: 'new' };
    const active = [...card.querySelectorAll('[data-pref].active')].map(b => b.dataset.prefValue);
    const ignores = active.filter(v => v === 'ignorare').length;
    if (ignores >= 2) return { text: '🚫 Ignorare', cls: 'ignore' };
    if (active.includes('da-vedere')) return { text: '👀 Da vedere', cls: 'see' };
    return { text: '🤔 Da valutare', cls: 'eval' };
  }

  function addStateChip(card) {
    const chips = card.querySelector('.chips');
    if (!chips) return;
    const old = chips.querySelector('.global-status-chip');
    if (old) old.remove();
    const state = cardState(card);
    const chip = document.createElement('span');
    chip.className = `chip global-status-chip ${state.cls}`;
    chip.textContent = state.text;
    chips.prepend(chip);
  }

  let applying = false;
  let timer = null;

  function applyGlobalSort() {
    if (applying) return;
    const cards = [...sections.querySelectorAll('article.card')];
    if (!cards.length) return;

    // Se siamo già nella lista globale, non ricreiamo il DOM inutilmente.
    const blocks = [...sections.querySelectorAll(':scope > .section-block')];
    if (blocks.length === 1 && blocks[0].classList.contains('global-list')) {
      cards.forEach(addStateChip);
      return;
    }

    applying = true;
    try {
      const ordered = cards
        .map(card => ({ card, home: byId.get(cardId(card)) }))
        .filter(x => x.home)
        .sort((a, b) => compare(a.home, b.home));

      const block = document.createElement('section');
      block.className = 'section-block global-list';
      block.innerHTML = `<div class="section-head"><div class="section-title"><span>🏠</span><span>Annunci</span></div><span class="section-count">${ordered.length}</span></div><div class="section-grid global-grid"></div>`;
      const grid = block.querySelector('.global-grid');

      ordered.forEach(({ card }) => {
        addStateChip(card);
        grid.appendChild(card);
      });

      sections.replaceChildren(block);
    } finally {
      applying = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(applyGlobalSort, 60);
  }

  sortOrder.addEventListener('change', schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(sections, { childList: true, subtree: true });
  schedule();
})();
