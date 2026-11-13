/* ludi-mappatest.js — Mappa Stand TEST 3D: modello dell'edificio, disegno e modifica forme, blocco stand, salvataggio in tabelle separate.
   Pagina: /admin/mappatest (solo admin). Non modifica le posizioni della mappa reale.
   Modelli degli edifici: /mappatest-models/<nome-zona>.json (es. palazzetto.json). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DATA = JSON.parse(document.getElementById('mt-data').textContent);
const root = document.getElementById('mt-root');
document.body.classList.add('mp-on');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const api = (url, body, method) => fetch(url, { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(r => r.json().catch(() => ({})).then(d => Object.assign({ status: r.status }, d)))
  .catch(() => ({ ok: false, status: 0, error: 'Errore di rete' }));
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

const zones = DATA.zones;
const LBL = { color: (DATA.settings && DATA.settings.lbl_color) || '#ffffff', outline: (DATA.settings && DATA.settings.lbl_outline) || '#000000' };
const stands = DATA.stands.concat(DATA.objects || []).map(s => {
  const L = s.L;
  return { id: s.id, name: s.name, zone: s.zone, code: s.code, pass: s.pc || 0, done: s.cs || 0, notes: s.notes, importable: !!s.importable, placed: !!L,
    fx: L ? L.fx : .5, fy: L ? L.fy : .5, wf: L ? L.wf : .03, df: L ? L.df : .03, rot: L ? L.rot : 0, shape: L ? L.shape : null, h: L ? L.h : 2.5, locked: L ? !!L.locked : false, model: L ? (L.model || null) : null, kind: s.kind || 'stand', color: (L && L.color) || s.color || null, lscale: L ? (L.lscale || 1) : 1 };
});

stands.forEach(s => { if (s.model === 'obj-transenna' && s.shape) s.shape = dedupeShape(s.shape); });

root.innerHTML = '' +
'<section class="mp-hero"><div><h1>Mappa Stand · test 3D</h1><p>Pagina di prova: i dati si salvano in tabelle separate e non toccano la mappa reale</p></div><div class="mp-hero-stats" id="hs"></div></section>' +
'<div class="zone-tabs" id="zt"></div>' +
'<div class="mp-strip"><div class="mp-kpis" id="kp"></div><label class="mp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg><input id="q" type="search" placeholder="Cerca stand nella zona\u2026"></label></div>' +
'<div class="mt-main"><div class="mt-card">' +
 '<div class="mt-bar"><div class="mt-seg" id="views"><button data-v="top">Dall\'alto</button><button data-v="persp" class="on">Prospettiva</button><button data-v="iso">Isometrica</button><button data-v="south">Fronte</button></div>' +
 '<div class="mt-seg" id="modes"><button data-m="pass" class="on">Pass</button><button data-m="neutro">Neutro</button></div>' +
 '<label class="mt-chk"><input type="checkbox" id="bld" checked> Edificio</label><label class="mt-chk"><input type="checkbox" id="rf" checked> Tetti sala</label><label class="mt-chk"><input type="checkbox" id="rfl" checked> Tetti bassi</label>' +
 '<label class="mt-chk"><input type="checkbox" id="lab" checked> Etichette</label><label class="mt-chk"><input type="checkbox" id="shd" checked> Ombre</label>' +
 '<label class="mt-chk">Trasparenza <input type="range" id="trn" min="0" max="100" value="55"></label>' +
 '<label class="mt-chk">Sole <input type="range" id="sunr" min="0" max="360" value="215"></label>' +
 '<label class="mt-chk">Altezze <input type="range" id="hsl" min="30" max="200" value="100"></label></div>' +
 '<div class="mt-view" id="vw"><div class="mt-banner" id="bn"></div><div class="mt-leg" id="lg"></div><div class="mt-tray" id="tr"></div><div class="mt-msg" id="ms"></div></div>' +
'</div><aside class="mt-side">' +
 '<div class="mt-panel"><h3 id="psh" style="cursor:pointer;user-select:none">Scala e dati <span id="pst">\u25BE</span></h3><div id="psb"><label class="mt-f">Larghezza reale della pianta (m)<input id="wm" type="number" min="10" max="500" step="0.5"></label><div class="mt-note" id="wmn"></div><label class="mt-chk" style="margin:6px 0"><input type="checkbox" id="outd"> Zona all&#39;aperto</label><div class="mt-row" style="align-items:center"><label class="mt-chk">Colore nomi <input type="color" id="lblc"></label><label class="mt-chk">Contorno <input type="color" id="lblo"></label><button class="mt-btn" id="lblr">Predefiniti</button></div>' +
 '<div class="mt-row"><button class="mt-btn" id="imp">Importa dalla mappa attuale</button></div><div class="mt-note" id="impn"></div>' +
 '<div class="mt-row"><button class="mt-btn lock" id="la">\uD83D\uDD12 Blocca tutti</button><button class="mt-btn" id="ua">Sblocca tutti</button><button class="mt-btn" id="ex">Esporta JSON</button></div></div></div>' +
 '<div class="mt-panel" id="sel"></div>' +
 '<div class="mt-panel"><h3>Come si usa</h3><div class="mt-note">Tasto sinistro sul pavimento: ruota la vista \u00b7 destro: sposta \u00b7 rotellina: zoom. Trascina gli stand per spostarli (aggancio a 0,5 m). Per gli stand \u201cda posizionare\u201d scegli il nome nella barra in basso e disegna la forma sulla pianta. Con \u201cModifica forma\u201d sposti i vertici, aggiungi punti dai segni gialli e togli un punto con doppio clic. Gli stand bloccati non si muovono per errore. \u201cTrasparenza\u201d e \u201cTetti\u201d servono per vedere dentro l\'edificio.</div></div>' +
'</aside></div><div id="mt-tip"></div><div id="mt-toast"></div>';

const vw = $('vw');
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { $('ms').style.display = 'flex'; $('ms').textContent = 'Il tuo browser non supporta WebGL: la vista 3D non \u00e8 disponibile.'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
vw.insertBefore(renderer.domElement, vw.firstChild);
const scene = new THREE.Scene();
try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; } catch (e) { /* senza riflessi */ }
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.03; controls.minDistance = 8; controls.maxDistance = 500;
scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbfe8, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.1); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun);
function setSun(deg) { const a = deg * Math.PI / 180, r = Math.max(W, D) * .9; sun.position.set(Math.cos(a) * r, r * .85, Math.sin(a) * r); }
const world = new THREE.Group(); scene.add(world);
const modelG = new THREE.Group(); scene.add(modelG);
const gRoof = new THREE.Group(), gWall = new THREE.Group(), gLow = new THREE.Group(), gSol = new THREE.Group(), gSta = new THREE.Group(), gRai = new THREE.Group(), gLowRoof = new THREE.Group();
modelG.add(gRoof, gWall, gLow, gLowRoof, gSol, gSta, gRai);
const overlay = new THREE.Group(); scene.add(overlay);

let ZN = null, Z = null, W = 80, D = 30, MODEL = null, PL = null, RAISED_S = [];
let mode = 'pass', labelsOn = true, hScale = 1, selected = null, query = '', transp = .55;
let floorMesh = null, slab = null, ground = null, floorToken = 0, zoneTok = 0, curView = 'persp', floorTex = null;
const texMats = [];
const meshes = new Map();
const zs = () => stands.filter(s => s.zone === ZN);
const isOut = () => !!(Z && Z.outdoor);
const dims = s => ({ w: s.wf * W, d: s.df * D });
const COL = { grey: '#9ca3af', green: '#2d6a4f', yellow: '#c9a227', red: '#c0392b', neutro: '#6b3fa0' };
function colorOf(s) { if (s.kind === 'obj') return s.color || '#16a085'; if (mode === 'neutro') return s.color || COL.neutro; if (!s.pass) return COL.grey; const p = s.done / s.pass; return p >= .8 ? COL.green : p > 0 ? COL.yellow : COL.red; }
let tt; function toast(t) { const e = $('mt-toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => e.style.display = 'none', 2600); }

/* ---------- materiali dell'edificio ---------- */
const matRoof = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: .55, metalness: .05, side: THREE.DoubleSide, transparent: true, depthWrite: false });
const matWallB = new THREE.MeshStandardMaterial({ color: 0xb86f4e, roughness: .85, side: THREE.DoubleSide, transparent: true });
const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fc6e8, roughness: .08, metalness: .1, side: THREE.DoubleSide, transparent: true, depthWrite: false, envMapIntensity: 1.4 });
const matLow = new THREE.MeshStandardMaterial({ color: 0xb4bccb, roughness: .8, side: THREE.DoubleSide, transparent: true, depthWrite: false });
const matLowRoof = new THREE.MeshStandardMaterial({ color: 0xcfd5e0, roughness: .6, side: THREE.DoubleSide, transparent: true, depthWrite: false });
const matSol = new THREE.MeshStandardMaterial({ color: 0x777784, roughness: .95 });
const matSta = new THREE.MeshStandardMaterial({ color: 0xf0a030, roughness: .7 });
function applyTransp() {
  const t = transp;
  matRoof.opacity = Math.max(.08, 1 - .92 * t); matWallB.opacity = Math.max(.12, 1 - .85 * t); matGlass.opacity = Math.max(.1, .85 - .75 * t); matLow.opacity = Math.max(.1, .85 - .75 * t); matLowRoof.opacity = Math.max(.08, 1 - .92 * t);
  [matRoof, matWallB, matGlass, matLow, matLowRoof].forEach(m => { m.needsUpdate = true; });
}

/* ---------- pavimento ---------- */
function fitSun() { const c = sun.shadow.camera, r = Math.max(W, D) * 0.75; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = Math.max(W, D) * 4; c.updateProjectionMatrix(); setSun(+$('sunr').value); }
function composeFloor(img, cb) {
  const cw = 2048, ch = Math.max(256, Math.round(cw * D / W)); const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch);
  if (!img) { g.strokeStyle = '#e4dcf3'; g.lineWidth = 2; const st = cw / 16; for (let x = 0; x <= cw; x += st) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ch); g.stroke(); } for (let y = 0; y <= ch; y += st) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); } }
  else { const sc = Math.min(cw / img.naturalWidth, ch / img.naturalHeight); g.drawImage(img, (cw - img.naturalWidth * sc) / 2, 0, img.naturalWidth * sc, img.naturalHeight * sc); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; cb(t);
}
function buildFloor(img) {
  const my = ++floorToken;
  [floorMesh, slab, ground].forEach(m => { if (m) { world.remove(m); m.geometry.dispose(); } }); floorMesh = slab = ground = null; floorTex = null; texMats.length = 0;
  if (!Z) return;
  ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(W, D) * 4, 64), new THREE.MeshStandardMaterial({ color: 0xe6def5, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.62; ground.receiveShadow = true; world.add(ground);
  slab = new THREE.Mesh(new THREE.BoxGeometry(W + 3, .6, D + 3), new THREE.MeshStandardMaterial({ color: 0xd9cff0, roughness: 1 }));
  slab.position.y = -.31; slab.receiveShadow = true; world.add(slab);
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95 }));
  floorMesh.rotation.x = -Math.PI / 2; floorMesh.receiveShadow = true; world.add(floorMesh); texMats.push(floorMesh.material);
  composeFloor(img, t => { if (my !== floorToken) return; floorTex = t; texMats.forEach(m => { m.map = t; m.needsUpdate = true; }); });
  scene.fog = new THREE.Fog(0xe9e2f6, Math.max(W, D) * 2.2, Math.max(W, D) * 6);
  fitSun();
}

