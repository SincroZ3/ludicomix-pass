
  const express = require('express');
  const path = require('path');
const os   = require('os');
  const fs = require('fs');
  const multer = require('multer');
  const session = require('express-session');
  const bcrypt = require('bcryptjs');
  const bwipjs = require('bwip-js');
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  const db = require('./db');

function createNotification(type,title,message,rT,rI){
  db.run("INSERT INTO notifications(type,title,message,related_type,related_id)VALUES(?,?,?,?,?)",[type,title,message,rT||null,rI||null],function(err){if(!err)trySendEmail(title,message);});}
function trySendEmail(subj,html){
  db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'",[],function(e,rows){
    if(e||!rows||rows.length<2)return;var c={};rows.forEach(function(r){c[r.key]=r.value;});
    if(!c.smtp_host||!c.smtp_to)return;
    nodemailer.createTransport({host:c.smtp_host,port:parseInt(c.smtp_port||'587',10),secure:c.smtp_secure==='1',
      auth:c.smtp_user?{user:c.smtp_user,pass:c.smtp_pass}:undefined,tls:{rejectUnauthorized:false}
    }).sendMail({from:c.smtp_from||'noreply@ludicomix.it',to:c.smtp_to,
      subject:'[Ludicomix] '+subj,html:'<div style="font-family:sans-serif">'+html+'</div>'},
      function(err2){if(err2)console.error('Email:',err2.message);});});}
function checkGroupLimit(gid){
  db.get(`SELECT ag.max_passes,ag.name,COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END)AS cnt
    FROM assignment_groups ag LEFT JOIN participants pa ON pa.assignment_group_id=ag.id
    LEFT JOIN passes p ON p.participant_id=pa.id WHERE ag.id=? GROUP BY ag.id`,[gid],function(err,row){
    if(err||!row||!row.max_passes)return;var pct=Math.round(row.cnt/row.max_passes*100);
    if(pct>=100)createNotification('limit_reached','Limite gruppo raggiunto','Gruppo <strong>'+row.name+'</strong> al 100% ('+row.cnt+'/'+row.max_passes+').','group',gid);
    else if(pct>=90)createNotification('limit_warning','Gruppo vicino al limite','Gruppo <strong>'+row.name+'</strong> al '+pct+'% ('+row.cnt+'/'+row.max_passes+').','group',gid);});}

function createNotification(type,title,message,rT,rI){
  db.run("INSERT INTO notifications(type,title,message,related_type,related_id)VALUES(?,?,?,?,?)",[type,title,message,rT||null,rI||null],function(err){if(!err)trySendEmail(title,message);});}
function trySendEmail(subj,html){
  db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'",[],function(e,rows){
    if(e||!rows||rows.length<2)return;var c={};rows.forEach(function(r){c[r.key]=r.value;});
    if(!c.smtp_host||!c.smtp_to)return;
    nodemailer.createTransport({host:c.smtp_host,port:parseInt(c.smtp_port||'587',10),secure:c.smtp_secure==='1',
      auth:c.smtp_user?{user:c.smtp_user,pass:c.smtp_pass}:undefined,tls:{rejectUnauthorized:false}
    }).sendMail({from:c.smtp_from||'noreply@ludicomix.it',to:c.smtp_to,
      subject:'[Ludicomix] '+subj,html:'<div style="font-family:sans-serif">'+html+'</div>'},
      function(err2){if(err2)console.error('Email:',err2.message);});});}
