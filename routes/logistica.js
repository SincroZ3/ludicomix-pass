/**
 * routes/logistica.js
 * ──────────────────────────────────────────────────────────────────
 * Gestione logistica: richieste servizi, attrezzatura, prestiti,
 * checklist operativa, catering staff, fornitori, hub admin.
 *
 * Route registrate:
 *   GET/POST/DELETE /admin/logistica/*
 *   GET/POST/DELETE /admin/checklist/*
 *   GET/POST/DELETE /admin/catering/*
 *   GET/POST/DELETE /admin/fornitori/*
 *   GET             /admin/hub
 * ──────────────────────────────────────────────────────────────────
 */
'use strict';

const { promisify } = require('util');

module.exports = function registerLogisticaRoutes(app, db, { requireAuth, requireOrganizer, logAction }) {

  const dbAll = promisify(db.all.bind(db));
  const dbGet = promisify(db.get.bind(db));
  function dbRun(sql, ...p) {
    return new Promise((resolve, reject) => {
      const params = p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // LOGISTICA
  // ════════════════════════════════════════════════════════════════

  app.get('/admin/logistica', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const requests = await dbAll(`
        SELECT sr.*, sr.service_type AS type, ag.name AS group_name
        FROM service_requests sr
        LEFT JOIN assignment_groups ag ON ag.id = sr.assignment_group_id
        ORDER BY sr.requested_at DESC
      `);
      const equipment = await dbAll(`SELECT * FROM equipment ORDER BY category, name`);
      const loans = await dbAll(`
        SELECT el.*, e.name AS equipment_name, e.category, ag.name AS group_name
        FROM equipment_loans el
        JOIN equipment e ON e.id = el.equipment_id
        LEFT JOIN assignment_groups ag ON ag.id = el.assignment_group_id
        ORDER BY el.loaned_at DESC
      `);
      const groups = await dbAll(`SELECT id, name FROM assignment_groups ORDER BY name`);
      const materialTypes = await dbAll(`SELECT * FROM logistic_categories ORDER BY sort_order, label`);
      const storageLocations = await dbAll(`SELECT * FROM logistic_locations ORDER BY sort_order, label`);
      res.render('admin-logistica', { requests, equipment, loans, groups, materialTypes, storageLocations, saved: req.query.saved || null });
    } catch (err) {
      console.error('Errore /admin/logistica:', err);
      res.status(500).send('Errore interno');
    }
  });

  app.post('/admin/logistica/requests/:id/status', requireAuth, requireOrganizer, async (req, res) => {
    const { status } = req.body;
    const id = parseInt(req.params.id, 10);
    try {
      await dbRun(`UPDATE service_requests SET status=?, updated_at=datetime('now','localtime') WHERE id=?`, [status, id]);
      logAction(req.session.user.id, 'update_logistica_request', 'service_request', id, `Stato richiesta #${id} → ${status}`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/admin/logistica/requests/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM service_requests WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id, 'delete_logistica_request', 'service_request', +req.params.id, 'Richiesta servizio eliminata');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/logistica/equipment', requireAuth, requireOrganizer, async (req, res) => {
    const { name, category, total_qty, notes, location, location_custom } = req.body;
    if (!name) return res.redirect('/admin/logistica?saved=err');
    const loc = location || null;
    const locCustom = (location === 'altro' && location_custom) ? location_custom.trim() : null;
    try {
      await dbRun(
        `INSERT INTO equipment (name, category, total_qty, notes, location, location_custom) VALUES (?,?,?,?,?,?)`,
        [name.trim(), category || null, parseInt(total_qty, 10) || 1, notes || null, loc, locCustom]
      );
      logAction(req.session.user.id, 'create_equipment', 'equipment', null, `Attrezzatura aggiunta: ${name.trim()}`);
      res.redirect('/admin/logistica?saved=equipment');
    } catch (err) { res.redirect('/admin/logistica?saved=err'); }
  });

  app.post('/admin/logistica/equipment/:id/edit', requireAuth, requireOrganizer, async (req, res) => {
    const { name, category, total_qty, notes, location, location_custom } = req.body;
    const id = parseInt(req.params.id, 10);
    const loc = location || null;
    const locCustom = (location === 'altro' && location_custom) ? location_custom.trim() : null;
    try {
      await dbRun(
        `UPDATE equipment SET name=?, category=?, total_qty=?, notes=?, location=?, location_custom=? WHERE id=?`,
        [name.trim(), category || null, parseInt(total_qty, 10) || 1, notes || null, loc, locCustom, id]
      );
      logAction(req.session.user.id, 'edit_equipment', 'equipment', id, `Attrezzatura #${id} aggiornata`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/admin/logistica/equipment/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM equipment WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id, 'delete_equipment', 'equipment', +req.params.id, 'Attrezzatura eliminata dal catalogo');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/logistica/loans', requireAuth, requireOrganizer, async (req, res) => {
    const { equipment_id, assignment_group_id, qty, notes } = req.body;
    if (!equipment_id) return res.redirect('/admin/logistica?saved=err');
    try {
      await dbRun(
        `INSERT INTO equipment_loans (equipment_id, assignment_group_id, qty, loaned_at, notes) VALUES (?,?,?,datetime('now','localtime'),?)`,
        [parseInt(equipment_id, 10), assignment_group_id ? parseInt(assignment_group_id, 10) : null, parseInt(qty, 10) || 1, notes || null]
      );
      res.redirect('/admin/logistica?saved=loan');
    } catch (err) { res.redirect('/admin/logistica?saved=err'); }
  });

  app.post('/admin/logistica/loans/:id/return', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`UPDATE equipment_loans SET returned_at=datetime('now','localtime') WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id, 'return_loan', 'loan', +req.params.id, `Prestito #${req.params.id} riconsegnato`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/admin/logistica/loans/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM equipment_loans WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id, 'delete_loan', 'loan', +req.params.id, `Prestito #${req.params.id} eliminato`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/logistica/settings/category', requireAuth, requireOrganizer, async (req, res) => {
    const { label, icon } = req.body;
    const cleanLabel = (label || '').trim();
    if (!cleanLabel) return res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    const key = cleanLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    try {
      const row = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM logistic_categories`);
      await dbRun(`INSERT INTO logistic_categories (key_name, label, icon, sort_order) VALUES (?,?,?,?)`,
        [key, cleanLabel, (icon || '📦').trim() || '📦', row.next || 10]);
      logAction(req.session.user.id, 'create_logistica_category', 'logistica_category', null, `Tipologia creata: ${cleanLabel}`);
      res.redirect('/admin/logistica?tab=impostazioni&saved=category');
    } catch (err) { res.redirect('/admin/logistica?tab=impostazioni&saved=err'); }
  });

  app.delete('/admin/logistica/settings/category/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM logistic_categories WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id, 'delete_logistica_category', 'logistica_category', +req.params.id, 'Tipologia materiale eliminata');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/logistica/settings/location', requireAuth, requireOrganizer, async (req, res) => {
    const { label, icon } = req.body;
    const cleanLabel = (label || '').trim();
    if (!cleanLabel) return res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    const key = cleanLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    try {
      const row = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM logistic_locations`);
      await dbRun(`INSERT INTO logistic_locations (key_name, label, icon, sort_order) VALUES (?,?,?,?)`,
        [key, cleanLabel, (icon || '📍').trim() || '📍', row.next || 10]);
      logAction(req.session.user.id, 'create_logistica_location', 'logistica_location', null, `Posizione creata: ${cleanLabel}`);
      res.redirect('/admin/logistica?tab=impostazioni&saved=location');
    } catch (err) { res.redirect('/admin/logistica?tab=impostazioni&saved=err'); }
  });

  app.delete('/admin/logistica/settings/location/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM logistic_locations WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id, 'delete_logistica_location', 'logistica_location', +req.params.id, 'Posizione inventario eliminata');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/admin/logistica/resoconto', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const requests = await dbAll(`
        SELECT sr.*, ag.name AS group_name, ag.zone,
               pt.name AS pass_type_name
        FROM service_requests sr
        LEFT JOIN assignment_groups ag ON ag.id = sr.assignment_group_id
        LEFT JOIN pass_types pt ON pt.id = ag.group_id
        ORDER BY ag.zone, ag.name, sr.category
      `);
      const materialTypes    = await dbAll(`SELECT * FROM logistic_categories ORDER BY sort_order, label`);
      const storageLocations = await dbAll(`SELECT * FROM logistic_locations ORDER BY sort_order, label`);
      res.render('admin-logistica-resoconto', { requests, materialTypes, storageLocations });
    } catch (err) {
      console.error('Errore /admin/logistica/resoconto:', err);
      res.status(500).send('Errore interno');
    }
  });

  app.get('/admin/logistica/resoconto/export.csv', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const rows = await dbAll(`
        SELECT sr.id, ag.name AS gruppo, ag.zone AS zona,
               sr.category, sr.item, sr.subcategory,
               sr.quantity, sr.notes, sr.status,
               sr.requested_at
        FROM service_requests sr
        LEFT JOIN assignment_groups ag ON ag.id = sr.assignment_group_id
        ORDER BY ag.zone, ag.name, sr.category
      `);
      const header = 'ID,Gruppo,Zona,Categoria,Articolo,Subcategoria,Quantità,Note,Stato,Data\n';
      const csv = header + rows.map(r =>
        [r.id, r.gruppo, r.zona, r.category, r.item, r.subcategory, r.quantity, r.notes, r.status, r.requested_at]
          .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="logistica-resoconto.csv"');
      res.send(csv);
    } catch (err) { res.status(500).send('Errore export: ' + err.message); }
  });

  // ════════════════════════════════════════════════════════════════
  // CHECKLIST
  // ════════════════════════════════════════════════════════════════

  app.get('/admin/checklist', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const templates = await dbAll(`SELECT * FROM checklist_templates ORDER BY phase, sort_order`);
      const items     = await dbAll(`SELECT * FROM checklist_items ORDER BY template_id, sort_order`);
      const runs      = await dbAll(`SELECT * FROM checklist_runs ORDER BY started_at DESC LIMIT 50`);
      res.render('admin-checklist', { templates, items, runs, saved: req.query.saved || null });
    } catch (err) { res.status(500).send('Errore: ' + err.message); }
  });

  app.post('/admin/checklist/template', requireAuth, requireOrganizer, async (req, res) => {
    const { title, area, phase } = req.body;
    if (!title) return res.redirect('/admin/checklist?saved=err');
    try {
      await dbRun(`INSERT INTO checklist_templates (title, area, phase) VALUES (?,?,?)`, [title.trim(), area || null, phase || 'montaggio']);
      logAction(req.session.user.id, 'create_checklist_template', 'checklist', null, `Template: ${title.trim()}`);
      res.redirect('/admin/checklist?saved=ok');
    } catch (err) { res.redirect('/admin/checklist?saved=err'); }
  });

  app.delete('/admin/checklist/template/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM checklist_templates WHERE id=?`, [+req.params.id]);
      logAction(req.session.user.id, 'delete_checklist_template', 'checklist', +req.params.id, 'Template eliminato');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/checklist/template/:id/item', requireAuth, requireOrganizer, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.redirect('/admin/checklist?saved=err');
    try {
      const r = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM checklist_items WHERE template_id=?`, [+req.params.id]);
      await dbRun(`INSERT INTO checklist_items (template_id, text, sort_order) VALUES (?,?,?)`, [+req.params.id, text.trim(), r.n || 10]);
      res.redirect('/admin/checklist?saved=ok');
    } catch (err) { res.redirect('/admin/checklist?saved=err'); }
  });

  app.delete('/admin/checklist/item/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM checklist_items WHERE id=?`, [+req.params.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/checklist/template/:id/run', requireAuth, requireOrganizer, async (req, res) => {
    const { edition_id } = req.body;
    try {
      const run = await dbRun(`INSERT INTO checklist_runs (template_id, edition_id) VALUES (?,?)`, [+req.params.id, edition_id || null]);
      const items = await dbAll(`SELECT * FROM checklist_items WHERE template_id=? ORDER BY sort_order`, [+req.params.id]);
      for (const item of items) {
        await dbRun(`INSERT INTO checklist_run_items (run_id, item_id) VALUES (?,?)`, [run.lastID, item.id]);
      }
      logAction(req.session.user.id, 'start_checklist_run', 'checklist', run.lastID, `Run avviata per template #${req.params.id}`);
      res.redirect(`/admin/checklist/run/${run.lastID}`);
    } catch (err) { res.status(500).send('Errore: ' + err.message); }
  });

  app.get('/admin/checklist/run/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const run      = await dbGet(`SELECT cr.*, ct.title FROM checklist_runs cr JOIN checklist_templates ct ON ct.id=cr.template_id WHERE cr.id=?`, [+req.params.id]);
      if (!run) return res.status(404).send('Run non trovata');
      const runItems = await dbAll(`SELECT cri.*, ci.text FROM checklist_run_items cri JOIN checklist_items ci ON ci.id=cri.item_id WHERE cri.run_id=? ORDER BY ci.sort_order`, [+req.params.id]);
      res.render('admin-checklist-run', { run, runItems });
    } catch (err) { res.status(500).send('Errore: ' + err.message); }
  });

  app.post('/admin/checklist/run/:runId/item/:itemId/toggle', requireAuth, requireOrganizer, async (req, res) => {
    const isDone = req.body.done ? 1 : 0;
    try {
      await dbRun(
        `UPDATE checklist_run_items SET done=?, done_at=?, done_by=? WHERE id=?`,
        [isDone, isDone ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, isDone ? req.session.user.username : null, +req.params.itemId]
      );
      const pending = await dbGet(`SELECT COUNT(*) AS c FROM checklist_run_items WHERE run_id=? AND done=0`, [+req.params.runId]);
      if (pending.c === 0) await dbRun(`UPDATE checklist_runs SET completed_at=datetime('now','localtime') WHERE id=? AND completed_at IS NULL`, [+req.params.runId]);
      else await dbRun(`UPDATE checklist_runs SET completed_at=NULL WHERE id=?`, [+req.params.runId]);
      logAction(req.session.user.id, 'toggle_checklist_item', 'checklist', +req.params.itemId, (isDone ? '✅ Completata' : '↩️ Deselezionata') + ' voce run #' + req.params.runId);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ════════════════════════════════════════════════════════════════
  // CATERING
  // ════════════════════════════════════════════════════════════════

  app.get('/admin/catering', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const shifts   = await dbAll(`SELECT * FROM catering_shifts ORDER BY date DESC, meal_type`);
      const orders   = await dbAll(`SELECT * FROM catering_orders ORDER BY shift_id, staff_name`);
      const editions = await dbAll(`SELECT * FROM editions ORDER BY year DESC`);
      res.render('admin-catering', { shifts, orders, editions, req, saved: req.query.saved || null });
    } catch (err) { res.status(500).send('Errore: ' + err.message); }
  });

  app.post('/admin/catering/shift', requireAuth, requireOrganizer, async (req, res) => {
    const { label, date, meal_type, edition_id, notes } = req.body;
    if (!label) return res.redirect('/admin/catering?saved=err');
    try {
      await dbRun(`INSERT INTO catering_shifts (label, date, meal_type, edition_id, notes) VALUES (?,?,?,?,?)`,
        [label.trim(), date || null, meal_type || 'pranzo', edition_id || null, notes || null]);
      logAction(req.session.user.id, 'create_catering_shift', 'catering', null, `Turno catering: ${label.trim()}`);
      res.redirect('/admin/catering?saved=ok');
    } catch (err) { res.redirect('/admin/catering?saved=err'); }
  });

  app.delete('/admin/catering/shift/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM catering_orders WHERE shift_id=?`, [+req.params.id]);
      await dbRun(`DELETE FROM catering_shifts WHERE id=?`, [+req.params.id]);
      logAction(req.session.user.id, 'delete_catering_shift', 'catering', +req.params.id, 'Turno catering eliminato');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/catering/shift/:id/order', requireAuth, requireOrganizer, async (req, res) => {
    const { staff_name, role, menu_choice, dietary, notes } = req.body;
    if (!staff_name) return res.redirect('/admin/catering?saved=err');
    try {
      await dbRun(`INSERT INTO catering_orders (shift_id, staff_name, role, menu_choice, dietary, notes) VALUES (?,?,?,?,?,?)`,
        [+req.params.id, staff_name.trim(), role || null, menu_choice || null, dietary || null, notes || null]);
      logAction(req.session.user.id, 'create_catering_order', 'catering', null, `Ordinazione: ${staff_name} turno #${req.params.id}`);
      res.redirect(`/admin/catering?saved=ok&shift=${req.params.id}`);
    } catch (err) { res.redirect('/admin/catering?saved=err'); }
  });

  app.delete('/admin/catering/order/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM catering_orders WHERE id=?`, [+req.params.id]);
      logAction(req.session.user.id, 'delete_catering_order', 'catering', +req.params.id, 'Ordinazione catering eliminata');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ════════════════════════════════════════════════════════════════
  // FORNITORI
  // ════════════════════════════════════════════════════════════════

  app.get('/admin/fornitori', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const suppliers = await dbAll(`SELECT * FROM suppliers ORDER BY category, name`);
      const items     = await dbAll(`SELECT * FROM supplier_items ORDER BY supplier_id, created_at DESC`);
      const editions  = await dbAll(`SELECT * FROM editions ORDER BY year DESC`);
      res.render('admin-fornitori', { suppliers, items, editions, saved: req.query.saved || null });
    } catch (err) { res.status(500).send('Errore: ' + err.message); }
  });

  app.post('/admin/fornitori', requireAuth, requireOrganizer, async (req, res) => {
    const { name, category, contact_name, phone, email, website, notes } = req.body;
    if (!name) return res.redirect('/admin/fornitori?saved=err');
    try {
      await dbRun(`INSERT INTO suppliers (name, category, contact_name, phone, email, website, notes) VALUES (?,?,?,?,?,?,?)`,
        [name.trim(), category || null, contact_name || null, phone || null, email || null, website || null, notes || null]);
      logAction(req.session.user.id, 'create_supplier', 'supplier', null, `Fornitore: ${name.trim()}`);
      res.redirect('/admin/fornitori?saved=ok');
    } catch (err) { res.redirect('/admin/fornitori?saved=err'); }
  });

  app.delete('/admin/fornitori/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM supplier_items WHERE supplier_id=?`, [+req.params.id]);
      await dbRun(`DELETE FROM suppliers WHERE id=?`, [+req.params.id]);
      logAction(req.session.user.id, 'delete_supplier', 'supplier', +req.params.id, 'Fornitore eliminato');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/admin/fornitori/:id/item', requireAuth, requireOrganizer, async (req, res) => {
    const { description, qty, unit_price, total_price, notes, edition_id } = req.body;
    if (!description) return res.redirect('/admin/fornitori?saved=err');
    try {
      await dbRun(
        `INSERT INTO supplier_items (supplier_id, description, qty, unit_price, total_price, notes, edition_id) VALUES (?,?,?,?,?,?,?)`,
        [+req.params.id, description.trim(), qty || null, unit_price || null, total_price || null, notes || null, edition_id || null]
      );
      logAction(req.session.user.id, 'create_supplier_item', 'supplier_item', null, `Voce fornitore #${req.params.id}: ${description.trim()}`);
      res.redirect('/admin/fornitori?saved=ok');
    } catch (err) { res.redirect('/admin/fornitori?saved=err'); }
  });

  app.delete('/admin/fornitori/item/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM supplier_items WHERE id=?`, [+req.params.id]);
      logAction(req.session.user.id, 'delete_supplier_item', 'supplier_item', +req.params.id, 'Voce fornitore eliminata');
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ════════════════════════════════════════════════════════════════
  // HUB ADMIN
  // ════════════════════════════════════════════════════════════════

  app.get('/admin/hub', requireAuth, requireOrganizer, (req, res) => {
    res.render('admin-hub', { currentUser: req.session.user });
  });

};
