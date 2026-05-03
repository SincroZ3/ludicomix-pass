/**
 * routes/settings.js
 * ──────────────────────────────────────────────────────────────────
 * Pannello impostazioni admin: gruppi, zone, utenti, SMTP, backup,
 * edizioni, finestra portali, logo QR, template auto-pass.
 * ──────────────────────────────────────────────────────────────────
 */

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const multer    = require('multer');
const nodemailer = require('nodemailer');
const { promisify } = require('util');

module.exports = function registerSettingsRoutes(
  app, db,
  { requireAuth, requireAdmin, requireOrganizer,
    logAction, edFilter, edVal, getCurrent, refreshCurrentEdition }
) {
  const DATA_DIR = process.env.DATA_DIR || __dirname.replace('/routes', '');

  const dbGet = promisify(db.get.bind(db));
  const dbAll = promisify(db.all.bind(db));
  function dbRun(sql, ...p) {
    return new Promise((resolve, reject) => {
      const params = p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // ── Upload memory (logo QR) ──────────────────────────────────────
  const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
  const uploadDisk   = multer({ dest: path.join(DATA_DIR, 'uploads', 'tmp') });

  // ── QR logo upload / remove ──────────────────────────────────────
  app.post('/admin/settings/qr-logo', requireAuth, requireAdmin, uploadMemory.single('qr_logo'), (req, res) => {
    if (!req.file) return res.status(400).send('File richiesto');
    const b64 = req.file.buffer.toString('base64');
    db.run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('qr_logo_b64',?)", [b64], (err) => {
      if (err) return res.status(500).send('Errore salvataggio logo QR');
      logAction(req.session.user.id, 'update_qr_logo', 'settings', null, 'Logo QR aggiornato');
      res.redirect('/admin/settings#tipologie');
    });
  });

  app.get('/admin/settings/qr-logo/remove', requireAuth, requireAdmin, (req, res) => {
    db.run("UPDATE app_settings SET value='' WHERE key='qr_logo_b64'", [], (err) => {
      if (err) return res.status(500).send('Errore rimozione logo QR');
      logAction(req.session.user.id, 'remove_qr_logo', 'settings', null, 'Logo QR rimosso');
      res.redirect('/admin/settings#tipologie');
    });
  });

  // ── Dashboard impostazioni ───────────────────────────────────────
  app.get('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [groups, types, zones, users, smtpRows, scanAttempts, apRows, portalGroups, editions] =
        await Promise.all([
          dbAll(`SELECT g.id, g.name, g.priority, g.pass_type_id, pt.name AS pass_type_name
                 FROM groups g LEFT JOIN pass_types pt ON pt.id=g.pass_type_id
                 ORDER BY g.priority ASC, g.name ASC`),
          dbAll('SELECT * FROM pass_types ORDER BY id DESC'),
          dbAll("SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal' OR zone_scope='both') ORDER BY sort_order, name"),
          dbAll('SELECT id, username, role, created_at FROM users ORDER BY username ASC'),
          dbAll("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'"),
          dbAll('SELECT sa.*, u.username FROM scan_attempts sa LEFT JOIN users u ON u.id=sa.user_id ORDER BY sa.id DESC LIMIT 500'),
          dbAll('SELECT * FROM app_settings'),
          dbAll(`SELECT ag.id, ag.name, ag.portal_open_from, ag.portal_open_until,
                 (SELECT COUNT(*) FROM participants WHERE assignment_group_id=ag.id) AS n_participants
                 FROM assignment_groups ag WHERE ag.portal_enabled=1 ${edFilter()} ORDER BY ag.name`),
          dbAll('SELECT * FROM editions ORDER BY year DESC'),
        ]);
      const smtp      = Object.fromEntries((smtpRows  || []).map(r => [r.key, r.value]));
      const apSettings = Object.fromEntries((apRows    || []).map(r => [r.key, r.value]));
      res.render('admin_settings', {
        groups, types, zones, users, smtp,
        scanAttempts:  scanAttempts  || [],
        apSettings,
        portalGroups:  portalGroups  || [],
        editions:      editions      || [],
      });
    } catch (err) {
      console.error('Errore /admin/settings:', err);
      res.status(500).send('Errore interno del server');
    }
  });

  // ── Finestra globale portali ─────────────────────────────────────
  app.get('/admin/settings/portal-window', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [apRows, groups] = await Promise.all([
        dbAll("SELECT key,value FROM app_settings WHERE key IN ('portal_window_from','portal_window_until')"),
        dbAll(`SELECT ag.id, ag.name, ag.portal_open_from, ag.portal_open_until,
               (SELECT COUNT(*) FROM participants WHERE assignment_group_id=ag.id) AS n_participants
               FROM assignment_groups ag WHERE ag.portal_enabled=1 ${edFilter()} ORDER BY ag.name`),
      ]);
      res.render('portal_window', {
        currentUser: req.session.user,
        pw:    Object.fromEntries((apRows || []).map(r => [r.key, r.value])),
        groups: groups || [],
        saved: req.query.saved === '1',
      });
    } catch (err) {
      console.error('[PortalWindow GET]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  app.post('/admin/settings/portal-window', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { portal_window_from, portal_window_until, apply_to_all } = req.body;
      const groupIds  = [].concat(req.body.group_ids || []).map(Number).filter(Boolean);
      const fromVal   = portal_window_from  || '';
      const untilVal  = portal_window_until || '';

      await dbRun("INSERT OR REPLACE INTO app_settings(key,value) VALUES('portal_window_from',?)",  [fromVal]);
      await dbRun("INSERT OR REPLACE INTO app_settings(key,value) VALUES('portal_window_until',?)", [untilVal]);

      if (apply_to_all === '1') {
        await dbRun(
          `UPDATE assignment_groups SET portal_open_from=?,portal_open_until=? WHERE portal_enabled=1 ${edFilter()}`,
          [fromVal || null, untilVal || null]
        );
        logAction(req.session.user.id, 'portal_window_all', 'settings', null,
          `Finestra portali globale: ${fromVal || '—'} → ${untilVal || '—'}`);
      } else if (groupIds.length > 0) {
        const ph = groupIds.map(() => '?').join(',');
        await dbRun(
          `UPDATE assignment_groups SET portal_open_from=?,portal_open_until=? WHERE id IN (${ph})`,
          [fromVal || null, untilVal || null, ...groupIds]
        );
        logAction(req.session.user.id, 'portal_window_select', 'settings', null,
          `Finestra portali aggiornata per ${groupIds.length} stand: ${fromVal || '—'} → ${untilVal || '—'}`);
      } else {
        logAction(req.session.user.id, 'portal_window_global', 'settings', null,
          `Finestra globale aggiornata: ${fromVal || '—'} → ${untilVal || '—'}`);
      }
      res.redirect('/admin/settings/portal-window?saved=1');
    } catch (err) {
      console.error('[PortalWindow POST]', err.message);
      res.status(500).send('Errore salvataggio finestra portali');
    }
  });

  // ── SMTP salva / test ────────────────────────────────────────────
  app.post('/admin/settings/smtp', requireAuth, requireAdmin, (req, res) => {
    const fields = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_to'];
    let done = 0;
    fields.forEach(k => {
      db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)', [k, req.body[k] || ''], () => {
        if (++done === fields.length) res.redirect('/admin/settings#notifiche');
      });
    });
  });

  app.post('/admin/settings/smtp-test', requireAuth, requireAdmin, (req, res) => {
    const c = req.body;
    if (!c.smtp_host || !c.smtp_to) return res.json({ ok: false, error: 'Host e destinatario obbligatori' });
    nodemailer.createTransport({
      host: c.smtp_host,
      port: parseInt(c.smtp_port || '587', 10),
      secure: c.smtp_secure === '1',
      auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
      tls: { rejectUnauthorized: false },
    }).sendMail({
      from:    c.smtp_from || 'noreply@ludicomix.it',
      to:      c.smtp_to,
      subject: '[Ludicomix] Test SMTP',
      html:    '<p>Test OK!</p>',
    }, (err) => res.json(err ? { ok: false, error: err.message } : { ok: true }));
  });

  // ── Backup / Restore DB ──────────────────────────────────────────
  app.get('/admin/backup', requireAuth, requireAdmin, (req, res) => {
    const tmpPath = path.join(os.tmpdir(), `ludicomix_backup_${Date.now()}.sqlite`);
    db.run(`VACUUM INTO '${tmpPath}'`, (err) => {
      if (err) return res.status(500).send('Errore backup: ' + err.message);
      res.download(tmpPath, 'ludicomix_backup.sqlite', () => { fs.unlink(tmpPath, () => {}); });
    });
  });

  app.post('/admin/restore', requireAuth, requireAdmin, uploadDisk.single('backup'), (req, res) => {
    if (!req.file) return res.status(400).send('Nessun file caricato');
    const buf = Buffer.alloc(16);
    let fd;
    try {
      fd = fs.openSync(req.file.path, 'r');
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).send('Impossibile leggere il file');
    }
    if (buf.toString('ascii', 0, 15) !== 'SQLite format 3') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).send('File non valido: non è un database SQLite');
    }
    const dbPath = db.dbPath;
    db.close((err) => {
      if (err) return res.status(500).send('Errore chiusura DB: ' + err.message);
      try {
        fs.copyFileSync(req.file.path, dbPath);
        fs.unlink(req.file.path, () => {});
      } catch (e) {
        return res.status(500).send('Errore sostituzione DB: ' + e.message);
      }
      res.send(`<!DOCTYPE html><html><body>
        <p style="font-family:sans-serif;padding:2rem">
          <strong>Database ripristinato.</strong> Il server si riavvierà tra 2 secondi…
        </p>
        <script>setTimeout(()=>location.href='/login',2500)<\/script>
        </body></html>`);
      setTimeout(() => process.exit(0), 1500);
    });
  });

  // ── Edizioni (multi-anno) ────────────────────────────────────────
  app.post('/admin/editions', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, year } = req.body;
      if (!name?.trim()) return res.redirect('/admin/settings?tab=edizioni&err=nome');
      const yearInt = parseInt(year, 10);
      if (!yearInt || isNaN(yearInt)) return res.redirect('/admin/settings?tab=edizioni&err=anno');
      await dbRun('INSERT INTO editions (name, year, is_current) VALUES (?,?,0)', [name.trim(), yearInt]);
      logAction(req.session.user.id, 'create_edition', 'edition', null, `Creata edizione: ${name.trim()}`);
      res.redirect('/admin/settings?tab=edizioni&saved=1');
    } catch (e) {
      res.redirect('/admin/settings?tab=edizioni&err=db');
    }
  });

  app.post('/admin/editions/:id/set-current', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await dbRun('UPDATE editions SET is_current=0');
      await dbRun('UPDATE editions SET is_current=1 WHERE id=?', [id]);
      if (typeof refreshCurrentEdition === 'function') {
        refreshCurrentEdition(() => {
          const cur = getCurrent();
          if (cur) db.run('UPDATE assignment_groups SET edition_id=? WHERE edition_id IS NULL', [cur.id]);
        });
      }
      logAction(req.session.user.id, 'set_current_edition', 'edition', id, 'Edizione corrente aggiornata');
      res.redirect('/admin/settings?tab=edizioni&saved=1');
    } catch (e) {
      res.redirect('/admin/settings?tab=edizioni&err=db');
    }
  });

  app.post('/admin/editions/:id/delete', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id  = parseInt(req.params.id, 10);
      const ed  = await dbGet('SELECT * FROM editions WHERE id=?', [id]);
      if (!ed) return res.redirect('/admin/settings?tab=edizioni&err=notfound');
      if (ed.is_current) return res.redirect('/admin/settings?tab=edizioni&err=current');
      const cnt = await dbGet('SELECT COUNT(*) AS n FROM assignment_groups WHERE edition_id=?', [id]);
      if (cnt?.n > 0) return res.redirect('/admin/settings?tab=edizioni&err=inuse');
      await dbRun('DELETE FROM editions WHERE id=?', [id]);
      logAction(req.session.user.id, 'delete_edition', 'edition', id, `Eliminata edizione ${ed.name}`);
      res.redirect('/admin/settings?tab=edizioni&saved=1');
    } catch (e) {
      res.redirect('/admin/settings?tab=edizioni&err=db');
    }
  });

  // ── Template auto-pass PDF ───────────────────────────────────────
  app.post('/admin/settings/auto-pass-template', requireAuth, requireAdmin,
    multer({ dest: path.join(DATA_DIR, 'uploads', 'tmp') }).single('auto_pass_template'),
    (req, res) => {
      if (!req.file) return res.status(400).send('File richiesto');
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.pdf') {
        fs.unlinkSync(req.file.path);
        return res.status(400).send('Solo file PDF');
      }
      const dest = path.join(DATA_DIR, 'templates', 'auto_pass_template.pdf');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(req.file.path, dest);
      fs.unlinkSync(req.file.path);
      db.run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('ap_template','auto_pass_template.pdf')", () => {
        logAction(req.session.user.id, 'upload_auto_pass_template', 'settings', 0, 'Template auto-pass aggiornato');
        res.redirect('/admin/settings?tab=auto_pass&saved=1');
      });
    }
  );

  // ── Coordinate PDF auto-pass ─────────────────────────────────────
  app.post('/admin/settings/auto-pass-coords', requireAuth, requireAdmin, (req, res) => {
    const keys = ['ap_esp_x','ap_esp_y','ap_esp_size','ap_num_x','ap_num_y','ap_tot_x','ap_tot_y','ap_qr_x','ap_qr_y','ap_qr_size'];
    let done = 0;
    keys.forEach(k => {
      if (req.body[k] !== undefined) {
        db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)', [k, parseInt(req.body[k], 10) || 0], () => {
          if (++done === keys.length) res.redirect('/admin/settings?tab=auto_pass&saved=1');
        });
      } else {
        if (++done === keys.length) res.redirect('/admin/settings?tab=auto_pass&saved=1');
      }
    });
  });

};
