/**
 * routes/map3d-sync.js
 * Sincronizzazione mappa 3D -> mappa 2D (fase 1 del passaggio della mappa interna al 3D).
 *
 * Il 3D (map_test_layout) diventa la fonte di verita': ogni volta che si salva, sposta o rimuove uno stand nel 3D,
 * le colonne 2D di assignment_groups (map_x, map_y, map_w, map_h, map_rot, map_shape) vengono aggiornate di conseguenza,
 * cosi' mappa pubblica, portale espositore e mappa interna 2D restano coerenti senza essere modificati.
 * Conversione (inversa di /admin/mappatest/import): 2D in % = 3D in frazione * 100.
 *
 * Nulla cambia finche' non si applica a mano da /admin/map3d/sync (solo admin):
 *   - anteprima delle differenze stand per stand;
 *   - Applica: copia di sicurezza dei valori 2D attuali (map3d_sync_backup), allineamento iniziale e creazione di 3 trigger SQLite
 *     che mantengono la sincronizzazione ad ogni scrittura su map_test_layout (anche da import o da altre rotte);
 *   - Annulla: elimina i trigger e ripristina i valori 2D dalla copia di sicurezza.
 * Gli oggetti liberi (id negativo, kind='obj') non sono stand e non vengono mai sincronizzati.
 *
 * Route: GET /admin/map3d/sync, POST /admin/map3d/sync/applica, POST /admin/map3d/sync/annulla
 */
