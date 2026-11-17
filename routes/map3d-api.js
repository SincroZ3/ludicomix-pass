/**
 * routes/map3d-api.js
 * Fase 2 del passaggio al 3D: dati per la vista 3D di sola lettura (public/ludi-map3d-view.js) e pagina di prova.
 *
 *   GET /api/map3d/zone/:zoneId   layout 3D della zona (stand, oggetti, scala, sfondo). Stessa regola di accesso di /api/mappa-stand:
 *                                 pubblico solo se la zona ha la mappa stand pubblica attiva (zones.stand_map_public = 1), altrimenti solo admin.
 *   GET /mappa-3d/:zoneId         pagina di prova della vista 3D (solo admin). Con ?focus=<id stand>: evidenzia lo stand, gli altri in grigio, rotazione lenta.
 *
 * Sola lettura: nessuna scrittura sul DB. Le informazioni e gli eventi degli stand restano quelli di /api/mappa-stand/:zoneId (integrazione nella fase 3).
 */
const ASSET_V = Date.now().toString(36);

module.exports = function registerMap3dApi(app, db, mw) {
  const { requireAuth, requireAdmin } = mw;
  const all = (sql, p) => new Promise((ok, ko) => db.all(sql, p || [], (e, r) => (e ? ko(e) : ok(r || []))));
  const get = (sql, p) => new Promise((ok, ko) => db.get(sql, p || [], (e, r) => (e ? ko(e) : ok(r))));
  const isAdmin = (req) => !!(req.session && req.session.user && req.session.user.role === 'admin');
  const parseShape = (v) => { if (!v) return null; try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch (_) { return null; } };

  app.get('/api/map3d/zone/:zoneId', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const id = parseInt(req.params.zoneId, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Zona non valida' });
      const z = await get('SELECT * FROM zones WHERE id = ?', [id]);
      if (!z) return res.status(404).json({ error: 'Zona non trovata' });
      if (!(Number(z.stand_map_public) === 1 || isAdmin(req))) return res.status(403).json({ error: 'Mappa non pubblica' });
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
      try { (await all(`SELECT key, value FROM app_settings WHERE key IN ('lbl_color','lbl_outline')`)).forEach((r) => { set[r.key] = r.value; }); } catch (_) { /* predefiniti */ }
      res.json({
        zone: { id: z.id, name: z.name, bg: z.background_image || null, refW: z.map_ref_w || null, refH: z.map_ref_h || null, widthM: cfg.width_m || null, outdoor: cfg.outdoor ? 1 : 0 },
        stands, settings: set,
      });
    } catch (e) { console.error('[map3d-api]', e.message); res.status(500).json({ error: 'Errore interno' }); }
  });

  app.get('/mappa-3d/:zoneId', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.zoneId, 10);
    if (isNaN(id)) return res.status(400).send('Zona non valida');
    const imap = JSON.stringify({ imports: { three: 'https://unpkg.com/three@0.160.0/build/three.module.js', 'three/addons/': 'https://unpkg.com/three@0.160.0/examples/jsm/' } });
    res.send(`<!doctype html><html lang='it'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Mappa 3D - prova</title>
      <style>body{font:14px system-ui,sans-serif;margin:0;background:#f4f1fa;color:#2b1d4d}main{max-width:1200px;margin:0 auto;padding:.8rem}h1{font-size:1.1rem;margin:.2rem 0 .6rem}
      #vw{height:72vh;min-height:360px;border-radius:14px;overflow:hidden;background:linear-gradient(#e9e2f6,#f6f3fb);border:1px solid #ece6f7}
      #info{margin-top:.7rem;background:#fff;border:1px solid #ece6f7;border-radius:12px;padding:.7rem .9rem}</style>
      <script type='importmap'>${imap}</script></head><body><main>
      <h1>Mappa 3D - prova (zona ${id}) &middot; <a href='/mappa-stand/${id}'>vedi la mappa 2D</a></h1>
      <div id='vw'></div><div id='info'>Tocca uno stand per vedere i dettagli.</div></main>
      <script type='module'>
        import { createMap3D } from '/ludi-map3d-view.js?v=${ASSET_V}';
        const info = document.getElementById('info'), q = new URLSearchParams(location.search), f = q.get('focus');
        const m = await createMap3D(document.getElementById('vw'), {
          zoneId: ${id}, env: true, menu: true, focusId: f ? Number(f) : null, rotate: !!f, clickable: f ? 'focus' : 'all',
          onSelect: (sid, s) => { info.textContent = s ? s.name + (s.code ? ' - ' + s.code : '') + (s.notes ? ' - ' + s.notes : '') : 'Tocca uno stand per vedere i dettagli.'; },
        });
        if (!m) info.textContent = 'Vista 3D non disponibile: usa la mappa 2D.';
      </script></body></html>`);
  });
};
