/* ludi-mappatest.js — Mappa Stand TEST: vista 3D con disegno e modifica forme, blocco stand, salvataggio in tabelle separate.
   Pagina: /admin/mappatest (solo admin). Non modifica le posizioni della mappa reale. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DATA = JSON.parse(document.getElementById('mt-data').textContent);
const root = document.getElementById('mt-root');
document.body.classList.add('mp-on');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const api = (url, body, method) => fetch(url, { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(r => r.json().catch(() => ({})).then(d => Object.assign({ status: r.status }, d)))
  .catch(() => ({ ok: false, status: 0, error: 'Errore di rete' }));

const zones = DATA.zones;
const stands = DATA.stands.map(s => {
  const L = s.L;
  return { id: s.id, name: s.name, zone: s.zone, code: s.code, pass: s.pc || 0, done: s.cs || 0, notes: s.notes, importable: !!s.importable, placed: !!L,
    fx: L ? L.fx : .5, fy: L ? L.fy : .5, wf: L ? L.wf : .03, df: L ? L.df : .03, rot: L ? L.rot : 0, shape: L ? L.shape : null, h: L ? L.h : 2.5, locked: L ? !!L.locked : false };
});

root.innerHTML = '' +
'<section class="mp-hero"><div><h1>Mappa Stand · test 3D</h1><p>Pagina di prova: i dati si salvano in tabelle separate e non toccano la mappa reale</p></div><div class="mp-hero-stats" id="hs"></div></section>' +
'<div class="zone-tabs" id="zt"></div>' +
'<div class="mp-strip"><div class="mp-kpis" id="kp"></div><label class="mp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg><input id="q" type="search" placeholder="Cerca stand nella zona\u2026"></label></div>' +
'<div class="mt-main"><div class="mt-card">' +
 '<div class="mt-bar"><div class="mt-seg" id="views"><button data-v="top">Dall\'alto</button><button data-v="persp" class="on">Prospettiva</button><button data-v="iso">Isometrica</button></div>' +
 '<div class="mt-seg" id="modes"><button data-m="pass" class="on">Pass</button><button data-m="neutro">Neutro</button></div>' +
 '<label class="mt-chk"><input type="checkbox" id="lab" checked> Etichette</label><label class="mt-chk"><input type="checkbox" id="shd" checked> Ombre</label>' +
 '<label class="mt-chk">Altezze <input type="range" id="hsl" min="30" max="200" value="100"></label></div>' +
 '<div class="mt-view" id="vw"><div class="mt-banner" id="bn"></div><div class="mt-leg" id="lg"></div><div class="mt-tray" id="tr"></div><div class="mt-msg" id="ms"></div></div>' +
'</div><aside class="mt-side">' +
 '<div class="mt-panel"><h3>Scala e dati</h3><label class="mt-f">Larghezza reale della pianta (m)<input id="wm" type="number" min="10" max="500" step="0.5"></label>' +
 '<div class="mt-row"><button class="mt-btn" id="imp">Importa dalla mappa attuale</button></div><div class="mt-note" id="impn"></div>' +
 '<div class="mt-row"><button class="mt-btn lock" id="la">\uD83D\uDD12 Blocca tutti</button><button class="mt-btn" id="ua">Sblocca tutti</button><button class="mt-btn" id="ex">Esporta JSON</button></div></div>' +
 '<div class="mt-panel" id="sel"></div>' +
 '<div class="mt-panel"><h3>Come si usa</h3><div class="mt-note">Tasto sinistro sul pavimento: ruota la vista \u00b7 destro: sposta \u00b7 rotellina: zoom. Trascina gli stand per spostarli (aggancio a 0,5 m). Per gli stand \u201cda posizionare\u201d scegli il nome nella barra in basso e disegna la forma sulla pianta. Con \u201cModifica forma\u201d sposti i vertici, aggiungi punti dai segni gialli e togli un punto con doppio clic. Gli stand bloccati non si muovono per errore.</div></div>' +
'</aside></div><div id="mt-tip"></div><div id="mt-toast"></div>';

const vw = $('vw');
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { $('ms').style.display = 'flex'; $('ms').textContent = 'Il tuo browser non supporta WebGL: la vista 3D non \u00e8 disponibile.'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0x000000, 0);
vw.insertBefore(renderer.domElement, vw.firstChild);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.03; controls.minDistance = 8; controls.maxDistance = 400;
scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a6e0, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.15); sun.position.set(-40, 70, 30); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun);
const world = new THREE.Group(); scene.add(world);
const overlay = new THREE.Group(); scene.add(overlay);

let ZN = null, Z = null, W = 80, D = 30;
let mode = 'pass', labelsOn = true, hScale = 1, selected = null, query = '';
let floorMesh = null, slab = null, floorToken = 0, curView = 'persp';
const meshes = new Map();
const zs = () => stands.filter(s => s.zone === ZN);
const dims = s => ({ w: s.wf * W, d: s.df * D });
const COL = { grey: '#9ca3af', green: '#2d6a4f', yellow: '#c9a227', red: '#c0392b', neutro: '#6b3fa0' };
function colorOf(s) { if (mode === 'neutro') return COL.neutro; if (!s.pass) return COL.grey; const p = s.done / s.pass; return p >= .8 ? COL.green : p > 0 ? COL.yellow : COL.red; }
let tt; function toast(t) { const e = $('mt-toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => e.style.display = 'none', 2600); }

/* ---------- pavimento ---------- */
function fitSun() { const c = sun.shadow.camera, r = Math.max(W, D) * 0.7; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 400; c.updateProjectionMatrix(); }
function composeFloor(bg, cb) {
  const cw = 2048, ch = Math.max(256, Math.round(cw * D / W)); const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch);
  const done = () => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; cb(t); };
  if (!bg) { g.strokeStyle = '#e4dcf3'; g.lineWidth = 2; const st = cw / 16; for (let x = 0; x <= cw; x += st) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ch); g.stroke(); } for (let y = 0; y <= ch; y += st) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); } done(); return; }
  const img = new Image(); img.onload = () => { const sc = Math.min(cw / img.width, ch / img.height); g.drawImage(img, (cw - img.width * sc) / 2, 0, img.width * sc, img.height * sc); done(); };
  img.onerror = () => { done(); }; img.src = '/zone-bg/' + encodeURIComponent(bg);
}
function buildFloor() {
  const my = ++floorToken;
  if (floorMesh) { world.remove(floorMesh); floorMesh.geometry.dispose(); floorMesh = null; }
  if (slab) { world.remove(slab); slab.geometry.dispose(); slab = null; }
  if (!Z) return;
  slab = new THREE.Mesh(new THREE.BoxGeometry(W + 3, .6, D + 3), new THREE.MeshStandardMaterial({ color: 0xd9cff0, roughness: 1 }));
  slab.position.y = -.31; slab.receiveShadow = true; world.add(slab);
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95 }));
  floorMesh.rotation.x = -Math.PI / 2; floorMesh.receiveShadow = true; world.add(floorMesh);
  composeFloor(Z.bg, t => { if (my !== floorToken || !floorMesh) return; floorMesh.material.map = t; floorMesh.material.needsUpdate = true; });
  fitSun();
}

