// ============================================================
// LUDICOMIX — Modulo Agenda Palinsesto
// File: agenda_routes.js
//
// INTEGRAZIONE IN server.js (aggiungi queste 2 righe):
//   const agendaRoutes = require('./agenda_routes');
//   app.use('/', agendaRoutes);
//
// Richiede middleware già presenti in server.js:
//   - express-session con req.session.user
//   - helmet, express.urlencoded
//   - bwip-js già in package.json
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('./db');
const bwipjs  = require('bwip-js');

module.exports = function agendaRoutes(logActionFn) {
const logAction = logActionFn || function(){};

// ─────────────────────────────────────────────
// MIDDLEWARE AUTH — protegge tutte le rotte /agenda/*
// ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (!['admin','organizer'].includes(req.session.user.role)) return res.status(403).send('Accesso negato');
  next();
}

function requireNotViewer(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'viewer') return res.status(403).send('Accesso negato');
  next();
}

// ─────────────────────────────────────────────
// UTILITY — rilevamento conflitti spazio/orario
// Ritorna array di eventi in conflitto (vuoto = nessun conflitto)
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
// UTILITY — formatta errori flash
// ─────────────────────────────────────────────
function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

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

  // Tutti gli eventi (per il calendario) + eventi del giorno selezionato
  db.all(`SELECT e.*, s.name AS space_name, s.color AS space_color, s.capacity AS space_capacity,
    COUNT(r.id) AS seats_taken
    FROM events e
    JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    GROUP BY e.id
    ORDER BY e.date, e.start_time`, [], (err, allEvents) => {

    db.all(`SELECT * FROM spaces WHERE active = 1 ORDER BY name`, [], (err2, spaces) => {
      db.get(`SELECT COUNT(*) AS total FROM events`, [], (err3, totRow) => {
        db.get(`SELECT COUNT(*) AS total FROM registrations WHERE status='confirmed'`, [], (err4, regRow) => {
          res.render('agenda/dashboard', {
            currentUser: req.session.user,
            flash: getFlash(req),
            allEvents: allEvents || [],
            events: (allEvents || []).filter(e => e.date === date),
            spaces: spaces || [],
            selectedDate: date,
            totalEvents: totRow ? totRow.total : 0,
            totalRegistrations: regRow ? regRow.total : 0,
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
    FROM spaces s
    LEFT JOIN events e ON e.space_id = s.id
    GROUP BY s.id
    ORDER BY s.name`, [], (err, spaces) => {
    res.render('agenda/spaces', {
      currentUser: req.session.user,
      flash: getFlash(req),
      spaces: spaces || [],
      title: 'Sale e Spazi'
    });
  });
});

router.post('/agenda/spaces', requireAuth, (req, res) => {
  const { name, description, capacity, location, color } = req.body;
  if (!name || !capacity) {
    flash(req, 'error', 'Nome e capienza sono obbligatori.');
    return res.redirect('/agenda/spaces');
  }
  db.run(
    `INSERT INTO spaces (name, description, capacity, location, color) VALUES (?,?,?,?,?)`,
    [name.trim(), description || '', parseInt(capacity) || 0, location || '', color || '#4f98a3'],
    function(err) {
      if (err) {
        flash(req, 'error', err.message.includes('UNIQUE') ? 'Nome sala già esistente.' : 'Errore salvataggio.');
      } else {
        flash(req, 'success', `Sala "${name}" creata.`);
        logAction(req.session.user?.id,'create_agenda_space','space',this.lastID,`Sala creata: ${name.trim()}`);
      }
      res.redirect('/agenda/spaces');
    }
  );
});

router.post('/agenda/spaces/:id', requireAuth, (req, res) => {
  const { name, description, capacity, location, color, active } = req.body;
  db.run(
    `UPDATE spaces SET name=?, description=?, capacity=?, location=?, color=?, active=? WHERE id=?`,
    [name.trim(), description || '', parseInt(capacity) || 0, location || '', color || '#4f98a3', active ? 1 : 0, req.params.id],
    function(err) {
      if(!err) logAction(req.session.user?.id,'edit_agenda_space','space',req.params.id,`Sala #${req.params.id} aggiornata`);
      flash(req, err ? 'error' : 'success', err ? 'Errore aggiornamento sala.' : 'Sala aggiornata.');
      res.redirect('/agenda/spaces');
    }
  );
});

router.post('/agenda/spaces/:id/delete', requireAuth, (req, res) => {
  db.get(`SELECT COUNT(*) AS n FROM events WHERE space_id = ?`, [req.params.id], (err, row) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    if (row && row.n > 0) {
      flash(req, 'error', 'Impossibile eliminare: la sala ha eventi associati.');
      return res.redirect('/agenda/spaces');
    }
    db.run(`DELETE FROM spaces WHERE id = ?`, [req.params.id], (err2) => {
      if(!err2) logAction(req.session.user?.id,'delete_agenda_space','space',req.params.id,'Sala eliminata');
      flash(req, err2 ? 'error' : 'success', err2 ? 'Errore eliminazione.' : 'Sala eliminata.');
      res.redirect('/agenda/spaces');
    });
  });
});

// ══════════════════════════════════════════════
// SPEAKER / OSPITI PANEL
// ══════════════════════════════════════════════

router.get('/agenda/speakers', requireAuth, (req, res) => {
  db.all(`SELECT sp.*, COUNT(es.event_id) AS event_count
    FROM speakers sp
    LEFT JOIN event_speakers es ON es.speaker_id = sp.id
    GROUP BY sp.id
    ORDER BY sp.name`, [], (err, speakers) => {
    res.render('agenda/speakers', {
      currentUser: req.session.user,
      flash: getFlash(req),
      speakers: speakers || [],
      title: 'Ospiti e Speaker'
    });
  });
});

router.post('/agenda/speakers', requireAuth, (req, res) => {
  const { name, bio, photo_url, email, phone, social_url, notes } = req.body;
  if (!name) {
    flash(req, 'error', 'Il nome è obbligatorio.');
    return res.redirect('/agenda/speakers');
  }
  db.run(
    `INSERT INTO speakers (name, bio, photo_url, email, phone, social_url, notes) VALUES (?,?,?,?,?,?,?)`,
    [name.trim(), bio || '', photo_url || '', email || '', phone || '', social_url || '', notes || ''],
    function(err) {
      if(!err) logAction(req.session.user?.id,'create_speaker','speaker',this.lastID,`Speaker aggiunto: ${name.trim()}`);
      flash(req, err ? 'error' : 'success', err ? 'Errore salvataggio.' : `Speaker "${name}" aggiunto.`);
      res.redirect('/agenda/speakers');
    }
  );
});

router.post('/agenda/speakers/:id', requireAuth, (req, res) => {
  const { name, bio, photo_url, email, phone, social_url, notes, active } = req.body;
  db.run(
    `UPDATE speakers SET name=?, bio=?, photo_url=?, email=?, phone=?, social_url=?, notes=?, active=? WHERE id=?`,
    [name.trim(), bio || '', photo_url || '', email || '', phone || '', social_url || '', notes || '', active ? 1 : 0, req.params.id],
    function(err) {
      if(!err) logAction(req.session.user?.id,'edit_speaker','speaker',req.params.id,`Speaker #${req.params.id} aggiornato`);
      flash(req, err ? 'error' : 'success', err ? 'Errore aggiornamento.' : 'Speaker aggiornato.');
      res.redirect('/agenda/speakers');
    }
  );
});

router.post('/agenda/speakers/:id/delete', requireAuth, (req, res) => {
  db.run(`DELETE FROM event_speakers WHERE speaker_id = ?`, [req.params.id], () => {
    db.run(`DELETE FROM speakers WHERE id = ?`, [req.params.id], (err) => {
      if(!err) logAction(req.session.user?.id,'delete_speaker','speaker',req.params.id,'Speaker eliminato');
      flash(req, err ? 'error' : 'success', err ? 'Errore eliminazione.' : 'Speaker eliminato.');
      res.redirect('/agenda/speakers');
    });
  });
});

// ══════════════════════════════════════════════
// OSPITI FESTIVAL (guests)
// ══════════════════════════════════════════════

router.get('/agenda/guests', requireAuth, (req, res) => {
  const { category, featured } = req.query;
  let sql = `SELECT * FROM guests WHERE 1=1`;
  const params = [];
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (featured !== undefined && featured !== '') { sql += ` AND featured = ?`; params.push(parseInt(featured)); }
  sql += ` ORDER BY sort_order ASC, name ASC`;

  db.all(sql, params, (err, guests) => {
    if (err) { console.error('[Guests]', err.message); return res.status(500).send('Errore interno'); }
    db.all(`SELECT DISTINCT category FROM guests WHERE category IS NOT NULL AND category != '' ORDER BY category`, [], (err2, cats) => {
      res.render('agenda/guests', {
        currentUser: req.session.user,
        flash: getFlash(req),
        guests: guests || [],
        categories: (cats || []).map(c => c.category),
        filters: { category, featured },
        title: 'Ospiti del Festival'
      });
    });
  });
});

router.get('/agenda/guests/new', requireAuth, (req, res) => {
  db.all(`SELECT DISTINCT category FROM guests WHERE category IS NOT NULL AND category != '' ORDER BY category`, [], (err, cats) => {
    res.render('agenda/guest_form', {
      currentUser: req.session.user,
      flash: getFlash(req),
      guest: {},
      categories: (cats || []).map(c => c.category),
      title: 'Nuovo Ospite'
    });
  });
});

router.post('/agenda/guests', requireAuth, (req, res) => {
  const { name, bio, photo_url, category, stand_location, sort_order, featured, active } = req.body;
  if (!name) {
    flash(req, 'error', 'Il nome è obbligatorio.');
    return res.redirect('/agenda/guests/new');
  }
  db.run(
    `INSERT INTO guests (name, bio, photo_url, category, stand_location, sort_order, featured, active)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      name.trim(),
      bio || '',
      photo_url || '',
      category || '',
      stand_location || '',
      parseInt(sort_order) || 0,
      featured ? 1 : 0,
      active !== undefined ? (active ? 1 : 0) : 1
    ],
    function(err) {
      if (err) {
        flash(req, 'error', 'Errore salvataggio ospite.');
        return res.redirect('/agenda/guests/new');
      }
      logAction(req.session.user?.id,'create_guest','guest',this.lastID,`Ospite aggiunto: ${name.trim()}`);
      flash(req, 'success', `Ospite "${name}" aggiunto.`);
      res.redirect('/agenda/guests');
    }
  );
});

router.get('/agenda/guests/:id/edit', requireAuth, (req, res) => {
  db.get(`SELECT * FROM guests WHERE id = ?`, [req.params.id], (err, guest) => {
    if (err || !guest) return res.redirect('/agenda/guests');
    db.all(`SELECT DISTINCT category FROM guests WHERE category IS NOT NULL AND category != '' ORDER BY category`, [], (err2, cats) => {
      res.render('agenda/guest_form', {
        currentUser: req.session.user,
        flash: getFlash(req),
        guest,
        categories: (cats || []).map(c => c.category),
        title: 'Modifica Ospite'
      });
    });
  });
});

router.post('/agenda/guests/:id', requireAuth, (req, res) => {
  const { name, bio, photo_url, category, stand_location, sort_order, featured, active } = req.body;
  if (!name) {
    flash(req, 'error', 'Il nome è obbligatorio.');
    return res.redirect(`/agenda/guests/${req.params.id}/edit`);
  }
  db.run(
    `UPDATE guests SET name=?, bio=?, photo_url=?, category=?, stand_location=?,
     sort_order=?, featured=?, active=? WHERE id=?`,
    [
      name.trim(),
      bio || '',
      photo_url || '',
      category || '',
      stand_location || '',
      parseInt(sort_order) || 0,
      featured ? 1 : 0,
      active ? 1 : 0,
      req.params.id
    ],
    function(err) {
      if(!err) logAction(req.session.user?.id,'edit_guest','guest',req.params.id,`Ospite aggiornato: ${name.trim()}`);
      flash(req, err ? 'error' : 'success', err ? 'Errore aggiornamento ospite.' : `Ospite "${name}" aggiornato.`);
      res.redirect('/agenda/guests');
    }
  );
});

router.post('/agenda/guests/:id/delete', requireAuth, (req, res) => {
  db.get(`SELECT name FROM guests WHERE id=?`, [req.params.id], (err, g) => {
    db.run(`DELETE FROM guests WHERE id=?`, [req.params.id], (err2) => {
      if(!err2) logAction(req.session.user?.id,'delete_guest','guest',req.params.id,`Ospite eliminato: ${g?g.name:''}`);
      flash(req, err2 ? 'error' : 'success', err2 ? 'Errore eliminazione.' : `Ospite "${g ? g.name : ''}" eliminato.`);
      res.redirect('/agenda/guests');
    });
  });
});

router.post('/agenda/guests/:id/toggle-featured', requireAuth, (req, res) => {
  db.get(`SELECT featured FROM guests WHERE id=?`, [req.params.id], (err, g) => {
    if (err || !g) return res.redirect('/agenda/guests');
    const newVal = g.featured === 1 ? 0 : 1;
    db.run(`UPDATE guests SET featured=? WHERE id=?`, [newVal, req.params.id], (err2) => {
      if(!err2) logAction(req.session.user?.id,'toggle_guest_featured','guest',req.params.id,(newVal?'In evidenza':'Evidenza rimossa')+' ospite #'+req.params.id);
      flash(req, err2 ? 'error' : 'success', err2 ? 'Errore.' : (newVal ? 'Ospite messo in evidenza.' : 'Evidenza rimossa.'));
      res.redirect(req.get('Referer') || '/agenda/guests');
    });
  });
});

// ══════════════════════════════════════════════
// EVENTI
// ══════════════════════════════════════════════

router.get('/agenda/events', requireAuth, (req, res) => {
  const { date, space_id, published } = req.query;
  let sql = `SELECT e.*, s.name AS space_name, s.color AS space_color,
    COUNT(r.id) AS seats_taken,
    GROUP_CONCAT(sp.name, ', ') AS speakers_list
    FROM events e
    JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    LEFT JOIN event_speakers es ON es.event_id = e.id
    LEFT JOIN speakers sp ON sp.id = es.speaker_id
    WHERE 1=1`;
  const params = [];
  if (date) { sql += ` AND e.date = ?`; params.push(date); }
  if (space_id) { sql += ` AND e.space_id = ?`; params.push(space_id); }
  if (published !== undefined && published !== '') {
    sql += ` AND e.published = ?`;
    params.push(parseInt(published));
  }
  sql += ` GROUP BY e.id ORDER BY e.date, e.start_time`;

  db.all(sql, params, (err, events) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err2, spaces) => {
      res.render('agenda/events', {
        currentUser: req.session.user,
        flash: getFlash(req),
        events: events || [],
        spaces: spaces || [],
        filters: { date, space_id, published },
        title: 'Gestione Eventi'
      });
    });
  });
});

router.get('/agenda/events/new', requireAuth, (req, res) => {
  db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err, spaces) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    db.all(`SELECT * FROM speakers WHERE active=1 ORDER BY name`, [], (err2, speakers) => {
      res.render('agenda/event_form', {
        currentUser: req.session.user,
        flash: getFlash(req),
        event: {},
        spaces: spaces || [],
        speakers: speakers || [],
        selectedSpeakers: [],
        title: 'Nuovo Evento'
      });
    });
  });
});

router.post('/agenda/events', requireAuth, (req, res) => {
  const { title, description, space_id, date, start_time, end_time,
          max_seats, event_type, is_public, published, registrations_open, featured, image_url, tags, notes,
          location_type, location_text, free_entry, ticketed_area,
          speaker_ids, speaker_roles } = req.body;
  const locationTextVal = ['espositore','associazione'].includes(location_type) ? (location_text || '').trim() || null : null;

  if (!title || !space_id || !date || !start_time || !end_time) {
    flash(req, 'error', 'Titolo, sala, data e orari sono obbligatori.');
    return res.redirect('/agenda/events/new');
  }
  if (end_time <= start_time) {
    flash(req, 'error', "L'orario di fine deve essere successivo a quello di inizio.");
    return res.redirect('/agenda/events/new');
  }

  const forceConflict = req.body.force === '1';

  checkConflict(space_id, date, start_time, end_time, null, (err, conflicts) => {
    if (!forceConflict && conflicts && conflicts.length > 0) {
      const c = conflicts[0];
      flash(req, 'error', `Conflitto con "${c.title}" (${c.start_time}–${c.end_time}) nella stessa sala.`);
      return res.redirect('/agenda/events/new');
    }

    db.run(
      `INSERT INTO events (title, description, space_id, date, start_time, end_time,
        max_seats, event_type, is_public, published, registrations_open, featured, image_url, tags, notes, location_text, free_entry, ticketed_area)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title.trim(), description || '', parseInt(space_id), date, start_time, end_time,
       parseInt(max_seats) || 0, event_type || 'panel',
       is_public ? 1 : 0, published ? 1 : 0, registrations_open ? 1 : 0, featured ? 1 : 0,
       image_url || '', tags || '', notes || '', locationTextVal,
       free_entry ? 1 : 0, ticketed_area ? 1 : 0],
      function(err2) {
        if (err2) {
          flash(req, 'error', 'Errore salvataggio evento.');
          return res.redirect('/agenda/events/new');
        }
        const eventId = this.lastID;
        const ids   = Array.isArray(speaker_ids)   ? speaker_ids   : (speaker_ids   ? [speaker_ids]   : []);
        const roles = Array.isArray(speaker_roles)  ? speaker_roles : (speaker_roles ? [speaker_roles] : []);
        const stmts = ids.map((sid, i) =>
          new Promise(resolve =>
            db.run(`INSERT OR IGNORE INTO event_speakers (event_id, speaker_id, role, order_num) VALUES (?,?,?,?)`,
              [eventId, sid, roles[i] || 'speaker', i], resolve)
          )
        );
        Promise.all(stmts).then(() => {
          logAction(req.session.user?.id,'create_event','event',eventId,`Evento creato: ${title.trim()}`);
          flash(req, 'success', `Evento "${title}" creato.`);
          res.redirect('/agenda/events');
        });
      }
    );
  });
});

router.get('/agenda/events/:id/edit', requireAuth, (req, res) => {
  db.get(`SELECT * FROM events WHERE id = ?`, [req.params.id], (err, event) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    if (!event) return res.redirect('/agenda/events');
    db.all(`SELECT * FROM spaces WHERE active=1 ORDER BY name`, [], (err2, spaces) => {
      db.all(`SELECT * FROM speakers WHERE active=1 ORDER BY name`, [], (err3, speakers) => {
        db.all(`SELECT speaker_id, role FROM event_speakers WHERE event_id = ? ORDER BY order_num`,
          [req.params.id], (err4, selectedSpeakers) => {
          res.render('agenda/event_form', {
            currentUser: req.session.user,
            flash: getFlash(req),
            event,
            spaces: spaces || [],
            speakers: speakers || [],
            selectedSpeakers: selectedSpeakers || [],
            title: 'Modifica Evento'
          });
        });
      });
    });
  });
});

router.post('/agenda/events/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const { title, description, space_id, date, start_time, end_time,
          max_seats, event_type, is_public, published, registrations_open, featured, image_url, tags, notes,
          location_type, location_text, free_entry, ticketed_area,
          speaker_ids, speaker_roles } = req.body;
  const locationTextVal = ['espositore','associazione'].includes(location_type) ? (location_text || '').trim() || null : null;

  if (!title || !space_id || !date || !start_time || !end_time) {
    flash(req, 'error', 'Titolo, sala, data e orari sono obbligatori.');
    return res.redirect(`/agenda/events/${id}/edit`);
  }
  if (end_time <= start_time) {
    flash(req, 'error', "L'orario di fine deve essere successivo a quello di inizio.");
    return res.redirect(`/agenda/events/${id}/edit`);
  }

  const forceConflict = req.body.force === '1';

  checkConflict(space_id, date, start_time, end_time, id, (err, conflicts) => {
    if (!forceConflict && conflicts && conflicts.length > 0) {
      const c = conflicts[0];
      flash(req, 'error', `Conflitto con "${c.title}" (${c.start_time}–${c.end_time}) nella stessa sala.`);
      return res.redirect(`/agenda/events/${id}/edit`);
    }

    db.run(
      `UPDATE events SET title=?, description=?, space_id=?, date=?, start_time=?, end_time=?,
        max_seats=?, event_type=?, is_public=?, published=?, registrations_open=?, featured=?, image_url=?, tags=?, notes=?, location_text=?,
        free_entry=?, ticketed_area=?,
        updated_at=datetime('now')
       WHERE id=?`,
      [title.trim(), description || '', parseInt(space_id), date, start_time, end_time,
       parseInt(max_seats) || 0, event_type || 'panel',
       is_public ? 1 : 0, published ? 1 : 0, registrations_open ? 1 : 0, featured ? 1 : 0,
       image_url || '', tags || '', notes || '', locationTextVal,
       free_entry ? 1 : 0, ticketed_area ? 1 : 0,
       req.params.id],
      function(err2) {
        if (err2) {
          flash(req, 'error', 'Errore aggiornamento evento.');
          return res.redirect(`/agenda/events/${id}/edit`);
        }
        db.run(`DELETE FROM event_speakers WHERE event_id = ?`, [id], () => {
          const ids   = Array.isArray(speaker_ids)   ? speaker_ids   : (speaker_ids   ? [speaker_ids]   : []);
          const roles = Array.isArray(speaker_roles)  ? speaker_roles : (speaker_roles ? [speaker_roles] : []);
          const stmts = ids.map((sid, i) =>
            new Promise(resolve =>
              db.run(`INSERT OR IGNORE INTO event_speakers (event_id, speaker_id, role, order_num) VALUES (?,?,?,?)`,
                [id, sid, roles[i] || 'speaker', i], resolve)
            )
          );
          Promise.all(stmts).then(() => {
            logAction(req.session.user?.id,'edit_event','event',id,`Evento aggiornato: ${title.trim()}`);
            flash(req, 'success', `Evento "${title}" aggiornato.`);
            res.redirect('/agenda/events');
          });
        });
      }
    );
  });
});

