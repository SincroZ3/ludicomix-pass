/**
 * routes/passes.js
 * ──────────────────────────────────────────────────────────────────
 * Generazione pass PDF nominativi (singolo, bulk, replace, batch),
 * pass-types CRUD, stati, storico, portal toggles.
 *
 * Esporta anche: generatePassForParticipant, triggerBatchPassOnClose
 * ──────────────────────────────────────────────────────────────────
 */

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const bwipjs = require('bwip-js');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { promisify } = require('util');

const PASS_STATUSES = ['IN_ATTESA','GENERATO','SCARICATO','STAMPATO','CONSEGNATO','RICONSEGNATO','INVALIDATO'];

// ── Sanitizza testo per pdf-lib (Helvetica → latin-1 only) ───────
function sanitizeForPdf(text) {
  if (!text) return '';
  const manualMap = {
    'Ł':'L','ł':'l','Ø':'O','ø':'o','Đ':'D','đ':'d','Ħ':'H','ħ':'h','Ŋ':'N','ŋ':'n',
    'Œ':'OE','œ':'oe','Æ':'AE','æ':'ae','Þ':'Th','þ':'th','ß':'ss','Ð':'D','ð':'d',
    'Ĳ':'IJ','ĳ':'ij','ẞ':'SS','Ş':'S','ş':'s','Ğ':'G','ğ':'g','İ':'I','ı':'i',
    'Ż':'Z','ż':'z','Ź':'Z','ź':'z','Ń':'N','ń':'n','Ś':'S','ś':'s','Ć':'C','ć':'c',
    'Ą':'A','ą':'a','Ę':'E','ę':'e','Ó':'O','ó':'o','Ú':'U','ú':'u',
  };
  let out = '';
  for (const ch of text) out += manualMap[ch] !== undefined ? manualMap[ch] : ch;
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
}

function generateRandomCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = function registerPassesRoutes(
  app, db,
  { requireAuth, requireAdmin, requireOrganizer, requireNotViewer, logAction, createNotification }
) {
  const DATA_DIR = process.env.DATA_DIR || __dirname.replace('/routes', '');
  const dbGet    = promisify(db.get.bind(db));
  const dbAll    = promisify(db.all.bind(db));
  function dbRun(sql, ...p) {
    return new Promise((resolve, reject) => {
      const params = p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
      db.run(sql, params, function (err) { if (err) return reject(err); resolve({ lastID: this.lastID, changes: this.changes }); });
    });
  }

  const upload       = multer({ dest: path.join(DATA_DIR, 'templates') });
  const uploadMemory = multer({ storage: multer.memoryStorage() });

  // ── Core: genera PDF pass per partecipante ───────────────────────
  async function generatePassForParticipant(participantId, passTypeId, userId) {
    const participant = await dbGet(
      `SELECT p.*, ag.name AS group_name, ag.stand_name AS group_stand_name,
              ag.zone AS group_zone, ag.stand_code AS group_stand_code
       FROM participants p
       LEFT JOIN assignment_groups ag ON ag.id=p.assignment_group_id
       WHERE p.id=?`,
      [participantId]
    );
    if (!participant) throw new Error('Partecipante non trovato');
    const type = await dbGet('SELECT * FROM pass_types WHERE id=?', [passTypeId]);
    if (!type) throw new Error('Tipo pass non trovato');

    const templatePath = path.join(DATA_DIR, 'templates', type.template_file);
    const pdfDoc   = await PDFDocument.load(fs.readFileSync(templatePath));
    const page     = pdfDoc.getPages()[0];
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regFont  = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const { width, height } = page.getSize();
    const qWidth  = width  / 2, qHeight = height / 2;
    const originX = qWidth,      originY = height - qHeight;
    const centerX = originX + qWidth / 2;

    const drawCentered = (text, size, font, y) => {
      const tw = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: centerX - tw / 2, y, size, font, color: rgb(0, 0, 0) });
    };

    let cursorY = originY + qHeight - 70;
    const typeLabel = sanitizeForPdf((type.name || '').toUpperCase());
    drawCentered(typeLabel, 28, boldFont, cursorY); cursorY -= 42;

    if (typeLabel.includes('ESPOSITORE') && participant.group_zone) {
      drawCentered(sanitizeForPdf(participant.group_zone.toUpperCase()), 22, boldFont, cursorY); cursorY -= 40;
    }
    drawCentered(sanitizeForPdf((participant.first_name || '').toUpperCase()), 26, boldFont, cursorY); cursorY -= 34;
    drawCentered(sanitizeForPdf((participant.last_name  || '').toUpperCase()), 26, boldFont, cursorY); cursorY -= 42;

    const standLabel = sanitizeForPdf((participant.group_stand_name || participant.group_name || '').toUpperCase());
    if (standLabel)              { drawCentered(standLabel, 18, boldFont, cursorY); cursorY -= 30; }
    if (participant.group_stand_code) { drawCentered(sanitizeForPdf(participant.group_stand_code.toUpperCase()), 16, boldFont, cursorY); }

    // QR brandizzato
    const qrColorHex = (type.qr_color || '000000').replace('#', '');
    const qrLogoRow  = await dbGet("SELECT value FROM app_settings WHERE key='qr_logo_b64'");
    const qrLogoB64  = qrLogoRow?.value || null;
    const code       = generateRandomCode(18);

    const png    = await bwipjs.toBuffer({ bcid: 'qrcode', text: code, scale: 4, backgroundcolor: 'FFFFFF', barcolor: qrColorHex, eclevel: 'H' });
    const qrImg  = await pdfDoc.embedPng(png);
    const qrSize = 90, qrX = centerX - qrSize / 2, qrY = originY + 65;
    page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    // Logo overlay
    const logoSz = Math.round(qrSize * 0.22), logoX = qrX + (qrSize - logoSz) / 2, logoY = qrY + (qrSize - logoSz) / 2;
    page.drawRectangle({ x: logoX - 2, y: logoY - 2, width: logoSz + 4, height: logoSz + 4, color: rgb(1, 1, 1) });
    if (qrLogoB64) {
      try { const lp = await pdfDoc.embedPng(Buffer.from(qrLogoB64, 'base64')); page.drawImage(lp, { x: logoX, y: logoY, width: logoSz, height: logoSz }); }
      catch (_) {}
    } else {
      const r16 = parseInt(qrColorHex.slice(0,2),16)/255, g16 = parseInt(qrColorHex.slice(2,4),16)/255, b16 = parseInt(qrColorHex.slice(4,6),16)/255;
      const iFsz = logoSz * 0.68, iTxt = 'LC', iW = boldFont.widthOfTextAtSize(iTxt, iFsz);
      page.drawText(iTxt, { x: logoX + (logoSz - iW) / 2, y: logoY + (logoSz - iFsz * 0.85) / 2, size: iFsz, font: boldFont, color: rgb(r16, g16, b16) });
    }
    drawCentered(code, 10, regFont, qrY - 18);

    const pdfBytes = await pdfDoc.save();
    const result   = await dbRun('INSERT INTO passes (participant_id, pass_type_id, code, status, pdf_file) VALUES (?,?,?,?,?)', [participantId, passTypeId, code, 'GENERATO', '']);
    const passId   = result.lastID;
    const filename = `pass_${passId}.pdf`;
    fs.mkdirSync(path.join(DATA_DIR, 'generated'), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'generated', filename), pdfBytes);
    await dbRun('UPDATE passes SET pdf_file=? WHERE id=?', [filename, passId]);
    logAction(userId, 'generate_pass', 'pass', passId, `Generato pass ${passId} per ${participant.first_name} ${participant.last_name}`);
    await dbRun('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [passId, 'GENERATO', userId]);
    return passId;
  }

  // ── Trigger batch alla chiusura finestra portale ──────────────────
  async function triggerBatchPassOnClose(groupId) {
    try {
      const group = await dbGet(
        `SELECT ag.id, ag.name, g.pass_type_id
         FROM assignment_groups ag
         LEFT JOIN groups g ON g.id=ag.group_id
         WHERE ag.id=?`,
        [groupId]
      );
      if (!group?.pass_type_id) { console.warn(`[batchClose] Gruppo ${groupId} senza pass_type — skip`); return 0; }
      const toGenerate = await dbAll(
        `SELECT id FROM participants
         WHERE assignment_group_id=?
           AND id NOT IN (SELECT participant_id FROM passes WHERE status!='INVALIDATO')`,
        [groupId]
      );
      if (!toGenerate.length) return 0;
      let ok = 0, errors = 0;
      for (const p of toGenerate) {
        try { await generatePassForParticipant(p.id, group.pass_type_id, null); ok++; }
        catch (e) { console.error(`[batchClose] Errore pass ${p.id}:`, e.message); errors++; }
      }
      createNotification('batchpass', 'Pass generati automaticamente',
        `Chiusura portale gruppo <strong>${group.name}</strong>: generati <strong>${ok}</strong> pass${errors ? `, ${errors} errori` : ''}.`,
        'assignment_group', groupId);
      logAction(null, 'batch_pass_on_close', 'assignment_group', groupId, `Trigger chiusura finestra: ${ok} pass, ${errors} errori`);
      return ok;
    } catch (e) {
      console.error('[triggerBatchPassOnClose]', e.message); return 0;
    }
  }

  // ── GET /passes — lista ───────────────────────────────────────────
  app.get('/passes', requireAuth, (req, res) => {
    db.all(
      `SELECT p.id, p.created_at, p.pdf_file, p.code, p.status,
              pt.name AS pass_type_name,
              pa.first_name || ' ' || pa.last_name AS participant_name
       FROM passes p
       JOIN pass_types pt ON pt.id=p.pass_type_id
       JOIN participants pa ON pa.id=p.participant_id
       ORDER BY p.id DESC`,
      [],
      (err, passes) => {
        if (err) return res.status(500).send('Errore DB pass');
        res.render('passes', { passes, statuses: PASS_STATUSES, replaced: req.query.replaced || null });
      }
    );
  });

  // ── GET /passes/new ──────────────────────────────────────────────
  app.get('/passes/new', requireAuth, (req, res) => {
    db.all('SELECT * FROM participants ORDER BY last_name, first_name', [], (_e, participants) => {
      db.all('SELECT * FROM pass_types ORDER BY name', [], (_e2, types) => {
        res.render('new_pass', { participants: participants || [], types: types || [] });
      });
    });
  });

  // ── GET /passes/check-participant/:id ────────────────────────────
  app.get('/passes/check-participant/:id', requireAuth, (req, res) => {
    db.all(
      `SELECT p.id, p.code, p.status, p.created_at, pt.name AS pass_type_name
       FROM passes p JOIN pass_types pt ON pt.id=p.pass_type_id
       WHERE p.participant_id=? ORDER BY p.id DESC`,
      [parseInt(req.params.id, 10)],
      (err, rows) => res.json(err ? { error: 'Errore DB' } : { passes: rows })
    );
  });

  // ── POST /passes — crea singolo ──────────────────────────────────
  app.post('/passes', requireAuth, requireNotViewer, async (req, res) => {
    const { participant_id, pass_type_id, force_duplicate } = req.body;
    if (!participant_id || !pass_type_id) return res.status(400).send('Partecipante e tipo pass obbligatori');
    const pid  = parseInt(participant_id, 10);
    const ptid = parseInt(pass_type_id, 10);
    if (!force_duplicate) {
      try {
        const existing = await dbAll(`SELECT p.id, p.code, p.status, p.created_at, pt.name AS pass_type_name FROM passes p JOIN pass_types pt ON pt.id=p.pass_type_id WHERE p.participant_id=? ORDER BY p.id DESC`, [pid]);
        if (existing?.length) {
          const [participants, types] = await Promise.all([
            dbAll('SELECT * FROM participants ORDER BY last_name, first_name'),
            dbAll('SELECT * FROM pass_types ORDER BY name'),
          ]);
          return res.render('new_pass', { participants, types, duplicate_warning: existing, preselected_participant: pid, preselected_type: ptid });
        }
      } catch (e) { return res.status(500).send('Errore verifica duplicato: ' + e.message); }
    }
    try {
      await generatePassForParticipant(pid, ptid, req.session.user.id);
      res.redirect('/passes');
    } catch (e) {
      res.status(500).send('Errore generazione pass: ' + (e.message || e));
    }
  });

  // ── POST /passes/bulk ────────────────────────────────────────────
  app.post('/passes/bulk', requireAuth, requireNotViewer, async (req, res) => {
    const { pass_type_id, assignment_group_id } = req.body;
    let { participant_ids } = req.body;
    if (!pass_type_id || !participant_ids) return res.status(400).send('Seleziona almeno una persona e una tipologia di pass.');
    if (!Array.isArray(participant_ids)) participant_ids = [participant_ids];
    const ids = participant_ids.map(Number).filter(Boolean);
    try {
      const dupChecks   = await Promise.all(ids.map(pid => dbGet('SELECT id FROM passes WHERE participant_id=? LIMIT 1', [pid]).then(r => r ? pid : null)));
      const skipped     = dupChecks.filter(Boolean);
      const toGenerate  = ids.filter(pid => !skipped.includes(pid));
      for (const pid of toGenerate) await generatePassForParticipant(pid, parseInt(pass_type_id, 10), req.session.user.id);
      const base = assignment_group_id ? `/assignment-groups/${assignment_group_id}` : '/passes';
      if (skipped.length) return res.redirect(`${base}?dup_skipped=${skipped.length}&dup_total=${ids.length}`);
      res.redirect(base);
    } catch (e) {
      res.status(500).send('Errore generazione bulk pass: ' + (e.message || e));
    }
  });

  // ── POST /passes/bulk-status ─────────────────────────────────────
  app.post('/passes/bulk-status', requireAuth, (req, res) => {
    const ids    = [].concat(req.body.pass_ids || []).map(Number).filter(Boolean);
    const status = req.body.status, gid = req.body.group_id;
    if (!ids.length || !status) return res.status(400).send('Parametri mancanti');
    const isViewer = req.session.user?.role === 'viewer';
    const allowed  = isViewer ? ['SCARICATO','STAMPATO','CONSEGNATO','RICONSEGNATO'] : PASS_STATUSES.filter(s => s !== 'GENERATO');
    if (!allowed.includes(status)) return res.status(403).send('Stato non consentito al tuo ruolo');
    let done = 0;
    ids.forEach(id => {
      db.run("UPDATE passes SET status=? WHERE id=? AND status!='INVALIDATO'", [status, id], () => {
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [id, status, req.session.user.id]);
        if (++done === ids.length) {
          logAction(req.session.user.id, 'bulk_status', 'pass', null, `Stato ${status} a ${ids.length} pass nel gruppo #${gid}`);
          res.redirect(gid ? '/assignment-groups/' + gid : '/passes');
        }
      });
    });
  });

  // ── GET /passes/:id/download ─────────────────────────────────────
  app.get('/passes/:id/download',
    (req, res, next) => { if (req.query.portal_token || req.session?.user) return next(); res.redirect('/login'); },
    (req, res) => {
      const id = parseInt(req.params.id, 10);
      db.get('SELECT pdf_file, status FROM passes WHERE id=?', [id], (err, pass) => {
        if (err || !pass?.pdf_file) return res.status(404).send('Pass non trovato');
        const filePath = path.join(DATA_DIR, 'generated', pass.pdf_file);
        if (pass.status === 'GENERATO') {
          const uid = req.session?.user?.id || null;
          db.run("UPDATE passes SET status='SCARICATO' WHERE id=? AND status='GENERATO'", [id]);
          db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [id, 'SCARICATO', uid]);
        }
        res.sendFile(filePath);
      });
    }
  );

  // ── GET /passes/:id/history ──────────────────────────────────────
  app.get('/passes/:id/history', requireAuth, (req, res) => {
    db.all(
      `SELECT h.status, h.changed_at, u.username
       FROM pass_status_history h LEFT JOIN users u ON u.id=h.user_id
       WHERE h.pass_id=? ORDER BY h.id ASC`,
      [parseInt(req.params.id, 10)],
      (err, rows) => res.json(err ? { error: 'Errore DB' } : rows || [])
    );
  });

  // ── POST /passes/:id/status ──────────────────────────────────────
  app.post('/passes/:id/status', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!status) return res.redirect('/passes');
    if (status === 'GENERATO') return res.status(400).send('Lo stato GENERATO non può essere riassegnato manualmente.');
    db.run("UPDATE passes SET status=? WHERE id=? AND status!='INVALIDATO' AND status!='GENERATO'", [status, id], function (err) {
      if (err) return res.status(500).send('Errore aggiornamento stato pass');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'update_pass_status', 'pass', id, `Stato aggiornato a ${status}`);
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [id, status, req.session.user.id]);
      }
      res.redirect(req.body.redirect_to || '/passes');
    });
  });

  // ── POST /passes/:id/delete ──────────────────────────────────────
  app.post('/passes/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM passes WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione pass');
      if (this.changes > 0) logAction(req.session.user.id, 'delete_pass', 'pass', id, 'Pass eliminato');
      res.redirect('/passes');
    });
  });

  // ── POST /passes/:id/replace ─────────────────────────────────────
  app.post('/passes/:id/replace', requireAuth, requireNotViewer, (req, res) => {
    const oldId = parseInt(req.params.id, 10);
    db.get(
      `SELECT p.*, pt.name AS type_name, pa.first_name, pa.last_name, pa.assignment_group_id
       FROM passes p JOIN pass_types pt ON pt.id=p.pass_type_id JOIN participants pa ON pa.id=p.participant_id
       WHERE p.id=? AND p.status!='INVALIDATO'`,
      [oldId],
      (err, old) => {
        if (err || !old) return res.status(404).send('Pass non trovato o già invalidato');
        db.run("UPDATE passes SET status='INVALIDATO' WHERE id=?", [oldId]);
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [oldId, 'INVALIDATO', req.session.user.id]);
        generatePassForParticipant(old.participant_id, old.pass_type_id, req.session.user.id)
          .then(nid => {
            db.run('UPDATE passes SET replaced_by=? WHERE id=?', [nid, oldId]);
            logAction(req.session.user.id, 'replace_pass', 'pass', oldId, `Pass #${oldId} → #${nid}`);
            createNotification('replace', 'Pass sostituito', `Pass #${oldId} di <strong>${old.first_name} ${old.last_name}</strong> → nuovo #${nid}.`, 'pass', nid);
            if (old.assignment_group_id) return res.redirect('/assignment-groups/' + old.assignment_group_id + '?replace_ok=1');
            res.redirect('/passes?replaced=' + nid);
          })
          .catch(e => res.status(500).send('Errore generazione pass: ' + (e.message || e)));
      }
    );
  });

  // ── Batch PDF gruppo ─────────────────────────────────────────────
  app.get('/assignment-groups/:id/batch-pdf', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get('SELECT name FROM assignment_groups WHERE id=?', [id], (err, grp) => {
      if (err || !grp) return res.status(404).send('Gruppo non trovato');
      db.all(
        `SELECT p.pdf_file, pa.first_name, pa.last_name
         FROM passes p JOIN participants pa ON pa.id=p.participant_id
         WHERE pa.assignment_group_id=? AND p.pdf_file IS NOT NULL AND p.status!='INVALIDATO'
         ORDER BY pa.last_name, pa.first_name`,
        [id],
        async (err2, passes) => {
          if (err2 || !passes?.length) return res.status(404).send('Nessun PDF disponibile per questo gruppo');
          try {
            const merged = await PDFDocument.create();
            for (const p of passes) {
              const fp = path.join(DATA_DIR, 'generated', p.pdf_file);
              if (!fs.existsSync(fp)) continue;
              const doc = await PDFDocument.load(fs.readFileSync(fp));
              const pages = await merged.copyPages(doc, doc.getPageIndices());
              pages.forEach(pg => merged.addPage(pg));
            }
            const out = await merged.save();
            const safeName = grp.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="batch_${safeName}.pdf"`);
            res.send(Buffer.from(out));
            logAction(req.session.user.id, 'batch_pdf', 'assignment_group', id, `Batch PDF (${passes.length} pass)`);
            db.all(`SELECT p.id FROM passes p JOIN participants pa ON pa.id=p.participant_id WHERE pa.assignment_group_id=? AND p.status='GENERATO'`, [id],
              (_e, toUpdate) => {
                if (!toUpdate?.length) return;
                toUpdate.forEach(p => {
                  db.run("UPDATE passes SET status='SCARICATO' WHERE id=?", [p.id]);
                  db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [p.id, 'SCARICATO', req.session.user.id]);
                });
              }
            );
          } catch (e) { res.status(500).send('Errore generazione PDF: ' + e.message); }
        }
      );
    });
  });

  // ── PASS-TYPES CRUD ──────────────────────────────────────────────
  app.get('/pass-types', requireAuth, requireAdmin, (_req, res) => res.redirect('/admin/settings#tipologie'));

  app.post('/pass-types', requireAuth, requireOrganizer, upload.single('template'), (req, res) => {
    const { name, description, name_x, name_y, role_x, role_y } = req.body;
    if (!name || !req.file) return res.status(400).send('Nome e PDF template sono obbligatori');
    const ext      = path.extname(req.file.originalname || '.pdf');
    const tFile    = req.file.filename + ext;
    fs.renameSync(req.file.path, path.join(path.dirname(req.file.path), tFile));
    db.run(
      'INSERT INTO pass_types (name, description, template_file, name_x, name_y, role_x, role_y, qr_color) VALUES (?,?,?,?,?,?,?,?)',
      [name, description || null, tFile, parseInt(name_x || 100), parseInt(name_y || 400), parseInt(role_x || 100), parseInt(role_y || 370), '#' + (req.body.qr_color || '000000').replace('#','').substring(0, 6)],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio tipo pass');
        logAction(req.session.user.id, 'create_pass_type', 'pass_type', this.lastID, `Creato tipo pass ${name}`);
        res.redirect('/admin/settings#tipologie');
      }
    );
  });

  app.post('/pass-types/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM pass_types WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione tipo pass');
      if (this.changes > 0) logAction(req.session.user.id, 'delete_pass_type', 'pass_type', id, 'Tipo pass eliminato');
      res.redirect('/admin/settings#tipologie');
    });
  });

  app.post('/pass-types/:id/qr-color', requireAuth, requireAdmin, (req, res) => {
    const id    = parseInt(req.params.id, 10);
    const color = '#' + (req.body.qr_color || '000000').replace('#','').substring(0, 6);
    db.run('UPDATE pass_types SET qr_color=? WHERE id=?', [color, id], (err) => {
      if (err) return res.status(500).send('Errore salvataggio colore QR');
      logAction(req.session.user.id, 'update_pt_qr_color', 'pass_type', id, 'Colore QR: ' + color);
      res.redirect('/admin/settings#tipologie');
    });
  });

  // ── Portal toggles (nominativi / docs / servizi / portale / token) ──
  const pToggle = (field) => (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get(`SELECT ${field} FROM assignment_groups WHERE id=?`, [id], (_e, row) => {
      if (!row) return res.status(404).json({ error: 'not found' });
      const v = row[field] ? 0 : 1;
      db.run(`UPDATE assignment_groups SET ${field}=? WHERE id=?`, [v, id], () => res.json({ enabled: v }));
    });
  };

  app.post('/admin/groups/:id/portal/toggle',          requireAuth, requireNotViewer, pToggle('portal_enabled'));
  app.post('/admin/groups/:id/portal/nom-toggle',       requireAuth, requireNotViewer, pToggle('portal_nom_enabled'));
  app.post('/admin/groups/:id/portal/docs-toggle',      requireAuth, requireNotViewer, pToggle('portal_docs_enabled'));
  app.post('/admin/groups/:id/portal/service-toggle',   requireAuth, requireNotViewer, pToggle('portal_service_enabled'));

  app.post('/admin/groups/:id/portal/token', requireAuth, requireNotViewer, (req, res) => {
    const id    = parseInt(req.params.id, 10);
    const token = require('crypto').randomBytes(24).toString('hex');
    db.run('UPDATE assignment_groups SET portal_token=?,portal_enabled=1 WHERE id=?', [token, id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ token });
    });
  });

  // Esporta le funzioni core per uso in altri moduli
  module.exports.generatePassForParticipant = generatePassForParticipant;
  module.exports.triggerBatchPassOnClose     = triggerBatchPassOnClose;
  module.exports.PASS_STATUSES               = PASS_STATUSES;
};

module.exports.PASS_STATUSES = ['IN_ATTESA','GENERATO','SCARICATO','STAMPATO','CONSEGNATO','RICONSEGNATO','INVALIDATO'];