/* ---------- stand ---------- */
function labelTexture(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 40; g.font = 'bold ' + fs + 'px sans-serif';
  while (g.measureText(text).width > 236 && fs > 16) { fs -= 2; g.font = 'bold ' + fs + 'px sans-serif'; }
  g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 6; g.fillText(text, 128, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const lockTex = (() => { const cv = document.createElement('canvas'); cv.width = 96; cv.height = 96; const g = cv.getContext('2d');
  g.fillStyle = '#fff8dd'; g.beginPath(); g.arc(48, 48, 44, 0, 7); g.fill(); g.strokeStyle = '#c9a227'; g.lineWidth = 5; g.stroke();
  g.font = '50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\uD83D\uDD12', 48, 52);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
function clearStands() { meshes.forEach(m => { world.remove(m.group); m.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }); meshes.clear(); }
function buildStand(s) {
  if (meshes.has(s.id)) { const old = meshes.get(s.id); world.remove(old.group); old.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); meshes.delete(s.id); }
  if (!s.placed || s.zone !== ZN) return;
  const { w, d } = dims(s); let geo;
  if (s.shape) {
    const sh = new THREE.Shape(); s.shape.forEach((p, i) => { const x = (p[0] - .5) * w, y = (.5 - p[1]) * d; i ? sh.lineTo(x, y) : sh.moveTo(x, y); });
    geo = new THREE.ExtrudeGeometry(sh, { depth: s.h, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
  } else { geo = new THREE.BoxGeometry(w, s.h, d); geo.translate(0, s.h / 2, 0); }
  const mat = new THREE.MeshStandardMaterial({ color: colorOf(s), roughness: .6, metalness: .05 });
  const body = new THREE.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true; body.userData.id = s.id;
  const emat = new THREE.LineBasicMaterial({ color: s.locked ? 0xc9a227 : 0x1e2d4e, transparent: true, opacity: s.locked ? .95 : .35 });
  body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), emat));
  const ls = Math.max(Math.min(w, d * 3), 2.2);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls / 2), new THREE.MeshBasicMaterial({ map: labelTexture(s.name), transparent: true, depthWrite: false }));
  lab.rotation.x = -Math.PI / 2; lab.position.y = s.h + .03; lab.visible = labelsOn; lab.raycast = () => {}; body.add(lab);
  const grp = new THREE.Group(); grp.add(body);
  const lk = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, depthTest: false })); lk.scale.set(2, 2, 1); lk.visible = !!s.locked; lk.raycast = () => {}; lk.renderOrder = 5; grp.add(lk);
  grp.position.set((s.fx - .5) * W, 0, (s.fy - .5) * D); grp.rotation.y = -s.rot * Math.PI / 180; body.scale.y = hScale; lk.position.y = s.h * hScale + 1.6;
  world.add(grp); meshes.set(s.id, { group: grp, body, mat, lab, emat, lk });
}
function worldPts(s) {
  const { w, d } = dims(s); const cx = (s.fx - .5) * W, cz = (s.fy - .5) * D, a = -s.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const loc = s.shape ? s.shape.map(p => [(p[0] - .5) * w, (p[1] - .5) * d]) : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  return loc.map(p => [cx + p[0] * c + p[1] * sn, cz - p[0] * sn + p[1] * c]);
}
function applyWorldPts(s, pts) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
  const w = Math.max(.5, x1 - x0), d = Math.max(.5, z1 - z0);
  s.fx = ((x0 + x1) / 2) / W + .5; s.fy = ((z0 + z1) / 2) / D + .5; s.wf = w / W; s.df = d / D; s.rot = 0;
  s.shape = pts.map(p => [(p[0] - x0) / w, (p[1] - z0) / d]);
}
function overlap(a, b) {
  const A = worldPts(a), B = worldPts(b);
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const p1 = P[i], p2 = P[(i + 1) % P.length]; const ax = p2[1] - p1[1], ay = p1[0] - p2[0];
    let mA = 1e9, MA = -1e9, mB = 1e9, MB = -1e9;
    A.forEach(p => { const v = p[0] * ax + p[1] * ay; mA = Math.min(mA, v); MA = Math.max(MA, v); });
    B.forEach(p => { const v = p[0] * ax + p[1] * ay; mB = Math.min(mB, v); MB = Math.max(MB, v); });
    const eps = 1e-3 * Math.hypot(ax, ay); if (MA <= mB + eps || MB <= mA + eps) return false;
  }
  return true;
}
let conflicts = new Set();
function computeConflicts() { conflicts = new Set(); const pl = zs().filter(s => s.placed); for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) if (overlap(pl[i], pl[j])) { conflicts.add(pl[i].id); conflicts.add(pl[j].id); } }
function paint() {
  const q = query.trim().toLowerCase();
  zs().forEach(s => {
    const m = meshes.get(s.id); if (!m) return; m.mat.color.set(colorOf(s));
    const sel = selected === s.id, bad = conflicts.has(s.id), hit = q && s.name.toLowerCase().indexOf(q) > -1;
    m.mat.emissive.set(bad ? 0xff2a2a : hit ? 0xf5c842 : sel ? 0xffffff : 0x000000); m.mat.emissiveIntensity = bad ? .55 : hit ? .6 : sel ? .28 : 0;
    m.mat.transparent = !!q && !hit; m.mat.opacity = (q && !hit) ? .2 : 1; m.mat.needsUpdate = true;
    m.emat.color.set(s.locked ? 0xc9a227 : 0x1e2d4e); m.emat.opacity = s.locked ? .95 : .35; m.lk.visible = !!s.locked;
  });
}