module.exports = function registerMap3dSync(app, db, mw) {
  const { requireAuth, requireAdmin, logAction } = mw;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const all = (sql, p) => new Promise((ok, ko) => db.all(sql, p || [], (e, r) => (e ? ko(e) : ok(r || []))));
  const get = (sql, p) => new Promise((ok, ko) => db.get(sql, p || [], (e, r) => (e ? ko(e) : ok(r))));
  const run = (sql, p) => new Promise((ok, ko) => db.run(sql, p || [], function (e) { return e ? ko(e) : ok(this); }));
  const log = (req, action, details) => { try { logAction(req.session.user.id, action, 'map3d', null, details); } catch (_) {} };

  const TRIGGERS = ['map3d_sync_ai', 'map3d_sync_au', 'map3d_sync_ad'];
  const STAND = "l.group_id > 0 AND COALESCE(l.kind,'stand') <> 'obj'";

  db.run(`CREATE TABLE IF NOT EXISTS map3d_sync_backup (
    group_id INTEGER PRIMARY KEY, map_x REAL, map_y REAL, map_w REAL, map_h REAL, map_shape TEXT, map_rot REAL,
    saved_at TEXT DEFAULT (datetime('now','localtime')))`, (e) => { if (e) console.error('[map3d-sync] tabella backup', e.message); });

  // SQL dei trigger: stessa conversione di toTwoD()
  const shapeSql = (r) => `(SELECT json_group_array(json(p)) FROM (SELECT json_array(json_extract(value,'$[0]')*100, json_extract(value,'$[1]')*100) AS p FROM json_each(${r}.shape) ORDER BY key))`;
  const setNew = `map_x=NEW.fx*100, map_y=NEW.fy*100, map_w=NEW.wf*100, map_h=NEW.df*100, map_rot=COALESCE(NEW.rot,0),
      map_shape=CASE WHEN NEW.shape IS NULL OR NEW.shape='' THEN NULL ELSE ${shapeSql('NEW')} END`;
  const whenNew = "NEW.group_id > 0 AND COALESCE(NEW.kind,'stand') <> 'obj'";
  const TRIGGER_SQL = [
    `CREATE TRIGGER IF NOT EXISTS map3d_sync_ai AFTER INSERT ON map_test_layout WHEN ${whenNew}
       BEGIN UPDATE assignment_groups SET ${setNew} WHERE id = NEW.group_id; END`,
    `CREATE TRIGGER IF NOT EXISTS map3d_sync_au AFTER UPDATE OF fx, fy, wf, df, rot, shape ON map_test_layout WHEN ${whenNew}
       BEGIN UPDATE assignment_groups SET ${setNew} WHERE id = NEW.group_id; END`,
    `CREATE TRIGGER IF NOT EXISTS map3d_sync_ad AFTER DELETE ON map_test_layout WHEN OLD.group_id > 0 AND COALESCE(OLD.kind,'stand') <> 'obj'
       BEGIN UPDATE assignment_groups SET map_x=NULL, map_y=NULL, map_w=NULL, map_h=NULL, map_shape=NULL WHERE id = OLD.group_id; END`,
  ];

  const toTwoD = (l) => {
    let shape = null;
    if (l.shape) { try { const a = JSON.parse(l.shape); if (Array.isArray(a)) shape = JSON.stringify(a.map((p) => [p[0] * 100, p[1] * 100])); } catch (_) { shape = null; } }
    return { map_x: l.fx * 100, map_y: l.fy * 100, map_w: l.wf * 100, map_h: l.df * 100, map_rot: l.rot || 0, map_shape: shape };
  };
  const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.05);
  const sameShape = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    try { const x = JSON.parse(a), y = JSON.parse(b); return x.length === y.length && x.every((p, i) => near(p[0], y[i][0]) && near(p[1], y[i][1])); } catch (_) { return false; }
  };
  const LAYOUT_SQL = `SELECT l.*, ag.name AS stand_name, ag.map_x AS o_x, ag.map_y AS o_y, ag.map_w AS o_w, ag.map_h AS o_h, ag.map_shape AS o_shape, ag.map_rot AS o_rot
                      FROM map_test_layout l JOIN assignment_groups ag ON ag.id = l.group_id WHERE ${STAND} ORDER BY l.zone, ag.name`;
  const isActive = async () => { const r = await get("SELECT value FROM app_settings WHERE key='map3d_sync'"); return !!(r && r.value === '1'); };
  const hasJson = async () => { try { await get('SELECT json_array(1) AS j'); return true; } catch (_) { return false; } };

  app.get('/admin/map3d/sync', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [rows, active, json, only2d, bk] = await Promise.all([
        all(LAYOUT_SQL), isActive(), hasJson(),
        get('SELECT COUNT(*) AS n FROM assignment_groups WHERE map_x IS NOT NULL AND id NOT IN (SELECT group_id FROM map_test_layout WHERE group_id > 0)'),
        get('SELECT COUNT(*) AS n FROM map3d_sync_backup'),
      ]);
      const diff = rows.map((l) => {
        const t = toTwoD(l);
        const same = near(t.map_x, l.o_x) && near(t.map_y, l.o_y) && near(t.map_w, l.o_w) && near(t.map_h, l.o_h) && near(t.map_rot, l.o_rot || 0) && sameShape(t.map_shape, l.o_shape);
        return { l, t, same, isNew: l.o_x == null };
      });
      const nSame = diff.filter((d) => d.same).length, nNew = diff.filter((d) => !d.same && d.isNew).length, nChg = diff.filter((d) => !d.same && !d.isNew).length;
      const f = (v) => (v == null ? '-' : (+v).toFixed(1));
      const trs = diff.filter((d) => !d.same).slice(0, 500).map((d) => `<tr><td>${d.l.group_id}</td><td>${esc(d.l.stand_name)}</td><td>${esc(d.l.zone)}</td>
        <td>${f(d.l.o_x)} / ${f(d.l.o_y)}</td><td>${f(d.l.o_w)} x ${f(d.l.o_h)}</td><td>${f(d.t.map_x)} / ${f(d.t.map_y)}</td><td>${f(d.t.map_w)} x ${f(d.t.map_h)}</td>
        <td>${d.isNew ? '<span class="b new">nuovo nel 2D</span>' : '<span class="b chg">cambia</span>'}</td></tr>`).join('');
      const formOff = '<form method="post" action="/admin/map3d/sync/annulla" onsubmit="return confirm(&quot;Disattivare la sincronizzazione e ripristinare il 2D dalla copia di sicurezza?&quot;)"><button class="sec">Annulla e ripristina il 2D</button></form>';
      const formOn = '<form method="post" action="/admin/map3d/sync/applica" onsubmit="return confirm(&quot;Applicare la sincronizzazione? Hai fatto la copia di data.sqlite?&quot;)"><button>Applica sincronizzazione</button></form>';
      res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sincronizzazione 3D - 2D</title>
        <style>body{font:14px system-ui,sans-serif;margin:0;background:#f4f6f9;color:#1a2744}main{max-width:1100px;margin:0 auto;padding:1.2rem}h1{font-size:1.2rem}
        table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:.4rem .6rem;border-bottom:1px solid #e2e8f0;text-align:left;font-size:.82rem}th{background:#eef2ff}
        .b{display:inline-block;padding:.1rem .45rem;border-radius:999px;font-size:.7rem;font-weight:700}.new{background:#d4edda}.chg{background:#fff3cd}
        button{background:#1e2d4e;color:#fff;border:0;border-radius:6px;padding:.5rem 1rem;font-weight:700;cursor:pointer}.sec{background:#6b7280}
        .note{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:.8rem 1rem;margin:.8rem 0}</style></head><body><main>
        <h1>Sincronizzazione mappa 3D verso 2D</h1>
        <p>Stato: <b>${active ? 'ATTIVA (ogni salvataggio nel 3D aggiorna il 2D)' : 'non attiva (il 2D non viene toccato)'}</b>${req.query.ok ? ' - operazione eseguita.' : ''}</p>
        ${json ? '' : '<div class="note"><b>Attenzione:</b> questo SQLite non supporta le funzioni JSON, la sincronizzazione automatica non e attivabile.</div>'}
        <div class="note"><b>Cosa succede applicando.</b> Per ogni stand posizionato nel 3D, posizione, dimensioni, rotazione e forma 2D vengono sostituite con quelle del 3D (percentuale = frazione x 100).
        I valori 2D attuali vengono prima copiati in <code>map3d_sync_backup</code> e si ripristinano con Annulla. Gli stand posizionati solo nel 2D (${only2d.n}) non vengono toccati.
        Fai comunque una copia di data.sqlite prima di applicare. Dopo l'attivazione le modifiche fatte in 2D agli stand presenti nel 3D verranno sovrascritte dal 3D.</div>
        <p>Stand nel 3D: <b>${rows.length}</b> | gia uguali: <b>${nSame}</b> | da aggiornare: <b>${nChg}</b> | nuovi nel 2D: <b>${nNew}</b> | copie di sicurezza: <b>${bk.n}</b></p>
        <table><tr><th>ID</th><th>Stand</th><th>Zona</th><th>2D attuale x / y %</th><th>2D attuale l x a %</th><th>Dal 3D x / y %</th><th>Dal 3D l x a %</th><th>Esito</th></tr>${trs || '<tr><td colspan="8">Nessuna differenza.</td></tr>'}</table>
        ${diff.filter((d) => !d.same).length > 500 ? '<p>Mostrate le prime 500 differenze.</p>' : ''}
        <p>${active ? formOff : (json ? formOn : '')}</p>
        <p><a href="/admin/mappatest">Mappa 3D (test)</a> | <a href="/mappa">Mappa interna</a></p></main></body></html>`);
    } catch (e) { console.error('[map3d-sync]', e.message); res.status(500).send('Errore: ' + esc(e.message)); }
  });

  app.post('/admin/map3d/sync/applica', requireAuth, requireAdmin, async (req, res) => {
    try {
      if (!(await hasJson())) return res.status(400).send('SQLite senza funzioni JSON: sincronizzazione non attivabile.');
      if (await isActive()) return res.redirect('/admin/map3d/sync');
      const rows = await all(LAYOUT_SQL);
      await run(`INSERT OR IGNORE INTO map3d_sync_backup (group_id, map_x, map_y, map_w, map_h, map_shape, map_rot)
                 SELECT ag.id, ag.map_x, ag.map_y, ag.map_w, ag.map_h, ag.map_shape, ag.map_rot FROM assignment_groups ag
                 WHERE ag.id IN (SELECT l.group_id FROM map_test_layout l WHERE ${STAND})`);
      for (const l of rows) {
        const t = toTwoD(l);
        await run('UPDATE assignment_groups SET map_x=?, map_y=?, map_w=?, map_h=?, map_rot=?, map_shape=? WHERE id=?',
          [t.map_x, t.map_y, t.map_w, t.map_h, t.map_rot, t.map_shape, l.group_id]);
      }
      for (const s of TRIGGER_SQL) await run(s);
      await run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('map3d_sync','1')");
      log(req, 'map3d_sync_on', 'Sincronizzazione 3D->2D attivata: ' + rows.length + ' stand allineati');
      res.redirect('/admin/map3d/sync?ok=1');
    } catch (e) { console.error('[map3d-sync] applica', e.message); res.status(500).send('Errore: ' + esc(e.message) + ' - se l operazione e a meta, usa Annulla per ripristinare.'); }
  });

  app.post('/admin/map3d/sync/annulla', requireAuth, requireAdmin, async (req, res) => {
    try {
      for (const t of TRIGGERS) await run('DROP TRIGGER IF EXISTS ' + t);
      await run(`UPDATE assignment_groups SET
          map_x = (SELECT b.map_x FROM map3d_sync_backup b WHERE b.group_id = assignment_groups.id),
          map_y = (SELECT b.map_y FROM map3d_sync_backup b WHERE b.group_id = assignment_groups.id),
          map_w = (SELECT b.map_w FROM map3d_sync_backup b WHERE b.group_id = assignment_groups.id),
          map_h = (SELECT b.map_h FROM map3d_sync_backup b WHERE b.group_id = assignment_groups.id),
          map_shape = (SELECT b.map_shape FROM map3d_sync_backup b WHERE b.group_id = assignment_groups.id),
          map_rot = (SELECT b.map_rot FROM map3d_sync_backup b WHERE b.group_id = assignment_groups.id)
        WHERE id IN (SELECT group_id FROM map3d_sync_backup)`);
      await run('DELETE FROM map3d_sync_backup');
      await run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('map3d_sync','0')");
      log(req, 'map3d_sync_off', 'Sincronizzazione 3D->2D annullata: valori 2D ripristinati');
      res.redirect('/admin/map3d/sync?ok=1');
    } catch (e) { res.status(500).send('Errore: ' + esc(e.message)); }
  });
};
