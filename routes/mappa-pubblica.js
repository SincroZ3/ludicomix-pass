/**
 * routes/mappa-pubblica.js
 * ────────────────────────────────────────────────────────────────────────
 * Mappa pubblica su tabella propria (public_zones), separata dalle zone interne (zones).
 *
 * - Prima della migrazione (flag app_settings.public_zones_migrated) tutte le rotte passano al codice
 *   vecchio (agenda_routes.js): il comportamento non cambia.
 * - La migrazione si controlla e si applica da /admin/mappa-pubblica/migrazione (solo admin) ed e' annullabile.
 * - Dopo la migrazione le rotte della mappa pubblica leggono e scrivono solo public_zones.
 *   Una zona pubblica puo' essere collegata a una zona interna (internal_zone_id): serve per la "Mappa Stand pubblica".
 *
 * Route:
 *   GET  /mappa-pubblica
 *   GET  /admin/mappa-pubblica
 *   POST /admin/mappa-pubblica/zone/new
 *   POST /admin/mappa-pubblica/zone/:id
 *   POST /admin/mappa-pubblica/zone/:id/delete
 *   POST /admin/mappa-pubblica/zone/:id/remove-coords
 *   POST /admin/mappa-pubblica/zone/:id/stand-map-toggle
 *   GET  /admin/mappa-pubblica/migrazione, POST .../applica, POST .../annulla
 *   GET  /admin/mappa-pubblica/collegamenti, POST /admin/mappa-pubblica/collegamenti
 */
