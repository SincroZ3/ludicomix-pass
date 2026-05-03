/**
 * helpers/db-utils.js
 * ──────────────────────────────────────────────────────────────────
 * Wrapper promisificati per sqlite3 e costanti condivise.
 * ──────────────────────────────────────────────────────────────────
 */

const { promisify } = require('util');

function makeDbHelpers(db) {
  const dbAll = promisify(db.all.bind(db));
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

  return { dbAll, dbGet, dbRun };
}

function logAction(db, userId, action, entityType, entityId, details) {
  db.run(
    'INSERT INTO action_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId || null, action, entityType || null, entityId || null, details || null],
    (err) => { if (err) console.error('Errore salvataggio log azione:', err); }
  );
}

function generateRandomCode(len = 18) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

const PASS_STATUSES = ['GENERATO', 'SCARICATO', 'STAMPATO', 'CONSEGNATO', 'RICONSEGNATO'];

module.exports = { makeDbHelpers, logAction, generateRandomCode, PASS_STATUSES };