router.post('/agenda/events/:id/delete', requireAuth, (req, res) => {
  db.get(`SELECT title FROM events WHERE id=?`, [req.params.id], (err, ev) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    db.run(`DELETE FROM events WHERE id=?`, [req.params.id], (err2) => {
      if(!err2) logAction(req.session.user?.id,'delete_event','event',req.params.id,`Evento eliminato: ${ev?ev.title:''}`);
      flash(req, err2 ? 'error' : 'success',
        err2 ? 'Errore eliminazione.' : `Evento "${ev ? ev.title : ''}" eliminato.`);
      res.redirect('/agenda/events');
    });
  });
});

router.post('/agenda/events/:id/publish', requireAuth, (req, res) => {
  db.get(`SELECT published FROM events WHERE id=?`, [req.params.id], (err, ev) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }
    const newStatus = ev && ev.published === 1 ? 0 : 1;
    db.run(`UPDATE events SET published=?, updated_at=datetime('now') WHERE id=?`,
      [newStatus, req.params.id], (err2) => {
      flash(req, err2 ? 'error' : 'success',
        err2 ? 'Errore.' : (newStatus ? 'Evento pubblicato nel programma.' : 'Evento rimesso in bozza.'));
      if(!err2) logAction(req.session.user?.id,'publish_event','event',req.params.id,(newStatus?'Pubblicato':'Messo in bozza')+' evento #'+req.params.id);
      res.redirect(req.get('Referer') || '/agenda/events');
    });
  });
});

