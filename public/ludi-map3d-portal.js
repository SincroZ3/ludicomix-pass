/* ludi-map3d-portal.js - portale espositore: pulsante per aprire lo stand in 3D / 2D a tutto schermo.
   Aggiunto alla pagina da routes/map3d-portal.js. Il 3D si apre per primo con una rotazione lenta attorno allo stand;
   2D mostra la zona dall'alto. Lo stand dell'espositore e evidenziato, gli altri sono grigi, senza nome e non cliccabili.
   Se lo stand non ha un layout 3D o WebGL non e disponibile il pulsante non compare. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var parts = location.pathname.split('/'), pi = parts.indexOf('portale'), token = pi > -1 ? parts[pi + 1] : '';
  if (!token) return;
  var info = null, ov = null, view = null, busy = false;

  var css = document.createElement('style');
  css.textContent = '.m3p-fab{position:fixed;left:14px;bottom:14px;z-index:900;border:0;border-radius:999px;padding:.65rem 1rem;background:#1e2d4e;color:#f5c842;font:800 .85rem system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.28);cursor:pointer}' +
    '.m3p-ov{position:fixed;left:0;top:0;right:0;bottom:0;z-index:10000;display:flex;flex-direction:column;background:#1e2d4e}' +
    '.m3p-bar{display:flex;align-items:center;gap:.6rem;padding:.6rem .8rem;color:#fff;font:700 .9rem system-ui,sans-serif}' +
    '.m3p-bar .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.m3p-seg{display:flex;gap:4px}.m3p-seg button,.m3p-x{border:1.5px solid rgba(245,200,66,.6);background:transparent;color:#f5c842;border-radius:9px;padding:.35rem .7rem;font:800 .8rem system-ui,sans-serif;cursor:pointer}' +
    '.m3p-seg button.on{background:#f5c842;color:#1e2d4e}' +
    '.m3p-body{flex:1;position:relative;min-height:0;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    '@media (max-width:700px){.m3p-ov .m3-menu{left:8px;right:8px}}';
  document.head.appendChild(css);

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

  fetch('/api/map3d/zone/p-' + token, { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || d.ownId == null) return;
      var own = (d.stands || []).filter(function (s) { return s.id === d.ownId; })[0];
      info = { ownId: d.ownId, name: own ? own.name : '' };
      var b = document.createElement('button'); b.type = 'button'; b.className = 'm3p-fab'; b.textContent = 'Il tuo stand in 3D';
      b.onclick = open; document.body.appendChild(b);
      window.openStand3D = open;
      document.addEventListener('click', function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-map3d-open]') : null; if (t) { e.preventDefault(); open(); } });
    })
    .catch(function () { /* nessun 3D disponibile */ });
})();
