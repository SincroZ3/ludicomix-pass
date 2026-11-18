/**
 * routes/map3d-portal.js
 * Portale espositore (/portale/:token).
 *   - 3D nel riquadro "Dove siete?" (vedi public/ludi-map3d-portal.js): stand evidenziato, orbita, super trasparenza, switch 3D/2D.
 *   - Header compatto: stessa testata viola e sticky del gestionale (versione ristretta) con il logo del portale espositore.
 *
 *   GET /api/map3d/zone/p-<token>   dati 3D della zona dell'espositore. Valido solo con un portale attivo (token + portal_enabled = 1).
 *                                   Degli altri stand non esce ne il nome ne l'id reale: solo la forma, per disegnarli in grigio.
 *
 * Come per la mappa pubblica non si modificano ne routes/portale.js ne portale.ejs: la pagina viene ritoccata mentre viene inviata
 * (importmap di three.js e stile dell'header nel head, header sostituito, script in fondo).
 * Per disattivare: togliere la riga che carica questo file in routes/map3d-public.js.
 */
const V = Date.now().toString(36);

module.exports = function registerMap3dPortal(app, db, mw) {
  const all = (sql, p) => new Promise((ok, ko) => db.all(sql, p || [], (e, r) => (e ? ko(e) : ok(r || []))));
  const get = (sql, p) => new Promise((ok, ko) => db.get(sql, p || [], (e, r) => (e ? ko(e) : ok(r))));
  const parseShape = (v) => { if (!v) return null; try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch (_) { return null; } };

  // registra una rotta e la sposta davanti alla prima rotta con lo stesso percorso (le rotte esistenti rispondono per prime)
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

  inFront(() => {
    app.get('/api/map3d/zone/:zoneId', async (req, res, next) => {
      const zid = String(req.params.zoneId || '');
      if (zid.indexOf('p-') !== 0) return next();
      res.set('Cache-Control', 'no-store');
      try {
        const g = await get('SELECT id, name, stand_code, zone FROM assignment_groups WHERE portal_token = ? AND portal_enabled = 1', [zid.slice(2)]);
        if (!g || !g.zone) return res.status(404).json({ error: 'Portale non disponibile' });
        const z = await get('SELECT * FROM zones WHERE name = ? LIMIT 1', [g.zone]);
        if (!z) return res.status(404).json({ error: 'Zona non trovata' });
        const cfg = (await get('SELECT * FROM map_test_zone WHERE zone = ?', [z.name])) || {};
        const rows = await all('SELECT * FROM map_test_layout WHERE zone = ?', [z.name]);
        if (!rows.some((l) => l.group_id === g.id)) return res.status(404).json({ error: 'Stand non posizionato in 3D' });
        let n = 0;
        const stands = rows.map((l) => {
          const obj = l.kind === 'obj' || l.group_id < 0;
          const own = l.group_id === g.id;
          return {
            id: own ? g.id : (obj ? l.group_id : -1000000 - (n++)),
            name: own ? g.name : (obj ? (l.label || 'Oggetto') : ''),
            code: own ? (g.stand_code || '') : '', kind: obj ? 'obj' : 'stand',
            fx: l.fx, fy: l.fy, wf: l.wf, df: l.df, rot: l.rot || 0, shape: parseShape(l.shape),
            h: l.height || 2.5, elev: l.elev || 0, model: l.model || null, color: own ? (l.color || null) : null,
            lscale: l.lscale || 1, lrot: l.lrot || 0, notes: '',
          };
        });
        const set = {};
        try { (await all(`SELECT key, value FROM map_test_setting WHERE key IN ('lbl_color','lbl_outline')`)).forEach((r) => { set[r.key] = r.value; }); } catch (_) { /* predefiniti */ }
        res.json({
          ownId: g.id,
          zone: { id: z.id, name: z.name, bg: z.background_image || null, refW: z.map_ref_w || null, refH: z.map_ref_h || null, widthM: cfg.width_m || null, outdoor: cfg.outdoor ? 1 : 0 },
          stands, settings: set,
        });
      } catch (e) { console.error('[map3d-portal]', e.message); res.status(500).json({ error: 'Errore interno' }); }
    });
  }, '/api/map3d/zone/:zoneId');

  const imap = JSON.stringify({ imports: { three: 'https://unpkg.com/three@0.160.0/build/three.module.js', 'three/addons/': 'https://unpkg.com/three@0.160.0/examples/jsm/' } });

  // header compatto: stessa testata viola del gestionale nella versione ristretta (64px, 52px su telefono), fissa in alto
  const hdrCss = `<style>
.pt-sticky{position:sticky;top:0;z-index:30}
.pt-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0 1.5rem;min-height:64px;background:linear-gradient(135deg,#4c2c78 0%,#6b3fa0 45%,#8b5cc0 100%);box-shadow:0 4px 14px rgba(30,20,60,.25)}
.pt-logo{display:block;height:64px;width:auto;max-width:72%;object-fit:contain;object-position:left center;filter:drop-shadow(0 3px 6px rgba(0,0,0,.3))}
.pt-right{font-size:.74rem;color:#f0e6ff;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35)}
@media (max-width:640px){.pt-bar{min-height:52px;padding:0 .75rem}.pt-logo{height:52px}.pt-right{display:none}}
</style>`;
  const hdrHtml = `<div class="pt-sticky"><header class="pt-bar"><img src="/logo-portale-espositore.png" alt="Ludicomix - Portale Espositore" class="pt-logo"><div class="pt-right">&#128274; Accesso riservato &middot; Non condividere questo link</div></header></div>`;
  const HDR_RE = /<header\b[^>]*\bclass=["']topbar["'][^>]*>[\s\S]*?<\/header>/;

  const head = `<script type='importmap'>${imap}</script>${hdrCss}`;
  const tag = `<script src='/ludi-map3d-portal.js?v=${V}' defer></script>`;
  inFront(() => {
    app.get('/portale/:token', (req, res, next) => {
      const render = res.render.bind(res);
      res.render = (view, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = undefined; }
        return render(view, opts || {}, (err, html) => {
          if (err) { if (cb) return cb(err); return next(err); }
          let out = html;
          try {
            out = out.includes('</head>') ? out.replace('</head>', () => head + '</head>') : head + out;
            out = out.replace(HDR_RE, () => hdrHtml);
            const i = out.lastIndexOf('</body>');
            out = i === -1 ? out + tag : out.slice(0, i) + tag + out.slice(i);
          } catch (_) { out = html; }
          if (cb) return cb(null, out);
          res.send(out);
        });
      };
      next();
    });
  }, '/portale/:token');
};
