/**
 * routes/map3d-internal.js
 * Fase 5: mappa interna /mappa in 3D. Aggiunge alla pagina (senza modificare mappa.js ne mappa.ejs) la scelta 3D / 2D:
 * il 3D si apre per primo; il 2D resta disponibile e, quando la sincronizzazione 3D -> 2D e attiva, diventa di sola lettura.
 * Chi puo modificare la mappa (admin, organizer, operator: gli stessi di requireNotViewer) trova nel 3D l'editor completo di /admin/mappatest;
 * per loro le rotte /admin/mappatest* passano da requireAdmin a requireNotViewer (vedi openEditorAccess). Gli altri vedono il 3D di sola lettura.
 *
 *   GET /api/map3d/zone/i-<id o nome zona>   dati 3D della zona con i nomi di tutti gli stand (solo utenti collegati)
 *   GET /api/map3d/internal-status           { sync, admin, editor }: sync = esistono i trigger di sincronizzazione su map_test_layout
 *
 * Per disattivare: togliere la riga che carica questo file in routes/map3d-public.js.
 */
const V = Date.now().toString(36);

module.exports = function registerMap3dInternal(app, db, mw) {
  const { requireAuth } = mw;
  const all = (sql, p) => new Promise((ok, ko) => db.all(sql, p || [], (e, r) => (e ? ko(e) : ok(r || []))));
  const get = (sql, p) => new Promise((ok, ko) => db.get(sql, p || [], (e, r) => (e ? ko(e) : ok(r))));
  const parseShape = (v) => { if (!v) return null; try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch (_) { return null; } };
  const isAdmin = (req) => !!(req.session && req.session.user && req.session.user.role === 'admin');
  const EDIT_ROLES = ['admin', 'organizer', 'operator'];
  const canEdit = (req) => !!(req.session && req.session.user && EDIT_ROLES.indexOf(req.session.user.role) >= 0);

  // Le rotte /admin/mappatest* sono registrate da routes/mappa.js con requireAdmin: qui si sostituisce quel controllo con requireNotViewer.
  // Si esegue una sola volta, alla prima richiesta (quando tutte le rotte sono gia registrate).
  let opened = false;
  function openEditorAccess() {
    if (opened) return;
    opened = true;
    try {
      const stack = (app._router && app._router.stack) || [];
      let n = 0;
      stack.forEach((l) => {
        const r = l.route;
        if (!r || typeof r.path !== 'string' || r.path.indexOf('/admin/mappatest') !== 0) return;
        r.stack.forEach((s) => { if (mw.requireNotViewer && s.handle === mw.requireAdmin) { s.handle = mw.requireNotViewer; n++; } });
      });
      console.log('[map3d-internal] editor 3D aperto a chi puo modificare la mappa: ' + n + ' controlli aggiornati');
    } catch (e) { console.error('[map3d-internal] accesso editor', e.message); }
  }

  function inFront(register, path) {
    const stack = app._router && app._router.stack;
    const before = stack ? stack.length : 0;
    register();
    if (!stack) return;
    const mine = stack.splice(before);
    const idx = stack.findIndex((l) => (l.route && l.route.path === path) ||
      (l.name === 'router' && l.handle && l.handle.stack && l.handle.stack.some((s) => s.route && s.route.path === path)));
    if (idx >= 0) stack.splice(idx, 0, ...mine); else stack.push(...mine);
  }

  async function zoneData(key) {
    const z = /^[0-9]+$/.test(key)
      ? await get('SELECT * FROM zones WHERE id = ?', [parseInt(key, 10)])
      : await get('SELECT * FROM zones WHERE name = ? LIMIT 1', [key]);
    if (!z) return null;
    const cfg = (await get('SELECT * FROM map_test_zone WHERE zone = ?', [z.name])) || {};
    const rows = await all(`SELECT l.*, ag.name AS stand_name, ag.stand_code AS stand_code
                            FROM map_test_layout l LEFT JOIN assignment_groups ag ON ag.id = l.group_id WHERE l.zone = ?`, [z.name]);
    const stands = [];
    rows.forEach((l) => {
      const obj = l.kind === 'obj' || l.group_id < 0;
      const name = obj ? (l.label || 'Oggetto') : l.stand_name;
      if (!name) return;
      stands.push({
        id: l.group_id, name, code: obj ? '' : (l.stand_code || ''), kind: obj ? 'obj' : 'stand',
        fx: l.fx, fy: l.fy, wf: l.wf, df: l.df, rot: l.rot || 0, shape: parseShape(l.shape),
        h: l.height || 2.5, elev: l.elev || 0, model: l.model || null, color: l.color || null,
        lscale: l.lscale || 1, lrot: l.lrot || 0, notes: obj ? (l.notes || '') : '',
      });
    });
    const set = {};
    try { (await all(`SELECT key, value FROM map_test_setting WHERE key IN ('lbl_color','lbl_outline')`)).forEach((r) => { set[r.key] = r.value; }); } catch (_) { /* predefiniti */ }
    return {
      zone: { id: z.id, name: z.name, bg: z.background_image || null, refW: z.map_ref_w || null, refH: z.map_ref_h || null, widthM: cfg.width_m || null, outdoor: cfg.outdoor ? 1 : 0 },
      stands, settings: set,
    };
  }

  inFront(() => {
    app.get('/api/map3d/zone/:zoneId', (req, res, next) => {
      const zid = String(req.params.zoneId || '');
      if (zid.indexOf('i-') !== 0) return next();
      requireAuth(req, res, async () => {
        res.set('Cache-Control', 'no-store');
        try {
          const d = await zoneData(zid.slice(2));
          if (!d) return res.status(404).json({ error: 'Zona non trovata' });
          res.json(d);
        } catch (e) { console.error('[map3d-internal]', e.message); res.status(500).json({ error: 'Errore interno' }); }
      });
    });
  }, '/api/map3d/zone/:zoneId');

  app.get('/api/map3d/internal-status', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const editor = canEdit(req);
    if (editor) openEditorAccess();
    try {
      const r = await get(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'map_test_layout'`);
      res.json({ sync: !!(r && r.c > 0), admin: isAdmin(req), editor });
    } catch (e) { res.json({ sync: false, admin: isAdmin(req), editor }); }
  });

  const imap = JSON.stringify({ imports: { three: 'https://unpkg.com/three@0.160.0/build/three.module.js', 'three/addons/': 'https://unpkg.com/three@0.160.0/examples/jsm/' } });
  const head = `<script type='importmap'>${imap}</script>`;
  const tag = `<script src='/ludi-map3d-internal.js?v=${V}' defer></script>`;
  inFront(() => {
    app.get('/mappa', (req, res, next) => {
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
    });
  }, '/mappa');
};