/* ---------- modello dell'edificio ---------- */
function applyVis() { const on = $('bld').checked; gSol.visible = gLow.visible = gSta.visible = gRai.visible = gWall.visible = on; gRoof.visible = on && $('rf').checked; gLowRoof.visible = on && $('rfl').checked; }
function clearGroup(g) { while (g.children.length) { const o = g.children.pop(); o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); } }
function pointIn(poly, x, z) {
  const inside = (ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if (((a[1] > z) !== (b[1] > z)) && (x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; };
  if (!inside(poly.o)) return false; for (const h of poly.h) if (inside(h)) return false; return true;
}
const baseOf = s => { if (!MODEL || !RAISED_S.length) return 0; const x = (s.fx - .5) * W, z = (s.fy - .5) * D; return RAISED_S.some(p => pointIn(p, x, z)) ? MODEL.heights.raise : 0; };
function tris(arr, pts) { for (const p of pts) arr.push(p[0], p[1], p[2]); }
function rawMesh(arr, mat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = mat !== matGlass; m.receiveShadow = true; return m; }
function buildModel() {
  [gRoof, gWall, gLow, gLowRoof, gSol, gSta, gRai].forEach(clearGroup); RAISED_S = [];
  if (!MODEL || !PL) return;
  const m = MODEL, pw = m.planPx[0], ph = m.planPx[1], hh = m.heights;
  const MX = px => ((PL.xOff + px / pw * PL.wFrac) - .5) * W, MZ = py => ((py / ph * PL.hFrac) - .5) * D;
  const conv = p => ({ o: p.o.map(q => [MX(q[0]), MZ(q[1])]), h: p.h.map(r => r.map(q => [MX(q[0]), MZ(q[1])])) });
  const shapeOf = p => { const sh = new THREE.Shape(); p.o.forEach((q, i) => i ? sh.lineTo(q[0], -q[1]) : sh.moveTo(q[0], -q[1])); p.h.forEach(r => { const hp = new THREE.Path(); r.forEach((q, i) => i ? hp.lineTo(q[0], -q[1]) : hp.moveTo(q[0], -q[1])); sh.holes.push(hp); }); return sh; };
  const ext = (p, h, mat, grp, edge) => { const g = new THREE.ExtrudeGeometry(shapeOf(p), { depth: Math.max(h, .02), bevelEnabled: false }); g.rotateX(-Math.PI / 2); const me = new THREE.Mesh(g, mat); me.castShadow = mat !== matLow; me.receiveShadow = true;
    if (edge !== false) me.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: .4 }))); grp.add(me); };
  const b = m.bays, HR = hh.ridge, HE = hh.eave;
  for (let k = 0; k < b.n; k++) {
    const x0 = b.v0 + b.step * k, xc = x0 + b.half, x1 = x0 + b.step;
    const TL = [x0, b.topValley], TA = [xc, b.topApex], TR = [x1, b.topValley], BR = [x1, b.botValley], BA = [xc, b.botApex], BL = [x0, b.botValley];
    const hf = x => HE + (HR - HE) * (1 - Math.abs(x - xc) / b.half);
    const P = (p, y) => [MX(p[0]), y, MZ(p[1])];
    const rf = []; tris(rf, [P(TL, HE), P(TA, HR), P(BA, HR), P(TL, HE), P(BA, HR), P(BL, HE)]); tris(rf, [P(TA, HR), P(TR, HE), P(BR, HE), P(TA, HR), P(BR, HE), P(BA, HR)]);
    const roofM = rawMesh(rf, matRoof); roofM.add(new THREE.LineSegments(new THREE.EdgesGeometry(roofM.geometry, 10), new THREE.LineBasicMaterial({ color: 0x8a93a6, transparent: true, opacity: .55 }))); gRoof.add(roofM);
    const wall = (a, c, mat) => { const arr = []; tris(arr, [P(a, 0), P(c, 0), P(c, hf(c[0])), P(a, 0), P(c, hf(c[0])), P(a, hf(a[0]))]); gWall.add(rawMesh(arr, mat)); };
    wall(TL, TA, matWallB); wall(TA, TR, matWallB); wall(BL, BA, matGlass); wall(BA, BR, matGlass);
    if (k === 0) wall(TL, BL, matWallB); if (k === b.n - 1) wall(TR, BR, matWallB);
    // montanti della facciata vetrata
    [[BL, BA], [BA, BR]].forEach(([a, c]) => { for (let t = 0; t <= 4; t++) { const u = t / 4, x = a[0] + (c[0] - a[0]) * u, y = a[1] + (c[1] - a[1]) * u;
      const pts = [new THREE.Vector3(MX(x), 0, MZ(y)), new THREE.Vector3(MX(x), hf(x), MZ(y))]; gWall.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5b6577, transparent: true, opacity: .6 }))); } });
  }
  m.low.forEach(p => {
    const c = conv(p), arr = [];
    [c.o].concat(c.h).forEach(ring => { for (let i = 0; i < ring.length; i++) { const q = ring[i], r = ring[(i + 1) % ring.length]; tris(arr, [[q[0], 0, q[1]], [r[0], 0, r[1]], [r[0], hh.low, r[1]], [q[0], 0, q[1]], [r[0], hh.low, r[1]], [q[0], hh.low, q[1]]]); } });
    const wm = rawMesh(arr, matLow); wm.castShadow = false; gLow.add(wm);
    const rg = new THREE.ShapeGeometry(shapeOf(c)); rg.rotateX(-Math.PI / 2);
    const rm = new THREE.Mesh(rg, matLowRoof); rm.position.y = hh.low; rm.receiveShadow = true;
    rm.add(new THREE.LineSegments(new THREE.EdgesGeometry(rg, 25), new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: .4 }))); gLowRoof.add(rm);
  });
  m.solid.forEach(p => ext(conv(p), hh.low + 0.1, matSol, gSol));
  m.steps.forEach(p => ext(conv(p), hh.raise * (p.i + 1) / m.stepsN, matSta, gSta));
  RAISED_S = m.raised.map(conv);
  RAISED_S.forEach(p => {
    const g = new THREE.ShapeGeometry(shapeOf(p)); const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / W + .5; uv[i * 2 + 1] = .5 + pos.getY(i) / D; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.rotateX(-Math.PI / 2);
    const mt = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, map: floorTex }); texMats.push(mt);
    const me = new THREE.Mesh(g, mt); me.position.y = hh.raise + .03; me.receiveShadow = true; gRai.add(me);
  });
  applyTransp();
}

/* ---------- stand ---------- */
function labelTexture(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = LBL.color; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 40; g.font = 'bold ' + fs + 'px sans-serif';
  while (g.measureText(text).width > 236 && fs > 16) { fs -= 2; g.font = 'bold ' + fs + 'px sans-serif'; }
  g.shadowColor = LBL.outline; g.shadowBlur = 6; g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = LBL.outline; g.globalAlpha = .55; g.strokeText(text, 128, 64); g.globalAlpha = 1; g.fillText(text, 128, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const lockTex = (() => { const cv = document.createElement('canvas'); cv.width = 96; cv.height = 96; const g = cv.getContext('2d');
  g.fillStyle = '#fff8dd'; g.beginPath(); g.arc(48, 48, 44, 0, 7); g.fill(); g.strokeStyle = '#c9a227'; g.lineWidth = 5; g.stroke();
  g.font = '50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\uD83D\uDD12', 48, 52);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const SW = ['#6b3fa0', '#2d6a4f', '#c0392b', '#2980b9', '#e67e22', '#16a085', '#c9a227', '#7f8c8d'];
function labelPx(text) { const g = document.createElement('canvas').getContext('2d'); let fs = 40; g.font = 'bold ' + fs + 'px sans-serif'; while (g.measureText(text).width > 236 && fs > 16) { fs -= 2; g.font = 'bold ' + fs + 'px sans-serif'; } return g.measureText(text).width; }
function fitLabel(s) {
  const m = meshes.get(s.id); if (!m || !m.lab.geometry) return;
  const b = bboxOf(worldPts(s)), avail = (s.model === 'area' && isOut()) ? 2.2 : (b.x1 - b.x0), tw = m.lab.geometry.parameters.width * labelPx(s.name) / 256;
  const k = Math.max(.3, Math.min(4, Math.round(.92 * avail / tw * 20) / 20)); s.lscale = isFinite(k) ? k : 1; orientLabel(m.lab, s);
}
function orientLabel(lab, s) { lab.rotation.order = 'YXZ'; lab.rotation.set(-Math.PI / 2, s.rot * Math.PI / 180, 0); const k = s.lscale || 1; lab.scale.set(k, k, 1); }
function applyRot(s) { const m = meshes.get(s.id); if (!m) return; m.group.rotation.y = -s.rot * Math.PI / 180; orientLabel(m.lab, s); }
function placeLock(lk, s) { const { w, d } = dims(s); lk.position.set(Math.max(0, w / 2 - .5), s.h * hScale + .7, -Math.max(0, d / 2 - .5)); }
function isLine(s) { return s.model === 'obj-transenna'; }
function dedupeShape(sh) { return sh.filter((p, i) => !i || p[0] !== sh[i - 1][0] || p[1] !== sh[i - 1][1]); }
function clearStands() { meshes.forEach(m => { world.remove(m.group); m.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }); meshes.clear(); }
function buildStand(s) {
  if (meshes.has(s.id)) { const old = meshes.get(s.id); world.remove(old.group); old.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); meshes.delete(s.id); }
  if (!s.placed || s.zone !== ZN) return;
  if (s.model === 'area') { buildAreaStand(s); return; }
  if (s.model && MODEL_DEFS[s.model]) { buildModelStand(s); return; }
  const { w, d } = dims(s); const bt = Math.min(.07, s.h / 6, Math.min(w, d) / 8);
  const sh = new THREE.Shape(); (s.shape || [[0, 0], [1, 0], [1, 1], [0, 1]]).forEach((p, i) => { const x = (p[0] - .5) * w, y = (.5 - p[1]) * d; i ? sh.lineTo(x, y) : sh.moveTo(x, y); });
  const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(.05, s.h - 2 * bt), bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 2 });
  geo.translate(0, 0, bt); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: colorOf(s), roughness: .5, metalness: .06 });
  const body = new THREE.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true; body.userData.id = s.id;
  const emat = new THREE.LineBasicMaterial({ color: s.locked ? 0xc9a227 : 0x1e2d4e, transparent: true, opacity: s.locked ? .95 : .3 });
  body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 45), emat));
  const ls = Math.max(Math.min(w, d * 3), 2.2);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls / 2), new THREE.MeshBasicMaterial({ map: labelTexture(s.name), transparent: true, depthWrite: false }));
  orientLabel(lab, s); lab.position.y = s.h + .04; lab.visible = labelsOn; lab.raycast = () => {}; body.add(lab);
  const grp = new THREE.Group(); grp.add(body);
  const lk = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, depthTest: false })); lk.scale.set(1, 1, 1); lk.visible = !!s.locked; lk.raycast = () => {}; lk.renderOrder = 5; grp.add(lk);
  grp.position.set((s.fx - .5) * W, baseOf(s), (s.fy - .5) * D); grp.rotation.y = -s.rot * Math.PI / 180; body.scale.y = hScale; placeLock(lk, s);
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
function computeConflicts() { conflicts = new Set(); const pl = zs().filter(s => s.placed && !isLine(s) && s.model !== 'obj-colonnina'); for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) if (overlap(pl[i], pl[j])) { conflicts.add(pl[i].id); conflicts.add(pl[j].id); } }
function paint() {
  const q = query.trim().toLowerCase();
  zs().forEach(s => {
    const m = meshes.get(s.id); if (!m) return; m.mat.color.set(colorOf(s));
    const sel = selected === s.id, bad = conflicts.has(s.id), hit = q && s.name.toLowerCase().indexOf(q) > -1;
    m.mat.emissive.set(bad ? 0xff2a2a : hit ? 0xf5c842 : sel ? 0xffffff : 0x000000); m.mat.emissiveIntensity = bad ? .55 : hit ? .6 : sel ? .28 : 0;
    m.mat.transparent = !!q && !hit; m.mat.opacity = (q && !hit) ? .2 : 1; m.mat.needsUpdate = true;
    m.emat.color.set(s.locked ? 0xc9a227 : 0x1e2d4e); m.emat.opacity = s.locked ? .95 : .3; m.lk.visible = !!s.locked;
  });
}

