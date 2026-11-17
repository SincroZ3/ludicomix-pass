/* ludi-map3d-internal.js - mappa interna /mappa: scelta 3D / 2D.
   Aggiunto alla pagina da routes/map3d-internal.js. Il 3D si apre per primo; il 2D resta disponibile e, quando la sincronizzazione
   3D -> 2D e attiva, e di sola lettura (le posizioni si modificano nell'editor 3D /admin/mappatest).
   Se WebGL manca o la zona non ha un layout 3D resta il 2D di sempre. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var tabs = document.querySelector('.zone-tabs');
  if (!tabs) return;
  var mode = null, view = null, bar = null, box = null, info = null, link = null, ro = false, admin = false, busy = 0;

  var css = document.createElement('style');
  css.textContent = '.m3i-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.6rem 0;font:600 .85rem system-ui,sans-serif;color:#2b1d4d}' +
    '.m3i-bar button,.m3i-bar a.m3i-a{border:1.5px solid #d9cff0;background:#fff;color:#4c2c78;border-radius:10px;padding:.4rem .8rem;font:800 .82rem system-ui,sans-serif;cursor:pointer;text-decoration:none}' +
    '.m3i-bar button.on{background:#6b3fa0;border-color:#6b3fa0;color:#fff}' +
    '.m3i-note{color:#6b5a8a;font-weight:600}' +
    '.m3i-box{display:none;position:relative;height:calc(100vh - 290px);min-height:420px;border-radius:14px;overflow:hidden;border:1px solid #ece6f7;background:linear-gradient(#e9e2f6,#f6f3fb)}' +
    'body.m3i-on .zone-panel{display:none!important}' +
    'body.m3i-on .m3i-box{display:block}';
  document.head.appendChild(css);

  function zoneKey() {
    var t = document.querySelector('.ztab.active');
    var k = t ? t.getAttribute('data-zone') : null;
    if (k == null) { var p = document.querySelector('.zone-panel.active'); k = p ? p.getAttribute('data-zone') : null; }
    return (k == null || k === '' || k === '0') ? null : k;
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
  function setMode(m) {
    mode = m;
    var on = m === '3d';
    document.body.classList.toggle('m3i-on', on);
    document.body.classList.toggle('m3i-ro', !on && ro);
    bar.querySelectorAll('button[data-m]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); });
    note.textContent = on ? '' : (ro ? '2D in sola lettura: le posizioni si modificano nel 3D (pulsante Modifica nel 3D).' : '');
    if (on) show3d(); else { busy++; stopView(); }
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
    window.switchZone = function () { var r = orig.apply(this, arguments); if (mode === '3d') show3d(); return r; };
  }

  fetch('/api/map3d/internal-status', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      ro = !!d.sync; admin = !!d.admin;
      bar = document.createElement('div'); bar.className = 'm3i-bar';
      bar.innerHTML = `<button type='button' data-m='3d'>3D</button><button type='button' data-m='2d'>2D</button>`;
      info = document.createElement('b');
      link = document.createElement('a'); link.className = 'm3i-a'; link.textContent = 'Apri scheda gruppo'; link.style.display = 'none';
      bar.appendChild(info); bar.appendChild(link); bar.appendChild(note);
      if (admin) { var ed = document.createElement('a'); ed.className = 'm3i-a'; ed.href = '/admin/mappatest'; ed.textContent = 'Modifica nel 3D'; bar.appendChild(ed); }
      box = document.createElement('div'); box.className = 'm3i-box';
      tabs.parentNode.insertBefore(bar, tabs.nextSibling);
      bar.parentNode.insertBefore(box, bar.nextSibling);
      bar.querySelectorAll('button[data-m]').forEach(function (b) { b.onclick = function () { setMode(b.getAttribute('data-m')); }; });
      setMode(zoneKey() ? '3d' : '2d');
    })
    .catch(function () { /* resta il 2D di sempre */ });
})();
