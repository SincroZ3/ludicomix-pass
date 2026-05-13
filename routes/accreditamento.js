/**
 * routes/accreditamento.js
 * ──────────────────────────────────────────────────────────────────
 * Form pubblici accreditamento (espositori, media, generico) +
 * dashboard admin approvazione/rifiuto.
 *
 * Route registrate:
 *   GET  /richiesta-accreditamento
 *   GET  /richiesta-accreditamento/espositori
 *   GET  /richiesta-accreditamento/media
 *   POST /richiesta-accreditamento
 *   POST /richiesta-accreditamento/espositori
 *   POST /richiesta-accreditamento/media
 *   GET  /admin/accreditamento
 *   GET  /admin/hub
 *   POST /admin/accreditamento/:id/approva
 *   POST /admin/accreditamento/:id/rifiuta
 * ──────────────────────────────────────────────────────────────────
 */

const crypto    = require('crypto');
const { promisify } = require('util');

const ACC_TYPE_LABEL = {
  espositore:      '🏪 Espositore',
  stampa:          '📰 Stampa/Media',
  autore:          '✍️ Autore',
  content_creator: '🎥 Content Creator',
};

module.exports = function registerAccreditamentoRoutes(
  app, db,
  { requireAuth, requireOrganizer,
    logAction, edVal, edFilter,
    createNotification, trySendEmail }
) {
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

  // ── Form pubblici (no auth) ──────────────────────────────────────
  app.get('/richiesta-accreditamento', (req, res) =>
    res.render('accreditation-request', { sent: req.query.sent || null, error: req.query.error || null }));

  app.get('/richiesta-accreditamento/espositori', (req, res) =>
    res.render('accreditation-request-espositori', { sent: req.query.sent || null, error: req.query.error || null }));

  app.get('/richiesta-accreditamento/media', (req, res) =>
    res.render('accreditation-request-media', { sent: req.query.sent || null, error: req.query.error || null }));

  // ── Helper invio DB + email ──────────────────────────────────────
  async function insertRequest(fields) {
    await dbRun(
      `INSERT INTO accreditation_requests
        (company_name, contact_name, email, phone, stand_type, stand_size,
         accreditation_type, media_outlet, press_role, publisher, genre,
         channel_url, platform, subscribers, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [fields.company_name, fields.contact_name, fields.email, fields.phone || null,
       fields.stand_type || null, fields.stand_size || null,
       fields.accreditation_type || 'espositore',
       fields.media_outlet || null, fields.press_role || null,
       fields.publisher || null, fields.genre || null,
       fields.channel_url || null, fields.platform || null, fields.subscribers || null,
       fields.notes || null]
    );
    createNotification(
      'accreditation', 'Nuova richiesta accreditamento',
      `<strong>${fields.company_name}</strong> (${fields.contact_name}) ha inviato una richiesta di accreditamento.`,
      null, null
    );
  }

  function buildEmailBody(fields) {
    const label = ACC_TYPE_LABEL[fields.accreditation_type] || fields.accreditation_type;
    const BASE  = process.env.BASE_URL || '';
    return `<p>${label} <strong>${fields.company_name}</strong> — ${fields.contact_name} (${fields.email})</p>` +
      (fields.stand_type  ? `<p>Stand: ${fields.stand_type} — ${fields.stand_size || 'n/d'}</p>` : '') +
      (fields.media_outlet ? `<p>Testata: ${fields.media_outlet}${fields.press_role ? ` (${fields.press_role})` : ''}</p>` : '') +
      (fields.channel_url  ? `<p>Canale: <a href="${fields.channel_url}">${fields.channel_url}</a> (${fields.platform || '?'}, ${fields.subscribers || '?'} follower)</p>` : '') +
      (fields.publisher    ? `<p>Editore: ${fields.publisher}${fields.genre ? ` — ${fields.genre}` : ''}</p>` : '') +
      (fields.notes        ? `<p>Note: ${fields.notes}</p>` : '') +
      `<p><a href="${BASE}/admin/accreditamento">→ Gestisci richieste</a></p>`;
  }

  // ── POST generico ────────────────────────────────────────────────
  app.post('/richiesta-accreditamento', async (req, res) => {
    const { company_name, contact_name, email } = req.body;
    if (!company_name || !contact_name || !email) {
      return res.redirect('/richiesta-accreditamento?error=campi_obbligatori');
    }
    try {
      const fields = { ...req.body, company_name: company_name.trim(), contact_name: contact_name.trim(), email: email.trim().toLowerCase() };
      await insertRequest(fields);
      trySendEmail('Nuova richiesta accreditamento — ' + (ACC_TYPE_LABEL[fields.accreditation_type] || ''), buildEmailBody(fields));
      res.redirect('/richiesta-accreditamento?sent=1');
    } catch (e) {
      console.error('Errore invio accreditamento:', e.message);
      res.redirect('/richiesta-accreditamento?error=db');
    }
  });

  // ── POST espositori ──────────────────────────────────────────────
  app.post('/richiesta-accreditamento/espositori', async (req, res) => {
    const { company_name, contact_name, email } = req.body;
    if (!company_name || !contact_name || !email) {
      return res.redirect('/richiesta-accreditamento/espositori?error=campi_obbligatori');
    }
    try {
      const fields = { ...req.body, company_name: company_name.trim(), contact_name: contact_name.trim(), email: email.trim().toLowerCase() };
      await insertRequest(fields);
      trySendEmail('Nuova richiesta — ' + (ACC_TYPE_LABEL[fields.accreditation_type || 'espositore'] || ''), buildEmailBody(fields));
      res.redirect('/richiesta-accreditamento/espositori?sent=1');
    } catch (e) {
      console.error('Errore invio accreditamento espositori:', e.message);
      res.redirect('/richiesta-accreditamento/espositori?error=db');
    }
  });

  // ── POST media ───────────────────────────────────────────────────
  app.post('/richiesta-accreditamento/media', async (req, res) => {
    const { company_name, contact_name, email } = req.body;
    if (!company_name || !contact_name || !email) {
      return res.redirect('/richiesta-accreditamento/media?error=campi_obbligatori');
    }
    try {
      const fields = { ...req.body, company_name: company_name.trim(), contact_name: contact_name.trim(), email: email.trim().toLowerCase() };
      await insertRequest(fields);
      trySendEmail('Nuova richiesta — ' + (ACC_TYPE_LABEL[fields.accreditation_type || 'stampa'] || ''), buildEmailBody(fields));
      res.redirect('/richiesta-accreditamento/media?sent=1');
    } catch (e) {
      console.error('Errore invio accreditamento media:', e.message);
      res.redirect('/richiesta-accreditamento/media?error=db');
    }
  });

  // ── Admin Hub ────────────────────────────────────────────────────
  app.get('/admin/hub', requireAuth, requireOrganizer, (req, res) => {
    res.render('admin_hub', { currentUser: req.session.user });
  });

  // ── Dashboard admin accreditamento ──────────────────────────────
  app.get('/admin/accreditamento', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const requests = await dbAll(
        `SELECT ar.*, u.username AS reviewer_name
         FROM accreditation_requests ar
         LEFT JOIN users u ON u.id = ar.reviewed_by
         ORDER BY CASE ar.status WHEN 'in_attesa' THEN 0 ELSE 1 END, ar.created_at DESC`
      );
      const groups = await dbAll('SELECT id, name FROM groups ORDER BY priority, name');
      res.render('admin-accreditamento', { requests, groups, saved: req.query.saved || null });
    } catch (e) {
      res.status(500).send('Errore interno: ' + e.message);
    }
  });

  // ── Approva richiesta ────────────────────────────────────────────
  app.post('/admin/accreditamento/:id/approva', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { group_id, zone, stand_name, max_passes } = req.body;
    try {
      const request = await dbGet('SELECT * FROM accreditation_requests WHERE id=?', [id]);
      if (!request) return res.status(404).send('Richiesta non trovata');
      const portalToken = crypto.randomBytes(24).toString('hex');

      const isExhibitor = ['espositore', 'associazione'].includes((request.accreditation_type || 'espositore').toLowerCase());
      const resolvedStand  = isExhibitor ? (stand_name || request.company_name) : null;
      const resolvedZone   = isExhibitor ? (zone || null) : null;
      const resolvedPasses = max_passes ? parseInt(max_passes, 10) : (isExhibitor ? null : 1);

      const result = await dbRun(
        `INSERT INTO assignment_groups
          (name, group_id, zone, stand_name, max_passes, email, portal_token, portal_enabled, contract_status, edition_id)
         VALUES (?,?,?,?,?,?,?,1,'bozza',?)`,
        [request.company_name, group_id ? parseInt(group_id, 10) : null,
         resolvedZone, resolvedStand, resolvedPasses,
         request.email, portalToken, edVal()]
      );

      await dbRun(
        'INSERT INTO contacts (assignment_group_id, name, email, phone, role, is_primary) VALUES (?,?,?,?,?,1)',
        [result.lastID, request.contact_name, request.email,
         request.phone || null, 'Referente principale']
      );
      await dbRun(
        `UPDATE accreditation_requests
         SET status='portale_attivato', reviewed_by=?, reviewed_at=datetime('now','localtime'), assignment_group_id=?
         WHERE id=?`,
        [req.session.user.id, result.lastID, id]
      );
      const BASE = process.env.BASE_URL || '';
      trySendEmail(
        'Accreditamento approvato — ' + request.company_name,
        `<p>Gentile <strong>${request.contact_name}</strong>,</p>
         <p>La richiesta di accreditamento per <strong>${request.company_name}</strong> è stata approvata!</p>
         <p>Accedi al tuo portale espositore: <a href="${BASE}/portale/${portalToken}">${BASE}/portale/${portalToken}</a></p>
         <p>Con questo link potrai inserire i nominativi degli accreditati e scaricare i pass.</p>`
      );
      logAction(req.session.user.id, 'approve_accreditation', 'accreditation_request', id,
        `Approvata richiesta ${request.company_name} → gruppo ${result.lastID}`);
      res.redirect('/admin/accreditamento?saved=approvato');
    } catch (e) {
      console.error('Errore approvazione accreditamento:', e.message);
      res.status(500).send('Errore: ' + e.message);
    }
  });

  // ── Rifiuta richiesta ────────────────────────────────────────────
  app.post('/admin/accreditamento/:id/rifiuta', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rejection_reason } = req.body;
    try {
      const request = await dbGet('SELECT * FROM accreditation_requests WHERE id=?', [id]);
      if (!request) return res.status(404).send('Richiesta non trovata');
      await dbRun(
        `UPDATE accreditation_requests
         SET status='rifiutato', reviewed_by=?, reviewed_at=datetime('now','localtime'), rejection_reason=?
         WHERE id=?`,
        [req.session.user.id, rejection_reason || null, id]
      );
      trySendEmail(
        'Aggiornamento sulla tua richiesta di accreditamento',
        `<p>Gentile <strong>${request.contact_name}</strong>,</p>
         <p>La richiesta di accreditamento per <strong>${request.company_name}</strong> non ha potuto essere accettata.</p>
         ${rejection_reason ? `<p>Motivazione: ${rejection_reason}</p>` : ''}
         <p>Per informazioni puoi rispondere a questa email.</p>`
      );
      logAction(req.session.user.id, 'reject_accreditation', 'accreditation_request', id,
        'Rifiutata richiesta ' + request.company_name);
      res.redirect('/admin/accreditamento?saved=rifiutato');
    } catch (e) {
      console.error('Errore rifiuto accreditamento:', e.message);
      res.status(500).send('Errore: ' + e.message);
    }
  });

  // ── Fix temporaneo: migra status 'approvato' → 'portale_attivato' ──────────
  // Chiamare UNA VOLTA da browser: GET /admin/accreditamento/fix-status-approvato
  // Può essere rimossa dopo l'uso.
  app.get('/admin/accreditamento/fix-status-approvato', requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await dbRun(
        `UPDATE accreditation_requests SET status='portale_attivato' WHERE status='approvato'`
      );
      const count = result.changes ?? 0;
      res.send(`
        <h2>&#x2705; Fix completato</h2>
        <p>Richieste migrate da <code>approvato</code> a <code>portale_attivato</code>: <strong>${count}</strong></p>
        <a href="/admin/accreditamento">&#8592; Torna alla dashboard accreditamenti</a>
      `);
    } catch (e) {
      res.status(500).send('Errore: ' + e.message);
    }
  });

};