/* ---------- interfaccia ---------- */
function kpi(n, label, warn) { return '<span class="mp-k' + (warn ? ' warn' : '') + '"><b>' + esc(n) + '</b>' + esc(label) + '</span>'; }
function renderTabs() {
  const zt = $('zt'); zt.innerHTML = '';
  const mk = (name, label, n) => { const b = document.createElement('button'); b.className = 'ztab' + (ZN === name && (ZN !== null || name === null) ? ' active' : ''); b.innerHTML = esc(label) + ' <span>' + n + '</span>'; b.onclick = () => setZone(name); zt.appendChild(b); };
  zones.forEach(z => mk(z.name, z.name, stands.filter(s => s.zone === z.name && s.kind !== 'obj').length));
  const nz = stands.filter(s => !zones.some(z => z.name === s.zone)).length; if (nz) mk(null, '\u2753 Senza zona', nz);
}
function refresh() {
  computeConflicts(); paint();
  const all = stands.filter(s => s.kind !== 'obj' && zones.some(z => z.name === s.zone));
  $('hs').innerHTML = kpi(zones.length, ' zone') + kpi(all.filter(s => s.placed).length, ' stand in pianta') + kpi(all.filter(s => !s.placed).length, ' da posizionare', all.some(s => !s.placed));
  const zl = zs().filter(s => s.kind !== 'obj'), pl = zl.filter(s => s.placed); let area = 0, pc = 0, cs = 0; pl.forEach(s => { const d = dims(s); area += d.w * d.d; pc += s.pass; cs += s.done; });
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
  un.forEach(s => { const b = document.createElement('button'); b.className = 'mt-chip'; b.textContent = s.name + ' \u00b7 ' + s.done + '/' + s.pass + '  \u270E posiziona'; b.onclick = () => choosePlacement(s); t.appendChild(b); });
  const ob = document.createElement('button'); ob.className = 'mt-chip'; ob.textContent = '\uFF0B Oggetto'; ob.title = 'Biglietteria, palco, segreteria e altri oggetti senza stand'; ob.onclick = addObject; t.appendChild(ob);
}
function renderLegend() {
  const it = mode === 'pass' ? [[COL.green, '\u226580% consegnati'], [COL.yellow, 'parziale'], [COL.red, '0 consegnati'], [COL.grey, 'nessun pass']] : [[COL.neutro, 'stand']];
  $('lg').innerHTML = it.map(i => '<span><i style="background:' + i[0] + '"></i>' + i[1] + '</span>').join('') + '<span><i style="background:#ff2a2a"></i>sovrapposto</span><span><i style="background:#c9a227"></i>bloccato</span>';
}
function renderSel() {
  const c = $('sel'); const s = stands.find(x => x.id === selected);
  if (!s || !s.placed || s.zone !== ZN) { c.innerHTML = '<h3>Selezione</h3><div class="mt-note">Clicca uno stand o un oggetto per vedere i dettagli. Trascinalo sulla pianta per spostarlo.</div>'; return; }
  const obj = s.kind === 'obj', d = dims(s), L = s.locked ? ' disabled' : '';
  c.innerHTML = '<h3>' + (obj ? 'Oggetto selezionato' : 'Stand selezionato') + '</h3><div class="mt-name">' + esc(s.name) + (s.locked ? '<span class="mt-tag">\uD83D\uDD12 bloccato</span>' : '') + '</div>' +
    '<div class="mt-note">' + (obj ? 'Oggetto senza stand' : (s.code ? esc(s.code) + ' \u00b7 ' : '') + s.done + '/' + s.pass + ' pass consegnati') + ' \u00b7 ' + d.w.toFixed(1) + ' \u00d7 ' + d.d.toFixed(1) + ' m \u00b7 h ' + s.h.toFixed(1) + ' m' + (s.model ? ' \u00b7 modello ' + esc(modelLabel(s.model)) : '') + (baseOf(s) ? ' \u00b7 su pavimento rialzato' : '') + (conflicts.has(s.id) ? ' \u00b7 <b style="color:#b3321f">sovrapposto</b>' : '') + '</div>' +
    '<div class="mt-row"><button class="mt-btn lock" id="lk">' + (s.locked ? '\uD83D\uDD13 Sblocca' : '\uD83D\uDD12 Blocca') + '</button>' + (s.model && MODEL_DEFS[s.model] && !isLine(s) ? '<button class="mt-btn pri" id="ef"' + L + '>\u270E Ridimensiona</button><button class="mt-btn" id="mc"' + L + '>Forma libera</button>' : '<button class="mt-btn pri" id="ef"' + L + '>\u270E Modifica forma</button>') + (!obj && (!s.model || s.model === 'area') ? '<button class="mt-btn" id="sty"' + L + '>' + (s.model === 'area' ? 'Aspetto volume' : 'Aspetto area') + '</button>' : '') + '</div>' +
    (obj ? '<label class="mt-f">Nome<input id="on" type="text" maxlength="60" value="' + esc(s.name) + '"' + L + '></label><label class="mt-f">Colore<input id="oc" type="color" value="' + esc(s.color || '#16a085') + '"' + L + '></label>' : '') +
    (obj ? '<label class="mt-f">Note (mostrate al passaggio del mouse)<textarea id="onote" rows="3" maxlength="500" style="width:100%;margin-top:.2rem;border:1.5px solid #d9cff0;border-radius:12px;padding:.4rem .65rem;font:inherit;font-size:.86rem"' + L + '>' + esc(s.notes || '') + '</textarea></label>'
      : '<label class="mt-f">Colore in vista neutra<input id="nc" type="color" value="' + esc(s.color || COL.neutro) + '"' + L + '></label><div class="mt-row" id="sw">' + SW.map(c => '<button class="mt-btn" data-c="' + c + '" title="' + c + '" style="width:26px;height:26px;padding:0;border-radius:8px;background:' + c + '"' + L + '></button>').join('') + '<button class="mt-btn" id="ncr"' + L + '>Predefinito</button></div>') +
    '<label class="mt-f">Dimensione nome (' + Math.round((s.lscale || 1) * 100) + '%)<input id="lsz" type="range" min="30" max="400" step="5" value="' + Math.round((s.lscale || 1) * 100) + '"' + L + '></label><div class="mt-row"><button class="mt-btn" id="lfit"' + L + '>Adatta allo spazio</button><button class="mt-btn" id="lrst"' + L + '>100%</button></div>' +
    '<label class="mt-f">Altezza (m)<input id="hh" type="number" step="0.1" min="0.2" max="12" value="' + s.h + '"' + L + '></label>' +
    '<div class="mt-row"><button class="mt-btn" id="r1"' + L + '>\u27F2 \u221215\u00b0</button><button class="mt-btn" id="r2"' + L + '>\u27F3 +15\u00b0</button><button class="mt-btn" id="r3"' + L + '>90\u00b0</button></div>' +
    '<div class="mt-row">' + (obj ? '' : '<a class="mt-btn" href="/assignment-groups/' + s.id + '" style="text-decoration:none">Apri scheda gruppo</a>') + '<button class="mt-btn del" id="rm"' + L + '>' + (obj ? 'Elimina oggetto' : 'Rimuovi dalla pianta') + '</button></div>';
  $('lk').onclick = () => toggleLock(s);
  if ($('ef')) $('ef').onclick = () => startEdit(s);
  if ($('sty')) $('sty').onclick = () => { const old = s.model; s.model = old === 'area' ? null : 'area'; buildStand(s); saveGeom(s, () => { s.model = old; buildStand(s); refresh(); }); refresh(); };
  if ($('mc')) $('mc').onclick = () => { const old = s.model; s.model = null; buildStand(s); saveGeom(s, () => { s.model = old; buildStand(s); refresh(); }); refresh(); toast('Ora e un volume libero: la forma si modifica con i vertici'); };
  if ($('on')) $('on').onchange = e => { const old = s.name; s.name = (e.target.value || '').trim().slice(0, 60) || old; buildStand(s); saveGeom(s, () => { s.name = old; buildStand(s); refresh(); }); refresh(); };
  if ($('oc')) $('oc').onchange = e => { const old = s.color; s.color = e.target.value; paint(); saveGeom(s, () => { s.color = old; paint(); refresh(); }); };
  $('hh').onchange = e => { const old = s.h; s.h = Math.max(.2, Math.min(12, parseFloat(e.target.value) || 2.5)); buildStand(s); saveGeom(s, () => { s.h = old; buildStand(s); refresh(); }); refresh(); };
  const setNc = v => { const old = s.color; s.color = v; paint(); saveGeom(s, () => { s.color = old; paint(); refresh(); }); refresh(); };
  if ($('nc')) $('nc').onchange = e => setNc(e.target.value);
  if ($('ncr')) $('ncr').onclick = () => setNc(null);
  document.querySelectorAll('#sw button[data-c]').forEach(b => { b.onclick = () => setNc(b.dataset.c); });
  if ($('onote')) $('onote').onchange = e => { const old = s.notes; s.notes = (e.target.value || '').slice(0, 500); saveGeom(s, () => { s.notes = old; refresh(); }); };
  $('lsz').oninput = e => { s.lscale = e.target.value / 100; const m = meshes.get(s.id); if (m) orientLabel(m.lab, s); };
  $('lsz').onchange = () => { renderSel(); saveGeom(s); };
  $('lfit').onclick = () => { fitLabel(s); renderSel(); saveGeom(s); };
  $('lrst').onclick = () => { s.lscale = 1; const m = meshes.get(s.id); if (m) orientLabel(m.lab, s); renderSel(); saveGeom(s); };
  $('r1').onclick = () => rot(s, -15); $('r2').onclick = () => rot(s, 15); $('r3').onclick = () => rot(s, 90);
  $('rm').onclick = () => removeStand(s);
}

