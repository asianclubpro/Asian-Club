(function(){
  const ADMIN_TOKEN = localStorage.getItem('admin_token') || '';
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const table = document.getElementById('listTable');
  const tbody = table.querySelector('tbody');
  const thead = table.querySelector('thead');
  const search = document.getElementById('search');
  const limitEl = document.getElementById('limit');
  const refreshBtn = document.getElementById('refresh');
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const pagingInfo = document.getElementById('pagingInfo');

  let type = 'movies';
  let offset = 0;
  let limit = parseInt(limitEl.value || '25');
  let currentRows = [];

  function headers(){ return { 'x-admin-token': (localStorage.getItem('admin_token') || ADMIN_TOKEN) } }

  function showFloating(type, text, title){
    // simple reuse of previous floating style
    const existing = document.getElementById('floatingMsg'); if(existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'floatingMsg'; el.className = 'floatingMsg ' + (type||'info');
    el.innerHTML = `<div class="fm-header"><div class="fm-title">${title||''}</div></div><div class="fm-body"><pre>${text}</pre></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(()=> el.classList.add('enter'));
    setTimeout(()=>{ el.classList.remove('enter'); el.classList.add('leave'); setTimeout(()=> el.remove(), 160) }, 4000);
  }

  async function fetchPage(){
    limit = parseInt(limitEl.value || '25');
    const url = `/admin/db/${type}?limit=${limit}&offset=${offset}`;
    try{
      const res = await fetch(url, { headers: headers() });
      if(!res.ok) return showFloating('error', `Error ${res.status} - ${res.statusText}`, 'Error');
      const j = await res.json();
      let rows = (type === 'movies') ? (j.movies||[]) : (type === 'series' ? (j.series||[]) : (j.episodes||[]));
      currentRows = rows;
      renderTable(rows);
      pagingInfo.textContent = `Mostrando ${offset+1} - ${offset + rows.length}`;
    }catch(err){ showFloating('error', err.message, 'Network error') }
  }

  function renderTable(rows){
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if(!rows || rows.length === 0){ thead.innerHTML = '<tr><th>Registros</th></tr>'; tbody.innerHTML = '<tr><td class="empty-state">No se encontraron registros</td></tr>'; return }
    // build columns per type
    let cols = [];
    if(type === 'movies') cols = ['ID','Título','Quality','Language','Codec','Poster','Acciones'];
    else if(type === 'series') cols = ['ID','Título','Poster','Acciones'];
    else cols = ['ID','Título','Season','Episode','Quality','Language','Codec','Poster','Acciones'];
    const tr = document.createElement('tr');
    for(const c of cols){ const th = document.createElement('th'); th.textContent = c; tr.appendChild(th) }
    thead.appendChild(tr);

    for(const r of rows){
      const tr = document.createElement('tr');
      if(type === 'movies'){
        tr.innerHTML = `<td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml(r.title||'')}</td>
          <td>${escapeHtml(r.quality||'')}</td>
          <td>${escapeHtml(r.language||'')}</td>
          <td>${escapeHtml(r.codec||'')}</td>
          <td>${r.poster?`<img src="${escapeHtml(r.poster)}" class="thumbnail"/>`:'-'}</td>
          <td class="row-actions"><button class="btn" data-id="${escapeHtml(r.id)}" data-action="edit">Editar</button><button class="btn" data-id="${escapeHtml(r.id)}" data-action="delete">Borrar</button></td>`;
      } else if(type === 'series'){
        tr.innerHTML = `<td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.title||'')}</td><td>${r.poster?`<img src="${escapeHtml(r.poster)}" class="thumbnail"/>`:'-'}</td><td class="row-actions"><button class="btn" data-id="${escapeHtml(r.id)}" data-action="edit">Editar</button><button class="btn" data-id="${escapeHtml(r.id)}" data-action="delete">Borrar</button></td>`;
      } else {
        tr.innerHTML = `<td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.title||'')}</td><td>${escapeHtml(r.season||'')}</td><td>${escapeHtml(r.episode||'')}</td><td>${escapeHtml(r.quality||'')}</td><td>${escapeHtml(r.language||'')}</td><td>${escapeHtml(r.codec||'')}</td><td>${r.poster?`<img src="${escapeHtml(r.poster)}" class="thumbnail"/>`:'-'}</td><td class="row-actions"><button class="btn" data-id="${escapeHtml(r.id)}" data-action="edit">Editar</button><button class="btn" data-id="${escapeHtml(r.id)}" data-action="delete">Borrar</button></td>`;
      }
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

  // tab switching
  function showTab(name){ tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab === name)); type = name; offset = 0; fetchPage(); }
  tabs.forEach(t=> t.addEventListener('click', ()=> showTab(t.dataset.tab)));
  showTab('movies');

  refreshBtn.addEventListener('click', ()=> fetchPage());
  limitEl.addEventListener('change', ()=> { offset = 0; fetchPage() });
  prevBtn.addEventListener('click', ()=>{ if(offset - limit >= 0){ offset -= limit; fetchPage() } });
  nextBtn.addEventListener('click', ()=>{ offset += limit; fetchPage() });

  // search client-side (simple)
  search.addEventListener('input', ()=>{
    const q = search.value.trim().toLowerCase();
    if(!q) return renderTable(currentRows);
    const filtered = currentRows.filter(r => (r.id||'').toLowerCase().includes(q) || (r.title||'').toLowerCase().includes(q));
    renderTable(filtered);
  });

  // row action delegation
  tbody.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.dataset.id; const action = btn.dataset.action;
    if(action === 'edit') return openEdit(id);
    if(action === 'delete') return confirmDelete(id);
  });

  // --- IMDb autocomplete helpers (adapted from add.js)
  function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), wait); }; }

  async function fetchSuggestions(q){
    if(!q || q.trim().length < 2) return [];
    try{
      const res = await fetch('/admin/imdb/search?q=' + encodeURIComponent(q));
      if(!res.ok) return [];
      const j = await res.json();
      return (j.results || []).slice(0,8);
    }catch(e){ return []; }
  }

  function createDropdown(root){
    let wrap = root.querySelector('.autocomplete');
    if(!wrap){ wrap = document.createElement('div'); wrap.className = 'autocomplete';
      const input = root.querySelector('input[name="title"]');
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    // Create the list element but append it to document.body so it doesn't get clipped inside modal scroll containers
    let list = document.body.querySelector('.autocomplete-list[data-for="'+(root.id||'')+'"]');
    if(!list){ list = document.createElement('div'); list.className = 'autocomplete-list'; list.setAttribute('data-for', root.id || ''); document.body.appendChild(list); }
    return { wrap, list };
  }

  function attachAutocomplete(form){
    const input = form.querySelector('input[name="title"]');
    const idInput = form.querySelector('input[name="id"]');
    const posterInput = form.querySelector('input[name="poster"]');
    if(!input) return;
    const { wrap, list } = createDropdown(form);

    let items = [];
    let activeIndex = -1;

    const setActive = (idx)=>{
      const children = Array.from(list.children);
      children.forEach((c,i)=> c.classList.toggle('active', i === idx));
      activeIndex = idx;
    };

    const DEFAULT_POSTER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="430"><rect width="100%" height="100%" fill="#e6e7ea"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="Arial,Helvetica,sans-serif" font-size="20">No image</text></svg>');

    const selectIndex = (idx)=>{
      const it = items[idx];
      if(!it) return;
      input.value = it.title + (it.year ? (' (' + it.year + ')') : '');
      if(it.imdb_id) idInput.value = it.imdb_id;
      if(posterInput){ if(it.poster_url) posterInput.value = it.poster_url; else posterInput.value = ''; }
      list.style.display = 'none'; items = []; activeIndex = -1;
    };

    const render = (newItems)=>{
      items = newItems || [];
      list.innerHTML = '';
      if(!items || items.length === 0){ list.style.display = 'none'; activeIndex = -1; return }
      items.forEach((it, i)=>{
        const row = document.createElement('div'); row.className = 'autocomplete-item';
        const imgEl = document.createElement('img'); imgEl.className = 'ac-poster'; imgEl.src = it.poster_url || DEFAULT_POSTER; row.appendChild(imgEl);
        const left = document.createElement('div'); left.className = 'content'; left.style.flex = '1';
        const t = document.createElement('div'); t.className = 'title'; t.textContent = it.title + (it.year ? (' ('+it.year+')') : '');
        if(it.original_title && it.original_title !== it.title){ const orig = document.createElement('div'); orig.className = 'orig-title'; orig.textContent = it.original_title; orig.style.fontSize='12px'; orig.style.color='#6b7280'; t.appendChild(orig); }
        const m = document.createElement('div'); m.className = 'meta'; m.textContent = it.media_type === 'movie' ? 'Película' : 'Serie';
        left.appendChild(t); left.appendChild(m);
        row.appendChild(left);
        row.dataset.index = String(i);
        row.addEventListener('click', ()=> selectIndex(i));
        row.addEventListener('mouseover', ()=> setActive(i));
        list.appendChild(row);
      });
      // position the portal list under the input
      const rect = input.getBoundingClientRect();
      list.style.position = 'absolute';
      list.style.left = (rect.left + window.scrollX) + 'px';
      list.style.top = (rect.bottom + window.scrollY) + 'px';
      list.style.width = rect.width + 'px';
      list.style.display = 'block';
      list.style.zIndex = 2500;
      setActive(0);
      // attach reposition handlers while visible
      if(!list._portalHandlers){
        const position = ()=>{
          const r = input.getBoundingClientRect();
          list.style.left = (r.left + window.scrollX) + 'px';
          list.style.top = (r.bottom + window.scrollY) + 'px';
          list.style.width = r.width + 'px';
        };
        window.addEventListener('scroll', position, true);
        window.addEventListener('resize', position);
        list._portalHandlers = position;
      }
    };

    const doSearch = debounce(async ()=>{ const q = input.value.trim(); if(q.length < 2) return render([]); const fetched = await fetchSuggestions(q); render(fetched); }, 300);

    input.addEventListener('input', ()=>{ idInput && (idInput.value=''); doSearch(); });

    input.addEventListener('keydown', (e)=>{
      if(list.style.display === 'none') return;
      if(e.key === 'ArrowDown'){ e.preventDefault(); const next = Math.min(activeIndex + 1, items.length - 1); setActive(next); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); const prev = Math.max(activeIndex - 1, 0); setActive(prev); }
      else if(e.key === 'Enter'){ if(activeIndex >= 0){ e.preventDefault(); selectIndex(activeIndex); } }
      else if(e.key === 'Escape'){ list.style.display = 'none'; }
    });

    document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target) && !list.contains(e.target)) { list.style.display = 'none'; } });

    // when hiding the list, remove portal handlers
    const observer = new MutationObserver(()=>{
      if(list.style.display === 'none' && list._portalHandlers){
        window.removeEventListener('scroll', list._portalHandlers, true);
        window.removeEventListener('resize', list._portalHandlers);
        list._portalHandlers = null;
      }
    });
    observer.observe(list, { attributes: true, attributeFilter: ['style'] });
  }

  // Edit modal logic
  const editModal = document.getElementById('editModal');
  const editFields = document.getElementById('editFields');
  const saveBtn = document.getElementById('saveEdit');
  const cancelBtn = document.getElementById('cancelEdit');
  let editingId = null;
  function openEdit(id){
    const row = currentRows.find(r=> r.id === id);
    if(!row) return showFloating('error','Registro no encontrado','Error');
    editingId = id;
    // build fields based on type
    editFields.innerHTML = '';
    const fields = (type==='movies') ? ['id','title','quality','language','codec','hash','poster'] : (type==='series' ? ['id','title','poster'] : ['id','title','season','episode','quality','language','codec','hash','poster']);
    for(const f of fields){
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label'); label.textContent = f;

      // For quality/language/codec use selects with common options
      if(f === 'quality' || f === 'language' || f === 'codec'){
        const select = document.createElement('select');
        select.name = f;
        // define common options
        const optionsMap = {
          quality: [
            '1080p WEB-DL',
            '1080p WEB-Rip',
            '1080p Bluray',
            '1080p | WEB-DL | AAC 5.1',
            '1080p | Bluray | AAC',
            '720p WEB-DL',
            '720p WEB-Rip',
            '720p Bluray',
            '720p | WEB-DL | AAC 5.1',
            '720p | Bluray | AAC',
            '480p DVDRip'
          ],
          language: [
            '🇺🇸 English',
            '🇯🇵 Japanese',
            '🇰🇷 Korean',
            '🇨🇳 Chinese',
            '🇮🇩 Indonesian',
            '🇫🇷 French',
            '🇮🇹 Italian',
            '🇩🇪 German'
          ],
          codec: [
            'h264',
            'h265'
          ]
        };
        const opts = optionsMap[f] || [];
        // if current value exists and is not in opts, prepend it so it's selectable
        const current = row[f] || '';
        const normalized = String(current || '').trim();
        if(normalized && !opts.includes(normalized)) opts.unshift(normalized);
        // add a blank/none option at top
        const blank = document.createElement('option'); blank.value = ''; blank.textContent = '-- seleccionar --'; select.appendChild(blank);
        for(const o of opts){ const op = document.createElement('option'); op.value = o; op.textContent = o; if(o === normalized) op.selected = true; select.appendChild(op) }
        if(f === 'id') select.disabled = true;
        wrap.appendChild(label); wrap.appendChild(select);
        editFields.appendChild(wrap);
      } else {
        const input = document.createElement('input'); input.name = f; input.value = row[f] || '';
        if(f==='id') input.readOnly = true;
        wrap.appendChild(label); wrap.appendChild(input);
        editFields.appendChild(wrap);
      }
    }
    // attach imdb autocomplete to edit form (title field)
    attachAutocomplete(document.getElementById('editForm'));
    // attach field listeners to clear validation UI on edit
    adminFieldHelpers && adminFieldHelpers.attachFieldListeners(document.getElementById('editForm'));
    // clear any previous error marks
    adminFieldHelpers && adminFieldHelpers.clearFieldErrors(document.getElementById('editForm'));
    editModal.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
  }

  function closeEditModal(){
    editModal.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
    // cleanup any portal autocomplete list created for the edit form
    try{
      const list = document.body.querySelector('.autocomplete-list[data-for="editForm"]');
      if(list){
        if(list._portalHandlers){ window.removeEventListener('scroll', list._portalHandlers, true); window.removeEventListener('resize', list._portalHandlers); }
        list.remove();
      }
    }catch(e){ /* ignore cleanup errors */ }
  }

  cancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeEditModal(); });

  saveBtn.addEventListener('click', async (e)=>{
    e.preventDefault();
    const formEl = document.getElementById('editForm');
    const f = new FormData(formEl);
    const body = {}; for(const [k,v] of f.entries()) body[k]=v;

    // run validation using shared validators
    const validator = (type === 'movies') ? (window.adminValidators && window.adminValidators.validateMovie) : (type === 'series' ? (window.adminValidators && window.adminValidators.validateSeries) : (window.adminValidators && window.adminValidators.validateEpisode));
    if(validator){
      const { errors, warnings } = validator(body);
      // clear previous
      adminFieldHelpers && adminFieldHelpers.clearFieldErrors(formEl);
      if(errors && errors.length){
        for(const msg of errors){
          const m = msg.match(/\"([^\"]+)\"/g);
          if(m){ for(const g of m){ const name = g.replace(/\"/g,''); adminFieldHelpers && adminFieldHelpers.markFieldError(formEl, name, msg); } }
        }
        const first = formEl.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea'); if(first) first.focus();
        return;
      }
      if(warnings && warnings.length){ showFloating('warning', warnings.join('\n'), 'Advertencia'); }
    }

    // show visual confirm modal
    const ok = await (window.showConfirm ? window.showConfirm(body) : Promise.resolve(confirm('Confirmar cambios')));
    if(!ok) return showFloating('info','Edición cancelada','Info');

    try{
      const url = `/admin/db/${type}/${encodeURIComponent(editingId)}`;
      const res = await fetch(url, { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, headers()), body: JSON.stringify(body) });
      let j = null; try{ j = await res.json() }catch(e){}
      if(!res.ok){
        let serverMsg = j && (j.error||j.message) ? (j.error||j.message) : res.statusText;
        if(/duplicate key value/i.test(serverMsg) || /unique constraint/i.test(serverMsg)) serverMsg = 'Ya existe un registro con ese ID en la base de datos.';
        showFloating('error', `Error ${res.status} - ${serverMsg}`, 'Error');
        return;
      }
      showFloating('success', 'Guardado correctamente', 'Éxito');
      // close and cleanup modal state
      closeEditModal();
      fetchPage();
    }catch(err){ showFloating('error', err.message, 'Network error') }
  });

  // delete with confirm
  async function confirmDelete(id){
    // pass the full record to the confirm modal so details can show id, poster, etc.
    const row = currentRows.find(r=> r.id === id) || { id };
    const ok = await (window.showConfirm ? window.showConfirm(Object.assign({ action: 'delete' }, row)) : Promise.resolve(confirm('¿Eliminar este registro?')));
    if(!ok) return;
    try{
      const url = `/admin/db/${type}/${encodeURIComponent(id)}`;
      const res = await fetch(url, { method:'DELETE', headers: headers() });
      let j = null; try{ j = await res.json() }catch(e){}
      if(!res.ok){ let serverMsg = j && (j.error||j.message) ? (j.error||j.message) : res.statusText; showFloating('error', `Error ${res.status} - ${serverMsg}`, 'Error'); return; }
      showFloating('success', 'Eliminado correctamente', 'OK');
      fetchPage();
    }catch(err){ showFloating('error', err.message, 'Network error') }
  }

  // initial load
  fetchPage();
})();
