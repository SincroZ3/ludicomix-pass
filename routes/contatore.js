/**
 * routes/contatore.js
 * ──────────────────────────────────────────────────────────────────
 * Contatore visitatori per area/gate con storico orario.
 *
 * Route registrate:
 *   POST /api/visitors/tap
 *   GET  /api/visitors/live
 *   GET  /api/visitors/history/:area
 *   GET  /contatore
 *   POST /api/visitors/reset
 * ──────────────────────────────────────────────────────────────────
 */

// Config aree e gate — modifica qui per aggiungere/rimuovere aree
const VISITOR_AREAS = {
  mariambini: { label: 'Mariambini',       gates: ['Gate A', 'Gate B'], emoji: '🎡' },
  palazzetto: { label: 'Palazzetto',       gates: ['Ingresso'],         emoji: '🏟️' },
  la_perla:   { label: 'Cinema La Perla', gates: ['Ingresso'],         emoji: '🎬' },
  ludostria:  { label: 'Ludostria',        gates: ['Ingresso'],         emoji: '🎲' },
};

// Helper: mezzanotte di oggi in formato SQLite locale
function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
}

module.exports = function registerContatoreRoutes(app, db, { requireAuth, requireAdmin, requireNotViewer, logAction, getCurrent }) {

  // ── Registra un singolo tap (IN o OUT) ──────────────────────────
  app.post('/api/visitors/tap', requireAuth, requireNotViewer, (req, res) => {
    const { area, gate = 'main', direction } = req.body;
    if (!area || !['IN', 'OUT'].includes(direction)) {
      return res.status(400).json({ error: 'area e direction (IN/OUT) richiesti' });
    }

    const userId = req.session.user?.id || null;
    const edId   = getCurrent()?.id || null;

    db.run(
      'INSERT INTO visitor_counts (area, gate, direction, user_id, edition_id) VALUES (?,?,?,?,?)',
      [area, gate || 'main', direction, userId, edId],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        logAction(userId, 'VISITOR_TAP', `${direction} area=${area} gate=${gate}`);

        const since = todayMidnight();
        db.get(
          `SELECT
             SUM(CASE WHEN direction='IN'  AND counted_at >= ? THEN 1 ELSE 0 END) AS ins,
             SUM(CASE WHEN direction='OUT' AND counted_at >= ? THEN 1 ELSE 0 END) AS outs
           FROM visitor_counts
           WHERE area = ?
             AND (edition_id = ? OR edition_id IS NULL)
             AND counted_at >= COALESCE(
               (SELECT reset_at FROM visitor_resets WHERE area = ? ORDER BY id DESC LIMIT 1), ?)`,
          [since, since, area, edId, area, since],
          (e, row) => {
            const ins  = row?.ins  || 0;
            const outs = row?.outs || 0;
            res.json({ ok: true, area, ins, outs, presenti: Math.max(0, ins - outs) });
          }
        );
      }
    );
  });

  // ── Presenze live per tutte le aree ─────────────────────────────
  app.get('/api/visitors/live', requireAuth, (req, res) => {
    const since = todayMidnight();
    const edId  = getCurrent()?.id || null;

    db.all(
      `SELECT vc.area,
         SUM(CASE WHEN vc.direction='IN'  THEN 1 ELSE 0 END) AS ins,
         SUM(CASE WHEN vc.direction='OUT' THEN 1 ELSE 0 END) AS outs
       FROM visitor_counts vc
       WHERE vc.counted_at >= COALESCE(
         (SELECT vr.reset_at FROM visitor_resets vr WHERE vr.area = vc.area ORDER BY vr.id DESC LIMIT 1), ?)
         AND vc.counted_at >= ?
         AND (vc.edition_id = ? OR vc.edition_id IS NULL)
       GROUP BY vc.area`,
      [since, since, edId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const result = {};
        (rows || []).forEach(r => {
          result[r.area] = { ins: r.ins, outs: r.outs, presenti: Math.max(0, r.ins - r.outs) };
        });

        // Storico orario oggi (aggregato per ora)
        db.all(
          `SELECT area,
             strftime('%H', counted_at) AS ora,
             SUM(CASE WHEN direction='IN'  THEN 1 ELSE 0 END) AS ins,
             SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) AS outs
           FROM visitor_counts
           WHERE counted_at >= ?
             AND (edition_id = ? OR edition_id IS NULL)
           GROUP BY area, ora
           ORDER BY ora ASC`,
          [since, edId],
          (e2, hist) => {
            res.json({ areas: result, history: hist || [] });
          }
        );
      }
    );
  });

  // ── Storico orario per una singola area ─────────────────────────
  app.get('/api/visitors/history/:area', requireAuth, (req, res) => {
    const since = todayMidnight();
    const edId  = getCurrent()?.id || null;

    db.all(
      `SELECT strftime('%H:00', counted_at) AS ora,
         SUM(CASE WHEN direction='IN'  THEN 1 ELSE 0 END) AS ins,
         SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) AS outs
       FROM visitor_counts
       WHERE area = ? AND counted_at >= ?
         AND (edition_id = ? OR edition_id IS NULL)
       GROUP BY ora
       ORDER BY ora ASC`,
      [req.params.area, since, edId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
      }
    );
  });

  // ── Pagina contatore (view mobile per volontari) ─────────────────
  app.get('/contatore', requireAuth, (req, res) => {
    res.render('contatore', { user: req.session.user, areas: VISITOR_AREAS });
  });

  // ── Reset manuale da admin ───────────────────────────────────────
  app.post('/api/visitors/reset', requireAuth, requireAdmin, (req, res) => {
    const { area, note } = req.body;
    const userId     = req.session.user?.id || null;
    const areaFilter = area && area !== 'all' ? area : null;

    db.run(
      'INSERT INTO visitor_resets (area, user_id, note) VALUES (?,?,?)',
      [areaFilter, userId, note || null],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        logAction(userId, 'VISITOR_RESET', `area=${areaFilter || 'TUTTE'} note=${note || ''}`);
        res.json({ ok: true });
      }
    );
  });

};
