/**
 * routes/auto-passes.js
 * ──────────────────────────────────────────────────────────────────
 * Pass parcheggio autonomi (auto-pass): generazione PDF, download,
 * aggiornamento stato, invalidazione, batch PDF.
 *
 * Route registrate:
 *   GET  /auto-passes/:id/pdf
 *   GET  /assignment-groups/:id/auto-passes/batch-pdf
 *   POST /auto-passes/:id/status
 *   POST /auto-passes/:id/invalidate
 *
 * Helper esportato: generateAutoPass(group, passNumber, totalPasses, apSettings, db)
 * ──────────────────────────────────────────────────────────────────
 */

const path   = require('path');
const fs     = require('fs');
const bwipjs = require('bwip-js');

const DATA_DIR = () => process.env.DATA_DIR || __dirname.replace('/routes', '');

function generateRandomCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Genera un singolo auto-pass PDF.
 * Restituisce { pdfBytes, code }.
 */
async function generateAutoPass(group, passNumber, totalPasses, apSettings) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const templatePath = path.join(DATA_DIR(), 'templates', apSettings.ap_template || 'auto_pass_template.pdf');
  if (!fs.existsSync(templatePath)) {
    throw new Error('Template auto-pass non trovato. Caricalo in Impostazioni > Pass Auto.');
  }
  const pdfDoc  = await PDFDocument.load(fs.readFileSync(templatePath));
  const page    = pdfDoc.getPages()[0];
  const font    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const N       = parseInt(apSettings.ap_esp_size || 20, 10);
  const standName = (group.stand_name || group.name || '').toUpperCase().replace(/[^\x00-\xFF]/g, '?');

  page.drawText(standName,         { x: parseInt(apSettings.ap_esp_x || 350, 10), y: parseInt(apSettings.ap_esp_y || 125, 10), size: N, font, color: rgb(0,0,0) });
  page.drawText(String(passNumber),{ x: parseInt(apSettings.ap_num_x ||  95, 10), y: parseInt(apSettings.ap_num_y || 125, 10), size: N, font, color: rgb(0,0,0) });
  page.drawText(String(totalPasses),{ x: parseInt(apSettings.ap_tot_x || 95, 10), y: parseInt(apSettings.ap_tot_y ||  95, 10), size: N, font, color: rgb(0,0,0) });

  const code   = generateRandomCode(18);
  const qrPng  = await bwipjs.toBuffer({ bcid: 'qrcode', text: code, scale: 4, backgroundcolor: 'FFFFFF' });
  const qrImg  = await pdfDoc.embedPng(qrPng);
  const qrSz   = parseInt(apSettings.ap_qr_size || 80, 10);
  page.drawImage(qrImg, {
    x: parseInt(apSettings.ap_qr_x || 660, 10),
    y: parseInt(apSettings.ap_qr_y ||  45, 10),
    width: qrSz, height: qrSz,
  });
  return { pdfBytes: await pdfDoc.save(), code };
}

module.exports = function registerAutoPassesRoutes(app, db, { requireAuth, requireAdmin, requireNotViewer, logAction }) {

  // ── Download singolo auto-pass (admin) ───────────────────────────
  app.get('/auto-passes/:id/pdf', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get(
      'SELECT ap.*, ag.name AS group_name FROM auto_passes ap JOIN assignment_groups ag ON ag.id=ap.assignment_group_id WHERE ap.id=?',
      [id],
      (err, ap) => {
        if (err || !ap || !ap.pdf_file) return res.status(404).send('Pass non trovato');
        const fpath = path.join(DATA_DIR(), 'generated', ap.pdf_file);
        if (!fs.existsSync(fpath)) return res.status(404).send('File non trovato');
        db.run("UPDATE auto_passes SET status='SCARICATO' WHERE id=? AND status='GENERATO'", [id]);
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [id, 'SCARICATO', req.session.user.id]);
        logAction(req.session.user.id, 'download_auto_pass', 'auto_pass', id, 'Auto-pass scaricato');
        res.download(fpath, `pass_auto_${ap.group_name}_${ap.pass_number}.pdf`);
      }
    );
  });

  // ── Batch PDF auto-pass (tutti i pass di un gruppo) ──────────────
  app.get('/assignment-groups/:id/auto-passes/batch-pdf', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.all(
      "SELECT * FROM auto_passes WHERE assignment_group_id=? AND status!='INVALIDATO' ORDER BY pass_number",
      [id],
      async (err, passes) => {
        if (err || !passes?.length) return res.status(404).send('Nessun auto-pass disponibile');
        const { PDFDocument } = require('pdf-lib');
        const merged = await PDFDocument.create();
        for (const p of passes) {
          const fpath = path.join(DATA_DIR(), 'generated', p.pdf_file || '');
          if (!fs.existsSync(fpath)) continue;
          const src = await PDFDocument.load(fs.readFileSync(fpath));
          const [page] = await merged.copyPages(src, [0]);
          merged.addPage(page);
          if (p.status === 'GENERATO') db.run("UPDATE auto_passes SET status='SCARICATO' WHERE id=?", [p.id]);
        }
        const out = await merged.save();
        db.get('SELECT name FROM assignment_groups WHERE id=?', [id], (_e2, g) => {
          logAction(req.session.user.id, 'batch_auto_pass', 'assignment_group', id, 'Batch auto-pass scaricato');
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="autopass_batch_${encodeURIComponent(g?.name || 'gruppo')}.pdf"`);
          res.send(Buffer.from(out));
        });
      }
    );
  });

  // ── Aggiorna stato ───────────────────────────────────────────────
  app.post('/auto-passes/:id/status', requireAuth, requireNotViewer, (req, res) => {
    const id     = parseInt(req.params.id, 10);
    const { status } = req.body;
    const valid  = ['SCARICATO', 'STAMPATO', 'CONSEGNATO', 'RICONSEGNATO'];
    if (!valid.includes(status)) return res.status(400).send('Stato non valido');
    db.run("UPDATE auto_passes SET status=? WHERE id=? AND status!='INVALIDATO'", [status, id], (err) => {
      if (err) return res.status(500).send('Errore DB');
      db.run('INSERT INTO pass_status_history(pass_id,status,user_id) VALUES(?,?,?)', [id, status, req.session.user.id]);
      logAction(req.session.user.id, 'status_auto_pass', 'auto_pass', id, 'Stato auto-pass aggiornato a ' + status);
      db.get('SELECT assignment_group_id FROM auto_passes WHERE id=?', [id], (_e2, ap) => {
        res.redirect('/assignment-groups/' + (ap?.assignment_group_id || ''));
      });
    });
  });

  // ── Invalida ─────────────────────────────────────────────────────
  app.post('/auto-passes/:id/invalidate', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run("UPDATE auto_passes SET status='INVALIDATO' WHERE id=?", [id], (err) => {
      if (err) return res.status(500).send('Errore DB');
      logAction(req.session.user.id, 'invalidate_auto_pass', 'auto_pass', id, 'Auto-pass invalidato');
      db.get('SELECT assignment_group_id FROM auto_passes WHERE id=?', [id], (_e2, ap) => {
        res.redirect('/assignment-groups/' + (ap?.assignment_group_id || ''));
      });
    });
  });

};

module.exports.generateAutoPass = generateAutoPass;
