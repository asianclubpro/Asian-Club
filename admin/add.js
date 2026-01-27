(function(){
  const out = document.getElementById('out');
  if(out) out.style.display = 'none';
  const msgArea = document.getElementById('msgArea');
  // token input removed; we rely on localStorage.admin_token populated at login

  function prependOut(text){ out.textContent = String(text) + '\n' + out.textContent }



  // validation messages are shown inline via per-field styles; no global toast needed

  // create a floating modal-like notification (kept for server responses and success)
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function showMessage(type, text, title){
    // remove existing floating message if present
    const existing = document.getElementById('floatingMsg');
    if(existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'floatingMsg';
    el.className = 'floatingMsg ' + (type || 'info');
    const headerTitle = title || (type === 'error' ? 'Error' : type === 'success' ? 'Éxito' : (type === 'warning' ? 'Aviso' : 'Info'));
    el.innerHTML = `
      <div class="fm-header">
        <div class="fm-title">${escapeHtml(headerTitle)}</div>
      </div>
      <div class="fm-body"><pre>${escapeHtml(text)}</pre></div>
    `;
    document.body.appendChild(el);
    // play entrance animation
    requestAnimationFrame(()=> el.classList.add('enter'));
    // auto-remove after timeout with exit animation
    const displayMs = 6000;
    const exitMs = 160;
    setTimeout(()=>{
      el.classList.remove('enter');
      el.classList.add('leave');
      setTimeout(()=>{ const f = document.getElementById('floatingMsg'); if(f) f.remove(); }, exitMs);
    }, displayMs);
    prependOut((type||'info').toUpperCase()+': '+text);
  }

  function log(...args){ prependOut(args.map(a=> typeof a === 'object' ? JSON.stringify(a,null,2) : String(a)).join('\n')) }

  function headers(){ return { 'x-admin-token': (localStorage.getItem('admin_token') || '') }}

  // Tabs: simple tab switching and persistence
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  function showTab(name){
    tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p=>{
      const id = p.id.replace('panel-','');
      const shown = id === name;
      p.setAttribute('aria-hidden', shown ? 'false' : 'true');
    });
    localStorage.setItem('admin_tab', name);
  }
  tabs.forEach(t=> t.addEventListener('click', ()=> showTab(t.dataset.tab)));
  // initial tab
  const savedTab = localStorage.getItem('admin_tab') || 'movie';
  if(tabs.length) showTab(savedTab);

  function validateMovie(body){
    const errors = [], warnings = [];
    // require all fields non-empty
    const required = ['id','title','quality','language','codec','hash','poster'];
    for(const k of required) if(!body[k] || String(body[k]).trim() === '') errors.push(`El campo "${k}" es obligatorio.`);

    // id format
    if(body.id && !/^tt\d+$/.test(body.id)) errors.push('El campo "id" debe tener formato tt seguido de dígitos (ej: tt1234567).');

    // hash must be hex (SHA1 or SHA256) — accept 40 or 64 hex chars
    if(body.hash){
      if(!/^[0-9a-fA-F]{40}$/.test(body.hash) && !/^[0-9a-fA-F]{64}$/.test(body.hash)){
        errors.push('El campo "hash" debe ser un valor hexadecimal de 40 (SHA1) o 64 (SHA256) caracteres.');
      }
    }

    // poster must be an http(s) url
    if(body.poster && !/^https?:\/\/.+/i.test(body.poster)) errors.push('El campo "poster" debe ser una URL válida que empiece por http o https.');

    return { errors, warnings };
  }

  function validateSeries(body){
    const errors = [], warnings = [];
    const required = ['id','title','poster'];
    for(const k of required) if(!body[k] || String(body[k]).trim() === '') errors.push(`El campo "${k}" es obligatorio.`);
    if(body.id && !/^tt\d+$/.test(body.id)) errors.push('El campo "id" debe tener formato tt seguido de dígitos (ej: tt1234567).');
    if(body.poster && !/^https?:\/\/.+/i.test(body.poster)) errors.push('El campo "poster" debe ser una URL válida que empiece por http o https.');
    return { errors, warnings };
  }

  function validateEpisode(body){
    const errors = [], warnings = [];
    // require all fields
    const required = ['id','title','season','episode','hash','poster'];
    for(const k of required) if(!body[k] || String(body[k]).trim() === '') errors.push(`El campo "${k}" es obligatorio.`);

    // id format: allow seriesId:season:episode or tt...:s:e
    if(body.id && !/^.+:\d+:\d+$/.test(body.id)) errors.push('El campo "id" debe tener formato seriesId:season:episode (ej: tt1234567:1:2).');
    if(body.season && isNaN(Number(body.season))) errors.push('Season debe ser un número.');
    if(body.episode && isNaN(Number(body.episode))) errors.push('Episode debe ser un número.');
    if(body.hash){
      if(!/^[0-9a-fA-F]{40}$/.test(body.hash) && !/^[0-9a-fA-F]{64}$/.test(body.hash)){
        errors.push('El campo "hash" debe ser un valor hexadecimal de 40 o 64 caracteres.');
      }
    }
    if(body.poster && !/^https?:\/\/.+/i.test(body.poster)) errors.push('El campo "poster" debe ser una URL válida que empiece por http o https.');
    return { errors, warnings };
  }

  // highlight individual fields on validation errors
  function clearFieldErrors(form){
    Array.from(form.querySelectorAll('.field.invalid')).forEach(f=>{
      f.classList.remove('invalid');
      const e = f.querySelector('.error-text'); if(e) e.remove();
    });
  }

  function markFieldError(form, fieldName, message){
    const ctrl = form.querySelector('[name="'+fieldName+'"]');
    if(!ctrl) return;
    const field = ctrl.closest('.field');
    if(!field) return;
    field.classList.add('invalid');
    // append error message if not present
    if(!field.querySelector('.error-text')){
      const span = document.createElement('span');
      span.className = 'error-text';
      span.textContent = message;
      field.appendChild(span);
    }
  }

  // attach handlers that clear field-level errors when user edits the input
  function attachFieldListeners(form){
    if(!form) return;
    const controls = Array.from(form.querySelectorAll('input,select,textarea'));
    controls.forEach(ctrl => {
      const clear = ()=>{
        const f = ctrl.closest('.field');
        if(!f) return;
        if(f.classList.contains('invalid')){
          f.classList.remove('invalid');
          const e = f.querySelector('.error-text'); if(e) e.remove();
        }
      };
      ctrl.addEventListener('input', clear, {passive:true});
      ctrl.addEventListener('change', clear, {passive:true});
    });
  }

  async function sendWithConfirm(url, body, validator, form){
    const { errors, warnings } = validator(body);
    clearFieldErrors(form || document);
    if(errors.length){
      // try to highlight fields mentioned in error messages (they include "field" names in quotes)
      for(const msg of errors){
        const m = msg.match(/"([^"]+)"/g);
        if(m){
          for(const g of m){
            const name = g.replace(/"/g,'');
            markFieldError(form || document, name, msg);
          }
        }
      }
      // validation errors shown inline (per-field); log for debugging
      prependOut('VALIDATION ERROR: ' + errors.join('\n'));
      // focus first invalid
      const first = (form || document).querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
      if(first) first.focus();
      return;
    }
    if(warnings.length){ prependOut('VALIDATION WARNING: ' + warnings.join('\n')); }

    // show confirmation modal with filled fields
    const ok = await showConfirm(body);
    if(!ok){ showMessage('info', 'Creación cancelada por el usuario.'); return; }

    try{
      const r = await fetch(url, { method:'POST', headers: Object.assign({'Content-Type':'application/json'}, headers()), body: JSON.stringify(body) });
      let j = null;
      try{ j = await r.json() }catch(e){}
      if(!r.ok){
        if(r.status === 401) {
          showMessage('error', '401 Unauthorized — revisa tu `x-admin-token` (campo token).', `Error ${r.status}`);
        } else {
          // normalize common DB/server messages into friendlier text
          let serverMsg = j && (j.error || j.message) ? (j.error || j.message) : r.statusText;
          if(/duplicate key value/i.test(serverMsg) || /unique constraint/i.test(serverMsg)){
            // Friendly message for duplicate primary key (already exists)
            serverMsg = 'Ya existe un registro con ese ID en la base de datos. (El contenido ya fue agregado)';
          }
          showMessage('error', `Error ${r.status} - ${serverMsg}`, `Error ${r.status}`);
        }
        log('request failed', url, r.status, j);
        return;
      }
      showMessage('success', 'Creado correctamente.', 'Éxito');
      log('created', url, r.status, j);
      return j;
    }catch(err){
      showMessage('error', 'Error de red: '+err.message);
      log('network error', err.message);
    }
  }

  // Modal helper: returns Promise<boolean>
  function showConfirm(body){
    return new Promise((resolve)=>{
      const wrapper = document.getElementById('confirmModal');
      const pre = document.getElementById('confirmBody');
      const toggle = document.getElementById('confirmToggleDetails');
      const yes = document.getElementById('confirmYes');
      const no = document.getElementById('confirmNo');
      if(!wrapper || !pre || !yes || !no){
        // fallback to native confirm
        const ok = confirm('Confirmar envío con estos datos:\n\n' + JSON.stringify(body, null, 2));
        return resolve(!!ok);
      }
      // Lightweight syntax highlighting (same logic as shared modal)
      function highlightJSON(obj){
        const s = JSON.stringify(obj, null, 2)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return s.replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?)|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[\{\}\[\]:,]/g, function (match){
          let cls = 'number';
          if(/^[\{\}\[\]:,]$/.test(match)){
            cls = 'punct';
          } else if(/^\"/.test(match)){
            cls = /:$/.test(match) ? 'key' : 'string';
          } else if(/true|false/.test(match)){
            cls = 'boolean';
          } else if(/null/.test(match)){
            cls = 'null';
          }
          return '<span class="json-' + cls + '">' + match + '</span>';
        });
      }

      pre.innerHTML = '<pre style="margin:0"><code>' + highlightJSON(body) + '</code></pre>';
      // Show details by default in the add modal and hide the toggle link
      pre.style.display = 'block';
      if(toggle) { toggle.style.display = 'none'; }
      wrapper.setAttribute('aria-hidden','false');

      function cleanup(result){
        wrapper.setAttribute('aria-hidden','true');
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        if(toggle) toggle.removeEventListener('click', onToggle);
        resolve(result);
      }
      function onYes(e){ e.preventDefault(); cleanup(true); }
      function onNo(e){ e.preventDefault(); cleanup(false); }
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      function onToggle(e){ e.preventDefault(); if(pre.style.display === 'none'){ pre.style.display = 'block'; if(toggle) toggle.textContent = 'Ocultar detalles'; } else { pre.style.display = 'none'; if(toggle) toggle.textContent = 'Mostrar detalles'; } }
      if(toggle) toggle.addEventListener('click', onToggle);

      // close on ESC
      function onKey(e){ if(e.key === 'Escape') { cleanup(false); window.removeEventListener('keydown', onKey); } }
      window.addEventListener('keydown', onKey);
    });
  }

  document.getElementById('movieForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {};
    for(const [k,v] of f.entries()) if(v) body[k]=v;
    const res = await sendWithConfirm('/admin/db/movies', body, validateMovie, e.target);
    if(res) e.target.reset();
  });

  document.getElementById('seriesForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {};
    for(const [k,v] of f.entries()) if(v) body[k]=v;
    const res = await sendWithConfirm('/admin/db/series', body, validateSeries, e.target);
    if(res) e.target.reset();
  });

  document.getElementById('episodeForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {};
    for(const [k,v] of f.entries()) if(v) body[k]=v;
    const res = await sendWithConfirm('/admin/db/episodes', body, validateEpisode, e.target);
    if(res) e.target.reset();
  });

  // attach clear-on-edit listeners to all forms
  attachFieldListeners(document.getElementById('movieForm'));
  attachFieldListeners(document.getElementById('seriesForm'));
  attachFieldListeners(document.getElementById('episodeForm'));

  // Autocomplete for title using /admin/imdb/search?q=
  function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), wait); }; }

  function createDropdown(root){
    let wrap = root.querySelector('.autocomplete');
    if(!wrap){ wrap = document.createElement('div'); wrap.className = 'autocomplete';
      const input = root.querySelector('input[name="title"]');
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    let list = wrap.querySelector('.autocomplete-list');
    if(!list){ list = document.createElement('div'); list.className = 'autocomplete-list'; wrap.appendChild(list); }
    return { wrap, list };
  }

  async function fetchSuggestions(q){
    if(!q || q.trim().length < 2) return [];
    try{
      const res = await fetch('/admin/imdb/search?q=' + encodeURIComponent(q));
      if(!res.ok) return [];
      const j = await res.json();
      return (j.results || []).slice(0,8);
    }catch(e){ return []; }
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
      // Put title and year into the title field
      input.value = it.title + (it.year ? (' (' + it.year + ')') : '');
      if(it.imdb_id) idInput.value = it.imdb_id;
      // fill poster field when available, otherwise clear it
      if(posterInput){
        if(it.poster_url) posterInput.value = it.poster_url; else posterInput.value = '';
      }
      list.style.display = 'none';
      items = [];
      activeIndex = -1;
    };

    const render = (newItems)=>{
      items = newItems || [];
      list.innerHTML = '';
      if(!items || items.length === 0){ list.style.display = 'none'; activeIndex = -1; return }
      items.forEach((it, i)=>{
        const row = document.createElement('div'); row.className = 'autocomplete-item';
        const imgEl = document.createElement('img'); imgEl.className = 'ac-poster';
        imgEl.src = it.poster_url || DEFAULT_POSTER;
        row.appendChild(imgEl);
        const left = document.createElement('div'); left.className = 'content'; left.style.flex = '1';
        const t = document.createElement('div'); t.className = 'title'; t.textContent = it.title + (it.year ? (' ('+it.year+')') : '');
        // show original title when different
        if(it.original_title && it.original_title !== it.title){
          const orig = document.createElement('div'); orig.className = 'orig-title'; orig.textContent = it.original_title; orig.style.fontSize='12px'; orig.style.color='#6b7280';
          t.appendChild(orig);
        }
        const m = document.createElement('div'); m.className = 'meta'; m.textContent = it.media_type === 'movie' ? 'Película' : 'Serie';
        left.appendChild(t); left.appendChild(m);
        row.appendChild(left);
        row.dataset.index = String(i);
        row.addEventListener('click', ()=> selectIndex(i));
        row.addEventListener('mouseover', ()=> setActive(i));
        list.appendChild(row);
      });
      list.style.display = 'block';
      setActive(0);
    };

    const doSearch = debounce(async ()=>{
      const q = input.value.trim();
      if(q.length < 2) return render([]);
      const fetched = await fetchSuggestions(q);
      render(fetched);
    }, 300);

    input.addEventListener('input', ()=>{ idInput && (idInput.value=''); doSearch(); });

    input.addEventListener('keydown', (e)=>{
      if(list.style.display === 'none') return;
      if(e.key === 'ArrowDown'){
        e.preventDefault();
        const next = Math.min(activeIndex + 1, items.length - 1);
        setActive(next);
      } else if(e.key === 'ArrowUp'){
        e.preventDefault();
        const prev = Math.max(activeIndex - 1, 0);
        setActive(prev);
      } else if(e.key === 'Enter'){
        if(activeIndex >= 0){ e.preventDefault(); selectIndex(activeIndex); }
      } else if(e.key === 'Escape'){
        list.style.display = 'none';
      }
    });

    document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target)) list.style.display = 'none'; });
  }

  attachAutocomplete(document.getElementById('movieForm'));
  attachAutocomplete(document.getElementById('seriesForm'));
})();