// ============================================================
// LUDICOMIX — Modulo Agenda Palinsesto
// File: agenda_routes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('./db');
const bwipjs  = require('bwip-js');

// ─────────────────────────────────────────────
// MIDDLEWARE AUTH
// ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

// ─────────────────────────────────────────────
// UTILITY — rilevamento conflitti spazio/orario
// Solo per eventi di tipo 'space'
// ─────────────────────────────────────────────
function checkConflict(spaceId, date, startTime, endTime, excludeEventId, callback) {
  const sql = `
    SELECT e.id, e.title, e.start_time, e.end_time, s.name AS space_name
    FROM events e
    JOIN spaces s ON s.id = e.space_id
    WHERE e.space_id = ?
      AND e.date = ?
      AND e.start_time < ?
      AND e.end_time > ?
      AND e.id != ?
  `;
  db.all(sql, [spaceId, date, endTime, startTime, excludeEventId || 0], callback);
}

// ─────────────────────────────────────────────
// UTILITY — flash
// ─────────────────────────────────────────────
function flash(req, type, msg) { req.session.flash = { type, msg }; }
function getFlash(req) {
  const f = req.session.flash || null;
  delete req.session.flash;
  return f;
}

// ══════════════════════════════════════════════
// AGENDA — DASHBOARD
// ══════════════════════════════════════════════

router.get('/agenda', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  db.all(`
    SELECT e.*,
      CASE
        WHEN e.location_type = 'space' THEN COALESCE(s.name, '—')
        WHEN e.location_type = 'stand' THEN COALESCE(e.custom_location, 'Stand')
        ELSE COALESCE(e.custom_location, 'Esterno')
      END AS space_name,
      COALESCE(s.color, '#718096') AS space_color,
      COUNT(r.id) AS seats_taken
    FROM events e
    LEFT JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    WHERE e.date = ?
    GROUP BY e.id
    ORDER BY e.start_time`, [date], (err, events) => {
    db.all(`SELECT * FROM spaces WHERE active = 1 ORDER BY name`, [], (err2, spaces) => {
      db.get(`SELECT COUNT(*) AS total FROM events`, [], (err3, totRow) => {
        db.get(`SELECT COUNT(*) AS total FROM registrations WHERE status='confirmed'`, [], (err4, regRow) => {
          res.render('agenda/dashboard', {
            currentUser: req.session.user,
            flash: getFlash(req),
            events: events || [],
            spaces: spaces || [],
            selectedDate: date,
            totalEvents:         totRow ? totRow.total : 0,
            totalRegistrations:  regRow ? regRow.total : 0,
            title: 'Agenda Palinsesto'
          });
        });
      });
    });
  });
});

// ══════════════════════════════════════════════
// SPAZI / SALE
// ══════════════════════════════════════════════

router.get('/agenda/spaces', requireAuth, (req, res) => {
  db.all(`SELECT s.*, COUNT(e.id) AS event_count
    FROM spaces s LEFT JOIN events e ON e.space_id = s.id
    GROUP BY s.id ORDER BY s.name`, [], (err, spaces) => {
    res.render('agenda/spaces', {
      currentUser: req.session.user, flash: getFlash(req),
      spaces: spaces || [], title: 'Sale e Spazi'
    });
  });
});

router.post('/agenda/spaces', requireAuth, (req, res) => {
  const { name, description, capacity, location, color } = req.body;
  if (!name || !capacity) {
    flash(req, 'error', 'Nome e capienza sono obbligatori.');
    return res.redirect('/agenda/spaces');
  }
  db.run(`INSERT INTO spaces (name, description, capacity, location, color) VALUES (?,?,?,?,?)`,
    [name.trim(), description || '', parseInt(capacity) || 0, location || '', color || '#4f98a3'],
    function(err) {
      if (err) flash(req, 'error', err.message.includes('UNIQUE') ? 'Nome sala già esistente.' : 'Errore salvataggio.');
      else flash(req, 'success', `Sala "${name}" creata.`);
      res.redirect('/agenda/spaces');
    });
});

