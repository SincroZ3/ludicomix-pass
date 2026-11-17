/* ludi-map3d-view.js - vista 3D di SOLA LETTURA di una zona (mappa pubblica, portale espositore, pagina di prova).
   Riprende il disegno dell'editor /admin/mappatest (pavimento, edificio, stand, modelli predefiniti) senza alcuna funzione di modifica.
   Uso: const m = await createMap3D(container, { zoneId, onSelect(id), clickable: 'all'|'focus'|'none', focusId, rotate, env, menu });
   Dati: GET /api/map3d/zone/:zoneId. Restituisce null se WebGL o i dati non sono disponibili (usare il 2D). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const COL = { grey: '#9ca3af', neutro: '#6b3fa0', focus: '#f5c842' };
const VIEWS = { top: { p: [0, 1.3, 0.001], t: [0, 0, 0] }, persp: { p: [0, 0.72, 0.82], t: [0, 0, 0.02] }, iso: { p: [0.78, 0.72, 0.78], t: [0, 0, 0] }, south: { p: [0.08, 0.22, 1.0], t: [0.08, 0.03, 0] } };
const VLAB = { top: 'Dall' + String.fromCharCode(39) + 'alto', persp: 'Prospettiva', iso: 'Isometrica', south: 'Fronte' };
const esc = (s) => String(s == null ? '' : s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split(String.fromCharCode(34)).join('&quot;');
const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const modelCache = {};
async function getModel(name) {
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  if (!(slug in modelCache)) { try { const r = await fetch('/mappatest-models/' + slug + '.json', { credentials: 'same-origin' }); modelCache[slug] = r.ok ? await r.json() : null; } catch (e) { modelCache[slug] = null; } }
  return modelCache[slug];
}

/* ---------- modelli predefiniti degli stand (stessi dell'editor) ---------- */
const matFix = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.7 : r, metalness: 0.05 });
const MF = { alu: matFix(0xb8bcc4, 0.4), white: matFix(0xf3f3f1, 0.8), dark: matFix(0x2b2d36, 0.8), wood: matFix(0xe3d9c6, 0.8), plat: matFix(0xdedbe6, 0.9) };
function box(w, h, d, x, y0, z, m) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y0 + h / 2, z); me.castShadow = true; me.receiveShadow = true; return me; }
function buildGazebo(w, d, H, mat) {
  const g = new THREE.Group(), eave = Math.min(2.4, H * 0.72), rh = Math.max(0.3, H - eave), t = 0.03, lg = 0.07, vh = 0.3;
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((c) => g.add(box(lg, eave, lg, c[0] * (w / 2 - lg / 2), 0, c[1] * (d / 2 - lg / 2), MF.alu)));
  g.add(box(w - 0.04, eave - 0.12, t, 0, 0, -d / 2 + t / 2 + 0.01, mat), box(t, eave - 0.12, d - 0.04, -w / 2 + t / 2 + 0.01, 0, 0, mat), box(t, eave - 0.12, d - 0.04, w / 2 - t / 2 - 0.01, 0, 0, mat));
  g.add(box(w, vh, t, 0, eave - vh, d / 2 - t / 2, mat), box(w, vh, t, 0, eave - vh, -d / 2 + t / 2, mat), box(t, vh, d, -w / 2 + t / 2, eave - vh, 0, mat), box(t, vh, d, w / 2 - t / 2, eave - vh, 0, mat));
  const cg = new THREE.ConeGeometry(Math.SQRT1_2, rh, 4, 1); cg.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(cg, mat); roof.scale.set(w + 0.12, 1, d + 0.12); roof.position.y = eave + rh / 2; roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
  return g;
}
function buildIndoor(w, d, H, mat) {
  const g = new THREE.Group(), t = 0.05, sd = Math.min(1, d * 0.5);
  g.add(box(w, 0.08, d, 0, 0, 0, MF.plat));
  g.add(box(w, H - 0.08, t, 0, 0.08, -d / 2 + t / 2, mat));
  g.add(box(w * 0.8, 0.32, 0.08, 0, Math.max(0.5, H - 0.5), -d / 2 + t + 0.04, MF.white));
  g.add(box(t, H * 0.8 - 0.08, sd, -w / 2 + t / 2, 0.08, -d / 2 + sd / 2, mat), box(t, H * 0.8 - 0.08, sd, w / 2 - t / 2, 0.08, -d / 2 + sd / 2, mat));
  g.add(box(Math.min(w * 0.6, w - 0.4), 1, 0.45, 0, 0.08, d / 2 - 0.45, MF.wood));
  return g;
}
function buildKiosk(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(w, H, d, 0, 0, 0, mat), box(w * 0.6, 0.7, 0.06, 0, 1, d / 2, MF.dark), box(w * 0.7, 0.06, 0.3, 0, 0.95, d / 2 + 0.15, MF.white), box(w + 0.2, 0.12, d + 0.2, 0, H, 0, MF.white), box(w * 0.5, 0.3, 0.05, 0, H + 0.12, d / 2, MF.dark));
  return g;
}
function buildStage(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(w, H, d, 0, 0, 0, mat), box(w, 0.04, d, 0, H, 0, MF.plat), box(Math.min(1.2, w), Math.max(0.2, H / 2), 0.4, w / 2 - Math.min(1.2, w) / 2 - 0.2, 0, d / 2 + 0.2, mat), box(w, 2.4, 0.08, 0, H, -d / 2 + 0.1, MF.dark));
  [-1, 1].forEach((k) => g.add(box(0.1, 3, 0.1, k * (w / 2 - 0.1), H, -d / 2 + 0.1, MF.alu)));
  return g;
}
function buildDesk(w, d, H, mat) {
  const g = new THREE.Group(), ph = Math.min(2.4, H);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((c) => g.add(box(0.07, ph, 0.07, c[0] * (w / 2 - 0.05), 0, c[1] * (d / 2 - 0.05), MF.alu)));
  g.add(box(w + 0.2, 0.1, d + 0.2, 0, ph, 0, mat), box(w * 0.8, 0.9, 0.5, 0, 0, d / 2 - 0.5, MF.wood), box(w * 0.8, 0.75, 0.6, 0, 0, -d / 2 + 0.5, mat));
  return g;
}
function mkTex(fn) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; fn(cv.getContext('2d')); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
let _bolt = null, _acc = null;
const boltTex = () => _bolt || (_bolt = mkTex((g) => { g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#1e2d4e'; g.lineWidth = 6; g.stroke(); g.fillStyle = '#1e2d4e'; g.beginPath(); [[74, 14], [32, 72], [58, 72], [48, 114], [98, 52], [70, 52], [86, 14]].forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); }));
const accTex = () => _acc || (_acc = mkTex((g) => { g.fillStyle = '#1f6fd6'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.arc(58, 24, 9, 0, 7); g.fill(); g.beginPath(); g.moveTo(58, 38); g.lineTo(58, 74); g.lineTo(88, 74); g.lineTo(100, 108); g.moveTo(58, 54); g.lineTo(86, 54); g.stroke(); g.beginPath(); g.arc(54, 86, 22, -Math.PI * 0.1, Math.PI * 1.1); g.stroke(); }));
function buildWc(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(w, H, d, 0, 0, 0, mat), box(w * 0.6, H * 0.82, 0.05, 0, 0, d / 2 + 0.01, MF.dark), box(w + 0.1, 0.1, d + 0.1, 0, H, 0, MF.white), box(0.5, 0.12, 0.5, w / 4, H + 0.1, -d / 4, MF.white));
  return g;
}
function buildWcDis(w, d, H, mat) {
  const g = buildWc(w, d, H, mat), sg = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: accTex() }));
  sg.position.set(-w / 2 + 0.5, H * 0.62, d / 2 + 0.04); g.add(sg); return g;
}
function buildBolt(w, d, H, mat) {
  const g = new THREE.Group();
  g.add(box(0.3, H, 0.3, 0, 0, 0, MF.dark), box(0.36, 0.14, 0.36, 0, H, 0, mat));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ map: boltTex(), transparent: true, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = H + 0.22; g.add(disc); return g;
}
function buildFence(s, w, d, mat) {
  const g = new THREE.Group(), P = (s.shape || [[0, 0], [1, 1]]).map((p) => [(p[0] - 0.5) * w, (p[1] - 0.5) * d]), H = Math.max(0.5, Math.min(3, s.h || 2));
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.05) continue;
    const n = Math.max(1, Math.round(L / 2)), pl = L / n, ang = -Math.atan2(dz, dx);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, pn = new THREE.Group(); pn.position.set(a[0] + dx * t, 0, a[1] + dz * t); pn.rotation.y = ang;
      pn.add(box(pl - 0.04, 0.05, 0.04, 0, H - 0.12, 0, mat), box(pl - 0.04, 0.05, 0.04, 0, 0.22, 0, mat));
      const nb = Math.max(3, Math.round(pl / 0.25));
      for (let j = 0; j < nb; j++) pn.add(box(0.02, H - 0.34, 0.02, -(pl - 0.12) / 2 + ((pl - 0.12) * j) / (nb - 1), 0.22, 0, mat));
      pn.add(box(0.05, H, 0.05, -pl / 2 + 0.03, 0, 0, MF.alu), box(0.05, H, 0.05, pl / 2 - 0.03, 0, 0, MF.alu)); g.add(pn);
    }
  }
  return g;
}
const DEFS = { 'in-4x25': buildIndoor, 'in-2x15': buildIndoor, 'out-3x3': buildGazebo, 'out-4x3': buildGazebo, 'obj-biglietteria': buildKiosk, 'obj-palco': buildStage, 'obj-segreteria': buildDesk, 'obj-wc': buildWc, 'obj-wcdis': buildWcDis, 'obj-colonnina': buildBolt };
function inRing(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if (((a[1] > z) !== (b[1] > z)) && (x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
function edgeDist(P, x, z) { let m = 1e9; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)); } return m; }
function bboxOf(P) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; P.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); return { x0, x1, z0, z1 }; }
function innerPoint(P) {
  const b = bboxOf(P); let best = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], bd = -1;
  for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) { const x = b.x0 + ((b.x1 - b.x0) * i) / 20, z = b.z0 + ((b.z1 - b.z0) * j) / 20; if (!inRing(P, x, z)) continue; const dd = edgeDist(P, x, z); if (dd > bd) { bd = dd; best = [x, z]; } }
  return { p: best, r: Math.max(bd, 0.3) };
}
function buildTables(P, ip) {
  const g = new THREE.Group(), b = bboxOf(P), tw = 1.6, td = 0.8, hx = tw / 2 + 0.45, hz = td / 2 + 0.45;
  const k = Math.max(1, Math.sqrt(((b.x1 - b.x0) * (b.z1 - b.z0)) / (2.6 * 2.2) / 40)), sx = 2.6 * k, sz = 2.2 * k; let n = 0;
  const add = (x, z) => {
    g.add(box(tw, 0.05, td, x, 0.73, z, MF.wood)); [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((c) => g.add(box(0.05, 0.73, 0.05, x + c[0] * (tw / 2 - 0.06), 0, z + c[1] * (td / 2 - 0.06), MF.alu)));
    [[-0.45, -1], [0.45, -1], [-0.45, 1], [0.45, 1]].forEach((c) => g.add(box(0.38, 0.45, 0.38, x + c[0], 0, z + c[1] * (td / 2 + 0.25), MF.dark))); n++;
  };
  for (let x = b.x0 + hx; x <= b.x1 - hx + 0.01; x += sx) for (let z = b.z0 + hz; z <= b.z1 - hz + 0.01; z += sz) { if ([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].every((c) => inRing(P, x + c[0], z + c[1]))) add(x, z); }
  if (!n) add(ip.p[0], ip.p[1]);
  return g;
}

/* ---------- vista ---------- */
export async function createMap3D(container, opts) {
  opts = Object.assign({ clickable: 'all', rotate: false, env: true, menu: true, rotateSpeed: 0.3, focusId: null }, opts || {});
  const say = (t) => { container.innerHTML = `<div style='padding:1rem;font:14px system-ui;color:#6b6480'>${esc(t)}</div>`; return null; };
  let data;
  try { const r = await fetch('/api/map3d/zone/' + encodeURIComponent(opts.zoneId), { credentials: 'same-origin' }); if (!r.ok) throw new Error('HTTP ' + r.status); data = await r.json(); } catch (e) { return say('Mappa 3D non disponibile.'); }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { return say('Il browser non supporta WebGL: la vista 3D non e disponibile.'); }
  if (opts.env || !container.id) container.id = 'vw';
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.innerHTML = '';
  const Zc = data.zone, LBL = { color: (data.settings && data.settings.lbl_color) || '#ffffff', outline: (data.settings && data.settings.lbl_outline) || '#000000' };
  const stands = (data.stands || []).map((s) => Object.assign({ shape: null, h: 2.5, elev: 0, model: null, kind: 'stand', color: null, lscale: 1, lrot: 0, rot: 0 }, s));
  const st = { W: 80, D: 30, MODEL: null, PL: null, RAISED: [], labels: true, transp: 0.55, focusId: opts.focusId, selectedId: null, curView: 'persp', floorTex: null, rotate: !!opts.rotate };
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // contratto con i moduli ambiente (Mariambini, Vanvere): elemento #vw, scheda zona attiva in #zt, gruppo con cerchio e piano
  const zt = document.createElement('div'); zt.id = 'zt'; zt.style.display = 'none'; zt.innerHTML = `<button class='ztab active'>${esc(Zc.name)}</button>`; container.appendChild(zt);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.insertBefore(renderer.domElement, container.firstChild);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  const scene = new THREE.Scene();
  try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; } catch (e) { /* senza riflessi */ }
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.maxPolarAngle = Math.PI / 2 - 0.03; controls.minDistance = 4; controls.maxDistance = 500; controls.autoRotateSpeed = opts.rotateSpeed;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbfe8, 0.55));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun);
  const world = new THREE.Group(); scene.add(world);
  const modelG = new THREE.Group(); modelG.name = 'modelG'; scene.add(modelG);
  const gRoof = new THREE.Group(), gWall = new THREE.Group(), gLow = new THREE.Group(), gLowRoof = new THREE.Group(), gSol = new THREE.Group(), gSta = new THREE.Group(), gRai = new THREE.Group();
  modelG.add(gRoof, gWall, gLow, gLowRoof, gSol, gSta, gRai);
  let sunDeg = 215, floorMesh = null, slab = null, ground = null, tween = null, raf = 0, resumeT = 0, disposed = false;
  const meshes = new Map(), texMats = [];
  const dims = (s) => ({ w: s.wf * st.W, d: s.df * st.D });
  const isOut = () => !!(Zc && Zc.outdoor);

  const matRoof = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const matWallB = new THREE.MeshStandardMaterial({ color: 0xb86f4e, roughness: 0.85, side: THREE.DoubleSide, transparent: true });
  const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fc6e8, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, transparent: true, depthWrite: false, envMapIntensity: 1.4 });
  const matLow = new THREE.MeshStandardMaterial({ color: 0xb4bccb, roughness: 0.8, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const matLowRoof = new THREE.MeshStandardMaterial({ color: 0xcfd5e0, roughness: 0.6, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const matSol = new THREE.MeshStandardMaterial({ color: 0x777784, roughness: 0.95 });
  const matSta = new THREE.MeshStandardMaterial({ color: 0xf0a030, roughness: 0.7 });
  const greyMat = new THREE.MeshStandardMaterial({ color: COL.grey, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false });
  const greyLine = new THREE.LineBasicMaterial({ color: 0x8b93a1, transparent: true, opacity: 0.25 });
  function applyTransp() { const t = st.transp; matRoof.opacity = Math.max(0.08, 1 - 0.92 * t); matWallB.opacity = Math.max(0.12, 1 - 0.85 * t); matGlass.opacity = Math.max(0.1, 0.85 - 0.75 * t); matLow.opacity = Math.max(0.1, 0.85 - 0.75 * t); matLowRoof.opacity = Math.max(0.08, 1 - 0.92 * t); [matRoof, matWallB, matGlass, matLow, matLowRoof].forEach((m) => { m.needsUpdate = true; }); }

  function setSun(deg) { sunDeg = deg; const a = deg * Math.PI / 180, r = Math.max(st.W, st.D) * 0.9; sun.position.set(Math.cos(a) * r, r * 0.85, Math.sin(a) * r); }
  function fitSun() { const c = sun.shadow.camera, r = Math.max(st.W, st.D) * 0.75; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = Math.max(st.W, st.D) * 4; c.updateProjectionMatrix(); setSun(sunDeg); }
  function composeFloor(img, cb) {
    const cw = 2048, ch = Math.max(256, Math.round(cw * st.D / st.W)), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch);
    if (!img) { g.strokeStyle = '#e4dcf3'; g.lineWidth = 2; const s16 = cw / 16; for (let x = 0; x <= cw; x += s16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, ch); g.stroke(); } for (let y = 0; y <= ch; y += s16) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); } }
    else { const sc = Math.min(cw / img.naturalWidth, ch / img.naturalHeight); g.drawImage(img, (cw - img.naturalWidth * sc) / 2, 0, img.naturalWidth * sc, img.naturalHeight * sc); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; cb(t);
  }
  function buildFloor(img) {
    ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(st.W, st.D) * 4, 64), new THREE.MeshStandardMaterial({ color: 0xe6def5, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.62; ground.receiveShadow = true; world.add(ground);
    slab = new THREE.Mesh(new THREE.BoxGeometry(st.W + 3, 0.6, st.D + 3), new THREE.MeshStandardMaterial({ color: 0xd9cff0, roughness: 1 }));
    slab.position.y = -0.31; slab.receiveShadow = true; world.add(slab);
    floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(st.W, st.D), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
    floorMesh.rotation.x = -Math.PI / 2; floorMesh.receiveShadow = true; world.add(floorMesh); texMats.push(floorMesh.material);
    composeFloor(img, (t) => { st.floorTex = t; texMats.forEach((m) => { m.map = t; m.needsUpdate = true; }); });
    scene.fog = new THREE.Fog(0xe9e2f6, Math.max(st.W, st.D) * 2.2, Math.max(st.W, st.D) * 6);
    fitSun();
  }
  function pointIn(poly, x, z) { const inside = (ring) => inRing(ring, x, z); if (!inside(poly.o)) return false; for (const h of poly.h) if (inside(h)) return false; return true; }
  const baseOf = (s) => { let b = 0; if (st.MODEL && st.RAISED.length) { const x = (s.fx - 0.5) * st.W, z = (s.fy - 0.5) * st.D; if (st.RAISED.some((p) => pointIn(p, x, z))) b = st.MODEL.heights.raise; } return b + (s.elev || 0); };
  function tris(arr, pts) { for (const p of pts) arr.push(p[0], p[1], p[2]); }
  function rawMesh(arr, mat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = mat !== matGlass; m.receiveShadow = true; return m; }
  function buildModel() {
    if (!st.MODEL || !st.PL) return;
    const m = st.MODEL, PL = st.PL, W = st.W, D = st.D, pw = m.planPx[0], ph = m.planPx[1], hh = m.heights;
    const MX = (px) => ((PL.xOff + px / pw * PL.wFrac) - 0.5) * W, MZ = (py) => ((py / ph * PL.hFrac) - 0.5) * D;
    const conv = (p) => ({ o: p.o.map((q) => [MX(q[0]), MZ(q[1])]), h: p.h.map((r) => r.map((q) => [MX(q[0]), MZ(q[1])])) });
    const shapeOf = (p) => { const sh = new THREE.Shape(); p.o.forEach((q, i) => (i ? sh.lineTo(q[0], -q[1]) : sh.moveTo(q[0], -q[1]))); p.h.forEach((r) => { const hp = new THREE.Path(); r.forEach((q, i) => (i ? hp.lineTo(q[0], -q[1]) : hp.moveTo(q[0], -q[1]))); sh.holes.push(hp); }); return sh; };
    const ext = (p, h, mat, grp) => { const g = new THREE.ExtrudeGeometry(shapeOf(p), { depth: Math.max(h, 0.02), bevelEnabled: false }); g.rotateX(-Math.PI / 2); const me = new THREE.Mesh(g, mat); me.castShadow = mat !== matLow; me.receiveShadow = true; me.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: 0.4 }))); grp.add(me); };
    const b = m.bays, HR = hh.ridge, HE = hh.eave;
    for (let k = 0; k < b.n; k++) {
      const x0 = b.v0 + b.step * k, xc = x0 + b.half, x1 = x0 + b.step;
      const TL = [x0, b.topValley], TA = [xc, b.topApex], TR = [x1, b.topValley], BR = [x1, b.botValley], BA = [xc, b.botApex], BL = [x0, b.botValley];
      const hf = (x) => HE + (HR - HE) * (1 - Math.abs(x - xc) / b.half);
      const P = (p, y) => [MX(p[0]), y, MZ(p[1])];
      const rf = []; tris(rf, [P(TL, HE), P(TA, HR), P(BA, HR), P(TL, HE), P(BA, HR), P(BL, HE)]); tris(rf, [P(TA, HR), P(TR, HE), P(BR, HE), P(TA, HR), P(BR, HE), P(BA, HR)]);
      const roofM = rawMesh(rf, matRoof); roofM.add(new THREE.LineSegments(new THREE.EdgesGeometry(roofM.geometry, 10), new THREE.LineBasicMaterial({ color: 0x8a93a6, transparent: true, opacity: 0.55 }))); gRoof.add(roofM);
      const wall = (a, c, mat) => { const arr = []; tris(arr, [P(a, 0), P(c, 0), P(c, hf(c[0])), P(a, 0), P(c, hf(c[0])), P(a, hf(a[0]))]); gWall.add(rawMesh(arr, mat)); };
      wall(TL, TA, matWallB); wall(TA, TR, matWallB); wall(BL, BA, matGlass); wall(BA, BR, matGlass);
      if (k === 0) wall(TL, BL, matWallB); if (k === b.n - 1) wall(TR, BR, matWallB);
      [[BL, BA], [BA, BR]].forEach(([a, c]) => { for (let t = 0; t <= 4; t++) { const u = t / 4, x = a[0] + (c[0] - a[0]) * u, y = a[1] + (c[1] - a[1]) * u; const pts = [new THREE.Vector3(MX(x), 0, MZ(y)), new THREE.Vector3(MX(x), hf(x), MZ(y))]; gWall.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5b6577, transparent: true, opacity: 0.6 }))); } });
    }
    m.low.forEach((p) => {
      const c = conv(p), arr = [];
      [c.o].concat(c.h).forEach((ring) => { for (let i = 0; i < ring.length; i++) { const q = ring[i], r = ring[(i + 1) % ring.length]; tris(arr, [[q[0], 0, q[1]], [r[0], 0, r[1]], [r[0], hh.low, r[1]], [q[0], 0, q[1]], [r[0], hh.low, r[1]], [q[0], hh.low, q[1]]]); } });
      const wm = rawMesh(arr, matLow); wm.castShadow = false; gLow.add(wm);
      const rg = new THREE.ShapeGeometry(shapeOf(c)); rg.rotateX(-Math.PI / 2);
      const rm = new THREE.Mesh(rg, matLowRoof); rm.position.y = hh.low; rm.receiveShadow = true;
      rm.add(new THREE.LineSegments(new THREE.EdgesGeometry(rg, 25), new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: 0.4 }))); gLowRoof.add(rm);
    });
    m.solid.forEach((p) => ext(conv(p), hh.low + 0.1, matSol, gSol));
    m.steps.forEach((p) => ext(conv(p), hh.raise * (p.i + 1) / m.stepsN, matSta, gSta));
    st.RAISED = m.raised.map(conv);
    st.RAISED.forEach((p) => {
      const g = new THREE.ShapeGeometry(shapeOf(p)); const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / W + 0.5; uv[i * 2 + 1] = 0.5 + pos.getY(i) / D; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.rotateX(-Math.PI / 2);
      const mt = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: st.floorTex }); texMats.push(mt);
      const me = new THREE.Mesh(g, mt); me.position.y = hh.raise + 0.03; me.receiveShadow = true; gRai.add(me);
    });
    applyTransp();
  }

  /* ---------- stand ---------- */
  function labelTexture(text) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
    g.fillStyle = LBL.color; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 40; g.font = 'bold ' + fs + 'px sans-serif';
    while (g.measureText(text).width > 236 && fs > 16) { fs -= 2; g.font = 'bold ' + fs + 'px sans-serif'; }
    g.shadowColor = LBL.outline; g.shadowBlur = 6; g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = LBL.outline; g.globalAlpha = 0.55; g.strokeText(text, 128, 64); g.globalAlpha = 1; g.fillText(text, 128, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function orientLabel(lab, s) { lab.rotation.order = 'YXZ'; lab.rotation.set(-Math.PI / 2, (s.rot - (s.lrot || 0)) * Math.PI / 180, 0); const k = s.lscale || 1; lab.scale.set(k, k, 1); }
  const isLine = (s) => s.model === 'obj-transenna';
  const dimmed = (s) => st.focusId != null && s.id !== st.focusId;
  const colorOf = (s) => (st.focusId != null ? (s.id === st.focusId ? COL.focus : COL.grey) : (s.color || (s.kind === 'obj' ? '#16a085' : COL.neutro)));
  function labelOn(s) { return st.labels && !dimmed(s); }
  function wrapStand(s, body, mat, lab, emat) {
    body.traverse((o) => { o.userData.id = s.id; if (o.isLine) o.raycast = () => {}; });
    if (dimmed(s)) body.traverse((o) => { if (o.isMesh && o.material && !o.userData.isLabel) o.material = greyMat; else if (o.isLine && o.material) o.material = greyLine; });
    const grp = new THREE.Group(); grp.add(body);
    grp.position.set((s.fx - 0.5) * st.W, baseOf(s), (s.fy - 0.5) * st.D); grp.rotation.y = -s.rot * Math.PI / 180;
    world.add(grp); meshes.set(s.id, { group: grp, body, mat, lab, emat });
  }
  function mkLabel(s, ls, y, px, pz) {
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls / 2), new THREE.MeshBasicMaterial({ map: labelTexture(s.name), transparent: true, depthWrite: false }));
    lab.userData.isLabel = true; orientLabel(lab, s); lab.position.set(px || 0, y, pz || 0); lab.visible = labelOn(s); lab.raycast = () => {}; return lab;
  }
  function buildStand(s) {
    const old = meshes.get(s.id); if (old) { world.remove(old.group); old.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); meshes.delete(s.id); }
    const { w, d } = dims(s), emat = new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: 0.3 });
    const mat = new THREE.MeshStandardMaterial({ color: colorOf(s), roughness: 0.5, metalness: 0.06 });
    if (s.model === 'area') {
      const P = (s.shape || [[0, 0], [1, 0], [1, 1], [0, 1]]).map((p) => [(p[0] - 0.5) * w, (p[1] - 0.5) * d]);
      const sh = new THREE.Shape(); P.forEach((p, i) => (i ? sh.lineTo(p[0], -p[1]) : sh.moveTo(p[0], -p[1])));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
      const body = new THREE.Mesh(geo, mat); body.receiveShadow = true; body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 45), emat));
      const ip = innerPoint(P); let ly, ls;
      if (isOut()) { const sz = Math.max(1, Math.min(2, ip.r * 1.7)), gz = buildGazebo(sz, sz, 3, mat); gz.position.set(ip.p[0], 0.1, ip.p[1]); body.add(gz); ly = 3.3; ls = Math.max(2.4, sz * 1.6); }
      else { const tb = buildTables(P, ip); tb.position.y = 0.1; body.add(tb); ly = 1.1; ls = Math.max(2.4, Math.min(w, d * 3) * 0.6); }
      const lab = mkLabel(s, ls, ly, ip.p[0], ip.p[1]); body.add(lab); wrapStand(s, body, mat, lab, emat); return;
    }
    if (s.model && (DEFS[s.model] || isLine(s))) {
      const line = isLine(s), body = line ? buildFence(s, w, d, mat) : DEFS[s.model](w, d, s.h, mat);
      if (!line) body.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map((p) => new THREE.Vector3(p[0], 0.04, p[1]))), emat));
      let lab;
      if (line || s.model === 'obj-colonnina') { lab = new THREE.Object3D(); body.add(lab); }
      else { lab = mkLabel(s, Math.max(Math.min(w, d * 3), 2.2), s.h + (s.model.indexOf('out-') === 0 ? 0.1 : 0.04) + (s.model === 'obj-biglietteria' ? 0.5 : 0) + (s.model.indexOf('obj-wc') === 0 ? 0.3 : 0)); body.add(lab); }
      wrapStand(s, body, mat, lab, emat); return;
    }
    const bt = Math.min(0.07, s.h / 6, Math.min(w, d) / 8), sh = new THREE.Shape();
    (s.shape || [[0, 0], [1, 0], [1, 1], [0, 1]]).forEach((p, i) => { const x = (p[0] - 0.5) * w, y = (0.5 - p[1]) * d; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); });
    const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.05, s.h - 2 * bt), bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 2 });
    geo.translate(0, 0, bt); geo.rotateX(-Math.PI / 2);
    const body = new THREE.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true; body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 45), emat));
    const lab = mkLabel(s, Math.max(Math.min(w, d * 3), 2.2), s.h + 0.04); body.add(lab); wrapStand(s, body, mat, lab, emat);
  }
  function paint() {
    stands.forEach((s) => { const m = meshes.get(s.id); if (!m || !m.mat) return; const sel = st.selectedId === s.id && st.focusId == null; m.mat.emissive.set(sel ? 0xffffff : s.id === st.focusId ? 0x6b4a00 : 0x000000); m.mat.emissiveIntensity = sel ? 0.28 : s.id === st.focusId ? 0.35 : 0; });
  }
  const rebuildStands = () => { stands.forEach(buildStand); paint(); };

  /* ---------- vista, camera, interazione ---------- */
  function viewTarget(k) { const v = VIEWS[k], sc = Math.max(st.W, st.D) * 1.2; return { to: new THREE.Vector3(v.p[0] * sc, v.p[1] * sc, v.p[2] * sc), toT: new THREE.Vector3(v.t[0] * sc, v.t[1] * sc, v.t[2] * sc) }; }
  function stopRotate() { controls.autoRotate = false; clearTimeout(resumeT); }
  function startRotate() { clearTimeout(resumeT); controls.autoRotate = st.rotate && !reduced; }
  function goView(k, dur) {
    st.curView = k; const t = viewTarget(k); stopRotate();
    tween = { t0: performance.now(), dur: dur || 700, from: camera.position.clone(), fromT: controls.target.clone(), to: t.to, toT: t.toT, rot: false };
    syncMenu();
  }
  function standCenter(s) { const w = dims(s), cx = (s.fx - 0.5) * st.W, cz = (s.fy - 0.5) * st.D; return { cx, cz, by: baseOf(s), size: Math.max(w.w, w.d, 3) }; }
  function flyTo(s, dur) {
    const c = standCenter(s), dist = Math.max(16, c.size * 3.2), target = new THREE.Vector3(c.cx, c.by + Math.min(s.h || 2, 3) * 0.5, c.cz);
    const dir = camera.position.clone().sub(controls.target); dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
    const el = 38 * Math.PI / 180, to = target.clone().add(new THREE.Vector3(dir.x * Math.cos(el) * dist, Math.sin(el) * dist, dir.z * Math.cos(el) * dist));
    stopRotate(); tween = { t0: performance.now(), dur: dur || 1600, from: camera.position.clone(), fromT: controls.target.clone(), to, toT: target, rot: true };
  }
  controls.addEventListener('start', () => { stopRotate(); });
  controls.addEventListener('end', () => { clearTimeout(resumeT); if (st.rotate && !reduced) resumeT = setTimeout(startRotate, 4000); });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), cvs = renderer.domElement;
  const canPick = (s) => opts.clickable === 'all' || (opts.clickable === 'focus' && s.id === st.focusId);
  function pickStand(e) {
    const r = cvs.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...meshes.values()].map((m) => m.body), true);
    for (const h of hits) { const id = h.object.userData && h.object.userData.id; if (id != null) { const s = stands.find((x) => x.id === id); if (s && canPick(s)) return s.id; if (s && opts.clickable === 'focus') continue; return null; } }
    return null;
  }
  const tip = document.createElement('div'); tip.style.cssText = 'position:absolute;z-index:25;pointer-events:none;display:none;background:rgba(30,45,78,.92);color:#fff;font:12px system-ui;padding:4px 8px;border-radius:8px;max-width:220px'; container.appendChild(tip);
  let down = null;
  cvs.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  cvs.addEventListener('pointermove', (e) => {
    const id = down ? null : pickStand(e);
    if (id != null) { const s = stands.find((x) => x.id === id), r = container.getBoundingClientRect(); tip.textContent = s.name; tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; tip.style.display = 'block'; cvs.style.cursor = 'pointer'; }
    else { tip.style.display = 'none'; cvs.style.cursor = 'default'; }
  });
  cvs.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  cvs.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5; down = null; if (moved || opts.clickable === 'none') return;
    const id = pickStand(e); api.select(id);
  });

  /* ---------- menu contesto (pannello su desktop, pulsante con menu a comparsa su mobile) ---------- */
  let menuEl = null, btnEl = null;
  function syncMenu() { if (menuEl) menuEl.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === st.curView)); }
  function buildMenu() {
    if (!document.getElementById('m3-css')) {
      const css = document.createElement('style'); css.id = 'm3-css';
      css.textContent = '.m3-btn{position:absolute;left:10px;top:10px;z-index:30;border:1.5px solid #d9cff0;background:rgba(255,255,255,.96);color:#4c2c78;border-radius:12px;padding:7px 11px;font:700 13px system-ui;cursor:pointer;box-shadow:0 4px 12px rgba(30,45,78,.18)}' +
        '.m3-menu{position:absolute;left:10px;top:52px;z-index:30;width:236px;max-height:calc(100% - 70px);overflow:auto;background:rgba(255,255,255,.96);border:1px solid #ece6f7;border-radius:14px;padding:10px 12px;font:12px system-ui;color:#2b1d4d;box-shadow:0 6px 20px rgba(30,45,78,.18);display:none}' +
        '.m3-menu.open{display:block}.m3-menu h4{margin:8px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b5a8a}.m3-menu h4:first-child{margin-top:0}' +
        '.m3-seg{display:flex;gap:4px;flex-wrap:wrap}.m3-seg button{flex:1;min-width:48%;padding:6px 4px;border:1.5px solid #d9cff0;background:#fff;border-radius:9px;font:700 12px system-ui;color:#4c2c78;cursor:pointer}.m3-seg button.on{background:#6b3fa0;color:#fff;border-color:#6b3fa0}' +
        '.m3-menu label{display:flex;gap:6px;align-items:center;margin:3px 0;font-weight:600}.m3-menu input[type=range]{width:100%}' +
        '@media (max-width:700px){.m3-menu{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:55%;border-radius:16px}.m3-btn{top:8px;left:8px}}';
      document.head.appendChild(css);
    }
    btnEl = document.createElement('button'); btnEl.className = 'm3-btn'; btnEl.type = 'button'; btnEl.textContent = 'Contesto e vista'; container.appendChild(btnEl);
    menuEl = document.createElement('div'); menuEl.className = 'm3-menu';
    menuEl.innerHTML = `<h4>Vista</h4><div class='m3-seg'>` + Object.keys(VIEWS).map((k) => `<button type='button' data-v='${k}'${k === st.curView ? ` class='on'` : ''}>${esc(VLAB[k])}</button>`).join('') + '</div>' +
      `<h4>Contesto</h4><label><input type='checkbox' data-k='bld' checked> Edificio</label><label><input type='checkbox' data-k='rf' checked> Tetti</label><label><input type='checkbox' data-k='lab' checked> Nomi degli stand</label><label><input type='checkbox' data-k='shd' checked> Ombre</label>` +
      `<label>Trasparenza<input type='range' data-k='trn' min='0' max='100' value='${Math.round(st.transp * 100)}'></label><label>Sole<input type='range' data-k='sun' min='0' max='360' value='${sunDeg}'></label>` +
      (opts.focusId != null ? `<label><input type='checkbox' data-k='rot'${st.rotate ? ' checked' : ''}> Rotazione lenta</label>` : '') + '<div data-env></div>';
    container.appendChild(menuEl);
    const open = (on) => menuEl.classList.toggle('open', on);
    btnEl.onclick = () => open(!menuEl.classList.contains('open'));
    open(!(typeof matchMedia === 'function' && matchMedia('(max-width:700px)').matches));
    menuEl.addEventListener('pointerdown', (e) => e.stopPropagation()); menuEl.addEventListener('wheel', (e) => e.stopPropagation());
    menuEl.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => goView(b.dataset.v); });
    menuEl.querySelectorAll('[data-k]').forEach((i) => { i.oninput = () => api.setContext({ bld: menuEl.querySelector('[data-k=bld]').checked, rf: menuEl.querySelector('[data-k=rf]').checked, lab: menuEl.querySelector('[data-k=lab]').checked, shd: menuEl.querySelector('[data-k=shd]').checked, trn: +menuEl.querySelector('[data-k=trn]').value / 100, sun: +menuEl.querySelector('[data-k=sun]').value, rot: menuEl.querySelector('[data-k=rot]') ? menuEl.querySelector('[data-k=rot]').checked : undefined }); });
    // il pannello Ambiente 3D dei moduli ambiente viene spostato dentro questo menu
    const mo = new MutationObserver(() => { [...container.children].forEach((el) => { if (el !== menuEl && el !== btnEl && el !== tip && el.nodeType === 1 && /^Ambiente 3D/.test((el.textContent || '').trim())) { el.style.cssText = 'position:static;max-width:none;box-shadow:none;border:0;background:transparent;padding:0;margin-top:6px;font:12px system-ui'; menuEl.querySelector('[data-env]').appendChild(el); } }); });
    mo.observe(container, { childList: true }); menuEl._mo = mo;
  }

  const api = {
    el: container, stands,
    getStand: (id) => stands.find((s) => s.id === id) || null,
    select(id) { st.selectedId = id; paint(); if (opts.onSelect) opts.onSelect(id, id == null ? null : api.getStand(id)); },
    focus(id) { st.focusId = id; st.selectedId = null; rebuildStands(); const s = id == null ? null : api.getStand(id); if (s && s.placed !== false) { flyTo(s); } },
    setView: goView,
    setRotate(on) { st.rotate = !!on; if (!st.rotate) stopRotate(); else if (!tween) startRotate(); },
    setContext(c) {
      c = c || {};
      if (c.bld != null) { [gSol, gLow, gSta, gRai, gWall].forEach((g) => { g.visible = c.bld; }); gRoof.visible = c.bld && (c.rf !== false); gLowRoof.visible = gRoof.visible; }
      else if (c.rf != null) { gRoof.visible = c.rf; gLowRoof.visible = c.rf; }
      if (c.lab != null) { st.labels = !!c.lab; meshes.forEach((m, id) => { const s = stands.find((x) => x.id === id); if (m.lab && s) m.lab.visible = labelOn(s); }); }
      if (c.shd != null) { renderer.shadowMap.enabled = !!c.shd; sun.castShadow = !!c.shd; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
      if (c.trn != null) { st.transp = c.trn; applyTransp(); }
      if (c.sun != null) setSun(c.sun);
      if (c.rot != null) api.setRotate(c.rot);
    },
    resize() { const r = container.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(resumeT); if (ro) ro.disconnect(); if (menuEl && menuEl._mo) menuEl._mo.disconnect();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); renderer.dispose(); container.innerHTML = '';
    },
  };

  // zona: sfondo, modello dell'edificio, scala e proporzioni (stessa logica dell'editor)
  const refW = Zc.refW || 1450, refH = Zc.refH || 600;
  const [img, model] = await Promise.all([Zc.bg ? loadImg('/zone-bg/' + encodeURIComponent(Zc.bg)) : Promise.resolve(null), getModel(Zc.name)]);
  if (img) { const sc = Math.min(refW / img.naturalWidth, refH / img.naturalHeight); st.PL = { wFrac: img.naturalWidth * sc / refW, hFrac: img.naturalHeight * sc / refH, xOff: (refW - img.naturalWidth * sc) / 2 / refW }; }
  if (img && model && Math.abs((img.naturalWidth / img.naturalHeight) / (model.planPx[0] / model.planPx[1]) - 1) < 0.03) st.MODEL = model;
  st.W = st.MODEL ? (st.MODEL.planPx[0] * st.MODEL.mpp) / st.PL.wFrac : (Zc.widthM || 80);
  st.D = st.W * refH / refW;
  buildFloor(img); buildModel(); applyTransp(); rebuildStands();
  api.resize();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => api.resize()) : null; if (ro) ro.observe(container);
  if (opts.menu) buildMenu();
  if (opts.env) ['/ludi-mappatest-parco.js', '/ludi-mappatest-vanvere.js'].forEach((u) => { import(u).catch(() => {}); });

  const t0 = viewTarget(st.curView); camera.position.copy(t0.to).multiplyScalar(1.7); controls.target.copy(t0.toT);
  const fs = st.focusId != null ? api.getStand(st.focusId) : null;
  if (fs) { goView(st.curView, 10); setTimeout(() => { if (!disposed) flyTo(fs, 2200); }, 60); } else goView(st.curView, 1800);
  let last = performance.now();
  function loop(now) {
    if (disposed) return; raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (tween) { const k = Math.min(1, (now - tween.t0) / tween.dur), e = 1 - Math.pow(1 - k, 3); camera.position.lerpVectors(tween.from, tween.to, e); controls.target.lerpVectors(tween.fromT, tween.toT, e); if (k >= 1) { const rot = tween.rot; tween = null; if (rot || st.rotate) startRotate(); } }
    controls.update(dt); renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  return api;
}
