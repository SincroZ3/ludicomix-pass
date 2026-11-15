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
 *
 * In coda registra anche routes/mappa-pubblica.js (mappa pubblica su tabella propria): le sue rotte
 * vengono spostate PRIMA di quelle dell'agenda, che altrimenti avrebbero la precedenza.
 */

module.exports = function registerUiExtras(app, db, mw) {
  const { requireAuth, edFilter } = mw;

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

  // ── Mappa pubblica su tabella propria (public_zones) ───────────────────────────────────
  try {
    const stack = app._router && app._router.stack;
    const before = stack ? stack.length : 0;
    require('./mappa-pubblica')(app, db, mw);
    if (stack) {
      const mine = stack.splice(before);
      const idx = stack.findIndex((l) => l.name === 'router' && l.handle && l.handle.stack &&
        l.handle.stack.some((s) => s.route && s.route.path === '/admin/mappa-pubblica'));
      if (idx >= 0) stack.splice(idx, 0, ...mine); else stack.push(...mine);
    }
  } catch (e) { console.error('[mappa-pubblica]', e.message); }

};
