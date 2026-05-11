/**
 * routes/mappa.js
 * ──────────────────────────────────────────────────────────────────
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
 * ──────────────────────────────────────────────────────────────────
 */

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');

module.exports = function registerMappaRoutes(
  app, db,
  { requireAuth, requireAdmin, requireOrganizer, requireNotViewer, logAction, edFilter }
) {
  const DATA_DIR = process.env.DATA_DIR || __dirname.replace('/routes', '');

  // ── Multer per upload background zone ───────────────────────────
  const bgUpload = multer({
    dest: path.join(DATA_DIR, 'generated'),
    fileFilter: (_req, file, cb) => cb(null, /image\//.test(file.mimetype)),
  });

  // ── Serve file background ────────────────────────────────────────
  app.get('/zone-bg/:filename', (req, res) => {
    res.sendFile(path.join(DATA_DIR, 'generated', path.basename(req.params.filename)));
  });

  // ── Pagina mappa interna ─────────────────────────────────────────
  app.get('/mappa', requireAuth, (req, res) => {
    db.all(
      "SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal') ORDER BY sort_order, name",
      [],
      (err, zones) => {
        if (err) return res.status(500).send('Errore DB');
        db.all(
          `SELECT ag.id, ag.name AS stand_name, ag.stand_name AS stand_loc, ag.stand_code,
                  ag.zone, ag.map_x, ag.map_y, ag.map_w, ag.map_h, ag.map_shape, ag.map_rot,
                  ag.max_passes, ag.notes,
                  COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END) AS pass_count,
                  SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati
           FROM assignment_groups ag
           LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
           LEFT JOIN passes p ON p.participant_id = pa.id
           WHERE (1=1) ${edFilter()}
           GROUP BY ag.id ORDER BY ag.zone, ag.name`,
          [],
          (err2, groups) => {
            if (err2) return res.status(500).send('Errore DB');
            res.render('mappa', {
              zones:    zones  || [],
              groups:   groups || [],
              isAdmin:  !!(req.session.user?.role === 'admin'),
              canEdit:  !!(req.session.user?.role !== 'viewer'),
            });
          }
        );
      }
    );
  });

  // ── Crea zona interna ────────────────────────────────────────────
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

  // ── Modifica zona ────────────────────────────────────────────────
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

  // ── Elimina zona ─────────────────────────────────────────────────
  app.post('/admin/zones/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM zones WHERE id=?', [id], (err) => {
      if (err) return res.status(500).send('Errore eliminazione zona');
      logAction(req.session.user.id, 'delete_zone', 'zone', id, 'Zona eliminata');
      res.redirect('/admin/settings#zone');
    });
  });

  // ── Cambia scope zona (internal / public / both) ─────────────────
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

  // ── Upload sfondo zona ───────────────────────────────────────────
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

  // ── Rimuovi sfondo zona ──────────────────────────────────────────
  app.post('/admin/zones/:id/delete-bg', requireAuth, requireAdmin, (req, res) => {
    const zoneId = parseInt(req.params.id, 10);
    db.get('SELECT background_image FROM zones WHERE id=?', [zoneId], (_e, row) => {
      if (row?.background_image) {
        try { fs.unlinkSync(path.join(DATA_DIR, 'generated', row.background_image)); } catch (_) {}
      }
      db.run('UPDATE zones SET background_image=NULL WHERE id=?', [zoneId], () => res.redirect('/mappa'));
    });
  });

  // ── Zone manager (mappa pubblica) ────────────────────────────────
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

  // ── Posizione griglia stand (legacy) ────────────────────────────
  app.post('/admin/groups/:id/map-position', requireAuth, requireNotViewer, (req, res) => {
    const id   = parseInt(req.params.id, 10);
    const row  = parseInt(req.body.map_row,  10) || null;
    const col  = parseInt(req.body.map_col,  10) || null;
    const span = Math.max(1, Math.min(8, parseInt(req.body.map_span, 10) || 1));
    db.run('UPDATE assignment_groups SET map_row=?,map_col=?,map_span=? WHERE id=?', [row, col, span, id],
      (err) => res.json(err ? { error: err.message } : { ok: true })
    );
  });

  // ── Posizione XY drag&drop stand ─────────────────────────────────
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

};