/* ---------- salvataggio ---------- */
function geomBody(s) { return { zone: s.zone, fx: s.fx, fy: s.fy, wf: s.wf, df: s.df, rot: s.rot, shape: (isLine(s) && s.shape && s.shape.length === 2) ? s.shape.concat([s.shape[1]]) : s.shape, height: s.h, model: s.model || null, kind: s.kind || 'stand', label: s.kind === 'obj' ? s.name : null, color: s.color || null, notes: s.kind === 'obj' ? (s.notes || '') : null, lscale: s.lscale || 1 }; }
function saveGeom(s, onFail) {
  return api('/admin/mappatest/layout/' + s.id, geomBody(s)).then(d => {
    if (d && d.ok) { toast('\u2713 Salvato (test)'); return true; }
    toast(d && d.status === 423 ? s.name + ' \u00e8 bloccato' : 'Salvataggio non riuscito' + (d && d.error ? ': ' + d.error : '')); if (onFail) onFail(); return false;
  });
}
function toggleLock(s) {
  api('/admin/mappatest/layout/' + s.id + '/lock', { locked: s.locked ? 0 : 1 }).then(d => { if (d && d.ok) { s.locked = !s.locked; toast(s.locked ? s.name + ' bloccato' : s.name + ' sbloccato'); refresh(); } else toast('Operazione non riuscita'); });
}
function removeStand(s) {
  if (s.locked) return; if (!confirm((s.kind === 'obj' ? 'Eliminare l\'oggetto ' : 'Rimuovere ') + s.name + (s.kind === 'obj' ? '?' : ' dalla pianta di test?'))) return;
  api('/admin/mappatest/layout/' + s.id + '/remove', {}).then(d => { if (d && d.ok) { s.placed = false; s.shape = null; s.model = null; buildStand(s); if (s.kind === 'obj') { const ix = stands.indexOf(s); if (ix > -1) stands.splice(ix, 1); } selected = null; refresh(); } else toast(d && d.status === 423 ? 'Stand bloccato' : 'Operazione non riuscita'); });
}
let rotTimer = null;
function rot(s, a) { if (s.locked) return; s.rot = (s.rot + a + 360) % 360; applyRot(s); refresh(); clearTimeout(rotTimer); rotTimer = setTimeout(() => saveGeom(s), 500); }