router.post('/agenda/spaces/:id', requireAuth, (req, res) => {
  const { name, description, capacity, location, color, active } = req.body;
  db.run(`UPDATE spaces SET name=?, description=?, capacity=?, location=?, color=?, active=? WHERE id=?`,
    [name.trim(), description || '', parseInt(capacity) || 0, location || '', color || '#4f98a3', active ? 1 : 0, req.params.id],
    err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore aggiornamento sala.' : 'Sala aggiornata.');
      res.redirect('/agenda/spaces');
    });
});

router.post('/agenda/spaces/:id/delete', requireAuth, (req, res) => {
  db.get(`SELECT COUNT(*) AS n FROM events WHERE space_id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).send('Errore interno');
    if (row && row.n > 0) {
      flash(req, 'error', 'Impossibile eliminare: la sala ha eventi associati.');
      return res.redirect('/agenda/spaces');
    }
    db.run(`DELETE FROM spaces WHERE id = ?`, [req.params.id], err2 => {
      flash(req, err2 ? 'error' : 'success', err2 ? 'Errore eliminazione.' : 'Sala eliminata.');
      res.redirect('/agenda/spaces');
    });
  });
});

// ══════════════════════════════════════════════
// SPEAKER (lista interna admin)
// ══════════════════════════════════════════════

router.get('/agenda/speakers', requireAuth, (req, res) => {
  db.all(`SELECT sp.*, COUNT(es.event_id) AS event_count
    FROM speakers sp LEFT JOIN event_speakers es ON es.speaker_id = sp.id
    GROUP BY sp.id ORDER BY sp.name`, [], (err, speakers) => {
    res.render('agenda/speakers', {
      currentUser: req.session.user, flash: getFlash(req),
      speakers: speakers || [], title: 'Ospiti e Speaker'
    });
  });
});

router.post('/agenda/speakers', requireAuth, (req, res) => {
  const { name, bio, email, phone, social_url, notes } = req.body;
  if (!name) { flash(req, 'error', 'Il nome è obbligatorio.'); return res.redirect('/agenda/speakers'); }
  db.run(`INSERT INTO speakers (name, bio, email, phone, social_url, notes) VALUES (?,?,?,?,?,?)`,
    [name.trim(), bio || '', email || '', phone || '', social_url || '', notes || ''],
    err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore salvataggio.' : `Speaker "${name}" aggiunto.`);
      res.redirect('/agenda/speakers');
    });
});

router.post('/agenda/speakers/:id', requireAuth, (req, res) => {
  const { name, bio, email, phone, social_url, notes, active } = req.body;
  db.run(`UPDATE speakers SET name=?, bio=?, email=?, phone=?, social_url=?, notes=?, active=? WHERE id=?`,
    [name.trim(), bio || '', email || '', phone || '', social_url || '', notes || '', active ? 1 : 0, req.params.id],
    err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore aggiornamento.' : 'Speaker aggiornato.');
      res.redirect('/agenda/speakers');
    });
});

router.post('/agenda/speakers/:id/delete', requireAuth, (req, res) => {
  db.run(`DELETE FROM event_speakers WHERE speaker_id = ?`, [req.params.id], () => {
    db.run(`DELETE FROM speakers WHERE id = ?`, [req.params.id], err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore eliminazione.' : 'Speaker eliminato.');
      res.redirect('/agenda/speakers');
    });
  });
});

// ══════════════════════════════════════════════
// GUEST PROFILES (schede ospiti pubbliche)
// ══════════════════════════════════════════════

router.get('/agenda/guests', requireAuth, (req, res) => {
  const { q, category, published } = req.query;
  let sql = `SELECT * FROM guest_profiles WHERE 1=1`;
  const params = [];
  if (q)         { sql += ` AND name LIKE ?`;       params.push(`%${q}%`); }
  if (category)  { sql += ` AND category = ?`;      params.push(category); }
  if (published !== undefined && published !== '') { sql += ` AND is_published = ?`; params.push(parseInt(published)); }
  sql += ` ORDER BY sort_order, name`;
  db.all(sql, params, (err, guests) => {
    res.render('agenda/guests', {
      currentUser: req.session.user, flash: getFlash(req),
      guests: guests || [],
      filters: { q: q || '', category: category || '', published: published || '' },
      title: 'Schede Ospiti'
    });
  });
});

router.get('/agenda/guests/new', requireAuth, (req, res) => {
  res.render('agenda/guest_form', {
    currentUser: req.session.user, flash: getFlash(req),
    guest: {}, title: 'Nuovo Ospite'
  });
});

router.post('/agenda/guests', requireAuth, (req, res) => {
  const { name, category, bio, photo_url, stand_location, website_url, social_url, featured, is_published, sort_order } = req.body;
  if (!name) { flash(req, 'error', 'Il nome è obbligatorio.'); return res.redirect('/agenda/guests/new'); }
  db.run(`INSERT INTO guest_profiles (name, category, bio, photo_url, stand_location, website_url, social_url, featured, is_published, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [name.trim(), category || 'ospite', bio || '', photo_url || '', stand_location || '',
     website_url || '', social_url || '', featured ? 1 : 0, is_published ? 1 : 0, parseInt(sort_order) || 0],
    err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore salvataggio.' : `Ospite "${name}" aggiunto.`);
      res.redirect('/agenda/guests');
    });
});

