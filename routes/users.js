/**
 * routes/users.js
 * ──────────────────────────────────────────────────────────────────
 * Gestione utenti admin, cambio password, sicurezza account.
 *
 * Route registrate:
 *   GET  /account/password
 *   POST /account/password
 *   GET  /account/security
 *   GET  /admin/users          (redirect a settings#utenti)
 *   POST /admin/users
 *   GET  /admin/users/:id/edit
 *   POST /admin/users/:id
 *   POST /admin/users/:id/reset-password
 *   POST /admin/users/:id/delete
 * ──────────────────────────────────────────────────────────────────
 */

const bcrypt = require('bcryptjs');
const { promisify } = require('util');

module.exports = function registerUserRoutes(app, db, { requireAuth, requireAdmin, logAction, ROLES }) {

  const dbGet = promisify(db.get.bind(db));
  function dbRun(sql, ...p) {
    return new Promise((resolve, reject) => {
      const params = p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  // ── Cambio password (utente corrente) ────────────────────────────
  app.get('/account/password', requireAuth, (req, res) => {
    res.render('change_password', { error: null, success: null });
  });

  app.post('/account/password', requireAuth, (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    if (!old_password || !new_password || !confirm_password) {
      return res.render('change_password', { error: 'Compila tutti i campi.', success: null });
    }
    if (new_password !== confirm_password) {
      return res.render('change_password', { error: 'Le nuove password non coincidono.', success: null });
    }
    db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user) {
        return res.render('change_password', { error: 'Utente non trovato.', success: null });
      }
      if (!bcrypt.compareSync(old_password, user.password_hash)) {
        return res.render('change_password', { error: 'Password attuale errata.', success: null });
      }
      const hash = bcrypt.hashSync(new_password, 10);
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id], (err2) => {
        if (err2) {
          return res.render('change_password', { error: 'Errore aggiornamento password.', success: null });
        }
        logAction(user.id, 'change_password', 'user', user.id, 'Password modificata');
        res.render('change_password', { error: null, success: 'Password aggiornata con successo.' });
      });
    });
  });

  // ── Pagina sicurezza account ─────────────────────────────────────
  app.get('/account/security', requireAuth, (req, res) => {
    res.render('security');
  });

  // ── Lista utenti (redirect a tab nella settings) ─────────────────
  app.get('/admin/users', requireAdmin, (req, res) => {
    res.redirect('/admin/settings#utenti');
  });

  // ── Crea nuovo utente ────────────────────────────────────────────
  app.post('/admin/users', requireAdmin, (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).send('Tutti i campi utente sono obbligatori');
    }
    const hash = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, role],
      function (err) {
        if (err) return res.status(500).send('Errore creazione utente (forse username già esistente).');
        logAction(req.session.user.id, 'create_user', 'user', this.lastID, `Creato utente ${username} (${role})`);
        res.redirect('/admin/settings#utenti');
      }
    );
  });

  // ── Form modifica utente ─────────────────────────────────────────
  app.get('/admin/users/:id/edit', requireAdmin, async (req, res) => {
    const id   = parseInt(req.params.id, 10);
    const user = await dbGet('SELECT id, username, role, created_at FROM users WHERE id=?', [id]);
    if (!user) return res.status(404).send('Utente non trovato');
    res.render('admin_user_edit', {
      editUser:    user,
      currentUser: req.session.user,
      saved:       req.query.saved,
      error:       req.query.error,
      ROLES,
    });
  });

  // ── Salva modifica utente (username + ruolo) ─────────────────────
  app.post('/admin/users/:id', requireAdmin, async (req, res) => {
    const id         = parseInt(req.params.id, 10);
    const { username, role } = req.body;
    const validRoles = Object.values(ROLES);

    if (!username || !role || !validRoles.includes(role)) {
      return res.redirect('/admin/users/' + id + '/edit?error=invalid');
    }
    // Impedisci di declassare se stessi
    if (id === req.session.user.id && role !== ROLES.ADMIN) {
      return res.redirect('/admin/users/' + id + '/edit?error=self-demote');
    }
    try {
      const existing = await dbGet('SELECT id FROM users WHERE username=? AND id!=?', [username, id]);
      if (existing) return res.redirect('/admin/users/' + id + '/edit?error=username-taken');
      await dbRun('UPDATE users SET username=?, role=? WHERE id=?', [username.trim(), role, id]);
      logAction(req.session.user.id, 'edit_user', 'user', id, `Username: ${username.trim()}, Ruolo: ${role}`);
      res.redirect('/admin/users/' + id + '/edit?saved=1');
    } catch (err) {
      console.error('Errore edit user:', err);
      res.redirect('/admin/users/' + id + '/edit?error=db');
    }
  });

  // ── Reset password da admin ──────────────────────────────────────
  app.post('/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { new_password, confirm_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.redirect('/admin/users/' + id + '/edit?error=pwd-short');
    }
    if (new_password !== confirm_password) {
      return res.redirect('/admin/users/' + id + '/edit?error=pwd-mismatch');
    }
    try {
      const hash = bcrypt.hashSync(new_password, 10);
      await dbRun('UPDATE users SET password_hash=? WHERE id=?', [hash, id]);
      logAction(req.session.user.id, 'reset_user_password', 'user', id, 'Password reimpostata da admin');
      res.redirect('/admin/users/' + id + '/edit?saved=pwd');
    } catch (err) {
      console.error('Errore reset password:', err);
      res.redirect('/admin/users/' + id + '/edit?error=db');
    }
  });

  // ── Elimina utente ───────────────────────────────────────────────
  app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.session.user.id) {
      return res.status(400).send('Non puoi eliminare il tuo stesso utente.');
    }
    db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione utente');
      if (this.changes > 0) logAction(req.session.user.id, 'delete_user', 'user', id, 'Utente eliminato');
      res.redirect('/admin/settings#utenti');
    });
  });

};
