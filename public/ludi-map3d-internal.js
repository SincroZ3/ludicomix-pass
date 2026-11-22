/* ludi-map3d-internal.js - mappa interna /mappa: il 3D e la modalita principale di lavoro.
   Aggiunto alla pagina da routes/map3d-internal.js.
   - Chi puo modificare la mappa (admin, organizer, operator): la scheda 3D e l'editor completo di /admin/mappatest (taglio, ricerca stand, modifica, salvataggio) caricato dentro /mappa, senza cambiare pagina.
     La testata "Mappa Stand" della pagina resta; l'intestazione "test 3D" dell'editor e nascosta.
     /mappa?ed=0 apre invece la vista di sola lettura; /mappa?dbg=1 mostra gli errori JavaScript in un riquadro rosso.
   - Altri utenti: vista 3D di sola lettura.
   - Il 2D resta disponibile e, quando la sincronizzazione 3D -> 2D e attiva, e di sola lettura.
   - Oggetti senza stand (pulsante "Oggetto"): oltre a biglietteria, palco ecc. ci sono i Gazebo 3 x 3 m, 4 x 3 m e "ridimensionabile" (chiede le misure).
   Se WebGL manca o qualcosa non va resta il 2D di sempre. */
(function () {
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var VER = (SRC.split('v=')[1] || '').split('&')[0];
  var tabs = document.querySelector('.zone-tabs');
  if (!tabs) return;
  var mode = null, view = null, bar = null, box = null, edBox = null, info = null, link = null, ro = false, canEd = false, busy = 0, edP = null;
  var useEd = false, T3 = null;

  import('/ludi-env-defaults.js?v=' + VER).catch(function () { /* facoltativo */ });

  var css = document.createElement('style');
  css.textContent = '.m3i-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.6rem 0;font:600 .85rem system-ui,sans-serif;color:#2b1d4d}' +
    '.m3i-bar button,.m3i-bar a.m3i-a{border:1.5px solid #d9cff0;background:#fff;color:#4c2c78;border-radius:10px;padding:.4rem .8rem;font:800 .82rem system-ui,sans-serif;cursor:pointer;text-decoration:none}' +
    '.m3i-bar button.on{background:#6b3fa0;border-color:#6b3fa0;color:#fff}' +
    '.m3i-note{color:#6b5a8a;font-weight:600}' +
    '.m3i-dd{display:none;position:fixed;z-index:9500;background:#fff;border:1px solid #d9cff0;border-radius:14px;box-shadow:0 12px 32px rgba(30,20,60,.25);padding:.4rem;max-height:60vh;overflow:auto;font:600 .84rem system-ui,sans-serif;color:#2b1d4d}' +
    '.m3i-dd h5{margin:.35rem .5rem .2rem;font:800 .68rem system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#6b5a8a}' +
    '.m3i-dd button{display:flex;justify-content:space-between;gap:.8rem;width:100%;text-align:left;border:0;background:none;padding:.45rem .6rem;border-radius:10px;font:700 .84rem system-ui,sans-serif;color:#2b1d4d;cursor:pointer}' +
    '.m3i-dd button:hover{background:#f1ecfa}' +
    '.m3i-dd button[disabled]{opacity:.5;cursor:default}' +
    '.m3i-dd button small{color:#6b5a8a;font-weight:700;white-space:nowrap}' +
    '.m3i-dd .m3i-empty{padding:.5rem .6rem;color:#6b5a8a}' +
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
  // nasconde le schede zona e il riepilogo della pagina (l'editor ha i suoi); la testata "Mappa Stand" resta
  function tagChrome() {
    [].forEach.call(document.querySelectorAll('.mp-strip, .zone-tabs'), function (e) {
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

  // ---- evidenziazione degli stand trovati: viola con bagliore su TUTTE le parti (banconi, tavoli, pareti); gli altri grigi e trasparenti ----
  var glows = [], pulsing = false, glowTexture = null;
  function glowTex() {
    if (glowTexture || !T3) return glowTexture;
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(196,167,255,0.95)'); gr.addColorStop(0.55, 'rgba(139,92,246,0.55)'); gr.addColorStop(1, 'rgba(139,92,246,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowTexture = new T3.CanvasTexture(cv); return glowTexture;
  }
  function pulse(now) {
    glows = glows.filter(function (g) { return g.parent; });
    glows.forEach(function (g) { g.material.opacity = 0.6 + 0.35 * Math.sin(now / 320); });
    if (glows.length) requestAnimationFrame(pulse); else pulsing = false;
  }
  function setGlow(m, s, on) {
    var old = m.group.getObjectByName('m3glow');
    if (!on) { if (old) { m.group.remove(old); old.geometry.dispose(); old.material.dispose(); } return; }
    if (old || !T3 || !window.__mt) return;
    var d = window.__mt.dims(s);
    var mesh = new T3.Mesh(new T3.PlaneGeometry(d.w + 5, d.d + 5), new T3.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: T3.AdditiveBlending, opacity: 0.9 }));
    mesh.name = 'm3glow'; mesh.userData.m3glow = true; mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.09; mesh.raycast = function () {}; mesh.renderOrder = 4;
    m.group.add(mesh); glows.push(mesh);
    if (!pulsing) { pulsing = true; requestAnimationFrame(pulse); }
  }
  // chiamata dall'editor a ogni ridisegno: m = record dello stand (gruppo, materiale principale, ecc.), hit = corrisponde, active = ricerca attiva
  function hl(m, s, hit, active) {
    try {
      var g = m.group; if (!g) return;
      g.traverse(function (o) {
        if (!o.isMesh || !o.material || o === m.lab || (o.userData && (o.userData.isLabel || o.userData.m3glow))) return;
        var arr = Array.isArray(o.material), list = arr ? o.material : [o.material];
        list.forEach(function (mt, i) {
          if (!mt || !mt.emissive || !mt.color) return;
          var c = mt;
          if (mt !== m.mat) {
            if (!(mt.userData && mt.userData.__m3)) {
              c = mt.clone();
              c.userData = { __m3: { color: mt.color.clone(), emissive: mt.emissive.clone(), ei: mt.emissiveIntensity, op: mt.opacity, tr: mt.transparent, dw: mt.depthWrite } };
              if (arr) o.material[i] = c; else o.material = c;
            }
          }
          var base = c.userData && c.userData.__m3;
          if (active && hit) { c.color.set('#8b5cf6'); c.emissive.set('#a78bfa'); c.emissiveIntensity = 0.65; c.transparent = false; c.opacity = 1; c.depthWrite = true; }
          else if (active) { if (c !== m.mat) { c.color.set('#9ca3af'); c.emissive.set('#000000'); c.emissiveIntensity = 0; c.transparent = true; c.opacity = 0.18; c.depthWrite = false; } }
          else if (base && c !== m.mat) { c.color.copy(base.color); c.emissive.copy(base.emissive); c.emissiveIntensity = base.ei; c.transparent = base.tr; c.opacity = base.op; c.depthWrite = base.dw; }
          c.needsUpdate = true;
        });
      });
      setGlow(m, s, !!(active && hit));
    } catch (e) { if (!hl.err) { hl.err = 1; console.warn('[map3d-internal] evidenziazione', e); } }
  }
  window.__mtHL = hl;

  // Codice aggiunto in fondo al modulo dell'editor (gira nel suo ambito): confronto della ricerca e accesso a scena, camera e zone.
  var HOOK = String.raw`
window.__mt = {
  get zone() { return ZN; },
  stands: stands, meshes: meshes, camera: camera, controls: controls,
  setZone: function (n) { return setZone(n); },
  W: function () { return W; }, D: function () { return D; },
  dims: dims, baseOf: baseOf,
  pick: function (id) { selected = id; try { refresh(); } catch (e) { /* ok */ } }
};
function __n(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function __m(s, q) { const h = __n(s.name + ' ' + (s.code || '')); return q.split(/\s+/).every(function (w) { return h.indexOf(w) > -1; }); }
`;

  // Gazebo tra gli oggetti senza stand (pulsante "Oggetto" dell'editor): 3 x 3 m, 4 x 3 m e "ridimensionabile" (chiede larghezza e profondita;
  // dopo si possono comunque cambiare con "Ridimensiona"). Sono gli stessi modelli dei gazebo degli stand (out-3x3, out-4x3), quindi
  // si vedono uguali ovunque (mappa pubblica, portale, 3D). Se il testo dell'editor non e quello atteso non cambia nulla.
  var GZ = [
    [String.raw`const it = await openCoverflow(CAT_OBJ, 'Oggetto senza stand');`,
      String.raw`let it = await openCoverflow(CAT_OBJ, 'Oggetto senza stand'); if (it && it.free) { const fw = parseFloat(String(prompt('Larghezza del gazebo (m)', '3') || '').replace(',', '.')), fd = parseFloat(String(prompt('Profondit\u00e0 del gazebo (m)', '3') || '').replace(',', '.')); if (!(fw > 0) || !(fd > 0)) it = null; else it = Object.assign({}, it, { w: Math.max(1, Math.min(30, fw)), d: Math.max(1, Math.min(30, fd)) }); }`],
    [String.raw`{ custom: true, label: 'Altro (disegna)', sub: 'Disegni la forma in mappa', color: '#16a085', icon: ICON.custom }];`,
      String.raw`{ key: 'out-3x3', label: 'Gazebo 3 \u00d7 3 m', sub: 'Gazebo degli stand', w: 3, d: 3, h: 3.4, color: '#6b3fa0', icon: ICON.gaz, build: buildGazebo },
  { key: 'out-4x3', label: 'Gazebo 4 \u00d7 3 m', sub: 'Gazebo degli stand', w: 4, d: 3, h: 3.4, color: '#6b3fa0', icon: ICON.gaz, build: buildGazebo },
  { key: 'out-3x3', free: true, label: 'Gazebo ridimensionabile', sub: 'Scegli tu le misure', w: 3, d: 3, h: 3.4, color: '#6b3fa0', icon: ICON.gaz, build: buildGazebo },
  { custom: true, label: 'Altro (disegna)', sub: 'Disegni la forma in mappa', color: '#16a085', icon: ICON.custom }];`],
    [String.raw`CAT_IN.concat(CAT_OUT, CAT_OBJ).forEach(it => { if (it.key) MODEL_DEFS[it.key] = it; });`,
      String.raw`CAT_IN.concat(CAT_OUT, CAT_OBJ).forEach(it => { if (it.key && !MODEL_DEFS[it.key]) MODEL_DEFS[it.key] = it; });`]
  ];
  function patchGazebi(src) {
    for (var i = 0; i < GZ.length; i++) if (src.indexOf(GZ[i][0]) < 0) return src;
    GZ.forEach(function (p) { src = src.replace(p[0], function () { return p[1]; }); });
    return src;
  }

  // Importa l'editor correggendo la ricerca: senza distinzione di maiuscole/accenti, piu parole, anche il codice dello stand;
  // gli stand non trovati diventano grigi e trasparenti, quelli trovati viola con bagliore.
  // Se il testo dell'editor non e quello atteso, usa l'editor cosi com'e.
  async function importEditor() {
    try {
      var src = await (await fetch('/ludi-mappatest.js?v=' + VER, { credentials: 'same-origin' })).text();
      var a = 'const q = query.trim().toLowerCase();', b = 'hit = q && s.name.toLowerCase().indexOf(q) > -1;', c = 'm.mat.opacity = (q && !hit) ? .2 : 1;';
      if (src.indexOf(a) < 0 || src.indexOf(b) < 0) throw new Error('ricerca dell\'editor non riconosciuta');
      src = src.replace(a, function () { return 'const q = __n(query);'; }).replace(b, function () { return 'hit = q && __m(s, q);'; });
      if (src.indexOf(c) >= 0) src = src.replace(c, function () { return 'm.mat.opacity = (q && !hit) ? .18 : 1; if (q && !hit) m.mat.color.set(\'#9ca3af\'); if (window.__mtHL) window.__mtHL(m, s, !!(q && hit), !!q);'; });
      src = patchGazebi(src);
      src += '\n' + HOOK;
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      await import(url);
    } catch (e) {
      console.warn('[map3d-internal] editor non modificato', e);
      await import('/ludi-mappatest.js?v=' + VER);
    }
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
      try { T3 = await import('three'); } catch (e) { T3 = null; }
      edBox.innerHTML = '';
      var s = document.createElement('script'); s.id = 'mt-data'; s.type = 'application/json'; s.textContent = d.textContent; edBox.appendChild(s);
      var root = document.createElement('div'); root.id = 'mt-root'; edBox.appendChild(root);
      await importEditor();
      var more = ['ludi-mappatest-parco.js', 'ludi-mappatest-vanvere.js', 'ludi-mappatest-ui.js', 'ludi-mappatest-clip.js'];
      for (var i = 0; i < more.length; i++) {
        try { await import('/' + more[i] + '?v=' + VER); } catch (e) { console.warn('[map3d-internal]', more[i], e); }
      }
    })();
    return edP;
  }

  // Avvicina la camera allo stand con un movimento morbido (vista a circa 35 gradi, mantenendo l'orientamento attuale)
  function focusStand(id) {
    var M = window.__mt; if (!M) return false;
    var s = M.stands.filter(function (x) { return x.id === id; })[0];
    if (!s || !s.placed || !M.meshes.has(id)) return false;
    var d = M.dims(s), cx = (s.fx - 0.5) * M.W(), cz = (s.fy - 0.5) * M.D(), cy = M.baseOf(s) + Math.min(s.h || 2, 3) / 2;
    var R = Math.max(12, Math.max(d.w, d.d) * 1.8 + 8);
    var cam = M.camera, ctl = M.controls;
    var hx = cam.position.x - ctl.target.x, hz = cam.position.z - ctl.target.z, hl2 = Math.hypot(hx, hz);
    if (hl2 < 0.5) { hx = 0; hz = 1; hl2 = 1; }
    hx /= hl2; hz /= hl2;
    var el = 35 * Math.PI / 180;
    var p1 = { x: cx + hx * R * Math.cos(el), y: cy + R * Math.sin(el), z: cz + hz * R * Math.cos(el) };
    var p0 = { x: cam.position.x, y: cam.position.y, z: cam.position.z }, t0 = { x: ctl.target.x, y: ctl.target.y, z: ctl.target.z };
    var start = performance.now(), dur = 700;
    (function step(now) {
      var k = Math.min(1, (now - start) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.position.set(p0.x + (p1.x - p0.x) * e, p0.y + (p1.y - p0.y) * e, p0.z + (p1.z - p0.z) * e);
      ctl.target.set(t0.x + (cx - t0.x) * e, t0.y + (cy - t0.y) * e, t0.z + (cz - t0.z) * e);
      try { ctl.update(); } catch (er) { /* ok */ }
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
    return true;
  }

  // Menu a comparsa sotto il campo di ricerca dell'editor: stand dell'area aperta; quelli di altre aree sono segnalati a parte e portano all'area giusta
  function enhanceSearch() {
    if (document.getElementById('m3i-dd')) return;
    var q = document.getElementById('q'), dEl = document.getElementById('mt-data');
    if (!q || !dEl) return;
    var data; try { data = JSON.parse(dEl.textContent); } catch (e) { return; }
    var list = (data.stands || []).filter(function (s) { return s.kind !== 'obj' && s.id > 0; });
    var dd = document.createElement('div'); dd.id = 'm3i-dd'; dd.className = 'm3i-dd';
    document.body.appendChild(dd);
    var quiet = false;
    function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
    function curZone() {
      var M = window.__mt; if (M) return M.zone;
      var b = document.querySelector('#zt .ztab.active'); return b && b.firstChild ? String(b.firstChild.textContent).trim() : '';
    }
    function goZone(name) {
      var b = [].filter.call(document.querySelectorAll('#zt .ztab'), function (x) { return x.firstChild && String(x.firstChild.textContent).trim() === name; })[0];
      if (b) b.click();
    }
    function hide() { dd.style.display = 'none'; }
    function place() {
      var r = q.getBoundingClientRect(), w = Math.min(460, window.innerWidth - 16);
      dd.style.width = w + 'px';
      dd.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      dd.style.top = (r.bottom + 6) + 'px';
      dd.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 20) + 'px';
    }
    // il cambio area dell'editor azzera la ricerca (query e campo di testo): la rimettiamo, cosi lo stand resta evidenziato nella nuova area
    function openStand(s) {
      hide();
      var M = window.__mt;
      if (!M) { goZone(s.zone); return; }
      var txt = q.value;
      function reapply() {
        if (q.value !== txt) q.value = txt;
        quiet = true; q.dispatchEvent(new Event('input')); quiet = false;
      }
      function go() { M.pick(s.id); focusStand(s.id); }
      if (M.zone === s.zone && M.meshes.has(s.id)) { go(); return; }
      M.setZone(s.zone);
      var t0 = Date.now();
      (function wait() {
        if (M.zone === s.zone && M.meshes.has(s.id)) {
          reapply(); hide(); go();
          setTimeout(function () { reapply(); hide(); }, 300);
          setTimeout(function () { reapply(); hide(); }, 900);
        }
        else if (Date.now() - t0 < 5000) setTimeout(wait, 120);
      })();
    }
    function head(text) { var h = document.createElement('h5'); h.textContent = text; dd.appendChild(h); }
    function item(s, withZone) {
      var b = document.createElement('button'); b.type = 'button';
      var n = document.createElement('span'); n.textContent = s.name + (s.code ? ' (' + s.code + ')' : '');
      var z = document.createElement('small'); z.textContent = (withZone ? (s.zone || 'senza zona') : '') + (s.L ? '' : (withZone ? ' \u00b7 ' : '') + 'non posizionato in 3D');
      b.appendChild(n); b.appendChild(z);
      if (!s.L) { b.disabled = true; b.title = 'Questo stand non e ancora stato posizionato nella pianta 3D'; } else b.onclick = function () { openStand(s); };
      dd.appendChild(b);
    }
    function run() {
      var t = norm(q.value).split(/\s+/).filter(Boolean);
      dd.innerHTML = '';
      if (!t.length) { hide(); return; }
      var cz = curZone();
      var hits = list.filter(function (s) { var h = norm(s.name + ' ' + (s.code || '')); return t.every(function (w) { return h.indexOf(w) > -1; }); });
      var here = hits.filter(function (s) { return s.zone === cz; }), other = hits.filter(function (s) { return s.zone !== cz; });
      head('In quest\'area (' + cz + ')');
      if (!here.length) { var e1 = document.createElement('div'); e1.className = 'm3i-empty'; e1.textContent = 'Nessuno stand trovato in quest\'area.'; dd.appendChild(e1); }
      here.slice(0, 15).forEach(function (s) { item(s, false); });
      if (other.length) {
        head('Trovati in altre aree');
        other.slice(0, 15).forEach(function (s) { item(s, true); });
      }
      place(); dd.style.display = 'block';
    }
    q.addEventListener('input', function () { if (!quiet) run(); });
    q.addEventListener('focus', function () { if (q.value.trim()) run(); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    document.addEventListener('mousedown', function (e) { if (e.target !== q && !dd.contains(e.target)) hide(); });
    window.addEventListener('resize', function () { if (dd.style.display === 'block') place(); });
    window.addEventListener('scroll', function () { if (dd.style.display === 'block') place(); }, true);
    var zt = document.getElementById('zt');
    if (zt && window.MutationObserver) new MutationObserver(function () { if (dd.style.display === 'block' && q.value.trim()) run(); }).observe(zt, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
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
    try { enhanceSearch(); } catch (e) { console.warn('[map3d-internal] ricerca', e); }
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
    var dd = document.getElementById('m3i-dd'); if (dd && !on) dd.style.display = 'none';
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
