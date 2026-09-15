(() => {
  const DELETE_SENTINEL = '__ZENCHACK_NOTE_DELETED__';

  const style = document.createElement('style');
  style.textContent = `
    .note-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .note-tools{display:inline-flex;gap:6px;align-items:center}
    .note-delete-btn{border:0;background:transparent;color:#a33;font:inherit;font-size:11px;font-weight:800;padding:3px 5px;cursor:pointer;border-radius:8px}
    .note-delete-btn:hover{background:#f8e9e7}
  `;
  document.head.appendChild(style);

  function activeProfile(){
    return localStorage.getItem('note-author') === 'Camilla' ? 'Camilla' : 'Bogdan';
  }

  function parseEdit(row){
    try{
      const v = JSON.parse(row.text || '');
      return v && v._type === 'note-edit' ? v : null;
    }catch{return null}
  }

  function buildVisible(rows){
    const edits = new Map();
    const base = [];
    (rows || []).forEach(row => {
      const edit = parseEdit(row);
      if(edit && edit.targetAuthor && edit.targetCreatedAt && typeof edit.text === 'string'){
        edits.set(`${edit.targetAuthor}|${edit.targetCreatedAt}`, edit);
      }else{
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
    });
  }

  let applying = false;
  async function applyDeleteButtons(){
    if(applying) return;
    applying = true;
    try{
      const r = await fetch('/api/notes', {cache:'no-store'});
      if(!r.ok) return;
      const all = await r.json();
      document.querySelectorAll('.note-list[data-notes-for]').forEach(list => {
        const homeId = list.dataset.notesFor;
        const visible = buildVisible(all[homeId] || []).slice().reverse();
        const items = [...list.querySelectorAll('.note-item')];
        let shown = 0;

        items.forEach((item, index) => {
          const note = visible[index];
          if(!note) return;
          if(note.displayText === DELETE_SENTINEL){
            item.style.display = 'none';
            return;
          }
          shown += 1;
          item.style.display = '';
          if(note.author !== activeProfile()) return;

          const head = item.querySelector('.note-head');
          if(!head || head.querySelector('.note-delete-btn')) return;

          let tools = head.querySelector('.note-tools');
          if(!tools){
            tools = document.createElement('span');
            tools.className = 'note-tools';
            const existingEdit = head.querySelector('.note-edit-btn');
            if(existingEdit) tools.appendChild(existingEdit);
            head.appendChild(tools);
          }

          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'note-delete-btn';
          del.textContent = '🗑️ Elimina';
          del.addEventListener('click', async () => {
            if(!confirm('Eliminare questa nota?')) return;
            del.disabled = true;
            del.textContent = 'Elimino…';
            try{
              const event = {
                _type: 'note-edit',
                targetAuthor: note.author,
                targetCreatedAt: note.createdAt,
                text: DELETE_SENTINEL,
                editedAt: new Date().toISOString()
              };
              const resp = await fetch('/api/notes', {
                method: 'POST',
                headers: {'content-type':'application/json'},
                body: JSON.stringify({homeId, author: activeProfile(), text: JSON.stringify(event)})
              });
              if(!resp.ok) throw new Error('Errore eliminazione');
              location.reload();
            }catch(e){
              alert('Non sono riuscito a eliminare la nota. Riprova tra poco.');
              del.disabled = false;
              del.textContent = '🗑️ Elimina';
            }
          });
          tools.appendChild(del);
        });

        const card = list.closest('.card');
        const count = card && card.querySelector('.user-notes-title span:last-child');
        if(count) count.textContent = String(shown);
      });
    }catch(e){
      console.warn('Gestione eliminazione note non disponibile', e);
    }finally{
      applying = false;
    }
  }

  let timer;
  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(applyDeleteButtons, 120);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {childList:true, subtree:true});
})();