/* ---------- interfaccia ---------- */
function kpi(n, label, warn) { return '<span class="mp-k' + (warn ? ' warn' : '') + '"><b>' + esc(n) + '</b>' + esc(label) + '</span>'; }
function renderTabs() {
  const zt = $('zt'); zt.innerHTML = '';
  const mk = (name, label, n) => { const b = document.createElement('button'); b.className = 'ztab' + (ZN === name && (ZN !== null || name === null) ? ' active' : ''); b.innerHTML = esc(label) + ' <span>' + n + '</span>'; b.onclick = () => setZone(name); zt.appendChild(b); };
  zones.forEach(z => mk(z.name, z.name, stands.filter(s => s.zone === z.name).length));
  const nz = stands.filter(s => !zones.some(z => z.name === s.zone)).length; if (nz) mk(null, '\u2753 Senza zona', nz);
}
function refresh() {
  computeConflicts(); paint();
  const all = stands.filter(s => zones.some(z => z.name === s.zone));
  $('hs').innerHTML = kpi(zones.length, ' zone') + kpi(all.filter(s => s.placed).length, ' stand in pianta') + kpi(all.filter(s => !s.placed).length, ' da posizionare', all.some(s => !s.placed));
  const zl = zs(), pl = zl.filter(s => s.placed); let area = 0, pc = 0, cs = 0; pl.forEach(s => { const d = dims(s); area += d.w * d.d; pc += s.pass; cs += s.done; });
  $('kp').innerHTML = ZN === null ? '' : kpi(pl.length, ' in pianta') + kpi(zl.length - pl.length, ' da posizionare', zl.length - pl.length > 0) + kpi(Math.round(area / (W * D) * 100) + '%', ' area occupata') +
    (conflicts.size ? kpi(Math.ceil(conflicts.size / 2), ' sovrapposizioni', true) : '') + kpi(cs + '/' + pc, ' pass consegnati');
  const imp = zl.filter(s => !s.placed && s.importable).length;
  $('impn').textContent = ZN === null ? '' : (imp ? imp + ' stand sono posizionati sulla mappa attuale e non ancora qui.' : 'Nessun altro stand da importare per questa zona.');
  $('imp').disabled = ZN === null || !imp;
  renderTabs(); renderTray(); renderSel(); renderLegend();
}
function renderTray() {
  const t = $('tr'); const un = zs().filter(s => !s.placed); t.style.display = ZN === null ? 'none' : 'flex';
  t.innerHTML = '<b>Da posizionare (' + un.length + ')</b>' + (un.length ? '' : '<span class="mt-note" style="margin:0">Tutti gli stand sono in pianta</span>');
  un.forEach(s => { const b = document.createElement('button'); b.className = 'mt-chip'; b.textContent = s.name + ' \u00b7 ' + s.done + '/' + s.pass + '  \u270E disegna'; b.onclick = () => startDraw(s); t.appendChild(b); });
}
function renderLegend() {
  const it = mode === 'pass' ? [[COL.green, '\u226580% consegnati'], [COL.yellow, 'parziale'], [COL.red, '0 consegnati'], [COL.grey, 'nessun pass']] : [[COL.neutro, 'stand']];
  $('lg').innerHTML = it.map(i => '<span><i style="background:' + i[0] + '"></i>' + i[1] + '</span>').join('') + '<span><i style="background:#ff2a2a"></i>sovrapposto</span><span><i style="background:#c9a227"></i>bloccato</span>';
}
function renderSel() {
  const c = $('sel'); const s = stands.find(x => x.id === selected);
  if (!s || !s.placed || s.zone !== ZN) { c.innerHTML = '<h3>Stand selezionato</h3><div class="mt-note">Clicca uno stand per vedere i dettagli. Trascinalo sulla pianta per spostarlo.</div>'; return; }
  const d = dims(s), L = s.locked ? ' disabled' : '';
  c.innerHTML = '<h3>Stand selezionato</h3><div class="mt-name">' + esc(s.name) + (s.locked ? '<span class="mt-tag">\uD83D\uDD12 bloccato</span>' : '') + '</div>' +
    '<div class="mt-note">' + (s.code ? esc(s.code) + ' \u00b7 ' : '') + s.done + '/' + s.pass + ' pass consegnati \u00b7 ' + d.w.toFixed(1) + ' \u00d7 ' + d.d.toFixed(1) + ' m \u00b7 h ' + s.h.toFixed(1) + ' m' + (conflicts.has(s.id) ? ' \u00b7 <b style="color:#b3321f">sovrapposto</b>' : '') + '</div>' +
    '<div class="mt-row"><button class="mt-btn lock" id="lk">' + (s.locked ? '\uD83D\uDD13 Sblocca' : '\uD83D\uDD12 Blocca') + '</button><button class="mt-btn pri" id="ef"' + L + '>\u270E Modifica forma</button></div>' +
    '<label class="mt-f">Altezza (m)<input id="hh" type="number" step="0.1" min="0.2" max="12" value="' + s.h + '"' + L + '></label>' +
    '<div class="mt-row"><button class="mt-btn" id="r1"' + L + '>\u27F2 \u221215\u00b0</button><button class="mt-btn" id="r2"' + L + '>\u27F3 +15\u00b0</button><button class="mt-btn" id="r3"' + L + '>90\u00b0</button></div>' +
    '<div class="mt-row"><a class="mt-btn" href="/assignment-groups/' + s.id + '" style="text-decoration:none">Apri scheda gruppo</a><button class="mt-btn del" id="rm"' + L + '>Rimuovi dalla pianta</button></div>';
  $('lk').onclick = () => toggleLock(s);
  $('ef').onclick = () => startEdit(s);
  $('hh').onchange = e => { const old = s.h; s.h = Math.max(.2, Math.min(12, parseFloat(e.target.value) || 2.5)); buildStand(s); saveGeom(s, () => { s.h = old; buildStand(s); refresh(); }); refresh(); };
  $('r1').onclick = () => rot(s, -15); $('r2').onclick = () => rot(s, 15); $('r3').onclick = () => rot(s, 90);
  $('rm').onclick = () => removeStand(s);
}

