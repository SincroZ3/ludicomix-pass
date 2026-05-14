/**
 * routes/scan.js
 * ──────────────────────────────────────────────────────────────────
 * Scansione badge QR: lookup pass, consegna, batch PDF gruppo,
 * cronologia tentativi scan, ricerca globale API.
 *
 * Route registrate:
 *   GET  /scan
 *   GET  /api/scan/:code
 *   POST /api/scan/:code/consegna
 *   GET  /assignment-groups/:id/batch-pdf
 *   GET  /scan-attempts
 *   GET  /api/search
 * ──────────────────────────────────────────────────────────────────
 */

const path       = require('path');
const fs         = require('fs');
const { PDFDocument } = require('pdf-lib');

module.exports = function registerScanRoutes(app, db, { requireAuth, requireAdmin, requireCanScan, requireNotViewer, logAction, edFilter }) {

  // ── Pagina scan ──────────────────────────────────────────────────
  app.get('/scan', requireAuth, requireCanScan, (req, res) => {
    res.render('scan', { currentUser: req.session.user });
  });

  // ── Lookup pass via codice QR ────────────────────────────────────
  app.get('/api/scan/:code', requireAuth, requireCanScan, (req, res) => {
    const code = (req.params.code || '').trim().toUpperCase();
    db.get(
      `SELECT p.id, p.code, p.status,
              pa.first_name, pa.last_name, pa.email,
              ag.name AS group_name, pt.name AS pass_type_name
       FROM passes p
       JOIN participants pa ON pa.id = p.participant_id
       LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
       LEFT JOIN pass_types pt ON pt.id = p.pass_type_id
       WHERE p.code = ?`,
      [code],
      (err, pass) => {
        if (err) return res.status(500).json({ error: 'Errore DB' });
        if (!pass) {
          const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
          db.run('INSERT INTO scan_attempts(code,result,user_id,ip) VALUES(?,?,?,?)',
            [code, 'NOT_FOUND', req.session.user.id, ip]);
          return res.status(404).json({ error: 'Pass non trovato', code });
        }
        // Se ENTRATO, cerca l'ultimo accesso giornaliero per il warning duplicato
        if (pass.status === 'ENTRATO') {
          const today = new Date().toISOString().slice(0, 10);
          db.get(
            `SELECT created_at FROM scan_attempts
             WHERE pass_id=? AND result='ACCESSO'
               AND date(created_at)=date('now','localtime')
             ORDER BY id DESC LIMIT 1`,
            [pass.id],
            (err2, lastAccess) => {
              res.json({ pass, lastAccess: lastAccess ? lastAccess.created_at : null });
            }
          );
        } else {
          res.json({ pass });
        }
      }
    );
  });

  // ── Consegna pass via scanner ────────────────────────────────────
  app.post('/api/scan/:code/consegna', requireAuth, (req, res) => {
    const code = (req.params.code || '').trim().toUpperCase();
    const ip   = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const uid  = req.session.user.id;

    db.get(
      `SELECT p.id, p.status, pa.first_name, pa.last_name, ag.name AS group_name
       FROM passes p
       JOIN participants pa ON pa.id = p.participant_id
       LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
       WHERE p.code = ?`,
      [code],
      (err, pass) => {
        if (err || !pass) {
          db.run('INSERT INTO scan_attempts(code,result,user_id,ip) VALUES(?,?,?,?)',
            [code, 'NOT_FOUND', uid, ip]);
          return res.status(404).json({ error: 'Pass non trovato' });
        }

        const pname = pass.first_name + ' ' + pass.last_name;

        if (pass.status === 'INVALIDATO') {
          db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
            [code, 'INVALIDATO', pass.id, pname, pass.group_name, uid, ip]);
          return res.status(400).json({ error: 'Pass invalidato', status: pass.status });
        }

        // Pass ENTRATO: scansione di accesso in manifestazione
        if (pass.status === 'CONSEGNATO' || pass.status === 'RICONSEGNATO') {
          db.run('UPDATE passes SET status = ? WHERE id = ?', ['ENTRATO', pass.id], function(err2) {
            if (err2) return res.status(500).json({ error: 'Errore DB' });
            db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
              [code, 'ACCESSO', pass.id, pname, pass.group_name, uid, ip]);
            logAction(uid, 'scan_accesso', 'pass', pass.id, 'Pass ENTRATO in manifestazione via scanner QR');
            db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)',
              [pass.id, 'ENTRATO', uid]);
            res.json({ success: true, action: 'entrato', passId: pass.id });
          });
          return;
        }

        // Pass già ENTRATO: controlla se l'accesso è di oggi o di un giorno precedente
        if (pass.status === 'ENTRATO') {
          db.get(
            `SELECT created_at FROM scan_attempts
             WHERE pass_id=? AND result='ACCESSO'
               AND date(created_at)=date('now','localtime')
             ORDER BY id DESC LIMIT 1`,
            [pass.id],
            (err2, lastAccess) => {
              if (lastAccess) {
                // Accesso già registrato oggi → duplicato
                db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
                  [code, 'DUPLICATO', pass.id, pname, pass.group_name, uid, ip]);
                return res.status(409).json({
                  error: 'Pass già entrato oggi',
                  status: 'ENTRATO',
                  duplicate: true,
                  lastAccess: lastAccess.created_at,
                  pass: { first_name: pass.first_name, last_name: pass.last_name, group_name: pass.group_name }
                });
              }
              // Nessun accesso oggi → giorno nuovo, reset a CONSEGNATO
              db.run('UPDATE passes SET status=? WHERE id=?', ['CONSEGNATO', pass.id], function(err3) {
                if (err3) return res.status(500).json({ error: 'Errore DB' });
                db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)',
                  [pass.id, 'CONSEGNATO', uid]);
                logAction(uid, 'scan_reset_giornaliero', 'pass', pass.id,
                  'Pass resettato ENTRATO→CONSEGNATO per nuovo giorno');
                // Restituisce il pass aggiornato così il client mostra "segna accesso"
                res.json({
                  pass: {
                    id: pass.id, code, status: 'CONSEGNATO',
                    first_name: pass.first_name, last_name: pass.last_name,
                    group_name: pass.group_name
                  }
                });
              });
            }
          );
          return;
        }

        db.run('UPDATE passes SET status = ? WHERE id = ?', ['CONSEGNATO', pass.id], function (err2) {
          if (err2) return res.status(500).json({ error: 'Errore DB' });
          db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
            [code, 'SUCCESS', pass.id, pname, pass.group_name, uid, ip]);
          logAction(uid, 'scan_consegna', 'pass', pass.id, 'Pass CONSEGNATO via scanner QR');
          db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)',
            [pass.id, 'CONSEGNATO', uid]);
          res.json({ success: true, action: 'consegnato', passId: pass.id });
        });
      }
    );
  });

  // ── Batch PDF: scarica tutti i pass di un gruppo in un unico PDF ─
  app.get('/assignment-groups/:id/batch-pdf', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get('SELECT name FROM assignment_groups WHERE id = ?', [id], (err, grp) => {
      if (err || !grp) return res.status(404).send('Gruppo non trovato');

      db.all(
        `SELECT p.pdf_file, pa.first_name, pa.last_name
         FROM passes p
         JOIN participants pa ON pa.id = p.participant_id
         WHERE pa.assignment_group_id = ?
           AND p.pdf_file IS NOT NULL
           AND p.status != 'INVALIDATO'
         ORDER BY pa.last_name, pa.first_name`,
        [id],
        async (err2, passes) => {
          if (err2 || !passes || !passes.length)
            return res.status(404).send('Nessun PDF disponibile per questo gruppo');

          try {
            const merged = await PDFDocument.create();
            for (const p of passes) {
              const fp = path.join(process.env.DATA_DIR || __dirname, '..', 'generated', p.pdf_file);
              if (!fs.existsSync(fp)) continue;
              const bytes = fs.readFileSync(fp);
              const doc   = await PDFDocument.load(bytes);
              const pages = await merged.copyPages(doc, doc.getPageIndices());
              pages.forEach(pg => merged.addPage(pg));
            }

            const out      = await merged.save();
            const safeName = grp.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="batch_${safeName}.pdf"`);
            res.send(Buffer.from(out));

            logAction(req.session.user.id, 'batch_pdf', 'assignment_group', id,
              `Batch PDF scaricato (${passes.length} pass)`);

            // Aggiorna GENERATO → SCARICATO per i pass inclusi
            db.all(
              `SELECT p.id FROM passes p
               JOIN participants pa ON pa.id = p.participant_id
               WHERE pa.assignment_group_id = ? AND p.status = 'GENERATO'`,
              [id],
              function (e2, toUpdate) {
                if (!toUpdate || !toUpdate.length) return;
                toUpdate.forEach(function (p) {
                  db.run("UPDATE passes SET status='SCARICATO' WHERE id=?", [p.id]);
                  db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)',
                    [p.id, 'SCARICATO', req.session.user.id]);
                  logAction(req.session.user.id, 'batch_pdf_scaricato', 'pass', p.id,
                    'Stato aggiornato GENERATO→SCARICATO via batch PDF');
                });
              }
            );
          } catch (e) {
            res.status(500).send('Errore generazione PDF: ' + e.message);
          }
        }
      );
    });
  });


  // ── Batch PDF selezione manuale ──────────────────────────────────
  // Riceve pass_ids[] via POST, restituisce un PDF merged con i pass scelti.
  // NON tocca la route GET /assignment-groups/:id/batch-pdf esistente.
  app.post('/passes/batch-selected', requireAuth, async (req, res) => {
    try {
      let ids = req.body.pass_ids;
      if (!ids) return res.status(400).send('Nessun pass selezionato');
      if (!Array.isArray(ids)) ids = [ids];
      ids = ids.map(function(x){ return parseInt(x,10); }).filter(function(x){ return !isNaN(x) && x > 0; });
      if (!ids.length) return res.status(400).send('Nessun ID valido');

      const placeholders = ids.map(function(){ return '?'; }).join(',');
      const passes = await new Promise(function(resolve, reject){
        db.all(
          `SELECT p.id, p.pdf_file, p.status, pa.first_name, pa.last_name
           FROM passes p
           JOIN participants pa ON pa.id = p.participant_id
           WHERE p.id IN (${placeholders})
             AND p.pdf_file IS NOT NULL
             AND p.status != 'INVALIDATO'
           ORDER BY pa.last_name, pa.first_name`,
          ids,
          function(err, rows){ if (err) return reject(err); resolve(rows || []); }
        );
      });

      if (!passes.length) return res.status(404).send('Nessun PDF disponibile per i pass selezionati');

      const merged = await PDFDocument.create();
      for (const p of passes) {
        const fp = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'generated', p.pdf_file);
        if (!fs.existsSync(fp)) continue;
        const bytes = fs.readFileSync(fp);
        const doc   = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(function(pg){ merged.addPage(pg); });
      }

      const out = await merged.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pass_selezionati_${Date.now()}.pdf"`);
      res.send(Buffer.from(out));

      // Aggiorna GENERATO → SCARICATO per i pass inclusi
      passes.forEach(function(p){
        if (p.status === 'GENERATO') {
          db.run("UPDATE passes SET status='SCARICATO' WHERE id=?", [p.id]);
          db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)',
            [p.id, 'SCARICATO', req.session.user.id]);
          logAction(req.session.user.id, 'batch_selected_pdf_scaricato', 'pass', p.id,
            'Stato aggiornato GENERATO->SCARICATO via batch selezionati');
        }
      });
      logAction(req.session.user.id, 'batch_selected_pdf', 'pass', null,
        'Batch PDF selezionati (' + passes.length + ' pass)');

    } catch (e) {
      console.error('[batch-selected]', e);
      res.status(500).send('Errore generazione PDF: ' + e.message);
    }
  });

  // ── Cronologia tentativi scan ────────────────────────────────────
  app.get('/scan-attempts', requireAuth, requireAdmin, (req, res) => {
    db.all(
      `SELECT sa.*, u.username
       FROM scan_attempts sa
       LEFT JOIN users u ON u.id = sa.user_id
       ORDER BY sa.id DESC LIMIT 500`,
      [],
      (err, rows) => {
        res.render('scan_attempts', { attempts: rows || [] });
      }
    );
  });

  // ── Ricerca globale API (navbar) ─────────────────────────────────
  app.get('/api/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ passes: [], participants: [], groups: [] });
    const like = `%${q}%`;

    const sqlP = `
      SELECT p.id, p.code, p.status, pt.name AS pass_type_name,
             pa.first_name||' '||pa.last_name AS participant_name, ag.stand_name
      FROM passes p
      JOIN pass_types pt ON pt.id = p.pass_type_id
      JOIN participants pa ON pa.id = p.participant_id
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pt.name LIKE ? OR p.code LIKE ? OR ag.name LIKE ? OR ag.stand_name LIKE ?
      ORDER BY p.id DESC LIMIT 8`;

    const sqlPa = `
      SELECT pa.id, pa.first_name, pa.last_name, pa.role, ag.stand_name
      FROM participants pa
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ? OR pa.role LIKE ?
      ORDER BY pa.last_name LIMIT 6`;

    const sqlG = `
      SELECT ag.id, ag.name, ag.stand_name, ag.zone
      FROM assignment_groups ag
      WHERE (ag.name LIKE ? OR ag.stand_name LIKE ? OR ag.zone LIKE ? OR ag.stand_code LIKE ?)
        ${edFilter()}
      ORDER BY ag.name LIMIT 5`;

    const sqlEv = `
      SELECT e.id, e.title, e.event_type, e.date, e.start_time, e.end_time,
             s.name AS space_name
      FROM events e
      LEFT JOIN spaces s ON s.id = e.space_id
      WHERE e.title LIKE ? OR s.name LIKE ? OR e.event_type LIKE ? OR e.description LIKE ?
      ORDER BY e.date, e.start_time LIMIT 6`;

    db.all(sqlP, [like, like, like, like, like, like, like], (e1, passes) => {
      db.all(sqlPa, [like, like, like, like], (e2, participants) => {
        db.all(sqlG, [like, like, like, like], (e3, groups) => {
          db.all(sqlEv, [like, like, like, like], (e4, events) => {
            res.json({ passes: passes || [], participants: participants || [], groups: groups || [], events: events || [] });
          });
        });
      });
    });
  });

};