/* ---------- puntatore ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
const planeY = h => new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
function setNdc(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
function pickStand(e) { setNdc(e); const h = ray.intersectObjects([...meshes.values()].map(m => m.body), true).find(x => x.object.userData && x.object.userData.id != null); return h ? h.object.userData.id : null; }
function floorPoint(e) {
  setNdc(e);
  if (MODEL && RAISED_S.length && ray.ray.intersectPlane(planeY(MODEL.heights.raise), hit)) { const p1 = hit.clone(); if (RAISED_S.some(p => pointIn(p, p1.x, p1.z))) return p1; }
  return ray.ray.intersectPlane(planeY(0), hit) ? hit.clone() : null;
}
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
  if (list.length > 1) { const g = new THREE.BufferGeometry().setFromPoints(list.concat(list.length > 2 && dr.kind !== 'line' ? [list[0]] : []).map(p => new THREE.Vector3(p[0], .5, p[1]))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6b3fa0, depthTest: false })); l.renderOrder = 9; overlay.add(l); }
  dr.pts.forEach((p, i) => overlay.add(dot(p[0], p[1], i === 0 ? r * 1.5 : r, i === 0 ? 0xf5c842 : 0x6b3fa0, 2.0)));
}
function startDraw(s, kind) {
  if (mState !== 'idle' || ZN === null) return; mState = 'draw'; selected = null; goView('top'); lockCam(true); dr = { stand: s, kind: kind || 'poly', pts: [], cursor: null }; refresh(); drawBanner();
}
function drawBanner() {
  if (dr.kind === 'line') { setBanner('<span>Traccia <b>' + esc(dr.stand.name) + '</b></span><span class="dim">clic su ogni punto \u00b7 doppio clic o Invio per terminare \u00b7 Backspace toglie l\'ultimo</span><button class="mt-btn" id="dc">Annulla</button>'); $('dc').onclick = cancelDraw; return; }
  setBanner('<span>Disegna <b>' + esc(dr.stand.name) + '</b></span><div class="mt-seg"><button data-k="poly" class="' + (dr.kind === 'poly' ? 'on' : '') + '">Poligono</button><button data-k="rect" class="' + (dr.kind === 'rect' ? 'on' : '') + '">Rettangolo</button></div><span class="dim">' +
    (dr.kind === 'poly' ? 'clic sui punti \u00b7 doppio clic o Invio per chiudere \u00b7 Backspace toglie l\'ultimo' : 'clic su due angoli opposti') + '</span><button class="mt-btn" id="dc">Annulla</button>');
  banner.querySelectorAll('.mt-seg button').forEach(b => b.onclick = () => { dr.kind = b.dataset.k; dr.pts = []; drawOverlay(); drawBanner(); });
  $('dc').onclick = cancelDraw;
}
function cancelDraw() { dr = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); refresh(); }
function finishDraw() {
  if (!dr) return; let pts = dr.pts;
  if (dr.kind === 'rect') { if (pts.length < 2) return; const a = pts[0], b = pts[1]; pts = [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])]]; }
  if (pts.length < (dr.kind === 'line' ? 2 : 3)) { toast(dr.kind === 'line' ? 'Servono almeno 2 punti' : 'Servono almeno 3 punti'); return; }
  const s = dr.stand, kind = dr.kind; applyWorldPts(s, pts); if (kind === 'rect') s.shape = null;
  if (kind !== 'line' && (s.wf * W < .8 || s.df * D < .8)) { toast('Forma troppo piccola'); return; }
  s.model = kind === 'line' ? 'obj-transenna' : (s.kind === 'obj' ? null : 'area'); commitPlaced(s);
}
function addDrawPoint(p) {
  const x = snap(p.x), z = snap(p.z), last = dr.pts[dr.pts.length - 1]; if (last && last[0] === x && last[1] === z) return;
  if (dr.kind === 'poly' && dr.pts.length >= 3 && Math.hypot(x - dr.pts[0][0], z - dr.pts[0][1]) < 1.2 * Math.max(W, D) / 80) { finishDraw(); return; }
  dr.pts.push([x, z]); if (dr.kind === 'rect' && dr.pts.length === 2) { finishDraw(); return; } drawOverlay();
}

/* modifica forma */
function focusStand(s) {
  const P = worldPts(s); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; P.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, dist = Math.max(10, Math.max(x1 - x0, z1 - z0, 4) * 2.4), by = baseOf(s); curView = 'top';
  tween = { t0: performance.now(), dur: 800, from: camera.position.clone(), fromT: controls.target.clone(), to: new THREE.Vector3(cx, by + dist, cz + .001), toT: new THREE.Vector3(cx, by, cz) };
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === 'top'));
}
function startEdit(s) {
  if (s.locked) { toast('Stand bloccato: sbloccalo per modificarlo'); return; } if (mState !== 'idle') return;
  const me = !!(s.model && MODEL_DEFS[s.model] && !isLine(s));
  ed = { s, me, open: isLine(s), pts: worldPts(s).map(p => p.slice()), snapshot: { fx: s.fx, fy: s.fy, wf: s.wf, df: s.df, rot: s.rot, shape: s.shape }, handles: [], mids: [] };
  mState = 'edit'; if (!me) { applyWorldPts(s, ed.pts); buildStand(s); } focusStand(s); lockCam(true); buildHandles();
  setBanner('<span>' + (me ? 'Ridimensiona' : 'Modifica forma di') + ' <b>' + esc(s.name) + '</b></span><span class="dim">' + (me ? 'trascina gli angoli per allargare o restringere il modello' : 'trascina i vertici \u00b7 clic sui punti gialli per aggiungerne uno \u00b7 doppio clic su un vertice per toglierlo') + '</span><button class="mt-btn pri" id="ek">\u2713 Fine</button><button class="mt-btn" id="ec">Annulla modifiche</button>');
  $('ek').onclick = endEdit; $('ec').onclick = cancelEdit;
}
function modelEditMove(p) {
  const s = ed.s, i = handleDrag, { w, d } = dims(s), cx = (s.fx - .5) * W, cz = (s.fy - .5) * D, a = -s.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const u = p.x - cx, v = p.z - cz, x = u * c - v * sn, y = u * sn + v * c;
  const L = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], o = L[(i + 2) % 4];
  const si = L[i][0] > o[0] ? 1 : -1, sj = L[i][1] > o[1] ? 1 : -1;
  const nw = Math.max(.5, snap((x - o[0]) * si)), nd = Math.max(.5, snap((y - o[1]) * sj)), lx = o[0] + si * nw / 2, ly = o[1] + sj * nd / 2;
  s.fx = (cx + lx * c + ly * sn) / W + .5; s.fy = (cz - lx * sn + ly * c) / D + .5; s.wf = nw / W; s.df = nd / D;
  ed.pts = worldPts(s).map(q => q.slice()); buildStand(s); buildHandles(); computeConflicts(); paint();
}
function buildHandles() {
  clearOverlay(); if (!ed) return; ed.handles = []; ed.mids = []; const r = rr() * 1.1, y = baseOf(ed.s) + Math.max(ed.s.h * hScale, .4) + .6, n = ed.pts.length;
  ed.pts.forEach((p, i) => { overlay.add(dot(p[0], p[1], r * 1.25, 0x6b3fa0, y - .01)); const m = dot(p[0], p[1], r, 0xffffff, y); m.userData = { type: 'v', i }; ed.handles.push(m); overlay.add(m); });
  const nm = ed.me ? 0 : (ed.open ? n - 1 : n); for (let i = 0; i < nm; i++) { const a = ed.pts[i], b = ed.pts[(i + 1) % n]; const m = dot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r * .7, 0xf5c842, y); m.userData = { type: 'm', i }; ed.mids.push(m); overlay.add(m); }
  const g = new THREE.BufferGeometry().setFromPoints(ed.pts.concat(ed.open ? [] : [ed.pts[0]]).map(p => new THREE.Vector3(p[0], y - .02, p[1]))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6b3fa0, depthTest: false })); l.renderOrder = 8; overlay.add(l);
}
function pickHandle(e) { if (!ed) return null; setNdc(e); const h = ray.intersectObjects(ed.handles.concat(ed.mids), false)[0]; return h ? h.object.userData : null; }
function endEdit() {
  if (!ed) return; const s = ed.s, snapG = ed.snapshot; if (!ed.me) applyWorldPts(s, ed.pts); ed = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); buildStand(s); refresh();
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
  if (mState === 'draw' || mState === 'place') return;
  const id = pickStand(e);
  if (id != null) {
    selected = id; const s = stands.find(x => x.id === id);
    if (s.locked) { toast(s.name + ' \u00e8 bloccato: sbloccalo per spostarlo'); refresh(); return; }
    const p = floorPoint(e); if (p) { drag = { s, ox: (s.fx - .5) * W - p.x, oz: (s.fy - .5) * D - p.z, moved: false, ofx: s.fx, ofy: s.fy }; controls.enabled = false; }
    refresh();
  }
});
cvs.addEventListener('pointermove', e => {
  if (mState === 'edit' && handleDrag != null && ed.me) { const p = floorPoint(e); if (p) modelEditMove(p); return; }
  if (mState === 'edit' && handleDrag != null) { const p = floorPoint(e); if (!p) return; ed.pts[handleDrag] = [snap(Math.max(-W / 2, Math.min(W / 2, p.x))), snap(Math.max(-D / 2, Math.min(D / 2, p.z)))]; applyWorldPts(ed.s, ed.pts); buildStand(ed.s); buildHandles(); computeConflicts(); paint(); return; }
  if (mState === 'draw' && dr) { const p = floorPoint(e); if (p) { dr.cursor = [snap(p.x), snap(p.z)]; drawOverlay(); } return; }
  if (mState === 'place' && plc) { const p = floorPoint(e); if (p) plcMove(p); cvs.style.cursor = 'crosshair'; return; }
  if (drag) {
    const p = floorPoint(e); if (!p) return; const x = snap(p.x + drag.ox), z = snap(p.z + drag.oz);
    drag.s.fx = Math.max(.01, Math.min(.99, x / W + .5)); drag.s.fy = Math.max(.01, Math.min(.99, z / D + .5)); drag.moved = true;
    meshes.get(drag.s.id).group.position.set((drag.s.fx - .5) * W, baseOf(drag.s), (drag.s.fy - .5) * D); computeConflicts(); paint(); $('mt-tip').style.display = 'none'; return;
  }
  const tip = $('mt-tip');
  if (mState !== 'idle') { tip.style.display = 'none'; cvs.style.cursor = mState === 'draw' ? 'crosshair' : (pickHandle(e) ? 'move' : 'default'); return; }
  const id = pickStand(e);
  if (id != null) { const s = stands.find(x => x.id === id); tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.innerHTML = '<b>' + esc(s.name) + '</b>' + (s.locked ? ' \uD83D\uDD12' : '') + (s.kind === 'obj' ? (s.notes ? '<br>' + esc(s.notes).replace(/\n/g, '<br>') : '') : '<br>' + s.done + '/' + s.pass + ' pass'); cvs.style.cursor = s.locked ? 'not-allowed' : 'grab'; }
  else { tip.style.display = 'none'; cvs.style.cursor = 'default'; }
});
addEventListener('pointerup', e => {
  if (handleDrag != null) { handleDrag = null; controls.enabled = true; refresh(); return; }
  if (mState === 'draw' && dr && down && e.target === cvs && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { const p = floorPoint(e); if (inFloor(p)) addDrawPoint(p); down = null; return; }
  if (mState === 'place' && plc && down && e.target === cvs && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { const p = floorPoint(e); if (p) { plcMove(p); confirmPlace(); } down = null; return; }
  if (drag) {
    const dg = drag; drag = null; controls.enabled = true;
    if (dg.moved) { refresh(); saveGeom(dg.s, () => { dg.s.fx = dg.ofx; dg.s.fy = dg.ofy; buildStand(dg.s); refresh(); }); if (conflicts.has(dg.s.id)) toast('Attenzione: lo stand si sovrappone a un altro'); }
    return;
  }
  if (mState === 'idle' && down && e.target === cvs && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && pickStand(e) == null) { selected = null; refresh(); }
  down = null;
});
cvs.addEventListener('dblclick', e => {
  if (mState === 'draw' && dr && (dr.kind === 'poly' || dr.kind === 'line')) { finishDraw(); return; }
  if (mState === 'edit' && !ed.me) { const h = pickHandle(e); if (h && h.type === 'v') { if (ed.pts.length <= (ed.open ? 2 : 3)) { toast('Servono almeno 3 vertici'); return; } ed.pts.splice(h.i, 1); applyWorldPts(ed.s, ed.pts); buildStand(ed.s); buildHandles(); computeConflicts(); paint(); } }
});
addEventListener('keydown', e => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (mState === 'draw') { if (e.key === 'Enter') finishDraw(); else if (e.key === 'Escape') cancelDraw(); else if (e.key === 'Backspace') { dr.pts.pop(); drawOverlay(); e.preventDefault(); } }
  else if (mState === 'edit') { if (e.key === 'Enter') endEdit(); else if (e.key === 'Escape') cancelEdit(); }
  else if (mState === 'place') { if (e.key === 'r' || e.key === 'R') rotatePlace(); else if (e.key === 'Escape') cancelPlace(); }
});

/* ---------- modelli 3D predefiniti, selettore e posizionamento ---------- */
const matFix = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? .7 : r, metalness: .05 });
const MF = { alu: matFix(0xb8bcc4, .4), white: matFix(0xf3f3f1, .8), dark: matFix(0x2b2d36, .8), wood: matFix(0xe3d9c6, .8), plat: matFix(0xdedbe6, .9) };
function box(w, h, d, x, y0, z, m) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y0 + h / 2, z); me.castShadow = true; me.receiveShadow = true; return me; }
function buildGazebo(w, d, H, mat) {
  const g = new THREE.Group(), eave = Math.min(2.4, H * .72), rh = Math.max(.3, H - eave), t = .03, lg = .07, vh = .3;
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(c => g.add(box(lg, eave, lg, c[0] * (w / 2 - lg / 2), 0, c[1] * (d / 2 - lg / 2), MF.alu)));
  g.add(box(w - .04, eave - .12, t, 0, 0, -d / 2 + t / 2 + .01, mat), box(t, eave - .12, d - .04, -w / 2 + t / 2 + .01, 0, 0, mat), box(t, eave - .12, d - .04, w / 2 - t / 2 - .01, 0, 0, mat));
  g.add(box(w, vh, t, 0, eave - vh, d / 2 - t / 2, mat), box(w, vh, t, 0, eave - vh, -d / 2 + t / 2, mat), box(t, vh, d, -w / 2 + t / 2, eave - vh, 0, mat), box(t, vh, d, w / 2 - t / 2, eave - vh, 0, mat));
  const cg = new THREE.ConeGeometry(Math.SQRT1_2, rh, 4, 1); cg.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(cg, mat); roof.scale.set(w + .12, 1, d + .12); roof.position.y = eave + rh / 2; roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
  return g;
}
function buildIndoor(w, d, H, mat) {
  const g = new THREE.Group(), t = .05, sd = Math.min(1, d * .5);
  g.add(box(w, .08, d, 0, 0, 0, MF.plat));
  g.add(box(w, H - .08, t, 0, .08, -d / 2 + t / 2, mat));
  g.add(box(w * .8, .32, .08, 0, Math.max(.5, H - .5), -d / 2 + t + .04, MF.white));
  g.add(box(t, H * .8 - .08, sd, -w / 2 + t / 2, .08, -d / 2 + sd / 2, mat), box(t, H * .8 - .08, sd, w / 2 - t / 2, .08, -d / 2 + sd / 2, mat));
  g.add(box(Math.min(w * .6, w - .4), 1, .45, 0, .08, d / 2 - .45, MF.wood));
  return g;
}
function buildKiosk(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(w, H, d, 0, 0, 0, mat), box(w * .6, .7, .06, 0, 1, d / 2, MF.dark), box(w * .7, .06, .3, 0, .95, d / 2 + .15, MF.white), box(w + .2, .12, d + .2, 0, H, 0, MF.white), box(w * .5, .3, .05, 0, H + .12, d / 2, MF.dark));
  return g;
}
function buildStage(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(w, H, d, 0, 0, 0, mat), box(w, .04, d, 0, H, 0, MF.plat), box(Math.min(1.2, w), Math.max(.2, H / 2), .4, w / 2 - Math.min(1.2, w) / 2 - .2, 0, d / 2 + .2, mat), box(w, 2.4, .08, 0, H, -d / 2 + .1, MF.dark));
  [-1, 1].forEach(k => g.add(box(.1, 3, .1, k * (w / 2 - .1), H, -d / 2 + .1, MF.alu)));
  return g;
}
function buildDesk(w, d, H, mat) {
  const g = new THREE.Group(), ph = Math.min(2.4, H);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(c => g.add(box(.07, ph, .07, c[0] * (w / 2 - .05), 0, c[1] * (d / 2 - .05), MF.alu)));
  g.add(box(w + .2, .1, d + .2, 0, ph, 0, mat), box(w * .8, .9, .5, 0, 0, d / 2 - .5, MF.wood), box(w * .8, .75, .6, 0, 0, -d / 2 + .5, mat));
  return g;
}
function mkTex(fn) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; fn(cv.getContext('2d')); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
let _bolt = null, _acc = null;
const boltTex = () => _bolt || (_bolt = mkTex(g => { g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#1e2d4e'; g.lineWidth = 6; g.stroke(); g.fillStyle = '#1e2d4e'; g.beginPath(); [[74, 14], [32, 72], [58, 72], [48, 114], [98, 52], [70, 52], [86, 14]].forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); }));
const accTex = () => _acc || (_acc = mkTex(g => { g.fillStyle = '#1f6fd6'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.arc(58, 24, 9, 0, 7); g.fill(); g.beginPath(); g.moveTo(58, 38); g.lineTo(58, 74); g.lineTo(88, 74); g.lineTo(100, 108); g.moveTo(58, 54); g.lineTo(86, 54); g.stroke(); g.beginPath(); g.arc(54, 86, 22, -Math.PI * .1, Math.PI * 1.1); g.stroke(); }));
function buildWc(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(w, H, d, 0, 0, 0, mat), box(w * .6, H * .82, .05, 0, 0, d / 2 + .01, MF.dark), box(w + .1, .1, d + .1, 0, H, 0, MF.white), box(.5, .12, .5, w / 4, H + .1, -d / 4, MF.white));
  return g;
}
function buildWcDis(w, d, H, mat) {
  const g = buildWc(w, d, H, mat), sg = new THREE.Mesh(new THREE.PlaneGeometry(.6, .6), new THREE.MeshBasicMaterial({ map: accTex() }));
  sg.position.set(-w / 2 + .5, H * .62, d / 2 + .04); g.add(sg); return g;
}
function buildBolt(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(.3, H, .3, 0, 0, 0, MF.dark), box(.36, .14, .36, 0, H, 0, mat));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(.55, 24), new THREE.MeshBasicMaterial({ map: boltTex(), transparent: true, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = H + .22; g.add(disc); return g;
}
function buildFence(s, w, d, mat) {
  const g = new THREE.Group(), P = (s.shape || [[0, 0], [1, 1]]).map(p => [(p[0] - .5) * w, (p[1] - .5) * d]), H = Math.max(.5, Math.min(3, s.h || 2));
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < .05) continue;
    const n = Math.max(1, Math.round(L / 2)), pl = L / n, ang = -Math.atan2(dz, dx);
    for (let k = 0; k < n; k++) {
      const t = (k + .5) / n, pn = new THREE.Group(); pn.position.set(a[0] + dx * t, 0, a[1] + dz * t); pn.rotation.y = ang;
      pn.add(box(pl - .04, .05, .04, 0, H - .12, 0, mat), box(pl - .04, .05, .04, 0, .22, 0, mat));
      const nb = Math.max(3, Math.round(pl / .25));
      for (let j = 0; j < nb; j++) pn.add(box(.02, H - .34, .02, -(pl - .12) / 2 + (pl - .12) * j / (nb - 1), .22, 0, mat));
      pn.add(box(.05, H, .05, -pl / 2 + .03, 0, 0, MF.alu), box(.05, H, .05, pl / 2 - .03, 0, 0, MF.alu)); g.add(pn);
    }
  }
  return g;
}
function inRing(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if (((a[1] > z) !== (b[1] > z)) && (x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
function edgeDist(P, x, z) { let m = 1e9; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)); } return m; }
function bboxOf(P) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; P.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); return { x0, x1, z0, z1 }; }
function innerPoint(P) {
  const b = bboxOf(P); let best = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], bd = -1;
  for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) { const x = b.x0 + (b.x1 - b.x0) * i / 20, z = b.z0 + (b.z1 - b.z0) * j / 20; if (!inRing(P, x, z)) continue; const dd = edgeDist(P, x, z); if (dd > bd) { bd = dd; best = [x, z]; } }
  return { p: best, r: Math.max(bd, .3) };
}
function buildTables(P, ip) {
  const g = new THREE.Group(), b = bboxOf(P), tw = 1.6, td = .8, hx = tw / 2 + .45, hz = td / 2 + .45;
  const k = Math.max(1, Math.sqrt(((b.x1 - b.x0) * (b.z1 - b.z0)) / (2.6 * 2.2) / 40)), sx = 2.6 * k, sz = 2.2 * k; let n = 0;
  const add = (x, z) => {
    g.add(box(tw, .05, td, x, .73, z, MF.wood)); [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(c => g.add(box(.05, .73, .05, x + c[0] * (tw / 2 - .06), 0, z + c[1] * (td / 2 - .06), MF.alu)));
    [[-.45, -1], [.45, -1], [-.45, 1], [.45, 1]].forEach(c => g.add(box(.38, .45, .38, x + c[0], 0, z + c[1] * (td / 2 + .25), MF.dark))); n++;
  };
  for (let x = b.x0 + hx; x <= b.x1 - hx + .01; x += sx) for (let z = b.z0 + hz; z <= b.z1 - hz + .01; z += sz) {
    if ([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].every(c => inRing(P, x + c[0], z + c[1]))) add(x, z);
  }
  if (!n) add(ip.p[0], ip.p[1]);
  return g;
}
function buildAreaStand(s) {
  const { w, d } = dims(s), P = (s.shape || [[0, 0], [1, 0], [1, 1], [0, 1]]).map(p => [(p[0] - .5) * w, (p[1] - .5) * d]);
  const mat = new THREE.MeshStandardMaterial({ color: colorOf(s), roughness: .5, metalness: .06 });
  const sh = new THREE.Shape(); P.forEach((p, i) => i ? sh.lineTo(p[0], -p[1]) : sh.moveTo(p[0], -p[1]));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: .1, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(geo, mat); body.receiveShadow = true; body.userData.id = s.id;
  const emat = new THREE.LineBasicMaterial({ color: s.locked ? 0xc9a227 : 0x1e2d4e, transparent: true, opacity: s.locked ? .95 : .3 });
  body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 45), emat));
  const ip = innerPoint(P); let ly, ls;
  if (isOut()) { const sz = Math.max(1, Math.min(2, ip.r * 1.7)), gz = buildGazebo(sz, sz, 3, mat); gz.position.set(ip.p[0], .1, ip.p[1]); body.add(gz); ly = 3.3; ls = Math.max(2.4, sz * 1.6); }
  else { const tb = buildTables(P, ip); tb.position.y = .1; body.add(tb); ly = 1.1; ls = Math.max(2.4, Math.min(w, d * 3) * .6); }
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls / 2), new THREE.MeshBasicMaterial({ map: labelTexture(s.name), transparent: true, depthWrite: false }));
  orientLabel(lab, s); lab.position.set(ip.p[0], ly, ip.p[1]); lab.visible = labelsOn; lab.raycast = () => {}; body.add(lab);
  body.traverse(o => { o.userData.id = s.id; if (o.isLine) o.raycast = () => {}; });
  const grp = new THREE.Group(); grp.add(body);
  const lk = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, depthTest: false })); lk.scale.set(1, 1, 1); lk.visible = !!s.locked; lk.raycast = () => {}; lk.renderOrder = 5; grp.add(lk);
  grp.position.set((s.fx - .5) * W, baseOf(s), (s.fy - .5) * D); grp.rotation.y = -s.rot * Math.PI / 180; body.scale.y = hScale; placeLock(lk, s);
  world.add(grp); meshes.set(s.id, { group: grp, body, mat, lab, emat, lk });
}
const ICON = {
  gaz: '<svg viewBox="0 0 64 64"><path d="M32 6 L58 26 H6 Z"/><path d="M12 26V56M52 26V56M12 56H52"/></svg>',
  stand: '<svg viewBox="0 0 64 64"><rect x="8" y="12" width="48" height="8"/><path d="M10 20V50M54 20V50"/><rect x="18" y="40" width="28" height="10"/><path d="M6 54H58"/></svg>',
  custom: '<svg viewBox="0 0 64 64"><path d="M10 48 L16 20 L44 14 L52 40 Z" stroke-dasharray="5 4"/><path d="M40 52 L54 38 L58 42 L44 56 Z"/></svg>',
  ticket: '<svg viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="38"/><rect x="18" y="28" width="28" height="10"/><path d="M4 14H60"/></svg>',
  stage: '<svg viewBox="0 0 64 64"><path d="M6 44H58V54H6Z"/><path d="M12 44V12M52 44V12M12 12H52"/></svg>',
  wc: '<svg viewBox="0 0 64 64"><rect x="18" y="8" width="28" height="46"/><path d="M18 54H46M26 20H38M32 20V36"/></svg>',
  acc: '<svg viewBox="0 0 64 64"><rect x="14" y="8" width="36" height="46"/><circle cx="30" cy="20" r="4"/><path d="M30 26V38H40L44 48M30 32H38"/><circle cx="28" cy="42" r="8"/></svg>',
  fence: '<svg viewBox="0 0 64 64"><path d="M6 50L24 20L42 44L58 14" stroke-dasharray="6 4"/><path d="M6 50V30M24 20V4M42 44V24M58 14V0"/></svg>',
  bolt: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26"/><path d="M36 8L20 36H32L28 56L46 26H34Z"/></svg>',
  desk: '<svg viewBox="0 0 64 64"><path d="M8 22H56"/><path d="M12 22V54M52 22V54"/><rect x="16" y="34" width="32" height="8"/></svg>'
};
const CUSTOM_IT = { custom: true, label: 'Personalizzato', sub: 'Disegni la forma in mappa', icon: ICON.custom };
const CAT_IN = [
  { key: 'in-4x25', label: '4 \u00d7 2,5 m', sub: 'Stand al chiuso', w: 4, d: 2.5, h: 2.5, icon: ICON.stand, build: buildIndoor },
  { key: 'in-2x15', label: '2 \u00d7 1,5 m', sub: 'Stand al chiuso', w: 2, d: 1.5, h: 2.5, icon: ICON.stand, build: buildIndoor }, CUSTOM_IT];
