/**
 * routes/map3d-public.js
 * Fase 3: aggiunge il pulsante 3D/2D alla mappa stand pubblica (/mappa-stand/:zoneId) senza modificare agenda_routes.js
 * ne la vista stand_map.ejs. La pagina viene ritoccata solo mentre viene inviata: nel <head> la mappa degli import di three.js,
 * in fondo lo script public/ludi-map3d-public.js. Lo script aggiunge il pulsante solo se la zona ha un layout 3D e apre il 3D per primo;
 * in caso di errore o senza WebGL resta la mappa 2D di sempre. Per disattivare: togliere la riga che carica questo file in routes/map3d-api.js.
 * Registra anche routes/map3d-portal.js (fase 4: portale espositore) e routes/map3d-internal.js (fase 5: mappa interna /mappa).
 */
const V = Date.now().toString(36);

module.exports = function registerMap3dPublic(app, db, mw) {
  const P = '/mappa-stand/:zoneId';
  const imap = JSON.stringify({ imports: { three: 'https://unpkg.com/three@0.160.0/build/three.module.js', 'three/addons/': 'https://unpkg.com/three@0.160.0/examples/jsm/' } });
  const head = `<script type='importmap'>${imap}</script>`;
  const tag = `<script src='/ludi-map3d-public.js?v=${V}' defer></script>`;

  const inject = (req, res, next) => {
    const render = res.render.bind(res);
    res.render = (view, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = undefined; }
      return render(view, opts || {}, (err, html) => {
        if (err) { if (cb) return cb(err); return next(err); }
        let out = html;
        try {
          out = out.includes('</head>') ? out.replace('</head>', () => head + '</head>') : head + out;
          const i = out.lastIndexOf('</body>');
          out = i === -1 ? out + tag : out.slice(0, i) + tag + out.slice(i);
        } catch (_) { out = html; }
        if (cb) return cb(null, out);
        res.send(out);
      });
    };
    next();
  };

  // la rotta dell'agenda risponde per prima: il mio passaggio va messo davanti
  const stack = app._router && app._router.stack;
  const before = stack ? stack.length : 0;
  app.get(P, inject);
  if (stack) {
    const mine = stack.splice(before);
    const idx = stack.findIndex((l) => (l.route && l.route.path === P) ||
      (l.name === 'router' && l.handle && l.handle.stack && l.handle.stack.some((s) => s.route && s.route.path === P)));
    if (idx >= 0) stack.splice(idx, 0, ...mine); else stack.push(...mine);
  }

  // Fase 4: portale espositore
  try { require('./map3d-portal')(app, db, mw); } catch (e) { console.error('[map3d-portal]', e.message); }
  // Fase 5: mappa interna /mappa
  try { require('./map3d-internal')(app, db, mw); } catch (e) { console.error('[map3d-internal]', e.message); }
};
