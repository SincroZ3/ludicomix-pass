/**
 * routes/area-personale.js
 * ──────────────────────────────────────────────────────────────────
 * Area Personale: note a cartelle, rubrica contatti, contabilità
 * spese personali e richieste di rimborso con generazione PDF.
 * Ogni dato è isolato per user_id. La vista "Richieste rimborsi"
 * è riservata a admin/accountant (requireAccounting).
 * ──────────────────────────────────────────────────────────────────
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { promisify } = require('util');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

module.exports = function registerAreaPersonaleRoutes(
  app, db,
  { requireAuth, requirePersonalArea, requireAccounting, logAction,
    uploadReceipts, getCurrent, ROLES }
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

  function sanitizeForPdf(text) {
    if (!text) return '';
    return String(text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '?');
  }

  app.get('/area-personale', requireAuth, requirePersonalArea, async (req, res) => {
    const uid = req.session.user.id;
    try {
      const [notesCount, contactsCount, pendingRefunds, recentNotes, user] = await Promise.all([
        dbGet('SELECT COUNT(*) AS n FROM personal_notes WHERE user_id=?', [uid]),
        dbGet('SELECT COUNT(*) AS n FROM personal_contacts WHERE user_id=?', [uid]),
        dbGet("SELECT COUNT(*) AS n FROM refund_requests WHERE user_id=? AND status='in_attesa'", [uid]),
        dbAll('SELECT id, title, updated_at FROM personal_notes WHERE user_id=? ORDER BY updated_at DESC LIMIT 5', [uid]),
        dbGet('SELECT full_name, birth_place, birth_date, fiscal_code, iban FROM users WHERE id=?', [uid]),
      ]);
      const profileComplete = !!(user && user.full_name && user.birth_place && user.birth_date && user.fiscal_code && user.iban);
      res.render('area_personale_home', {
        notesCount: notesCount?.n || 0,
        contactsCount: contactsCount?.n || 0,
        pendingRefunds: pendingRefunds?.n || 0,
        recentNotes: recentNotes || [],
        profileComplete,
      });
    } catch (err) {
      res.status(500).send('Errore caricamento area personale: ' + err.message);
    }
  });

  app.get('/area-personale/profilo', requireAuth, requirePersonalArea, async (req, res) => {
    const user = await dbGet('SELECT * FROM users WHERE id=?', [req.session.user.id]);
    res.render('area_personale_profilo', { user, saved: req.query.saved || null });
  });

  app.post('/area-personale/profilo', requireAuth, requirePersonalArea, async (req, res) => {
    const { full_name, birth_place, birth_date, fiscal_code, iban } = req.body;
    try {
      await dbRun(
        'UPDATE users SET full_name=?, birth_place=?, birth_date=?, fiscal_code=?, iban=? WHERE id=?',
        [full_name || null, birth_place || null, birth_date || null,
         fiscal_code ? fiscal_code.toUpperCase().trim() : null, iban ? iban.toUpperCase().replace(/\s/g, '') : null,
         req.session.user.id]
      );
      res.redirect('/area-personale/profilo?saved=1');
    } catch (err) {
      res.status(500).send('Errore salvataggio profilo: ' + err.message);
    }
  });

  app.get('/area-personale/note', requireAuth, requirePersonalArea, async (req, res) => {
    const uid = req.session.user.id;
    const folderId = req.query.folder ? parseInt(req.query.folder, 10) : null;
    try {
      const [folders, notes, allFolders] = await Promise.all([
        dbAll('SELECT * FROM note_folders WHERE user_id=? AND parent_id IS ? ORDER BY name', [uid, folderId]),
        dbAll('SELECT * FROM personal_notes WHERE user_id=? AND folder_id IS ? ORDER BY is_pinned DESC, updated_at DESC', [uid, folderId]),
        dbAll('SELECT id, name, parent_id FROM note_folders WHERE user_id=? ORDER BY name', [uid]),
      ]);
      const breadcrumb = [];
      let cur = folderId;
      while (cur) {
        const f = await dbGet('SELECT id, name, parent_id FROM note_folders WHERE id=? AND user_id=?', [cur, uid]);
        if (!f) break;
        breadcrumb.unshift(f);
        cur = f.parent_id;
      }
      res.render('area_personale_note', {
        folders: folders || [], notes: notes || [], breadcrumb, allFolders: allFolders || [],
        currentFolderId: folderId,
      });
    } catch (err) {
      res.status(500).send('Errore caricamento note: ' + err.message);
    }
  });

  app.post('/area-personale/note/cartella', requireAuth, requirePersonalArea, async (req, res) => {
    const { name, parent_id } = req.body;
    if (!name || !name.trim()) return res.redirect('back');
    try {
      await dbRun('INSERT INTO note_folders (user_id, parent_id, name) VALUES (?,?,?)',
        [req.session.user.id, parent_id ? parseInt(parent_id, 10) : null, name.trim()]);
      res.redirect('/area-personale/note' + (parent_id ? '?folder=' + parent_id : ''));
    } catch (err) {
      res.status(500).send('Errore creazione cartella: ' + err.message);
    }
  });

  app.post('/area-personale/note/cartella/:id/rinomina', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name } = req.body;
    if (!name || !name.trim()) return res.redirect('back');
    await dbRun('UPDATE note_folders SET name=? WHERE id=? AND user_id=?', [name.trim(), id, req.session.user.id]);
    res.redirect('back');
  });

  app.post('/area-personale/note/cartella/:id/elimina', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const uid = req.session.user.id;
    const folder = await dbGet('SELECT parent_id FROM note_folders WHERE id=? AND user_id=?', [id, uid]);
    if (folder) {
      await dbRun('UPDATE personal_notes SET folder_id=? WHERE folder_id=? AND user_id=?', [folder.parent_id, id, uid]);
      await dbRun('UPDATE note_folders SET parent_id=? WHERE parent_id=? AND user_id=?', [folder.parent_id, id, uid]);
      await dbRun('DELETE FROM note_folders WHERE id=? AND user_id=?', [id, uid]);
    }
    res.redirect('/area-personale/note' + (folder && folder.parent_id ? '?folder=' + folder.parent_id : ''));
  });

  app.post('/area-personale/note', requireAuth, requirePersonalArea, async (req, res) => {
    const { title, body, category, folder_id } = req.body;
    if (!title || !title.trim()) return res.redirect('back');
    try {
      const r = await dbRun(
        'INSERT INTO personal_notes (user_id, folder_id, title, body, category) VALUES (?,?,?,?,?)',
        [req.session.user.id, folder_id ? parseInt(folder_id, 10) : null, title.trim(), body || '', category || null]
      );
      logAction(req.session.user.id, 'create_personal_note', 'personal_note', r.lastID, 'Nota "' + title.trim() + '"');
      res.redirect('/area-personale/note' + (folder_id ? '?folder=' + folder_id : ''));
    } catch (err) {
      res.status(500).send('Errore salvataggio nota: ' + err.message);
    }
  });

  app.post('/area-personale/note/:id', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { title, body, category, is_pinned, folder_id } = req.body;
    await dbRun(
      "UPDATE personal_notes SET title=?, body=?, category=?, is_pinned=?, folder_id=?, updated_at=datetime('now','localtime') WHERE id=? AND user_id=?",
      [title || '', body || '', category || null, is_pinned ? 1 : 0,
       folder_id ? parseInt(folder_id, 10) : null, id, req.session.user.id]
    );
    res.redirect('/area-personale/note' + (folder_id ? '?folder=' + folder_id : ''));
  });

  app.post('/area-personale/note/:id/sposta', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { target_folder_id } = req.body;
    await dbRun('UPDATE personal_notes SET folder_id=? WHERE id=? AND user_id=?',
      [target_folder_id ? parseInt(target_folder_id, 10) : null, id, req.session.user.id]);
    res.json({ ok: true });
  });

  app.post('/area-personale/note/:id/elimina', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const note = await dbGet('SELECT folder_id FROM personal_notes WHERE id=? AND user_id=?', [id, req.session.user.id]);
    await dbRun('DELETE FROM personal_notes WHERE id=? AND user_id=?', [id, req.session.user.id]);
    res.redirect('/area-personale/note' + (note && note.folder_id ? '?folder=' + note.folder_id : ''));
  });

  app.get('/area-personale/rubrica', requireAuth, requirePersonalArea, async (req, res) => {
    try {
      const contacts = await dbAll(
        `SELECT pc.*, ag.name AS linked_group_name, ag.stand_name AS linked_stand_name
         FROM personal_contacts pc
         LEFT JOIN assignment_groups ag ON ag.id = pc.assignment_group_id
         WHERE pc.user_id=? ORDER BY pc.last_name, pc.first_name`,
        [req.session.user.id]
      );
      res.render('area_personale_rubrica', { contacts: contacts || [] });
    } catch (err) {
      res.status(500).send('Errore caricamento rubrica: ' + err.message);
    }
  });

  app.post('/area-personale/rubrica', requireAuth, requirePersonalArea, async (req, res) => {
    const { first_name, last_name, role, company, email, phone, notes, assignment_group_id } = req.body;
    if (!first_name || !first_name.trim()) return res.status(400).send('Nome obbligatorio');
    try {
      const r = await dbRun(
        `INSERT INTO personal_contacts (user_id, first_name, last_name, role, company, email, phone, notes, assignment_group_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [req.session.user.id, first_name.trim(), last_name || null, role || null, company || null,
         email || null, phone || null, notes || null, assignment_group_id ? parseInt(assignment_group_id, 10) : null]
      );
      logAction(req.session.user.id, 'create_personal_contact', 'personal_contact', r.lastID, 'Contatto ' + first_name);
      res.redirect('/area-personale/rubrica');
    } catch (err) {
      res.status(500).send('Errore salvataggio contatto: ' + err.message);
    }
  });

  app.post('/area-personale/rubrica/:id', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { first_name, last_name, role, company, email, phone, notes } = req.body;
    await dbRun(
      'UPDATE personal_contacts SET first_name=?, last_name=?, role=?, company=?, email=?, phone=?, notes=? WHERE id=? AND user_id=?',
      [first_name || '', last_name || null, role || null, company || null, email || null, phone || null,
       notes || null, id, req.session.user.id]
    );
    res.redirect('/area-personale/rubrica');
  });

  app.post('/area-personale/rubrica/:id/elimina', requireAuth, requirePersonalArea, async (req, res) => {
    await dbRun('DELETE FROM personal_contacts WHERE id=? AND user_id=?', [parseInt(req.params.id, 10), req.session.user.id]);
    res.redirect('/area-personale/rubrica');
  });

  app.get('/api/area-personale/rubrica/espositori', requireAuth, requirePersonalArea, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ groups: [] });
    const like = '%' + q + '%';
    try {
      const groups = await dbAll(
        'SELECT id, name, stand_name, zone, email FROM assignment_groups WHERE name LIKE ? OR stand_name LIKE ? ORDER BY name LIMIT 15',
        [like, like]
      );
      res.json({ groups: groups || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/area-personale/rubrica/importa-espositore', requireAuth, requirePersonalArea, async (req, res) => {
    const { assignment_group_id } = req.body;
    const gid = parseInt(assignment_group_id, 10);
    if (!gid) return res.status(400).json({ error: 'Gruppo non specificato' });
    try {
      const group = await dbGet('SELECT * FROM assignment_groups WHERE id=?', [gid]);
      if (!group) return res.status(404).json({ error: 'Espositore non trovato' });
      const r = await dbRun(
        `INSERT INTO personal_contacts (user_id, first_name, last_name, company, email, notes, assignment_group_id)
         VALUES (?,?,?,?,?,?,?)`,
        [req.session.user.id, group.name, '', group.stand_name || null, group.email || null,
         group.zone ? ('Zona: ' + group.zone) : null, gid]
      );
      res.json({ ok: true, id: r.lastID });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/area-personale/checklist', requireAuth, requirePersonalArea, async (req, res) => {
    try {
      const lists = await dbAll('SELECT * FROM personal_checklists WHERE user_id=? ORDER BY created_at DESC', [req.session.user.id]);
      for (const l of lists) {
        l.items = await dbAll('SELECT * FROM personal_checklist_items WHERE checklist_id=? ORDER BY sort_order, id', [l.id]);
      }
      res.render('area_personale_checklist', { lists: lists || [] });
    } catch (err) {
      res.status(500).send('Errore caricamento checklist: ' + err.message);
    }
  });

  app.post('/area-personale/checklist', requireAuth, requirePersonalArea, async (req, res) => {
    const { title } = req.body;
    if (!title || !title.trim()) return res.redirect('/area-personale/checklist');
    await dbRun('INSERT INTO personal_checklists (user_id, title) VALUES (?,?)', [req.session.user.id, title.trim()]);
    res.redirect('/area-personale/checklist');
  });

  app.post('/area-personale/checklist/:id/elimina', requireAuth, requirePersonalArea, async (req, res) => {
    await dbRun('DELETE FROM personal_checklists WHERE id=? AND user_id=?', [parseInt(req.params.id, 10), req.session.user.id]);
    res.redirect('/area-personale/checklist');
  });

  app.post('/area-personale/checklist/:id/voce', requireAuth, requirePersonalArea, async (req, res) => {
    const checklistId = parseInt(req.params.id, 10);
    const { text } = req.body;
    if (!text || !text.trim()) return res.redirect('/area-personale/checklist');
    const owned = await dbGet('SELECT id FROM personal_checklists WHERE id=? AND user_id=?', [checklistId, req.session.user.id]);
    if (!owned) return res.status(403).send('Checklist non trovata');
    await dbRun('INSERT INTO personal_checklist_items (checklist_id, text) VALUES (?,?)', [checklistId, text.trim()]);
    res.redirect('/area-personale/checklist');
  });

  app.post('/area-personale/checklist/voce/:id/toggle', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = await dbGet(
      `SELECT pci.id, pci.done FROM personal_checklist_items pci
       JOIN personal_checklists pc ON pc.id = pci.checklist_id
       WHERE pci.id=? AND pc.user_id=?`, [id, req.session.user.id]);
    if (!item) return res.status(404).json({ error: 'Voce non trovata' });
    await dbRun('UPDATE personal_checklist_items SET done=? WHERE id=?', [item.done ? 0 : 1, id]);
    res.json({ ok: true, done: item.done ? 0 : 1 });
  });

  app.post('/area-personale/checklist/voce/:id/elimina', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await dbRun(
      'DELETE FROM personal_checklist_items WHERE id=? AND checklist_id IN (SELECT id FROM personal_checklists WHERE user_id=?)',
      [id, req.session.user.id]);
    res.redirect('/area-personale/checklist');
  });

  app.get('/area-personale/spese', requireAuth, requirePersonalArea, async (req, res) => {
    const uid = req.session.user.id;
    const selectedEdition = req.query.edizione || 'tutte';
    try {
      const editions = await dbAll(
        `SELECT DISTINCT e.id, e.name, e.year FROM expenses ex
         JOIN editions e ON e.id = ex.edition_id
         WHERE ex.user_id=? ORDER BY e.year DESC`, [uid]);

      let sql = `SELECT ex.*, e.name AS edition_name, e.year AS edition_year,
                        (SELECT COUNT(*) FROM expense_receipts er WHERE er.expense_id=ex.id) AS receipt_count
                 FROM expenses ex LEFT JOIN editions e ON e.id = ex.edition_id
                 WHERE ex.user_id=?`;
      const params = [uid];
      if (selectedEdition !== 'tutte') {
        sql += ' AND ex.edition_id=?';
        params.push(parseInt(selectedEdition, 10));
      }
      sql += ' ORDER BY ex.expense_date DESC';
      const expenses = await dbAll(sql, params);

      const totalAmount = (expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
      const unassigned = (expenses || []).filter(e => !e.refund_request_id);

      res.render('area_personale_spese', {
        expenses: expenses || [], editions: editions || [], selectedEdition,
        totalAmount, unassignedCount: unassigned.length,
        currentEdition: getCurrent ? getCurrent() : null,
      });
    } catch (err) {
      res.status(500).send('Errore caricamento spese: ' + err.message);
    }
  });

  app.post('/area-personale/spese', requireAuth, requirePersonalArea, uploadReceipts.array('receipts', 5), async (req, res) => {
    const { description, amount, expense_date, category, notes } = req.body;
    if (!description || !amount || !expense_date) return res.status(400).send('Descrizione, importo e data sono obbligatori');
    const uid = req.session.user.id;
    const curEd = getCurrent ? getCurrent() : null;
    try {
      const r = await dbRun(
        'INSERT INTO expenses (user_id, edition_id, description, amount, expense_date, category, notes) VALUES (?,?,?,?,?,?,?)',
        [uid, curEd ? curEd.id : null, description.trim(), parseFloat(amount), expense_date, category || null, notes || null]
      );
      const files = req.files || [];
      for (const f of files) {
        await dbRun(
          'INSERT INTO expense_receipts (expense_id, file_name, original_name, mime_type, size_bytes) VALUES (?,?,?,?,?)',
          [r.lastID, f.filename, f.originalname, f.mimetype, f.size]
        );
      }
      logAction(uid, 'create_expense', 'expense', r.lastID, 'Spesa "' + description.trim() + '" (' + amount + ' EUR)');
      res.redirect('/area-personale/spese');
    } catch (err) {
      res.status(500).send('Errore salvataggio spesa: ' + err.message);
    }
  });

  app.post('/area-personale/spese/:id/elimina', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const uid = req.session.user.id;
    const receipts = await dbAll('SELECT file_name FROM expense_receipts WHERE expense_id=?', [id]);
    for (const r of receipts) {
      const fp = path.join(DATA_DIR, 'personal_uploads', 'receipts', String(uid), r.file_name);
      fs.unlink(fp, () => {});
    }
    await dbRun('DELETE FROM expenses WHERE id=? AND user_id=? AND refund_request_id IS NULL', [id, uid]);
    res.redirect('/area-personale/spese');
  });

  app.get('/area-personale/spese/ricevuta/:id', requireAuth, requirePersonalArea, async (req, res) => {
    const receiptId = parseInt(req.params.id, 10);
    const uid = req.session.user.id;
    const receipt = await dbGet(
      `SELECT er.* FROM expense_receipts er
       JOIN expenses ex ON ex.id = er.expense_id
       WHERE er.id=? AND ex.user_id=?`, [receiptId, uid]);
    if (!receipt) return res.status(404).send('Ricevuta non trovata');
    const fp = path.join(DATA_DIR, 'personal_uploads', 'receipts', String(uid), receipt.file_name);
    if (!fs.existsSync(fp)) return res.status(404).send('File non trovato');
    res.download(fp, receipt.original_name || receipt.file_name);
  });

  app.get('/area-personale/spese/export.csv', requireAuth, requirePersonalArea, async (req, res) => {
    const uid = req.session.user.id;
    const selectedEdition = req.query.edizione || 'tutte';
    let sql = `SELECT ex.expense_date, ex.description, ex.category, ex.amount, e.name AS edition_name
               FROM expenses ex LEFT JOIN editions e ON e.id = ex.edition_id WHERE ex.user_id=?`;
    const params = [uid];
    if (selectedEdition !== 'tutte') { sql += ' AND ex.edition_id=?'; params.push(parseInt(selectedEdition, 10)); }
    sql += ' ORDER BY ex.expense_date DESC';
    try {
      const rows = await dbAll(sql, params);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="le_mie_spese.csv"');
      res.write('\xEF\xBB\xBF');
      res.write('Data;Descrizione;Categoria;Importo;Edizione\n');
      rows.forEach(r => {
        res.write([r.expense_date, '"' + (r.description || '') + '"', '"' + (r.category || '') + '"',
          (r.amount || 0).toFixed(2), '"' + (r.edition_name || '') + '"'].join(';') + '\n');
      });
      res.end();
    } catch (err) {
      res.status(500).send('Errore export: ' + err.message);
    }
  });

  app.get('/area-personale/richieste-rimborso', requireAuth, requirePersonalArea, async (req, res) => {
    const uid = req.session.user.id;
    try {
      const [requests, availableExpenses, user] = await Promise.all([
        dbAll(
          `SELECT rr.*, e.name AS edition_name, e.year AS edition_year, ru.username AS reviewer_name
           FROM refund_requests rr
           LEFT JOIN editions e ON e.id = rr.edition_id
           LEFT JOIN users ru ON ru.id = rr.reviewed_by
           WHERE rr.user_id=? ORDER BY rr.created_at DESC`, [uid]),
        dbAll('SELECT * FROM expenses WHERE user_id=? AND refund_request_id IS NULL ORDER BY expense_date DESC', [uid]),
        dbGet('SELECT full_name, birth_place, birth_date, fiscal_code, iban FROM users WHERE id=?', [uid]),
      ]);
      const profileComplete = !!(user && user.full_name && user.birth_place && user.birth_date && user.fiscal_code && user.iban);
      res.render('area_personale_rimborsi_mie', {
        requests: requests || [], availableExpenses: availableExpenses || [], profileComplete, user,
      });
    } catch (err) {
      res.status(500).send('Errore caricamento richieste: ' + err.message);
    }
  });

  app.post('/area-personale/richieste-rimborso', requireAuth, requirePersonalArea, async (req, res) => {
    const uid = req.session.user.id;
    let { expense_ids, period_label, iban } = req.body;
    expense_ids = Array.isArray(expense_ids) ? expense_ids : (expense_ids ? [expense_ids] : []);
    if (!expense_ids.length) return res.status(400).send('Seleziona almeno una spesa da rimborsare');

    try {
      const user = await dbGet('SELECT * FROM users WHERE id=?', [uid]);
      if (!user || !user.full_name || !user.birth_place || !user.birth_date || !user.fiscal_code) {
        return res.status(400).send('Completa prima i dati del tuo profilo (nome, luogo/data di nascita, codice fiscale) nella pagina Profilo.');
      }
      const ids = expense_ids.map(Number);
      const placeholders = ids.map(() => '?').join(',');
      const expenses = await dbAll(
        'SELECT * FROM expenses WHERE id IN (' + placeholders + ') AND user_id=? AND refund_request_id IS NULL',
        [...ids, uid]
      );
      if (!expenses.length) return res.status(400).send('Nessuna spesa valida selezionata');

      const totalAmount = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      const curEd = getCurrent ? getCurrent() : null;
      const finalIban = (iban || user.iban || '').toUpperCase().replace(/\s/g, '');

      const settingsRows = await dbAll("SELECT key,value FROM app_settings WHERE key IN ('event_name')");
      const eventName = (settingsRows.find(r => r.key === 'event_name') || {}).value || 'Ludicomix';

      const result = await dbRun(
        "INSERT INTO refund_requests (user_id, edition_id, total_amount, period_label, iban, status) VALUES (?,?,?,?,?,'in_attesa')",
        [uid, curEd ? curEd.id : (expenses[0].edition_id || null), totalAmount, period_label || null, finalIban || null]
      );
      const requestId = result.lastID;

      await dbRun('UPDATE expenses SET refund_request_id=? WHERE id IN (' + placeholders + ')', [requestId, ...ids]);

      const pdfFileName = await generateRefundPdf({
        requestId, user, expenses, totalAmount, periodLabel: period_label, iban: finalIban, eventName,
      });
      await dbRun('UPDATE refund_requests SET pdf_file=? WHERE id=?', [pdfFileName, requestId]);

      logAction(uid, 'create_refund_request', 'refund_request', requestId,
        'Richiesta rimborso ' + totalAmount.toFixed(2) + ' EUR (' + expenses.length + ' spese)');
      res.redirect('/area-personale/richieste-rimborso');
    } catch (err) {
      console.error('[Rimborso]', err);
      res.status(500).send('Errore creazione richiesta: ' + err.message);
    }
  });

  app.get('/area-personale/richieste-rimborso/:id/pdf', requireAuth, requirePersonalArea, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const uid = req.session.user.id;
    const isAccounting = req.session.user.role === ROLES.ADMIN || req.session.user.role === ROLES.ACCOUNTANT;
    const request = await dbGet('SELECT * FROM refund_requests WHERE id=?', [id]);
    if (!request) return res.status(404).send('Richiesta non trovata');
    if (request.user_id !== uid && !isAccounting) return res.status(403).send('Non autorizzato');
    if (!request.pdf_file) return res.status(404).send('PDF non disponibile');
    const fp = path.join(DATA_DIR, 'personal_uploads', 'refunds', request.pdf_file);
    if (!fs.existsSync(fp)) return res.status(404).send('File non trovato');
    res.download(fp, 'Richiesta_Rimborso_' + id + '.pdf');
  });

  async function generateRefundPdf({ requestId, user, expenses, totalAmount, periodLabel, iban, eventName }) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const { width } = page.getSize();
    const marginX = 50;
    let y = 800;

    const drawText = (text, opts = {}) => {
      const { size = 10, useFont = font, color = rgb(0, 0, 0), x = marginX, lineGap = 16 } = opts;
      page.drawText(sanitizeForPdf(text), { x, y, size, font: useFont, color });
      y -= lineGap;
    };
    const drawWrapped = (text, opts = {}) => {
      const { size = 10, useFont = font, maxWidth = width - marginX * 2, lineGap = 14 } = opts;
      const words = sanitizeForPdf(text).split(' ');
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (useFont.widthOfTextAtSize(test, size) > maxWidth) {
          page.drawText(line, { x: marginX, y, size, font: useFont });
          y -= lineGap;
          line = w;
        } else {
          line = test;
        }
      }
      if (line) { page.drawText(line, { x: marginX, y, size, font: useFont }); y -= lineGap; }
    };

    drawText('AUTOCERTIFICAZIONE', { size: 14, useFont: bold, lineGap: 20 });
    drawText('per la richiesta di rimborso spese a pie di lista quale Volontario', { size: 11, useFont: bold, lineGap: 22 });
    drawWrapped(
      "resa ai sensi dell'articolo 46 del DPR 28 dicembre 2000, n. 445 e ai sensi dell'articolo 17 del D.Lgs 117/2017 comma 3",
      { size: 9 }
    );
    y -= 8;

    const birthDateFmt = user.birth_date ? new Date(user.birth_date).toLocaleDateString('it-IT') : '________';
    drawWrapped(
      'Il sottoscritto ' + (user.full_name || user.username) + ', nato a ' + (user.birth_place || '________') +
      ' il ' + birthDateFmt + ', Codice Fiscale ' + (user.fiscal_code || '________') +
      ", nella sua qualita' di volontario dell'ente denominato \"" + eventName + '"'
    );
    y -= 6;

    drawText('CERTIFICA', { size: 11, useFont: bold, lineGap: 18 });
    drawWrapped("- di essere iscritto nel Registro dei Volontari vidimato dell'ente sopra menzionato;");
    drawWrapped("- che a proprio carico e' stata stipulata apposita assicurazione come Volontario;");
    drawWrapped("- di non occuparsi di attivita' di volontariato aventi ad oggetto donazione di sangue e organi;");
    drawWrapped(
      '- di aver sostenuto' + (periodLabel ? ' per ' + periodLabel : '') +
      ' alcune spese, che sommate, sono di importo pari a EUR ' + totalAmount.toFixed(2) + ';'
    );
    drawWrapped("- che le pezze giustificative allegate assommano all'importo di cui sopra (dettaglio in calce).");
    y -= 6;

    drawText('RICHIEDE', { size: 11, useFont: bold, lineGap: 18 });
    drawWrapped('- il rimborso delle spese sopracitate;');
    drawWrapped("- che il rimborso avvenga tramite bonifico bancario all'IBAN: " + (iban || '________________________'));
    y -= 14;

    drawText('Luogo e data: _________________, ' + new Date().toLocaleDateString('it-IT'), { size: 10 });
    y -= 10;
    drawText('Firma del volontario: _________________________', { size: 10 });
    y -= 24;

    drawText('DETTAGLIO SPESE ALLEGATE', { size: 11, useFont: bold, lineGap: 18 });
    for (const e of expenses) {
      const dateFmt = new Date(e.expense_date).toLocaleDateString('it-IT');
      drawWrapped('- ' + dateFmt + ' — ' + e.description + ' — EUR ' + e.amount.toFixed(2), { size: 9, lineGap: 13 });
    }
    y -= 4;
    drawText('TOTALE: EUR ' + totalAmount.toFixed(2), { size: 10, useFont: bold });

    const bytes = await pdfDoc.save();
    const dir = path.join(DATA_DIR, 'personal_uploads', 'refunds');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = 'rimborso_' + requestId + '_' + Date.now() + '.pdf';
    fs.writeFileSync(path.join(dir, fileName), bytes);
    return fileName;
  }

  app.get('/area-personale/rimborsi', requireAuth, requireAccounting, async (req, res) => {
    const statusFilter = req.query.stato || 'tutte';
    let sql = `SELECT rr.*, u.username, e.name AS edition_name, e.year AS edition_year,
                      ru.username AS reviewer_name
               FROM refund_requests rr
               JOIN users u ON u.id = rr.user_id
               LEFT JOIN editions e ON e.id = rr.edition_id
               LEFT JOIN users ru ON ru.id = rr.reviewed_by
               WHERE 1=1`;
    const params = [];
    if (statusFilter !== 'tutte') { sql += ' AND rr.status=?'; params.push(statusFilter); }
    sql += " ORDER BY CASE rr.status WHEN 'in_attesa' THEN 0 ELSE 1 END, rr.created_at DESC";
    try {
      const requests = await dbAll(sql, params);
      res.render('area_personale_rimborsi_admin', { requests: requests || [], statusFilter });
    } catch (err) {
      res.status(500).send('Errore caricamento rimborsi: ' + err.message);
    }
  });

  app.post('/area-personale/rimborsi/:id/stato', requireAuth, requireAccounting, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status, review_notes } = req.body;
    if (!['approvata', 'rifiutata'].includes(status)) return res.status(400).send('Stato non valido');
    try {
      await dbRun(
        "UPDATE refund_requests SET status=?, reviewed_by=?, reviewed_at=datetime('now','localtime'), review_notes=? WHERE id=?",
        [status, req.session.user.id, review_notes || null, id]
      );
      logAction(req.session.user.id, 'review_refund_request', 'refund_request', id, 'Richiesta rimborso #' + id + ' -> ' + status);
      res.redirect('/area-personale/rimborsi');
    } catch (err) {
      res.status(500).send('Errore aggiornamento stato: ' + err.message);
    }
  });

};
