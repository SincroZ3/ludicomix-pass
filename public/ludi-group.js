/* ludi-group.js — restyling scheda gruppo assegnatario (passo 1). Solo DOM/estetica: nessuna logica esistente viene modificata. */
(function(){
  var nav = document.getElementById('crm-tab-nav');
  var pane = document.getElementById('tab-pass');
  if(!nav || !pane || nav.getAttribute('data-lg')) return;
  nav.setAttribute('data-lg','1');

  var P = {
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    pin:'<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 8l9 6 9-6"/>',
    stand:'<path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6"/>',
    ticket:'<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',
    alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    pencil:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    note:'<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h4"/>',
    gauge:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download:'<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    refresh:'<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    printer:'<path d="M7 9V4h10v5M7 18H4v-7h16v7h-3"/><path d="M7 14h10v6H7z"/>',
    pass:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    portale:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    'inbox-docs':'<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    'inbox-tickets':'<path d="M4 5h16v11H9l-5 4z"/>',
    referenti:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    pagamenti:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 11h18"/>',
    fiscale:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    documenti:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    materiali:'<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>'
  };
  function ico(name){
    var s = document.createElement('span'); s.className = 'lg-ico';
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'+(P[name]||'')+'</svg>';
    return s;
  }
  function el(tag, cls, text){
    var e = document.createElement(tag); if(cls) e.className = cls;
    if(text != null) e.textContent = text; return e;
  }
  function setIconLabel(node, name, label){
    node.textContent = ''; node.appendChild(ico(name));
    if(label) node.appendChild(document.createTextNode(label));
  }

  /* 1 — Dati dalle card informative esistenti */
  var grid = pane.querySelector('div[style*="auto-fit"]');
  var info = {};
  if(grid){
    [].forEach.call(grid.querySelectorAll(':scope > .card'), function(c){
      var t = c.querySelector('.card-title');
      if(!t) return;
      info[t.textContent.trim().toLowerCase()] = c;
    });
  }
  function strongs(c){ return c ? [].map.call(c.querySelectorAll('strong'), function(s){ return s.textContent.trim(); }) : []; }
  var h1 = document.querySelector('h1.page-title');
  var name = h1 ? h1.textContent.trim() : '';
  var cat = (strongs(info['categoria'])[0]) || '';
  var standArr = strongs(info['stand / riferimento']);
  var zoneArr = strongs(info['zona / padiglione']);
  var passArr = strongs(info['pass']);
  var emailCard = info['email riferimento'];
  var email = emailCard && emailCard.querySelector('a') ? emailCard.querySelector('a').textContent.trim() : '';
  var nPass = parseInt(passArr[0], 10) || 0;
  var limRaw = passArr[1] || '';
  var limit = parseInt(limRaw, 10); if(isNaN(limit)) limit = 0;

  /* 2 — Tabella assegnatari: colonne e conteggio "senza pass" */
  var chkAll = document.getElementById('chk-all');
  var table = chkAll ? chkAll.closest('table') : null;
  var noPass = 0;
  if(table){
    var heads = [].map.call(table.tHead.rows[0].cells, function(th){ return th.textContent.trim().toLowerCase(); });
    var iName = heads.indexOf('cognome e nome');
    var iStato = heads.indexOf('stato pass');
    [].forEach.call(table.tBodies[0].rows, function(r){
      if(iStato > -1 && r.cells[iStato] && /nessun pass/i.test(r.cells[iStato].textContent)) noPass++;
    });
  }

  /* 3 — Testata */
  var hero = el('section','lg-hero'); hero.id = 'lg-hero';
  var main = el('div','lg-hero-main');
  var initials = name.split(/\s+/).filter(Boolean).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase() || '?';
  main.appendChild(el('div','lg-avatar',initials));
  var idBox = el('div','lg-id');
  if(h1) idBox.appendChild(h1);
  var pills = el('div','lg-pills');
  function pill(icon, text, href){
    var p = el(href ? 'a' : 'span','lg-pill'); if(href) p.href = href;
    p.appendChild(ico(icon)); p.appendChild(document.createTextNode(text)); pills.appendChild(p);
  }
  if(cat) pill('user', cat);
  if(standArr[0] && standArr[0] !== name) pill('stand', standArr[0]);
  if(zoneArr.length && zoneArr[0] && zoneArr[0] !== '—'){
    pill('pin', zoneArr[0] + (zoneArr[1] ? ' · ' + zoneArr[1] : ''));
  } else if(zoneArr[1]){ pill('pin', zoneArr[1]); }
  if(email) pill('mail', email, 'mailto:' + email);
  idBox.appendChild(pills); main.appendChild(idBox); hero.appendChild(main);

  var stats = el('div','lg-stats');
  function stat(icon, label, value, cls){
    var s = el('div','lg-stat' + (cls ? ' ' + cls : ''));
    var top = el('div','lg-stat-top'); top.appendChild(ico(icon)); top.appendChild(el('span',null,label));
    s.appendChild(top); s.appendChild(el('div','lg-stat-val',value)); stats.appendChild(s); return s;
  }
  stat('user','Assegnatari', String(nPass));
  var sl = stat('ticket','Limite', limit > 0 ? String(limit) : '∞');
  if(limit > 0){
    var bar = el('div','lg-bar' + (nPass > limit ? ' over' : '')); var fill = document.createElement('i');
    fill.style.width = Math.min(100, Math.round(nPass / limit * 100)) + '%'; bar.appendChild(fill);
    sl.appendChild(bar); sl.appendChild(el('div','lg-bar-lbl', nPass + ' / ' + limit));
  }
  if(table) stat(noPass > 0 ? 'alert' : 'check','Senza pass', String(noPass), noPass > 0 ? 'warn' : 'ok');
  hero.appendChild(stats);

  var actions = el('div','lg-actions');
  function findDetails(txt){
    var all = pane.querySelectorAll(':scope > details');
    for(var i=0;i<all.length;i++){
      var s = all[i].querySelector('summary');
      if(s && s.textContent.toLowerCase().indexOf(txt) > -1) return all[i];
    }
    return null;
  }
  function actionBtn(icon, label, txt, dot){
    var d = findDetails(txt); if(!d) return;
    var b = el('button','lg-btn'); b.type = 'button'; b.appendChild(ico(icon)); b.appendChild(document.createTextNode(label));
    if(dot){ var s = d.querySelector('summary .chip'); if(s) b.appendChild(el('span','lg-dot')); }
    b.addEventListener('click', function(){
      var tabBtn = nav.querySelector('[data-tab="pass"]');
      if(!pane.classList.contains('active') && typeof window.crmTab === 'function') window.crmTab('pass', tabBtn);
      d.open = true; d.scrollIntoView({behavior:'smooth', block:'center'});
    });
    actions.appendChild(b);
  }
  actionBtn('pencil','Modifica dati','modifica dati');
  actionBtn('note','Note ed Email','note ed email', true);
  actionBtn('gauge','Limite pass','limite massimo');
  if(actions.children.length) hero.appendChild(actions);

  nav.parentNode.insertBefore(hero, nav);
  if(grid) grid.classList.add('lg-hide');

  /* 4 — Tab con icone a linea al posto delle emoji */
  [].forEach.call(nav.querySelectorAll('.crm-tab'), function(b){
    var n = b.firstChild;
    if(n && n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/^[^A-Za-zÀ-ÿ]+/, '');
    b.insertBefore(ico(b.getAttribute('data-tab')), b.firstChild);
  });

  /* 5 — Intestazione elenco */
  var h2 = null;
  [].forEach.call(pane.querySelectorAll(':scope > h2'), function(x){ if(/elenco assegnatari/i.test(x.textContent)) h2 = x; });
  if(h2){
    var head = el('div','lg-listhead'); h2.parentNode.insertBefore(head, h2); head.appendChild(h2);
    var imp = pane.querySelector(':scope > button[onclick*="imp-modal"]');
    if(imp){ setIconLabel(imp,'download','Import CSV / Excel'); head.appendChild(imp); }
  }

  /* 6 — Righe tabella */
  var pal = ['#6b3fa0','#3b6fc4','#e8843a','#2d9d78','#d9467a','#8a6d1d'];
  if(table){
    [].forEach.call(table.tBodies[0].rows, function(r){
      if(iName > -1 && r.cells[iName]){
        var td = r.cells[iName], strong = td.querySelector('strong');
        if(strong && !td.querySelector('.lg-name')){
          var t = strong.textContent.trim(), parts = t.split(/\s+/).filter(Boolean);
          var ini = ((parts[0]||'')[0] || '') + ((parts[1]||'')[0] || '');
          var sum = 0; for(var i=0;i<t.length;i++) sum += t.charCodeAt(i);
          var av = el('span','lg-av',ini.toUpperCase()); av.style.background = pal[sum % pal.length];
          var w = el('div','lg-name'); td.insertBefore(w, strong); w.appendChild(av); w.appendChild(strong);
        }
      }
      if(iStato > -1 && r.cells[iStato]){
        var bd = r.cells[iStato].querySelector('span[style*="border-radius"]'); if(bd) bd.classList.add('lg-badge');
      }
      var hist = r.querySelector('button[onclick^="mostraStorico"]');
      if(hist){ hist.classList.add('lg-hist'); setIconLabel(hist,'clock'); hist.title = 'Storico pass'; }
      var pdf = r.querySelector('a.link-action');
      if(pdf){ pdf.classList.add('lg-pdf'); setIconLabel(pdf,'download','PDF'); }
      var sost = r.querySelector('button[onclick*="replace"]');
      if(sost){ sost.classList.add('lg-sost','lg-icobtn'); setIconLabel(sost,'refresh','Sost.'); }
      var del = r.querySelector('button.btn-danger');
      if(del){ del.classList.add('lg-del','lg-icobtn'); setIconLabel(del,'trash'); del.title = 'Elimina'; }
    });
  }

  /* 7 — Barra azioni: tipologia + genera + stampa batch */
  var sel = pane.querySelector('form[action="/passes/bulk"] select[name="pass_type_id"]');
  var bar2 = sel ? sel.closest('.card') : null;
  var batch = pane.querySelector('a[href$="/batch-pdf"]:not([href*="auto-passes"])');
  if(bar2){
    bar2.classList.add('lg-actionbar');
    var gen = bar2.querySelector('button[type="submit"]'); if(gen) setIconLabel(gen,'printer','Genera pass selezionati');
    if(batch){
      var note = batch.parentNode;
      batch.classList.add('lg-batch'); batch.removeAttribute('style'); setIconLabel(batch,'printer','Stampa batch PDF');
      bar2.insertBefore(batch, gen || null);
      if(note && note !== pane){ note.classList.add('lg-batchnote'); note.removeAttribute('style'); }
    }
  }
})();