const CAT_OUT = [
  { key: 'out-3x3', label: '3 \u00d7 3 m', sub: 'Gazebo all\'aperto', w: 3, d: 3, h: 3.4, icon: ICON.gaz, build: buildGazebo },
  { key: 'out-4x3', label: '4 \u00d7 3 m', sub: 'Gazebo all\'aperto', w: 4, d: 3, h: 3.4, icon: ICON.gaz, build: buildGazebo }, CUSTOM_IT];
const CAT_OBJ = [
  { key: 'obj-biglietteria', label: 'Biglietteria', sub: '3 \u00d7 2 m', w: 3, d: 2, h: 2.5, color: '#e67e22', icon: ICON.ticket, build: buildKiosk },
  { key: 'obj-palco', label: 'Palco', sub: '6 \u00d7 4 m', w: 6, d: 4, h: 1, color: '#8e44ad', icon: ICON.stage, build: buildStage },
  { key: 'obj-segreteria', label: 'Segreteria', sub: '3 \u00d7 2 m', w: 3, d: 2, h: 2.5, color: '#2980b9', icon: ICON.desk, build: buildDesk },
  { key: 'obj-wc', label: 'Bagno chimico', sub: '1,2 \u00d7 1,2 m', w: 1.2, d: 1.2, h: 2.3, color: '#27ae60', icon: ICON.wc, build: buildWc, noName: true },
  { key: 'obj-wcdis', label: 'Bagno chimico disabili', sub: '2,2 \u00d7 2,2 m', w: 2.2, d: 2.2, h: 2.4, color: '#2e86de', icon: ICON.acc, build: buildWcDis, noName: true },
  { key: 'obj-transenna', label: 'Transenne', sub: '2 \u00d7 2 m \u00b7 a polilinea', w: 2, d: 2, h: 2, color: '#8d949e', icon: ICON.fence, build: null, line: true, noName: true },
  { key: 'obj-colonnina', label: 'Colonnina elettrica', sub: 'allaccio elettrico', w: .5, d: .5, h: 1.1, color: '#f1c40f', icon: ICON.bolt, build: buildBolt, noName: true },
  { custom: true, label: 'Altro (disegna)', sub: 'Disegni la forma in mappa', color: '#16a085', icon: ICON.custom }];