/* ---------- salvataggio ---------- */
function saveGeom(s, onFail) {
  return api('/admin/mappatest/layout/' + s.id, { zone: s.zone, fx: s.fx, fy: s.fy, wf: s.wf, df: s.df, rot: s.rot, shape: s.shape, height: s.h }).then(d => {
    if (d && d.ok) { toast('\u2713 Salvato (test)'); return true; }
    toast(d && d.status === 423 ? s.name + ' \u00e8 bloccato' : 'Salvataggio non riuscito' + (d && d.error ? ': ' + d.error : '')); if (onFail) onFail(); return false;
  });
}
function toggleLock(s) {
  api('/admin/mappatest/layout/' + s.id + '/lock', { locked: s.locked ? 0 : 1 }).then(d => { if (d && d.ok) { s.locked = !s.locked; toast(s.locked ? s.name + ' bloccato' : s.name + ' sbloccato'); refresh(); } else toast('Operazione non riuscita'); });
}
function removeStand(s) {
  if (s.locked) return; if (!confirm('Rimuovere ' + s.name + ' dalla pianta di test?')) return;
  api('/admin/mappatest/layout/' + s.id + '/remove', {}).then(d => { if (d && d.ok) { s.placed = false; s.shape = null; buildStand(s); selected = null; refresh(); } else toast(d && d.status === 423 ? 'Stand bloccato' : 'Operazione non riuscita'); });
}
let rotTimer = null;
function rot(s, a) { if (s.locked) return; s.rot = (s.rot + a + 360) % 360; meshes.get(s.id).group.rotation.y = -s.rot * Math.PI / 180; refresh(); clearTimeout(rotTimer); rotTimer = setTimeout(() => saveGeom(s), 500); }