// ══════════════════════════════════════════════
// ISCRIZIONI — vista admin per singolo evento
// ══════════════════════════════════════════════

router.get('/agenda/events/:id/registrations', requireAuth, (req, res) => {
  db.get(`SELECT e.*, s.name AS space_name
    FROM events e JOIN spaces s ON s.id = e.space_id
    WHERE e.id=?`, [req.params.id], (err, event) => {
    if (!event) return res.redirect('/agenda/events');
    db.all(`SELECT r.*,
      CASE WHEN r.pass_id IS NOT NULL THEN 'Sì' ELSE 'No' END AS has_pass
      FROM registrations r
      WHERE r.event_id = ?
      ORDER BY r.registered_at`, [req.params.id], (err2, regs) => {
      db.get(`SELECT COUNT(*) AS confirmed FROM registrations
        WHERE event_id=? AND status='confirmed'`, [req.params.id], (err3, cnt) => {
        res.render('agenda/registrations', {
          currentUser: req.session.user,
          flash: getFlash(req),
          event,
          registrations: regs || [],
          confirmedCount: cnt ? cnt.confirmed : 0,
          title: `Iscrizioni — ${event.title}`
        });
      });
    });
  });
});

router.post('/agenda/events/:id/registrations/:rid/cancel', requireAuth, (req, res) => {
  db.run(
    `UPDATE registrations SET status='cancelled', cancelled_at=datetime('now') WHERE id=?`,
    [req.params.rid], (err) => {
    if(!err) logAction(req.session.user?.id,'cancel_registration','registration',req.params.rid,`Iscrizione #${req.params.rid} annullata per evento #${req.params.id}`);
    flash(req, err ? 'error' : 'success', err ? 'Errore.' : 'Iscrizione annullata.');
    res.redirect(`/agenda/events/${req.params.id}/registrations`);
  });
});

