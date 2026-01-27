(function(){
  const latestGrid = document.getElementById('latestGrid');
  const generateBtn = document.getElementById('generateBtn');
  const tokenInput = document.getElementById('token');
  const panelArea = document.getElementById('manifestPanelArea');
  const openCatalogBtn = document.getElementById('openCatalogBtn');
  const serviceSelect = document.getElementById('service');

  async function fetchCatalogs(){
    try{
      const [mRes, sRes] = await Promise.all([
        fetch('/catalog/movie/asianclub_movies.json'),
        fetch('/catalog/series/asianclub_series.json')
      ]);
      const mJson = mRes.ok ? await mRes.json() : { metas: [] };
      const sJson = sRes.ok ? await sRes.json() : { metas: [] };
      const movies = mJson.metas || [];
      const series = sJson.metas || [];
      // combine, prefer movies first (keep order as provided by server)
      const combined = movies.concat(series).slice(0,20);
      return combined;
    }catch(e){ console.warn('Error fetching catalogs', e); return [] }
  }

  function showLoadingSkeletons(count = 6){
    // put skeleton items directly into latestGrid (avoid nested grids)
    latestGrid.className = 'skeleton-grid';
    latestGrid.innerHTML = '';
    for(let i=0;i<count;i++){
      const s = document.createElement('div'); s.className = 'skeleton-item';
      const poster = document.createElement('div'); poster.className = 'skeleton-poster';
      const badge = document.createElement('div'); badge.className = 'skeleton-badge';
      const titleBar = document.createElement('div'); titleBar.className = 'titleBar';
      const line1 = document.createElement('div'); line1.className = 'skeleton-line short';
      const line2 = document.createElement('div'); line2.className = 'skeleton-line';
      titleBar.appendChild(line1); titleBar.appendChild(line2);
      s.appendChild(poster); s.appendChild(badge); s.appendChild(titleBar);
      latestGrid.appendChild(s);
    }
  }

  function renderItems(items){
    // restore normal grid layout
    latestGrid.className = 'home-grid';
    latestGrid.innerHTML = '';
    if(!items || items.length === 0){ latestGrid.textContent = 'No items'; return }
    for(const it of items){
      const d = document.createElement('div'); d.className = 'home-item';
      const posterWrap = document.createElement('div'); posterWrap.className = 'posterWrap';
      const img = document.createElement('img'); img.src = it.poster || '/admin/no-image.svg'; img.alt = it.name || it.id || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      posterWrap.appendChild(img);
      d.appendChild(posterWrap);

      // badge showing type
      const badge = document.createElement('span'); badge.className = 'badge';
      const kind = (it.type || it.media_type || '').toString().toLowerCase().includes('series') ? 'Series' : 'Movie';
      badge.textContent = kind;
      d.appendChild(badge);

      // title overlay
      const titleBar = document.createElement('div'); titleBar.className = 'titleBar';
      const title = document.createElement('div'); title.className = 'title'; title.textContent = it.name || it.title || '';
      titleBar.appendChild(title);
      d.appendChild(titleBar);

      latestGrid.appendChild(d);
    }

    // animate entrance: add 'visible' class in a staggered fashion
    const nodes = Array.from(latestGrid.querySelectorAll('.home-item'));
    nodes.forEach((n, idx) => {
      // small stagger per item (slightly slower)
      setTimeout(() => n.classList.add('visible'), idx * 90);
    });
  }

  async function init(){
    showLoadingSkeletons(6);
    const items = await fetchCatalogs();
    renderItems(items);
    // ensure token input is empty (do not persist sensitive tokens)
    try{ if(tokenInput) tokenInput.value = ''; }catch(e){}
    // attach admin field listeners so validation UI clears when typing
    try{ window.adminFieldHelpers && window.adminFieldHelpers.attachFieldListeners(document.getElementById('manifestForm')); }catch(e){}
    updateGenerateState();
  }

  generateBtn.addEventListener('click', (e)=>{
    e.preventDefault();
    const token = tokenInput ? tokenInput.value.trim() : '';
    if(!token){ showInlineError('Enter a valid token'); tokenInput && tokenInput.focus(); updateGenerateState(); return }
    const service = (serviceSelect && serviceSelect.value) ? serviceSelect.value : 'realdebrid';
    const url = `${location.origin}/${service}=${encodeURIComponent(token)}/manifest.json`;
    // validate token format: basic check (>=10 chars, allowed characters)
    const valid = /^[A-Za-z0-9_\-]{10,}$/.test(token);
    if(!valid){
      // use admin field helpers if available to mark the field
      try{ window.adminFieldHelpers && window.adminFieldHelpers.markFieldError(document.getElementById('manifestForm'), 'token', 'Invalid token'); }catch(e){}
      showInlineError('Invalid token format');
      tokenInput && tokenInput.focus();
      return;
    }
    renderReadyPanel(url);
  });

  // open catalog button remains
  if(openCatalogBtn){
    openCatalogBtn.addEventListener('click', ()=>{
      const token = tokenInput ? tokenInput.value.trim() : '';
      const service = (serviceSelect && serviceSelect.value) ? serviceSelect.value : 'realdebrid';
      const url = token ? `${location.origin}/${service}=${encodeURIComponent(token)}/catalog/movie/asianclub_movies.json` : `${location.origin}/catalog/movie/asianclub_movies.json`;
      window.open(url, '_blank');
    });
  }

  function showInlineError(msg){
    panelArea.innerHTML = `<div class="manifest-status" style="color:#ffb4b4">${msg}</div>`;
  }

  function renderReadyPanel(url){
    panelArea.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'manifest-ready';
    const title = document.createElement('div'); title.className = 'mr-title'; title.textContent = 'Addon ready';
    const sub = document.createElement('div'); sub.className = 'mr-sub'; sub.textContent = 'URL hidden for security';
    const actions = document.createElement('div'); actions.className = 'mr-actions';

    const copyBtn = document.createElement('button'); copyBtn.className = 'btn copy'; copyBtn.textContent = 'Copy link';
    copyBtn.addEventListener('click', ()=>{
      navigator.clipboard && navigator.clipboard.writeText(url).then(()=>{ copyBtn.textContent = 'Copied'; setTimeout(()=> copyBtn.textContent = 'Copy link', 1400); }).catch(()=> alert('Could not copy'));
    });

    const openBtn = document.createElement('button'); openBtn.className = 'btn open'; openBtn.textContent = 'Open in Stremio';
    openBtn.addEventListener('click', ()=>{ window.open(url, '_blank'); });

    actions.appendChild(copyBtn); actions.appendChild(openBtn);
    const note = document.createElement('div'); note.className = 'mr-note'; note.textContent = '';

    wrap.appendChild(title); wrap.appendChild(sub); wrap.appendChild(actions); wrap.appendChild(note);
    panelArea.appendChild(wrap);
  }

  function updateGenerateState(){
    const token = tokenInput.value.trim();
    if(!token){ generateBtn.setAttribute('disabled',''); }
    else{ generateBtn.removeAttribute('disabled'); panelArea.innerHTML = ''; }
  }

  tokenInput && tokenInput.addEventListener('input', ()=> updateGenerateState());
  serviceSelect && serviceSelect.addEventListener('change', ()=> updateGenerateState());

  init();
})();