const MODEL_DEFS = {}; CAT_IN.concat(CAT_OUT, CAT_OBJ).forEach(it => { if (it.key) MODEL_DEFS[it.key] = it; });
const modelLabel = k => k === 'area' ? 'area personalizzata' : (MODEL_DEFS[k] ? MODEL_DEFS[k].label : k);
function buildModelStand(s) {
  const { w, d } = dims(s), line = isLine(s), noLab = line || s.model === 'obj-colonnina';
  const mat = new THREE.MeshStandardMaterial({ color: colorOf(s), roughness: .5, metalness: .06 });
  const body = line ? buildFence(s, w, d, mat) : MODEL_DEFS[s.model].build(w, d, s.h, mat);
  const emat = new THREE.LineBasicMaterial({ color: s.locked ? 0xc9a227 : 0x1e2d4e, transparent: true, opacity: s.locked ? .95 : .3 });
  if (!line) body.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(p => new THREE.Vector3(p[0], .04, p[1]))), emat));
  let lab;
  if (noLab) { lab = new THREE.Object3D(); body.add(lab); }
  else {
    const ls = Math.max(Math.min(w, d * 3), 2.2);
    lab = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls / 2), new THREE.MeshBasicMaterial({ map: labelTexture(s.name), transparent: true, depthWrite: false }));
    orientLabel(lab, s); lab.position.y = s.h + (s.model.indexOf('out-') === 0 ? .1 : .04) + (s.model === 'obj-biglietteria' ? .5 : 0) + (s.model.indexOf('obj-wc') === 0 ? .3 : 0); lab.visible = labelsOn; lab.raycast = () => {}; body.add(lab);
  }
  body.traverse(o => { o.userData.id = s.id; if (o.isLine) o.raycast = () => {}; });
  const grp = new THREE.Group(); grp.add(body);
  const lk = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, depthTest: false })); lk.scale.set(1, 1, 1); lk.visible = !!s.locked; lk.raycast = () => {}; lk.renderOrder = 5; grp.add(lk);
  grp.position.set((s.fx - .5) * W, baseOf(s), (s.fy - .5) * D); grp.rotation.y = -s.rot * Math.PI / 180; body.scale.y = hScale; placeLock(lk, s);
  world.add(grp); meshes.set(s.id, { group: grp, body, mat, lab, emat, lk });
}

/* selettore a scorrimento (coverflow) */
(function () { const st = document.createElement('style'); st.textContent =
  '.mt-cf{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(36,22,64,.6);backdrop-filter:blur(3px)}' +
  '.mt-cf-t{color:#fff;font-weight:700;font-size:18px;text-align:center;padding:0 12px;text-shadow:0 1px 4px rgba(0,0,0,.4)}' +
  '.mt-cf-s{position:relative;width:100%;max-width:760px;height:250px;perspective:900px}' +
  '.mt-cf-c{position:absolute;left:50%;top:50%;width:150px;height:200px;margin:-100px 0 0 -75px;background:#fff;border-radius:14px;box-shadow:0 10px 26px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;transition:transform .35s ease,opacity .35s ease;text-align:center;padding:10px;box-sizing:border-box;color:#2b1d4d}' +
  '.mt-cf-c.on{outline:3px solid #f5c842}.mt-cf-c span{font-size:12px;color:#6b6480}' +
  '.mt-cf-i svg{width:84px;height:84px;stroke:#6b3fa0;fill:none;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}' +
  '.mt-cf-n{display:flex;align-items:center;gap:12px;color:#fff;flex-wrap:wrap;justify-content:center}.mt-cf-n .dim{color:#e7def7;font-size:12px}';
  document.head.appendChild(st); })();
let cfOpen = false;
function openCoverflow(items, title) {
  return new Promise(res => {
    if (cfOpen) { res(null); return; }
    cfOpen = true; let idx = Math.floor(items.length / 2);
    if (getComputedStyle(vw).position === 'static') vw.style.position = 'relative';
    const el = document.createElement('div'); el.className = 'mt-cf';
    el.innerHTML = '<div class="mt-cf-t">' + esc(title) + '</div><div class="mt-cf-s"></div><div class="mt-cf-n"><button class="mt-btn" id="cfp">\u2039</button><span class="dim">\u2190 \u2192 per scorrere \u00b7 clic sulla scheda al centro per confermare \u00b7 Esc annulla</span><button class="mt-btn" id="cfn">\u203A</button></div><button class="mt-btn" id="cfx">Annulla</button>';
    vw.appendChild(el);
    const stg = el.querySelector('.mt-cf-s');
    const cards = items.map((it, i) => { const c = document.createElement('div'); c.className = 'mt-cf-c'; c.innerHTML = '<div class="mt-cf-i">' + it.icon + '</div><b>' + esc(it.label) + '</b><span>' + esc(it.sub || '') + '</span>'; c.onclick = () => { if (i === idx) done(it); else { idx = i; lay(); } }; stg.appendChild(c); return c; });
    function lay() { cards.forEach((c, i) => { const o = i - idx, ab = Math.abs(o); c.style.transform = 'translateX(' + (o * 150) + 'px) translateZ(' + (-ab * 90) + 'px) rotateY(' + (-Math.sign(o) * Math.min(ab, 2) * 38) + 'deg)'; c.style.opacity = ab > 2 ? 0 : 1 - ab * .22; c.style.zIndex = 10 - ab; c.style.pointerEvents = ab > 2 ? 'none' : 'auto'; c.classList.toggle('on', o === 0); }); }
    function done(it) { cfOpen = false; removeEventListener('keydown', key, true); el.remove(); res(it); }
    function key(e) {
      if (e.key === 'ArrowLeft') idx = Math.max(0, idx - 1); else if (e.key === 'ArrowRight') idx = Math.min(items.length - 1, idx + 1);
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(items[idx]); return; } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; } else return;
      e.preventDefault(); e.stopPropagation(); lay();
    }
    addEventListener('keydown', key, true);
    el.querySelector('#cfp').onclick = () => { idx = Math.max(0, idx - 1); lay(); };
    el.querySelector('#cfn').onclick = () => { idx = Math.min(items.length - 1, idx + 1); lay(); };
    el.querySelector('#cfx').onclick = () => done(null);
    lay();
  });
}

/* scelta del tipo e posizionamento */
async function choosePlacement(s) {
  if (mState !== 'idle' || ZN === null || cfOpen) return;
  const it = await openCoverflow(isOut() ? CAT_OUT : CAT_IN, 'Tipo di stand per ' + s.name + (isOut() ? ' \u00b7 all\'aperto' : ' \u00b7 al chiuso'));
  if (!it) return;
  if (it.custom) startDraw(s); else startPlace(s, it);
}
async function addObject() {
  if (mState !== 'idle' || ZN === null || cfOpen) return;
  const it = await openCoverflow(CAT_OBJ, 'Oggetto senza stand');
  if (!it) return;
  let name = it.noName ? it.label : prompt('Nome dell\'oggetto', it.custom ? '' : it.label); if (name === null) return;
  name = name.trim().slice(0, 60) || (it.custom ? 'Oggetto' : it.label);
  const s = { id: null, name, zone: ZN, code: '', pass: 0, done: 0, notes: '', importable: false, placed: false, fx: .5, fy: .5, wf: .03, df: .03, rot: 0, shape: null, h: it.h || 2.5, locked: false, model: null, kind: 'obj', color: it.color };
  if (it.line) startDraw(s, 'line'); else if (it.custom) startDraw(s); else startPlace(s, it);
}
let plc = null;
function startPlace(s, it) {
  if (mState !== 'idle' || ZN === null) return;
  mState = 'place'; selected = null; goView('top'); lockCam(true);
  plc = { s, it, w: Math.min(it.w, W - 1), d: Math.min(it.d, D - 1), rot: 0, cur: null, raw: null, base: 0 };
  refresh(); placeBanner();
}
function placeBanner() {
  setBanner('<span>Posiziona <b>' + esc(plc.s.name) + '</b> \u00b7 ' + esc(plc.it.label) + '</span><span class="dim">clic per piazzare \u00b7 R ruota di 90\u00b0 \u00b7 Esc annulla</span><button class="mt-btn" id="pr">Ruota</button><button class="mt-btn" id="pc">Annulla</button>');
  $('pr').onclick = rotatePlace; $('pc').onclick = cancelPlace;
}
function plcMove(p) {
  if (!plc) return; plc.raw = { x: p.x, z: p.z };
  const q = plc.rot % 180 === 90, hx = (q ? plc.d : plc.w) / 2, hz = (q ? plc.w : plc.d) / 2;
  const cx = Math.max(-W / 2 + hx, Math.min(W / 2 - hx, snap(p.x))), cz = Math.max(-D / 2 + hz, Math.min(D / 2 - hz, snap(p.z)));
  plc.cur = [cx, cz]; ghostOverlay();
}
function ghostOverlay() {
  clearOverlay(); if (!plc || !plc.cur) return;
  const t = { fx: plc.cur[0] / W + .5, fy: plc.cur[1] / D + .5, wf: plc.w / W, df: plc.d / D, rot: plc.rot, shape: null };
  plc.base = baseOf(t); const y = plc.base + .08, v = worldPts(t).map(p => new THREE.Vector3(p[0], y, p[1]));
  const ln = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: 0x6b3fa0, depthTest: false })); ln.renderOrder = 9; overlay.add(ln);
  const fm = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([v[0], v[1], v[2], v[0], v[2], v[3]]), new THREE.MeshBasicMaterial({ color: colorOf(plc.s), transparent: true, opacity: .4, depthTest: false, side: THREE.DoubleSide })); fm.renderOrder = 8; overlay.add(fm);
}
function rotatePlace() { if (!plc) return; plc.rot = (plc.rot + 90) % 360; if (plc.raw) plcMove(plc.raw); }
function cancelPlace() { plc = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false); refresh(); }
function confirmPlace() {
  if (!plc || !plc.cur) return; const { s, it } = plc;
  s.fx = plc.cur[0] / W + .5; s.fy = plc.cur[1] / D + .5; s.wf = plc.w / W; s.df = plc.d / D; s.rot = plc.rot; s.shape = null; s.model = it.key; s.h = it.h;
  commitPlaced(s);
}
function commitPlaced(s) {
  s.placed = true; dr = null; plc = null; mState = 'idle'; clearOverlay(); setBanner(''); lockCam(false);
  if (s.kind === 'obj' && s.id == null) {
    api('/admin/mappatest/object', geomBody(s)).then(d => {
      if (d && d.ok) { s.id = d.id; stands.push(s); selected = s.id; buildStand(s); refresh(); toast('\u2713 Oggetto salvato (test)'); }
      else { toast('Salvataggio non riuscito' + (d && d.error ? ': ' + d.error : '')); refresh(); }
    });
    return;
  }
  selected = s.id; buildStand(s); refresh();
  saveGeom(s, () => { s.placed = false; s.shape = null; s.model = null; buildStand(s); selected = null; refresh(); });
}
$('outd').onchange = e => {
  if (!Z) return; const v = e.target.checked;
  api('/admin/mappatest/zone-outdoor', { zone: Z.name, outdoor: v ? 1 : 0 }).then(d => { if (d && d.ok) { Z.outdoor = v; zs().forEach(buildStand); toast(v ? 'Zona all\'aperto' : 'Zona al chiuso'); } else { e.target.checked = !v; toast('Salvataggio non riuscito'); } });
};