// ══════════════════════════════════════════════
// RIEPILOGO GLOBALE ISCRIZIONI
// ══════════════════════════════════════════════

router.get('/agenda/registrations', requireAuth, (req, res) => {
  db.all(`SELECT r.*, e.title AS event_title, e.date, e.start_time, s.name AS space_name
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN spaces s ON s.id = e.space_id
    ORDER BY r.registered_at DESC
    LIMIT 200`, [], (err, regs) => {
    res.render('agenda/all_registrations', {
      currentUser: req.session.user,
      flash: getFlash(req),
      registrations: regs || [],
      title: 'Tutte le Iscrizioni'
    });
  });
});

// ══════════════════════════════════════════════
// PROGRAMMA PUBBLICO — senza autenticazione
// ══════════════════════════════════════════════

router.get('/programma', (req, res) => {
  const { date, space } = req.query;
  const selectedDate  = date  || null;
  const selectedSpace = space || null;

  let sql = `SELECT * FROM v_public_program WHERE 1=1`;
  const params = [];
  if (selectedDate)  { sql += ` AND date = ?`;       params.push(selectedDate); }
  if (selectedSpace) { sql += ` AND space_name = ?`; params.push(selectedSpace); }
  sql += ` ORDER BY date, start_time`;

  db.all(sql, params, (err, events) => {
    if (err) { console.error('[Agenda]', err.message); return res.status(500).send('Errore interno'); }

    db.all(`SELECT DISTINCT date FROM events WHERE published=1 AND is_public=1 ORDER BY date`,
      [], (err2, dates) => {
      db.all(`SELECT DISTINCT s.name FROM spaces s
        JOIN events e ON e.space_id=s.id
        WHERE e.published=1 AND e.is_public=1
        ORDER BY s.name`, [], (err3, spaces) => {

        // Ospiti in evidenza: guest_profiles.featured=1 + active=1 join assignment_groups
        db.all(
          `SELECT gp.*, ag.name AS group_name
           FROM guest_profiles gp
           JOIN assignment_groups ag ON ag.id = gp.assignment_group_id
           WHERE gp.featured = 1 AND gp.active = 1
           ORDER BY gp.sort_order ASC, ag.name ASC`,
          [], (err4, featuredGuests) => {

          // Tutti i relatori attivi (per modale click sul nome)
          db.all(`SELECT id, name, bio, photo_url, social_url FROM speakers WHERE active=1 ORDER BY name`,
            [], (err5, allSpeakers) => {

            const grouped = {};
            (events || []).forEach(ev => {
              if (!grouped[ev.date]) grouped[ev.date] = {};
              if (!grouped[ev.date][ev.space_name]) grouped[ev.date][ev.space_name] = [];
              grouped[ev.date][ev.space_name].push(ev);
            });

            res.render('agenda/public_program', {
              currentUser: null,
              grouped,
              events: events || [],
              dates: dates || [],
              spaces: spaces || [],
              filters: { date: selectedDate, space: selectedSpace },
              selectedDate,
              selectedSpace,
              featuredGuests: featuredGuests || [],
              allSpeakers: allSpeakers || [],
              title: 'Programma Ludicomix'
            });
          });
        });
      });
    });
  });
});



