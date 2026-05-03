/**
 * routes/reports.js
 * ──────────────────────────────────────────────────────────────────
 * Report statistici, export CSV e pagina ricerca fulltext.
 *
 * Route registrate:
 *   GET /search
 *   GET /reports
 *   GET /reports/passes.csv
 *   GET /reports/senza-pass.csv
 *   GET /reports/stato-gruppi.csv
 * ──────────────────────────────────────────────────────────────────
 */

module.exports = function registerReportRoutes(app, db, { requireAuth, edFilter }) {

  // ── Pagina ricerca fulltext ──────────────────────────────────────
  app.get('/search', requireAuth, (req, res) => {
    const q   = (req.query.q || '').trim();
    const tab = req.query.tab || 'all';
    if (!q) return res.render('search', { q: '', tab, passes: [], participants: [], groups: [] });

    const like = `%${q}%`;

    const sqlP = `
      SELECT p.id, p.created_at, p.pdf_file, p.code, p.status,
             pt.name AS pass_type_name,
             pa.first_name||' '||pa.last_name AS participant_name,
             ag.name AS group_name, ag.stand_name
      FROM passes p
      JOIN pass_types pt ON pt.id = p.pass_type_id
      JOIN participants pa ON pa.id = p.participant_id
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pt.name LIKE ? OR p.code LIKE ? OR ag.name LIKE ? OR ag.stand_name LIKE ?
      ORDER BY p.id DESC LIMIT 300`;

    const sqlPa = `
      SELECT pa.id, pa.first_name, pa.last_name, pa.email, pa.role, pa.ref_code,
             ag.name AS group_name, ag.stand_name,
             (SELECT COUNT(*) FROM passes pp WHERE pp.participant_id=pa.id AND pp.status!='INVALIDATO') AS pass_count
      FROM participants pa
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pa.role LIKE ? OR pa.ref_code LIKE ?
      ORDER BY pa.last_name, pa.first_name LIMIT 100`;

    const sqlG = `
      SELECT ag.id, ag.name, ag.stand_name, ag.zone, ag.stand_code,
             g.name AS category_name, ag.max_passes,
             COUNT(DISTINCT pa.id) AS participant_count,
             SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati,
             COUNT(DISTINCT p.id) AS pass_count
      FROM assignment_groups ag
      LEFT JOIN groups g ON g.id = ag.group_id
      LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
      LEFT JOIN passes p ON p.participant_id = pa.id AND p.status != 'INVALIDATO'
      WHERE (ag.name LIKE ? OR ag.stand_name LIKE ? OR ag.zone LIKE ? OR ag.stand_code LIKE ?)
        ${edFilter()}
      GROUP BY ag.id ORDER BY ag.name LIMIT 80`;

    db.all(sqlP, [like, like, like, like, like, like, like], (e1, passes) => {
      db.all(sqlPa, [like, like, like, like, like], (e2, participants) => {
        db.all(sqlG, [like, like, like, like], (e3, groups) => {
          res.render('search', {
            q, tab,
            passes:       passes       || [],
            participants: participants || [],
            groups:       groups       || [],
          });
        });
      });
    });
  });

  // ── Dashboard report ─────────────────────────────────────────────
  app.get('/reports', requireAuth, (req, res) => {
    db.all(
      "SELECT status, COUNT(*) AS count FROM passes WHERE status!='INVALIDATO' GROUP BY status",
      [],
      (e, statusCounts) => {
        db.all(
          `SELECT ag.id, ag.name AS group_name, g.name AS category_name, ag.zone,
                  ag.max_passes, COUNT(p.id) AS pass_count,
                  SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati
           FROM assignment_groups ag
           LEFT JOIN groups g ON g.id = ag.group_id
           LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
           LEFT JOIN passes p ON p.participant_id = pa.id
           WHERE (1=1) ${edFilter()}
           GROUP BY ag.id ORDER BY g.name, ag.name`,
          [],
          (e2, groupStats) => {
            db.get(
              `SELECT COUNT(*) AS total FROM participants
               WHERE id NOT IN (SELECT DISTINCT participant_id FROM passes WHERE status!='INVALIDATO')`,
              [],
              (e3, r3) => {
                res.render('reports', {
                  statusCounts: statusCounts || [],
                  groupStats:   groupStats   || [],
                  senzaPass:    r3 ? r3.total : 0,
                });
              }
            );
          }
        );
      }
    );
  });

  // ── Export CSV: tutti i pass ─────────────────────────────────────
  app.get('/reports/passes.csv', requireAuth, (req, res) => {
    db.all(
      `SELECT p.id, p.created_at, p.code, p.status,
              pa.first_name||' '||pa.last_name AS participant_name, pa.email, pa.role,
              pt.name AS pass_type_name, ag.name AS group_name, ag.stand_name, ag.zone
       FROM passes p
       JOIN pass_types pt ON pt.id = p.pass_type_id
       JOIN participants pa ON pa.id = p.participant_id
       LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
       ORDER BY p.id DESC`,
      [],
      (err, rows) => {
        if (err) return res.status(500).send('Errore generazione report');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="report_passes.csv"');
        res.write('\xEF\xBB\xBF');
        res.write('ID;Data;Codice;Stato;Assegnatario;Email;Ruolo;Tipologia Pass;Gruppo;Stand;Zona\n');
        rows.forEach(r => {
          res.write([
            r.id, r.created_at, r.code || '', r.status || '',
            `"${r.participant_name || ''}"`, `"${r.email || ''}"`, `"${r.role || ''}"`,
            `"${r.pass_type_name || ''}"`, `"${r.group_name || ''}"`,
            `"${r.stand_name || ''}"`, `"${r.zone || ''}"`,
          ].join(';') + '\n');
        });
        res.end();
      }
    );
  });

  // ── Export CSV: partecipanti senza pass ──────────────────────────
  app.get('/reports/senza-pass.csv', requireAuth, (req, res) => {
    db.all(
      `SELECT pa.id, pa.first_name, pa.last_name, pa.email, pa.role,
              ag.name AS group_name, ag.stand_name, ag.zone
       FROM participants pa
       LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
       WHERE pa.id NOT IN (SELECT DISTINCT participant_id FROM passes)
       ORDER BY ag.name, pa.last_name, pa.first_name`,
      [],
      (err, rows) => {
        if (err) return res.status(500).send('Errore generazione report');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="senza_pass.csv"');
        res.write('\xEF\xBB\xBF');
        res.write('ID;Cognome;Nome;Email;Ruolo;Gruppo;Stand;Zona\n');
        rows.forEach(r => {
          res.write([
            r.id, `"${r.last_name || ''}"`, `"${r.first_name || ''}"`,
            `"${r.email || ''}"`, `"${r.role || ''}"`, `"${r.group_name || ''}"`,
            `"${r.stand_name || ''}"`, `"${r.zone || ''}"`,
          ].join(';') + '\n');
        });
        res.end();
      }
    );
  });

  // ── Export CSV: stato gruppi ─────────────────────────────────────
  app.get('/reports/stato-gruppi.csv', requireAuth, (req, res) => {
    db.all(
      `SELECT g.name AS categoria, ag.name AS gruppo, ag.zone, ag.stand_name,
              ag.max_passes, COUNT(p.id) AS pass_totali,
              SUM(CASE WHEN p.status='GENERATO'     THEN 1 ELSE 0 END) AS generati,
              SUM(CASE WHEN p.status='CONSEGNATO'   THEN 1 ELSE 0 END) AS consegnati,
              SUM(CASE WHEN p.status='RICONSEGNATO' THEN 1 ELSE 0 END) AS riconsegnati
       FROM assignment_groups ag
       LEFT JOIN groups g ON g.id = ag.group_id
       LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
       LEFT JOIN passes p ON p.participant_id = pa.id
       WHERE (1=1) ${edFilter()}
       GROUP BY ag.id ORDER BY g.name, ag.name`,
      [],
      (err, rows) => {
        if (err) return res.status(500).send('Errore generazione report');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="stato_gruppi.csv"');
        res.write('\xEF\xBB\xBF');
        res.write('Categoria;Gruppo;Zona;Stand;Limite;Pass Totali;Generati;Consegnati;Riconsegnati\n');
        rows.forEach(r => {
          res.write([
            `"${r.categoria || ''}"`, `"${r.gruppo || ''}"`, `"${r.zone || ''}"`,
            `"${r.stand_name || ''}"`, r.max_passes || '',
            r.pass_totali, r.generati, r.consegnati, r.riconsegnati,
          ].join(';') + '\n');
        });
        res.end();
      }
    );
  });

};
