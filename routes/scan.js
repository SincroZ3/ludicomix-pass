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
        res.json({ pass });
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

        if (pass.status === 'CONSEGNATO' || pass.status === 'RICONSEGNATO') {
          db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
            [code, 'GIA_' + pass.status, pass.id, pname, pass.group_name, uid, ip]);
          return res.status(409).json({ error: 'Pass già ' + pass.status.toLowerCase(), status: pass.status });
        }

        db.run('UPDATE passes SET status = ? WHERE id = ?', ['CONSEGNATO', pass.id], function (err2) {
          if (err2) return res.status(500).json({ error: 'Errore DB' });
          db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
            [code, 'SUCCESS', pass.id, pname, pass.group_name, uid, ip]);
          logAction(uid, 'scan_consegna', 'pass', pass.id, 'Pass CONSEGNATO via scanner QR');
          db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)',
            [pass.id, 'CONSEGNATO', uid]);
          res.json({ success: true, passId: pass.id });
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

    db.all(sqlP, [like, like, like, like, like, like, like], (e1, passes) => {
      db.all(sqlPa, [like, like, like, like], (e2, participants) => {
        db.all(sqlG, [like, like, like, like], (e3, groups) => {
          res.json({ passes: passes || [], participants: participants || [], groups: groups || [] });
        });
      });
    });
  });

};
