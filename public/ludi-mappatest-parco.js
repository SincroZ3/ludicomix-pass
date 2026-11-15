/* ludi-mappatest-parco.js — estensione 3D per la zona "Mariambini" della pagina /admin/mappatest.
   Non modifica ludi-mappatest.js: si aggancia alla scena three.js e aggiunge alberi, edifici di contesto, prato, percorsi, lampioni e tettoia
   leggendo i dati da /mappatest-models/mariambini.json (chiave "parco"). Se qualcosa non va, la pagina continua a funzionare come prima. */
import * as THREE from 'three';

const URL_MODEL = '/mappatest-models/mariambini.json';
let scene = null, P = null, loading = null, grp = null, builtFor = null, sync = null, restore = null, token = 0, panel = null;

const origUMW = THREE.Object3D.prototype.updateMatrixWorld;
THREE.Object3D.prototype.updateMatrixWorld = function (force) {
  if (this.isScene && this.children.some(o => o.isDirectionalLight)) { scene = this; try { tick(); } catch (e) { if (!tick.err) { tick.err = 1; console.warn('parco3d', e); } } }
  return origUMW.call(this, force);
};

const zoneName = () => { const b = document.querySelector('#zt .ztab.active'); return b && b.firstChild ? String(b.firstChild.textContent).trim() : ''; };
function tick() {
  if (!document.getElementById('vw')) return;
  if (!/mariambini/i.test(zoneName())) { if (grp) dispose(); return; }
  if (P === null) { if (!loading) loading = fetch(URL_MODEL, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(j => { P = j && j.parco ? j : false; }).catch(() => { P = false; }); return; }
  if (!P) return;
  const world = scene.children.find(o => o.isGroup && o.children.some(c => c.geometry && c.geometry.type === 'CircleGeometry')); if (!world) return;
  const floor = world.children.find(o => o.isMesh && o.geometry.type === 'PlaneGeometry' && Math.abs(o.rotation.x + Math.PI / 2) < 1e-6);
  if (!floor) return;
  if (builtFor !== floor) build(floor);
  if (sync) sync();
}
function dispose() {
  token++;
  if (restore) { try { restore(); } catch (e) {} restore = null; }
  if (grp) { scene.remove(grp); grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); grp = null; }
  if (panel) { panel.remove(); panel = null; }
  builtFor = null; sync = null;
}

