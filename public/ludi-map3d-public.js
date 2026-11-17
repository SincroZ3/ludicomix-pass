/* ludi-map3d-public.js - pulsante 3D/2D per la mappa stand pubblica (/mappa-stand/:id).
   Viene aggiunto alla pagina da routes/map3d-public.js. Se la zona non ha un layout 3D o WebGL non e disponibile
   non cambia nulla e resta la mappa 2D. Aprendo la pagina parte il 3D; ?view=2d apre il 2D.
   Il clic su uno stand in 3D apre la stessa scheda (con gli eventi collegati) della mappa 2D. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var q = new URLSearchParams(location.search);
  var view = null, wrap = null, btn = null, busy = false;

  function zid() { try { return ZONE_ID; } catch (e) { return null; } }
  function ready() { try { return typeof openSheet === 'function' && typeof closeSheet === 'function' && !!leafMap; } catch (e) { return false; } }
  function list2d() { try { return stands || []; } catch (e) { return []; } }

  var css = document.createElement('style');
  css.textContent = '.m3wrap{position:fixed;left:0;right:0;bottom:0;top:58px;z-index:100;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    'body.m3on .sm-ctrl .sm-btn.reset,body.m3on .sm-ctrl .sm-btn[onclick^=doZoom],body.m3on #smLegend{display:none!important}' +
    '.sm-btn.m3-toggle{font:800 .85rem system-ui,sans-serif;background:#f5c842;border-color:#f5c842;color:#1e2d4e}' +
    '@media (max-width:700px){.m3wrap .m3-menu{right:64px}}';
  document.head.appendChild(css);

  function setBtn(is3d) {
    if (!btn) return;
    btn.textContent = is3d ? '2D' : '3D';
    btn.title = is3d ? 'Passa alla mappa 2D' : 'Passa alla mappa 3D';
    btn.setAttribute('aria-label', btn.title);
  }
  function onPick(id) {
    try {
      if (id == null) { closeSheet(); return; }
      var s = list2d().filter(function (x) { return x.id === id; })[0];
      if (s) openSheet(s); else closeSheet();
    } catch (e) { /* resta la vista 3D */ }
  }
  function cleanup() {
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    wrap = null; view = null;
    document.body.classList.remove('m3on');
  }
  async function start3D() {
    if (busy || view) return;
    busy = true;
    wrap = document.createElement('div'); wrap.className = 'm3wrap'; document.body.appendChild(wrap);
    document.body.classList.add('m3on');
    var m = null;
    try {
      var mod = await import('/ludi-map3d-view.js?v=' + VER);
      m = await mod.createMap3D(wrap, { zoneId: zid(), clickable: 'all', env: true, menu: true, onSelect: onPick });
    } catch (e) { console.warn('[map3d]', e); m = null; }
    busy = false;
    if (!m) { cleanup(); setBtn(false); return; }
    view = m; setBtn(true);
  }
  function stop3D() {
    if (!view) return;
    try { view.dispose(); } catch (e) { /* gia chiuso */ }
    cleanup(); setBtn(false);
    try { closeSheet(); } catch (e) { /* nessuna scheda aperta */ }
  }

  var tries = 0;
  (function wait() {
    if (!ready()) { if (++tries < 75) setTimeout(wait, 200); return; }
    fetch('/api/map3d/zone/' + zid(), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.stands || !d.stands.some(function (s) { return s.kind !== 'obj'; })) return;
        var ctrl = document.querySelector('.sm-ctrl'); if (!ctrl) return;
        btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sm-btn m3-toggle';
        ctrl.insertBefore(btn, ctrl.firstChild); setBtn(false);
        btn.onclick = function () { if (view) stop3D(); else start3D(); };
        if (q.get('view') !== '2d') start3D();
      })
      .catch(function () { /* resta il 2D */ });
  })();
})();