router.get('/agenda/guests/:id/edit', requireAuth, (req, res) => {
  db.get(`SELECT * FROM guest_profiles WHERE id = ?`, [req.params.id], (err, guest) => {
    if (!guest) return res.redirect('/agenda/guests');
    res.render('agenda/guest_form', {
      currentUser: req.session.user, flash: getFlash(req),
      guest, title: 'Modifica Ospite'
    });
  });
});

router.post('/agenda/guests/:id', requireAuth, (req, res) => {
  const { name, category, bio, photo_url, stand_location, website_url, social_url, featured, is_published, sort_order } = req.body;
  if (!name) { flash(req, 'error', 'Il nome è obbligatorio.'); return res.redirect(`/agenda/guests/${req.params.id}/edit`); }
  db.run(`UPDATE guest_profiles SET name=?, category=?, bio=?, photo_url=?, stand_location=?,
    website_url=?, social_url=?, featured=?, is_published=?, sort_order=?, updated_at=datetime('now') WHERE id=?`,
    [name.trim(), category || 'ospite', bio || '', photo_url || '', stand_location || '',
     website_url || '', social_url || '', featured ? 1 : 0, is_published ? 1 : 0,
     parseInt(sort_order) || 0, req.params.id],
    err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore aggiornamento.' : 'Ospite aggiornato.');
      res.redirect('/agenda/guests');
    });
});

router.post('/agenda/guests/:id/toggle-publish', requireAuth, (req, res) => {
  db.get(`SELECT is_published FROM guest_profiles WHERE id=?`, [req.params.id], (err, g) => {
    if (!g) return res.redirect('/agenda/guests');
    const newVal = g.is_published === 1 ? 0 : 1;
    db.run(`UPDATE guest_profiles SET is_published=?, updated_at=datetime('now') WHERE id=?`, [newVal, req.params.id], () => {
      res.redirect(req.get('Referer') || '/agenda/guests');
    });
  });
});

router.post('/agenda/guests/:id/delete', requireAuth, (req, res) => {
  db.run(`DELETE FROM guest_profiles WHERE id=?`, [req.params.id], err => {
    flash(req, err ? 'error' : 'success', err ? 'Errore eliminazione.' : 'Ospite eliminato.');
    res.redirect('/agenda/guests');
  });
});

// ══════════════════════════════════════════════
// EVENTI
// ══════════════════════════════════════════════

router.get('/agenda/events', requireAuth, (req, res) => {
  const { date, space_id, published } = req.query;
  let sql = `
    SELECT e.*,
      CASE
        WHEN e.location_type = 'space' THEN COALESCE(s.name, '—')
        WHEN e.location_type = 'stand' THEN COALESCE(e.custom_location, 'Stand')
        ELSE COALESCE(e.custom_location, 'Esterno')
      END AS space_name,
      COALESCE(s.color, '#718096') AS space_color,
      COUNT(r.id) AS seats_taken,
      GROUP_CONCAT(sp.name, ', ') AS speakers_list
    FROM events e
    LEFT JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    LEFT JOIN event_speakers es ON es.event_id = e.id
    LEFT JOIN speakers sp ON sp.id = es.speaker_id
    WHERE 1=1`;
  const params = [];
  if (date)      { sql += ` AND e.date = ?`;       params.push(date); }
  if (space_id)  { sql += ` AND e.space_id = ?`;   params.push(space_id); }
  if (published !== undefined && published !== '') { sql += ` AND e.published = ?`; params.push(parseInt(published)); }
  sql += ` GROUP BY e.id ORDER BY e.date, e.start_time`;

  db.all(sql, params, (err, events) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err2, spaces) => {
      res.render('agenda/events', {
        currentUser: req.session.user, flash: getFlash(req),
        events: events || [], spaces: spaces || [],
        filters: { date, space_id, published }, title: 'Gestione Eventi'
      });
    });
  });
});

