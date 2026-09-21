(() => {
  const DELETE_SENTINEL = '__ZENCHACK_NOTE_DELETED__';
  const homes = window.HOMES || [];
  const baselineIds = new Set([
    'gerosa','treviolo305','treviolo315','seriate','azzano1','azzano2','dalmine','valverde45',
    'ponteranica-monviso','pedrengo-caravaggio8','dalmine-25aprile80','bergamo-martinella19','treviolo-rossini'
  ]);
  const sourceOrder = new Map(homes.map((h, i) => [h.id, i]));
  const map = L.map('map', { zoomControl: true }).setView([45.684, 9.67], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const markers = new Map();
  const euro = v => new Intl.NumberFormat('it-IT', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0
  }).format(v);

  const sections = document.getElementById('sections');
  const summary = document.getElementById('summary');
  const statusFilter = document.getElementById('statusFilter');
  const sortOrder = document.getElementById('sortOrder');

  let active = 'all';
  let sharedNotes = {};
  let sharedStates = {};

  const sectionMeta = {
    new: { label: 'Nuovi', icon: '🆕' },
    'da-vedere': { label: 'Da vedere', icon: '👀' },
    'da-valutare': { label: 'Da valutare', icon: '🤔' },
    ignorare: { label: 'Ignorare', icon: '🚫' }
  };

  const stateKey = homeId => `state-${homeId}`;

  function stateAuthor() {
    return localStorage.getItem('note-author') === 'Camilla' ? 'Camilla' : 'Bogdan';
  }

  function popup(h) {
    return `<h3>${h.name}</h3><b>${euro(h.price)}</b><div style="margin:4px 0 8px;color:#666">${h.type} · ${h.sqm}</div><div>${h.note}</div><div style="margin-top:8px"><a href="${h.url}" target="_blank" rel="noopener" data-open-home="${h.id}">Apri annuncio</a></div>`;
  }

  homes.forEach(h => {
    const m = L.marker([h.lat, h.lng]).addTo(map).bindPopup(popup(h));
    markers.set(h.id, m);
  });

  function rebuildStates() {
    sharedStates = {};
    homes.forEach(h => {
      const rows = sharedNotes[stateKey(h.id)] || [];
      const state = { preferences: {}, seenAt: null, updatedAt: null };
      rows.forEach(row => {
        try {
          const value = JSON.parse(row.text || '');
          if (!value || typeof value !== 'object') return;
          if (value.preferences && typeof value.preferences === 'object') {
            if (value.preferences.Bogdan) state.preferences.Bogdan = value.preferences.Bogdan;
            if (value.preferences.Camilla) state.preferences.Camilla = value.preferences.Camilla;
          }
          if (value.preference) {
            const author = row.author === 'Camilla' ? 'Camilla' : 'Bogdan';
            state.preferences[author] = value.preference;
          }
          if (value.seenAt) state.seenAt = value.seenAt;
          if (value.updatedAt) state.updatedAt = value.updatedAt;
        } catch {}
      });
      sharedStates[h.id] = state;
    });
  }

  function houseState(h) { return sharedStates[h.id] || { preferences: {} }; }
  function preference(h, author) { return houseState(h).preferences?.[author] || null; }
  function combinedPreference(h) {
    const b = preference(h, 'Bogdan');
    const c = preference(h, 'Camilla');
    if (b === 'ignorare' && c === 'ignorare') return 'ignorare';
    if (b === 'da-vedere' || c === 'da-vedere') return 'da-vedere';
    return 'da-valutare';
  }
  function isNew(h) { return !baselineIds.has(h.id) && !houseState(h).seenAt; }
  function sectionKey(h) { return isNew(h) ? 'new' : combinedPreference(h); }

  function matches(h) {
    let ok = true;
    if (active === 'city') ok = h.city;
    if (active === 'garage') ok = h.garage;
    if (active === 'garden') ok = h.garden;
    if (active === '3bed') ok = h.beds >= 3;
    const s = statusFilter.value;
    if (s === 'unrated') ok = ok && !preference(h, stateAuthor());
    else if (s === 'new') ok = ok && isNew(h);
    else if (s !== 'all') ok = ok && combinedPreference(h) === s;
    return ok;
  }

  function formatDate(iso, withTime = true) {
    if (!iso) return '';
    try {
      const opts = withTime
        ? { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }
        : { day:'2-digit', month:'2-digit', year:'numeric' };
      return new Intl.DateTimeFormat('it-IT', opts).format(new Date(iso));
    } catch { return ''; }
  }

  function numberFromText(value) {
    const m = String(value || '').match(/\d[\d.,]*/);
    if (!m) return 0;
    const raw = m[0].replace(/\./g, '').replace(',', '.');
    return Number(raw) || 0;
  }

  function addedValue(h) {
    const t = Date.parse(h.addedAt || h.added_at || '');
    if (Number.isFinite(t)) return t;
    return sourceOrder.get(h.id) ?? 0;
  }

  function compareHomes(a, b) {
    const mode = sortOrder.value;
    let diff = 0;
    if (mode === 'added-asc') diff = addedValue(a) - addedValue(b);
    else if (mode === 'price-asc') diff = (a.price || 0) - (b.price || 0);
    else if (mode === 'price-desc') diff = (b.price || 0) - (a.price || 0);
    else if (mode === 'sqm-desc') diff = numberFromText(b.sqm) - numberFromText(a.sqm);
    else if (mode === 'sqm-asc') diff = numberFromText(a.sqm) - numberFromText(b.sqm);
    else if (mode === 'rating-desc') diff = numberFromText(b.rating) - numberFromText(a.rating);
    else if (mode === 'beds-desc') diff = (b.beds || 0) - (a.beds || 0);
    else if (mode === 'name-asc') diff = String(a.name).localeCompare(String(b.name), 'it');
    else diff = addedValue(b) - addedValue(a);
    if (diff !== 0) return diff;
    return (sourceOrder.get(b.id) ?? 0) - (sourceOrder.get(a.id) ?? 0);
  }

  function sortItems(items) { return items.slice().sort(compareHomes); }

  function noteEditPayload(row) {
    try {
      const v = JSON.parse(row.text || '');
      return v && v._type === 'note-edit' ? v : null;
    } catch { return null; }
  }

  function visibleNotes(homeId) {
    const rows = sharedNotes[homeId] || [];
    const edits = new Map();
    const base = [];
    rows.forEach(row => {
      const edit = noteEditPayload(row);
      if (edit && edit.targetAuthor && edit.targetCreatedAt && typeof edit.text === 'string') {
        edits.set(`${edit.targetAuthor}|${edit.targetCreatedAt}`, edit);
      } else {
        base.push(row);
      }
    });
    return base.map(row => {
      const edit = edits.get(`${row.author}|${row.createdAt}`);
      return {
        ...row,
        displayText: edit ? edit.text : row.text,
        editedAt: edit ? edit.editedAt : null
      };
    }).filter(row => row.displayText !== DELETE_SENTINEL);
  }

  async function deleteNote(homeId, note) {
    if (note.author !== stateAuthor()) return;
    if (!confirm('Eliminare questa nota?')) return;
    try {
      const event = {
        _type: 'note-edit',
        targetAuthor: note.author,
        targetCreatedAt: note.createdAt,
        text: DELETE_SENTINEL,
        editedAt: new Date().toISOString()
      };
      const r = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ homeId, author: stateAuthor(), text: JSON.stringify(event) })
      });
      if (!r.ok) throw new Error('Errore eliminazione');
      await loadNotes();
    } catch (err) {
      alert('Non sono riuscito a eliminare la nota. Riprova tra poco.');
    }
  }

  function fillNotes(homeId) {
    const box = document.querySelector(`[data-notes-for="${homeId}"]`);
    if (!box) return;
    box.innerHTML = '';
    const notes = visibleNotes(homeId);
    if (!notes.length) {
      const e = document.createElement('div');
      e.className = 'no-notes';
      e.textContent = 'Nessuna nota ancora.';
      box.appendChild(e);
      return;
    }

    notes.slice().reverse().forEach(n => {
      const item = document.createElement('div');
      item.className = 'note-item';

      const head = document.createElement('div');
      head.className = 'note-head';
      const meta = document.createElement('span');
      meta.textContent = `${n.author} · ${formatDate(n.createdAt)}${n.editedAt ? ` · modificata ${formatDate(n.editedAt)}` : ''}`;
      head.appendChild(meta);

      if (n.author === stateAuthor()) {
        const tools = document.createElement('span');
        tools.style.display = 'inline-flex';
        tools.style.gap = '6px';
        tools.style.alignItems = 'center';

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'note-edit-btn';
        edit.textContent = '✏️ Modifica';
        edit.addEventListener('click', () => openEditNoteDialog(homeId, n));

        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '🗑️ Elimina';
        del.style.border = '0';
        del.style.background = 'transparent';
        del.style.color = '#a33';
        del.style.font = 'inherit';
        del.style.fontWeight = '800';
        del.style.padding = '3px 5px';
        del.style.cursor = 'pointer';
        del.style.whiteSpace = 'nowrap';
        del.addEventListener('click', () => deleteNote(homeId, n));

        tools.append(edit, del);
        head.appendChild(tools);
      }

      const text = document.createElement('div');
      text.className = 'note-text';
      text.textContent = n.displayText;
      item.append(head, text);
      box.appendChild(item);
    });
  }

  function decisionButton(h, author, value, label) {
    return `<button type="button" data-pref="${h.id}" data-pref-author="${author}" data-pref-value="${value}" class="${preference(h, author) === value ? 'active' : ''}">${label}</button>`;
  }

  function reactionRow(h, author) {
    return `<div class="reaction-row"><div class="person ${author.toLowerCase()}">${author === 'Bogdan' ? '👨' : '👩'} ${author}</div><div class="decision">${decisionButton(h, author, 'da-vedere', '👀 Vedere')}${decisionButton(h, author, 'da-valutare', '🤔 Valutare')}${decisionButton(h, author, 'ignorare', '🚫 Ignora')}</div></div>`;
  }

  function cardHtml(h) {
    const newBadge = isNew(h) ? '<span class="new-badge">NEW</span>' : '';
    const addedChip = h.addedAt ? `<span class="chip">Aggiunta ${formatDate(h.addedAt, false)}</span>` : '';
    return `<div style="display:flex;justify-content:space-between;gap:12px"><div><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><h2>${h.name}</h2>${newBadge}</div><div class="meta">${h.type} · ${h.sqm}</div></div><div class="price">${euro(h.price)}</div></div><div class="chips">${h.tags.map(t => `<span class="chip">${t}</span>`).join('')}<span class="chip rating">${h.rating}</span>${addedChip}</div><div class="note">${h.note}</div><div class="warning" style="font-size:12px;margin-top:8px">${h.warning || ''}</div><div class="reactions"><div class="reactions-title">Le vostre impressioni</div>${reactionRow(h, 'Bogdan')}${reactionRow(h, 'Camilla')}</div><div class="actions"><a class="secondary" href="#map" data-map="${h.id}">Mappa</a><a class="primary" href="${h.url}" target="_blank" rel="noopener" data-open-home="${h.id}">Annuncio</a><button class="secondary" type="button" data-add-note="${h.id}">＋ Nota</button></div><div class="user-notes"><div class="user-notes-title"><span>Note vostre</span><span>${visibleNotes(h.id).length}</span></div><div class="note-list" data-notes-for="${h.id}"></div></div>`;
  }

  function render() {
    sections.innerHTML = '';
    const visible = homes.filter(matches);
    const newCount = visible.filter(isNew).length;
    const sortLabel = sortOrder.options[sortOrder.selectedIndex]?.text || '';
    summary.textContent = `${visible.length} ${visible.length === 1 ? 'casa' : 'case'} visibili${newCount ? ` · ${newCount} nuove` : ''} · ${sortLabel}`;

    homes.forEach(h => {
      const m = markers.get(h.id);
      if (matches(h)) {
        if (!map.hasLayer(m)) m.addTo(map);
      } else if (map.hasLayer(m)) {
        map.removeLayer(m);
      }
    });

    const groups = { new: [], 'da-vedere': [], 'da-valutare': [], ignorare: [] };
    visible.forEach(h => groups[sectionKey(h)].push(h));

    ['new', 'da-vedere', 'da-valutare', 'ignorare'].forEach(key => {
      const items = sortItems(groups[key]);
      if (!items.length) return;
      const block = document.createElement('section');
      block.className = 'section-block';
      const meta = sectionMeta[key];
      block.innerHTML = `<div class="section-head"><div class="section-title"><span>${meta.icon}</span><span>${meta.label}</span></div><span class="section-count">${items.length}</span></div><div class="section-grid" data-section-grid="${key}"></div>`;
      sections.appendChild(block);
      const grid = block.querySelector('[data-section-grid]');
      items.forEach(h => {
        const el = document.createElement('article');
        el.className = `card${isNew(h) ? ' is-new' : ''}${combinedPreference(h) === 'ignorare' ? ' is-ignored' : ''}`;
        el.innerHTML = cardHtml(h);
        grid.appendChild(el);
        fillNotes(h.id);
      });
    });

    sections.querySelectorAll('[data-map]').forEach(a => a.addEventListener('click', () => {
      const h = homes.find(x => x.id === a.dataset.map);
      setTimeout(() => {
        map.setView([h.lat, h.lng], 15);
        markers.get(h.id).openPopup();
      }, 100);
    }));
    sections.querySelectorAll('[data-add-note]').forEach(b => b.addEventListener('click', () => openNoteDialog(b.dataset.addNote)));
    sections.querySelectorAll('[data-pref]').forEach(b => b.addEventListener('click', () => setPreference(b.dataset.pref, b.dataset.prefAuthor, b.dataset.prefValue)));
  }

  async function loadNotes() {
    try {
      const r = await fetch('/api/notes', { cache: 'no-store' });
      if (r.ok) {
        sharedNotes = await r.json();
        rebuildStates();
        render();
      }
    } catch (e) {
      console.warn('Note non disponibili', e);
    }
  }

  async function saveStateEvent(homeId, author, payload, keepalive = false) {
    const key = stateKey(homeId);
    const now = new Date().toISOString();
    const row = { author, text: JSON.stringify(payload), createdAt: now };
    if (!Array.isArray(sharedNotes[key])) sharedNotes[key] = [];
    sharedNotes[key].push(row);
    const r = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ homeId: key, author: row.author, text: row.text }),
      keepalive
    });
    if (!r.ok) throw new Error('Errore salvataggio stato');
  }

  async function setPreference(homeId, author, value) {
    const h = homes.find(x => x.id === homeId);
    if (!h) return;
    const state = sharedStates[homeId] || { preferences: {} };
    const before = state.preferences?.[author] || null;
    sharedStates[homeId] = {
      ...state,
      preferences: { ...(state.preferences || {}), [author]: value },
      updatedAt: new Date().toISOString()
    };
    render();
    try {
      await saveStateEvent(homeId, author, { preference: value, updatedAt: new Date().toISOString() });
    } catch (err) {
      const current = sharedStates[homeId] || { preferences: {} };
      const prefs = { ...(current.preferences || {}) };
      if (before) prefs[author] = before;
      else delete prefs[author];
      sharedStates[homeId] = { ...current, preferences: prefs };
      render();
      alert('Non sono riuscito a salvare la valutazione. Riprova tra poco.');
    }
  }

  function markSeen(homeId) {
    const h = homes.find(x => x.id === homeId);
    if (!h || baselineIds.has(homeId) || houseState(h).seenAt) return;
    const state = sharedStates[homeId] || { preferences: {} };
    const now = new Date().toISOString();
    sharedStates[homeId] = { ...state, seenAt: now, updatedAt: now };
    render();
    saveStateEvent(homeId, stateAuthor(), { seenAt: now, updatedAt: now }, true).catch(e => {
      sharedStates[homeId] = { ...state };
      render();
      console.warn('Stato NEW non salvato', e);
    });
  }

  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    active = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
    render();
  }));
  statusFilter.addEventListener('change', render);
  const savedSort = localStorage.getItem('house-sort');
  if (savedSort && [...sortOrder.options].some(o => o.value === savedSort)) sortOrder.value = savedSort;
  sortOrder.addEventListener('change', () => {
    localStorage.setItem('house-sort', sortOrder.value);
    render();
  });
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-open-home]');
    if (a) markSeen(a.dataset.openHome);
  });

  const suggestDlg = document.getElementById('suggestDialog');
  document.getElementById('openSuggest').addEventListener('click', () => suggestDlg.showModal());
  document.getElementById('closeSuggest').addEventListener('click', () => suggestDlg.close());
  suggestDlg.addEventListener('click', e => { if (e.target === suggestDlg) suggestDlg.close(); });

  const noteDlg = document.getElementById('noteDialog');
  const noteForm = document.getElementById('noteForm');
  const noteText = document.getElementById('noteText');
  const noteAuthor = document.getElementById('noteAuthor');
  const saveNote = document.getElementById('saveNote');
  const noteTitle = document.getElementById('noteDialogTitle');
  const noteHint = document.getElementById('noteHint');
  let noteMode = 'add';
  let editTarget = null;

  const savedAuthor = localStorage.getItem('note-author');
  if (savedAuthor === 'Bogdan' || savedAuthor === 'Camilla') noteAuthor.value = savedAuthor;

  function openNoteDialog(homeId) {
    const h = homes.find(x => x.id === homeId);
    if (!h) return;
    noteMode = 'add';
    editTarget = null;
    document.getElementById('noteHomeId').value = homeId;
    document.getElementById('noteHomeName').textContent = h.name;
    noteTitle.textContent = '📝 Aggiungi nota';
    noteHint.textContent = 'Le note sono condivise: le vedrete entrambi anche da dispositivi diversi.';
    noteText.value = '';
    noteText.maxLength = 1000;
    saveNote.textContent = 'Salva nota';
    noteDlg.showModal();
    setTimeout(() => noteText.focus(), 100);
  }

  function openEditNoteDialog(homeId, note) {
    const h = homes.find(x => x.id === homeId);
    if (!h || note.author !== stateAuthor()) return;
    noteMode = 'edit';
    editTarget = { homeId, author: note.author, createdAt: note.createdAt };
    document.getElementById('noteHomeId').value = homeId;
    document.getElementById('noteHomeName').textContent = h.name;
    noteTitle.textContent = '✏️ Modifica nota';
    noteHint.textContent = 'La modifica sostituisce il testo visibile, mantenendo lo storico sul NAS.';
    noteAuthor.value = note.author;
    noteText.value = note.displayText;
    noteText.maxLength = 850;
    saveNote.textContent = 'Salva modifica';
    noteDlg.showModal();
    setTimeout(() => {
      noteText.focus();
      noteText.setSelectionRange(noteText.value.length, noteText.value.length);
    }, 100);
  }

  document.getElementById('closeNote').addEventListener('click', () => noteDlg.close());
  noteDlg.addEventListener('click', e => { if (e.target === noteDlg) noteDlg.close(); });

  noteForm.addEventListener('submit', async e => {
    e.preventDefault();
    const homeId = document.getElementById('noteHomeId').value;
    const text = noteText.value.trim();
    const author = stateAuthor();
    if (!text) return;
    localStorage.setItem('note-author', author);
    saveNote.disabled = true;
    saveNote.textContent = noteMode === 'edit' ? 'Salvo modifica…' : 'Salvo…';
    try {
      let payloadText = text;
      if (noteMode === 'edit' && editTarget) {
        const editEvent = {
          _type: 'note-edit',
          targetAuthor: editTarget.author,
          targetCreatedAt: editTarget.createdAt,
          text,
          editedAt: new Date().toISOString()
        };
        payloadText = JSON.stringify(editEvent);
        if (payloadText.length > 990) throw new Error('La nota modificata è troppo lunga');
      }
      const r = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ homeId, author, text: payloadText })
      });
      if (!r.ok) throw new Error('Errore salvataggio');
      noteDlg.close();
      await loadNotes();
    } catch (err) {
      alert(err.message === 'La nota modificata è troppo lunga' ? err.message : 'Non sono riuscito a salvare la nota. Riprova tra poco.');
    } finally {
      saveNote.disabled = false;
      saveNote.textContent = noteMode === 'edit' ? 'Salva modifica' : 'Salva nota';
    }
  });

  render();
  loadNotes();
})();
