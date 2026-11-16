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
 *   GET /admin/mappa-pubblica/diagnostica  (solo admin, sola lettura)
 *       -> elenca gli stand che /mappa mette in "Senza zona" e il motivo
 *
 * In coda registra anche routes/mappa-pubblica.js (mappa pubblica su tabella propria): le sue rotte
 * vengono spostate PRIMA di quelle dell'agenda, che altrimenti avrebbero la precedenza.
 */

module.exports = function registerUiExtras(app, db, mw) {
  const { requireAuth, requireAdmin, edFilter } = mw;

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

  // ── Diagnostica "Senza zona" della mappa interna (sola lettura) ─────────────────────────
  app.get('/admin/mappa-pubblica/diagnostica', requireAuth, requireAdmin, (req, res) => {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cur = edFilter();
    const f = cur ? cur.replace(/AND ag\.edition_id = (\d+)/, 'AND (ag.edition_id = $1 OR ag.edition_id IS NULL)') : '';
    db.all(`SELECT ag.id, ag.name, ag.zone, ag.edition_id, z.id AS zid, z.zone_scope,
                   (SELECT COUNT(*) FROM participants pa WHERE pa.assignment_group_id = ag.id) AS persone
            FROM assignment_groups ag LEFT JOIN zones z ON z.name = ag.zone
            WHERE (1=1) ${f}
              AND (ag.zone IS NULL OR ag.zone = '' OR z.id IS NULL OR NOT (z.zone_scope IS NULL OR z.zone_scope = 'internal'))
            ORDER BY ag.zone, ag.name`, [], (err, rows) => {
      if (err) return res.status(500).send('Errore DB: ' + esc(err.message));
      const why = (r) => (!r.zone ? 'zona vuota' : !r.zid ? 'zona inesistente nella tabella zones' : 'zona con scope "' + r.zone_scope + '" (nascosta dalla mappa interna)');
      const count = {};
      rows.forEach((r) => { const w = why(r); count[w] = (count[w] || 0) + 1; });
      res.send('<!doctype html><meta charset="utf-8"><title>Diagnostica Senza zona</title><body style="font:14px system-ui;margin:1.2rem"><h1>Stand in "Senza zona": ' + rows.length + '</h1><ul>' +
        Object.keys(count).map((k) => '<li>' + esc(k) + ': <b>' + count[k] + '</b></li>').join('') + '</ul>' +
        '<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>ID</th><th>Nome</th><th>Zona</th><th>Edizione</th><th>Persone</th><th>Motivo</th></tr>' +
        rows.map((r) => '<tr><td>' + r.id + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.zone) + '</td><td>' + (r.edition_id == null ? 'nessuna' : r.edition_id) + '</td><td>' + r.persone + '</td><td>' + esc(why(r)) + '</td></tr>').join('') + '</table></body>');
    });
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
