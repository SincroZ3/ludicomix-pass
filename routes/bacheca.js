/**
 * routes/bacheca.js
 * ──────────────────────────────────────────────────────────────────
 * Bacheca comunicazioni: annunci admin + lettura lato portale.
 *
 * Route registrate:
 *   GET    /admin/bacheca
 *   POST   /admin/bacheca
 *   POST   /admin/bacheca/:id/pin
 *   DELETE /admin/bacheca/:id
 *   POST   /portale/:token/bacheca/read
 *   GET    /api/portale/:token/unread
 * ──────────────────────────────────────────────────────────────────
 */

const { promisify } = require('util');

module.exports = function registerBachecaRoutes(app, db, { requireAuth, requireOrganizer, logAction }) {

  const dbGet = promisify(db.get.bind(db));
  const dbAll = promisify(db.all.bind(db));
  function dbRun(sql, ...p) {
    return new Promise((resolve, reject) => {
      const params = p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // ── Elenco annunci admin ─────────────────────────────────────────
  app.get('/admin/bacheca', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const announcements = await dbAll(`
        SELECT a.*, u.username AS author, ag.name AS target_group_name
        FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by
        LEFT JOIN assignment_groups ag ON ag.id = a.target_group_id
        ORDER BY a.is_pinned DESC, a.created_at DESC`);

      const readCounts = await dbAll(`
        SELECT announcement_id, COUNT(*) AS cnt
        FROM announcement_reads GROUP BY announcement_id`);

      const readMap    = Object.fromEntries(readCounts.map(r => [r.announcement_id, r.cnt]));
      const totalStands = (await dbGet(`SELECT COUNT(*) AS n FROM assignment_groups WHERE portal_enabled=1`)).n || 0;
      const allGroups   = await dbAll(`SELECT id, name FROM assignment_groups ORDER BY name ASC`);

      res.render('admin_bacheca', { announcements, readMap, totalStands, allGroups, saved: req.query.saved });
    } catch (err) {
      console.error('Errore /admin/bacheca:', err);
      res.status(500).send('Errore interno');
    }
  });

  // ── Crea nuovo annuncio ──────────────────────────────────────────
  app.post('/admin/bacheca', requireAuth, requireOrganizer, async (req, res) => {
    const title   = (req.body.title   || '').trim();
    const message = (req.body.message || '').trim();
    const { emoji, type, is_pinned, expires_at } = req.body;
    const target_group_id = req.body.target_group_id ? parseInt(req.body.target_group_id, 10) : null;

    if (!title || !message) return res.redirect('/admin/bacheca?saved=err');

    try {
      const show_on_public = req.body.show_on_public ? 1 : 0;
      await dbRun(
        `INSERT INTO announcements (title, message, emoji, type, is_pinned, expires_at, created_by, target_group_id, show_on_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, message, emoji || '📣', type || 'info', is_pinned ? 1 : 0, expires_at || null,
         req.session.user.id, target_group_id, show_on_public]
      );
      logAction(req.session.user.id, 'create_announcement', 'announcement', null,
        `"${title}"${target_group_id ? ' → gruppo ' + target_group_id : ''}`);
      res.redirect('/admin/bacheca?saved=1');
    } catch (err) {
      console.error('Errore POST /admin/bacheca:', err);
      res.redirect('/admin/bacheca?saved=err');
    }
  });

  // ── Toggle pin annuncio ──────────────────────────────────────────
  app.post('/admin/bacheca/:id/pin', requireAuth, requireOrganizer, async (req, res) => {
    const id  = parseInt(req.params.id, 10);
    const row = await dbGet('SELECT is_pinned FROM announcements WHERE id=?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const newVal = row.is_pinned ? 0 : 1;
    await dbRun('UPDATE announcements SET is_pinned=? WHERE id=?', [newVal, id]);
    res.json({ pinned: newVal });
  });

  // ── Elimina annuncio ─────────────────────────────────────────────
  app.delete('/admin/bacheca/:id', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await dbRun('DELETE FROM announcements WHERE id=?', [id]);
    logAction(req.session.user.id, 'delete_announcement', 'announcement', id, '');
    res.json({ ok: true });
  });

  // ── Portale: segna tutti gli annunci come letti ──────────────────
  app.post('/portale/:token/bacheca/read', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet(
        'SELECT id FROM assignment_groups WHERE portal_token=? AND portal_enabled=1', [token]);
      if (!group) return res.status(404).json({ error: 'not found' });

      const anns = await dbAll(
        `SELECT id FROM announcements
         WHERE expires_at IS NULL OR expires_at > datetime('now','localtime')`);

      for (const a of anns) {
        await dbRun(
          'INSERT OR IGNORE INTO announcement_reads (announcement_id, portal_token) VALUES (?,?)',
          [a.id, token]);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Portale: badge count non letti (polling JS) ──────────────────
  app.get('/api/portale/:token/unread', async (req, res) => {
    const token = req.params.token;
    try {
      const row = await dbGet(
        `SELECT COUNT(*) AS cnt FROM announcements a
         WHERE (a.expires_at IS NULL OR a.expires_at > datetime('now','localtime'))
           AND (a.target_group_id IS NULL OR a.target_group_id = (
             SELECT id FROM assignment_groups WHERE portal_token=? LIMIT 1
           ))
           AND NOT EXISTS (
             SELECT 1 FROM announcement_reads ar
             WHERE ar.announcement_id = a.id AND ar.portal_token = ?
           )`,
        [token, token]);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate').json({ unread: row ? row.cnt : 0 });
    } catch (err) {
      res.set('Cache-Control', 'no-store').json({ unread: 0 });
    }
  });

};