router.get('/agenda/events/new', requireAuth, (req, res) => {
  db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err, spaces) => {
    db.all(`SELECT * FROM speakers WHERE active=1 ORDER BY name`, [], (err2, speakers) => {
      res.render('agenda/event_form', {
        currentUser: req.session.user, flash: getFlash(req),
        event: {}, spaces: spaces || [], speakers: speakers || [],
        selectedSpeakers: [], title: 'Nuovo Evento'
      });
    });
  });
});

router.post('/agenda/events', requireAuth, (req, res) => {
  const {
    title, description, location_type, space_id, custom_location,
    date, start_time, end_time, max_seats, event_type,
    is_public, published, registrations_open, featured,
    image_url, tags, notes, speaker_ids, speaker_roles
  } = req.body;

  const locType = location_type || 'space';

  if (!title || !date || !start_time || !end_time) {
    flash(req, 'error', 'Titolo, data e orari sono obbligatori.');
    return res.redirect('/agenda/events/new');
  }
  if (locType === 'space' && !space_id) {
    flash(req, 'error', 'Seleziona una sala per gli eventi in sala.');
    return res.redirect('/agenda/events/new');
  }
  if (end_time <= start_time) {
    flash(req, 'error', "L'orario di fine deve essere successivo a quello di inizio.");
    return res.redirect('/agenda/events/new');
  }

  const doInsert = () => {
    db.run(`INSERT INTO events (title, description, location_type, space_id, custom_location,
      date, start_time, end_time, max_seats, event_type, is_public, published,
      registrations_open, featured, image_url, tags, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title.trim(), description || '', locType,
       locType === 'space' ? parseInt(space_id) : null,
       locType !== 'space' ? (custom_location || '').trim() : null,
       date, start_time, end_time,
       parseInt(max_seats) || 0, event_type || 'panel',
       is_public ? 1 : 0, published ? 1 : 0,
       registrations_open ? 1 : 0, featured ? 1 : 0,
       image_url || '', tags || '', notes || ''],
      function(err2) {
        if (err2) {
          flash(req, 'error', 'Errore salvataggio evento.');
          return res.redirect('/agenda/events/new');
        }
        const eventId = this.lastID;
        const ids   = Array.isArray(speaker_ids)   ? speaker_ids   : (speaker_ids   ? [speaker_ids]   : []);
        const roles = Array.isArray(speaker_roles)  ? speaker_roles : (speaker_roles ? [speaker_roles] : []);
        Promise.all(ids.map((sid, i) =>
          new Promise(resolve =>
            db.run(`INSERT OR IGNORE INTO event_speakers (event_id, speaker_id, role, order_num) VALUES (?,?,?,?)`,
              [eventId, sid, roles[i] || 'speaker', i], resolve))
        )).then(() => {
          flash(req, 'success', `Evento "${title}" creato.`);
          res.redirect('/agenda/events');
        });
      });
  };

  if (locType === 'space') {
    checkConflict(space_id, date, start_time, end_time, null, (err, conflicts) => {
      if (conflicts && conflicts.length > 0) {
        const c = conflicts[0];
        flash(req, 'error', `Conflitto con "${c.title}" (${c.start_time}–${c.end_time}) nella stessa sala.`);
        return res.redirect('/agenda/events/new');
      }
      doInsert();
    });
  } else {
    doInsert();
  }
});

router.get('/agenda/events/:id/edit', requireAuth, (req, res) => {
  db.get(`SELECT * FROM events WHERE id = ?`, [req.params.id], (err, event) => {
    if (err || !event) return res.redirect('/agenda/events');
    db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err2, spaces) => {
      db.all(`SELECT * FROM speakers WHERE active=1 ORDER BY name`, [], (err3, speakers) => {
        db.all(`SELECT speaker_id, role FROM event_speakers WHERE event_id = ? ORDER BY order_num`,
          [req.params.id], (err4, selectedSpeakers) => {
          res.render('agenda/event_form', {
            currentUser: req.session.user, flash: getFlash(req),
            event, spaces: spaces || [], speakers: speakers || [],
            selectedSpeakers: selectedSpeakers || [], title: 'Modifica Evento'
          });
        });
      });
    });
  });
});

router.post('/agenda/events/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const {
    title, description, location_type, space_id, custom_location,
    date, start_time, end_time, max_seats, event_type,
    is_public, published, registrations_open, featured,
    image_url, tags, notes, speaker_ids, speaker_roles
  } = req.body;

  const locType = location_type || 'space';

  if (!title || !date || !start_time || !end_time) {
    flash(req, 'error', 'Titolo, data e orari sono obbligatori.');
    return res.redirect(`/agenda/events/${id}/edit`);
  }
  if (locType === 'space' && !space_id) {
    flash(req, 'error', 'Seleziona una sala per gli eventi in sala.');
    return res.redirect(`/agenda/events/${id}/edit`);
  }
  if (end_time <= start_time) {
    flash(req, 'error', "L'orario di fine deve essere successivo a quello di inizio.");
    return res.redirect(`/agenda/events/${id}/edit`);
  }

  const doUpdate = () => {
    db.run(`UPDATE events SET title=?, description=?, location_type=?, space_id=?, custom_location=?,
      date=?, start_time=?, end_time=?, max_seats=?, event_type=?, is_public=?, published=?,
      registrations_open=?, featured=?, image_url=?, tags=?, notes=?, updated_at=datetime('now')
      WHERE id=?`,
      [title.trim(), description || '', locType,
       locType === 'space' ? parseInt(space_id) : null,
       locType !== 'space' ? (custom_location || '').trim() : null,
       date, start_time, end_time,
       parseInt(max_seats) || 0, event_type || 'panel',
       is_public ? 1 : 0, published ? 1 : 0,
       registrations_open ? 1 : 0, featured ? 1 : 0,
       image_url || '', tags || '', notes || '', id],
      function(err2) {
        if (err2) {
          flash(req, 'error', 'Errore aggiornamento evento.');
          return res.redirect(`/agenda/events/${id}/edit`);
        }
        db.run(`DELETE FROM event_speakers WHERE event_id = ?`, [id], () => {
          const ids   = Array.isArray(speaker_ids)   ? speaker_ids   : (speaker_ids   ? [speaker_ids]   : []);
          const roles = Array.isArray(speaker_roles)  ? speaker_roles : (speaker_roles ? [speaker_roles] : []);
          Promise.all(ids.map((sid, i) =>
            new Promise(resolve =>
              db.run(`INSERT OR IGNORE INTO event_speakers (event_id, speaker_id, role, order_num) VALUES (?,?,?,?)`,
                [id, sid, roles[i] || 'speaker', i], resolve))
          )).then(() => {
            flash(req, 'success', `Evento "${title}" aggiornato.`);
            res.redirect('/agenda/events');
          });
        });
      });
  };

  if (locType === 'space') {
    checkConflict(space_id, date, start_time, end_time, id, (err, conflicts) => {
      if (conflicts && conflicts.length > 0) {
        const c = conflicts[0];
        flash(req, 'error', `Conflitto con "${c.title}" (${c.start_time}–${c.end_time}) nella stessa sala.`);
        return res.redirect(`/agenda/events/${id}/edit`);
      }
      doUpdate();
    });
  } else {
    doUpdate();
  }
});

router.post('/agenda/events/:id/delete', requireAuth, (req, res) => {
  db.get(`SELECT title FROM events WHERE id=?`, [req.params.id], (err, ev) => {
    db.run(`DELETE FROM events WHERE id=?`, [req.params.id], err2 => {
      flash(req, err2 ? 'error' : 'success',
        err2 ? 'Errore eliminazione.' : `Evento "${ev ? ev.title : ''}" eliminato.`);
      res.redirect('/agenda/events');
    });
  });
});

router.post('/agenda/events/:id/publish', requireAuth, (req, res) => {
  db.get(`SELECT published FROM events WHERE id=?`, [req.params.id], (err, ev) => {
    const newStatus = ev && ev.published === 1 ? 0 : 1;
    db.run(`UPDATE events SET published=?, updated_at=datetime('now') WHERE id=?`,
      [newStatus, req.params.id], err2 => {
        flash(req, err2 ? 'error' : 'success',
          err2 ? 'Errore.' : (newStatus ? 'Evento pubblicato.' : 'Evento rimesso in bozza.'));
        res.redirect(req.get('Referer') || '/agenda/events');
      });
  });
});

// ══════════════════════════════════════════════
// ISCRIZIONI — admin per singolo evento
// ══════════════════════════════════════════════

router.get('/agenda/events/:id/registrations', requireAuth, (req, res) => {
  db.get(`SELECT e.*,
    CASE WHEN e.location_type='space' THEN COALESCE(s.name,'—')
         WHEN e.location_type='stand' THEN COALESCE(e.custom_location,'Stand')
         ELSE COALESCE(e.custom_location,'Esterno') END AS space_name
    FROM events e LEFT JOIN spaces s ON s.id=e.space_id WHERE e.id=?`, [req.params.id], (err, event) => {
    if (!event) return res.redirect('/agenda/events');
    db.all(`SELECT r.*,
      CASE WHEN r.pass_id IS NOT NULL THEN 'Sì' ELSE 'No' END AS has_pass
      FROM registrations r WHERE r.event_id=? ORDER BY r.registered_at`, [req.params.id], (err2, regs) => {
      db.get(`SELECT COUNT(*) AS confirmed FROM registrations WHERE event_id=? AND status='confirmed'`,
        [req.params.id], (err3, cnt) => {
        res.render('agenda/registrations', {
          currentUser: req.session.user, flash: getFlash(req),
          event, registrations: regs || [],
          confirmedCount: cnt ? cnt.confirmed : 0,
          title: `Iscrizioni — ${event.title}`
        });
      });
    });
  });
});

router.post('/agenda/events/:id/registrations/:rid/cancel', requireAuth, (req, res) => {
  db.run(`UPDATE registrations SET status='cancelled', cancelled_at=datetime('now') WHERE id=?`,
    [req.params.rid], err => {
      flash(req, err ? 'error' : 'success', err ? 'Errore.' : 'Iscrizione annullata.');
      res.redirect(`/agenda/events/${req.params.id}/registrations`);
    });
});

// ══════════════════════════════════════════════
// RIEPILOGO GLOBALE ISCRIZIONI
// ══════════════════════════════════════════════

router.get('/agenda/registrations', requireAuth, (req, res) => {
  db.all(`SELECT r.*, e.title AS event_title, e.date, e.start_time,
    CASE WHEN e.location_type='space' THEN COALESCE(s.name,'—')
         WHEN e.location_type='stand' THEN COALESCE(e.custom_location,'Stand')
         ELSE COALESCE(e.custom_location,'Esterno') END AS space_name
    FROM registrations r
    JOIN events e ON e.id=r.event_id
    LEFT JOIN spaces s ON s.id=e.space_id
    ORDER BY r.registered_at DESC LIMIT 200`, [], (err, regs) => {
    res.render('agenda/all_registrations', {
      currentUser: req.session.user, flash: getFlash(req),
      registrations: regs || [], title: 'Tutte le Iscrizioni'
    });
  });
});

// ══════════════════════════════════════════════
// PROGRAMMA PUBBLICO
// ══════════════════════════════════════════════

router.get('/programma', (req, res) => {
  const { date, space, type, q } = req.query;
  let sql = `SELECT * FROM v_public_program WHERE 1=1`;
  const params = [];
  if (date)  { sql += ` AND date = ?`;            params.push(date); }
  if (space) { sql += ` AND space_name = ?`;      params.push(space); }
  if (type)  { sql += ` AND event_type = ?`;      params.push(type); }
  if (q)     { sql += ` AND (title LIKE ? OR speakers_list LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }
  sql += ` ORDER BY date, start_time`;

  db.all(sql, params, (err, events) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }

    db.all(`SELECT DISTINCT date FROM events WHERE published=1 AND is_public=1 ORDER BY date`, [], (err2, dates) => {
      db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err3, spaces) => {
        db.all(`SELECT * FROM guest_profiles WHERE is_published=1 ORDER BY sort_order, name`, [], (err4, guests) => {

          const featured = (events || []).filter(e => e.featured === 1);
          res.render('agenda/public_program', {
            currentUser: null,
            events:   events   || [],
            featured: featured || [],
            dates:    dates    || [],
            spaces:   spaces   || [],
            guests:   guests   || [],
            filters: { date: date || '', space: space || '', type: type || '', q: q || '' },
            title: 'Programma Ludicomix'
          });
        });
      });
    });
  });
});

