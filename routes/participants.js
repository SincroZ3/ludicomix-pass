/**
 * routes/participants.js
 * ──────────────────────────────────────────────────────────────────
 * Gestione partecipanti, stand (assignment_groups), raggruppamenti,
 * import CSV/Excel, materiali, auto-passes generate.
 * ──────────────────────────────────────────────────────────────────
 */

const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const XLSX    = require('xlsx');
const bcrypt  = require('bcryptjs');
const { promisify } = require('util');

// ── Catalogo materiali (speculare al server originale) ───────────
const MATERIAL_CATALOG = {
  'Corrente elettrica': ['Presa singola 16A','Presa singola 10A','Prolunga','Multipresa'],
  'Arredi':             ['Tavolo 200x80','Tavolo 140x70','Sedia','Banco espositore','Ripiano a muro'],
  'Strutture':          ['Gazebo 3x3','Pannello divisorio','Barriera antiaffollamento'],
  'Segnaletica':        ['Banner 85x200','Porta-brochure','Totem'],
  'Altro':              [],
};

module.exports = function registerParticipantsRoutes(
  app, db,
  { requireAuth, requireAdmin, requireOrganizer, requireNotViewer,
    logAction, edFilter, edVal, getCurrent,
    createNotification, generateAutoPass }
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

  const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  // ── Elenco stand/partecipanti ────────────────────────────────────
  app.get('/participants', requireAuth, (req, res) => {
    db.all('SELECT * FROM groups ORDER BY priority, name', [], (err, categories) => {
      if (err) return res.status(500).send('Errore DB gruppi');
      db.all('SELECT * FROM pass_types ORDER BY name', [], (_e2, types) => {
        const sql = `
          SELECT ag.id, ag.name, ag.notes, ag.email, ag.group_id, ag.stand_name, ag.zone, ag.stand_code, ag.max_passes,
                 g.name AS category_name, g.priority AS category_priority,
                 COUNT(pa.id) AS participants_count
          FROM assignment_groups ag
          JOIN groups g ON g.id = ag.group_id
          LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
          WHERE (1=1) ${edFilter()}
          GROUP BY ag.id ORDER BY g.priority, LOWER(g.name), LOWER(ag.name)`;
        db.all(sql, [], (err3, assignmentGroups) => {
          if (err3) return res.status(500).send('Errore DB gruppi assegnatari');
          db.all("SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal') ORDER BY sort_order, name", [], (_e4, zones) => {
            res.render('participants', { categories: categories || [], types: types || [], assignmentGroups: assignmentGroups || [], zones: zones || [] });
          });
        });
      });
    });
  });

  // ── Crea nuovo stand ─────────────────────────────────────────────
  app.post('/assignment-groups', requireAuth, requireOrganizer, (req, res) => {
    const { name, group_id, stand_name, zone, stand_code, notes, max_passes, email } = req.body;
    if (!name || !group_id) return res.status(400).send('Nome gruppo e categoria obbligatori');
    const maxVal = max_passes && parseInt(max_passes, 10) > 0 ? parseInt(max_passes, 10) : null;
    db.run(
      'INSERT INTO assignment_groups (name, group_id, stand_name, zone, stand_code, max_passes, notes, email, edition_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [name, group_id, stand_name || null, zone || null, stand_code || null, maxVal, notes || null, email || null, edVal()],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio stand');
        logAction(req.session.user.id, 'create_assignment_group', 'assignment_group', this.lastID, `Creato gruppo ${name}`);
        res.redirect('/participants');
      }
    );
  });

  // ── Modifica stand ───────────────────────────────────────────────
  app.post('/assignment-groups/:id/edit', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, stand_name, zone, stand_code } = req.body;
    if (!name) return res.status(400).send('Nome gruppo obbligatorio');
    db.run(
      'UPDATE assignment_groups SET name=?,stand_name=?,zone=?,stand_code=? WHERE id=?',
      [name, stand_name || null, zone || null, stand_code || null, id],
      (err) => {
        if (err) return res.status(500).send('Errore aggiornamento gruppo');
        logAction(req.session.user.id, 'edit_assignment_group', 'assignment_group', id, 'Dati gruppo aggiornati');
        res.redirect('/assignment-groups/' + id);
      }
    );
  });

  // ── Profilo ospite ───────────────────────────────────────────────
  app.post('/assignment-groups/:id/guest-profile', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { bio, photo_url, category, website, social_instagram, sort_order, featured, active } = req.body;
    const vals = [bio||null, photo_url||null, category||null, website||null, social_instagram||null,
      parseInt(sort_order)||0, featured==='1'?1:0, active==='1'?1:0];
    db.get('SELECT ag.name, gp.id AS gp_id FROM assignment_groups ag LEFT JOIN guest_profiles gp ON gp.assignment_group_id=ag.id WHERE ag.id=?',
      [id], (err, row) => {
        if (err) return res.status(500).send('Errore lettura profilo ospite');
        const groupName = row?.name || '';
        const sql = row?.gp_id
          ? `UPDATE guest_profiles SET name=?,bio=?,photo_url=?,category=?,website=?,social_instagram=?,sort_order=?,featured=?,active=? WHERE assignment_group_id=?`
          : `INSERT INTO guest_profiles (assignment_group_id,name,bio,photo_url,category,website,social_instagram,sort_order,featured,active) VALUES (?,?,?,?,?,?,?,?,?,?)`;
        const params = row?.gp_id ? [groupName, ...vals, id] : [id, groupName, ...vals];
        db.run(sql, params, (err2) => {
          if (err2) return res.status(500).send('Errore salvataggio profilo ospite');
          logAction(req.session.user.id, 'edit_guest_profile', 'assignment_group', id, 'Profilo ospite aggiornato');
          res.redirect('/assignment-groups/' + id);
        });
      }
    );
  });

  // ── Elimina stand ────────────────────────────────────────────────
  app.post('/assignment-groups/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM assignment_groups WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione stand');
      if (this.changes > 0) logAction(req.session.user.id, 'delete_assignment_group', 'assignment_group', id, 'Stand eliminato');
      res.redirect('/participants');
    });
  });

  // ── Dettaglio stand ──────────────────────────────────────────────
  app.get('/assignment-groups/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get(
      `SELECT ag.*, g.name AS category_name, g.id AS category_id
       FROM assignment_groups ag JOIN groups g ON g.id=ag.group_id WHERE ag.id=?`,
      [id], (err, groupInfo) => {
        if (err || !groupInfo) return res.status(404).send('Stand non trovato');
        db.all('SELECT * FROM pass_types ORDER BY name', [], (_e2, types) => {
          db.all(
            `SELECT pa.*,
                    (SELECT status FROM passes WHERE participant_id=pa.id AND status!='INVALIDATO' ORDER BY id DESC LIMIT 1) AS last_status,
                    (SELECT id     FROM passes WHERE participant_id=pa.id AND status!='INVALIDATO' ORDER BY id DESC LIMIT 1) AS last_pass_id,
                    (SELECT code   FROM passes WHERE participant_id=pa.id AND status!='INVALIDATO' ORDER BY id DESC LIMIT 1) AS ref_code
             FROM participants pa WHERE pa.assignment_group_id=? ORDER BY pa.last_name, pa.first_name`,
            [id], (err3, participants) => {
              if (err3) return res.status(500).send('Errore DB partecipanti');
              db.all("SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal') ORDER BY sort_order,name", [], (_eZ, zones) => {
                db.all('SELECT * FROM auto_passes WHERE assignment_group_id=? ORDER BY pass_number', [id], (_eAP, autoPasses) => {
                  const crmQ = (sql, p) => new Promise((ok, ko) => db.all(sql, p, (e, r) => e ? ko(e) : ok(r)));
                  Promise.all([
                    crmQ('SELECT * FROM contacts        WHERE assignment_group_id=? ORDER BY is_primary DESC, name', [id]),
                    crmQ('SELECT * FROM payments        WHERE assignment_group_id=? ORDER BY created_at DESC', [id]),
                    crmQ('SELECT * FROM group_documents WHERE assignment_group_id=? ORDER BY uploaded_at DESC', [id]),
                    crmQ('SELECT * FROM guest_profiles  WHERE assignment_group_id=? LIMIT 1', [id]),
                    new Promise((ok, ko) => db.get('SELECT * FROM fiscal_data WHERE assignment_group_id=?', [id], (e, r) => e ? ko(e) : ok(r))),
                    crmQ('SELECT * FROM group_material_requests WHERE assignment_group_id=? ORDER BY category, item_name, id', [id]),
                    crmQ('SELECT * FROM logistic_categories ORDER BY sort_order, label', []),
                  ]).then(([contacts, payments, groupDocs, gpRows, fiscalData, materials, materialTypes]) => {
                    const PASS_STATUSES = ['IN_ATTESA', 'GENERATO', 'SCARICATO', 'STAMPATO', 'CONSEGNATO', 'RICONSEGNATO', 'INVALIDATO'];
                    res.render('assignment_group_detail', {
                      groupInfo, types: types || [], participants: participants || [],
                      PASS_STATUSES,
                      dupSkipped: parseInt(req.query.dup_skipped || 0),
                      dupTotal:   parseInt(req.query.dup_total   || 0),
                      zones:      zones || [],
                      importOk:   req.query.import_ok   ? parseInt(req.query.import_ok)   : null,
                      importSkip: req.query.import_skip ? parseInt(req.query.import_skip) : null,
                      importErrs: req.query.import_errs ? decodeURIComponent(req.query.import_errs).split('|') : [],
                      replaceOk:  req.query.replace_ok === '1',
                      autoPasses: autoPasses || [],
                      contacts, payments, groupDocs,
                      guestProfile: gpRows?.[0] || null,
                      fiscalData:   fiscalData || null,
                      materials:    materials  || [],
                      materialTypes: materialTypes || [],
                      MATERIAL_CATALOG: Object.fromEntries((materialTypes||[]).map(c => [c.key_name, { label: c.label, icon: c.icon||'📦' }])),
                    });
                  }).catch(e => { console.error('detail CRM catch:', e?.message); res.status(500).send('Errore CRM: ' + e?.message); });
                });
              });
            }
          );
        });
      }
    );
  });

  // ── Limite pass stand ────────────────────────────────────────────
  app.post('/assignment-groups/:id/limit', requireAuth, requireNotViewer, (req, res) => {
    const id   = parseInt(req.params.id, 10);
    const { max_passes, admin_password } = req.body;
    const newMax = max_passes ? parseInt(max_passes, 10) : null;
    const doUpdate = () => {
      db.run('UPDATE assignment_groups SET max_passes=? WHERE id=?', [newMax, id], (err) => {
        if (err) return res.status(500).send('Errore aggiornamento limite');
        logAction(req.session.user.id, 'update_assignment_group_limit', 'assignment_group', id, `Limite aggiornato a ${newMax ?? 'illimitato'}`);
        res.redirect('/assignment-groups/' + id);
      });
    };
    if (!admin_password) return doUpdate();
    db.all("SELECT * FROM users WHERE role='admin'", [], (err, admins) => {
      if (err || !admins?.length) return res.status(500).send('Errore verifica admin');
      const valid = admins.find(u => bcrypt.compareSync(admin_password, u.password_hash));
      if (!valid) return res.status(403).send('Password admin non valida');
      doUpdate();
    });
  });

  // ── Note stand ──────────────────────────────────────────────────
  app.post('/assignment-groups/:id/notes', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('UPDATE assignment_groups SET notes=? WHERE id=?', [req.body.notes || null, id], (err) => {
      if (err) return res.status(500).send('Errore salvataggio note');
      res.redirect('/assignment-groups/' + id);
    });
  });

  // ── Aggiungi partecipante ─────────────────────────────────────────
  app.post('/participants', requireAuth, requireNotViewer, (req, res) => {
    const { first_name, last_name, email, role, stand_name, zone, ref_code, notes, assignment_group_id, redirect_to_group } = req.body;
    if (!first_name || !last_name) return res.status(400).send('Nome e cognome obbligatori');
    const doInsert = () => {
      db.run(
        'INSERT INTO participants (first_name, last_name, email, role, stand_name, zone, ref_code, notes, assignment_group_id) VALUES (?,?,?,?,?,?,?,?,?)',
        [first_name, last_name, email||null, role||null, stand_name||null, zone||null, ref_code||null, notes||null, assignment_group_id||null],
        function (err) {
          if (err) return res.status(500).send('Errore salvataggio partecipante');
          logAction(req.session.user.id, 'create_participant', 'participant', this.lastID, `Creato partecipante ${first_name} ${last_name}`);
          if (redirect_to_group && assignment_group_id) return res.redirect('/assignment-groups/' + assignment_group_id);
          res.redirect('/participants');
        }
      );
    };
    if (assignment_group_id) {
      const gid = parseInt(assignment_group_id, 10);
      db.get('SELECT max_passes FROM assignment_groups WHERE id=?', [gid], (_e, ag) => {
        if (ag?.max_passes != null) {
          db.get('SELECT COUNT(*) AS cnt FROM participants WHERE assignment_group_id=?', [gid], (_e2, row) => {
            if (row && row.cnt >= ag.max_passes) return res.status(400).send('Limite massimo di pass per questo gruppo raggiunto.');
            doInsert();
          });
        } else { doInsert(); }
      });
    } else { doInsert(); }
  });

  // ── Check duplicati ──────────────────────────────────────────────
  app.post('/participants/check-duplicate', requireAuth, requireNotViewer, (req, res) => {
    const { first_name, last_name } = req.body;
    if (!first_name || !last_name) return res.json({ duplicates: [] });
    const fn = first_name.trim().toLowerCase(), ln = last_name.trim().toLowerCase();
    db.all(
      `SELECT p.id, p.first_name, p.last_name, ag.name AS group_name, g.name AS category_name,
              (SELECT status FROM passes WHERE participant_id=p.id ORDER BY id DESC LIMIT 1) AS last_status,
              (SELECT pt.name FROM passes ps JOIN pass_types pt ON pt.id=ps.pass_type_id WHERE ps.participant_id=p.id ORDER BY ps.id DESC LIMIT 1) AS pass_type_name
       FROM participants p
       LEFT JOIN assignment_groups ag ON ag.id=p.assignment_group_id
       LEFT JOIN groups g ON g.id=ag.group_id
       WHERE (LOWER(p.first_name)=? AND LOWER(p.last_name)=?) OR (LOWER(p.first_name)=? AND LOWER(p.last_name)=?)`,
      [fn, ln, ln, fn],
      (err, rows) => res.json(err ? { error: 'Errore DB' } : { duplicates: rows })
    );
  });

  // ── Bulk import textarea ─────────────────────────────────────────
  app.post('/participants/bulk-import', requireAuth, requireNotViewer, (req, res) => {
    const { names_list, assignment_group_id, force_over_limit, admin_password, new_max_passes } = req.body;
    if (!assignment_group_id) return res.status(400).json({ error: 'Gruppo non specificato' });
    const groupId = parseInt(assignment_group_id, 10);
    const parsed  = (names_list || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const p = line.split(/\s+/);
      return { first_name: p[0], last_name: p.slice(1).join(' ') };
    });
    if (!parsed.length) return res.status(400).json({ error: 'Nessun nominativo inserito' });
    db.get('SELECT max_passes FROM assignment_groups WHERE id=?', [groupId], (_e, ag) => {
      db.get('SELECT COUNT(*) AS cnt FROM participants WHERE assignment_group_id=?', [groupId], (_e2, row) => {
        const cnt  = row?.cnt || 0;
        const max  = ag?.max_passes ?? null;
        const total = cnt + parsed.length;
        if (max != null && total > max && !force_over_limit) {
          return res.status(409).json({ warning: true, current: cnt, adding: parsed.length, total_after: total, max, over: total - max });
        }
        const doInsertAll = () => {
          const stmt = db.prepare('INSERT INTO participants (first_name, last_name, assignment_group_id) VALUES (?,?,?)');
          let inserted = 0;
          parsed.forEach(p => stmt.run([p.first_name, p.last_name, groupId], function (e) { if (!e) inserted++; }));
          stmt.finalize(() => res.json({ success: true, inserted: parsed.length }));
        };
        if (force_over_limit === '1' && new_max_passes) {
          db.all("SELECT * FROM users WHERE role='admin'", [], (_e3, admins) => {
            if (!admins?.length) return res.status(500).json({ error: 'Nessun admin trovato' });
            const valid = admins.find(u => bcrypt.compareSync(admin_password || '', u.password_hash));
            if (!valid) return res.status(403).json({ error: 'Password amministratore non valida' });
            db.run('UPDATE assignment_groups SET max_passes=? WHERE id=?', [parseInt(new_max_passes, 10), groupId], () => doInsertAll());
          });
        } else { doInsertAll(); }
      });
    });
  });

  // ── Elimina partecipante ─────────────────────────────────────────
  app.post('/participants/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    const { redirect_to_group_id } = req.body;
    db.run('DELETE FROM participants WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione partecipante');
      if (this.changes > 0) logAction(req.session.user.id, 'delete_participant', 'participant', id, 'Partecipante eliminato');
      if (redirect_to_group_id) return res.redirect('/assignment-groups/' + redirect_to_group_id);
      res.redirect('/participants');
    });
  });

  // ── Import CSV/Excel per stand ───────────────────────────────────
  app.post('/assignment-groups/:id/import', requireAuth, requireOrganizer, uploadMemory.single('file'), (req, res) => {
    const gid = parseInt(req.params.id, 10);
    if (!gid || !req.file) return res.redirect('/assignment-groups/' + gid + '?import_errs=File+mancante');
    let rows;
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    } catch (e) {
      return res.redirect('/assignment-groups/' + gid + '?import_errs=' + encodeURIComponent('Errore: ' + e.message));
    }
    if (!rows?.length) return res.redirect('/assignment-groups/' + gid + '?import_errs=File+vuoto');
    let ok = 0, skip = 0;
    const errors = [];
    const ins = (i) => {
      if (i >= rows.length) {
        logAction(req.session.user.id, 'import_csv', 'group', gid, `Import ${ok} nel gruppo #${gid}`);
        createNotification('import', 'Import CSV completato', `Importati <strong>${ok}</strong> nel gruppo #${gid}. Saltati: ${skip}.`, 'group', gid);
        let q = `/assignment-groups/${gid}?import_ok=${ok}&import_skip=${skip}`;
        if (errors.length) q += '&import_errs=' + encodeURIComponent(errors.slice(0, 5).join('|'));
        return res.redirect(q);
      }
      const r     = rows[i];
      const last  = (r.cognome || r.Cognome || '').toString().trim();
      const first = (r.nome    || r.Nome    || '').toString().trim();
      const email = (r.email   || r.Email   || '').toString().trim().toLowerCase();
      const role  = (r.ruolo   || r.Ruolo   || 'Espositore').toString().trim();
      if (!last && !first) { skip++; return ins(i + 1); }
      db.get('SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',
        [first.toLowerCase(), last.toLowerCase(), gid], (_e, dup) => {
          if (dup) { skip++; return ins(i + 1); }
          db.run('INSERT INTO participants(first_name,last_name,email,role,assignment_group_id) VALUES(?,?,?,?,?)',
            [first, last, email || null, role, gid], function (e2) {
              if (e2) errors.push('Riga ' + (i + 2) + ': ' + e2.message); else ok++;
              ins(i + 1);
            });
        });
    };
    ins(0);
  });

  // ── Materiali stand (richieste logistiche) ───────────────────────
  app.get('/assignment-groups/:id/materiali', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const [group, materials, materialTypes] = await Promise.all([
        dbGet(`SELECT ag.id, ag.name, ag.zone, ag.stand_code, ag.stand_name, g.name AS category_name
               FROM assignment_groups ag JOIN groups g ON g.id=ag.group_id WHERE ag.id=?`, [id]),
        dbAll('SELECT * FROM group_material_requests WHERE assignment_group_id=? ORDER BY category, item_name, id', [id]),
        dbAll('SELECT * FROM logistic_categories ORDER BY sort_order, label'),
      ]);
      if (!group) return res.status(404).send('Stand non trovato');
      const MATERIAL_CATALOG_LOCAL = {};
      materialTypes.forEach(c => { MATERIAL_CATALOG_LOCAL[c.key_name] = { label: c.label, icon: c.icon || '📦' }; });
      // la view group-materiali.ejs usa cat.keyname (senza underscore) → adattiamo
      const logisticCategories = materialTypes.map(c => ({ ...c, keyname: c.key_name }));
      res.render('group-materiali', {
        group, materials,
        MATERIAL_CATALOG: MATERIAL_CATALOG_LOCAL,
        materialTypes,
        logisticCategories,
        saved: req.query.saved || null,
        currentUser: req.session.user
      });
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  app.post('/assignment-groups/:id/materiali', requireAuth, requireNotViewer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { category, item_name, item_name_custom, subcategory, quantity, notes } = req.body;
    const finalItem = (item_name === 'custom' ? item_name_custom : item_name)?.trim();
    if (!finalItem) return res.redirect(`/assignment-groups/${id}/materiali?saved=err`);
    try {
      await dbRun(
        'INSERT INTO group_material_requests (assignment_group_id, category, item_name, subcategory, quantity, notes, source, edition_id) VALUES (?,?,?,?,?,?,?,?)',
        [id, category || 'altro', finalItem, subcategory || null, parseInt(quantity, 10) || 1, notes || null, 'admin', getCurrent()?.id || null]
      );
      logAction(req.session.user.id, 'create_gmr', 'group_material_request', id, `Materiale ${finalItem} aggiunto`);
      res.redirect(`/assignment-groups/${id}/materiali?saved=ok`);
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  app.post('/assignment-groups/:id/materiali/:rid/status', requireAuth, requireNotViewer, async (req, res) => {
    const { id, rid } = req.params;
    const { status } = req.body;
    try {
      await dbRun('UPDATE group_material_requests SET status=? WHERE id=? AND assignment_group_id=?', [status, rid, id]);
      res.redirect(`/assignment-groups/${id}/materiali`);
    } catch (err) {
      res.status(500).send('Errore aggiornamento stato materiale: ' + err.message);
    }
  });

  app.delete('/assignment-groups/:id/materiali/:rid', requireAuth, requireNotViewer, async (req, res) => {
    const { id, rid } = req.params;
    try {
      await dbRun('DELETE FROM group_material_requests WHERE id=? AND assignment_group_id=?', [rid, id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Limite auto-pass (parcheggio) ────────────────────────────────
  app.post('/assignment-groups/:id/max-auto-passes', requireAuth, requireNotViewer, (req, res) => {
    const id  = parseInt(req.params.id, 10);
    const max = parseInt(req.body.max_auto_passes, 10) || null;
    db.run('UPDATE assignment_groups SET max_auto_passes=? WHERE id=?', [max, id], (err) => {
      if (err) return res.status(500).send('Errore DB');
      res.redirect('/assignment-groups/' + id);
    });
  });

  // ── Genera auto-passes PDF ────────────────────────────────────────
  app.post('/assignment-groups/:id/auto-passes/generate', requireAuth, requireNotViewer, (req, res) => {
    const id  = parseInt(req.params.id, 10);
    const qty = Math.min(parseInt(req.body.quantity, 10) || 0, 20);
    if (!qty) return res.redirect('/assignment-groups/' + id);

    db.get('SELECT ag.*, ag.name AS group_name FROM assignment_groups ag WHERE ag.id=?', [id], async (_e, group) => {
      if (!group) return res.status(404).send('Stand non trovato');
      db.get("SELECT COUNT(*) AS cnt FROM auto_passes WHERE assignment_group_id=? AND status!='INVALIDATO'", [id], async (_e2, row) => {
        const existing = row?.cnt || 0;
        const total    = existing + qty;
        const edId     = getCurrent()?.id || null;
        // Recupera impostazioni auto-pass
        db.all('SELECT key,value FROM app_settings', [], async (_e3, apRows) => {
          const apSettings = Object.fromEntries((apRows || []).map(r => [r.key, r.value]));
          try {
            for (let i = 0; i < qty; i++) {
              const passNumber = existing + i + 1;
              const { pdfBytes, code } = await generateAutoPass(group, passNumber, total, apSettings);
              const fname = `auto_pass_${id}_${Date.now()}_${passNumber}.pdf`;
              const fpath = path.join(DATA_DIR, 'generated', fname);
              fs.mkdirSync(path.dirname(fpath), { recursive: true });
              fs.writeFileSync(fpath, pdfBytes);
              await new Promise((ok, ko) =>
                db.run(
                  "INSERT INTO auto_passes (assignment_group_id, pass_number, total_passes, pdf_file, status, edition_id, code) VALUES (?,?,?,?,?,?,?)",
                  [id, passNumber, total, fname, 'GENERATO', edId, code],
                  (e) => e ? ko(e) : ok()
                )
              );
              // Aggiorna totale su tutti i pass del gruppo
              await new Promise((ok) => db.run('UPDATE auto_passes SET total_passes=? WHERE assignment_group_id=?', [total, id], () => ok()));
            }
            logAction(req.session.user.id, 'generate_auto_passes', 'assignment_group', id, `${qty} auto-passes generati`);
            res.redirect('/assignment-groups/' + id + '?ap_ok=1');
          } catch (err) {
            console.error('[auto-passes generate]', err.message);
            res.status(500).send('Errore generazione auto-pass: ' + err.message);
          }
        });
      });
    });
  });

  // ── CRUD raggruppamenti (categorie) ──────────────────────────────
  app.get('/groups', requireAuth, requireAdmin, (_req, res) => res.redirect('/admin/settings#raggruppamenti'));

  app.post('/groups', requireAuth, requireOrganizer, (req, res) => {
    const { name, priority, pass_type_id } = req.body;
    if (!name) return res.status(400).send('Nome raggruppamento obbligatorio');
    db.run('INSERT INTO groups (name, priority, pass_type_id) VALUES (?,?,?)',
      [name, parseInt(priority || 0, 10), pass_type_id || null], function (err) {
        if (err) return res.status(500).send('Errore salvataggio raggruppamento');
        logAction(req.session.user.id, 'create_group', 'group', this.lastID, `Creato raggruppamento ${name}`);
        res.redirect('/admin/settings#raggruppamenti');
      }
    );
  });

  app.post('/groups/:id/edit', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, priority, pass_type_id } = req.body;
    if (!name) return res.status(400).send('Nome raggruppamento obbligatorio');
    db.run('UPDATE groups SET name=?,priority=?,pass_type_id=? WHERE id=?',
      [name, parseInt(priority || 0, 10), pass_type_id || null, id], (err) => {
        if (err) return res.status(500).send('Errore aggiornamento raggruppamento');
        logAction(req.session.user.id, 'edit_group', 'group', id, 'Raggruppamento aggiornato');
        res.redirect('/admin/settings#raggruppamenti');
      }
    );
  });

  app.post('/groups/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM groups WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione raggruppamento');
      if (this.changes > 0) logAction(req.session.user.id, 'delete_group', 'group', id, 'Raggruppamento eliminato');
      res.redirect('/admin/settings#raggruppamenti');
    });
  });

};
