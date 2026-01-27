// Shared admin helpers: validators, field helpers and confirm modal
(function(){
  function validateMovie(body){
    const errors = [], warnings = [];
    const required = ['id','title','quality','language','codec','hash','poster'];
    for(const k of required) if(!body[k] || String(body[k]).trim() === '') errors.push(`El campo "${k}" es obligatorio.`);
    if(body.id && !/^tt\d+$/.test(body.id)) errors.push('El campo "id" debe tener formato tt seguido de dígitos (ej: tt1234567).');
    if(body.hash){
      if(!/^[0-9a-fA-F]{40}$/.test(body.hash) && !/^[0-9a-fA-F]{64}$/.test(body.hash)){
        errors.push('El campo "hash" debe ser un valor hexadecimal de 40 (SHA1) o 64 (SHA256) caracteres.');
      }
    }
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
    const required = ['id','title','season','episode','hash','poster'];
    for(const k of required) if(!body[k] || String(body[k]).trim() === '') errors.push(`El campo "${k}" es obligatorio.`);
    if(body.id && !/^.+:\\d+:\\d+$/.test(body.id)) errors.push('El campo "id" debe tener formato seriesId:season:episode (ej: tt1234567:1:2).');
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

  function clearFieldErrors(scope){
    const root = scope || document;
    Array.from(root.querySelectorAll('.field.invalid')).forEach(f=>{
      f.classList.remove('invalid');
      const e = f.querySelector('.error-text'); if(e) e.remove();
    });
  }

  function markFieldError(scope, fieldName, message){
    const root = scope || document;
    const ctrl = root.querySelector('[name="'+fieldName+'"]');
    if(!ctrl) return;
    const field = ctrl.closest('.field'); if(!field) return;
    field.classList.add('invalid');
    if(!field.querySelector('.error-text')){
      const span = document.createElement('span'); span.className='error-text'; span.textContent = message; field.appendChild(span);
    }
  }

  function attachFieldListeners(form){
    if(!form) return;
    const controls = Array.from(form.querySelectorAll('input,select,textarea'));
    controls.forEach(ctrl => {
      const clear = ()=>{
        const f = ctrl.closest('.field'); if(!f) return;
        if(f.classList.contains('invalid')){ f.classList.remove('invalid'); const e = f.querySelector('.error-text'); if(e) e.remove(); }
      };
      ctrl.addEventListener('input', clear, {passive:true});
      ctrl.addEventListener('change', clear, {passive:true});
    });
  }

  // Confirm modal helper. If DOM has #confirmModal it will be used, otherwise we create one.
  function ensureConfirmModal(){
    if(document.getElementById('confirmModal')) return document.getElementById('confirmModal');
    const wrapper = document.createElement('div'); wrapper.id = 'confirmModal'; wrapper.className = 'modal-backdrop'; wrapper.setAttribute('aria-hidden','true');
    wrapper.innerHTML = `
      <div class="modal confirm-modal">
        <div class="modal-header" id="confirmTitle">Confirmar</div>
        <div class="modal-body">
          <div id="confirmSummary" style="margin-bottom:10px;color:#111"></div>
          <div id="confirmBody" class="confirm-pre" style="display:none;max-height:36vh;overflow:auto;padding:12px;background:#0b1220;border-radius:6px;color:var(--fg-light)"></div>
          <div><a href="#" id="confirmToggleDetails" style="font-size:13px;color:#6b7280">Mostrar detalles</a></div>
        </div>
        <div class="modal-actions"><button id="confirmYes" class="btn primary">Aceptar</button><button id="confirmNo" class="btn">Cancelar</button></div>
      </div>`;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function showConfirm(body){
    return new Promise((resolve)=>{
      const wrapper = ensureConfirmModal();
      const pre = wrapper.querySelector('#confirmBody');
      const summary = wrapper.querySelector('#confirmSummary');
      const toggle = wrapper.querySelector('#confirmToggleDetails');
      const yes = wrapper.querySelector('#confirmYes');
      const no = wrapper.querySelector('#confirmNo');
      if(!wrapper || !pre || !yes || !no || !summary || !toggle){ const ok = confirm('Confirmar: ' + JSON.stringify(body,null,2)); return resolve(!!ok); }

      // Friendly summary for common actions
      let titleText = 'Confirmar';
      let summaryText = '';
      if(body && body.action === 'delete'){
        titleText = 'Eliminar registro';
        const id = body.id || body._id || body.movie || body.episode || '';
        summaryText = 'Vas a eliminar el registro' + (id ? ` con id: ${id}` : '') + '. Esta acción es irreversible.';
        // make yes button visually dangerous
        yes.classList.add('danger');
      } else if(body && body.action === 'update'){
        titleText = 'Confirmar cambios';
        summaryText = 'Vas a aplicar los siguientes cambios:';
        yes.classList.remove('danger');
      } else {
        titleText = 'Confirmar acción';
        summaryText = 'Por favor confirma la siguiente acción.';
        yes.classList.remove('danger');
      }

      wrapper.querySelector('#confirmTitle').textContent = titleText;
      summary.textContent = summaryText;

      // Lightweight syntax highlighting for JSON details
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
      pre.style.display = 'none';
      toggle.textContent = 'Mostrar detalles';
      wrapper.setAttribute('aria-hidden','false');

      function cleanup(result){ wrapper.setAttribute('aria-hidden','true'); yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); toggle.removeEventListener('click', onToggle); window.removeEventListener('keydown', onKey); resolve(result); }
      function onYes(e){ e.preventDefault(); cleanup(true); }
      function onNo(e){ e.preventDefault(); cleanup(false); }
      function onToggle(e){ e.preventDefault(); if(pre.style.display === 'none'){ pre.style.display = 'block'; toggle.textContent = 'Ocultar detalles'; } else { pre.style.display = 'none'; toggle.textContent = 'Mostrar detalles'; } }
      function onKey(e){ if(e.key === 'Escape') { cleanup(false); } }
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      toggle.addEventListener('click', onToggle);
      window.addEventListener('keydown', onKey);
    });
  }

  // expose
  window.adminValidators = { validateMovie, validateSeries, validateEpisode };
  window.adminFieldHelpers = { clearFieldErrors, markFieldError, attachFieldListeners };
  window.showConfirm = showConfirm;
})();
