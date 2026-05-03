/**
 * routes/logs.js
 * ──────────────────────────────────────────────────────────────────
 * Log azioni con filtri avanzati e anomaly detection.
 *
 * Route registrate:
 *   GET /admin/logs
 * ──────────────────────────────────────────────────────────────────
 */

module.exports = function registerLogRoutes(app, db, { requireAdmin }) {

  app.get('/admin/logs', requireAdmin, (req, res) => {
    const fUser     = (req.query.u  || '').trim();
    const fAction   = (req.query.a  || '').trim();
    const fEntity   = (req.query.e  || '').trim();
    const fDateFrom = (req.query.d1 || '').trim();
    const fDateTo   = (req.query.d2 || '').trim();
    const fText     = (req.query.q  || '').trim();
    const fPage     = Math.max(1, parseInt(req.query.p, 10) || 1);
    const PAGE_SIZE = 200;
    const offset    = (fPage - 1) * PAGE_SIZE;

    // Costruzione WHERE dinamica
    const conditions = [];
    const params     = [];
    if (fUser)     { conditions.push('u.username = ?');          params.push(fUser); }
    if (fAction)   { conditions.push('l.action LIKE ?');         params.push('%' + fAction + '%'); }
    if (fEntity)   { conditions.push('l.entity_type = ?');       params.push(fEntity); }
    if (fDateFrom) { conditions.push('date(l.created_at) >= ?'); params.push(fDateFrom); }
    if (fDateTo)   { conditions.push('date(l.created_at) <= ?'); params.push(fDateTo); }
    if (fText)     { conditions.push('l.details LIKE ?');        params.push('%' + fText + '%'); }
    const WHERE = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
             u.username,
             CASE WHEN l.entity_type='participant' THEN
               (SELECT pa2.last_name||' '||pa2.first_name FROM participants pa2 WHERE pa2.id=l.entity_id)
             WHEN l.entity_type='pass' THEN
               (SELECT pa3.last_name||' '||pa3.first_name FROM participants pa3
                JOIN passes pp ON pp.participant_id=pa3.id WHERE pp.id=l.entity_id LIMIT 1)
             ELSE NULL END AS participant_name,
             CASE WHEN l.entity_type='assignment_group' THEN
               (SELECT ag2.stand_name||' / '||ag2.name FROM assignment_groups ag2 WHERE ag2.id=l.entity_id)
             WHEN l.entity_type='pass' THEN
               (SELECT ag3.name FROM assignment_groups ag3
                JOIN participants pa4 ON pa4.assignment_group_id=ag3.id
                JOIN passes pp2 ON pp2.participant_id=pa4.id WHERE pp2.id=l.entity_id LIMIT 1)
             ELSE NULL END AS group_name
      FROM action_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${WHERE}
      ORDER BY l.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

    const sqlCount = `
      SELECT COUNT(*) AS total
      FROM action_logs l LEFT JOIN users u ON u.id = l.user_id
      ${WHERE}`;

    const sqlUsers = `
      SELECT DISTINCT u2.username
      FROM action_logs l2 LEFT JOIN users u2 ON u2.id = l2.user_id
      WHERE u2.username IS NOT NULL ORDER BY u2.username`;

    // Anomaly detection: 5+ delete in 5 min per stesso utente
    const sqlAnomalyDel = `
      SELECT l.user_id, u.username,
             strftime('%Y-%m-%d %H:%M', datetime(l.created_at)) AS minute,
             COUNT(*) AS cnt
      FROM action_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.action LIKE 'delete%'
        AND l.created_at >= datetime('now', '-30 days')
      GROUP BY l.user_id, strftime('%Y-%m-%d %H:%M', datetime(l.created_at))
      HAVING cnt >= 5 ORDER BY cnt DESC LIMIT 20`;

    // Anomaly detection: 3+ login_failed in 10 min
    const sqlAnomalyLogin = `
      SELECT l.details,
             strftime('%Y-%m-%d %H:%M', datetime(l.created_at)) AS minute,
             COUNT(*) AS cnt
      FROM action_logs l
      WHERE l.action = 'login_failed'
        AND l.created_at >= datetime('now', '-7 days')
      GROUP BY l.details, strftime('%Y-%m-%d %H:%M', datetime(l.created_at))
      HAVING cnt >= 3 ORDER BY cnt DESC LIMIT 10`;

    db.all(sql, params, (err, logs) => {
      if (err) return res.status(500).send('Errore lettura log azioni: ' + err.message);
      db.get(sqlCount, params, (e2, countRow) => {
        db.all(sqlUsers, [], (e3, users) => {
          db.all(sqlAnomalyDel, [], (e4, anomalyDel) => {
            db.all(sqlAnomalyLogin, [], (e5, anomalyLogin) => {
              // Set di id anomali per evidenziazione UI
              const anomalySet = new Set();
              (anomalyDel || []).forEach(a => {
                (logs || []).forEach(l => {
                  if (l.username === a.username && l.action?.startsWith('delete') &&
                      l.created_at?.startsWith(a.minute)) anomalySet.add(l.id);
                });
              });
              (anomalyLogin || []).forEach(a => {
                (logs || []).forEach(l => {
                  if (l.action === 'login_failed' && l.created_at?.startsWith(a.minute)) anomalySet.add(l.id);
                });
              });

              res.render('logs', {
                logs:         logs      || [],
                total:        countRow  ? countRow.total : 0,
                page:         fPage,
                pageSize:     PAGE_SIZE,
                users:        users     || [],
                filters:      { u: fUser, a: fAction, e: fEntity, d1: fDateFrom, d2: fDateTo, q: fText },
                anomalyDel:   anomalyDel   || [],
                anomalyLogin: anomalyLogin || [],
                anomalyIds:   Array.from(anomalySet),
              });
            });
          });
        });
      });
    });
  });

};
