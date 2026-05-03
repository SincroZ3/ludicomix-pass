/**
 * helpers/notifications.js
 * ──────────────────────────────────────────────────────────────────
 * Notifiche interne + invio email via SMTP.
 * Riceve `db` come parametro per evitare dipendenze circolari.
 * ──────────────────────────────────────────────────────────────────
 */

const nodemailer = require('nodemailer');

function createNotification(db, type, title, message, relatedType, relatedId) {
  db.run(
    'INSERT INTO notifications(type,title,message,related_type,related_id) VALUES(?,?,?,?,?)',
    [type, title, message, relatedType || null, relatedId || null],
    function (err) {
      if (!err) trySendEmail(db, title, message);
    }
  );
}

function trySendEmail(db, subj, html) {
  db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'", [], function (e, rows) {
    if (e || !rows) return;
    const c = {};
    rows.forEach(function (r) { c[r.key] = r.value; });
    if (!c.smtp_host || !c.smtp_to) return;
    nodemailer.createTransport({
      host: c.smtp_host,
      port: parseInt(c.smtp_port || '587', 10),
      secure: c.smtp_secure === '1',
      auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
      tls: { rejectUnauthorized: false },
    }).sendMail({
      from: c.smtp_from || 'noreply@ludicomix.it',
      to: c.smtp_to,
      subject: '[Ludicomix] ' + subj,
      html: '<div style="font-family:sans-serif">' + html + '</div>',
    }, function (err2) {
      if (err2) console.error('Email error:', err2.message);
    });
  });
}

function checkGroupLimit(db, gid) {
  db.get(
    `SELECT ag.max_passes, ag.name,
            COUNT(CASE WHEN p.status != 'INVALIDATO' THEN 1 END) AS cnt
     FROM assignment_groups ag
     LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
     LEFT JOIN passes p ON p.participant_id = pa.id
     WHERE ag.id = ?
     GROUP BY ag.id`,
    [gid],
    function (err, row) {
      if (err || !row || !row.max_passes) return;
      const pct = Math.round((row.cnt / row.max_passes) * 100);
      if (pct >= 100) {
        createNotification(db, 'limit_reached', 'Limite gruppo raggiunto',
          `Gruppo <strong>${row.name}</strong> al 100% (${row.cnt}/${row.max_passes}).`,
          'group', gid);
      } else if (pct >= 90) {
        createNotification(db, 'limit_warning', 'Gruppo vicino al limite',
          `Gruppo <strong>${row.name}</strong> al ${pct}% (${row.cnt}/${row.max_passes}).`,
          'group', gid);
      }
    }
  );
}

module.exports = { createNotification, trySendEmail, checkGroupLimit };