(function () {
  const st = document.createElement('style'); st.textContent =
    '.mt-wide-btn{position:absolute;left:12px;top:12px;z-index:21;width:36px;height:36px;border-radius:12px;border:1.5px solid #d9cff0;background:rgba(255,255,255,.95);color:#4c2c78;font-size:18px;line-height:1;cursor:pointer;box-shadow:0 4px 12px rgba(30,45,78,.18)}' +
    'body.mp-on .mt-view .mt-banner{left:58px;max-width:calc(62% - 46px)}' +
    '@media (min-width:1001px){body.mp-on .mt-main.mt-wide{grid-template-columns:minmax(0,1fr)}body.mp-on .mt-main.mt-wide .mt-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:.9rem;align-items:start}body.mp-on .mt-main.mt-wide .mt-panel{margin-bottom:0}}' +
    '@media (max-width:1000px){.mt-wide-btn{display:none}}#mt-tip{max-width:260px;white-space:normal}';
  document.head.appendChild(st);
  const main = document.querySelector('.mt-main'), b = document.createElement('button'); b.className = 'mt-wide-btn'; vw.appendChild(b);
  const setWide = on => { main.classList.toggle('mt-wide', on); b.textContent = on ? '\u2921' : '\u2922'; b.title = on ? 'Riporta i menu a destra' : 'Allarga la finestra 3D a tutta larghezza (menu sotto)'; try { localStorage.setItem('mt-wide', on ? '1' : '0'); } catch (e) { /* ok */ } };
  b.onclick = () => setWide(!main.classList.contains('mt-wide'));
  let w0 = false; try { w0 = localStorage.getItem('mt-wide') === '1'; } catch (e) { /* ok */ } setWide(w0);
  const h = $('psh'), bd = $('psb'), t = $('pst');
  const setC = c => { bd.style.display = c ? 'none' : ''; t.textContent = c ? '\u25B8' : '\u25BE'; h.style.marginBottom = c ? '0' : ''; try { localStorage.setItem('mt-scale-c', c ? '1' : '0'); } catch (e) { /* ok */ } };
  h.onclick = () => setC(bd.style.display !== 'none');
  let c0 = false; try { c0 = localStorage.getItem('mt-scale-c') === '1'; } catch (e) { /* ok */ } if (c0) setC(true);
  $('lblc').value = LBL.color; $('lblo').value = LBL.outline;
  const setLbl = (k, v, key) => { LBL[k] = v; api('/admin/mappatest/setting', { key, value: v }).then(d => { if (!(d && d.ok)) toast('Salvataggio non riuscito'); }); zs().forEach(buildStand); };
  $('lblc').onchange = e => setLbl('color', e.target.value, 'lbl_color');
  $('lblo').onchange = e => setLbl('outline', e.target.value, 'lbl_outline');
  $('lblr').onclick = () => { $('lblc').value = '#ffffff'; $('lblo').value = '#000000'; setLbl('color', '#ffffff', 'lbl_color'); setLbl('outline', '#000000', 'lbl_outline'); };
})();

/* ---------- viste e zone ---------- */
const VIEWS = { top: { p: [0, 1.3, 0.001], t: [0, 0, 0] }, persp: { p: [0, .72, .82], t: [0, 0, .02] }, iso: { p: [.78, .72, .78], t: [0, 0, 0] }, south: { p: [.08, .22, 1.0], t: [.08, .03, 0] } };
let tween = null;
function viewTarget(k) { const v = VIEWS[k], sc = Math.max(W, D) * 1.2; return { to: new THREE.Vector3(v.p[0] * sc, v.p[1] * sc, v.p[2] * sc), toT: new THREE.Vector3(v.t[0] * sc, v.t[1] * sc, v.t[2] * sc) }; }
function goView(k, dur) {
  curView = k; const { to, toT } = viewTarget(k);
  tween = { t0: performance.now(), dur: dur || 700, from: camera.position.clone(), fromT: controls.target.clone(), to, toT };
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === k));
}
async function getModel(name) {
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  if (!(slug in getModel.cache)) { try { const r = await fetch('/mappatest-models/' + slug + '.json', { credentials: 'same-origin' }); getModel.cache[slug] = r.ok ? await r.json() : null; } catch (e) { getModel.cache[slug] = null; } }
  return getModel.cache[slug];
}
getModel.cache = {};
let firstZone = true;
async function setZone(name) {
  if (mState === 'draw') cancelDraw(); if (mState === 'edit') cancelEdit(); if (mState === 'place') cancelPlace();
  const tok = ++zoneTok;
  ZN = name; Z = zones.find(z => z.name === name) || null; selected = null; query = ''; $('q').value = '';
  const refW = (Z && Z.refW) || 1450, refH = (Z && Z.refH) || 600;
  const [img, model] = Z ? await Promise.all([Z.bg ? loadImg('/zone-bg/' + encodeURIComponent(Z.bg)) : Promise.resolve(null), getModel(Z.name)]) : [null, null];
  if (tok !== zoneTok) return;
  PL = null; MODEL = null;
  if (img) { const sc = Math.min(refW / img.naturalWidth, refH / img.naturalHeight); PL = { wFrac: img.naturalWidth * sc / refW, hFrac: img.naturalHeight * sc / refH, xOff: (refW - img.naturalWidth * sc) / 2 / refW }; }
  if (img && model && Math.abs((img.naturalWidth / img.naturalHeight) / (model.planPx[0] / model.planPx[1]) - 1) < .03) MODEL = model;
  W = MODEL ? (MODEL.planPx[0] * MODEL.mpp) / PL.wFrac : ((Z && Z.widthM) || 80);
  D = W * refH / refW;
  $('wm').value = Z ? Math.round(W * 10) / 10 : ''; $('wm').disabled = !Z || !!MODEL; $('outd').checked = !!(Z && Z.outdoor); $('outd').disabled = !Z;
  $('wmn').textContent = MODEL ? 'Scala presa dal modello 3D dell\'edificio (sala larga 51 m).' : (model && img ? 'Il modello 3D non corrisponde alla planimetria caricata: ignorato.' : '');
  clearStands(); clearOverlay(); buildFloor(img); buildModel(); zs().forEach(buildStand);
  applyVis();
  const ms = $('ms'); if (!Z) { ms.style.display = 'flex'; ms.innerHTML = zones.length ? 'Questi stand non hanno una zona assegnata: assegnali a una zona dalle impostazioni assegnatari.' : 'Nessuna zona configurata.'; } else ms.style.display = 'none';
  refresh();
  const t = viewTarget(curView);
  if (firstZone) { firstZone = false; camera.position.copy(t.to).multiplyScalar(1.7); controls.target.copy(t.toT); goView(curView, 1800); }
  else { camera.position.copy(t.to); controls.target.copy(t.toT); tween = null; }
}
document.querySelectorAll('#views button').forEach(b => b.onclick = () => goView(b.dataset.v));
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => { document.querySelectorAll('#modes button').forEach(x => x.classList.remove('on')); b.classList.add('on'); mode = b.dataset.m; paint(); renderLegend(); });
$('lab').onchange = e => { labelsOn = e.target.checked; meshes.forEach(m => m.lab.visible = labelsOn); };
$('shd').onchange = e => { renderer.shadowMap.enabled = e.target.checked; sun.castShadow = e.target.checked; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); };
$('hsl').oninput = e => { hScale = e.target.value / 100; zs().forEach(s => { const m = meshes.get(s.id); if (m) { m.body.scale.y = hScale; placeLock(m.lk, s); } }); };
$('bld').onchange = applyVis;
$('rf').onchange = applyVis;
$('rfl').onchange = applyVis;
$('trn').oninput = e => { transp = e.target.value / 100; applyTransp(); };
$('sunr').oninput = e => setSun(+e.target.value);
$('q').oninput = e => { query = e.target.value; paint(); };
$('wm').onchange = e => {
  if (!Z || MODEL) return; const v = Math.max(10, Math.min(500, parseFloat(e.target.value) || 80));
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
  const data = { zona: ZN, larghezza_m: W, stand: zs().map(s => ({ id: s.id, nome: s.name, tipo: s.kind, modello: s.model, in_pianta: s.placed, bloccato: s.locked, fx: s.fx, fy: s.fy, wf: s.wf, df: s.df, rot: s.rot, altezza_m: s.h, forma: s.shape })) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = 'layout-mappatest.json'; a.click();
};
function resize() { const r = vw.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
if (window.ResizeObserver) new ResizeObserver(resize).observe(vw); else addEventListener('resize', resize);
resize(); applyTransp();
setZone(zones.length ? zones[0].name : null);
if (!zones.length) { $('ms').style.display = 'flex'; $('ms').textContent = 'Nessuna zona configurata.'; }
(function loop(now) {
  requestAnimationFrame(loop);
  if (tween) { const k = Math.min(1, (now - tween.t0) / tween.dur), e = 1 - Math.pow(1 - k, 3); camera.position.lerpVectors(tween.from, tween.to, e); controls.target.lerpVectors(tween.fromT, tween.toT, e); if (k >= 1) tween = null; }
  controls.update(); renderer.render(scene, camera);
})(0);
