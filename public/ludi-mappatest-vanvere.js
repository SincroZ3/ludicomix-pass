/* ludi-mappatest-vanvere.js — modello 3D della zona "Vanvere" per la pagina /admin/mappatest.
   Non modifica ludi-mappatest.js: si aggancia alla scena three.js e costruisce muri (con porte, finestre e archi come fori reali), tetti a falde, terrazza e vialetto
   leggendo i dati da /mappatest-models/vanvere.json (chiave "vanvere"). Se qualcosa non va, la pagina continua a funzionare come prima. */
import * as THREE from 'three';

const URL_MODEL = '/mappatest-models/vanvere.json';
let scene = null, V = null, loading = null, grp = null, builtFor = null, panel = null, hmData = null, hmLoading = null;

const origUMW = THREE.Object3D.prototype.updateMatrixWorld;
THREE.Object3D.prototype.updateMatrixWorld = function (force) {
  if (this.isScene && this.children.some(o => o.isDirectionalLight)) { scene = this; try { tick(); } catch (e) { if (!tick.err) { tick.err = 1; console.warn('vanvere3d', e); } } }
  return origUMW.call(this, force);
};

const zoneName = () => { const b = document.querySelector('#zt .ztab.active'); return b && b.firstChild ? String(b.firstChild.textContent).trim() : ''; };
function loadImg(src) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
function imgData(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; }

function tick() {
  if (!document.getElementById('vw')) return;
  if (!/vanvere/i.test(zoneName())) { if (grp) dispose(); return; }
  if (V === null) { if (!loading) loading = fetch(URL_MODEL, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(j => { V = j && j.vanvere ? j : false; }).catch(() => { V = false; }); return; }
  if (!V) return;
  if (!hmData) {
    if (!hmLoading) { const ks = Object.keys(V.vanvere.hm); hmLoading = Promise.all(ks.map(k => loadImg(V.vanvere.hm[k]))).then(im => { if (im.every(Boolean)) { hmData = {}; ks.forEach((k, i) => { hmData[k] = imgData(im[i]); }); } else hmData = false; }); }
    return;
  }
  if (!hmData) return;
  const world = scene.children.find(o => o.isGroup && o.children.some(c => c.geometry && c.geometry.type === 'CircleGeometry')); if (!world) return;
  const floor = world.children.find(o => o.isMesh && o.geometry.type === 'PlaneGeometry' && Math.abs(o.rotation.x + Math.PI / 2) < 1e-6);
  if (!floor) return;
  if (builtFor !== floor) build(floor);
}
function dispose() {
  if (grp) { scene.remove(grp); grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose(); }); } }); grp = null; }
  if (panel) { panel.remove(); panel = null; }
  builtFor = null;
}

function tileTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#b5573c'; g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 16; r++) for (let k = 0; k < 16; k++) { const v = 150 + ((r * 7 + k * 13) % 40); g.fillStyle = 'rgb(' + (v + 40) + ',' + (v - 70) + ',' + (v - 100) + ')'; g.fillRect(k * 16 + 1, r * 16 + 1, 14, 14); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function pavTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { const v = 170 + ((r * 5 + k * 9) % 22); g.fillStyle = 'rgb(' + v + ',' + (v - 3) + ',' + (v - 10) + ')'; g.fillRect(k * 64 + 2, r * 64 + 2, 60, 60); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 12); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function build(floor) {
  dispose(); builtFor = floor;
  const M = V.vanvere, gp = floor.geometry.parameters, W = gp.width, D = gp.height, pw = V.planPx[0], ph = V.planPx[1];
  const a = pw / ph, r = W / D; let wF, hF, xO; if (r >= a) { hF = 1; wF = a / r; xO = (1 - wF) / 2; } else { wF = 1; hF = r / a; xO = 0; }
  const X = px => ((xO + px / pw * wF) - .5) * W, Z = py => ((py / ph * hF) - .5) * D, K = W * wF / pw;
  const FW = pw * K, FH = ph * K, FCx = X(pw / 2), FCz = Z(ph / 2);
  const tot = M.tot, eaveOf = id => id === 'P' ? tot.P - M.slabT : tot[id] * (1 - M.riseF);
  grp = new THREE.Group(); grp.name = 'vanvere3d'; scene.add(grp);
  const gWall = new THREE.Group(), gRoof = new THREE.Group(), gWin = new THREE.Group(), gPath = new THREE.Group(); grp.add(gWall, gRoof, gWin, gPath);

  const shapeOf = p => {
    const sh = new THREE.Shape();
    p.o.forEach((q, i) => i ? sh.lineTo(X(q[0]), -Z(q[1])) : sh.moveTo(X(q[0]), -Z(q[1])));
    p.h.forEach(rg => { const hp = new THREE.Path(); rg.forEach((q, i) => i ? hp.lineTo(X(q[0]), -Z(q[1])) : hp.moveTo(X(q[0]), -Z(q[1]))); sh.holes.push(hp); });
    return sh;
  };
  const prism = (p, y0, y1, mat, edges) => {
    if (y1 - y0 < 0.02) return null;
    const g = new THREE.ExtrudeGeometry(shapeOf(p), { depth: y1 - y0, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.position.y = y0; m.castShadow = true; m.receiveShadow = true;
    if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: 0.3 })));
    return m;
  };
  const tile = tileTex(); tile.repeat.set(FW / 1.6, FH / 1.6);
  const roofMesh = (hm, eave, rise, mat) => {
    const sx = 400, sz = 256, g = new THREE.PlaneGeometry(FW, FH, sx, sz); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, inside = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const px = (pos.getX(i) / FW + 0.5) * hm.w, py = (pos.getZ(i) / FH + 0.5) * hm.h;
      const ix = Math.max(0, Math.min(hm.w - 1, Math.round(px))), iy = Math.max(0, Math.min(hm.h - 1, Math.round(py)));
      const v = hm.d[(iy * hm.w + ix) * 4]; inside[i] = v > 0 ? 1 : 0;
      pos.setY(i, eave + (v > 0 ? Math.min(rise, M.slope * v * 2 * K) : 0));
    }
    const idx = g.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) { const q = idx[t], b = idx[t + 1], c = idx[t + 2]; if (inside[q] && inside[b] && inside[c]) keep.push(q, b, c); }
    g.setIndex(keep); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.position.set(FCx, 0, FCz); m.castShadow = true; m.receiveShadow = true; return m;
  };
  const archLintel = (q, hWall, mat) => {
    const rr = q.w / 2, sp = q.sp || 2.1, t = Math.max(0.3, q.t);
    if (hWall <= sp + rr + 0.05) return null;
    const sh = new THREE.Shape();
    sh.moveTo(-rr, sp); sh.absarc(0, sp, rr, Math.PI, 0, true); sh.lineTo(rr, hWall); sh.lineTo(-rr, hWall); sh.lineTo(-rr, sp);
    (q.holes || []).forEach(h => { if (h.y1 > hWall - 0.1 || h.y0 < sp + rr + 0.1) return; const hp = new THREE.Path(); const x0 = h.cx - h.w / 2, x1 = h.cx + h.w / 2; hp.moveTo(x0, h.y0); hp.lineTo(x0, h.y1); hp.lineTo(x1, h.y1); hp.lineTo(x1, h.y0); hp.lineTo(x0, h.y0); sh.holes.push(hp); });
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }); g.translate(0, 0, -t / 2);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
    const gg = new THREE.Group(); gg.add(m); gg.position.set(X(q.x), 0, Z(q.y)); gg.rotation.y = -q.a; return gg;
  };
  const makeAp = (e, mats) => {
    const w = e.w, h = e.h, y0 = e.y0, fr = 0.07, dp = 0.12, g = new THREE.Group(), door = e.t === 'door' || e.t === 'dbl';
    g.position.set(X(e.x), 0, Z(e.y)); g.rotation.y = -e.a;
    const box = (bw, bh, bd, x, y, m) => { const q = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m || mats.frame); q.position.set(x, y, 0); q.castShadow = true; g.add(q); return q; };
    if (e.t === 'arc') {
      const rr = w / 2, spr = e.sp - y0, sh = new THREE.Shape();
      sh.moveTo(-rr, 0); sh.lineTo(-rr, spr); sh.absarc(0, spr, rr, Math.PI, 0, true); sh.lineTo(rr, 0); sh.lineTo(-rr, 0);
      const ri = rr - fr, inner = new THREE.Path(); inner.moveTo(-ri, fr); inner.lineTo(-ri, spr); inner.absarc(0, spr, ri, Math.PI, 0, true); inner.lineTo(ri, fr); inner.lineTo(-ri, fr);
      const shf = new THREE.Shape(sh.getPoints(24)); shf.holes.push(new THREE.Path(inner.getPoints(24)));
      const fg = new THREE.ExtrudeGeometry(shf, { depth: dp, bevelEnabled: false }); fg.translate(0, 0, -dp / 2);
      const fm = new THREE.Mesh(fg, mats.frame); fm.position.y = y0; fm.castShadow = true; g.add(fm);
      const gs = new THREE.Shape(inner.getPoints(24)), gg = new THREE.ExtrudeGeometry(gs, { depth: 0.03, bevelEnabled: false }); gg.translate(0, 0, -0.015);
      const gm = new THREE.Mesh(gg, mats.glass); gm.position.y = y0; g.add(gm);
      box(0.04, spr + rr - fr, 0.05, 0, y0 + (spr + rr) / 2); box(w - 2 * fr, 0.04, 0.05, 0, y0 + spr * 0.55);
      box(w + 0.18, 0.06, dp + 0.1, 0, y0 - 0.03);
      return g;
    }
    box(fr, h, dp, -(w / 2 - fr / 2), y0 + h / 2); box(fr, h, dp, w / 2 - fr / 2, y0 + h / 2);
    box(w, fr, dp, 0, y0 + h - fr / 2); if (!door) box(w, fr, dp, 0, y0 + fr / 2);
    const gh = h - fr - (door ? 0 : fr), gy = y0 + (door ? 0 : fr) + gh / 2;
    const gl = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * fr, gh, 0.03), mats.glass); gl.position.set(0, gy, 0); g.add(gl);
    if (e.t === 'win') { if (w > 0.95) box(0.04, gh, 0.05, 0, gy); if (h > 1.4) box(w - 2 * fr, 0.04, 0.05, 0, y0 + h * 0.62); box(w + 0.18, 0.06, dp + 0.1, 0, y0 - 0.03); }
    if (e.t === 'door') { box(w - 2 * fr, 0.05, 0.06, 0, y0 + h - 0.45); box(0.05, 0.2, 0.08, w / 2 - 0.22, y0 + 1.0, mats.dark); }
    if (e.t === 'dbl') { box(0.05, gh, 0.06, 0, gy); box(w - 2 * fr, 0.05, 0.06, 0, y0 + h - 0.5); }
    return g;
  };

  const wMat = new THREE.MeshStandardMaterial({ color: 0xe9c9b8, roughness: 0.85 });
  const vMat = new THREE.MeshStandardMaterial({ color: 0xe6cf9c, roughness: 0.85 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xc9b9a6, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tile, roughness: 0.9, side: THREE.DoubleSide });
  const mFrame = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7 });
  const mGlass = new THREE.MeshStandardMaterial({ color: 0x35506e, roughness: 0.15, metalness: 0.25 });
  const mats = { frame: new THREE.MeshStandardMaterial({ color: 0xaaa79d, roughness: 0.8 }), glass: mGlass, dark: new THREE.MeshStandardMaterial({ color: 0x3b3b3b, roughness: 0.5 }) };
  const add = (g, m) => { if (m) g.add(m); };

  M.zones.forEach(z => {
    const eave = eaveOf(z.id);
    z.walls.forEach(p => add(gWall, prism(p, 0, eave, wMat, false)));
    z.lint.forEach(p => add(gWall, prism(p, M.lintel, eave, wMat, false)));
    z.vol.forEach(p => add(gWall, prism(p, 0, eave, vMat, true)));
    z.vlint.forEach(p => add(gWall, prism(p, M.lintel, eave, vMat, true)));
    z.arch.forEach(q => add(gWall, archLintel(q, eave, wMat)));
    (z.layers || []).forEach(l => { const y1 = l.y1 == null ? eave : Math.min(l.y1, eave); if (l.y0 >= eave) return; add(gWall, prism(l, l.y0, y1, l.k === 'v' ? vMat : wMat, false)); });
    if (z.id === 'P') z.slab.forEach(p => add(gRoof, prism(p, tot.P - M.slabT, tot.P, slabMat, true)));
    else gRoof.add(roofMesh(hmData[z.id], eave, tot[z.id] * M.riseF, roofMat));
  });
  (M.ap || []).forEach(e => {
    const eave = eaveOf(e.z);
    if (e.y0 + e.h > eave - 0.15) return;
    if (e.t === 'arc') add(gWall, archLintel({ x: e.x, y: e.y, a: e.a, w: e.w, t: Math.max(0.3, e.d || 0.5), sp: e.sp }, eave, wMat));
    gWin.add(makeAp(e, mats));
  });
  const gFrame = new THREE.BoxGeometry(1.1, 1.6, 0.12), gGlass = new THREE.BoxGeometry(0.9, 1.4, 0.14);
  (M.win || []).forEach(w => {
    const eave = eaveOf(w.z);
    for (let cy = 1.7; cy + 0.8 <= eave - 0.2; cy += 3.0) {
      const g = new THREE.Group(), f = new THREE.Mesh(gFrame, mFrame), gl = new THREE.Mesh(gGlass, mGlass); f.castShadow = true;
      g.add(f, gl); g.position.set(X(w.x), cy, Z(w.y)); g.rotation.y = -w.a; gWin.add(g);
    }
  });
  // vialetto che esce dall'arco in alto e porta al Mariambini (schematico)
  if (M.path) { const pm = new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.95, map: pavTex() }); const pp = prism({ o: M.path.o, h: [] }, -0.62, 0.03, pm, false); if (pp) { pp.castShadow = false; gPath.add(pp); } }

  // pannello comandi (spostato nella barra dallo script ui, come quello dell'ambiente del Mariambini)
  const vw = document.getElementById('vw'); panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;right:10px;top:10px;z-index:30;background:rgba(255,255,255,.93);border:1px solid #ece6f7;border-radius:14px;padding:8px 10px;font:12px system-ui,sans-serif;color:#2b1d4d;max-width:210px;box-shadow:0 6px 20px rgba(30,45,78,.18)';
  panel.innerHTML = '<b style="font-size:12px">Ambiente 3D</b>' +
    ['Tetti e terrazza|rf', 'Muri e volumi|wl', 'Finestre e porte|wn', 'Vialetto verso il Mariambini|pt'].map(s => { const [l, id] = s.split('|'); return '<label style="display:flex;gap:6px;align-items:center;margin:2px 0;font-weight:600"><input type="checkbox" data-k="' + id + '" checked> ' + l + '</label>'; }).join('') +
    '<label style="display:block;margin-top:4px;font-weight:600">Trasparenza tetti e muri<input data-k="tr" type="range" min="0" max="100" value="0" style="width:100%"></label>';
  vw.appendChild(panel);
  const g = k => panel.querySelector('[data-k="' + k + '"]'), apply = () => {
    gRoof.visible = g('rf').checked; gWall.visible = g('wl').checked; gWin.visible = g('wn').checked; gPath.visible = g('pt').checked;
    const t = +g('tr').value / 100;
    [[wMat, .85], [vMat, .85], [slabMat, .9], [roofMat, .92]].forEach(([m, k]) => { m.transparent = t > 0; m.opacity = 1 - k * t; m.depthWrite = t < .3; m.needsUpdate = true; });
  };
  panel.querySelectorAll('input').forEach(i => { i.oninput = apply; i.onpointerdown = e => e.stopPropagation(); }); panel.onpointerdown = e => e.stopPropagation(); panel.onwheel = e => e.stopPropagation();
  apply();
}
