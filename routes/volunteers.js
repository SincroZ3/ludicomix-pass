/**
 * routes/volunteers.js
 * ──────────────────────────────────────────────────────────────────
 * Gestione volontari: lista, aggiunta, modifica, delete,
 * form pubblico candidatura, accept/reject, storico.
 * ──────────────────────────────────────────────────────────────────
 */

const { promisify } = require('util');
const nodemailer    = require('nodemailer');

module.exports = function registerVolunteersRoutes(
  app, db,
  { requireAuth, requireOrganizer, requireNotViewer, logAction, trySendEmail, getCurrentEdition }
) {
  const dbGet = promisify(db.get.bind(db));
  const dbAll = promisify(db.all.bind(db));

  // ── Helper: editionId corrente (fallback sicuro) ─────────────────
  async function resolveEditionId() {
    const cur = getCurrentEdition?.();
    if (cur?.id) return cur.id;
    const row = await dbGet('SELECT id FROM editions WHERE is_current=1 LIMIT 1') ||
                await dbGet('SELECT id FROM editions ORDER BY id DESC LIMIT 1');
    return row?.id ?? 1;
  }

  // ── Helper: carica settings SMTP ────────────────────────────────
  async function loadSmtp() {
    const rows = await dbAll("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'");
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  // ── Helper: invia email con SMTP da settings ─────────────────────
  async function sendEmailViaSmtp(to, subject, html, eventName) {
    const c = await loadSmtp();
    if (!c.smtp_host) return;
    const transporter = nodemailer.createTransport({
      host: c.smtp_host, port: parseInt(c.smtp_port || '587', 10),
      secure: c.smtp_secure === '1',
      auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: c.smtp_from || 'noreply@ludicomix.it', to, subject, html,
    }).catch(e => console.error('[Volunteers email]', e.message));
  }

  // ── GET /volunteers ──────────────────────────────────────────────
  app.get('/volunteers', requireAuth, async (req, res) => {
    try {
      const [volunteers, pending, shifts, zones] = await Promise.all([
        dbAll(`
          SELECT v.*,
                 (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id) AS assignments_count,
                 (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id AND sa.checkin_at IS NOT NULL) AS checkins_count
          FROM volunteers v
          WHERE v.status NOT IN ('pending','rejected')
          ORDER BY v.last_name, v.first_name`),
        dbAll("SELECT * FROM volunteers WHERE status='pending' ORDER BY rowid DESC"),
        dbAll(`
          SELECT s.*, z.name AS zone_name,
                 (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
          FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
          ORDER BY s.start_at, s.name`),
        dbAll("SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal' OR zone_scope='both') ORDER BY sort_order, name"),
      ]);
      res.render('volunteers', {
        volunteers: volunteers || [],
        shifts:     shifts     || [],
        zones:      zones      || [],
        pending:    pending    || [],
      });
    } catch (err) {
      console.error('[Volunteers GET]', err.stack || err.message);
      res.status(500).type('text/plain').send('Errore caricamento volontari: ' + (err.message || err));
    }
  });

  // ── POST /volunteers — aggiungi ──────────────────────────────────
  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const { first_name, last_name, email, phone, notes, availability, skills, birth_date, birth_place, fiscal_code, residence } = req.body;
      if (!String(first_name || '').trim() || !String(last_name || '').trim())
        return res.status(400).send('Nome e cognome obbligatori');
      const edId = await resolveEditionId();
      db.run(
        `INSERT INTO volunteers
           (edition_id, first_name, last_name, email, phone, availability, skills,
            tshirt_size, status, notes, import_batch_id, active,
            birth_date, birth_place, fiscal_code, residence)
         VALUES (?,?,?,?,?,?,?,NULL,'pending',?,NULL,1,?,?,?,?)`,
        [edId, String(first_name).trim(), String(last_name).trim(), email || null, phone || null,
         availability || '', skills || '', notes || null,
         birth_date || null, birth_place || null,
         fiscal_code ? String(fiscal_code).toUpperCase().trim() : null,
         residence || null],
        function (err) {
          if (err) return res.status(500).send('Errore salvataggio volontario: ' + err.message);
          logAction(req.session.user.id, 'create_volunteer', 'volunteer', this.lastID, `Volontario ${first_name} ${last_name} creato`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      res.status(500).send('Errore: ' + (err.message || err));
    }
  });

  // ── POST /volunteers/:id/edit ────────────────────────────────────
  app.post('/volunteers/:id/edit', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const {
        first_name, last_name, email, phone, notes, availability, skills,
        active, status, birth_date, birth_place, fiscal_code, residence,
      } = req.body;
      db.run(
        `UPDATE volunteers SET
           first_name=?, last_name=?, email=?, phone=?,
           availability=?, skills=?, status=?, notes=?, active=?,
           birth_date=?, birth_place=?, fiscal_code=?, residence=?
         WHERE id=?`,
        [String(first_name || '').trim(), String(last_name || '').trim(),
         email || null, phone || null, availability || '', skills || '',
         status || 'pending', notes || null, active ? 1 : 0,
         birth_date || null, birth_place || null,
         fiscal_code ? String(fiscal_code).toUpperCase().trim() : null,
         residence || null, id],
        function (err) {
          if (err) return res.status(500).send('Errore aggiornamento volontario: ' + err.message);
          logAction(req.session.user.id, 'edit_volunteer', 'volunteer', id, `Volontario #${id} modificato`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      res.status(500).send('Errore: ' + (err.message || err));
    }
  });

  // ── POST /volunteers/:id/delete ──────────────────────────────────
  app.post('/volunteers/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM volunteers WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione volontario: ' + err.message);
      if (this.changes > 0) logAction(req.session.user.id, 'delete_volunteer', 'volunteer', id, `Volontario #${id} eliminato`);
      res.redirect('/volunteers');
    });
  });

  // ── GET /candidatura-volontario — form pubblico ──────────────────
  app.get('/candidatura-volontario', async (_req, res) => {
    try {
      const rows     = await dbAll("SELECT key,value FROM app_settings");
      const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
      res.render('candidatura_volontario', { eventName: settings.event_name || 'Ludicomix', sent: false, error: null });
    } catch {
      res.render('candidatura_volontario', { eventName: 'Ludicomix', sent: false, error: null });
    }
  });

  // ── POST /candidatura-volontario — submit form pubblico ──────────
  app.post('/candidatura-volontario', async (req, res) => {
    try {
      const rows     = await dbAll("SELECT key,value FROM app_settings");
      const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
      const eventName = settings.event_name || 'Ludicomix';

      const { first_name, last_name, email, phone, birth_date, birth_place, fiscal_code, residence, skills, availability, notes, privacy } = req.body;

      if (!String(first_name || '').trim() || !String(last_name || '').trim())
        return res.render('candidatura_volontario', { eventName, sent: false, error: 'Nome e cognome sono obbligatori.' });
      if (!email || !String(email).includes('@'))
        return res.render('candidatura_volontario', { eventName, sent: false, error: 'Inserisci un indirizzo email valido.' });
      if (!privacy)
        return res.render('candidatura_volontario', { eventName, sent: false, error: 'Devi accettare il trattamento dei dati personali per procedere.' });

      const edId = await resolveEditionId();
      const fn   = String(first_name).trim(), ln = String(last_name).trim();
      const fc   = fiscal_code ? String(fiscal_code).toUpperCase().trim() : null;

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO volunteers
             (edition_id, first_name, last_name, email, phone, availability, skills,
              status, notes, birth_date, birth_place, fiscal_code, residence, active, import_batch_id, tshirt_size)
           VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?,1,NULL,NULL)`,
          [edId, fn, ln, email || null, phone || null, availability || '', skills || '', notes || null,
           birth_date || null, birth_place || null, fc, residence || null],
          function (err) { err ? reject(err) : resolve(this.lastID); }
        );
      });

      // Email di conferma al candidato
      if (email) {
        sendEmailViaSmtp(email, `[${eventName}] Candidatura volontario ricevuta`,
          `<div style="font-family:sans-serif;max-width:560px">
             <h2 style="color:#1e2d4e">Grazie, ${fn}!</h2>
             <p>Abbiamo ricevuto la tua candidatura come volontario per <strong>${eventName}</strong>.</p>
             <p>La valuteremo al più presto e ti contatteremo a questo indirizzo email.</p>
             <hr style="border:none;border-top:1px solid #e2e8f0;margin:1.5rem 0">
             <p style="font-size:.85rem;color:#64748b">Non rispondere a questa email.</p>
           </div>`
        ).catch(() => {});
      }

      // Notifica agli organizzatori
      trySendEmail?.(`Nuova candidatura volontario — ${fn} ${ln}`,
        `<p>Nuova candidatura ricevuta dal form pubblico:</p>
         <table style="border-collapse:collapse;font-size:.9rem">
           <tr><td style="padding:.3rem .75rem;color:#64748b">Nome</td><td style="font-weight:600">${fn} ${ln}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Email</td><td>${email || '—'}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Telefono</td><td>${phone || '—'}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Competenze</td><td>${skills || '—'}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Disponibilità</td><td>${availability || '—'}</td></tr>
         </table>
         <p style="margin-top:1rem"><a href="/volunteers" style="background:#1e2d4e;color:#f5c842;padding:.5rem 1rem;border-radius:6px;text-decoration:none;font-weight:700">Vai alle candidature →</a></p>`
      );

      res.render('candidatura_volontario', { eventName, sent: true, error: null });
    } catch (err) {
      console.error('[Candidatura POST]', err.message);
      res.render('candidatura_volontario', { eventName: 'Ludicomix', sent: false, error: 'Errore interno — riprova tra qualche istante.' });
    }
  });

  // ── POST /volunteers/:id/accept ──────────────────────────────────
  app.post('/volunteers/:id/accept', requireAuth, requireNotViewer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const vol = await dbGet('SELECT * FROM volunteers WHERE id=?', [id]);
      if (!vol) return res.status(404).send('Volontario non trovato');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE volunteers SET status='approved', active=1,
           reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?`,
          [req.session.user.id, id],
          err => err ? reject(err) : resolve()
        );
      });
      logAction(req.session.user.id, 'accept_volunteer', 'volunteer', id, `Candidatura #${id} accettata`);
      if (vol.email) {
        const rows = await dbAll("SELECT key,value FROM app_settings");
        const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
        const eventName = settings.event_name || 'Ludicomix';
        sendEmailViaSmtp(vol.email, `[${eventName}] Candidatura accettata 🎉`,
          `<div style="font-family:sans-serif;max-width:560px">
             <h2 style="color:#065f46">Benvenuto/a nel team, ${vol.first_name}!</h2>
             <p>La tua candidatura come volontario per <strong>${eventName}</strong> è stata <strong>accettata</strong>.</p>
             <p>Ti contatteremo presto con maggiori dettagli sui turni e le attività.</p>
           </div>`
        ).catch(() => {});
      }
      res.redirect('/volunteers#candidature');
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  // ── POST /volunteers/:id/reject ──────────────────────────────────
  app.post('/volunteers/:id/reject', requireAuth, requireNotViewer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rejection_reason } = req.body;
    try {
      const vol = await dbGet('SELECT * FROM volunteers WHERE id=?', [id]);
      if (!vol) return res.status(404).send('Volontario non trovato');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE volunteers SET status='rejected', active=0,
           reviewed_by=?, reviewed_at=datetime('now','localtime'), rejection_reason=? WHERE id=?`,
          [req.session.user.id, rejection_reason || null, id],
          err => err ? reject(err) : resolve()
        );
      });
      logAction(req.session.user.id, 'reject_volunteer', 'volunteer', id, `Candidatura #${id} rifiutata`);
      if (vol.email) {
        const rows = await dbAll("SELECT key,value FROM app_settings");
        const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
        const eventName = settings.event_name || 'Ludicomix';
        sendEmailViaSmtp(vol.email, `[${eventName}] Aggiornamento sulla tua candidatura`,
          `<div style="font-family:sans-serif;max-width:560px">
             <h2 style="color:#1e2d4e">Gentile ${vol.first_name},</h2>
             <p>Grazie per esserti candidato/a come volontario per <strong>${eventName}</strong>.</p>
             <p>Purtroppo, in questa edizione non saremo in grado di accettare la tua candidatura.</p>
             ${rejection_reason ? `<p><em>Note: ${rejection_reason}</em></p>` : ''}
             <p>Speriamo di rivederti nelle prossime edizioni!</p>
           </div>`
        ).catch(() => {});
      }
      res.redirect('/volunteers#candidature');
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  // ── GET /volunteers/storico ──────────────────────────────────────
  app.get('/volunteers/storico', requireAuth, async (req, res) => {
    try {
      const history = await dbAll(`
        SELECT v.*, u.username AS reviewed_by_name
        FROM volunteers v
        LEFT JOIN users u ON u.id=v.reviewed_by
        WHERE v.status IN ('approved','rejected')
        ORDER BY v.reviewed_at DESC, v.id DESC
      `);
      res.render('volunteers_storico', { history: history || [] });
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });
};