module.exports = function registerMappaPubblica(app, db, mw) {
  const { requireAuth, requireAdmin, requireOrganizer, logAction, getCurrent } = mw;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const all = (sql, p) => new Promise((ok, ko) => db.all(sql, p || [], (e, r) => (e ? ko(e) : ok(r || []))));
  const run = (sql, p) => new Promise((ok, ko) => db.run(sql, p || [], function (e) { return e ? ko(e) : ok(this); }));
  const log = (req, action, id, details) => { try { logAction(req.session.user.id, action, 'public_zone', id, details); } catch (_) {} };

  let migrated = false;
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS public_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      map_label TEXT, map_type TEXT DEFAULT 'area',
      map_lat REAL, map_lng REAL, map_zoom INTEGER DEFAULT 16,
      map_desc TEXT, map_address TEXT, map_tags TEXT, map_color TEXT,
      map_active INTEGER DEFAULT 1,
      edition_id INTEGER,
      internal_zone_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')))`, (e) => { if (e) console.error('[mappa-pubblica] tabella', e.message); });
    db.run('CREATE TABLE IF NOT EXISTS zones_scope_backup (id INTEGER PRIMARY KEY, zone_scope TEXT)');
    db.get("SELECT value FROM app_settings WHERE key='public_zones_migrated'", [], (e, r) => { migrated = !!(r && r.value === '1'); });
  });

  const guard = (fn) => (req, res, next) => (migrated ? fn(req, res, next) : next());
  const edClause = (alias) => {
    const c = getCurrent && getCurrent();
    return c ? { sql: ' AND (' + alias + '.edition_id = ? OR ' + alias + '.edition_id IS NULL)', p: [c.id] } : { sql: '', p: [] };
  };
  const LINKED_SQL = `SELECT pz.*, iz.id AS stand_zone_id, COALESCE(iz.stand_map_public,0) AS stand_map_public
                      FROM public_zones pz LEFT JOIN zones iz ON iz.id = pz.internal_zone_id`;
  const first = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
  const num = (v, f) => { const n = parseFloat(first(v)); return isFinite(n) ? n : f; };
  const page = (title, body) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
    <style>body{font:14px system-ui,sans-serif;margin:0;background:#f4f6f9;color:#1a2744}main{max-width:1100px;margin:0 auto;padding:1.2rem}h1{font-size:1.2rem}
    table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:.4rem .6rem;border-bottom:1px solid #e2e8f0;text-align:left;font-size:.82rem}th{background:#eef2ff}
    .b{display:inline-block;padding:.1rem .45rem;border-radius:999px;font-size:.7rem;font-weight:700}.pub{background:#cce5ff}.lnk{background:#d4edda}.int{background:#eee}.warn{background:#fff3cd}
    button,.btn{background:#1e2d4e;color:#fff;border:0;border-radius:6px;padding:.5rem 1rem;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block}
    .sec{background:#6b7280}.note{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:.8rem 1rem;margin:.8rem 0}</style></head><body><main>${body}</main></body></html>`;

  // ── Pagina pubblica ───────────────────────────────────────────────────────────
  app.get('/mappa-pubblica', guard((req, res) => {
    const ed = edClause('pz');
    db.all(`${LINKED_SQL} WHERE pz.map_active = 1 AND pz.map_lat IS NOT NULL AND pz.map_lng IS NOT NULL${ed.sql}
            ORDER BY pz.sort_order ASC, pz.name ASC`, ed.p, (err, rows) => {
      if (err) { console.error('[Mappa]', err.message); return res.status(500).send('Errore interno'); }
      // La vista usa z.id anche per il link /mappa-stand/<id>: per le zone collegate vale l'id della zona interna,
      // per le altre un id fuori scala (100000 + id) che non puo' collidere.
      const zones = (rows || []).map((z) => Object.assign({}, z, { id: (z.stand_map_public && z.stand_zone_id) ? z.stand_zone_id : 100000 + z.id }));
      res.render('agenda/public_map', { zones, zonesJson: JSON.stringify(zones), title: 'Mappa Ludicomix' });
    });
  }));

  // ── Admin mappa pubblica ───────────────────────────────────────────────────────
  app.get('/admin/mappa-pubblica', requireAuth, requireOrganizer, guard((req, res) => {
    const ed = edClause('pz');
    db.all(`${LINKED_SQL} WHERE 1=1${ed.sql} ORDER BY pz.sort_order ASC, pz.name ASC`, ed.p, (err, rows) => {
      if (err) return res.status(500).send('Errore DB');
      const zones = rows || [];
      res.render('agenda/admin_map', { zones, currentUser: req.session.user, flash: req.query.flash || null, title: 'Gestione Mappa Pubblica' }, (rErr, html) => {
        if (rErr) { console.error('[Mappa admin]', rErr.message); return res.status(500).send('Errore interno'); }
        const m = {}; zones.forEach((z) => { if (z.stand_zone_id) m[z.id] = z.stand_zone_id; });
        res.send(html.replace(/\/mappa-stand\/(\d+)/g, (s, id) => '/mappa-stand/' + (m[id] || id)));
      });
    });
  }));

  app.post('/admin/mappa-pubblica/zone/new', requireAuth, requireOrganizer, guard((req, res) => {
    const b = req.body || {};
    if (!b.name || !b.name.trim()) return res.redirect('/admin/mappa-pubblica?flash=error');
    const sortVal = parseInt(b.sort_order || 0, 10) || 0;
    const check = (cb) => (sortVal === 0 ? cb(null, null) : db.get('SELECT id FROM public_zones WHERE sort_order=?', [sortVal], cb));
    check((e, existing) => {
      if (e) return res.redirect('/admin/mappa-pubblica?flash=error');
      if (existing) return res.redirect('/admin/mappa-pubblica?flash=order_conflict&order=' + sortVal);
      const cur = getCurrent && getCurrent();
      db.run(`INSERT INTO public_zones (name, sort_order, map_lat, map_lng, map_zoom, map_label, map_type, map_desc, map_address, map_tags, map_active, map_color, edition_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        [b.name.trim(), sortVal, b.map_lat ? parseFloat(b.map_lat) : null, b.map_lng ? parseFloat(b.map_lng) : null,
          b.map_zoom ? parseInt(b.map_zoom, 10) : 16, b.map_label || b.name.trim().substring(0, 4), b.map_type || 'area',
          b.map_desc || null, b.map_address || null, b.map_tags || null, b.map_color || null, cur ? cur.id : null],
        function (err) {
          if (err) { console.error('[Mappa new]', err.message); return res.redirect('/admin/mappa-pubblica?flash=error'); }
          log(req, 'create_public_zone', this.lastID, 'Creata zona pubblica: ' + b.name.trim());
          res.redirect('/admin/mappa-pubblica?flash=created');
        });
    });
  }));

  app.post('/admin/mappa-pubblica/zone/:id/remove-coords', requireAuth, requireOrganizer, guard((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.redirect('/admin/mappa-pubblica?flash=error');
    db.run(`UPDATE public_zones SET map_lat=NULL, map_lng=NULL, map_label=NULL, map_type='area', map_desc=NULL, map_address=NULL, map_tags=NULL, map_active=0, map_color=NULL WHERE id=?`, [id], (err) => {
      if (err) console.error('[Mappa remove-coords]', err.message);
      res.redirect('/admin/mappa-pubblica?flash=removed');
    });
  }));

  app.post('/admin/mappa-pubblica/zone/:id/delete', requireAuth, requireOrganizer, guard((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.redirect('/admin/mappa-pubblica?flash=error');
    db.run('DELETE FROM public_zones WHERE id=?', [id], (err) => {
      if (err) { console.error('[Mappa delete]', err.message); return res.redirect('/admin/mappa-pubblica?flash=error'); }
      log(req, 'delete_public_zone', id, 'Zona mappa pubblica eliminata (la zona interna collegata resta)');
      res.redirect('/admin/mappa-pubblica?flash=deleted');
    });
  }));

  app.post('/admin/mappa-pubblica/zone/:id/stand-map-toggle', requireAuth, requireOrganizer, guard((req, res) => {
    const id = parseInt(req.params.id, 10);
    const val = first(req.body && req.body.stand_map_public) === '1' ? 1 : 0;
    db.get('SELECT internal_zone_id FROM public_zones WHERE id=?', [id], (e, z) => {
      if (e || !z) return res.status(404).json({ ok: false, error: 'Zona non trovata' });
      if (!z.internal_zone_id) return res.status(400).json({ ok: false, error: 'Zona non collegata a una zona interna: usa la pagina Collegamenti.' });
      db.run('UPDATE zones SET stand_map_public=? WHERE id=?', [val, z.internal_zone_id], (err) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        log(req, 'toggle_stand_map_public', id, 'Mappa stand pubblica zona interna ' + z.internal_zone_id + ' ' + (val ? 'ON' : 'OFF'));
        res.json({ ok: true, stand_map_public: val });
      });
    });
  }));

  app.post('/admin/mappa-pubblica/zone/:id', requireAuth, requireOrganizer, guard((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.redirect('/admin/mappa-pubblica?flash=error');
    const b = req.body || {};
    if (!b.name || !String(first(b.name)).trim()) return res.redirect('/admin/mappa-pubblica?flash=error');
    const sortVal = parseInt(first(b.sort_order) || 0, 10) || 0;
    const check = (cb) => (sortVal === 0 ? cb(null, null) : db.get('SELECT id FROM public_zones WHERE sort_order=? AND id!=?', [sortVal, id], cb));
    check((e, existing) => {
      if (e) return res.redirect('/admin/mappa-pubblica?flash=error');
      if (existing) return res.redirect('/admin/mappa-pubblica?flash=order_conflict&order=' + sortVal + '&id=' + id);
      const active = [].concat(b.map_active == null ? [] : b.map_active).some((v) => String(v) === '1') ? 1 : 0;
      db.run(`UPDATE public_zones SET name=?, sort_order=?, map_lat=?, map_lng=?, map_zoom=?, map_label=?, map_type=?, map_desc=?, map_address=?, map_tags=?, map_active=?, map_color=? WHERE id=?`,
        [String(first(b.name)).trim(), sortVal, b.map_lat ? parseFloat(b.map_lat) : null, b.map_lng ? parseFloat(b.map_lng) : null,
          b.map_zoom ? parseInt(b.map_zoom, 10) : 16, b.map_label || null, b.map_type || 'area', b.map_desc || null, b.map_address || null,
          b.map_tags || null, active, b.map_color || null, id],
        (err) => {
          if (err) { console.error('[Mappa update]', err.message); return res.redirect('/admin/mappa-pubblica?flash=error'); }
          log(req, 'edit_public_zone', id, 'Zona mappa pubblica aggiornata');
          res.redirect('/admin/mappa-pubblica?flash=saved');
        });
    });
  }));

  // ── Migrazione: anteprima, applica, annulla ────────────────────────────────────────
  const PREVIEW_SQL = `SELECT z.id, z.name, z.zone_scope, z.map_lat, z.map_lng, z.map_type, z.map_active, z.background_image,
      COALESCE(z.stand_map_public,0) AS stand_map_public,
      (SELECT COUNT(*) FROM assignment_groups ag WHERE ag.zone = z.name) AS stands,
      (SELECT 1 FROM public_zones pz WHERE pz.id = z.id) AS already
    FROM zones z ORDER BY z.sort_order, z.name`;
  const classify = (z) => {
    const coords = z.map_lat != null && z.map_lng != null;
    const internal = z.stands > 0 || !!z.background_image || !!z.stand_map_public;
    if (coords) return internal ? 'both' : 'public';
    return internal ? 'internal' : 'internal_dubious';
  };

  app.get('/admin/mappa-pubblica/migrazione', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await all(PREVIEW_SQL);
      const lab = { both: '<span class="b lnk">pubblica + interna (collegate)</span>', public: '<span class="b pub">solo pubblica</span>', internal: '<span class="b int">solo interna</span>', internal_dubious: '<span class="b warn">interna? (senza coordinate, stand o sfondo)</span>' };
      const trs = rows.map((z) => `<tr><td>${z.id}</td><td>${esc(z.name)}</td><td>${esc(z.zone_scope || '')}</td><td>${z.map_lat != null ? 'si' : '-'}</td><td>${z.stands}</td><td>${z.background_image ? 'si' : '-'}</td><td>${z.stand_map_public ? 'si' : '-'}</td><td>${z.already ? '<span class="b int">gia\u0027 migrata</span>' : lab[classify(z)]}</td></tr>`).join('');
      const body = `<h1>Separazione mappa pubblica / mappa interna</h1>
        <p>Stato: <b>${migrated ? 'MIGRAZIONE APPLICATA' : 'non ancora applicata (il sito usa il comportamento precedente)'}</b>${req.query.ok ? ' &mdash; operazione eseguita.' : ''}</p>
        <div class="note"><b>Cosa succede applicando.</b> Le zone con coordinate vengono copiate nella nuova tabella <code>public_zones</code> (stesso id).
        Se hanno anche stand, sfondo o mappa stand pubblica restano zone interne e vengono collegate; altrimenti passano a "solo pubblica" e spariscono dalla mappa interna.
        Nulla viene cancellato: si puo' annullare e tornare al comportamento precedente. Fai comunque una copia di data.sqlite prima di applicare.</div>
        <table><tr><th>ID</th><th>Nome</th><th>Scope attuale</th><th>Coordinate</th><th>Stand</th><th>Sfondo</th><th>Mappa stand pubblica</th><th>Dopo la migrazione</th></tr>${trs}</table>
        <p>${migrated
          ? '<form method="post" action="/admin/mappa-pubblica/migrazione/annulla" onsubmit="return confirm(\'Tornare al comportamento precedente?\')"><button class="sec">Annulla migrazione</button></form> <a class="btn" href="/admin/mappa-pubblica/collegamenti">Collegamenti zone pubbliche / interne</a>'
          : '<form method="post" action="/admin/mappa-pubblica/migrazione/applica" onsubmit="return confirm(\'Applicare la separazione? Hai fatto la copia di data.sqlite?\')"><button>Applica separazione</button></form>'}</p>
        <p><a href="/admin/mappa-pubblica">Gestione mappa pubblica</a> &middot; <a href="/mappa">Mappa stand</a></p>`;
      res.send(page('Migrazione mappa pubblica', body));
    } catch (e) { res.status(500).send('Errore: ' + esc(e.message)); }
  });

  app.post('/admin/mappa-pubblica/migrazione/applica', requireAuth, requireAdmin, async (req, res) => {
    try {
      await run('INSERT OR IGNORE INTO zones_scope_backup (id, zone_scope) SELECT id, zone_scope FROM zones');
      const rows = await all(`SELECT z.*, (SELECT COUNT(*) FROM assignment_groups ag WHERE ag.zone = z.name) AS stands
                              FROM zones z WHERE z.map_lat IS NOT NULL AND z.map_lng IS NOT NULL AND z.id NOT IN (SELECT id FROM public_zones)`);
      let linked = 0, pure = 0;
      for (const z of rows) {
        const isLinked = z.stands > 0 || !!z.background_image || !!z.stand_map_public;
        await run(`INSERT INTO public_zones (id, name, sort_order, map_label, map_type, map_lat, map_lng, map_zoom, map_desc, map_address, map_tags, map_color, map_active, edition_id, internal_zone_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [z.id, z.name, z.sort_order || 0, z.map_label, z.map_type || 'area', z.map_lat, z.map_lng, z.map_zoom || 16, z.map_desc, z.map_address, z.map_tags, z.map_color,
            z.map_active == null ? 1 : z.map_active, z.edition_id == null ? null : z.edition_id, isLinked ? z.id : null]);
        await run('UPDATE zones SET zone_scope=? WHERE id=?', [isLinked ? 'internal' : 'public', z.id]);
        if (isLinked) linked++; else pure++;
      }
      await run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('public_zones_migrated','1')");
      migrated = true;
      log(req, 'public_zones_migrate', null, 'Separazione mappa pubblica: ' + rows.length + ' zone copiate (' + linked + ' collegate, ' + pure + ' solo pubbliche)');
      res.redirect('/admin/mappa-pubblica/migrazione?ok=1');
    } catch (e) { console.error('[mappa-pubblica] migrazione', e.message); res.status(500).send('Errore migrazione: ' + esc(e.message)); }
  });

  app.post('/admin/mappa-pubblica/migrazione/annulla', requireAuth, requireAdmin, async (req, res) => {
    try {
      await run('UPDATE zones SET zone_scope = (SELECT b.zone_scope FROM zones_scope_backup b WHERE b.id = zones.id) WHERE id IN (SELECT id FROM zones_scope_backup)');
      await run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('public_zones_migrated','0')");
      migrated = false;
      log(req, 'public_zones_rollback', null, 'Separazione mappa pubblica annullata: scope zone ripristinati');
      res.redirect('/admin/mappa-pubblica/migrazione?ok=1');
    } catch (e) { res.status(500).send('Errore: ' + esc(e.message)); }
  });

  // ── Collegamenti zona pubblica -> zona interna ───────────────────────────────────────
  app.get('/admin/mappa-pubblica/collegamenti', requireAuth, requireAdmin, async (req, res) => {
    try {
      const pubs = await all('SELECT * FROM public_zones ORDER BY sort_order, name');
      const ints = await all("SELECT id, name FROM zones WHERE (zone_scope IS NULL OR zone_scope='internal') ORDER BY sort_order, name");
      const trs = pubs.map((p) => `<tr><td>${esc(p.name)}</td><td><select name="link_${p.id}"><option value="">(nessuna: solo pubblica)</option>${ints.map((i) => `<option value="${i.id}"${p.internal_zone_id === i.id ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select></td></tr>`).join('');
      res.send(page('Collegamenti zone', `<h1>Zone pubbliche collegate alle zone interne</h1>
        <div class="note">Il collegamento serve per la &quot;Mappa Stand pubblica&quot;: il marker della zona pubblica porta alla mappa stand della zona interna scelta.</div>
        ${migrated ? '' : '<p><b>Migrazione non ancora applicata.</b></p>'}
        <form method="post" action="/admin/mappa-pubblica/collegamenti"><table><tr><th>Zona pubblica</th><th>Zona interna collegata</th></tr>${trs}</table><p><button>Salva</button> <a href="/admin/mappa-pubblica/migrazione">Indietro</a></p></form>`));
    } catch (e) { res.status(500).send('Errore: ' + esc(e.message)); }
  });

  app.post('/admin/mappa-pubblica/collegamenti', requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      for (const k of Object.keys(b)) {
        const m = /^link_(\d+)$/.exec(k); if (!m) continue;
        const v = parseInt(first(b[k]), 10);
        await run('UPDATE public_zones SET internal_zone_id=? WHERE id=?', [isNaN(v) ? null : v, parseInt(m[1], 10)]);
      }
      log(req, 'public_zones_links', null, 'Collegamenti zone pubbliche/interne aggiornati');
      res.redirect('/admin/mappa-pubblica/collegamenti');
    } catch (e) { res.status(500).send('Errore: ' + esc(e.message)); }
  });
};