/* ---------- puntatore ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function setNdc(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
function pickStand(e) { setNdc(e); const h = ray.intersectObjects([...meshes.values()].map(m => m.body), false)[0]; return h ? h.object.userData.id : null; }
function floorPoint(e) { setNdc(e); return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; }
const snap = v => Math.round(v / .5) * .5;
const inFloor = p => p && Math.abs(p.x) <= W / 2 && Math.abs(p.z) <= D / 2;
const cvs = renderer.domElement;
let mState = 'idle', drag = null, down = null, handleDrag = null, dr = null, ed = null;
const banner = $('bn');
function setBanner(html) { banner.innerHTML = html; banner.style.display = html ? 'flex' : 'none'; }
function lockCam(on) { controls.enableRotate = !on; }
function clearOverlay() { while (overlay.children.length) { const o = overlay.children.pop(); if (o.geometry) o.geometry.dispose(); } }
function dot(x, z, r, col, y) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); m.position.set(x, y == null ? .4 : y, z); m.renderOrder = 10; return m; }
const rr = () => .5 * Math.max(W, D) / 80;

/* disegno nuova forma */
function drawOverlay() {
  clearOverlay(); if (!dr) return; const pts = dr.pts.slice(); if (dr.cursor) pts.push(dr.cursor); const r = rr(); let list = pts;
  if (dr.kind === 'rect' && dr.pts.length === 1 && dr.cursor) { const a = dr.pts[0], b = dr.cursor; list = [a, [b[0], a[1]], b, [a[0], b[1]]]; }
  if (list.length > 1) { const g = new THREE.BufferGeometry().setFromPoints(list.concat(list.length > 2 ? [list[0]] : []).map(p => new THREE.Vector3(p[0], .5, p[1]))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6b3fa0, depthTest: false })); l.renderOrder = 9; overlay.add(l); }
  dr.pts.forEach((p, i) => overlay.add(dot(p[0], p[1], i === 0 ? r * 1.5 : r, i === 0 ? 0xf5c842 : 0x6b3fa0)));
}
function startDraw(s) {
  if (mState !== 'idle' || ZN === null) return; mState = 'draw'; selected = null; goView('top'); lockCam(true); dr = { stand: s, kind: 'poly', pts: [], cursor: null }; refresh(); drawBanner();
}
function drawBanner() {
  setBanner('<span>Disegna <b>' + esc(dr.stand.name) + '</b></span><div class="mt-seg"><button data-k="poly" class="' + (dr.kind === 'poly' ? 'on' : '') + '">Poligono</button><button data-k="rect" class="' + (dr.kind === 'rect' ? 'on' : '') + '">Rettangolo</button></div><span class="dim">' +
    (dr.kind === 'poly' ? 'clic sui punti \u00b7 doppio clic o Invio per chiudere \u00b7 Backspace toglie l\'ultimo' : 'clic su due angoli opposti') + '</span><button class="mt-btn" id="dc">Annulla</button>');
  banner.querySelectorAll('.mt-seg button').forEach(b => b.onclick = () => { dr.kind = b.dataset.k; dr.pts = []; drawOverlay(); drawBanner(); });
  $('dc').onclick = cancelDraw;
}
function cancelDraw() { dr = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); refresh(); }
function finishDraw() {
  if (!dr) return; let pts = dr.pts;
  if (dr.kind === 'rect') { if (pts.length < 2) return; const a = pts[0], b = pts[1]; pts = [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])]]; }
  if (pts.length < 3) { toast('Servono almeno 3 punti'); return; }
  const s = dr.stand, kind = dr.kind; applyWorldPts(s, pts); if (kind === 'rect') s.shape = null;
  if (s.wf * W < .8 || s.df * D < .8) { toast('Forma troppo piccola'); return; }
  s.placed = true; selected = s.id; dr = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); buildStand(s); refresh();
  saveGeom(s, () => { s.placed = false; s.shape = null; buildStand(s); selected = null; refresh(); });
}
function addDrawPoint(p) {
  const x = snap(p.x), z = snap(p.z), last = dr.pts[dr.pts.length - 1]; if (last && last[0] === x && last[1] === z) return;
  if (dr.kind === 'poly' && dr.pts.length >= 3 && Math.hypot(x - dr.pts[0][0], z - dr.pts[0][1]) < 1.2 * Math.max(W, D) / 80) { finishDraw(); return; }
  dr.pts.push([x, z]); if (dr.kind === 'rect' && dr.pts.length === 2) { finishDraw(); return; } drawOverlay();
}

