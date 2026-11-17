/* ludi-mappatest-clip.js — "Taglio" per /admin/mappatest: piano di sezione orizzontale che affetta dall'alto verso il basso i soli modelli 3D degli ambienti
   (edificio della zona, ambiente del Mariambini, Vanvere e quelli futuri). Gli stand e gli oggetti restano sempre interi: il piano e' applicato ai materiali
   dell'ambiente (clipping locale), non al renderer. Si aggancia alla scena three.js e inserisce lo slider nella barra comandi. Se qualcosa non va, la pagina resta com'e'. */
import * as THREE from 'three';

const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);   // tiene i punti con y <= quota
const PLANES_ENV = [plane], PLANES_OFF = [];
const clipped = new Set();   // materiali dell'ambiente su cui il taglio e' attivo
let scene = null, maxH = 12, level = null, lastZone = null, lastBox = 0, lastSide = 0, ui = null;

const origUMW = THREE.Object3D.prototype.updateMatrixWorld;
THREE.Object3D.prototype.updateMatrixWorld = function (force) {
  if (this.isScene && this.children.some(o => o.isDirectionalLight)) {
    if (scene !== this) { scene = this; scene.onBeforeRender = onBefore; }
    try { tick(); } catch (e) { if (!tick.err) { tick.err = 1; console.warn('clip3d', e); } }
  }
  return origUMW.call(this, force);
};

function onBefore(renderer) {
  if (level != null) plane.constant = level;
  if (!renderer.localClippingEnabled) renderer.localClippingEnabled = true;
  if (renderer.clippingPlanes !== PLANES_OFF && renderer.clippingPlanes.length) renderer.clippingPlanes = PLANES_OFF;   // nessun piano globale: gli stand non vengono mai tagliati
}

// radici dell'ambiente: edificio della zona, ambiente del Mariambini, Vanvere. Gli stand (figli di "world") e le guide di disegno ne restano fuori.
function envRoots() {
  if (!scene) return [];
  return scene.children.filter(o => o.isGroup && (o.name === 'modelG' || o.name === 'parco3d' || o.name === 'vanvere3d'
    || (!o.name && o.children.length === 7 && o.children.every(c => c.isGroup))));
}
function eachEnvMaterial(fn) {
  envRoots().forEach(r => r.traverse(o => {
    if (!o.material || o.isSprite || o.isPoints) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(fn);
  }));
}

const zoneName = () => { const b = document.querySelector('#zt .ztab.active'); return b && b.firstChild ? String(b.firstChild.textContent).trim() : ''; };

function sceneMaxHeight() {
  const box = new THREE.Box3(), tmp = new THREE.Box3(); let any = false;
  envRoots().forEach(r => r.traverse(o => {
    if (!o.isMesh || o.isSprite || !o.visible || !o.geometry) return;
    if (o.geometry.type === 'PlaneGeometry' && o.geometry.parameters && o.geometry.parameters.width > 1000) return;
    try { tmp.setFromObject(o); } catch (e) { return; }
    if (isFinite(tmp.max.y)) { box.union(tmp); any = true; }
  }));
  return any ? Math.max(3, Math.ceil(box.max.y * 2) / 2) : 12;
}

// con il taglio attivo le facce interne devono vedersi, altrimenti i volumi pieni sembrano vuoti; il piano vale solo per i materiali dell'ambiente
function applyClip(on) {
  if (on) {
    eachEnvMaterial(m => {
      if (m.clippingPlanes === PLANES_ENV) return;
      m.userData.clipSide = m.side; m.clippingPlanes = PLANES_ENV; m.clipShadows = true; m.side = THREE.DoubleSide; m.needsUpdate = true; clipped.add(m);
    });
  } else {
    clipped.forEach(m => {
      m.clippingPlanes = null; m.clipShadows = false;
      if (m.userData.clipSide !== undefined) { m.side = m.userData.clipSide; delete m.userData.clipSide; }
      m.needsUpdate = true;
    });
    clipped.clear();
  }
}

function fmt(v) { return v.toFixed(1).replace('.', ',') + ' m'; }
function refreshUi() {
  if (!ui) return;
  const { rng, val } = ui;
  rng.max = String(Math.round(maxH * 10)); rng.min = '2';
  if (level == null) { rng.value = rng.max; val.textContent = 'off'; }
  else { rng.value = String(Math.round(level * 10)); val.textContent = fmt(level); }
}

function setLevel(v) {   // v in metri, oppure null per spegnere
  level = v;
  if (scene) applyClip(v != null);
  refreshUi();
}

function mountUi() {
  const vw = document.getElementById('vw'); if (!vw) return;
  if (document.getElementById('clp')) return;
  const hs = document.getElementById('hsl'), ref = hs ? hs.closest('label') : null;
  if (!ref || !ref.parentNode) return;
  const lab = document.createElement('label');
  lab.className = 'mt-chk'; lab.title = 'Taglia il modello dall\u2019alto verso il basso (doppio clic per azzerare)';
  lab.innerHTML = 'Taglio <input type="range" id="clp" min="2" max="120" value="120"> <span id="clpv" style="min-width:3.4em;font-variant-numeric:tabular-nums">off</span>';
  ref.parentNode.insertBefore(lab, ref.nextSibling);
  const rng = lab.querySelector('#clp'), val = lab.querySelector('#clpv');
  ui = { lab, rng, val };
  rng.addEventListener('input', () => { const v = parseInt(rng.value, 10) / 10; setLevel(v >= maxH - 0.05 ? null : v); });
  rng.addEventListener('dblclick', () => setLevel(null));
  refreshUi();
}

function tick() {
  if (!document.getElementById('vw')) return;
  mountUi();
  const z = zoneName();
  const now = performance.now();
  if (z !== lastZone) { lastZone = z; lastBox = 0; if (level != null) setLevel(null); }
  if (level == null && now - lastBox > 1500) { lastBox = now; const h = sceneMaxHeight(); if (h !== maxH) { maxH = h; refreshUi(); } }
  if (level != null && now - lastSide > 600) { lastSide = now; applyClip(true); }   // copre i materiali dell'ambiente creati dopo (ambiente ricostruito)
}
