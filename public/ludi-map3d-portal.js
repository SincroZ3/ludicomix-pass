/* ludi-map3d-portal.js - portale espositore: mappa 3D nel riquadro "Dove siete?".
   Aggiunto alla pagina da routes/map3d-portal.js.
   - Il riquadro mostra subito il 3D: stand dell'espositore evidenziato, orbita lenta attorno a lui, edificio in super trasparenza
     (si vede lo stand attraverso i muri). Gli altri stand sono grigi, senza nome e non cliccabili.
   - Piccolo switch 3D / 2D nella barra del riquadro: il 2D e la mappa originale della pagina (canvas), invariata.
   - Pagina scorrevole: il trascinamento verticale scorre la pagina, quello orizzontale ruota la mappa; la rotellina zooma solo con Ctrl.
   - Se lo stand non ha un layout 3D o WebGL non e disponibile resta il 2D. Se la pagina non ha il riquadro "Dove siete?"
     ma lo stand ha un 3D, compare il vecchio pulsante "Il tuo stand in 3D" che apre la vista a tutto schermo. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var parts = location.pathname.split('/'), pi = parts.indexOf('portale'), token = pi > -1 ? parts[pi + 1] : '';
  if (!token) return;
  var info = null, ov = null, view = null, busy = false, emb = null;

  var css = document.createElement('style');
  css.textContent = '.m3p-fab{position:fixed;left:14px;bottom:14px;z-index:900;border:0;border-radius:999px;padding:.65rem 1rem;background:#1e2d4e;color:#f5c842;font:800 .85rem system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.28);cursor:pointer}' +
    '.m3p-ov{position:fixed;left:0;top:0;right:0;bottom:0;z-index:10000;display:flex;flex-direction:column;background:#1e2d4e}' +
    '.m3p-bar{display:flex;align-items:center;gap:.6rem;padding:.6rem .8rem;color:#fff;font:700 .9rem system-ui,sans-serif}' +
    '.m3p-bar .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.m3p-seg{display:flex;gap:4px}.m3p-seg button,.m3p-x{border:1.5px solid rgba(245,200,66,.6);background:transparent;color:#f5c842;border-radius:9px;padding:.35rem .7rem;font:800 .8rem system-ui,sans-serif;cursor:pointer}' +
    '.m3p-seg button.on{background:#f5c842;color:#1e2d4e}' +
    '.m3p-body{flex:1;position:relative;min-height:0;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    '@media (max-width:700px){.m3p-ov .m3-menu{left:8px;right:8px}}' +
    '.m3e-box{position:relative;height:380px;background:linear-gradient(#e9e2f6,#f6f3fb);overflow:hidden}' +
    '.m3e-box .m3-btn,.m3e-box .m3-menu{display:none!important}' +
    '.m3e-load{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font:700 .85rem Inter,system-ui,sans-serif;color:#6b3fa0}' +
    '.m3e-seg{display:inline-flex;border:1.5px solid #d1d9e6;border-radius:9999px;overflow:hidden;background:#fff}' +
    '.m3e-seg button{border:0;background:#fff;color:#1a2744;padding:.38rem .95rem;font:700 .76rem Inter,system-ui,sans-serif;cursor:pointer}' +
    '.m3e-seg button.on{background:#6b3fa0;color:#fff}' +
    '@media (max-width:520px){.m3e-box{height:300px}}';
  document.head.appendChild(css);

  /* ---------- vista a tutto schermo (solo se manca il riquadro nella pagina) ---------- */
  function setMode(m) {
    if (!view || !ov) return;
    ov.querySelectorAll('.m3p-seg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); });
    if (m === '2d') { view.setRotate(false); view.setView('top'); }
    else { view.setRotate(true); view.focus(info.ownId); }
  }
  function close() {
    try { if (view) view.dispose(); } catch (e) { /* gia chiuso */ }
    view = null;
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    ov = null;
    document.documentElement.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  async function open() {
    if (ov || busy || !info) return;
    busy = true;
    ov = document.createElement('div'); ov.className = 'm3p-ov';
    ov.innerHTML = `<div class='m3p-bar'><div class='t'></div><div class='m3p-seg'><button type='button' data-m='3d' class='on'>3D</button><button type='button' data-m='2d'>2D</button></div><button type='button' class='m3p-x'>Chiudi</button></div><div class='m3p-body'></div>`;
    ov.querySelector('.t').textContent = 'Il tuo stand' + (info.name ? ' - ' + info.name : '');
    document.body.appendChild(ov);
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    ov.querySelector('.m3p-x').onclick = close;
    ov.querySelectorAll('.m3p-seg button').forEach(function (b) { b.onclick = function () { setMode(b.getAttribute('data-m')); }; });
    var v = null;
    try {
      var mod = await import('/ludi-map3d-view.js?v=' + VER);
      v = await mod.createMap3D(ov.querySelector('.m3p-body'), { zoneId: 'p-' + token, focusId: info.ownId, rotate: true, clickable: 'none', env: true, menu: true });
    } catch (e) { console.warn('[map3d-portal]', e); v = null; }
    busy = false;
    if (!v) { close(); return; }
    view = v;
  }

  /* ---------- 3D nel riquadro "Dove siete?" ---------- */
  // Super trasparenza: porta al massimo la trasparenza dell'edificio e, se i moduli ambiente (Mariambini, Vanvere) hanno un loro
  // cursore di trasparenza nel pannello nascosto, porta al massimo anche quello.
  function superTransp() {
    if (!emb || !emb.view) return;
    try { emb.view.setContext({ trn: 1 }); } catch (e) { /* ok */ }
    try {
      emb.box.querySelectorAll('input[type=range]').forEach(function (r) {
        var l = r.closest ? r.closest('label') : null, t = (l && l.textContent) || r.getAttribute('data-k') || '';
        if (/trasparen|trn/i.test(t)) { r.value = r.max || 100; r.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    } catch (e) { /* ok */ }
  }
  function setEmbMode(m) {
    if (!emb || !emb.view) return;
    emb.mode = m;
    emb.seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); });
    if (m === '3d') {
      emb.wrap.style.display = 'none'; emb.box.style.display = 'block';
      try { emb.view.setRotate(true); emb.view.focus(info.ownId); } catch (e) { /* ok */ }
    } else {
      try { emb.view.setRotate(false); } catch (e) { /* ok */ }
      emb.box.style.display = 'none'; emb.wrap.style.display = '';
    }
  }
  async function mountEmbedded() {
    var card = document.getElementById('dove-card');
    var wrap = card ? card.querySelector('.dove-canvas-wrap') : null;
    if (!card || !wrap) return false;
    var box = document.createElement('div'); box.className = 'm3e-box';
    box.innerHTML = "<div class='m3e-load'>Carico la mappa 3D...</div>";
    wrap.parentNode.insertBefore(box, wrap); wrap.style.display = 'none';
    // scorrimento della pagina: la rotellina zooma solo con Ctrl, il trascinamento verticale scorre la pagina
    box.addEventListener('wheel', function (e) { if (!e.ctrlKey) e.stopImmediatePropagation(); }, true);
    var v = null;
    try {
      var mod = await import('/ludi-map3d-view.js?v=' + VER);
      v = await mod.createMap3D(box, { zoneId: 'p-' + token, focusId: info.ownId, rotate: true, clickable: 'none', env: true, menu: true });
    } catch (e) { console.warn('[map3d-portal]', e); v = null; }
    if (!v) { if (box.parentNode) box.parentNode.removeChild(box); wrap.style.display = ''; return false; }
    try { var cv = box.querySelector('canvas'); if (cv) cv.style.touchAction = 'pan-y'; } catch (e) { /* ok */ }
    var seg = document.createElement('div'); seg.className = 'm3e-seg';
    seg.innerHTML = "<button type='button' data-m='3d' class='on'>3D</button><button type='button' data-m='2d'>2D</button>";
    var acts = card.querySelector('.dove-actions');
    if (acts) acts.insertBefore(seg, acts.firstChild); else card.insertBefore(seg, box);
    emb = { box: box, wrap: wrap, view: v, seg: seg, card: card, mode: '3d' };
    seg.querySelectorAll('button').forEach(function (b) { b.onclick = function () { setEmbMode(b.getAttribute('data-m')); }; });
    superTransp(); setTimeout(superTransp, 1500); setTimeout(superTransp, 4000);
    return true;
  }

  function openStand3D() {
    if (emb && emb.view) {
      setEmbMode('3d');
      try { emb.card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ok */ }
    } else open();
  }
  function addFab() {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'm3p-fab'; b.textContent = 'Il tuo stand in 3D';
    b.onclick = open; document.body.appendChild(b);
  }

  fetch('/api/map3d/zone/p-' + token, { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || d.ownId == null) return;
      var own = (d.stands || []).filter(function (s) { return s.id === d.ownId; })[0];
      info = { ownId: d.ownId, name: own ? own.name : '' };
      window.openStand3D = openStand3D;
      document.addEventListener('click', function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-map3d-open]') : null; if (t) { e.preventDefault(); openStand3D(); } });
      mountEmbedded().then(function (ok) { if (!ok) addFab(); }).catch(function () { addFab(); });
    })
    .catch(function () { /* nessun 3D disponibile */ });
})();