/* modifica forma */
function startEdit(s) {
  if (s.locked) { toast('Stand bloccato: sbloccalo per modificarlo'); return; } if (mState !== 'idle') return;
  ed = { s, pts: worldPts(s).map(p => p.slice()), snapshot: { fx: s.fx, fy: s.fy, wf: s.wf, df: s.df, rot: s.rot, shape: s.shape }, handles: [], mids: [] };
  mState = 'edit'; applyWorldPts(s, ed.pts); buildStand(s); goView('top'); lockCam(true); buildHandles();
  setBanner('<span>Modifica forma di <b>' + esc(s.name) + '</b></span><span class="dim">trascina i vertici \u00b7 clic sui punti gialli per aggiungerne uno \u00b7 doppio clic su un vertice per toglierlo</span><button class="mt-btn pri" id="ek">\u2713 Fine</button><button class="mt-btn" id="ec">Annulla modifiche</button>');
  $('ek').onclick = endEdit; $('ec').onclick = cancelEdit;
}
function buildHandles() {
  clearOverlay(); if (!ed) return; ed.handles = []; ed.mids = []; const r = rr() * 1.1, y = Math.max(ed.s.h * hScale, .4) + .6, n = ed.pts.length;
  ed.pts.forEach((p, i) => { overlay.add(dot(p[0], p[1], r * 1.25, 0x6b3fa0, y - .01)); const m = dot(p[0], p[1], r, 0xffffff, y); m.userData = { type: 'v', i }; ed.handles.push(m); overlay.add(m); });
  for (let i = 0; i < n; i++) { const a = ed.pts[i], b = ed.pts[(i + 1) % n]; const m = dot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r * .7, 0xf5c842, y); m.userData = { type: 'm', i }; ed.mids.push(m); overlay.add(m); }
  const g = new THREE.BufferGeometry().setFromPoints(ed.pts.concat([ed.pts[0]]).map(p => new THREE.Vector3(p[0], y - .02, p[1]))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6b3fa0, depthTest: false })); l.renderOrder = 8; overlay.add(l);
}
function pickHandle(e) { if (!ed) return null; setNdc(e); const h = ray.intersectObjects(ed.handles.concat(ed.mids), false)[0]; return h ? h.object.userData : null; }
function endEdit() {
  if (!ed) return; const s = ed.s, snapG = ed.snapshot; applyWorldPts(s, ed.pts); ed = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); buildStand(s); refresh();
  saveGeom(s, () => { Object.assign(s, snapG); buildStand(s); refresh(); });
}
function cancelEdit() { if (!ed) return; const s = ed.s; Object.assign(s, ed.snapshot); ed = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); buildStand(s); refresh(); }