// ── MAPPA PUBBLICA (dati da DB) ────────────────────────────────────────────
router.get('/mappa-pubblica', (req, res) => {
  db.all(
    `SELECT * FROM zones WHERE map_active = 1 AND map_lat IS NOT NULL AND map_lng IS NOT NULL
     ORDER BY sort_order ASC, name ASC`,
    [], (err, zones) => {
      if (err) { console.error('[Mappa]', err.message); return res.status(500).send('Errore interno'); }
      res.render('agenda/public_map', {
        zones: zones || [],
        zonesJson: JSON.stringify(zones || []),
        title: 'Mappa Ludicomix'
      });
    }
  );
});

// ── ADMIN MAPPA PUBBLICA ────────────────────────────────────────────────────
router.get('/admin/mappa-pubblica', requireAuth, requireAdmin, (req, res) => {
  db.all(`SELECT * FROM zones ORDER BY sort_order ASC, name ASC`, [], (err, zones) => {
    if (err) return res.status(500).send('Errore DB');
    res.render('agenda/admin_map', {
      zones: zones || [],
      currentUser: req.session.user,
      flash: req.query.flash || null,
      title: 'Gestione Mappa Pubblica'
    });
  });
});

// ✅ ORDINE CRITICO: /new deve stare PRIMA di /:id altrimenti Express cattura 'new' come id
router.post('/admin/mappa-pubblica/zone/new', requireAuth, requireAdmin, (req, res) => {
  const { name, sort_order, map_lat, map_lng, map_zoom, map_label, map_type, map_desc, map_address, map_tags, map_color } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/mappa-pubblica?flash=error');
  const sortVal = parseInt(sort_order) || 0;
  // Controlla duplicato sort_order solo se > 0 (0 = "non assegnato", non univoco)
  const doCheckNew = (cb) => {
    if (sortVal <= 0) return cb(null, null);
    db.get('SELECT id FROM zones WHERE sort_order = ?', [sortVal], cb);
  };
  doCheckNew((errChk, existing) => {
    if (errChk) return res.redirect('/admin/mappa-pubblica?flash=error');
    if (existing) return res.redirect('/admin/mappa-pubblica?flash=order_conflict&order=' + sortVal);
    db.run(
      `INSERT INTO zones (name, sort_order, map_lat, map_lng, map_zoom, map_label, map_type, map_desc, map_address, map_tags, map_active, map_color)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      [
        name.trim(),
        sortVal,
        map_lat   ? parseFloat(map_lat)  : null,
        map_lng   ? parseFloat(map_lng)  : null,
        map_zoom  ? parseInt(map_zoom)   : 16,
        (map_label || name.trim()).substring(0, 4),
        map_type   || 'area',
        map_desc   || null,
        map_address|| null,
        map_tags   || null,
        map_color  || null
      ],
      function(err) {
        if (err) { console.error('[Mappa/new]', err.message); return res.redirect('/admin/mappa-pubblica?flash=error'); }
        res.redirect('/admin/mappa-pubblica?flash=created');
      }
    );
  });
});

// ✅ NUOVO: rimozione coordinate senza cancellare la zona
router.post('/admin/mappa-pubblica/zone/:id/remove-coords', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.redirect('/admin/mappa-pubblica?flash=error');
  db.run(
    `UPDATE zones SET map_lat=NULL, map_lng=NULL, map_label=NULL, map_type='area',
     map_desc=NULL, map_address=NULL, map_tags=NULL, map_active=0, map_color=NULL WHERE id=?`,
    [id], function(err) {
      if (err) console.error('[Mappa/remove-coords]', err.message);
      res.redirect('/admin/mappa-pubblica?flash=removed');
    }
  );
});

// ✅ FIX: eliminazione definitiva della zona dal database
router.post('/admin/mappa-pubblica/zone/:id/delete', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.redirect('/admin/mappa-pubblica?flash=error');
  db.run(`DELETE FROM zones WHERE id=?`, [id], function(err) {
    if (err) { console.error('[Mappa/delete]', err.message); return res.redirect('/admin/mappa-pubblica?flash=error'); }
    res.redirect('/admin/mappa-pubblica?flash=deleted');
  });
});

router.post('/admin/mappa-pubblica/zone/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.redirect('/admin/mappa-pubblica?flash=error');
  const { name, sort_order, map_lat, map_lng, map_zoom, map_label, map_type, map_desc, map_address, map_tags, map_active, map_color } = req.body;
  const sortVal = parseInt(sort_order) || 0;
  // Controlla duplicato sort_order solo se > 0 (0 = "non assegnato", non univoco)
  const doCheckUpdate = (cb) => {
    if (sortVal <= 0) return cb(null, null);
    db.get('SELECT id FROM zones WHERE sort_order = ? AND id != ?', [sortVal, id], cb);
  };
  doCheckUpdate((errChk, existing) => {
    if (errChk) return res.redirect('/admin/mappa-pubblica?flash=error');
    if (existing) return res.redirect('/admin/mappa-pubblica?flash=order_conflict&order=' + sortVal + '&id=' + id);
    db.run(
      `UPDATE zones SET
         name=?, sort_order=?,
         map_lat=?, map_lng=?, map_zoom=?, map_label=?, map_type=?,
         map_desc=?, map_address=?, map_tags=?, map_active=?, map_color=?
       WHERE id=?`,
      [
        (name || '').trim() || null,
        sortVal,
        map_lat  ? parseFloat(map_lat)  : null,
        map_lng  ? parseFloat(map_lng)  : null,
        map_zoom ? parseInt(map_zoom)   : 16,
        (map_label || null),
        map_type   || 'area',
        map_desc   || null,
        map_address|| null,
        map_tags   || null,
        map_active === '1' ? 1 : 0,
        map_color  || null,
        id
      ],
      function(err) {
        if (err) { console.error('[Mappa/update]', err.message); return res.redirect('/admin/mappa-pubblica?flash=error'); }
        res.redirect('/admin/mappa-pubblica?flash=saved');
      }
    );
  });
});

// ── PAGINA PUBBLICA OSPITI ──────────────────────────────────────────────────
router.get('/ospiti', (req, res) => {
  const { category } = req.query;
  const selectedCat = category || null;

  db.all(
    `SELECT gp.*, ag.name AS group_name
     FROM guest_profiles gp
     JOIN assignment_groups ag ON ag.id = gp.assignment_group_id
     WHERE gp.active = 1
     ORDER BY gp.sort_order ASC, ag.name ASC`,
    [], (err, guests) => {
      if (err) { console.error('[Ospiti]', err.message); return res.status(500).send('Errore interno'); }

      // Categorie uniche per filtro — split per virgola
      const categories = [...new Set(
        (guests || [])
          .flatMap(g => (g.category || '').split(',').map(c => c.trim()).filter(Boolean))
      )].sort();

      // Filtra per categoria se richiesto (un ospite può averne più di una)
      const filtered = selectedCat
        ? (guests || []).filter(g =>
            (g.category || '').split(',').map(c => c.trim()).includes(selectedCat)
          )
        : (guests || []);

      res.render('agenda/public_guests', {
        guests:     filtered,
        categories,
        filters:    { category: selectedCat },
        title:      'Ludicomix'
      });
    }
  );
});

// ── QR CODE che punta al programma pubblico ──────────────────
router.get('/programma/qr', (req, res) => {
  const baseUrl   = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const targetUrl = `${baseUrl}/programma`;

  bwipjs.toBuffer({
    bcid: 'qrcode',
    text: targetUrl,
    scale: 4,
    eclevel: 'M',
    backgroundcolor: 'ffffff',
    barcolor: '01696f'
  }, (err, png) => {
    if (err) return res.status(500).send('Errore QR');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="programma-qr.png"');
    res.send(png);
  });
});

// ── Iscrizione pubblica a un evento ──────────────────────────
router.get('/programma/iscriviti/:id', (req, res) => {
  db.get(`SELECT e.*, s.name AS space_name,
    COUNT(r.id) AS seats_taken
    FROM events e
    JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    WHERE e.id=? AND e.published=1 AND e.is_public=1 AND e.registrations_open=1
    GROUP BY e.id`, [req.params.id], (err, event) => {
    if (!event) return res.redirect('/programma');
    const full    = event.max_seats > 0 && event.seats_taken >= event.max_seats;
    const success = req.query.success === '1';
    res.render('agenda/register_form', {
      currentUser: null,
      event,
      full,
      success,
      flash: getFlash(req),
      title: `Iscrizione — ${event.title}`
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
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    WHERE e.id=? GROUP BY e.id`, [eventId], (err, ev) => {
    if (!ev) return res.redirect('/programma');

    if (!ev.registrations_open) {
      flash(req, 'error', 'Le iscrizioni per questo evento non sono attualmente aperte.');
      return res.redirect(`/programma/iscriviti/${eventId}`);
    }
    if (ev.max_seats > 0 && ev.seats_taken >= ev.max_seats) {
      flash(req, 'error', 'Spiacente, i posti disponibili sono esauriti.');
      return res.redirect(`/programma/iscriviti/${eventId}`);
    }

    db.run(
      `INSERT INTO registrations (event_id, first_name, last_name, email, phone) VALUES (?,?,?,?,?)`,
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
      }
    );
  });
});

// ── API: Ricerca partecipanti per collegamento speaker ───────
// ── API: check conflitto orario (usata dal frontend prima del submit) ──────
router.get('/api/agenda/check-conflict', requireAuth, (req, res) => {
  const { space_id, date, start_time, end_time, exclude_id } = req.query;
  if (!space_id || !date || !start_time || !end_time) {
    return res.json({ conflict: false, conflicts: [] });
  }
  checkConflict(space_id, date, start_time, end_time, exclude_id || null, (err, conflicts) => {
    if (err) return res.json({ conflict: false, conflicts: [] });
    res.json({ conflict: conflicts && conflicts.length > 0, conflicts: conflicts || [] });
  });
});

router.get('/api/agenda/search-participants', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = '%' + q + '%';
  db.all(`
    SELECT p.id, p.first_name, p.last_name, p.email, p.phone,
           ag.name AS group_name
    FROM participants p
    LEFT JOIN assignment_groups ag ON ag.id = p.assignment_group_id
    WHERE p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ?
       OR (p.first_name || ' ' || p.last_name) LIKE ?
    ORDER BY p.last_name, p.first_name
    LIMIT 20
  `, [like, like, like, like], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows || []);
  });
});

return router;
};