function checkGroupLimit(gid){
  db.get(`SELECT ag.max_passes,ag.name,COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END)AS cnt
    FROM assignment_groups ag LEFT JOIN participants pa ON pa.assignment_group_id=ag.id
    LEFT JOIN passes p ON p.participant_id=pa.id WHERE ag.id=? GROUP BY ag.id`,[gid],function(err,row){
    if(err||!row||!row.max_passes)return;var pct=Math.round(row.cnt/row.max_passes*100);
    if(pct>=100)createNotification('limit_reached','Limite gruppo raggiunto','Gruppo <strong>'+row.name+'</strong> al 100% ('+row.cnt+'/'+row.max_passes+').','group',gid);
    else if(pct>=90)createNotification('limit_warning','Gruppo vicino al limite','Gruppo <strong>'+row.name+'</strong> al '+pct+'% ('+row.cnt+'/'+row.max_passes+').','group',gid);});}

  const app = express();
  const PORT = process.env.PORT || 3000;

  const DATA_DIR = process.env.DATA_DIR || __dirname;
  ['templates', 'generated'].forEach((dir) => {
    const fullPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/generated', express.static(path.join(process.env.DATA_DIR || __dirname, 'generated')));

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'ludicomix-secret-2024',
      resave: false,
      saveUninitialized: false,
    })
  );

  const upload = multer({ dest: path.join(process.env.DATA_DIR || __dirname, 'templates') });

  function requireAuth(req, res, next) {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
      return res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
    }
    next();
  }

  // Blocca i viewer dalle azioni di scrittura
  function requireNotViewer(req, res, next) {
    if (req.session.user && req.session.user.role === 'viewer') {
      return res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
    }
    next();
  }

  function logAction(userId, action, entityType, entityId, details) {
    db.run(
      'INSERT INTO action_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [userId || null, action, entityType || null, entityId || null, details || null],
      (err) => {
        if (err) console.error('Errore salvataggio log azione:', err);
      }
    );
  }

  function generateRandomCode(len = 18) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  const PASS_STATUSES = ['GENERATO', 'SCARICATO', 'STAMPATO', 'CONSEGNATO', 'RICONSEGNATO'];

  app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    next();
  });

  app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/home');
    res.redirect('/login');
  });

  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/home');
    res.render('login', { error: null });
  });

  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.render('login', { error: 'Inserisci username e password.' });
    }
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (err) {
        console.error(err);
        return res.render('login', { error: 'Errore di sistema.' });
      }
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        logAction(null, 'login_failed', 'user', null, `Tentativo login per username ${username}`);
        return res.render('login', { error: 'Credenziali non valide.' });
      }
      req.session.user = { id: user.id, username: user.username, role: user.role };
      logAction(user.id, 'login', 'user', user.id, 'Login eseguito');
      res.redirect('/home');
    });
  });

  app.post('/logout', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    req.session.destroy(() => {
      logAction(userId, 'logout', 'user', userId, 'Logout eseguito');
      res.redirect('/login');
    });
  });

  app.get('/home', requireAuth, (req, res) => {
    db.get('SELECT COUNT(*) as total FROM participants', [], (e, r1) => {
      const totalParticipants = r1 ? r1.total : 0;
      db.get('SELECT COUNT(*) as total FROM passes', [], (e2, r2) => {
        const totalPasses = r2 ? r2.total : 0;
        db.all('SELECT status, COUNT(*) as count FROM passes GROUP BY status', [], (e3, sRows) => {
          const passesByStatus = {};
          (sRows || []).forEach(r => { passesByStatus[r.status] = r.count; });
          db.get("SELECT COUNT(*) as total FROM participants WHERE id NOT IN (SELECT DISTINCT participant_id FROM passes WHERE status!='INVALIDATO')",
            [], (e4, r4) => {
              const senzaPass = r4 ? r4.total : 0;
              db.all(`SELECT ag.name, ag.max_passes, COUNT(p.id) as pass_count
                FROM assignment_groups ag
                LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
                LEFT JOIN passes p ON p.participant_id = pa.id
                WHERE ag.max_passes IS NOT NULL AND ag.max_passes > 0
                GROUP BY ag.id
                HAVING CAST(pass_count AS FLOAT)/ag.max_passes >= 0.8
                ORDER BY CAST(pass_count AS FLOAT)/ag.max_passes DESC LIMIT 5`,
                [], (e5, alertGroups) => {
                  db.all(`SELECT al.action, al.details, al.created_at, u.username
                    FROM action_logs al LEFT JOIN users u ON u.id = al.user_id
                    ORDER BY al.id DESC LIMIT 8`,
                    [], (e6, recentActivity) => {
                      res.render('home', {
                        stats: { totalParticipants, totalPasses, passesByStatus, senzaPass },
                        alertGroups: alertGroups || [],
                        recentActivity: recentActivity || []
                      });
                    });
                });
            });
        });
      });
    });
  });

  // -------- Partecipanti, Gruppi, Categorie --------

  app.get('/participants', requireAuth, (req, res) => {
    db.all('SELECT * FROM groups ORDER BY priority, name', [], (err, categories) => {
      if (err) return res.status(500).send('Errore DB gruppi');
      db.all('SELECT * FROM pass_types ORDER BY name', [], (err2, types) => {
        if (err2) return res.status(500).send('Errore DB tipologie pass');
        const sql = `
          SELECT ag.id, ag.name, ag.notes, ag.email, ag.group_id, ag.stand_name, ag.zone, ag.stand_code, ag.max_passes,
                 g.name AS category_name, g.priority AS category_priority,
                 COUNT(p.id) AS participants_count
          FROM assignment_groups ag
          JOIN groups g ON g.id = ag.group_id
          LEFT JOIN participants p ON p.assignment_group_id = ag.id
          GROUP BY ag.id, ag.name, ag.notes, ag.group_id, ag.stand_name, ag.zone, ag.stand_code, ag.max_passes, g.name, g.priority
          ORDER BY g.priority, g.name, ag.name
        `;
        db.all(sql, [], (err3, assignmentGroups) => {
          if (err3) return res.status(500).send('Errore DB gruppi assegnatari');
          db.all('SELECT * FROM zones ORDER BY sort_order, name', [], (err4, zones) => {
            if (err4) return res.status(500).send('Errore DB zone');
            res.render('participants', { categories, types, assignmentGroups, zones: zones || [] });
          });
        });
      });
    });
  });

  app.post('/assignment-groups', requireAuth, requireNotViewer, (req, res) => {
    const { name, group_id, stand_name, zone, stand_code, notes, max_passes, email } = req.body;
    if (!name || !group_id) return res.status(400).send('Nome gruppo e categoria obbligatori');
    const maxVal = max_passes && parseInt(max_passes, 10) > 0 ? parseInt(max_passes, 10) : null;
    db.run(
      'INSERT INTO assignment_groups (name, group_id, stand_name, zone, stand_code, max_passes, notes, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, group_id, stand_name || null, zone || null, stand_code || null, maxVal, notes || null, email || null],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio gruppo assegnatari');
        logAction(req.session.user.id, 'create_assignment_group', 'assignment_group', this.lastID, `Creato gruppo ${name}`);
        res.redirect('/participants');
      }
    );
  });


  // POST modifica dati gruppo/stand
  app.post('/assignment-groups/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, stand_name, zone, stand_code } = req.body;
    if (!name) return res.status(400).send('Nome gruppo obbligatorio');
    db.run(
      'UPDATE assignment_groups SET name = ?, stand_name = ?, zone = ?, stand_code = ? WHERE id = ?',
      [name, stand_name || null, zone || null, stand_code || null, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento gruppo');
        logAction(req.session.user.id, 'edit_assignment_group', 'assignment_group', id, 'Dati gruppo aggiornati');
        res.redirect('/assignment-groups/' + id);
      }
    );
  });

  app.post('/assignment-groups/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM assignment_groups WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione gruppo assegnatari');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_assignment_group', 'assignment_group', id, 'Gruppo assegnatari eliminato');
      }
      res.redirect('/participants');
    });
  });

  app.get('/assignment-groups/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const sqlGroup = `
      SELECT ag.*, g.name AS category_name, g.id AS category_id
      FROM assignment_groups ag
      JOIN groups g ON g.id = ag.group_id
      WHERE ag.id = ?
    `;
    db.get(sqlGroup, [id], (err, groupInfo) => {
      if (err || !groupInfo) return res.status(404).send('Gruppo assegnatario non trovato');
      db.all('SELECT * FROM pass_types ORDER BY name', [], (err2, types) => {
        if (err2) return res.status(500).send('Errore DB tipologie pass');
        const sqlParticipants = `
          SELECT pa.*,
                 (SELECT status FROM passes WHERE participant_id = pa.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_status,
                 (SELECT id FROM passes WHERE participant_id = pa.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_pass_id
          FROM participants pa
          WHERE pa.assignment_group_id = ?
          ORDER BY pa.last_name, pa.first_name
        `;
        db.all(sqlParticipants, [id], (err3, participants) => {
          if (err3) return res.status(500).send('Errore DB partecipanti');
          const dupSkipped = req.query.dup_skipped ? parseInt(req.query.dup_skipped, 10) : 0;
        const dupTotal   = req.query.dup_total   ? parseInt(req.query.dup_total,   10) : 0;
        db.all('SELECT * FROM zones ORDER BY sort_order, name', [], (errZ, zones) => {
          res.render('assignment_group_detail', { groupInfo, types, participants, PASS_STATUSES, dupSkipped, dupTotal, zones: zones || [] });
        });
        });
      });
    });
  });


  app.post('/assignment-groups/:id/limit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { max_passes, admin_password } = req.body;
    if (!admin_password) return res.status(400).send('Password amministratore obbligatoria.');
    db.get("SELECT * FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1", [], (err, adminUser) => {
      if (err || !adminUser) return res.status(500).send('Impossibile verificare password amministratore.');
      if (!bcrypt.compareSync(admin_password, adminUser.password_hash)) {
        return res.status(403).send('Password amministratore non valida.');
      }
      let newMax = null;
      if (max_passes && parseInt(max_passes, 10) > 0) {
        newMax = parseInt(max_passes, 10);
      }
      db.run('UPDATE assignment_groups SET max_passes = ? WHERE id = ?', [newMax, id], (err2) => {
        if (err2) return res.status(500).send('Errore aggiornamento limite pass');
        logAction(req.session.user.id, 'update_assignment_group_limit', 'assignment_group', id, `Nuovo limite pass: ${newMax !== null ? newMax : 'illimitati'}`);
        res.redirect(`/assignment-groups/${id}`);
      });
    });
  });

  // POST aggiornamento note ed email gruppo
  app.post('/assignment-groups/:id/notes', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { notes, email } = req.body;
    db.run('UPDATE assignment_groups SET notes = ?, email = ? WHERE id = ?',
      [notes || null, email || null, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento note');
        logAction(req.session.user.id, 'update_assignment_group_notes', 'assignment_group', id, 'Note/email aggiornate');
        res.redirect('/assignment-groups/' + id);
      }
    );
  });

  // POST singolo partecipante (usato da nuovo assegnatario singolo)
  app.post('/participants', requireAuth, requireNotViewer, (req, res) => {
    const { first_name, last_name, email, role, stand_name, zone, ref_code, notes, assignment_group_id, redirect_to_group } = req.body;
    if (!first_name || !last_name) return res.status(400).send('Nome e cognome obbligatori');

    const doInsert = () => {
      db.run(
        `INSERT INTO participants (first_name, last_name, email, role, stand_name, zone, ref_code, notes, assignment_group_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [first_name, last_name, email || null, role || null, stand_name || null, zone || null, ref_code || null, notes || null, assignment_group_id || null],
        function (err) {
          if (err) return res.status(500).send('Errore salvataggio partecipante');
          logAction(req.session.user.id, 'create_participant', 'participant', this.lastID, `Creato partecipante ${first_name} ${last_name}`);
          if (redirect_to_group && assignment_group_id) {
            return res.redirect(`/assignment-groups/${assignment_group_id}`);
          }
          res.redirect('/participants');
        }
      );
    };

    if (assignment_group_id) {
      const groupId = parseInt(assignment_group_id, 10);
      db.get('SELECT max_passes FROM assignment_groups WHERE id = ?', [groupId], (err, ag) => {
        if (err) return res.status(500).send('Errore lettura gruppo assegnatario');
        if (ag && ag.max_passes != null) {
          db.get('SELECT COUNT(*) AS cnt FROM participants WHERE assignment_group_id = ?', [groupId], (err2, row) => {
            if (err2) return res.status(500).send('Errore lettura partecipanti del gruppo');
            if (row && row.cnt >= ag.max_passes) {
              return res.status(400).send('Limite massimo di pass per questo gruppo raggiunto.');
            }
            doInsert();
          });
        } else {
          doInsert();
        }
      });
    } else {
      doInsert();
    }
  });


  // API: controlla omonimi prima di inserire (singolo o bulk)
  app.post('/participants/check-duplicate', requireAuth, requireNotViewer, (req, res) => {
    const { first_name, last_name, assignment_group_id } = req.body;
    if (!first_name || !last_name) return res.json({ duplicates: [] });

    const fn = (first_name || '').trim().toLowerCase();
    const ln = (last_name || '').trim().toLowerCase();

    // Cerca sia ordine normale che invertito
    const sql = `
      SELECT p.id, p.first_name, p.last_name,
             ag.name AS group_name,
             g.name  AS category_name,
             (SELECT status FROM passes WHERE participant_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_status,
             (SELECT pt.name FROM passes ps JOIN pass_types pt ON pt.id = ps.pass_type_id
              WHERE ps.participant_id = p.id ORDER BY ps.created_at DESC, ps.id DESC LIMIT 1) AS pass_type_name
      FROM participants p
      LEFT JOIN assignment_groups ag ON ag.id = p.assignment_group_id
      LEFT JOIN groups g ON g.id = ag.group_id
      WHERE (LOWER(p.first_name) = ? AND LOWER(p.last_name) = ?)
         OR (LOWER(p.first_name) = ? AND LOWER(p.last_name) = ?)
    `;
    db.all(sql, [fn, ln, ln, fn], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Errore DB' });
      res.json({ duplicates: rows });
    });
  });

  // POST inserimento multiplo nominativi (bulk import da textarea)
  app.post('/participants/bulk-import', requireAuth, requireNotViewer, (req, res) => {
    const { names_list, assignment_group_id, force_over_limit, admin_password, new_max_passes } = req.body;
    if (!assignment_group_id) return res.status(400).json({ error: 'Gruppo non specificato' });
    const groupId = parseInt(assignment_group_id, 10);

    // Parse nomi dalla lista: ogni riga è "Nome Cognome" o "Cognome Nome"
    const lines = (names_list || '').split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) return res.status(400).json({ error: 'Nessun nominativo inserito' });

    // Parsea ogni riga: assume "Nome Cognome" (primo token = nome, resto = cognome)
    const parsed = lines.map(line => {
      const parts = line.split(/\s+/);
      if (parts.length === 1) return { first_name: parts[0], last_name: '' };
      return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
    });

    db.get('SELECT max_passes FROM assignment_groups WHERE id = ?', [groupId], (err, ag) => {
      if (err) return res.status(500).json({ error: 'Errore DB' });

      db.get('SELECT COUNT(*) AS cnt FROM participants WHERE assignment_group_id = ?', [groupId], (err2, row) => {
        if (err2) return res.status(500).json({ error: 'Errore DB' });

        const currentCount = row ? row.cnt : 0;
        const maxPasses = ag ? ag.max_passes : null;
        const totalAfter = currentCount + parsed.length;

        // Se c'è limite e verrebbe superato
        if (maxPasses != null && totalAfter > maxPasses && !force_over_limit) {
          return res.status(409).json({
            warning: true,
            current: currentCount,
            adding: parsed.length,
            total_after: totalAfter,
            max: maxPasses,
            over: totalAfter - maxPasses
          });
        }

        // Se force_over_limit: prima aggiorna il limite con verifica password admin
        const doInsertAll = () => {
          const stmt = db.prepare(
            `INSERT INTO participants (first_name, last_name, assignment_group_id) VALUES (?, ?, ?)`
          );
          let inserted = 0;
          parsed.forEach(p => {
            stmt.run([p.first_name, p.last_name, groupId], function(e) {
              if (!e) {
                inserted++;
                logAction(req.session.user.id, 'create_participant', 'participant', this.lastID,
                  `Creato partecipante ${p.first_name} ${p.last_name} (bulk)`);
              }
            });
          });
          stmt.finalize(() => {
            res.json({ success: true, inserted: parsed.length });
          });
        };

        if (force_over_limit === '1' && new_max_passes) {
          // Verifica password admin
          db.get("SELECT * FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1", [], (err3, adminUser) => {
            if (err3 || !adminUser) return res.status(500).json({ error: 'Impossibile verificare password' });
            const bcrypt = require('bcryptjs');
            if (!bcrypt.compareSync(admin_password || '', adminUser.password_hash)) {
              return res.status(403).json({ error: 'Password amministratore non valida' });
            }
            const newMax = parseInt(new_max_passes, 10);
            db.run('UPDATE assignment_groups SET max_passes = ? WHERE id = ?', [newMax, groupId], (err4) => {
              if (err4) return res.status(500).json({ error: 'Errore aggiornamento limite' });
              logAction(req.session.user.id, 'update_assignment_group_limit', 'assignment_group', groupId,
                `Limite aggiornato a ${newMax} durante bulk import`);
              doInsertAll();
            });
          });
        } else {
          doInsertAll();
        }
      });
    });
  });

  app.post('/participants/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    const { redirect_to_group_id } = req.body;
    db.run('DELETE FROM participants WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione partecipante');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_participant', 'participant', id, 'Partecipante eliminato');
      }
      if (redirect_to_group_id) {
        return res.redirect(`/assignment-groups/${redirect_to_group_id}`);
      }
      res.redirect('/participants');
    });
  });

  // -------- Tipologie Pass e Raggruppamenti --------

  app.get('/pass-types', requireAuth, requireAdmin, (req, res) => {
    res.redirect('/admin/settings#tipologie');
  });

  app.post('/pass-types', requireAuth, requireNotViewer, upload.single('template'), (req, res) => {
    const { name, description, name_x, name_y, role_x, role_y } = req.body;
    if (!name || !req.file) {
      return res.status(400).send('Nome e PDF template sono obbligatori');
    }
    const templateFile = req.file.filename + path.extname(req.file.originalname || '.pdf');
    const oldPath = req.file.path;
    const newPath = path.join(path.dirname(oldPath), templateFile);
    fs.renameSync(oldPath, newPath);

    db.run(
      `INSERT INTO pass_types (name, description, template_file, name_x, name_y, role_x, role_y)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        templateFile,
        parseInt(name_x || 100, 10),
        parseInt(name_y || 400, 10),
        parseInt(role_x || 100, 10),
        parseInt(role_y || 370, 10),
      ],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio tipo pass');
        logAction(req.session.user.id, 'create_pass_type', 'pass_type', this.lastID, `Creato tipo pass ${name}`);
        res.redirect('/admin/settings#tipologie');
      }
    );
  });

  app.post('/pass-types/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM pass_types WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione tipo pass');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_pass_type', 'pass_type', id, 'Tipo pass eliminato');
      }
      res.redirect('/admin/settings#tipologie');
    });
  });

  app.get('/groups', requireAuth, requireAdmin, (req, res) => {
    res.redirect('/admin/settings#raggruppamenti');
  });

  app.post('/groups', requireAuth, requireNotViewer, (req, res) => {
    const { name, priority, pass_type_id } = req.body;
    if (!name) return res.status(400).send('Nome raggruppamento obbligatorio');
    db.run(
      'INSERT INTO groups (name, priority, pass_type_id) VALUES (?, ?, ?)',
      [name, parseInt(priority || 0, 10), pass_type_id || null],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio raggruppamento');
        logAction(req.session.user.id, 'create_group', 'group', this.lastID, `Creato raggruppamento ${name}`);
        res.redirect('/admin/settings#raggruppamenti');
      }
    );
  });


  // POST modifica raggruppamento pass (tipologia PDF)
  app.post('/groups/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, priority, pass_type_id } = req.body;
    if (!name) return res.status(400).send('Nome raggruppamento obbligatorio');
    db.run(
      'UPDATE groups SET name = ?, priority = ?, pass_type_id = ? WHERE id = ?',
      [name, parseInt(priority || 0, 10), pass_type_id || null, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento raggruppamento');
        logAction(req.session.user.id, 'edit_group', 'group', id, 'Raggruppamento aggiornato');
        res.redirect('/admin/settings#raggruppamenti');
      }
    );
  });

  app.post('/groups/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM groups WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione raggruppamento');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_group', 'group', id, 'Raggruppamento eliminato');
      }
      res.redirect('/admin/settings#raggruppamenti');
    });
  });

  // -------- Funzione comune generazione pass --------

  // Sanitizza testo per pdf-lib (Helvetica supporta solo latin-1)
  function sanitizeForPdf(text) {
    if (!text) return '';
    // Sostituzioni manuali per caratteri che NFD non decompone correttamente
    const manualMap = {
      'Ł':'L','ł':'l','Ø':'O','ø':'o','Đ':'D','đ':'d',
      'Ħ':'H','ħ':'h','Ŋ':'N','ŋ':'n','Œ':'OE','œ':'oe',
      'Æ':'AE','æ':'ae','Þ':'Th','þ':'th','ß':'ss',
      'Ð':'D','ð':'d','Ĳ':'IJ','ĳ':'ij','ẞ':'SS',
      'Ş':'S','ş':'s','Ğ':'G','ğ':'g','İ':'I','ı':'i',
      'Ż':'Z','ż':'z','Ź':'Z','ź':'z','Ń':'N','ń':'n',
      'Ś':'S','ś':'s','Ć':'C','ć':'c','Ą':'A','ą':'a',
      'Ę':'E','ę':'e','Ó':'O','ó':'o','Ú':'U','ú':'u',
    };
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (manualMap[ch] !== undefined) {
        out += manualMap[ch];
      } else {
        out += ch;
      }
    }
    // Usa NFD per decomporre accentate (es. à → a + combining accent)
    // poi rimuove i combining diacritics (U+0300–U+036F)
    out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Rimuovi qualsiasi carattere ancora fuori dal range WinAnsi sicuro (ASCII stampabile)
    out = out.replace(/[^\x20-\x7E]/g, '?');
    return out;
  }

    async function generatePassForParticipant(participantId, passTypeId, userId) {
    return new Promise((resolve, reject) => {
      const sqlP = `
        SELECT p.*,
               ag.name AS group_name,
               ag.stand_name AS group_stand_name,
               ag.zone AS group_zone,
               ag.stand_code AS group_stand_code
        FROM participants p
        LEFT JOIN assignment_groups ag ON ag.id = p.assignment_group_id
        WHERE p.id = ?
      `;
      db.get(sqlP, [participantId], (err, participant) => {
        if (err || !participant) return reject(err || new Error('Partecipante non trovato'));
        db.get('SELECT * FROM pass_types WHERE id = ?', [passTypeId], async (err2, type) => {
          if (err2 || !type) return reject(err2 || new Error('Tipo pass non trovato'));
          try {
            const templatePath = path.join(process.env.DATA_DIR || __dirname, 'templates', type.template_file);
            const templateBytes = fs.readFileSync(templatePath);
            const pdfDoc = await PDFDocument.load(templateBytes);
            const pages = pdfDoc.getPages();
            const page = pages[0];

            const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

            const { width, height } = page.getSize();
            const qWidth = width / 2;
            const qHeight = height / 2;
            const originX = qWidth;
            const originY = height - qHeight;
            const centerX = originX + qWidth / 2;

            function drawCentered(text, size, font, y) {
              const textWidth = font.widthOfTextAtSize(text, size);
              const x = centerX - textWidth / 2;
              page.drawText(text, {
                x,
                y,
                size,
                font,
                color: rgb(0, 0, 0),
              });
            }

            let cursorY = originY + qHeight - 70;

            const passTypeLabel = sanitizeForPdf((type.name || '').toUpperCase());
            drawCentered(passTypeLabel, 28, boldFont, cursorY);
            cursorY -= 42;

            const isEspositore = passTypeLabel.includes('ESPOSITORE');
            if (isEspositore && participant.group_zone) {
              drawCentered(sanitizeForPdf((participant.group_zone || '').toUpperCase()), 22, boldFont, cursorY);
              cursorY -= 40;
            }

            const fullFirst = sanitizeForPdf((participant.first_name || '').toUpperCase());
            const fullLast = sanitizeForPdf((participant.last_name || '').toUpperCase());

            drawCentered(fullFirst, 26, boldFont, cursorY);
            cursorY -= 34;

            drawCentered(fullLast, 26, boldFont, cursorY);
            cursorY -= 42;

            const standLabel = sanitizeForPdf((participant.group_stand_name || participant.group_name || '').toUpperCase());
            if (standLabel) {
              drawCentered(standLabel, 18, boldFont, cursorY);
              cursorY -= 30;
            }

            if (participant.group_stand_code) {
              drawCentered(sanitizeForPdf((participant.group_stand_code || '').toUpperCase()), 16, boldFont, cursorY);
              cursorY -= 26;
            }

            const code = generateRandomCode(18);
            const png = await bwipjs.toBuffer({
              bcid: 'code128',
              text: code,
              scale: 2,
              height: 10,
              includetext: false,
              backgroundcolor: 'FFFFFF',
            });

            const barcodeImage = await pdfDoc.embedPng(png);
            const barcodeWidth = qWidth * 0.8;
            const barcodeHeight = 50;
            const barcodeX = centerX - barcodeWidth / 2;
            const barcodeY = originY + 80;

            page.drawImage(barcodeImage, {
              x: barcodeX,
              y: barcodeY,
              width: barcodeWidth,
              height: barcodeHeight,
            });

            const codeY = barcodeY - 18;
            drawCentered(code, 12, regularFont, codeY);

            const pdfBytes = await pdfDoc.save();

            db.run(
              'INSERT INTO passes (participant_id, pass_type_id, code, status, pdf_file) VALUES (?, ?, ?, ?, ?)',
              [participantId, passTypeId, code, 'GENERATO', ''],
              function (err3) {
                if (err3) return reject(err3);
                const passId = this.lastID;
                const filename = `pass_${passId}.pdf`;
                const outPath = path.join(process.env.DATA_DIR || __dirname, 'generated', filename);
                fs.writeFileSync(outPath, pdfBytes);
                db.run(
                  'UPDATE passes SET pdf_file = ? WHERE id = ?',
                  [filename, passId],
                  (err4) => {
                    if (err4) return reject(err4);
                    logAction(
                      userId,
                      'generate_pass',
                      'pass',
                      passId,
                      `Generato pass ${passId} per partecipante ${participant.first_name} ${participant.last_name}`
                    );
                    resolve();
                  }
                );
              }
            );
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  }

  // -------- Pass singolo e bulk --------


  // API: controlla se un partecipante ha già pass generati
  app.get('/passes/check-participant/:id', requireAuth, (req, res) => {
    const pid = parseInt(req.params.id, 10);
    const sql = `
      SELECT p.id, p.code, p.status, p.created_at,
             pt.name AS pass_type_name
      FROM passes p
      JOIN pass_types pt ON pt.id = p.pass_type_id
      WHERE p.participant_id = ?
      ORDER BY p.id DESC
    `;
    db.all(sql, [pid], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Errore DB' });
      res.json({ passes: rows });
    });
  });

  app.get('/passes', requireAuth, (req, res) => {
    const sql = `
      SELECT p.id, p.created_at, p.pdf_file, p.code, p.status,
             pt.name AS pass_type_name,
             pa.first_name || ' ' || pa.last_name AS participant_name
      FROM passes p
      JOIN pass_types pt ON pt.id = p.pass_type_id
      JOIN participants pa ON pa.id = p.participant_id
      ORDER BY p.id DESC
    `;
    db.all(sql, [], (err, passes) => {
      if (err) return res.status(500).send('Errore DB pass');
      res.render('passes', { passes, statuses: PASS_STATUSES, replaced: req.query.replaced||null });
    });
  });

  app.get('/passes/new', requireAuth, (req, res) => {
    db.all('SELECT * FROM participants ORDER BY last_name ASC, first_name ASC', [], (err, participants) => {
      if (err) return res.status(500).send('Errore DB partecipanti');
      db.all('SELECT * FROM pass_types ORDER BY name ASC', [], (err2, types) => {
        if (err2) return res.status(500).send('Errore DB tipologie pass');
        res.render('new_pass', { participants, types });
      });
    });
  });

  app.post('/passes', requireAuth, requireNotViewer, async (req, res) => {
    const { participant_id, pass_type_id, force_duplicate } = req.body;
    if (!participant_id || !pass_type_id) {
      return res.status(400).send('Partecipante e tipo pass obbligatori');
    }

    const pid  = parseInt(participant_id, 10);
    const ptid = parseInt(pass_type_id, 10);

    // Controllo duplicato (salvo override esplicito dall'utente)
    if (!force_duplicate) {
      try {
        const existing = await new Promise((resolve, reject) => {
          const sql = `
            SELECT p.id, p.code, p.status, p.created_at,
                   pt.name AS pass_type_name
            FROM passes p
            JOIN pass_types pt ON pt.id = p.pass_type_id
            WHERE p.participant_id = ?
            ORDER BY p.id DESC
          `;
          db.all(sql, [pid], (err, rows) => err ? reject(err) : resolve(rows));
        });

        if (existing && existing.length > 0) {
          const [participants, types] = await Promise.all([
            new Promise((res2, rej2) => db.all(
              'SELECT * FROM participants ORDER BY last_name ASC, first_name ASC', [],
              (e, r) => e ? rej2(e) : res2(r)
            )),
            new Promise((res2, rej2) => db.all(
              'SELECT * FROM pass_types ORDER BY name ASC', [],
              (e, r) => e ? rej2(e) : res2(r)
            )),
          ]);
          return res.render('new_pass', {
            participants,
            types,
            duplicate_warning: existing,
            preselected_participant: pid,
            preselected_type: ptid,
          });
        }
      } catch (e) {
        console.error('Errore check duplicato:', e.message);
        return res.status(500).send('Errore verifica duplicato pass');
      }
    }

    // Nessun duplicato (o override confermato): genera il pass
    try {
      await generatePassForParticipant(pid, ptid, req.session.user.id);
      res.redirect('/passes');
    } catch (e) {
      console.error('Errore singolo pass:', e.message || e);
      res.status(500).send('Errore generazione pass: ' + (e.message || e));
    }
  });

  app.post('/passes/bulk', requireAuth, requireNotViewer, async (req, res) => {
    const { pass_type_id, assignment_group_id } = req.body;
    let { participant_ids } = req.body;

    if (!pass_type_id || !participant_ids) {
      return res.status(400).send('Seleziona almeno una persona e una tipologia di pass.');
    }
    if (!Array.isArray(participant_ids)) {
      participant_ids = [participant_ids];
    }
    const ids = participant_ids.map((id) => parseInt(id, 10)).filter(Boolean);

    try {
      // Controlla duplicati: per ogni id verifica se ha già un pass
      const checkExisting = (pid) => new Promise((resolve, reject) => {
        db.get('SELECT id FROM passes WHERE participant_id = ? LIMIT 1', [pid], (err, row) => {
          if (err) return reject(err);
          resolve(row ? pid : null);
        });
      });

      const dupChecks = await Promise.all(ids.map(checkExisting));
      const alreadyHavePass = dupChecks.filter(Boolean);
      const toGenerate = ids.filter(pid => !alreadyHavePass.includes(pid));

      // Genera solo per chi non ha ancora il pass
      for (const pid of toGenerate) {
        await generatePassForParticipant(pid, parseInt(pass_type_id, 10), req.session.user.id);
      }

      const redirectBase = assignment_group_id
        ? `/assignment-groups/${assignment_group_id}`
        : '/passes';

      // Se ci sono stati duplicati saltati, passa il conteggio come query param
      if (alreadyHavePass.length > 0) {
        return res.redirect(`${redirectBase}?dup_skipped=${alreadyHavePass.length}&dup_total=${ids.length}`);
      }
      res.redirect(redirectBase);
    } catch (e) {
      console.error('Errore bulk pass:', e.message || e);
      res.status(500).send('Errore generazione pass: ' + (e.message || e));
    }
  });

  app.get('/passes/:id/download', function(req,res,next){if(req.query.portal_token||(req.session&&req.session.user))return next();return res.redirect('/login');
  }, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get('SELECT pdf_file FROM passes WHERE id = ?', [id], (err, pass) => {
      if (err || !pass || !pass.pdf_file) {
        return res.status(404).send('Pass non trovato');
      }
      const filePath = path.join(process.env.DATA_DIR || __dirname, 'generated', pass.pdf_file);
      db.run('UPDATE passes SET status = ? WHERE id = ?', ['SCARICATO', id], (err2) => {
        if (err2) console.error('Errore aggiornamento stato scaricato', err2);
        res.sendFile(filePath);
      });
    });
  });


  app.get('/passes/:id/history', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.all(`SELECT h.status, h.changed_at, u.username
      FROM pass_status_history h
      LEFT JOIN users u ON u.id = h.user_id
      WHERE h.pass_id = ? ORDER BY h.id ASC`,
      [id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Errore DB' });
        res.json(rows || []);
      });
  });

  app.post('/passes/:id/status', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!status) return res.redirect('/passes');
    db.run('UPDATE passes SET status = ? WHERE id = ?', [status, id], function (err) {
      if (err) return res.status(500).send('Errore aggiornamento stato pass');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'update_pass_status', 'pass', id, `Stato aggiornato a ${status}`);
        db.run('INSERT INTO pass_status_history (pass_id, status, user_id) VALUES (?, ?, ?)',
          [id, status, req.session.user.id]);
      }
      res.redirect(req.body.redirect_to || '/passes');
    });
  });

  app.post('/passes/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM passes WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione pass');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_pass', 'pass', id, 'Pass eliminato');
      }
      res.redirect('/passes');
    });
  });


  // -------- Impostazioni Admin (Zone, Raggruppamenti, Tipologie) --------

  app.get('/admin/settings', requireAuth, requireAdmin, (req, res) => {
    const sqlG = `
      SELECT g.id, g.name, g.priority, g.pass_type_id, pt.name AS pass_type_name
      FROM groups g
      LEFT JOIN pass_types pt ON pt.id = g.pass_type_id
      ORDER BY g.priority ASC, g.name ASC
    `;
    db.all(sqlG, [], (err, groups) => {
      if (err) return res.status(500).send('Errore DB raggruppamenti');
      db.all('SELECT * FROM pass_types ORDER BY id DESC', [], (err2, types) => {
        if (err2) return res.status(500).send('Errore DB tipologie pass');
        db.all('SELECT * FROM zones ORDER BY sort_order, name', [], (err3, zones) => {
          if (err3) return res.status(500).send('Errore DB zone');
          db.all('SELECT id, username, role, created_at FROM users ORDER BY username ASC', [], (err4, users) => {
            if (err4) return res.status(500).send('Errore DB utenti');
            db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'",[],function(e5,smtpRows){
              var smtp={}; (smtpRows||[]).forEach(function(r){smtp[r.key]=r.value;});
              res.render('admin_settings',{groups,types,zones,users,smtp});
            });
          });
        });
      });
    });
  });

  app.post('/admin/zones', requireAuth, requireAdmin, (req, res) => {
    const { name, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      'INSERT INTO zones (name, sort_order) VALUES (?, ?)',
      [name.trim(), parseInt(sort_order || 0, 10)],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE'))
            return res.status(400).send('Una zona con questo nome esiste gia');
          return res.status(500).send('Errore salvataggio zona');
        }
        logAction(req.session.user.id, 'create_zone', 'zone', this.lastID, 'Creata zona: ' + name.trim());
        res.redirect('/admin/settings#zone');
      }
    );
  });

  app.post('/admin/zones/:id/edit', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      'UPDATE zones SET name = ?, sort_order = ? WHERE id = ?',
      [name.trim(), parseInt(sort_order || 0, 10), id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento zona');
        logAction(req.session.user.id, 'edit_zone', 'zone', id, 'Zona aggiornata: ' + name.trim());
        res.redirect('/admin/settings#zone');
      }
    );
  });

  app.post('/admin/zones/:id/delete', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM zones WHERE id = ?', [id], function(err) {
      if (err) return res.status(500).send('Errore eliminazione zona');
      logAction(req.session.user.id, 'delete_zone', 'zone', id, 'Zona eliminata');
      res.redirect('/admin/settings#zone');
    });
  });


  // -------- Backup & Restore DB --------

  app.get('/admin/backup', requireAuth, requireAdmin, (req, res) => {
    const tmpPath = path.join(os.tmpdir(), `ludicomix_backup_${Date.now()}.sqlite`);
    db.run(`VACUUM INTO '${tmpPath}'`, function(err) {
      if (err) return res.status(500).send('Errore backup: ' + err.message);
      res.download(tmpPath, 'ludicomix_backup.sqlite', () => { fs.unlink(tmpPath, () => {}); });
    });
  });

  app.post('/admin/restore', requireAuth, requireAdmin, upload.single('backup'), (req, res) => {
    if (!req.file) return res.status(400).send('Nessun file caricato');
    const buf = Buffer.alloc(16);
    let fd;
    try { fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, buf, 0, 16, 0); fs.closeSync(fd); }
    catch(e) { fs.unlink(req.file.path, () => {}); return res.status(400).send('Impossibile leggere il file'); }
    if (buf.toString('ascii', 0, 15) !== 'SQLite format 3') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).send('File non valido: non e un database SQLite');
    }
    const dbPath = db.dbPath;
    db.close((err) => {
      if (err) return res.status(500).send('Errore chiusura DB: ' + err.message);
      try { fs.copyFileSync(req.file.path, dbPath); fs.unlink(req.file.path, () => {}); }
      catch(e) { return res.status(500).send('Errore sostituzione DB: ' + e.message); }
      res.send('<!DOCTYPE html><html><body><p style="font-family:sans-serif;padding:2rem">'
        + '<strong>Database ripristinato.</strong> Il server si riavvier&agrave; tra 2 secondi&hellip;</p>'
        + '<script>setTimeout(()=>location.href="/login",2500)<\/script></body></html>');
      setTimeout(() => process.exit(0), 1500);
    });
  });


  app.get('/import',requireAuth,requireNotViewer,function(req,res){db.all(`SELECT ag.id,ag.name,g.name AS cat FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id ORDER BY g.name,ag.name`,[],function(err,groups){res.render('import',{groups:groups||[],result:null});});});
  app.get('/import/template.csv',requireAuth,function(req,res){res.setHeader('Content-Type','text/csv;charset=utf-8');res.setHeader('Content-Disposition','attachment;filename="template_import.csv"');res.send('\xEF\xBB\xBFcognome;nome;email;ruolo\nRossi;Marco;marco@ex.com;Espositore\n');});
  app.post('/import',requireAuth,requireNotViewer,upload.single('file'),function(req,res){
    var gid=parseInt(req.body.group_id,10);if(!gid||!req.file)return res.status(400).send('Gruppo e file obbligatori');
    var rows;try{var wb=XLSX.read(req.file.buffer,{type:'buffer'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});}catch(e){return res.status(400).send('Errore:'+e.message);}
    if(!rows||!rows.length)return res.status(400).send('File vuoto');
    var ok=0,skip=0,errors=[];
    function ins(i){if(i>=rows.length){logAction(req.session.user.id,'import_csv','import',gid,'Import '+ok+' nel gruppo #'+gid);createNotification('import','Import CSV completato','Importati <strong>'+ok+'</strong> nel gruppo #'+gid+'. Saltati:'+skip+'.','group',gid);return db.all(`SELECT ag.id,ag.name,g.name AS cat FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id ORDER BY g.name,ag.name`,[],function(e,groups){res.render('import',{groups:groups||[],result:{ok,skip,errors}});});}
      var r=rows[i];var last=(r.cognome||r.Cognome||'').toString().trim(),first=(r.nome||r.Nome||'').toString().trim(),email=(r.email||r.Email||'').toString().trim().toLowerCase(),role=(r.ruolo||r.Ruolo||'Espositore').toString().trim();
      if(!last&&!first){skip++;return ins(i+1);}
      db.get('SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',[first.toLowerCase(),last.toLowerCase(),gid],function(e,dup){if(dup){skip++;return ins(i+1);}
        db.run('INSERT INTO participants(first_name,last_name,email,role,assignment_group_id)VALUES(?,?,?,?,?)',[first,last,email||null,role,gid],function(e2){if(e2)errors.push('Riga '+(i+2)+':'+e2.message);else ok++;ins(i+1);});});}
    ins(0);});
  app.post('/passes/:id/replace',requireAuth,requireNotViewer,function(req,res){
    var oldId=parseInt(req.params.id,10);
    db.get(`SELECT p.*,pt.name AS type_name,pa.first_name,pa.last_name FROM passes p JOIN pass_types pt ON pt.id=p.pass_type_id JOIN participants pa ON pa.id=p.participant_id WHERE p.id=? AND p.status!='INVALIDATO'`,[oldId],function(err,old){
      if(err||!old)return res.status(404).send('Pass non trovato');
      db.run("UPDATE passes SET status='INVALIDATO' WHERE id=?",[oldId]);db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[oldId,'INVALIDATO',req.session.user.id]);
      db.run('INSERT INTO passes(participant_id,pass_type_id,status,code)VALUES(?,?,?,?)',[old.participant_id,old.pass_type_id,'GENERATO','LDX-'+Date.now()],function(e2){if(e2)return res.status(500).send('Errore');
        var nid=this.lastID;db.run('UPDATE passes SET replaced_by=? WHERE id=?',[nid,oldId]);db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[nid,'GENERATO',req.session.user.id]);
        logAction(req.session.user.id,'replace_pass','pass',oldId,'Pass #'+oldId+' -> #'+nid);createNotification('replace','Pass sostituito','Pass #'+oldId+' di <strong>'+old.first_name+' '+old.last_name+'</strong> -> nuovo #'+nid+'.','pass',nid);
        res.redirect('/passes?replaced='+nid);});});});
  app.post('/admin/groups/:id/portal/token',requireAuth,requireAdmin,function(req,res){var id=parseInt(req.params.id,10),token=require('crypto').randomBytes(24).toString('hex');db.run('UPDATE assignment_groups SET portal_token=?,portal_enabled=1 WHERE id=?',[token,id],function(err){if(err)return res.status(500).json({error:err.message});res.json({token});});});
  app.post('/admin/groups/:id/portal/toggle',requireAuth,requireAdmin,function(req,res){var id=parseInt(req.params.id,10);db.get('SELECT portal_enabled FROM assignment_groups WHERE id=?',[id],function(e,row){if(!row)return res.status(404).json({error:'not found'});var v=row.portal_enabled?0:1;db.run('UPDATE assignment_groups SET portal_enabled=? WHERE id=?',[v,id],function(){res.json({enabled:v});});});});
  app.get('/portale/:token',function(req,res){db.get(`SELECT ag.*,g.name AS cat_name FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id WHERE ag.portal_token=? AND ag.portal_enabled=1`,[req.params.token],function(err,group){if(err||!group)return res.status(404).send('<h2 style="font-family:sans-serif;padding:2rem">Portale non disponibile.</h2>');db.all(`SELECT pa.first_name,pa.last_name,pa.email,pa.role,p.id AS pass_id,p.code,p.status,pt.name AS type_name FROM participants pa LEFT JOIN passes p ON p.participant_id=pa.id AND p.status!='INVALIDATO' LEFT JOIN pass_types pt ON pt.id=p.pass_type_id WHERE pa.assignment_group_id=? ORDER BY pa.last_name,pa.first_name`,[group.id],function(e2,parts){res.render('portale',{group,parts:parts||[],token:req.params.token});});});});
  app.get('/portale/:token/download/:passId',function(req,res){db.get(`SELECT ag.portal_enabled FROM assignment_groups ag JOIN participants pa ON pa.assignment_group_id=ag.id JOIN passes p ON p.participant_id=pa.id WHERE ag.portal_token=? AND p.id=?`,[req.params.token,req.params.passId],function(err,row){if(err||!row||!row.portal_enabled)return res.status(403).send('Accesso negato');res.redirect('/passes/'+req.params.passId+'/download?portal_token='+req.params.token);});});
  app.get('/mappa',requireAuth,function(req,res){db.all(`SELECT ag.id,ag.name AS stand_name,ag.zone,ag.map_row,ag.map_col,ag.map_span,ag.max_passes,COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END)AS pass_count,SUM(CASE WHEN p.status IN('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END)AS consegnati FROM assignment_groups ag LEFT JOIN participants pa ON pa.assignment_group_id=ag.id LEFT JOIN passes p ON p.participant_id=pa.id GROUP BY ag.id ORDER BY ag.map_row,ag.map_col`,[],function(err,stands){if(err)return res.status(500).send('Errore DB');res.render('mappa',{stands:stands||[],isAdmin:!!(req.session.user&&req.session.user.role==='admin')});});});
  app.post('/admin/groups/:id/map-position',requireAuth,requireAdmin,function(req,res){var id=parseInt(req.params.id,10),row=parseInt(req.body.map_row,10)||null,col=parseInt(req.body.map_col,10)||null,span=Math.max(1,Math.min(8,parseInt(req.body.map_span,10)||1));db.run('UPDATE assignment_groups SET map_row=?,map_col=?,map_span=? WHERE id=?',[row,col,span,id],function(err){res.json(err?{error:err.message}:{ok:true});});});
  app.get('/notifications',requireAuth,requireAdmin,function(req,res){db.run("UPDATE notifications SET read_at=datetime('now') WHERE read_at IS NULL");db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200',[],function(err,notifs){res.render('notifications',{notifs:notifs||[]});});});
  app.get('/api/notifications/count',requireAuth,requireAdmin,function(req,res){db.get('SELECT COUNT(*) as n FROM notifications WHERE read_at IS NULL',[],function(e,r){res.json({count:r?r.n:0});});});
  app.post('/notifications/read-all',requireAuth,requireAdmin,function(req,res){db.run("UPDATE notifications SET read_at=datetime('now') WHERE read_at IS NULL",function(){res.redirect('/notifications');});});
  app.post('/admin/settings/smtp',requireAuth,requireAdmin,function(req,res){var fields=['smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from','smtp_to'],done=0;fields.forEach(function(k){db.run('INSERT OR REPLACE INTO app_settings(key,value)VALUES(?,?)',[k,req.body[k]||''],function(){if(++done===fields.length)res.redirect('/admin/settings#notifiche');});});});
  app.post('/admin/settings/smtp-test',requireAuth,requireAdmin,function(req,res){var c=req.body;if(!c.smtp_host||!c.smtp_to)return res.json({ok:false,error:'Host e destinatario obbligatori'});nodemailer.createTransport({host:c.smtp_host,port:parseInt(c.smtp_port||'587',10),secure:c.smtp_secure==='1',auth:c.smtp_user?{user:c.smtp_user,pass:c.smtp_pass}:undefined,tls:{rejectUnauthorized:false}}).sendMail({from:c.smtp_from||'noreply@ludicomix.it',to:c.smtp_to,subject:'[Ludicomix] Test SMTP',html:'<p>Test OK!</p>'},function(err){res.json(err?{ok:false,error:err.message}:{ok:true});});});

  app.get('/import',requireAuth,requireNotViewer,function(req,res){db.all(`SELECT ag.id,ag.name,g.name AS cat FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id ORDER BY g.name,ag.name`,[],function(err,groups){res.render('import',{groups:groups||[],result:null});});});
  app.get('/import/template.csv',requireAuth,function(req,res){res.setHeader('Content-Type','text/csv;charset=utf-8');res.setHeader('Content-Disposition','attachment;filename="template_import.csv"');res.send('\xEF\xBB\xBFcognome;nome;email;ruolo\nRossi;Marco;marco@ex.com;Espositore\n');});
  app.post('/import',requireAuth,requireNotViewer,upload.single('file'),function(req,res){
    var gid=parseInt(req.body.group_id,10);if(!gid||!req.file)return res.status(400).send('Gruppo e file obbligatori');
    var rows;try{var wb=XLSX.read(req.file.buffer,{type:'buffer'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});}catch(e){return res.status(400).send('Errore:'+e.message);}
    if(!rows||!rows.length)return res.status(400).send('File vuoto');
    var ok=0,skip=0,errors=[];
    function ins(i){if(i>=rows.length){logAction(req.session.user.id,'import_csv','import',gid,'Import '+ok+' nel gruppo #'+gid);createNotification('import','Import CSV completato','Importati <strong>'+ok+'</strong> nel gruppo #'+gid+'. Saltati:'+skip+'.','group',gid);return db.all(`SELECT ag.id,ag.name,g.name AS cat FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id ORDER BY g.name,ag.name`,[],function(e,groups){res.render('import',{groups:groups||[],result:{ok,skip,errors}});});}
      var r=rows[i];var last=(r.cognome||r.Cognome||'').toString().trim(),first=(r.nome||r.Nome||'').toString().trim(),email=(r.email||r.Email||'').toString().trim().toLowerCase(),role=(r.ruolo||r.Ruolo||'Espositore').toString().trim();
      if(!last&&!first){skip++;return ins(i+1);}
      db.get('SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',[first.toLowerCase(),last.toLowerCase(),gid],function(e,dup){if(dup){skip++;return ins(i+1);}
        db.run('INSERT INTO participants(first_name,last_name,email,role,assignment_group_id)VALUES(?,?,?,?,?)',[first,last,email||null,role,gid],function(e2){if(e2)errors.push('Riga '+(i+2)+':'+e2.message);else ok++;ins(i+1);});});}
    ins(0);});
  app.post('/passes/:id/replace',requireAuth,requireNotViewer,function(req,res){
    var oldId=parseInt(req.params.id,10);
    db.get(`SELECT p.*,pt.name AS type_name,pa.first_name,pa.last_name FROM passes p JOIN pass_types pt ON pt.id=p.pass_type_id JOIN participants pa ON pa.id=p.participant_id WHERE p.id=? AND p.status!='INVALIDATO'`,[oldId],function(err,old){
      if(err||!old)return res.status(404).send('Pass non trovato');
      db.run("UPDATE passes SET status='INVALIDATO' WHERE id=?",[oldId]);db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[oldId,'INVALIDATO',req.session.user.id]);
      db.run('INSERT INTO passes(participant_id,pass_type_id,status,code)VALUES(?,?,?,?)',[old.participant_id,old.pass_type_id,'GENERATO','LDX-'+Date.now()],function(e2){if(e2)return res.status(500).send('Errore');
        var nid=this.lastID;db.run('UPDATE passes SET replaced_by=? WHERE id=?',[nid,oldId]);db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[nid,'GENERATO',req.session.user.id]);
        logAction(req.session.user.id,'replace_pass','pass',oldId,'Pass #'+oldId+' -> #'+nid);createNotification('replace','Pass sostituito','Pass #'+oldId+' di <strong>'+old.first_name+' '+old.last_name+'</strong> -> nuovo #'+nid+'.','pass',nid);
        res.redirect('/passes?replaced='+nid);});});});
  app.post('/admin/groups/:id/portal/token',requireAuth,requireAdmin,function(req,res){var id=parseInt(req.params.id,10),token=require('crypto').randomBytes(24).toString('hex');db.run('UPDATE assignment_groups SET portal_token=?,portal_enabled=1 WHERE id=?',[token,id],function(err){if(err)return res.status(500).json({error:err.message});res.json({token});});});
  app.post('/admin/groups/:id/portal/toggle',requireAuth,requireAdmin,function(req,res){var id=parseInt(req.params.id,10);db.get('SELECT portal_enabled FROM assignment_groups WHERE id=?',[id],function(e,row){if(!row)return res.status(404).json({error:'not found'});var v=row.portal_enabled?0:1;db.run('UPDATE assignment_groups SET portal_enabled=? WHERE id=?',[v,id],function(){res.json({enabled:v});});});});
  app.get('/portale/:token',function(req,res){db.get(`SELECT ag.*,g.name AS cat_name FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id WHERE ag.portal_token=? AND ag.portal_enabled=1`,[req.params.token],function(err,group){if(err||!group)return res.status(404).send('<h2 style="font-family:sans-serif;padding:2rem">Portale non disponibile.</h2>');db.all(`SELECT pa.first_name,pa.last_name,pa.email,pa.role,p.id AS pass_id,p.code,p.status,pt.name AS type_name FROM participants pa LEFT JOIN passes p ON p.participant_id=pa.id AND p.status!='INVALIDATO' LEFT JOIN pass_types pt ON pt.id=p.pass_type_id WHERE pa.assignment_group_id=? ORDER BY pa.last_name,pa.first_name`,[group.id],function(e2,parts){res.render('portale',{group,parts:parts||[],token:req.params.token});});});});
  app.get('/portale/:token/download/:passId',function(req,res){db.get(`SELECT ag.portal_enabled FROM assignment_groups ag JOIN participants pa ON pa.assignment_group_id=ag.id JOIN passes p ON p.participant_id=pa.id WHERE ag.portal_token=? AND p.id=?`,[req.params.token,req.params.passId],function(err,row){if(err||!row||!row.portal_enabled)return res.status(403).send('Accesso negato');res.redirect('/passes/'+req.params.passId+'/download?portal_token='+req.params.token);});});
  app.get('/mappa',requireAuth,function(req,res){db.all(`SELECT ag.id,ag.name AS stand_name,ag.zone,ag.map_row,ag.map_col,ag.map_span,ag.max_passes,COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END)AS pass_count,SUM(CASE WHEN p.status IN('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END)AS consegnati FROM assignment_groups ag LEFT JOIN participants pa ON pa.assignment_group_id=ag.id LEFT JOIN passes p ON p.participant_id=pa.id GROUP BY ag.id ORDER BY ag.map_row,ag.map_col`,[],function(err,stands){if(err)return res.status(500).send('Errore DB');res.render('mappa',{stands:stands||[],isAdmin:!!(req.session.user&&req.session.user.role==='admin')});});});
  app.post('/admin/groups/:id/map-position',requireAuth,requireAdmin,function(req,res){var id=parseInt(req.params.id,10),row=parseInt(req.body.map_row,10)||null,col=parseInt(req.body.map_col,10)||null,span=Math.max(1,Math.min(8,parseInt(req.body.map_span,10)||1));db.run('UPDATE assignment_groups SET map_row=?,map_col=?,map_span=? WHERE id=?',[row,col,span,id],function(err){res.json(err?{error:err.message}:{ok:true});});});
  app.get('/notifications',requireAuth,requireAdmin,function(req,res){db.run("UPDATE notifications SET read_at=datetime('now') WHERE read_at IS NULL");db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200',[],function(err,notifs){res.render('notifications',{notifs:notifs||[]});});});
  app.get('/api/notifications/count',requireAuth,requireAdmin,function(req,res){db.get('SELECT COUNT(*) as n FROM notifications WHERE read_at IS NULL',[],function(e,r){res.json({count:r?r.n:0});});});
  app.post('/notifications/read-all',requireAuth,requireAdmin,function(req,res){db.run("UPDATE notifications SET read_at=datetime('now') WHERE read_at IS NULL",function(){res.redirect('/notifications');});});
  app.post('/admin/settings/smtp',requireAuth,requireAdmin,function(req,res){var fields=['smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from','smtp_to'],done=0;fields.forEach(function(k){db.run('INSERT OR REPLACE INTO app_settings(key,value)VALUES(?,?)',[k,req.body[k]||''],function(){if(++done===fields.length)res.redirect('/admin/settings#notifiche');});});});
  app.post('/admin/settings/smtp-test',requireAuth,requireAdmin,function(req,res){var c=req.body;if(!c.smtp_host||!c.smtp_to)return res.json({ok:false,error:'Host e destinatario obbligatori'});nodemailer.createTransport({host:c.smtp_host,port:parseInt(c.smtp_port||'587',10),secure:c.smtp_secure==='1',auth:c.smtp_user?{user:c.smtp_user,pass:c.smtp_pass}:undefined,tls:{rejectUnauthorized:false}}).sendMail({from:c.smtp_from||'noreply@ludicomix.it',to:c.smtp_to,subject:'[Ludicomix] Test SMTP',html:'<p>Test OK!</p>'},function(err){res.json(err?{ok:false,error:err.message}:{ok:true});});});
  // -------- Ricerca & Reports --------

  app.get('/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.render('search', { q: '', results: [] });
    }
    const like = `%${q}%`;
    const sql = `
      SELECT p.id, p.created_at, p.pdf_file, p.code, p.status,
             pt.name AS pass_type_name,
             pa.first_name || ' ' || pa.last_name AS participant_name,
             ag.name AS group_name,
             ag.stand_name AS stand_name
      FROM passes p
      JOIN pass_types pt ON pt.id = p.pass_type_id
      JOIN participants pa ON pa.id = p.participant_id
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pt.name LIKE ? OR p.code LIKE ?
         OR ag.name LIKE ? OR ag.stand_name LIKE ?
      ORDER BY p.id DESC
    `;
    db.all(sql, [like, like, like, like, like, like, like], (err, rows) => {
      if (err) return res.status(500).send('Errore ricerca pass');
      res.render('search', { q, results: rows });
    });
  });

  app.get('/reports', requireAuth, (req, res) => {
    db.all("SELECT status, COUNT(*) as count FROM passes WHERE status!='INVALIDATO' GROUP BY status", [], (e, statusCounts) => {
      db.all(`SELECT ag.id, ag.name as group_name, g.name as category_name, ag.zone,
          ag.max_passes, COUNT(p.id) as pass_count,
          SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) as consegnati
        FROM assignment_groups ag
        LEFT JOIN groups g ON g.id = ag.group_id
        LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
        LEFT JOIN passes p ON p.participant_id = pa.id
        GROUP BY ag.id ORDER BY g.name, ag.name`,
        [], (e2, groupStats) => {
          db.get("SELECT COUNT(*) as total FROM participants WHERE id NOT IN (SELECT DISTINCT participant_id FROM passes WHERE status!='INVALIDATO')",
            [], (e3, r3) => {
              res.render('reports', {
                statusCounts: statusCounts || [],
                groupStats:   groupStats   || [],
                senzaPass:    r3 ? r3.total : 0
              });
            });
        });
    });
  });

  app.get('/reports/passes.csv', requireAuth, (req, res) => {
    db.all(`SELECT p.id, p.created_at, p.code, p.status,
        pa.first_name || ' ' || pa.last_name AS participant_name, pa.email, pa.role,
        pt.name AS pass_type_name, ag.name AS group_name, ag.stand_name, ag.zone
      FROM passes p
      JOIN pass_types pt ON pt.id = p.pass_type_id
      JOIN participants pa ON pa.id = p.participant_id
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      ORDER BY p.id DESC`,
      [], (err, rows) => {
        if (err) return res.status(500).send('Errore generazione report');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="report_passes.csv"');
        res.write('\xEF\xBB\xBF');
        res.write('ID;Data;Codice;Stato;Assegnatario;Email;Ruolo;Tipologia Pass;Gruppo;Stand;Zona\n');
        rows.forEach(r => {
          res.write([r.id, r.created_at, r.code||'', r.status||'',
            `"${r.participant_name||''}"`, `"${r.email||''}"`, `"${r.role||''}"`,
            `"${r.pass_type_name||''}"`, `"${r.group_name||''}"`,
            `"${r.stand_name||''}"`, `"${r.zone||''}"`].join(';') + '\n');
        });
        res.end();
      });
  });

  app.get('/reports/senza-pass.csv', requireAuth, (req, res) => {
    db.all(`SELECT pa.id, pa.first_name, pa.last_name, pa.email, pa.role,
        ag.name AS group_name, ag.stand_name, ag.zone
      FROM participants pa
      LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
      WHERE pa.id NOT IN (SELECT DISTINCT participant_id FROM passes)
      ORDER BY ag.name, pa.last_name, pa.first_name`,
      [], (err, rows) => {
        if (err) return res.status(500).send('Errore generazione report');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="senza_pass.csv"');
        res.write('\xEF\xBB\xBF');
        res.write('ID;Cognome;Nome;Email;Ruolo;Gruppo;Stand;Zona\n');
        rows.forEach(r => {
          res.write([r.id, `"${r.last_name||''}"`, `"${r.first_name||''}"`,
            `"${r.email||''}"`, `"${r.role||''}"`, `"${r.group_name||''}"`,
            `"${r.stand_name||''}"`, `"${r.zone||''}"`].join(';') + '\n');
        });
        res.end();
      });
  });

  app.get('/reports/stato-gruppi.csv', requireAuth, (req, res) => {
    db.all(`SELECT g.name as categoria, ag.name as gruppo, ag.zone, ag.stand_name,
        ag.max_passes, COUNT(p.id) as pass_totali,
        SUM(CASE WHEN p.status='GENERATO' THEN 1 ELSE 0 END) as generati,
        SUM(CASE WHEN p.status='CONSEGNATO' THEN 1 ELSE 0 END) as consegnati,
        SUM(CASE WHEN p.status='RICONSEGNATO' THEN 1 ELSE 0 END) as riconsegnati
      FROM assignment_groups ag
      LEFT JOIN groups g ON g.id = ag.group_id
      LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
      LEFT JOIN passes p ON p.participant_id = pa.id
      GROUP BY ag.id ORDER BY g.name, ag.name`,
      [], (err, rows) => {
        if (err) return res.status(500).send('Errore generazione report');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="stato_gruppi.csv"');
        res.write('\xEF\xBB\xBF');
        res.write('Categoria;Gruppo;Zona;Stand;Limite;Pass Totali;Generati;Consegnati;Riconsegnati\n');
        rows.forEach(r => {
          res.write([`"${r.categoria||''}"`, `"${r.gruppo||''}"`, `"${r.zone||''}"`,
            `"${r.stand_name||''}"`, r.max_passes||'', r.pass_totali,
            r.generati, r.consegnati, r.riconsegnati].join(';') + '\n');
        });
        res.end();
      });
  });

  // -------- Account, Utenti, Log --------

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

  app.get('/admin/users', requireAdmin, (req, res) => {
    res.redirect('/admin/settings#utenti');
  });

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
        if (err) {
          return res.status(500).send('Errore creazione utente (forse username già esistente).');
        }
        logAction(req.session.user.id, 'create_user', 'user', this.lastID, `Creato utente ${username} (${role})`);
        res.redirect('/admin/settings#utenti');
      }
    );
  });

  app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.session.user.id) {
      return res.status(400).send('Non puoi eliminare il tuo stesso utente.');
    }
    db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione utente');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_user', 'user', id, 'Utente eliminato');
      }
      res.redirect('/admin/settings#utenti');
    });
  });

  app.get('/admin/logs', requireAdmin, (req, res) => {
    const sql = `
      SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
             u.username
      FROM action_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC
      LIMIT 500
    `;
    db.all(sql, [], (err, logs) => {
      if (err) return res.status(500).send('Errore lettura log azioni');
      res.render('logs', { logs });
    });
  });

  app.get('/account/security', requireAuth, (req, res) => {
    res.render('security');
  });

  app.listen(PORT, () => {
    console.log(`Server avviato su http://localhost:${PORT}`);
  });