cvs.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY };
  if (mState === 'edit') {
    const h = pickHandle(e); if (!h) return;
    if (h.type === 'm') { const a = ed.pts[h.i], b = ed.pts[(h.i + 1) % ed.pts.length]; ed.pts.splice(h.i + 1, 0, [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)]); buildHandles(); handleDrag = h.i + 1; } else handleDrag = h.i;
    controls.enabled = false; return;
  }
  if (mState === 'draw') return;
  const id = pickStand(e);
  if (id != null) {
    selected = id; const s = stands.find(x => x.id === id);
    if (s.locked) { toast(s.name + ' \u00e8 bloccato: sbloccalo per spostarlo'); refresh(); return; }
    const p = floorPoint(e); if (p) { drag = { s, ox: (s.fx - .5) * W - p.x, oz: (s.fy - .5) * D - p.z, moved: false, ofx: s.fx, ofy: s.fy }; controls.enabled = false; }
    refresh();
  }
});
cvs.addEventListener('pointermove', e => {
  if (mState === 'edit' && handleDrag != null) { const p = floorPoint(e); if (!p) return; ed.pts[handleDrag] = [snap(Math.max(-W / 2, Math.min(W / 2, p.x))), snap(Math.max(-D / 2, Math.min(D / 2, p.z)))]; applyWorldPts(ed.s, ed.pts); buildStand(ed.s); buildHandles(); computeConflicts(); paint(); return; }
  if (mState === 'draw' && dr) { const p = floorPoint(e); if (p) { dr.cursor = [snap(p.x), snap(p.z)]; drawOverlay(); } return; }
  if (drag) {
    const p = floorPoint(e); if (!p) return; const x = snap(p.x + drag.ox), z = snap(p.z + drag.oz);
    drag.s.fx = Math.max(.01, Math.min(.99, x / W + .5)); drag.s.fy = Math.max(.01, Math.min(.99, z / D + .5)); drag.moved = true;
    meshes.get(drag.s.id).group.position.set((drag.s.fx - .5) * W, 0, (drag.s.fy - .5) * D); computeConflicts(); paint(); $('mt-tip').style.display = 'none'; return;
  }
  const tip = $('mt-tip');
  if (mState !== 'idle') { tip.style.display = 'none'; cvs.style.cursor = mState === 'draw' ? 'crosshair' : (pickHandle(e) ? 'move' : 'default'); return; }
  const id = pickStand(e);
  if (id != null) { const s = stands.find(x => x.id === id); tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.innerHTML = '<b>' + esc(s.name) + '</b>' + (s.locked ? ' \uD83D\uDD12' : '') + '<br>' + s.done + '/' + s.pass + ' pass'; cvs.style.cursor = s.locked ? 'not-allowed' : 'grab'; }
  else { tip.style.display = 'none'; cvs.style.cursor = 'default'; }
});
addEventListener('pointerup', e => {
  if (handleDrag != null) { handleDrag = null; controls.enabled = true; refresh(); return; }
  if (mState === 'draw' && dr && down && e.target === cvs && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { const p = floorPoint(e); if (inFloor(p)) addDrawPoint(p); down = null; return; }
  if (drag) {
    const dg = drag; drag = null; controls.enabled = true;
    if (dg.moved) { refresh(); saveGeom(dg.s, () => { dg.s.fx = dg.ofx; dg.s.fy = dg.ofy; buildStand(dg.s); refresh(); }); if (conflicts.has(dg.s.id)) toast('Attenzione: lo stand si sovrappone a un altro'); }
    return;
  }
  if (mState === 'idle' && down && e.target === cvs && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && pickStand(e) == null) { selected = null; refresh(); }
  down = null;
});
cvs.addEventListener('dblclick', e => {
  if (mState === 'draw' && dr && dr.kind === 'poly') { finishDraw(); return; }
  if (mState === 'edit') { const h = pickHandle(e); if (h && h.type === 'v') { if (ed.pts.length <= 3) { toast('Servono almeno 3 vertici'); return; } ed.pts.splice(h.i, 1); applyWorldPts(ed.s, ed.pts); buildStand(ed.s); buildHandles(); computeConflicts(); paint(); } }
});
addEventListener('keydown', e => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (mState === 'draw') { if (e.key === 'Enter') finishDraw(); else if (e.key === 'Escape') cancelDraw(); else if (e.key === 'Backspace') { dr.pts.pop(); drawOverlay(); e.preventDefault(); } }
  else if (mState === 'edit') { if (e.key === 'Enter') endEdit(); else if (e.key === 'Escape') cancelEdit(); }
});

