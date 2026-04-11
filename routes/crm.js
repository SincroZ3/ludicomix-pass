/**
 * routes/crm.js — Montato automaticamente da server.js via:
 *   require('./routes/crm')(app, db, { requireAuth, requireNotViewer, requireOrganizer, logAction, uploadMemory });
 */
const path = require('path');
const fs   = require('fs');

const CONTRACT_STATUSES = ['bozza', 'inviato', 'firmato', 'annullato'];
const PAYMENT_STATUSES  = ['da_pagare', 'acconto', 'saldato', 'scaduto'];

module.exports = function(app, db, deps) {
  const { requireAuth, requireNotViewer, requireOrganizer, logAction, uploadMemory } = deps;

  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
  const DOCS_DIR = path.join(DATA_DIR, 'group_docs');
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

  const qAll = (sql, p) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
  const qGet = (sql, p) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
  const qRun = (sql, p) => new Promise((res, rej) => db.run(sql, p, function(e) { e ? rej(e) : res(this); }));

  // ═══════════════════════════════ REFERENTI ═══════════════════════════════ //

  app.post('/assignment-groups/:id/contacts', requireAuth, requireNotViewer, async (req, res) => {
    const gid = parseInt(req.params.id, 10);
    const { name, role, email, phone, is_primary } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome obbligatorio' });
    try {
      if (is_primary === '1') await qRun('UPDATE contacts SET is_primary=0 WHERE assignment_group_id=?', [gid]);
      const r = await qRun(
        'INSERT INTO contacts (assignment_group_id, name, role, email, phone, is_primary) VALUES (?,?,?,?,?,?)',
        [gid, name.trim(), role || null, email || null, phone || null, is_primary === '1' ? 1 : 0]
      );
      logAction(req.session.user.id, 'create_contact', 'contact', r.lastID, `Referente "${name}" gruppo ${gid}`);
      res.json({ ok: true, id: r.lastID });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/assignment-groups/:id/contacts/:cid/primary', requireAuth, requireNotViewer, async (req, res) => {
    const gid = parseInt(req.params.id, 10), cid = parseInt(req.params.cid, 10);
    try {
      await qRun('UPDATE contacts SET is_primary=0 WHERE assignment_group_id=?', [gid]);
      await qRun('UPDATE contacts SET is_primary=1 WHERE id=? AND assignment_group_id=?', [cid, gid]);
      logAction(req.session.user.id, 'set_primary_contact', 'contact', cid, `Primario gruppo ${gid}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/assignment-groups/:id/contacts/:cid/delete', requireAuth, requireNotViewer, async (req, res) => {
    const gid = parseInt(req.params.id, 10), cid = parseInt(req.params.cid, 10);
    try {
      await qRun('DELETE FROM contacts WHERE id=? AND assignment_group_id=?', [cid, gid]);
      logAction(req.session.user.id, 'delete_contact', 'contact', cid, `Eliminato da gruppo ${gid}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ═══════════════════════════════ PAGAMENTI ═══════════════════════════════ //

  app.post('/assignment-groups/:id/payments', requireAuth, requireNotViewer, async (req, res) => {
    const gid = parseInt(req.params.id, 10);
    const { description, amount, status, due_date, notes } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: 'Descrizione obbligatoria' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Importo non valido' });
    const st = PAYMENT_STATUSES.includes(status) ? status : 'da_pagare';
    try {
      const r = await qRun(
        'INSERT INTO payments (assignment_group_id, description, amount, status, due_date, notes) VALUES (?,?,?,?,?,?)',
        [gid, description.trim(), amt, st, due_date || null, notes || null]
      );
      logAction(req.session.user.id, 'create_payment', 'payment', r.lastID, `"${description}" €${amt} gruppo ${gid}`);
      res.json({ ok: true, id: r.lastID });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/assignment-groups/:id/payments/:pid/status', requireAuth, requireNotViewer, async (req, res) => {
    const gid = parseInt(req.params.id, 10), pid = parseInt(req.params.pid, 10);
    const { status } = req.body;
    if (!PAYMENT_STATUSES.includes(status)) return res.status(400).json({ error: 'Stato non valido' });
    const paid_at = status === 'saldato' ? new Date().toISOString().slice(0, 10) : null;
    try {
      await qRun('UPDATE payments SET status=?, paid_at=? WHERE id=? AND assignment_group_id=?', [status, paid_at, pid, gid]);
      logAction(req.session.user.id, 'update_payment_status', 'payment', pid, `Stato → ${status}`);
      res.json({ ok: true, paid_at });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/assignment-groups/:id/payments/:pid/delete', requireAuth, requireOrganizer, async (req, res) => {
    const gid = parseInt(req.params.id, 10), pid = parseInt(req.params.pid, 10);
    try {
      await qRun('DELETE FROM payments WHERE id=? AND assignment_group_id=?', [pid, gid]);
      logAction(req.session.user.id, 'delete_payment', 'payment', pid, `Eliminato da gruppo ${gid}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ══════════════════════════ STATO CONTRATTUALE ═══════════════════════════ //

  app.post('/assignment-groups/:id/contract-status', requireAuth, requireOrganizer, async (req, res) => {
    const gid = parseInt(req.params.id, 10), status = req.body.contract_status;
    if (!CONTRACT_STATUSES.includes(status)) return res.status(400).json({ error: 'Stato non valido' });
    try {
      await qRun('UPDATE assignment_groups SET contract_status=? WHERE id=?', [status, gid]);
      logAction(req.session.user.id, 'update_contract_status', 'assignment_group', gid, `Contratto → ${status}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ════════════════════════ DOCUMENTI INTERNI ADMIN ════════════════════════ //

  app.post('/assignment-groups/:id/documents', requireAuth, requireNotViewer,
    uploadMemory.single('docfile'), async (req, res) => {
    const gid = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const ext = path.extname(req.file.originalname) || '';
    const safeName = 'grp' + gid + '_' + Date.now() + ext;
    try {
      await fs.promises.writeFile(path.join(DOCS_DIR, safeName), req.file.buffer);
      const r = await qRun(
        'INSERT INTO group_documents (assignment_group_id, filename, original_name, doc_type, uploaded_by, notes) VALUES (?,?,?,?,?,?)',
        [gid, safeName, req.file.originalname, req.body.doc_type || 'altro', req.session.user.id, req.body.notes || null]
      );
      logAction(req.session.user.id, 'upload_group_doc', 'group_document', r.lastID, `"${req.file.originalname}" gruppo ${gid}`);
      res.json({ ok: true, id: r.lastID, original: req.file.originalname });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/assignment-groups/:id/documents/:did/download', requireAuth, async (req, res) => {
    const gid = parseInt(req.params.id, 10), did = parseInt(req.params.did, 10);
    try {
      const doc = await qGet('SELECT * FROM group_documents WHERE id=? AND assignment_group_id=?', [did, gid]);
      if (!doc) return res.status(404).send('Documento non trovato');
      res.download(path.join(DOCS_DIR, doc.filename), doc.original_name || doc.filename);
    } catch(e) { res.status(500).send(e.message); }
  });

  app.post('/assignment-groups/:id/documents/:did/delete', requireAuth, requireOrganizer, async (req, res) => {
    const gid = parseInt(req.params.id, 10), did = parseInt(req.params.did, 10);
    try {
      const doc = await qGet('SELECT * FROM group_documents WHERE id=? AND assignment_group_id=?', [did, gid]);
      if (!doc) return res.status(404).json({ error: 'Non trovato' });
      await qRun('DELETE FROM group_documents WHERE id=?', [did]);
      fs.unlink(path.join(DOCS_DIR, doc.filename), () => {});
      logAction(req.session.user.id, 'delete_group_doc', 'group_document', did, `Eliminato da gruppo ${gid}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ═══════════════════════════ FINESTRA PORTALE ════════════════════════════ //

  app.post('/admin/groups/:id/portal/window', requireAuth, requireOrganizer, async (req, res) => {
    const gid = parseInt(req.params.id, 10);
    const openFrom  = req.body.portal_open_from  || null;
    const openUntil = req.body.portal_open_until || null;
    try {
      await qRun('UPDATE assignment_groups SET portal_open_from=?, portal_open_until=? WHERE id=?', [openFrom, openUntil, gid]);
      logAction(req.session.user.id, 'set_portal_window', 'assignment_group', gid,
        `Finestra: ${openFrom || 'sempre'} → ${openUntil || 'sempre'}`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ════════════════════════════════════════════════════════════════
  // DOCUMENTI DAL PORTALE ESPOSITORE
  // ════════════════════════════════════════════════════════════════

  const PORTAL_DOCS_DIR = path.join(DATA_DIR, 'portal_docs');
  if (!fs.existsSync(PORTAL_DOCS_DIR)) fs.mkdirSync(PORTAL_DOCS_DIR, { recursive: true });

  app.post('/portale/:token/documents', uploadMemory.single('docfile'), async (req, res) => {
    const token = req.params.token;
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    try {
      const group = await qGet('SELECT * FROM assignment_groups WHERE portal_token=? AND portal_enabled=1', [token]);
      if (!group) return res.status(403).json({ error: 'Portale non valido' });

      // Controllo finestra temporale
      const now = new Date().toISOString().slice(0, 16);
      if (group.portal_open_from && now < group.portal_open_from) return res.status(403).json({ error: 'Portale non ancora aperto' });
      if (group.portal_open_until && now > group.portal_open_until) return res.status(403).json({ error: 'Finestra inserimento chiusa' });

      const ext = path.extname(req.file.originalname) || '';
      const safeName = 'pdoc_' + group.id + '_' + Date.now() + ext;
      await fs.promises.writeFile(path.join(PORTAL_DOCS_DIR, safeName), req.file.buffer);
      await qRun(
        'INSERT INTO portal_documents (assignment_group_id, doc_type, filename, original_name) VALUES (?,?,?,?)',
        [group.id, req.body.doc_type || 'altro', safeName, req.file.originalname]
      );
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Download documento portale (solo admin/organizer)
  app.get('/admin/portal-docs/:id/download', requireAuth, async (req, res) => {
    try {
      const doc = await qGet('SELECT * FROM portal_documents WHERE id=?', [parseInt(req.params.id, 10)]);
      if (!doc) return res.status(404).send('Non trovato');
      res.download(path.join(PORTAL_DOCS_DIR, doc.filename), doc.original_name || doc.filename);
    } catch(e) { res.status(500).send(e.message); }
  });

  // Aggiorna stato revisione documento portale
  app.post('/admin/portal-docs/:id/review', requireAuth, requireOrganizer, async (req, res) => {
    const did = parseInt(req.params.id, 10);
    const { status, review_notes } = req.body;
    const allowed = ['ricevuto', 'in_revisione', 'approvato', 'rifiutato'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Stato non valido' });
    try {
      await qRun(
        'UPDATE portal_documents SET status=?, reviewed_by=?, reviewed_at=datetime("now"), review_notes=? WHERE id=?',
        [status, req.session.user.id, review_notes || null, did]
      );
      logAction(req.session.user.id, 'review_portal_doc', 'portal_document', did, `Stato → ${status}`);
      // Redirect back alla pagina del gruppo (la form usa submit sincrono)
      const ref = req.get('Referer') || '/';
      res.redirect(ref);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ════════════════════════════════════════════════════════════════
  // TICKET SUPPORTO — lato portale espositore
  // ════════════════════════════════════════════════════════════════

  app.post('/portale/:token/tickets', async (req, res) => {
    const token = req.params.token;
    const { subject, message } = req.body;
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'Oggetto obbligatorio' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'Messaggio obbligatorio' });
    try {
      const group = await qGet('SELECT * FROM assignment_groups WHERE portal_token=? AND portal_enabled=1', [token]);
      if (!group) return res.status(403).json({ error: 'Portale non valido' });
      // Max 3 ticket aperti per stand
      const openCount = await qGet('SELECT COUNT(*) as n FROM support_tickets WHERE assignment_group_id=? AND status="aperto"', [group.id]);
      if (openCount && openCount.n >= 3) return res.status(400).json({ error: 'Massimo 3 richieste aperte contemporaneamente' });
      await qRun(
        'INSERT INTO support_tickets (assignment_group_id, portal_token, subject, message) VALUES (?,?,?,?)',
        [group.id, token, subject.trim(), message.trim()]
      );
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/portale/:token/tickets/:tid/reply', async (req, res) => {
    const token = req.params.token;
    const tid   = parseInt(req.params.tid, 10);
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Messaggio vuoto' });
    try {
      const group  = await qGet('SELECT * FROM assignment_groups WHERE portal_token=? AND portal_enabled=1', [token]);
      if (!group) return res.status(403).json({ error: 'Non autorizzato' });
      const ticket = await qGet('SELECT * FROM support_tickets WHERE id=? AND assignment_group_id=? AND status="aperto"', [tid, group.id]);
      if (!ticket) return res.status(404).json({ error: 'Ticket non trovato o chiuso' });
      await qRun(
        'INSERT INTO ticket_replies (ticket_id, message, is_admin, author_name) VALUES (?,?,0,?)',
        [tid, message.trim(), group.name]
      );
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ADMIN — risponde a un ticket
  app.post('/admin/tickets/:tid/reply', requireAuth, requireNotViewer, async (req, res) => {
    const tid = parseInt(req.params.tid, 10);
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Messaggio vuoto' });
    try {
      const ticket = await qGet('SELECT * FROM support_tickets WHERE id=?', [tid]);
      if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
      await qRun(
        'INSERT INTO ticket_replies (ticket_id, message, is_admin, author_name) VALUES (?,?,1,?)',
        [tid, message.trim(), req.session.user.username || 'Staff']
      );
      logAction(req.session.user.id, 'ticket_reply', 'support_ticket', tid, `Risposta admin`);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ADMIN — chiude ticket
  app.post('/admin/tickets/:tid/close', requireAuth, requireNotViewer, async (req, res) => {
    const tid = parseInt(req.params.tid, 10);
    try {
      await qRun('UPDATE support_tickets SET status="chiuso", closed_at=datetime("now") WHERE id=?', [tid]);
      logAction(req.session.user.id, 'close_ticket', 'support_ticket', tid, 'Ticket chiuso');
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // API JSON — tutti i ticket di un gruppo (per la scheda admin)
  app.get('/api/assignment-groups/:id/tickets', requireAuth, async (req, res) => {
    const gid = parseInt(req.params.id, 10);
    try {
      const tickets = await qAll('SELECT * FROM support_tickets WHERE assignment_group_id=? ORDER BY created_at DESC', [gid]);
      for (const t of tickets) {
        t.replies = await qAll('SELECT * FROM ticket_replies WHERE ticket_id=? ORDER BY created_at ASC', [t.id]);
      }
      const portalDocs = await qAll('SELECT * FROM portal_documents WHERE assignment_group_id=? ORDER BY uploaded_at DESC', [gid]);
      res.json({ tickets, portalDocs });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

};