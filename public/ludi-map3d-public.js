/* ludi-map3d-public.js - pulsante 3D/2D per la mappa stand pubblica (/mappa-stand/:id).
   Viene aggiunto alla pagina da routes/map3d-public.js. Se la zona non ha un layout 3D o WebGL non e disponibile
   non cambia nulla e resta la mappa 2D. Aprendo la pagina parte il 3D; ?view=2d apre il 2D.
   Il clic su uno stand in 3D apre la stessa scheda (con gli eventi collegati) della mappa 2D.
   - Loader: velo viola con il ciuchino che parte piccolissimo, cresce piano piano e, a 3D pronto, si ingrandisce fino a svelare la mappa.
     Il 3D parte subito, senza aspettare la 2D.
   - Ricerca: la lista "Stand in zona" (cerca + clic) lavora sul 3D: la camera vola sullo stand, lo evidenzia (gli altri diventano grigi),
     avvia l'orbita attorno a lui e apre la scheda. Un clic su un altro stand o sul vuoto, o la chiusura della scheda, riporta la vista normale.
   - Menu: il pannello "Contesto e vista" e sostituito da pillole tonde (tetto, edificio e, dove ci sono, alberi); la trasparenza degli edifici resta fissa.
     Le pillole agiscono sul modello dell'edificio (Palazzetto) e sui comandi dei pannelli "Ambiente 3D" di Mariambini e Vanvere (che restano nascosti). */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var q = new URLSearchParams(location.search);
  var want3d = q.get('view') !== '2d';
  var view = null, wrap = null, btn = null, busy = false, loader = null, has3d = false, pillObs = null;
  var origFocus = null, origClose = null, focused = false;

  function zid() { try { return ZONE_ID; } catch (e) { return null; } }
  function ready() { try { return typeof openSheet === 'function' && typeof closeSheet === 'function' && !!leafMap; } catch (e) { return false; } }
  function list2d() { try { return stands || []; } catch (e) { return []; } }

  var css = document.createElement('style');
  css.textContent = '.m3wrap{position:fixed;left:0;right:0;bottom:0;top:58px;z-index:100;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    'body.m3on .sm-ctrl .sm-btn.reset,body.m3on .sm-ctrl .sm-btn[onclick^=doZoom],body.m3on #smLegend{display:none!important}' +
    '.sm-btn.m3-toggle{font:800 .85rem system-ui,sans-serif;background:#f5c842;border-color:#f5c842;color:#1e2d4e}' +
    '.m3wrap .m3-btn,.m3wrap .m3-menu{display:none!important}' +
    '.m3pills{position:absolute;left:12px;top:12px;z-index:30;display:flex;flex-direction:column;gap:9px}' +
    '.m3pill{position:relative;width:46px;height:46px;border-radius:50%;border:1.5px solid #d9cff0;background:rgba(255,255,255,.96);color:#4c2c78;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 4px 14px rgba(59,31,102,.22);transition:background .15s,color .15s,transform .12s}' +
    '.m3pill svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.m3pill:active{transform:scale(.92)}' +
    '.m3pill.on{background:#6b3fa0;border-color:#6b3fa0;color:#fff}' +
    '.m3pill.off:after{content:"";position:absolute;width:28px;height:2.5px;border-radius:2px;background:#c0392b;transform:rotate(-45deg)}' +
    '.m3pill[disabled]{opacity:.45;cursor:default}' +
    '.m3load{position:fixed;left:0;right:0;bottom:0;top:58px;z-index:101;overflow:hidden;background:radial-gradient(circle at 50% 42%,#a78bfa 0%,#8b5cf6 22%,#6b3fa0 58%,#3b1f66 100%);transition:opacity .4s ease .5s}' +
    '.m3l-d{position:absolute;left:50%;top:50%;width:min(58vw,300px);height:auto;transform:translate(-50%,-50%) scale(.04);transition:transform 9s cubic-bezier(.08,.7,.3,1);filter:drop-shadow(0 8px 22px rgba(20,8,48,.45));will-change:transform;user-select:none;-webkit-user-drag:none}' +
    '.m3load.grow .m3l-d{transform:translate(-50%,-50%) scale(.5)}' +
    '.m3load.done{opacity:0;pointer-events:none}' +
    '.m3load.done .m3l-d{transition:transform .95s cubic-bezier(.55,0,.85,.35);transform:translate(-50%,-50%) scale(16)}' +
    '@media (prefers-reduced-motion:reduce){.m3l-d,.m3load.done .m3l-d{transition:none;transform:translate(-50%,-50%) scale(.5)}.m3load{transition:opacity .3s}}';
  document.head.appendChild(css);

  function smLoad(show) { var sl = document.getElementById('smLoad'); if (sl) sl.style.display = show ? '' : 'none'; }
  function showLoader() {
    if (loader) return;
    smLoad(false);
    loader = document.createElement('div'); loader.className = 'm3load';
    var im = document.createElement('img'); im.className = 'm3l-d'; im.src = '/ciuchino_static.png'; im.alt = ''; im.draggable = false;
    loader.appendChild(im); document.body.appendChild(loader);
    void loader.offsetWidth;
    requestAnimationFrame(function () { if (loader) loader.classList.add('grow'); });
  }
  function hideLoader(instant) {
    var l = loader; if (!l) return; loader = null;
    if (instant) { if (l.parentNode) l.parentNode.removeChild(l); if (!ready()) smLoad(true); return; }
    l.classList.add('done');
    setTimeout(function () { if (l.parentNode) l.parentNode.removeChild(l); }, 1100);
  }

  function setBtn(is3d) {
    if (!btn) return;
    btn.textContent = is3d ? '2D' : '3D';
    btn.title = is3d ? 'Passa alla mappa 2D' : 'Passa alla mappa 3D';
    btn.setAttribute('aria-label', btn.title);
  }

  // ---- ricerca: la lista "Stand in zona" lavora sul 3D ----
  function clearFocus() {
    if (!focused) return;
    focused = false;
    try { if (view) { view.focus(null); view.setRotate(false); } } catch (e) { /* ok */ }
  }
  function installSearch() {
    try {
      if (!origFocus && typeof window.focusStand === 'function') {
        origFocus = window.focusStand;
        window.focusStand = function (id) {
          if (!view) return origFocus.apply(this, arguments);
          try { closeDrawer(); } catch (e) { /* ok */ }
          var s3 = null; try { s3 = view.getStand(id); } catch (e) { s3 = null; }
          var s2 = list2d().filter(function (x) { return x.id === id; })[0];
          if (s3 && s3.placed !== false) { focused = true; view.focus(id); view.setRotate(true); }
          if (s2) setTimeout(function () { try { openSheet(s2); } catch (e) { /* ok */ } }, 500);
        };
      }
      if (!origClose && typeof window.closeSheet === 'function') {
        origClose = window.closeSheet;
        window.closeSheet = function () { var r = origClose.apply(this, arguments); if (view && focused) clearFocus(); return r; };
      }
    } catch (e) { console.warn('[map3d] ricerca', e); }
  }
  function restoreSearch() {
    if (origFocus) { window.focusStand = origFocus; origFocus = null; }
    if (origClose) { window.closeSheet = origClose; origClose = null; }
    focused = false;
  }

  function onPick(id) {
    try {
      if (focused) clearFocus();
      if (id == null) { closeSheet(); return; }
      var s = list2d().filter(function (x) { return x.id === id; })[0];
      if (s) openSheet(s); else closeSheet();
    } catch (e) { /* resta la vista 3D */ }
  }

  // ---- pillole: tetto, edificio, alberi (la trasparenza resta fissa) ----
  // Palazzetto: setContext sul modello dell'edificio. Mariambini e Vanvere: i loro pannelli "Ambiente 3D" (nascosti) hanno le caselle
  // Tettoia/Tetti, Edifici di contesto/Muri e finestre, Alberi: le pillole le accendono e spengono (anche quando il pannello viene ricreato).
  function buildPills(v, host) {
    var st = { bld: true, rf: true, tr: true };
    var box = document.createElement('div'); box.className = 'm3pills';
    var ICON = {
      rf: '<svg viewBox="0 0 24 24"><path d="M3 13l9-8 9 8"/><path d="M7 11v8h10v-8"/></svg>',
      bld: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/></svg>',
      tr: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6"/><path d="M12 15v6M9 21h6"/></svg>'
    };
    function envBox(k) { return host.querySelector('input[type="checkbox"][data-k="' + k + '"]'); }
    function envSet(keys, on) {
      keys.forEach(function (k) {
        var c = envBox(k);
        if (c && c.checked !== on) { c.checked = on; c.dispatchEvent(new Event('input', { bubbles: true })); }
      });
    }
    function applyEnv() {
      envSet(['rf', 'pv'], st.bld && st.rf);
      envSet(['wl', 'wn', 'bl'], st.bld);
      envSet(['tr'], st.tr);
    }
    var pills = {};
    function paint(key) {
      var b = pills[key], on = st[key];
      b.classList.toggle('on', on); b.classList.toggle('off', !on);
      var L = { rf: ['Nascondi il tetto', 'Mostra il tetto'], bld: ['Nascondi l\u2019edificio', 'Mostra l\u2019edificio'], tr: ['Nascondi gli alberi', 'Mostra gli alberi'] }[key];
      b.title = on ? L[0] : L[1]; b.setAttribute('aria-label', b.title);
    }
    function sync() {
      pills.rf.disabled = !st.bld;
      pills.tr.style.display = envBox('tr') ? '' : 'none';
    }
    function mk(key) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'm3pill on'; b.innerHTML = ICON[key];
      b.onclick = function () {
        if (b.disabled) return;
        st[key] = !st[key];
        try { v.setContext({ bld: st.bld, rf: st.rf }); } catch (e) { /* ok */ }
        applyEnv(); paint(key); sync();
      };
      pills[key] = b; box.appendChild(b); paint(key); return b;
    }
    mk('rf'); mk('bld'); mk('tr');
    sync(); host.appendChild(box);
    if (window.MutationObserver) {
      pillObs = new MutationObserver(function () { applyEnv(); sync(); });
      pillObs.observe(host, { childList: true, subtree: true });
    }
  }

  function cleanup() {
    if (pillObs) { try { pillObs.disconnect(); } catch (e) { /* ok */ } pillObs = null; }
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
      import('/ludi-env-defaults.js?v=' + VER).catch(function () { /* facoltativo: Vanvere parte al 50% di trasparenza */ });
      var mod = await import('/ludi-map3d-view.js?v=' + VER);
      m = await mod.createMap3D(wrap, { zoneId: zid(), clickable: 'all', env: true, menu: true, onSelect: onPick });
    } catch (e) { console.warn('[map3d]', e); m = null; }
    busy = false;
    if (!m) { cleanup(); setBtn(false); hideLoader(true); return; }
    view = m; setBtn(true);
    try { buildPills(m, wrap); } catch (e) { console.warn('[map3d] pillole', e); }
    installSearch();
    hideLoader(false);
  }
  function stop3D() {
    if (!view) return;
    restoreSearch();
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
      if (view) installSearch();
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
