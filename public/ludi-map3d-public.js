/* ludi-map3d-public.js - pulsante 3D/2D per la mappa stand pubblica (/mappa-stand/:id).
   Viene aggiunto alla pagina da routes/map3d-public.js. Se la zona non ha un layout 3D o WebGL non e disponibile
   non cambia nulla e resta la mappa 2D. Aprendo la pagina parte il 3D; ?view=2d apre il 2D.
   Il clic su uno stand in 3D apre la stessa scheda (con gli eventi collegati) della mappa 2D.
   Durante il caricamento un velo viola con il ciuchino copre la 2D: il ciuchino parte piccolissimo, cresce piano piano
   e, a 3D pronto, si ingrandisce fino a svelare la mappa. Il 3D parte subito, senza aspettare la 2D. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var q = new URLSearchParams(location.search);
  var want3d = q.get('view') !== '2d';
  var view = null, wrap = null, btn = null, busy = false, loader = null, has3d = false;

  function zid() { try { return ZONE_ID; } catch (e) { return null; } }
  function ready() { try { return typeof openSheet === 'function' && typeof closeSheet === 'function' && !!leafMap; } catch (e) { return false; } }
  function list2d() { try { return stands || []; } catch (e) { return []; } }

  var css = document.createElement('style');
  css.textContent = '.m3wrap{position:fixed;left:0;right:0;bottom:0;top:58px;z-index:100;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    'body.m3on .sm-ctrl .sm-btn.reset,body.m3on .sm-ctrl .sm-btn[onclick^=doZoom],body.m3on #smLegend{display:none!important}' +
    '.sm-btn.m3-toggle{font:800 .85rem system-ui,sans-serif;background:#f5c842;border-color:#f5c842;color:#1e2d4e}' +
    '@media (max-width:700px){.m3wrap .m3-menu{right:64px}}' +
    '.m3load{position:fixed;left:0;right:0;bottom:0;top:58px;z-index:101;overflow:hidden;background:radial-gradient(circle at 50% 42%,#a78bfa 0%,#8b5cf6 22%,#6b3fa0 58%,#3b1f66 100%);transition:opacity .4s ease .5s}' +
    '.m3l-d{position:absolute;left:50%;top:50%;width:min(58vw,300px);height:auto;transform:translate(-50%,-50%) scale(.04);transition:transform 9s cubic-bezier(.08,.7,.3,1);filter:drop-shadow(0 8px 22px rgba(20,8,48,.45));will-change:transform;user-select:none;-webkit-user-drag:none}' +
    '.m3load.grow .m3l-d{transform:translate(-50%,-50%) scale(.5)}' +
    '.m3load.done{opacity:0;pointer-events:none}' +
    '.m3load.done .m3l-d{transition:transform .95s cubic-bezier(.55,0,.85,.35);transform:translate(-50%,-50%) scale(16)}' +
    '@media (prefers-reduced-motion:reduce){.m3l-d,.m3load.done .m3l-d{transition:none;transform:translate(-50%,-50%) scale(.5)}.m3load{transition:opacity .3s}}';
  document.head.appendChild(css);

  function showLoader() {
    if (loader) return;
    loader = document.createElement('div'); loader.className = 'm3load';
    var im = document.createElement('img'); im.className = 'm3l-d'; im.src = '/ciuchino_static.png'; im.alt = ''; im.draggable = false;
    loader.appendChild(im); document.body.appendChild(loader);
    void loader.offsetWidth;
    requestAnimationFrame(function () { if (loader) loader.classList.add('grow'); });
  }
  function hideLoader(instant) {
    var l = loader; if (!l) return; loader = null;
    if (instant) { if (l.parentNode) l.parentNode.removeChild(l); return; }
    l.classList.add('done');
    setTimeout(function () { if (l.parentNode) l.parentNode.removeChild(l); }, 1100);
  }

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
  async function start3D(first) {
    if (busy || view) return;
    busy = true;
    if (first) showLoader();
    wrap = document.createElement('div'); wrap.className = 'm3wrap'; document.body.appendChild(wrap);
    document.body.classList.add('m3on');
    var m = null;
    try {
      var mod = await import('/ludi-map3d-view.js?v=' + VER);
      m = await mod.createMap3D(wrap, { zoneId: zid(), clickable: 'all', env: true, menu: true, onSelect: onPick });
    } catch (e) { console.warn('[map3d]', e); m = null; }
    busy = false;
    if (!m) { cleanup(); setBtn(false); hideLoader(true); return; }
    view = m; setBtn(true);
    hideLoader(false);
  }
  function stop3D() {
    if (!view) return;
    try { view.dispose(); } catch (e) { /* gia chiuso */ }
    cleanup(); setBtn(false);
    try { closeSheet(); } catch (e) { /* nessuna scheda aperta */ }
  }

  function setupButton() {
    var tries = 0;
    (function wait() {
      var ctrl = document.querySelector('.sm-ctrl');
      if (!ready() || !ctrl) { if (++tries < 75) setTimeout(wait, 200); return; }
      btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sm-btn m3-toggle';
      ctrl.insertBefore(btn, ctrl.firstChild); setBtn(!!view);
      btn.onclick = function () { if (view) stop3D(); else start3D(false); };
    })();
  }

  if (want3d) showLoader();
  var zt = 0;
  (function init() {
    var id = zid();
    if (id == null) { if (++zt < 75) { setTimeout(init, 200); return; } hideLoader(true); return; }
    fetch('/api/map3d/zone/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        has3d = !!(d && d.stands && d.stands.some(function (s) { return s.kind !== 'obj'; }));
        if (!has3d) { hideLoader(true); return; }
        setupButton();
        if (want3d) start3D(true); else hideLoader(true);
      })
      .catch(function () { hideLoader(true); /* resta il 2D */ });
  })();
})();