// ── QR Code programma ─────────────────────────────────
router.get('/programma/qr', (req, res) => {
  const baseUrl  = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const targetUrl = `${baseUrl}/programma`;
  bwipjs.toBuffer({
    bcid: 'qrcode', text: targetUrl, scale: 4, eclevel: 'M',
    backgroundcolor: 'ffffff', barcolor: '01696f'
  }, (err, png) => {
    if (err) return res.status(500).send('Errore QR');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="programma-qr.png"');
    res.send(png);
  });
});

// ── Iscrizione pubblica ───────────────────────────────
router.get('/programma/iscriviti/:id', (req, res) => {
  db.get(`SELECT e.*,
    CASE WHEN e.location_type='space' THEN COALESCE(s.name,'—')
         WHEN e.location_type='stand' THEN COALESCE(e.custom_location,'Stand')
         ELSE COALESCE(e.custom_location,'Esterno') END AS space_name,
    COUNT(r.id) AS seats_taken
    FROM events e
    LEFT JOIN spaces s ON s.id=e.space_id
    LEFT JOIN registrations r ON r.event_id=e.id AND r.status='confirmed'
    WHERE e.id=? AND e.published=1 AND e.is_public=1 AND e.registrations_open=1
    GROUP BY e.id`, [req.params.id], (err, event) => {
    if (!event) return res.redirect('/programma');
    const full    = event.max_seats > 0 && event.seats_taken >= event.max_seats;
    const success = req.query.success === '1';
    res.render('agenda/register_form', {
      currentUser: null, event, full, success,
      flash: getFlash(req), title: `Iscrizione — ${event.title}`
    });
  });
});

