/**
 * routes/ui-extras.js
 * API di sola lettura usate dall'interfaccia (nessuna scrittura sul DB).
 *
 * Route registrate:
 *   GET /api/assignment-groups/portal-status
 *       -> [{ id, state }]  state: 'attivo' | 'disattivato' | 'inattivo'
 *         attivo      = portale generato (token presente) e attivo
 *         disattivato = portale generato ma disattivato
 *         inattivo    = portale non ancora generato
 *       Il token NON viene mai restituito.
 *
 *   GET /api/participants/summary
 *       -> { groups, participants, senzaPass }  (edizione corrente)
 *         senzaPass = partecipanti senza alcun pass valido (stesso criterio della home)
 */

module.exports = function registerUiExtras(app, db, { requireAuth, edFilter }) {

  app.get('/api/assignment-groups/portal-status', requireAuth, (req, res) => {
    const sql = `
      SELECT ag.id AS id,
             ag.portal_enabled AS portal_enabled,
             CASE WHEN ag.portal_token IS NOT NULL AND ag.portal_token != '' THEN 1 ELSE 0 END AS has_token
      FROM assignment_groups ag
      WHERE (1=1) ${edFilter()}`;
    db.all(sql, [], (err, rows) => {
      res.set('Cache-Control', 'no-store');
      if (err) return res.status(500).json({ error: 'Errore DB' });
      res.json((rows || []).map(r => ({
        id: r.id,
        state: r.has_token ? (r.portal_enabled ? 'attivo' : 'disattivato') : 'inattivo',
      })));
    });
  });

  app.get('/api/participants/summary', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const one = (sql) => new Promise((ok, ko) => db.get(sql, [], (e, r) => (e ? ko(e) : ok(r))));
    Promise.all([
      one(`SELECT COUNT(*) AS n FROM assignment_groups ag WHERE (1=1) ${edFilter()}`),
      one(`SELECT COUNT(*) AS n FROM participants pa
           LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
           WHERE 1=1 ${edFilter()}`),
      one(`SELECT COUNT(*) AS n FROM participants pa
           LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
           WHERE pa.id NOT IN (SELECT DISTINCT participant_id FROM passes WHERE status != 'INVALIDATO')
           ${edFilter()}`),
    ])
      .then(([g, p, s]) => res.json({ groups: g.n, participants: p.n, senzaPass: s.n }))
      .catch(() => res.status(500).json({ error: 'Errore DB' }));
  });

};
