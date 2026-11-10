/* ludi-group-3.js — pannello laterale a viste: Aggiungi assegnatari / Modifica dati / Note ed Email / Limite pass + colonna Tipo.
   SOSTITUISCE la versione precedente di ludi-group-3.js */
(function(){
  var pane = document.getElementById('tab-pass');
  if(!pane || pane.getAttribute('data-lg3')) return;
  var head = pane.querySelector('.lg-listhead');
  if(!head) return;

  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  function svg(p){ return '<svg viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>'; }
  var ICONS = {
    add:'<path d="M12 5v14M5 12h14"/>',
    edit:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    notes:'<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h4"/>',
    limit:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>'
  };
  var DEFS = [
    {key:'add',   re:/aggiungi assegnatari/i, title:'Aggiungi assegnatari'},
    {key:'edit',  re:/modifica dati/i,        title:'Modifica dati gruppo'},
    {key:'notes', re:/note ed email/i,        title:'Note ed Email'},
    {key:'limit', re:/limite massimo/i,       title:'Limite massimo pass'}
  ];

  /* Raccolgo le sezioni esistenti */
  var found = {};
  [].forEach.call(pane.querySelectorAll(':scope > details'), function(d){
    var s = d.querySelector('summary'), c = d.querySelector(':scope > .card');
    if(!s || !c) return;
    DEFS.forEach(function(df){ if(!found[df.key] && df.re.test(s.textContent)) found[df.key] = {def:df, details:d, card:c}; });
  });
  var keys = DEFS.filter(function(df){ return found[df.key]; }).map(function(df){ return df.key; });
  if(!keys.length) return;
  pane.setAttribute('data-lg3','1');

  var mq = window.matchMedia('(min-width:1280px)');

  /* Struttura a due colonne */
  var split = el('div','lg-split');
  head.parentNode.insertBefore(split, head);
  var mainCol = el('div','lg-main'); split.appendChild(mainCol);
  mainCol.appendChild(head);
  var form = pane.querySelector('form[action="/passes/bulk"]');
  if(form) mainCol.appendChild(form);
  [].forEach.call(pane.querySelectorAll(':scope > .alert-info'), function(a){
    if(/nessun nominativo/i.test(a.textContent)) mainCol.appendChild(a);
  });
  var note = pane.querySelector(':scope > .lg-batchnote');
  if(note) mainCol.appendChild(note);

  /* Pannello con una vista per sezione (contenuti spostati, non copiati) */
  var dr = el('aside','lg-drawer'); dr.id = 'lg-drawer';
  var hd = el('div','lg-drawer-head');
  var dico = el('span','lg-dico'); hd.appendChild(dico);
  var dtitle = el('h3'); hd.appendChild(dtitle);
  var x = el('button','lg-drawer-x','×'); x.type = 'button'; x.setAttribute('aria-label','Chiudi'); hd.appendChild(x);
  var body = el('div','lg-drawer-body');
  var views = {};
  keys.forEach(function(k){
    var v = el('div','lg-view'); v.setAttribute('data-view',k);
    while(found[k].card.firstChild) v.appendChild(found[k].card.firstChild);
    body.appendChild(v); views[k] = v;
    found[k].details.classList.add('lg-hide');
  });
  dr.appendChild(hd); dr.appendChild(body); split.appendChild(dr);
  var backdrop = el('div','lg-backdrop'); document.body.appendChild(backdrop);

  /* Pulsante "Aggiungi assegnatari" nell'intestazione elenco */
  var addBtn = null;
  if(views.add){
    addBtn = el('button','lg-addbtn'); addBtn.type = 'button'; addBtn.setAttribute('aria-pressed','false');
    addBtn.innerHTML = svg(ICONS.add) + '<span>Aggiungi assegnatari</span>';
    addBtn.firstChild.style.cssText = 'width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round';
    head.insertBefore(addBtn, head.querySelector('button[onclick*="imp-modal"]') || null);
  }

  /* Pulsanti della testata: rimpiazzo con cloni per togliere il vecchio comportamento */
  var heroBtns = {};
  [].forEach.call(document.querySelectorAll('#lg-hero .lg-actions .lg-btn'), function(b){
    var t = b.textContent.toLowerCase(), k = /modifica dati/.test(t) ? 'edit' : /note/.test(t) ? 'notes' : /limite/.test(t) ? 'limit' : null;
    if(!k || !views[k]) return;
    var c = b.cloneNode(true); b.parentNode.replaceChild(c, b);
    c.addEventListener('click', function(){ toggle(k); });
    heroBtns[k] = c;
  });

  var cur = null;
  function ensurePassTab(){
    if(!pane.classList.contains('active') && typeof window.crmTab === 'function'){
      window.crmTab('pass', document.querySelector('#crm-tab-nav [data-tab="pass"]'));
    }
  }
  function render(){
    var open = !!cur;
    split.classList.toggle('lg-open', open);
    keys.forEach(function(k){ views[k].classList.toggle('on', k === cur); });
    if(cur){ dico.innerHTML = svg(ICONS[cur]); dtitle.textContent = found[cur].def.title; }
    if(addBtn) addBtn.setAttribute('aria-pressed', cur === 'add' ? 'true' : 'false');
    Object.keys(heroBtns).forEach(function(k){ heroBtns[k].classList.toggle('on', k === cur); });
    backdrop.classList.toggle('on', open && !mq.matches);
    document.body.style.overflow = (open && !mq.matches) ? 'hidden' : '';
  }
  function open(k){
    ensurePassTab(); cur = k; render();
    if(k === 'add'){ try{ localStorage.setItem('lg-drawer','1'); }catch(e){} }
    if(!mq.matches){
      var f = views[k].querySelector('textarea, input:not([type=hidden]), select');
      if(f) setTimeout(function(){ f.focus(); }, 280);
    }
  }
  function close(){
    if(cur === 'add'){ try{ localStorage.setItem('lg-drawer','0'); }catch(e){} }
    cur = null; render();
  }
  function toggle(k){ if(cur === k) close(); else open(k); }

  function init(){
    var pref = null; try{ pref = localStorage.getItem('lg-drawer'); }catch(e){}
    cur = (mq.matches && views.add && pref !== '0') ? 'add' : null;
    render();
  }

  if(addBtn) addBtn.addEventListener('click', function(){ toggle('add'); });
  x.addEventListener('click', close);
  backdrop.addEventListener('click', function(){ cur = null; render(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && cur && !mq.matches){ cur = null; render(); } });
  if(mq.addEventListener) mq.addEventListener('change', init); else if(mq.addListener) mq.addListener(init);
  init();
})();