function build(floor) {
  dispose(); builtFor = floor;
  const par = P.parco, gp = floor.geometry.parameters, W = gp.width, D = gp.height, pw = P.planPx[0], ph = P.planPx[1];
  const a = pw / ph, r = W / D; let wF, hF, xO; if (r >= a) { hF = 1; wF = a / r; xO = (1 - wF) / 2; } else { wF = 1; hF = r / a; xO = 0; }
  const X = px => ((xO + px / pw * wF) - .5) * W, Zc = py => ((py / ph * hF) - .5) * D, K = W * wF / pw;
  grp = new THREE.Group(); grp.name = 'parco3d'; scene.add(grp);
  const gTT = new THREE.Group(), gPlan = new THREE.Group(), gLawn = new THREE.Group(), gTuft = new THREE.Group(), gPath = new THREE.Group(), gBld = new THREE.Group(), gTrees = new THREE.Group(), gLamps = new THREE.Group(), gPav = new THREE.Group();
  gTT.add(gLawn, gTuft, gPath, gBld, gTrees, gLamps); gPlan.add(gPav); grp.add(gTT, gPlan);
  const mk = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .85 }, o || {}));
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const p = poly[i], q = poly[j]; if ((p[1] > y) !== (q[1] > y) && x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]) c = !c; } return c; };
  const shapeOf = poly => { const sh = new THREE.Shape(); poly.forEach((p, i) => i ? sh.lineTo(X(p[0]), -Zc(p[1])) : sh.moveTo(X(p[0]), -Zc(p[1]))); return sh; };
  const extrude = (poly, y0, d, mat, edges) => { const g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth: Math.max(d, .02), bevelEnabled: false }); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = y0; m.castShadow = true; m.receiveShadow = true;
    if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0x1e2d4e, transparent: true, opacity: .3 }))); return m; };
  const blob = (rad, detail, jit, col, list) => { const g = new THREE.IcosahedronGeometry(rad, detail), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (rnd() - .5) * jit; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } g.computeVertexNormals();
    const mat = mk(col, { flatShading: true, roughness: 1 }); list.push(mat); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const treeMats = [];
  const trunk = (h, r0, r1) => { const mat = mk(0x5b4636); treeMats.push(mat); const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 8), mat); m.position.y = h / 2; m.castShadow = true; return m; };
  const pine = (t, c) => { const g = new THREE.Group(), h = t.h, rr = t.r; g.add(trunk(h * .72, .5, .3)); const x = blob(rr, 2, .22, c, treeMats); x.scale.set(1, .42, 1); x.position.y = h * .8; g.add(x); const y = blob(rr * .62, 2, .22, c, treeMats); y.scale.set(1, .45, 1); y.position.set(rr * .45, h * .9, -rr * .25); g.add(y); return g; };
  const cypress = (t, c) => { const g = new THREE.Group(), b = blob(1, 2, .18, c, treeMats); b.scale.set(t.r, t.h / 2, t.r); b.position.y = t.h / 2; g.add(b); return g; };
  const broad = (t, c) => { const g = new THREE.Group(), h = t.h, rr = t.r; g.add(trunk(h * .5, .4, .25)); const x = blob(rr, 2, .25, c, treeMats); x.scale.set(1, .85, 1); x.position.y = h * .68; g.add(x); const y = blob(rr * .7, 2, .25, c, treeMats); y.position.set(-rr * .5, h * .55, rr * .3); g.add(y); return g; };
  const bar = (p, q, rad, mat) => { const d = new THREE.Vector3().subVectors(q, p), m = new THREE.Mesh(new THREE.CylinderGeometry(rad * .8, rad, d.length(), 8), mat); m.position.copy(p).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); m.castShadow = true; return m; };

  // alberi
  const cols = { pine: [0x35563a, 0x2f4d36, 0x3d6140], cypress: [0x2a4630, 0x2f4a34], broad: [0x5b7f3f, 0x4f7339, 0x68894a] }, fn = { pine, cypress, broad };
  par.trees.forEach(t => { const c = cols[t.t][Math.floor(rnd() * cols[t.t].length)], o = fn[t.t](t, c); o.position.set(X(t.x), 0, Zc(t.y)); o.rotation.y = rnd() * 6.28; gTrees.add(o); });
  // lampioni
  par.lamps.forEach(l => { const g = new THREE.Group(), p = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 5, 8), mk(0x2b2d36)); p.position.y = 2.5; p.castShadow = true; g.add(p);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: .6 })); hd.position.y = 5.1; g.add(hd); g.position.set(X(l[0]), 0, Zc(l[1])); gLamps.add(g); });
  // edifici di contesto
  const cols2 = [0xe2c58f, 0xd9a98e, 0xcfa78d, 0xe8dcc0];
  par.buildings.forEach((poly, i) => { const hh = 11 + (i % 4) * 1.6; gBld.add(extrude(poly, -.6, hh + .6, mk(cols2[i % 4]), true)); gBld.add(extrude(poly, hh, .8, mk(0xb5573c, { roughness: .9 }), false)); });
  // Istituto dal tratteggio della planimetria
  const ist = par.istituto; gPlan.add(extrude(ist.poly, -.6, 10.6, mk(0xe9dcb6), true)); ist.tiers.forEach(t => gPlan.add(extrude(t.poly, 10 + t.k * .8, .85, mk(0x8da39b, { roughness: .55 }), t.k === 0)));
  // tettoia: 6 sostegni inclinati in legno + copertura in laminato metallico (bordo esterno alto, interno basso)
  const V = par.pavilion, Cx = X(V.c[0]), Cz = Zc(V.c[1]), R0 = V.r0 * K, R1 = V.r1 * K, RM = (R0 + R1) / 2, span = V.a1 - V.a0;
  const matMetal = mk(0x9ea4a9, { roughness: .35, metalness: .75, side: THREE.DoubleSide }), matWood = mk(0x5a3a28, { roughness: .7 });
  { const pos = [], prof = [[R0, V.hIn], [R1, V.hOut], [R1, V.hOut - .14], [R0, V.hIn - .14]], n = 60, pt = (rr, h, an) => [Cx + rr * Math.cos(an), h, Cz + rr * Math.sin(an)];
    const ring = i => { const an = (V.a0 + span * i / n) * Math.PI / 180; return prof.map(([rr, h]) => pt(rr, h, an)); }; const quad = (A, B, C, E) => pos.push(...A, ...B, ...C, ...A, ...C, ...E);
    for (let i = 0; i < n; i++) { const A = ring(i), B = ring(i + 1); for (let k = 0; k < 4; k++) quad(A[k], B[k], B[(k + 1) % 4], A[(k + 1) % 4]); }
    const e0 = ring(0), e1 = ring(n); quad(e0[0], e0[1], e0[2], e0[3]); quad(e1[3], e1[2], e1[1], e1[0]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, matMetal); m.castShadow = true; m.receiveShadow = true; gPav.add(m);
    const hAt = rr => V.hIn + (V.hOut - V.hIn) * (rr - R0) / (R1 - R0);
    for (let i = 0; i < V.supports; i++) { const an = (V.a0 + span / V.supports * (i + .5)) * Math.PI / 180, tg = an + Math.PI / 2, b0 = new THREE.Vector3(Cx + RM * Math.cos(an), 0, Cz + RM * Math.sin(an));
      const fork = b0.clone().add(new THREE.Vector3(Math.cos(an) * .45, 0, Math.sin(an) * .45)); fork.y = 2.3; gPav.add(bar(b0, fork, .2, matWood));
      [[-1.9, 0], [1.9, 0], [0, 1.5], [0, -1.5]].forEach(([dr, dt]) => { const rr = RM + dr; gPav.add(bar(fork, new THREE.Vector3(Cx + rr * Math.cos(an) + Math.cos(tg) * dt, hAt(rr) - .16, Cz + rr * Math.sin(an) + Math.sin(tg) * dt), .09, matWood)); }); }
    for (let i = 0; i <= 36; i++) { const an = (V.a0 + span * i / 36) * Math.PI / 180; gPav.add(bar(new THREE.Vector3(Cx + R0 * Math.cos(an), V.hIn - .2, Cz + R0 * Math.sin(an)), new THREE.Vector3(Cx + R1 * Math.cos(an), V.hOut - .2, Cz + R1 * Math.sin(an)), .045, matWood)); } }
  // prato e percorsi (sotto la planimetria, che diventa trasparente "moltiplicata")
  const grassTex = () => { const c = cv(512, 512), g = c.getContext('2d'); g.fillStyle = '#5d8a3a'; g.fillRect(0, 0, 512, 512); const pal = ['#3f6f2b', '#4e7f31', '#6a9a3d', '#7aa845', '#8fb050', '#a3b25a', '#5b8a35', '#2f5a25', '#b2b660'];
    for (let i = 0; i < 14000; i++) { const x = rnd() * 512, y = rnd() * 512, L = 5 + rnd() * 11, an = -Math.PI / 2 + (rnd() - .5) * 1.1; g.strokeStyle = pal[Math.floor(rnd() * pal.length)]; g.globalAlpha = .35 + rnd() * .5; g.lineWidth = .8 + rnd() * 1.1;
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(an) * L, y + oy + Math.sin(an) * L); g.stroke(); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const paverTex = () => { const c = cv(256, 256), g = c.getContext('2d'); g.fillStyle = '#7d7e7c'; g.fillRect(0, 0, 256, 256);
    for (let rr = 0; rr < 16; rr++) for (let k = 0; k < 8; k++) { const x = k * 32 + (rr % 2 ? 16 : 0), y = rr * 16, v = 118 + Math.floor(rnd() * 50); g.fillStyle = 'rgb(' + (v + 6) + ',' + v + ',' + (v - 8) + ')'; g.fillRect(x + 1, y + 1, 30, 14); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const lawnShape = shapeOf(par.lawn), gt = grassTex(); gt.repeat.set(1 / 2.2, 1 / 2.2);
  const lawn = new THREE.Mesh(new THREE.ShapeGeometry(lawnShape), new THREE.MeshStandardMaterial({ map: gt, bumpMap: gt, bumpScale: .6, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); lawn.rotation.x = -Math.PI / 2; lawn.position.y = -.006; lawn.receiveShadow = true; gLawn.add(lawn);
  const FW = pw * K, FH = ph * K, FCx = X(pw / 2), FCz = Zc(ph / 2);
  const tc = cv(1220, 540), tg = tc.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, 1220, 540);
  for (let i = 0; i < 60; i++) { const x = rnd() * 1220, y = rnd() * 540, rr = 30 + rnd() * 90, gr = tg.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, rnd() < .6 ? 'rgba(205,190,120,.5)' : 'rgba(150,185,120,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); tg.fillStyle = gr; tg.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); }
  par.trees.forEach(t => { const x = t.x / 2, y = t.y / 2, rr = (t.r / K) / 2 * 1.1, gr = tg.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(60,70,40,.75)'); gr.addColorStop(.7, 'rgba(90,100,60,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); tg.fillStyle = gr; tg.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); });
  const tint = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), new THREE.MeshBasicMaterial({ map: (() => { const t = new THREE.CanvasTexture(tc); t.colorSpace = THREE.SRGBColorSpace; return t; })(), transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); tint.rotation.x = -Math.PI / 2; tint.position.set(FCx, -.005, FCz); tint.renderOrder = 2; gLawn.add(tint);
  // planimetria stand: il pavimento della pagina diventa trasparente (moltiplicato) per far vedere prato e percorsi
  const old = floor.material, mul = new THREE.MeshBasicMaterial({ map: old.map || null, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  floor.material = mul; floor.renderOrder = 3; floor.receiveShadow = false;
  sync = () => { if (mul.map !== old.map) { mul.map = old.map; mul.needsUpdate = true; } };
  restore = () => { floor.material = old; floor.renderOrder = 0; floor.receiveShadow = true; floor.visible = true; };

  (() => {
    const pm = cv(1220, 540), pg = pm.getContext('2d'); pg.fillStyle = '#000'; pg.fillRect(0, 0, 1220, 540); pg.fillStyle = '#fff'; pg.beginPath();
    par.paths.forEach(poly => { poly.forEach((p, i) => i ? pg.lineTo(p[0] / 2, p[1] / 2) : pg.moveTo(p[0] / 2, p[1] / 2)); pg.closePath(); }); pg.fill('evenodd'); const pd = pg.getImageData(0, 0, 1220, 540).data;
    const pv = paverTex(); pv.repeat.set(FW / 1.6, FH / 1.6); const am = new THREE.CanvasTexture(pm);
    const pp = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), new THREE.MeshStandardMaterial({ map: pv, alphaMap: am, transparent: true, alphaTest: .4, roughness: .9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); pp.rotation.x = -Math.PI / 2; pp.position.set(FCx, -.004, FCz); pp.receiveShadow = true; gPath.add(pp);
    const N = 22000, tp = [];
    for (let k = 0; k < 5; k++) { const an = k * 1.26 + rnd(), h = .14 + rnd() * .16, w = .012, dx = Math.cos(an) * w, dz = Math.sin(an) * w, ox = (rnd() - .5) * .1, oz = (rnd() - .5) * .1, lean = .07; tp.push(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + Math.cos(an + 1.2) * lean, h, oz + Math.sin(an + 1.2) * lean); }
    const tg2 = new THREE.BufferGeometry(); tg2.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); tg2.computeVertexNormals();
    const im = new THREE.InstancedMesh(tg2, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), N), d = new THREE.Object3D(), col = new THREE.Color(); let n = 0, tries = 0;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; par.lawn.forEach(p => { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); });
    const bps = par.buildings.concat([ist.poly]);
    while (n < N && tries < N * 8) { tries++; const px = minx + rnd() * (maxx - minx), py = miny + rnd() * (maxy - miny); if (!inPoly(px, py, par.lawn)) continue; if (pd[((Math.floor(py / 2) * 1220) + Math.floor(px / 2)) * 4] > 100) continue; if (bps.some(q => inPoly(px, py, q))) continue;
      d.position.set(X(px), 0, Zc(py)); d.rotation.y = rnd() * 6.28; const sc = .8 + rnd() * 1.1; d.scale.set(sc * 1.6, sc, sc * 1.6); d.updateMatrix(); im.setMatrixAt(n, d.matrix); col.setHSL(.22 + rnd() * .07 - (rnd() < .2 ? .07 : 0), .45 + rnd() * .2, .22 + rnd() * .14); im.setColorAt(n, col); n++; }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; gTuft.add(im);
  })();

  // pannello comandi
  const vw = document.getElementById('vw'); panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;right:10px;top:10px;z-index:30;background:rgba(255,255,255,.93);border:1px solid #ece6f7;border-radius:14px;padding:8px 10px;font:12px system-ui,sans-serif;color:#2b1d4d;max-width:210px;box-shadow:0 6px 20px rgba(30,45,78,.18)';
  panel.innerHTML = '<b style="font-size:12px">Ambiente 3D</b>' +
    ['Alberi|tr', 'Edifici di contesto|bl', 'Prato|gr', 'Fili d\u2019erba 3D|tu', 'Percorsi|pa', 'Planimetria stand|pl', 'Tettoia|pv', 'Lampioni|la'].map(s => { const [l, id] = s.split('|'); return '<label style="display:flex;gap:6px;align-items:center;margin:2px 0;font-weight:600"><input type="checkbox" data-k="' + id + '" checked> ' + l + '</label>'; }).join('') +
    '<label style="display:block;margin-top:4px;font-weight:600">Trasparenza alberi<input data-k="to" type="range" min="0" max="90" value="0" style="width:100%"></label>' +
    '<div style="margin-top:4px;font-weight:700;color:#6b5a8a">Allineamento ambiente</div>' +
    '<label style="display:block">E-O <span data-v="ax">0</span> m<input data-k="ax" type="range" min="-15" max="15" step="0.1" value="0" style="width:100%"></label>' +
    '<label style="display:block">N-S <span data-v="az">0</span> m<input data-k="az" type="range" min="-15" max="15" step="0.1" value="0" style="width:100%"></label>' +
    '<label style="display:block">Rotazione <span data-v="ar">0</span>\u00b0<input data-k="ar" type="range" min="-6" max="6" step="0.1" value="0" style="width:100%"></label>';
  vw.appendChild(panel);
  const g = k => panel.querySelector('[data-k="' + k + '"]'), apply = () => {
    gTrees.visible = g('tr').checked; gBld.visible = g('bl').checked; gLawn.visible = g('gr').checked; gTuft.visible = g('tu').checked && g('gr').checked; gPath.visible = g('pa').checked; floor.visible = g('pl').checked; gPav.visible = g('pv').checked; gLamps.visible = g('la').checked;
    const o = +g('to').value / 100; treeMats.forEach(m => { m.transparent = o > 0; m.opacity = 1 - o; m.depthWrite = o < .3; m.needsUpdate = true; });
    gTT.position.set(+g('ax').value, 0, +g('az').value); gTT.rotation.y = -(+g('ar').value) * Math.PI / 180;
    ['ax', 'az', 'ar'].forEach(k => { panel.querySelector('[data-v="' + k + '"]').textContent = g(k).value; });
  };
  panel.querySelectorAll('input').forEach(i => { i.oninput = apply; i.onpointerdown = e => e.stopPropagation(); }); panel.onpointerdown = e => e.stopPropagation(); panel.onwheel = e => e.stopPropagation();
  apply();
}
