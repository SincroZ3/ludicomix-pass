/**
 * routes/ui-extras.js
 * ──────────────────────────────────────────────────────────────────────
 * API di sola lettura usate dall'interfaccia (nessuna scrittura sul DB).
 *
 * Route registrate:
 *   GET /api/assignment-groups/portal-status
 *       → [{ id, state }]  state: 'attivo' | 'disattivato' | 'inattivo'
 *         attivo      = portale generato (token presente) e attivo
 *         disattivato = portale generato ma disattivato
 *         inattivo    = portale non ancora generato
 *       Il token NON viene mai restituito.
 * ──────────────────────────────────────────────────────────────────────
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

};
