/**
 * routes/portale.js
 * ──────────────────────────────────────────────────────────────────
 * Portale espositore: pagina principale, nominativi, download pass,
 * service requests (logistica), bacheca, CRM ticket.
 *
 * Route registrate:
 *   GET  /portale/:token
 *   GET  /portale/:token/download/:passId
 *   GET  /portale/:token/download-auto/:apId
 *   POST /api/portale/:token/participants
 *   POST /api/portale/:token/participants/:pid/delete
 *   POST /api/portale/:token/service-request
 *   GET  /api/portale/:token/service-requests
 *   POST /portale/:token/bacheca/read          (già in bacheca.js — skip)
 *   GET  /api/portale/:token/unread            (già in bacheca.js — skip)
 * ──────────────────────────────────────────────────────────────────
 */

const path = require('path');
const fs   = require('fs');
const { promisify } = require('util');

// ── Helper: pagina "portale non disponibile" ─────────────────────
function portalClosedPage(msg, title = 'Portale non disponibile', emoji = '⏳', color = '#1e2d4e') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;margin:0}
    .b{background:#fff;border-radius:12px;padding:2.5rem 3rem;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:460px}
    h2{color:${color}}p{color:#64748b}
  </style></head><body><div class="b">
    <div style="font-size:3rem">${emoji}</div>
    <h2>${title}</h2>
    <p>${msg}</p>
  </div></body></html>`;
}

module.exports = function registerPortaleRoutes(
  app, db,
  { logAction, createNotification, getCurrent, triggerBatchPassOnClose }
) {
  const DATA_DIR = process.env.DATA_DIR || __dirname.replace('/routes', '');
  const dbGet    = promisify(db.get.bind(db));
  const dbAll    = promisify(db.all.bind(db));
  function dbRun(sql, ...p) {
    return new Promise((resolve, reject) => {
      const params = p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // ── Helper: verifica finestra temporale del portale ──────────────
  async function checkPortalWindow(group, res) {
    const now = new Date().toISOString().slice(0, 16);
    if (group.portal_open_from && now < group.portal_open_from) {
      const dt = new Date(group.portal_open_from).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' });
      res.send(portalClosedPage(`La finestra di accesso apre il <strong>${dt}</strong>`, 'Portale non ancora aperto', '⏳', '#1e2d4e'));
      return false;
    }
    if (group.portal_open_until && now > group.portal_open_until) {
      if (group.portal_status !== 'scaduto') {
        if (typeof triggerBatchPassOnClose === 'function') {
          triggerBatchPassOnClose(group.id).catch(e => console.error('[batchClose]', e.message));
        }
        try { await dbRun(`UPDATE assignment_groups SET portal_status='scaduto' WHERE id=?`, [group.id]); } catch (_) {}
      }
      const dt = new Date(group.portal_open_until).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' });
      res.send(portalClosedPage(
        `Il termine per i nominativi era il <strong>${dt}</strong>.<br>Contatta l'organizzazione per un'estensione.`,
        'Finestra inserimento chiusa', '🔒', '#c0392b'
      ));
      return false;
    }
    return true;
  }

  // ── GET /portale/:token ──────────────────────────────────────────
  app.get('/portale/:token', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet(
        `SELECT ag.*, g.name AS cat_name
         FROM assignment_groups ag
         LEFT JOIN groups g ON g.id = ag.group_id
         WHERE ag.portal_token=? AND ag.portal_enabled=1`,
        [token]
      );
      if (!group) {
        return res.status(404).send('<h2 style="font-family:sans-serif;padding:2rem">Portale non disponibile.</h2>');
      }

      // Controllo finestra temporale (solo per la pagina principale — non blocca il download)
      // (portale aperto → mostra tutto; chiuso → mostra solo messaggio)
      // NB: non blocchiamo la GET del portale per consentire il download dei pass già generati
      // la verifica finestra è applicata solo nelle API di inserimento nominativi

      const [parts, autoPasses, announcements, unreadRow, zoneInfo, zoneStands, refWRow, refHRow] =
        await Promise.all([
          dbAll(
            `SELECT pa.id AS participant_id, pa.first_name, pa.last_name, pa.email, pa.role,
                    p.id AS pass_id, p.code, p.status, pt.name AS type_name
             FROM participants pa
             LEFT JOIN passes p ON p.participant_id=pa.id AND p.status!='INVALIDATO'
             LEFT JOIN pass_types pt ON pt.id=p.pass_type_id
             WHERE pa.assignment_group_id=?
             ORDER BY pa.last_name, pa.first_name`,
            [group.id]
          ),
          dbAll(
            `SELECT * FROM auto_passes WHERE assignment_group_id=? AND status!='INVALIDATO' ORDER BY pass_number`,
            [group.id]
          ),
          dbAll(
            `SELECT a.*, CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS is_read
             FROM announcements a
             LEFT JOIN announcement_reads ar ON ar.announcement_id=a.id AND ar.portal_token=?
             WHERE (a.expires_at IS NULL OR a.expires_at > datetime('now','localtime'))
               AND (a.target_group_id IS NULL OR a.target_group_id = (
                 SELECT id FROM assignment_groups WHERE portal_token=? LIMIT 1
               ))
             ORDER BY a.is_pinned DESC, a.created_at DESC`,
            [token, token]
          ),
          dbGet(
            `SELECT COUNT(*) AS cnt FROM announcements a
             WHERE (a.expires_at IS NULL OR a.expires_at > datetime('now','localtime'))
               AND NOT EXISTS (
                 SELECT 1 FROM announcement_reads ar
                 WHERE ar.announcement_id=a.id AND ar.portal_token=?
               )`,
            [token]
          ),
          group.zone
            ? dbGet(`SELECT z.id, z.name, z.background_image FROM zones z WHERE z.name=? LIMIT 1`, [group.zone])
            : Promise.resolve(null),
          group.zone
            ? dbAll(
                `SELECT ag.id, ag.name AS stand_name, ag.stand_code,
                        ag.map_x, ag.map_y, ag.map_w, ag.map_h, ag.map_shape
                 FROM assignment_groups ag
                 WHERE ag.zone=? AND ag.map_x IS NOT NULL AND ag.map_y IS NOT NULL
                 ORDER BY ag.name`,
                [group.zone]
              )
            : Promise.resolve([]),
          dbGet(`SELECT value FROM app_settings WHERE key='map_ref_w'`, []),
          dbGet(`SELECT value FROM app_settings WHERE key='map_ref_h'`, []),
        ]);

      // CRM: documenti portale + ticket con risposte
      const [portalDocs, ticketsRaw] = await Promise.all([
        dbAll('SELECT * FROM portal_documents WHERE assignment_group_id=? ORDER BY uploaded_at DESC', [group.id]),
        dbAll('SELECT * FROM support_tickets  WHERE assignment_group_id=? ORDER BY created_at DESC',  [group.id]),
      ]);
      for (const t of ticketsRaw) {
        t.replies = await dbAll('SELECT * FROM ticket_replies WHERE ticket_id=? ORDER BY created_at ASC', [t.id]);
      }

      const logisticCategories = await dbAll('SELECT * FROM logistic_categories ORDER BY sort_order, label').catch(() => []);

      res.render('portale', {
        group,
        token,
        parts:              parts              || [],
        autoPasses:         autoPasses         || [],
        announcements:      announcements      || [],
        unreadCount:        unreadRow ? unreadRow.cnt : 0,
        zoneInfo:           zoneInfo           || null,
        zoneStands:         zoneStands         || [],
        mapRefW:            (refWRow?.value)   ? parseInt(refWRow.value, 10)  : null,
        mapRefH:            (refHRow?.value)   ? parseInt(refHRow.value, 10)  : null,
        portalDocs:         portalDocs         || [],
        tickets:            ticketsRaw         || [],
        logisticCategories: logisticCategories || [],
      });
    } catch (err) {
      console.error('Errore GET /portale/:token:', err);
      res.status(500).send('Errore interno');
    }
  });

  // ── Download pass nominativo dal portale ─────────────────────────
  app.get('/portale/:token/download/:passId', (req, res) => {
    db.get(
      `SELECT ag.portal_enabled
       FROM assignment_groups ag
       JOIN participants pa ON pa.assignment_group_id=ag.id
       JOIN passes p ON p.participant_id=pa.id
       WHERE ag.portal_token=? AND p.id=?`,
      [req.params.token, req.params.passId],
      (err, row) => {
        if (err || !row || !row.portal_enabled) return res.status(403).send('Accesso negato');
        res.redirect('/passes/' + req.params.passId + '/download?portal_token=' + req.params.token);
      }
    );
  });

  // ── Download auto-pass (parcheggio) dal portale ──────────────────
  app.get('/portale/:token/download-auto/:apId', (req, res) => {
    db.get(
      `SELECT ag.portal_enabled, ag.id AS group_id, ag.name AS group_name,
              ap.pdf_file, ap.pass_number, ap.total_passes, ap.status
       FROM auto_passes ap
       JOIN assignment_groups ag ON ag.id=ap.assignment_group_id
       WHERE ag.portal_token=? AND ap.id=? AND ap.status!='INVALIDATO'`,
      [req.params.token, req.params.apId],
      (err, row) => {
        if (err || !row || !row.portal_enabled) return res.status(403).send('Accesso negato');
        const fpath = path.join(DATA_DIR, 'generated', row.pdf_file || '');
        if (!fs.existsSync(fpath)) return res.status(404).send('File non trovato');
        if (row.status === 'GENERATO') {
          db.run("UPDATE auto_passes SET status='SCARICATO' WHERE id=?", [req.params.apId]);
          db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [req.params.apId, 'SCARICATO', null]);
        }
        logAction(null, 'portal_download_auto_pass', 'auto_pass', req.params.apId,
          `Pass parcheggio n.${row.pass_number}/${row.total_passes} scaricato dal portale (${row.group_name})`);
        res.download(fpath, `pass_parcheggio_${row.pass_number}_di_${row.total_passes}.pdf`);
      }
    );
  });

  // ── POST nominativo dal portale ──────────────────────────────────
  app.post('/api/portale/:token/participants', async (req, res) => {
    const token = req.params.token;
    const { firstname, lastname, role } = req.body;
    if (!firstname || !lastname) return res.status(400).json({ error: 'Nome e cognome obbligatori' });
    try {
      const group = await dbGet(
        'SELECT id, max_passes, portal_open_from, portal_open_until FROM assignment_groups WHERE portal_token=? AND portal_enabled=1',
        [token]
      );
      if (!group) return res.status(404).json({ error: 'Portale non disponibile' });

      const now = new Date().toISOString().slice(0, 16);
      if (group.portal_open_from  && now < group.portal_open_from)  return res.status(403).json({ error: 'Portale non ancora aperto' });
      if (group.portal_open_until && now > group.portal_open_until) return res.status(403).json({ error: 'Finestra inserimento chiusa' });

      if (group.max_passes !== null) {
        const cnt = await dbGet('SELECT COUNT(*) AS c FROM participants WHERE assignment_group_id=?', [group.id]);
        if (cnt && cnt.c >= group.max_passes) return res.status(400).json({ error: 'Limite massimo di pass raggiunto' });
      }

      const dup = await dbGet(
        'SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',
        [firstname.toLowerCase(), lastname.toLowerCase(), group.id]
      );
      if (dup) return res.status(409).json({ error: 'Nominativo già presente' });

      const result = await dbRun(
        'INSERT INTO participants (first_name, last_name, role, assignment_group_id) VALUES (?,?,?,?)',
        [firstname.trim(), lastname.trim(), role || null, group.id]
      );
      logAction(null, 'portal_add_participant', 'participant', result.lastID,
        `Nominativo aggiunto dal portale: ${firstname} ${lastname}`);
      res.json({ ok: true, id: result.lastID });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE nominativo dal portale ────────────────────────────────
  app.post('/api/portale/:token/participants/:pid/delete', async (req, res) => {
    const token = req.params.token;
    const pid   = parseInt(req.params.pid, 10);
    try {
      const group = await dbGet(
        'SELECT id FROM assignment_groups WHERE portal_token=? AND portal_enabled=1', [token]);
      if (!group) return res.status(404).json({ error: 'Portale non disponibile' });

      const part = await dbGet('SELECT id FROM participants WHERE id=? AND assignment_group_id=?', [pid, group.id]);
      if (!part) return res.status(404).json({ error: 'Nominativo non trovato' });

      const hasPass = await dbGet('SELECT id FROM passes WHERE participant_id=? LIMIT 1', [pid]);
      if (hasPass) return res.status(400).json({ error: 'Pass già generato, impossibile rimuovere' });

      await dbRun('DELETE FROM participants WHERE id=?', [pid]);
      logAction(null, 'portal_delete_participant', 'participant', pid, 'Nominativo rimosso dal portale');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Richiesta servizio/logistica dal portale ─────────────────────
  app.post('/api/portale/:token/service-request', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet('SELECT id FROM assignment_groups WHERE portal_token=?', [token]);
      if (!group) return res.status(404).json({ error: 'Token non valido' });

      const { type, category, quantity, notes } = req.body;
      if (!type) return res.status(400).json({ error: 'Tipo obbligatorio' });

      const edId = getCurrent()?.id || null;
      const qty  = parseInt(quantity, 10) || 1;

      await dbRun(
        'INSERT INTO service_requests (assignment_group_id, service_type, quantity, notes, edition_id) VALUES (?,?,?,?,?)',
        [group.id, type, qty, notes || null, edId]
      );
      // Sync con scheda Materiali
      try {
        await dbRun(
          `INSERT INTO group_material_requests
             (assignment_group_id, category, item_name, quantity, notes, status, source, edition_id)
           VALUES (?,?,?,?,?,?,?,?)`,
          [group.id, category || null, type, qty, notes || null, 'in_attesa', 'portale', edId]
        );
      } catch (eSyncMat) {
        console.warn('[portale] sync group_material_requests:', eSyncMat.message);
      }

      createNotification('service', 'Nuova richiesta servizio',
        `Richiesta <strong>${type}</strong> (x${qty}) da gruppo ID ${group.id}.`, null, null);
      res.json({ ok: true });
    } catch (err) {
      console.error('Errore richiesta servizio portale:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Lista richieste servizio del gruppo ──────────────────────────
  app.get('/api/portale/:token/service-requests', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet('SELECT id FROM assignment_groups WHERE portal_token=?', [token]);
      if (!group) return res.status(404).json({ error: 'Token non valido' });
      const rows = await dbAll(
        `SELECT id, service_type AS type, quantity, notes, status, requested_at
         FROM service_requests WHERE assignment_group_id=? ORDER BY requested_at DESC`,
        [group.id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
