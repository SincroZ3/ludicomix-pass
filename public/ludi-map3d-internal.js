/* ludi-map3d-internal.js - mappa interna /mappa: il 3D e la modalita principale di lavoro.
   Aggiunto alla pagina da routes/map3d-internal.js.
   - Chi puo modificare la mappa (admin, organizer, operator): la scheda 3D e l'editor completo di /admin/mappatest (taglio, ricerca stand, modifica, salvataggio) caricato dentro /mappa, senza cambiare pagina.
     /mappa?ed=0 apre invece la vista di sola lettura; /mappa?dbg=1 mostra gli errori JavaScript in un riquadro rosso.
   - Altri utenti: vista 3D di sola lettura.
   - Il 2D resta disponibile e, quando la sincronizzazione 3D -> 2D e attiva, e di sola lettura.
   Se WebGL manca o qualcosa non va resta il 2D di sempre. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var tabs = document.querySelector('.zone-tabs');
  if (!tabs) return;
  var mode = null, view = null, bar = null, box = null, edBox = null, info = null, link = null, ro = false, canEd = false, busy = 0, edP = null;
  var useEd = false;

  import('/ludi-env-defaults.js?v=' + VER).catch(function () { /* facoltativo */ });

  var css = document.createElement('style');
  css.textContent = '.m3i-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.6rem 0;font:600 .85rem system-ui,sans-serif;color:#2b1d4d}' +
    '.m3i-bar button,.m3i-bar a.m3i-a{border:1.5px solid #d9cff0;background:#fff;color:#4c2c78;border-radius:10px;padding:.4rem .8rem;font:800 .82rem system-ui,sans-serif;cursor:pointer;text-decoration:none}' +
    '.m3i-bar button.on{background:#6b3fa0;border-color:#6b3fa0;color:#fff}' +
    '.m3i-note{color:#6b5a8a;font-weight:600}' +
    '.m3i-box{display:none;position:relative;height:calc(100vh - 290px);min-height:420px;border-radius:14px;overflow:hidden;border:1px solid #ece6f7;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    'div.m3i-edbox{display:none}' +
    '.m3i-load{padding:1rem;font:600 .9rem system-ui,sans-serif;color:#6b5a8a}' +
    'body.m3i-on .zone-panel{display:none!important}' +
    'body.m3i-on .m3i-box{display:block}' +
    'body.m3i-on div.m3i-edbox{display:block}' +
    'body.m3i-edm .m3i-pg{display:none!important}' +
    '#mt-root .mp-hero{display:none!important}';
  document.head.appendChild(css);

  function showErrors() {
    function show(msg) {
      var d = document.getElementById('m3i-err');
      if (!d) {
        d = document.createElement('pre'); d.id = 'm3i-err';
        d.style.cssText = 'position:fixed;left:8px;top:8px;right:8px;max-height:45vh;overflow:auto;z-index:2147483647;background:#fff;color:#b00020;border:2px solid #b00020;border-radius:8px;padding:8px;font:12px/1.4 monospace;white-space:pre-wrap';
        document.documentElement.appendChild(d);
      }
      d.textContent += msg + '\n';
    }
    window.addEventListener('error', function (e) { show('ERRORE: ' + e.message + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')'); });
    window.addEventListener('unhandledrejection', function (e) { show('PROMESSA RIFIUTATA: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)); });
  }

  function zoneKey() {
    var t = document.querySelector('.ztab.active');
    var k = t ? t.getAttribute('data-zone') : null;
    if (k == null) { var p = document.querySelector('.zone-panel.active'); k = p ? p.getAttribute('data-zone') : null; }
    return (k == null || k === '' || k === '0') ? null : k;
  }
  function tagChrome() {
    [].forEach.call(document.querySelectorAll('.mp-hero, .mp-strip, .zone-tabs'), function (e) {
      if (!e.closest('#mt-root')) e.classList.add('m3i-pg');
    });
  }
  function stopView() { try { if (view) view.dispose(); } catch (e) { /* gia chiuso */ } view = null; }
  function setInfo(s) {
    if (!info) return;
    info.textContent = s ? s.name + (s.code ? ' - ' + s.code : '') : '';
    if (link) {
      if (s && s.kind !== 'obj' && s.id > 0) { link.href = '/assignment-groups/' + s.id; link.style.display = ''; } else { link.style.display = 'none'; }
    }
  }
  function onPick(id, s) { setInfo(s || null); }

  async function show3d() {
    var k = zoneKey();
    if (!k) { setMode('2d'); return; }
    stopView(); box.innerHTML = ''; setInfo(null);
    var my = ++busy, v = null;
    try {
      var mod = await import('/ludi-map3d-view.js?v=' + VER);
      v = await mod.createMap3D(box, { zoneId: 'i-' + k, clickable: 'all', env: true, menu: true, onSelect: onPick });
    } catch (e) { console.warn('[map3d-internal]', e); v = null; }
    if (my !== busy) { if (v) v.dispose(); return; }
    if (!v) { setMode('2d'); return; }
    view = v;
  }

  function loadEditor() {
    if (edP) return edP;
    edP = (async function () {
      edBox.innerHTML = '<div class="m3i-load">Caricamento dell\'editor 3D...</div>';
      var r = await fetch('/admin/mappatest', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      var d = doc.getElementById('mt-data');
      if (!d) throw new Error('dati dell\'editor mancanti');
      if (!document.getElementById('m3i-edcss')) {
        var l = document.createElement('link'); l.id = 'm3i-edcss'; l.rel = 'stylesheet'; l.href = '/ludi-mappatest.css?v=' + VER; document.head.appendChild(l);
      }
      edBox.innerHTML = '';
      var s = document.createElement('script'); s.id = 'mt-data'; s.type = 'application/json'; s.textContent = d.textContent; edBox.appendChild(s);
      var root = document.createElement('div'); root.id = 'mt-root'; edBox.appendChild(root);
      await import('/ludi-mappatest.js?v=' + VER);
      var more = ['ludi-mappatest-parco.js', 'ludi-mappatest-vanvere.js', 'ludi-mappatest-ui.js', 'ludi-mappatest-clip.js'];
      for (var i = 0; i < more.length; i++) {
        try { await import('/' + more[i] + '?v=' + VER); } catch (e) { console.warn('[map3d-internal]', more[i], e); }
      }
    })();
    return edP;
  }
  async function showEditor() {
    tagChrome();
    var my = ++busy;
    try { await loadEditor(); }
    catch (e) {
      console.warn('[map3d-internal] editor', e); edP = null;
      if (my === busy) { edBox.innerHTML = ''; setMode('2d'); note.textContent = 'Editor 3D non disponibile: resta il 2D.'; }
      return;
    }
    tagChrome();
    setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ok */ } }, 60);
  }

  function setMode(m) {
    mode = m;
    var on = m === '3d';
    if (useEd) tagChrome();
    document.body.classList.toggle('m3i-on', on);
    document.body.classList.toggle('m3i-edm', on && useEd);
    document.body.classList.toggle('m3i-ro', !on && ro);
    bar.querySelectorAll('button[data-m]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); });
    note.textContent = on ? '' : (ro ? '2D in sola lettura: le posizioni si modificano nel 3D.' : '');
    if (on) { if (useEd) showEditor(); else show3d(); } else { busy++; stopView(); }
  }

  var note = document.createElement('span'); note.className = 'm3i-note';

  function blocker(e) {
    if (mode !== '2d' || !ro) return;
    var t = e.target;
    if (t && t.closest && t.closest('.zone-panel .stand-box, .zone-panel .chip-box, .zone-panel .oob-chip')) {
      e.stopImmediatePropagation();
      if (e.type === 'dragstart') e.preventDefault();
    }
  }
  ['mousedown', 'touchstart', 'pointerdown', 'dragstart'].forEach(function (ev) { document.addEventListener(ev, blocker, true); });

  var orig = window.switchZone;
  if (typeof orig === 'function') {
    window.switchZone = function () { var r = orig.apply(this, arguments); if (mode === '3d' && !useEd) show3d(); return r; };
  }

  if (/[?&]dbg=1(&|$)/.test(location.search)) showErrors();

  fetch('/api/map3d/internal-status', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      ro = !!d.sync; canEd = !!(d.editor || d.admin); useEd = canEd && !/[?&]ed=0(&|$)/.test(location.search);
      bar = document.createElement('div'); bar.className = 'm3i-bar';
      bar.innerHTML = `<button type='button' data-m='3d'>3D</button><button type='button' data-m='2d'>2D</button>`;
      if (!useEd) {
        info = document.createElement('b');
        link = document.createElement('a'); link.className = 'm3i-a'; link.textContent = 'Apri scheda gruppo'; link.style.display = 'none';
        bar.appendChild(info); bar.appendChild(link);
        if (canEd) {
          var ed = document.createElement('a'); ed.className = 'm3i-a'; ed.href = '/mappa'; ed.textContent = 'Modifica nel 3D'; bar.appendChild(ed);
        }
      }
      bar.appendChild(note);
      tabs.parentNode.insertBefore(bar, tabs.nextSibling);
      if (useEd) {
        edBox = document.createElement('div'); edBox.className = 'm3i-edbox';
        bar.parentNode.insertBefore(edBox, bar.nextSibling);
      } else {
        box = document.createElement('div'); box.className = 'm3i-box';
        bar.parentNode.insertBefore(box, bar.nextSibling);
      }
      bar.querySelectorAll('button[data-m]').forEach(function (b) { b.onclick = function () { setMode(b.getAttribute('data-m')); }; });
      setMode(useEd || zoneKey() ? '3d' : '2d');
    })
    .catch(function () { /* resta il 2D di sempre */ });
})();