router.post('/programma/iscriviti/:id', (req, res) => {
  const { first_name, last_name, email, phone } = req.body;
  const eventId = req.params.id;
  if (!first_name || !last_name || !email) {
    flash(req, 'error', 'Nome, cognome ed email sono obbligatori.');
    return res.redirect(`/programma/iscriviti/${eventId}`);
  }
  db.get(`SELECT e.max_seats, e.registrations_open, COUNT(r.id) AS seats_taken
    FROM events e LEFT JOIN registrations r ON r.event_id=e.id AND r.status='confirmed'
    WHERE e.id=? GROUP BY e.id`, [eventId], (err, ev) => {
    if (!ev) return res.redirect('/programma');
    if (!ev.registrations_open) {
      flash(req, 'error', 'Le iscrizioni per questo evento non sono aperte.');
      return res.redirect(`/programma/iscriviti/${eventId}`);
    }
    if (ev.max_seats > 0 && ev.seats_taken >= ev.max_seats) {
      flash(req, 'error', 'Spiacente, i posti disponibili sono esauriti.');
      return res.redirect(`/programma/iscriviti/${eventId}`);
    }
    db.run(`INSERT INTO registrations (event_id, first_name, last_name, email, phone) VALUES (?,?,?,?,?)`,
      [eventId, first_name.trim(), last_name.trim(), email.trim().toLowerCase(), phone || ''],
      function(err2) {
        if (err2 && err2.message.includes('UNIQUE')) {
          flash(req, 'error', 'Sei già iscritto a questo evento con questa email.');
          return res.redirect(`/programma/iscriviti/${eventId}`);
        }
        if (err2) {
          flash(req, 'error', "Errore durante l'iscrizione. Riprova.");
          return res.redirect(`/programma/iscriviti/${eventId}`);
        }
        flash(req, 'success', 'Iscrizione confermata! Ti aspettiamo.');
        res.redirect(`/programma/iscriviti/${eventId}?success=1`);
      });
  });
});

module.exports = router;
