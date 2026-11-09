/* ludi-group-3.js — passo 3: "Aggiungi assegnatari" come pannello a destra (desktop) o cassetto (schermi stretti). */
(function(){
  var pane = document.getElementById('tab-pass');
  if(!pane || pane.getAttribute('data-lg3')) return;
  var head = pane.querySelector('.lg-listhead');
  var det = null;
  [].forEach.call(pane.querySelectorAll(':scope > details'), function(d){
    var s = d.querySelector('summary');
    if(s && /aggiungi assegnatari/i.test(s.textContent)) det = d;
  });
  var card = det ? det.querySelector(':scope > .card') : null;
  if(!head || !det || !card) return;
  pane.setAttribute('data-lg3','1');

  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  var plusSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
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

  /* Pannello: sposto il contenuto esistente (id e handler restano intatti) */
  var dr = el('aside','lg-drawer'); dr.id = 'lg-drawer'; dr.setAttribute('aria-label','Aggiungi assegnatari');
  var hd = el('div','lg-drawer-head');
  var di = el('span','lg-dico'); di.innerHTML = plusSvg; hd.appendChild(di);
  hd.appendChild(el('h3',null,'Aggiungi assegnatari'));
  var x = el('button','lg-drawer-x','×'); x.type = 'button'; x.setAttribute('aria-label','Chiudi'); hd.appendChild(x);
  var body = el('div','lg-drawer-body');
  while(card.firstChild) body.appendChild(card.firstChild);
  dr.appendChild(hd); dr.appendChild(body);
  split.appendChild(dr);
  det.classList.add('lg-hide');

  var backdrop = el('div','lg-backdrop'); document.body.appendChild(backdrop);

  /* Pulsante nell'intestazione elenco */
  var btn = el('button','lg-addbtn'); btn.type = 'button'; btn.setAttribute('aria-pressed','false');
  btn.innerHTML = plusSvg + '<span>Aggiungi assegnatari</span>';
  var imp = head.querySelector('button[onclick*="imp-modal"]');
  head.insertBefore(btn, imp || null);

  function setOpen(v, persist){
    split.classList.toggle('lg-open', v);
    btn.setAttribute('aria-pressed', v ? 'true' : 'false');
    backdrop.classList.toggle('on', v && !mq.matches);
    document.body.style.overflow = (v && !mq.matches) ? 'hidden' : '';
    if(persist && mq.matches){ try{ localStorage.setItem('lg-drawer', v ? '1' : '0'); }catch(e){} }
    if(v && !mq.matches){ var t = document.getElementById('bulk-names'); if(t) setTimeout(function(){ t.focus(); }, 280); }
  }
  function isOpen(){ return split.classList.contains('lg-open'); }
  function init(){
    var pref = null; try{ pref = localStorage.getItem('lg-drawer'); }catch(e){}
    setOpen(mq.matches ? pref !== '0' : false, false);
  }
  btn.addEventListener('click', function(){ setOpen(!isOpen(), true); });
  x.addEventListener('click', function(){ setOpen(false, true); });
  backdrop.addEventListener('click', function(){ setOpen(false, false); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && isOpen() && !mq.matches) setOpen(false, false); });
  if(mq.addEventListener) mq.addEventListener('change', init); else if(mq.addListener) mq.addListener(init);
  init();
})();