/* Colonna "Tipo": tipologia del pass effettivamente generato (da /assignment-groups/:id/pass-types) */
(function(){
  var chk = document.getElementById('chk-all');
  var table = chk ? chk.closest('table') : null;
  var m = location.pathname.match(/assignment-groups\/(\d+)/);
  if(!table || !m || table.getAttribute('data-lg-tipo')) return;
  var ths = [].slice.call(table.tHead.rows[0].cells);
  var heads = ths.map(function(t){ return t.textContent.trim().toLowerCase(); });
  var iStato = heads.indexOf('stato pass');
  if(iStato < 0 || heads.indexOf('tipo') > -1) return;
  table.setAttribute('data-lg-tipo','1');
  fetch('/assignment-groups/' + m[1] + '/pass-types', {credentials:'same-origin'})
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(map){
      var th = document.createElement('th'); th.textContent = 'Tipo';
      ths[iStato].parentNode.insertBefore(th, ths[iStato].nextSibling);
      [].forEach.call(table.tBodies[0].rows, function(r){
        var c = r.querySelector('.chk-group'), td = document.createElement('td');
        var name = c ? map[c.value] : null;
        if(name){ var s = document.createElement('span'); s.className = 'lg-type'; s.textContent = name; td.appendChild(s); }
        else { td.textContent = '\u2014'; td.style.color = 'var(--text-muted)'; }
        r.cells[iStato].parentNode.insertBefore(td, r.cells[iStato].nextSibling);
      });
    })
    .catch(function(){ table.removeAttribute('data-lg-tipo'); });
})();

/* Nasconde la colonna Email quando e' vuota per tutti gli assegnatari */
(function(){
  var chk = document.getElementById('chk-all');
  var table = chk ? chk.closest('table') : null;
  if(!table || !table.tBodies[0]) return;
  var ths = [].slice.call(table.tHead.rows[0].cells);
  var i = ths.map(function(t){ return t.textContent.trim().toLowerCase(); }).indexOf('email');
  if(i < 0) return;
  var rows = [].slice.call(table.tBodies[0].rows);
  var empty = rows.every(function(r){ var c = r.cells[i]; return !c || !c.textContent.replace(/[\s\u2014-]/g,''); });
  if(!empty) return;
  ths[i].classList.add('lg-hidecol');
  rows.forEach(function(r){ if(r.cells[i]) r.cells[i].classList.add('lg-hidecol'); });
})();