/* ---------- viste e zone ---------- */
const VIEWS = { top: { p: [0, 1.3, 0.001], t: [0, 0, 0] }, persp: { p: [0, .72, .82], t: [0, 0, .02] }, iso: { p: [.78, .72, .78], t: [0, 0, 0] } };
let tween = null;
function goView(k) {
  curView = k; const v = VIEWS[k], sc = Math.max(W, D) * 1.2;
  const to = new THREE.Vector3(v.p[0] * sc, v.p[1] * sc, v.p[2] * sc), toT = new THREE.Vector3(v.t[0] * sc, 0, v.t[2] * sc);
  tween = { t0: performance.now(), from: camera.position.clone(), fromT: controls.target.clone(), to, toT };
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === k));
}
function setZone(name) {
  if (mState === 'draw') cancelDraw(); if (mState === 'edit') cancelEdit();
  ZN = name; Z = zones.find(z => z.name === name) || null; selected = null; query = ''; $('q').value = '';
  W = (Z && Z.widthM) || 80; D = W * ((Z && Z.refH) || 600) / ((Z && Z.refW) || 1450);
  $('wm').value = Z ? W : ''; $('wm').disabled = !Z;
  clearStands(); clearOverlay(); buildFloor(); zs().forEach(buildStand);
  const ms = $('ms'); if (!Z) { ms.style.display = 'flex'; ms.innerHTML = zones.length ? 'Questi stand non hanno una zona assegnata: assegnali a una zona dalle impostazioni assegnatari.' : 'Nessuna zona configurata.'; } else ms.style.display = 'none';
  refresh(); goView(curView); if (tween) { camera.position.copy(tween.to); controls.target.copy(tween.toT); tween = null; }
}
document.querySelectorAll('#views button').forEach(b => b.onclick = () => goView(b.dataset.v));
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => { document.querySelectorAll('#modes button').forEach(x => x.classList.remove('on')); b.classList.add('on'); mode = b.dataset.m; paint(); renderLegend(); });
$('lab').onchange = e => { labelsOn = e.target.checked; meshes.forEach(m => m.lab.visible = labelsOn); };
$('shd').onchange = e => { renderer.shadowMap.enabled = e.target.checked; sun.castShadow = e.target.checked; meshes.forEach(m => { m.mat.needsUpdate = true; }); if (floorMesh) floorMesh.material.needsUpdate = true; };
$('hsl').oninput = e => { hScale = e.target.value / 100; zs().forEach(s => { const m = meshes.get(s.id); if (m) { m.body.scale.y = hScale; m.lk.position.y = s.h * hScale + 1.6; } }); };
$('q').oninput = e => { query = e.target.value; paint(); };
$('wm').onchange = e => {
  if (!Z) return; const v = Math.max(10, Math.min(500, parseFloat(e.target.value) || 80));
  api('/admin/mappatest/zone-scale', { zone: Z.name, width_m: v }).then(d => { if (d && d.ok) { Z.widthM = v; setZone(Z.name); toast('Scala aggiornata'); } else { toast('Salvataggio non riuscito'); e.target.value = W; } });
};
$('imp').onclick = () => {
  if (!Z) return; if (!confirm('Importare in questa zona le posizioni della mappa attuale? Gli stand bloccati non vengono toccati.')) return;
  api('/admin/mappatest/import', { zone: Z.name }).then(d => { if (d && d.ok) { toast('Importati ' + (d.imported || 0) + ' stand'); setTimeout(() => location.reload(), 700); } else toast('Importazione non riuscita'); });
};
function lockZone(v) { if (!Z) return; api('/admin/mappatest/zone-lock', { zone: Z.name, locked: v ? 1 : 0 }).then(d => { if (d && d.ok) { zs().forEach(s => { if (s.placed) s.locked = !!v; }); refresh(); toast(v ? 'Tutti gli stand della zona sono bloccati' : 'Stand sbloccati'); } else toast('Operazione non riuscita'); }); }
$('la').onclick = () => lockZone(true);
$('ua').onclick = () => { if (confirm('Sbloccare tutti gli stand di questa zona?')) lockZone(false); };
$('ex').onclick = () => {
  const data = { zona: ZN, larghezza_m: W, stand: zs().map(s => ({ id: s.id, nome: s.name, in_pianta: s.placed, bloccato: s.locked, fx: s.fx, fy: s.fy, wf: s.wf, df: s.df, rot: s.rot, altezza_m: s.h, forma: s.shape })) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = 'layout-mappatest.json'; a.click();
};
function resize() { const r = vw.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
if (window.ResizeObserver) new ResizeObserver(resize).observe(vw); else addEventListener('resize', resize);
resize();
setZone(zones.length ? zones[0].name : null);
if (!zones.length) { $('ms').style.display = 'flex'; $('ms').textContent = 'Nessuna zona configurata.'; }
(function loop(now) {
  requestAnimationFrame(loop);
  if (tween) { const k = Math.min(1, (now - tween.t0) / 700), e = 1 - Math.pow(1 - k, 3); camera.position.lerpVectors(tween.from, tween.to, e); controls.target.lerpVectors(tween.fromT, tween.toT, e); if (k >= 1) tween = null; }
  controls.update(); renderer.render(scene, camera);
})(0);
