/**
 * routes/mappa.js
 * ────────────────────────────────────────────────────────────────────────
 * Mappa interattiva interna, gestione zone, posizionamento stand.
 *
 * Route registrate:
 *   GET  /mappa
 *   GET  /zone-bg/:filename
 *   POST /admin/zones
 *   POST /admin/zones/:id/edit
 *   POST /admin/zones/:id/delete
 *   POST /admin/zones/:id/set-scope
 *   POST /admin/zones/:id/upload-bg
 *   POST /admin/zones/:id/delete-bg
 *   GET  /admin/zone-manager
 *   POST /admin/mappa-pubblica/zone/new
 *   POST /admin/mappa-pubblica/zone/:id
 *   POST /admin/groups/:id/map-position
 *   POST /admin/groups/:id/map-xy
 *   GET  /admin/mappatest            (pagina di prova 3D, solo admin)
 *   POST /admin/mappatest/...        (salvataggi della pagina di prova)
 * ────────────────────────────────────────────────────────────────────────
 */

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');

// Versione degli asset UI della mappa: cambia ad ogni avvio del server per evitare la cache.
const MAPPA_ASSET_V = Date.now().toString(36);

module.exports = function registerMappaRoutes(
  app, db,
  { requireAuth, requireAdmin, requireOrganizer, requireNotViewer, logAction, edFilter }
) {
  const DATA_DIR = process.env.DATA_DIR || __dirname.replace('/routes', '');

  // ── Multer per upload background zone ───────────────────────────────
  const bgUpload = multer({
    dest: path.join(DATA_DIR, 'generated'),
    fileFilter: (_req, file, cb) => cb(null, /image\//.test(file.mimetype)),
  });

  // ── Serve file background ────────────────────────────────────────────────────
  app.get('/zone-bg/:filename', (req, res) => {
    res.sendFile(path.join(DATA_DIR, 'generated', path.basename(req.params.filename)));
  });

  // ── Pagina mappa interna ───────────────────────────────────────────────────────
  app.get('/mappa', requireAuth, (req, res) => {
    db.all(
      "SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal') ORDER BY sort_order, name",
      [],
      (err, zones) => {
        if (err) return res.status(500).send('Errore DB');
        // edFilterMappa: include stand dell'edizione corrente + stand senza edizione (edition_id IS NULL)
        // Necessario per mostrare stand creati prima del sistema multi-edizione
        const edFilterMappa = () => {
          const cur = edFilter();
          if (!cur) return '';
          // Estrai l'id dall'edFilter: "AND ag.edition_id = X" → aggiungi OR IS NULL
          return cur.replace(/AND ag\.edition_id = (\d+)/, 'AND (ag.edition_id = $1 OR ag.edition_id IS NULL)');
        };
        db.all(
          `SELECT ag.id, ag.name AS stand_name, ag.stand_name AS stand_loc, ag.stand_code,
                  ag.zone, ag.map_x, ag.map_y, ag.map_w, ag.map_h, ag.map_shape, ag.map_rot,
                  ag.max_passes, ag.notes,
                  COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END) AS pass_count,
                  SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati
           FROM assignment_groups ag
           LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
           LEFT JOIN passes p ON p.participant_id = pa.id
           WHERE (1=1) ${edFilterMappa()}
           GROUP BY ag.id ORDER BY ag.zone, ag.name`,
          [],
          (err2, groups) => {
            if (err2) return res.status(500).send('Errore DB');
            // Render con inserimento degli asset UI (ludi-mappa.css/js). Se qualcosa non va la pagina resta quella di prima.
            // Per annullare: sostituire il render con callback con res.render('mappa', {...}).
            res.render('mappa', {
              zones:    zones  || [],
              groups:   groups || [],
              isAdmin:  !!(req.session.user?.role === 'admin'),
              canEdit:  !!(req.session.user?.role !== 'viewer'),
            }, (rErr, html) => {
              if (rErr) {
                console.error('[mappa] render', rErr.message);
                return res.status(500).send('Errore interno');
              }
              try {
                let out = html;
                const css = '<link rel="stylesheet" href="/ludi-mappa.css?v=' + MAPPA_ASSET_V + '">';
                out = out.includes('</head>') ? out.replace('</head>', () => css + '</head>') : css + out;
                const tag = '<script src="/ludi-mappa.js?v=' + MAPPA_ASSET_V + '" defer></script>';
                const i = out.lastIndexOf('</body>');
                out = i === -1 ? out + tag : out.slice(0, i) + tag + out.slice(i);
                res.send(out);
              } catch (e) {
                console.error('[mappa] assets', e.message);
                res.send(html);
              }
            });
          }
        );
      }
    );
  });

  // ── Crea zona interna ────────────────────────────────────────────────────────
  app.post('/admin/zones', requireAuth, requireOrganizer, (req, res) => {
    const { name, sort_order } = req.body;
    if (!name?.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      "INSERT INTO zones (name, sort_order, zone_scope) VALUES (?, ?, 'internal')",
      [name.trim(), parseInt(sort_order || 0, 10)],
      function (err) {
        if (err) {
          if (err.message?.includes('UNIQUE')) return res.status(400).send('Zona già esistente');
          return res.status(500).send('Errore salvataggio zona');
        }
        logAction(req.session.user.id, 'create_zone', 'zone', this.lastID, 'Creata zona: ' + name.trim());
        res.redirect('/admin/settings#zone');
      }
    );
  });

  // ── Modifica zona ─────────────────────────────────────────────────────────
  app.post('/admin/zones/:id/edit', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, sort_order } = req.body;
    if (!name?.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      'UPDATE zones SET name=?, sort_order=? WHERE id=?',
      [name.trim(), parseInt(sort_order || 0, 10), id],
      (err) => {
        if (err) return res.status(500).send('Errore aggiornamento zona');
        logAction(req.session.user.id, 'edit_zone', 'zone', id, 'Zona aggiornata: ' + name.trim());
        res.redirect('/admin/settings#zone');
      }
    );
  });

  // ── Elimina zona ─────────────────────────────────────────────────────────
  app.post('/admin/zones/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM zones WHERE id=?', [id], (err) => {
      if (err) return res.status(500).send('Errore eliminazione zona');
      logAction(req.session.user.id, 'delete_zone', 'zone', id, 'Zona eliminata');
      res.redirect('/admin/settings#zone');
    });
  });

  // ── Cambia scope zona (internal / public / both) ─────────────────────────
  app.post('/admin/zones/:id/set-scope', requireAuth, requireOrganizer, (req, res) => {
    const id          = parseInt(req.params.id, 10);
    const { zone_scope } = req.body;
    if (!['internal', 'public', 'both'].includes(zone_scope)) {
      return res.status(400).send('Scope non valido');
    }
    db.run('UPDATE zones SET zone_scope=? WHERE id=?', [zone_scope, id], (err) => {
      if (err) return res.status(500).send('Errore aggiornamento scope');
      res.redirect('/admin/zone-manager?flash=Scope+aggiornato');
    });
  });

  // ── Upload sfondo zona ──────────────────────────────────────────────────
  app.post('/admin/zones/:id/upload-bg', requireAuth, requireAdmin, bgUpload.single('bg_image'), (req, res) => {
    const zoneId = parseInt(req.params.id, 10);
    if (!req.file) return res.redirect('/mappa');
    const ext     = (req.file.originalname.match(/\.\w+$/) || ['.jpg'])[0].toLowerCase();
    const newName = `zone-bg-${zoneId}-${Date.now()}${ext}`;
    const newPath = path.join(DATA_DIR, 'generated', newName);

    db.get('SELECT background_image FROM zones WHERE id=?', [zoneId], (_e, row) => {
      if (row?.background_image) {
        try { fs.unlinkSync(path.join(DATA_DIR, 'generated', row.background_image)); } catch (_) {}
      }
      fs.renameSync(req.file.path, newPath);
      db.run('UPDATE zones SET background_image=? WHERE id=?', [newName, zoneId], () => res.redirect('/mappa'));
    });
  });

  // ── Rimuovi sfondo zona ───────────────────────────────────────────────────
  app.post('/admin/zones/:id/delete-bg', requireAuth, requireAdmin, (req, res) => {
    const zoneId = parseInt(req.params.id, 10);
    db.get('SELECT background_image FROM zones WHERE id=?', [zoneId], (_e, row) => {
      if (row?.background_image) {
        try { fs.unlinkSync(path.join(DATA_DIR, 'generated', row.background_image)); } catch (_) {}
      }
      db.run('UPDATE zones SET background_image=NULL WHERE id=?', [zoneId], () => res.redirect('/mappa'));
    });
  });

  // ── Zone manager (mappa pubblica) ────────────────────────────────────────
  app.get('/admin/zone-manager', requireAuth, requireOrganizer, (req, res) => {
    db.all('SELECT * FROM zones ORDER BY sort_order, name', [], (err, zones) => {
      if (err) return res.status(500).send('Errore DB zone');
      res.render('zone_manager', { zones: zones || [], flash: req.query.flash || null, currentUser: req.session.user });
    });
  });

  app.post('/admin/mappa-pubblica/zone/new', requireAuth, requireOrganizer, (req, res) => {
    const { name, map_label, map_type, map_lat, map_lng, map_zoom,
            map_desc, map_address, map_tags, map_color, sort_order } = req.body;
    if (!name?.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      "INSERT INTO zones (name, sort_order, map_label, map_type, map_lat, map_lng, map_zoom, map_desc, map_address, map_tags, map_color, map_active, zone_scope) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'public')",
      [name.trim(), parseInt(sort_order || 0, 10), map_label || null, map_type || 'area',
       map_lat ? parseFloat(map_lat) : null, map_lng ? parseFloat(map_lng) : null,
       parseInt(map_zoom || 16, 10), map_desc || null, map_address || null, map_tags || null, map_color || null],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio zona mappa: ' + err.message);
        logAction(req.session.user.id, 'create_public_zone', 'zone', this.lastID, 'Creata zona pubblica: ' + name.trim());
        res.redirect('/admin/zone-manager?flash=created');
      }
    );
  });

  app.post('/admin/mappa-pubblica/zone/:id', requireAuth, requireOrganizer, (req, res) => {
    const id     = parseInt(req.params.id, 10);
    const action = req.body._action || 'save';
    if (action === 'delete') {
      db.run("DELETE FROM zones WHERE id=? AND zone_scope='public'", [id], (err) => {
        if (err) return res.status(500).send('Errore eliminazione zona mappa');
        logAction(req.session.user.id, 'delete_public_zone', 'zone', id, 'Zona mappa pubblica eliminata');
        res.redirect('/admin/zone-manager?flash=deleted');
      });
    } else {
      const { name, map_label, map_type, map_lat, map_lng, map_zoom,
              map_desc, map_address, map_tags, map_color, map_active, sort_order } = req.body;
      db.run(
        "UPDATE zones SET name=?,sort_order=?,map_label=?,map_type=?,map_lat=?,map_lng=?,map_zoom=?,map_desc=?,map_address=?,map_tags=?,map_color=?,map_active=? WHERE id=? AND zone_scope='public'",
        [name, parseInt(sort_order || 0, 10), map_label || null, map_type || 'area',
         map_lat ? parseFloat(map_lat) : null, map_lng ? parseFloat(map_lng) : null,
         parseInt(map_zoom || 16, 10), map_desc || null, map_address || null,
         map_tags || null, map_color || null, map_active ? 1 : 0, id],
        (err) => {
          if (err) return res.status(500).send('Errore aggiornamento zona mappa');
          logAction(req.session.user.id, 'edit_public_zone', 'zone', id, 'Zona mappa pubblica aggiornata');
          res.redirect('/admin/zone-manager?flash=saved');
        }
      );
    }
  });

  // ── Posizione griglia stand (legacy) ───────────────────────────────────────
  app.post('/admin/groups/:id/map-position', requireAuth, requireNotViewer, (req, res) => {
    const id   = parseInt(req.params.id, 10);
    const row  = parseInt(req.body.map_row,  10) || null;
    const col  = parseInt(req.body.map_col,  10) || null;
    const span = Math.max(1, Math.min(8, parseInt(req.body.map_span, 10) || 1));
    db.run('UPDATE assignment_groups SET map_row=?,map_col=?,map_span=? WHERE id=?', [row, col, span, id],
      (err) => res.json(err ? { error: err.message } : { ok: true })
    );
  });

  // ── Posizione XY drag&drop stand ───────────────────────────────────────────
  app.post('/admin/groups/:id/map-xy', requireAuth, requireNotViewer, (req, res) => {
    const id   = parseInt(req.params.id, 10);
    const toF  = (v) => (v !== '' && v != null) ? parseFloat(v)  : null;
    const toI  = (v) => (v !== '' && v != null) ? parseInt(v, 10) : null;

    const x    = toF(req.body.map_x);
    const y    = toF(req.body.map_y);
    const w    = toF(req.body.map_w);
    const h    = toF(req.body.map_h);
    const rot  = toF(req.body.map_rot);
    const shape = (req.body.map_shape?.trim()) || null;
    const refW  = toI(req.body.ref_w);
    const refH  = toI(req.body.ref_h);

    let fields = 'map_x=?,map_y=?';
    const params = [x, y];
    if (w    !== null) { fields += ',map_w=?';     params.push(w); }
    if (h    !== null) { fields += ',map_h=?';     params.push(h); }
    if (req.body.map_shape !== undefined) { fields += ',map_shape=?'; params.push(shape); }
    if (rot  !== null) { fields += ',map_rot=?';   params.push(rot); }
    params.push(id);

    db.run('UPDATE assignment_groups SET ' + fields + ' WHERE id=?', params, (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      // Salva refW/refH sulla zona dello stand (per allineamento mappa pubblica)
      if (refW && refH && x !== null) {
        db.get('SELECT zone FROM assignment_groups WHERE id=?', [id], (_e, ag) => {
          if (ag?.zone) {
            db.run(
              'UPDATE zones SET map_ref_w=?, map_ref_h=? WHERE name=?',
              [refW, refH, ag.zone],
              () => {}
            );
          }
        });
      }
      res.json({ ok: true });
    });
  });

  // ═══ MAPPA TEST 3D — pagina di prova su /admin/mappatest (solo admin) ═════════════════════════
  // I dati stanno in tabelle separate (map_test_layout, map_test_zone):
  // la mappa reale (assignment_groups.map_*) non viene mai scritta da queste rotte.
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS map_test_layout (
      group_id INTEGER PRIMARY KEY, zone TEXT, fx REAL, fy REAL, wf REAL, df REAL,
      rot REAL DEFAULT 0, shape TEXT, height REAL DEFAULT 2.5, locked INTEGER DEFAULT 0, updated_at TEXT)`,
      (e) => { if (e) console.error('[mappatest] tabella layout', e.message); });
    db.run(`CREATE TABLE IF NOT EXISTS map_test_zone (zone TEXT PRIMARY KEY, width_m REAL)`,
      (e) => { if (e) console.error('[mappatest] tabella zone', e.message); });
  });

  app.get('/admin/mappatest', requireAuth, requireAdmin, (req, res) => {
    db.all("SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal') ORDER BY sort_order, name", [], (e1, zones) => {
      if (e1) return res.status(500).send('Errore DB');
      const cur = edFilter ? edFilter() : '';
      const f = cur ? cur.replace(/AND ag\.edition_id = (\d+)/, 'AND (ag.edition_id = $1 OR ag.edition_id IS NULL)') : '';
      db.all(
        `SELECT ag.id, ag.name AS stand_name, ag.stand_code, ag.zone, ag.map_x, ag.map_y, ag.notes,
                COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END) AS pass_count,
                SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati
         FROM assignment_groups ag
         LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
         LEFT JOIN passes p ON p.participant_id = pa.id
         WHERE (1=1) ${f}
         GROUP BY ag.id ORDER BY ag.zone, ag.name`,
        [],
        (e2, groups) => {
          if (e2) return res.status(500).send('Errore DB');
          db.all('SELECT * FROM map_test_layout', [], (e3, lays) => {
            db.all('SELECT * FROM map_test_zone', [], (e4, zset) => {
              const byG = {};
              (lays || []).forEach((l) => { byG[l.group_id] = l; });
              const wBy = {};
              (zset || []).forEach((z) => { wBy[z.zone] = z.width_m; });
              const data = {
                zones: (zones || []).map((z) => ({
                  id: z.id, name: z.name, bg: z.background_image || null,
                  refW: z.map_ref_w || null, refH: z.map_ref_h || null, widthM: wBy[z.name] || null,
                })),
                stands: (groups || []).map((g) => {
                  const l = byG[g.id];
                  let shape = null;
                  if (l && l.shape) { try { shape = JSON.parse(l.shape); } catch (_) { shape = null; } }
                  return {
                    id: g.id, name: g.stand_name, zone: g.zone || null, code: g.stand_code || '',
                    pc: g.pass_count || 0, cs: g.consegnati || 0, notes: g.notes || '',
                    importable: g.map_x != null && g.map_y != null,
                    L: l ? { fx: l.fx, fy: l.fy, wf: l.wf, df: l.df, rot: l.rot || 0, shape, h: l.height || 2.5, locked: l.locked ? 1 : 0 } : null,
                  };
                }),
              };
              res.render('mappa-test', { data, assetV: MAPPA_ASSET_V });
            });
          });
        }
      );
    });
  });

  // Salva posizione/forma/altezza (rifiuta se lo stand e' bloccato)
  app.post('/admin/mappatest/layout/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const num = (v) => (v !== '' && v != null && isFinite(+v)) ? +v : null;
    const fx = num(b.fx), fy = num(b.fy), wf = num(b.wf), df = num(b.df);
    if ([fx, fy, wf, df].some((v) => v === null) || wf <= 0 || df <= 0) return res.status(400).json({ ok: false, error: 'dati non validi' });
    const rot = num(b.rot) || 0;
    const h = Math.max(0.2, Math.min(12, num(b.height) || 2.5));
    let shape = null;
    if (Array.isArray(b.shape) && b.shape.length >= 3 && b.shape.every((p) => Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]))) {
      shape = JSON.stringify(b.shape.map((p) => [+p[0], +p[1]]));
    }
    db.get('SELECT locked FROM map_test_layout WHERE group_id=?', [id], (e, row) => {
      if (e) return res.status(500).json({ ok: false, error: e.message });
      if (row && row.locked) return res.status(423).json({ ok: false, error: 'Stand bloccato' });
      db.run(
        `INSERT INTO map_test_layout (group_id, zone, fx, fy, wf, df, rot, shape, height, locked, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,0,datetime('now','localtime'))
         ON CONFLICT(group_id) DO UPDATE SET zone=excluded.zone, fx=excluded.fx, fy=excluded.fy, wf=excluded.wf, df=excluded.df,
           rot=excluded.rot, shape=excluded.shape, height=excluded.height, updated_at=excluded.updated_at`,
        [id, String(b.zone || ''), fx, fy, wf, df, rot, shape, h],
        (err) => res.json(err ? { ok: false, error: err.message } : { ok: true })
      );
    });
  });

  // Blocca / sblocca uno stand
  app.post('/admin/mappatest/layout/:id/lock', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const v = req.body && +req.body.locked ? 1 : 0;
    db.run('UPDATE map_test_layout SET locked=? WHERE group_id=?', [v, id], function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      if (!this.changes) return res.status(404).json({ ok: false, error: 'Stand non presente in pianta' });
      res.json({ ok: true });
    });
  });

  // Rimuove uno stand dalla pianta di test (rifiuta se bloccato)
  app.post('/admin/mappatest/layout/:id/remove', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM map_test_layout WHERE group_id=? AND locked=0', [id], function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      if (!this.changes) return res.status(423).json({ ok: false, error: 'Stand bloccato o non presente' });
      res.json({ ok: true });
    });
  });

  // Scala reale della zona (larghezza della pianta in metri)
  app.post('/admin/mappatest/zone-scale', requireAuth, requireAdmin, (req, res) => {
    const zone = String((req.body && req.body.zone) || '');
    const w = Math.max(10, Math.min(500, +(req.body && req.body.width_m) || 0));
    if (!zone || !w) return res.status(400).json({ ok: false, error: 'dati non validi' });
    db.run('INSERT INTO map_test_zone (zone, width_m) VALUES (?,?) ON CONFLICT(zone) DO UPDATE SET width_m=excluded.width_m', [zone, w],
      (err) => res.json(err ? { ok: false, error: err.message } : { ok: true }));
  });

  // Blocca / sblocca tutti gli stand di una zona
  app.post('/admin/mappatest/zone-lock', requireAuth, requireAdmin, (req, res) => {
    const zone = String((req.body && req.body.zone) || '');
    const v = req.body && +req.body.locked ? 1 : 0;
    if (!zone) return res.status(400).json({ ok: false, error: 'zona mancante' });
    db.run('UPDATE map_test_layout SET locked=? WHERE zone=?', [v, zone],
      (err) => res.json(err ? { ok: false, error: err.message } : { ok: true }));
  });

  // Importa le posizioni della mappa attuale nella tabella di test (non scrive sulla mappa reale, non tocca gli stand bloccati)
  app.post('/admin/mappatest/import', requireAuth, requireAdmin, (req, res) => {
    const zone = String((req.body && req.body.zone) || '');
    if (!zone) return res.status(400).json({ ok: false, error: 'zona mancante' });
    db.all(
      'SELECT id, map_x, map_y, map_w, map_h, map_shape, map_rot FROM assignment_groups WHERE zone=? AND map_x IS NOT NULL AND map_y IS NOT NULL',
      [zone],
      (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        let n = 0;
        const sql = `INSERT INTO map_test_layout (group_id, zone, fx, fy, wf, df, rot, shape, height, locked, updated_at)
          VALUES (?,?,?,?,?,?,?,?,2.5,0,datetime('now','localtime'))
          ON CONFLICT(group_id) DO UPDATE SET zone=excluded.zone, fx=excluded.fx, fy=excluded.fy, wf=excluded.wf, df=excluded.df,
            rot=excluded.rot, shape=excluded.shape, updated_at=excluded.updated_at WHERE map_test_layout.locked=0`;
        db.serialize(() => {
          (rows || []).forEach((r) => {
            let shape = null;
            if (r.map_shape) {
              try {
                const arr = JSON.parse(r.map_shape);
                if (Array.isArray(arr)) shape = JSON.stringify(arr.map((p) => [p[0] / 100, p[1] / 100]));
              } catch (_) { shape = null; }
            }
            db.run(sql, [r.id, zone, r.map_x / 100, r.map_y / 100, (r.map_w || 8) / 100, (r.map_h || 5) / 100, r.map_rot || 0, shape],
              function (e) { if (!e && this.changes) n++; });
          });
          db.run('SELECT 1', [], () => {
            try { logAction(req.session.user.id, 'mappatest_import', 'zone', null, 'Importate ' + n + ' posizioni in mappa test: ' + zone); } catch (_) {}
            res.json({ ok: true, imported: n });
          });
        });
      }
    );
  });

};
