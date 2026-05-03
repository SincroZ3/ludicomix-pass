/**
 * routes/notifications.js
 * ──────────────────────────────────────────────────────────────────
 * Notifiche interne di sistema (limite gruppi, import, ecc.)
 *
 * Route registrate:
 *   GET  /notifications
 *   GET  /api/notifications/count
 *   POST /notifications/read-all
 * ──────────────────────────────────────────────────────────────────
 */

module.exports = function registerNotificationRoutes(app, db, { requireAuth, requireAdmin }) {

  // ── Pagina elenco notifiche ──────────────────────────────────────
  app.get('/notifications', requireAuth, requireAdmin, function (req, res) {
    db.run("UPDATE notifications SET read_at=datetime('now','localtime') WHERE read_at IS NULL");
    db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200', [], function (err, notifs) {
      res.render('notifications', { notifs: notifs || [] });
    });
  });

  // ── Badge count (polling JS navbar) ─────────────────────────────
  app.get('/api/notifications/count', requireAuth, requireAdmin, function (req, res) {
    db.get('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL', [], function (e, r) {
      res.json({ count: r ? r.n : 0 });
    });
  });

  // ── Segna tutte come lette ───────────────────────────────────────
  app.post('/notifications/read-all', requireAuth, requireAdmin, function (req, res) {
    db.run(
      "UPDATE notifications SET read_at=datetime('now','localtime') WHERE read_at IS NULL",
      function () { res.redirect('/notifications'); }
    );
  });

};
