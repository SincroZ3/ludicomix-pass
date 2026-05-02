
const express     = require('express');
const path        = require('path');
const os          = require('os');
const fs          = require('fs');
const multer      = require('multer');
const session     = require('express-session');
const bcrypt      = require('bcryptjs');
const bwipjs      = require('bwip-js');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const nodemailer  = require('nodemailer');          // ✅ FIX: era mancante
const helmet      = require('helmet');              // ✅ FIX: security headers
const rateLimit   = require('express-rate-limit'); // ✅ FIX: brute-force protection
const SQLiteStore = require('connect-sqlite3')(session); // ✅ FIX: session persistence
const XLSX        = require('xlsx');                        // ✅ FIX: parser CSV/Excel
const db          = require('./db');
const { promisify } = require('util');
const dbAll = promisify(db.all.bind(db));
const dbGet = promisify(db.get.bind(db));
function dbRun(sql,...p){return new Promise((resolve,reject)=>{const params=p.length===1&&Array.isArray(p[0])?p[0]:p;db.run(sql,params,function(err){if(err)return reject(err);resolve({lastID:this.lastID,changes:this.changes});});});}

// ── Cache edizione corrente (multi-edizione) ──────────────────────────────
let _currentEdition = null;
function refreshCurrentEdition(cb) {
  db.get('SELECT * FROM editions WHERE is_current=1 LIMIT 1', [], function(err, row) {
    _currentEdition = row || null;
    if (cb) cb();
  });
}
function edFilter() {
  return _currentEdition ? `AND ag.edition_id = ${_currentEdition.id}` : '';
}
function edVal() { return _currentEdition ? _currentEdition.id : null; }
refreshCurrentEdition();

// ── Migration: aggiungi colonne sezioni portale se non esistono ──────
['portal_nom_enabled','portal_docs_enabled','portal_service_enabled'].forEach(function(col) {
  db.run('ALTER TABLE assignment_groups ADD COLUMN ' + col + ' INTEGER DEFAULT 1', function(err) {
    if (err && !err.message.includes('duplicate column')) {
      console.warn('Migration ' + col + ':', err.message);
    } else {
      // Aggiorna record esistenti che hanno NULL (SQLite non aggiorna esistenti con ALTER)
      db.run('UPDATE assignment_groups SET ' + col + '=1 WHERE ' + col + ' IS NULL', function(e2) {
        if (e2) console.warn('Migration UPDATE ' + col + ':', e2.message);
      });
    }
  });
});
// ── Catalogo categorie materiali logistici ─────────────────────────────
const MATERIAL_CATALOG = {
  corrente:     { label: 'Corrente',   icon: '⚡' },
  gazebo:       { label: 'Gazebo',     icon: '⛺' },
  tavoli_extra: { label: 'Tavoli',     icon: '🪑' },
  sedie_extra:  { label: 'Sedie',      icon: '🪑' },
  transenne:    { label: 'Transenne',  icon: '🚧' },
  palchi_incontri: { label: 'Palchi & Incontri', icon: '🎙️' },
  altro:        { label: 'Altro',      icon: '📦' },
};





function createNotification(type,title,message,rT,rI){
  db.run("INSERT INTO notifications(type,title,message,related_type,related_id)VALUES(?,?,?,?,?)",[type,title,message,rT||null,rI||null],function(err){if(!err)trySendEmail(title,message);});}
function trySendEmail(subj, html) {
  db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'", [], function(e, rows) {
    // ✅ FIX: rimosso rows.length<2 che bloccava silenziosamente le email
    if (e || !rows) return;
    var c = {};
    rows.forEach(function(r) { c[r.key] = r.value; });
    if (!c.smtp_host || !c.smtp_to) return;
    nodemailer.createTransport({
      host: c.smtp_host,
      port: parseInt(c.smtp_port || '587', 10),
      secure: c.smtp_secure === '1',
      auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
      tls: { rejectUnauthorized: false }
    }).sendMail({
      from: c.smtp_from || 'noreply@ludicomix.it',
      to: c.smtp_to,
      subject: '[Ludicomix] ' + subj,
      html: '<div style="font-family:sans-serif">' + html + '</div>'
    }, function(err2) {
      if (err2) console.error('Email error:', err2.message);
    });
  });
}
function checkGroupLimit(gid){
  db.get(`SELECT ag.max_passes,ag.name,COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END)AS cnt
    FROM assignment_groups ag LEFT JOIN participants pa ON pa.assignment_group_id=ag.id
    LEFT JOIN passes p ON p.participant_id=pa.id WHERE ag.id=? GROUP BY ag.id`,[gid],function(err,row){
    if(err||!row||!row.max_passes)return;var pct=Math.round(row.cnt/row.max_passes*100);
    if(pct>=100)createNotification('limit_reached','Limite gruppo raggiunto','Gruppo <strong>'+row.name+'</strong> al 100% ('+row.cnt+'/'+row.max_passes+').','group',gid);
    else if(pct>=90)createNotification('limit_warning','Gruppo vicino al limite','Gruppo <strong>'+row.name+'</strong> al '+pct+'% ('+row.cnt+'/'+row.max_passes+').','group',gid);});}

  const crmRoutes   = require('./routes/crm');
const agendaRoutes = require('./agenda_routes');
const app = express();
  const PORT = process.env.PORT || 8080;

  // ✅ FIX: Railway usa reverse proxy - necessario per express-rate-limit e sessioni sicure
  app.set('trust proxy', 1);


  const DATA_DIR = process.env.DATA_DIR || __dirname;
  ['templates', 'generated'].forEach((dir) => {
    const fullPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
  });

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // ✅ FIX: security HTTP headers
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/generated', express.static(path.join(DATA_DIR, 'generated')));

  // ✅ FIX: sessione persistente su SQLite (sopravvive ai restart Railway)
  app.use(session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'ludicomix-secret-changeme-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    }
  }));

  // ✅ FIX: brute-force protection sul login
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Troppi tentativi di accesso. Riprova tra 15 minuti.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  app.use('/login', loginLimiter);

  const upload = multer({ dest: path.join(process.env.DATA_DIR || __dirname, 'templates') });
  const uploadMemory = multer({ storage: multer.memoryStorage(), limits:{ fileSize:2*1024*1024 } });

crmRoutes(app, db, { requireAuth, requireNotViewer, requireOrganizer, logAction, uploadMemory });
app.use('/', agendaRoutes(logAction));


  // ══════════════════════════════════════════════════════
  // GERARCHIA RUOLI
  //   admin      → accesso totale, gestione sistema e utenti
  //   organizer  → gestione operativa (stand, pass, partecipanti,
  //                bacheca, import) — NO impostazioni sistema/utenti
  //   operator   → crea/modifica partecipanti e pass, scan — NO
  //                struttura (zone, tipologie, raggruppamenti)
  //   scanner    → SOLO pagina scan — redirect automatico al login
  //   viewer     → sola lettura su tutto, NO modifiche
  // ══════════════════════════════════════════════════════

  const ROLES = {
    ADMIN:     'admin',
    ORGANIZER: 'organizer',
    OPERATOR:  'operator',
    SCANNER:   'scanner',
    VIEWER:    'viewer',
  };

  // Ruoli che possono FARE (scrivere) qualcosa
  const CAN_WRITE   = [ROLES.ADMIN, ROLES.ORGANIZER, ROLES.OPERATOR];
  // Ruoli che possono modificare la struttura (zone, tipologie, gruppi)
  const CAN_STRUCTURE = [ROLES.ADMIN, ROLES.ORGANIZER];
  // Ruoli che possono accedere alle impostazioni di sistema
  const CAN_ADMIN   = [ROLES.ADMIN];
  // Ruoli che possono scansionare
  const CAN_SCAN    = [ROLES.ADMIN, ROLES.ORGANIZER, ROLES.OPERATOR, ROLES.SCANNER, ROLES.VIEWER];

  function hasRole(user, ...roles) {
    return user && roles.includes(user.role);
  }

  function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    // Lo scanner viene confinato alla sola pagina /scan
    if (req.session.user.role === ROLES.SCANNER &&
        !req.path.startsWith('/scan') &&
        !req.path.startsWith('/api/scan') &&
        !req.path.startsWith('/contatore') &&
        !req.path.startsWith('/api/visitors') &&
        !req.path.startsWith('/logout')) {
      return res.redirect('/scan');
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!hasRole(req.session.user, ...CAN_ADMIN)) {
      return res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
    }
    next();
  }

  // Operazioni di struttura: admin + organizer
  function requireOrganizer(req, res, next) {
    if (!hasRole(req.session.user, ...CAN_STRUCTURE)) {
      return res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
    }
    next();
  }

  // Operazioni di scrittura: admin + organizer + operator
  function requireNotViewer(req, res, next) {
    if (!hasRole(req.session.user, ...CAN_WRITE)) {
      return res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
    }
    next();
  }

  // Ruoli che possono scansionare (incluso viewer — sola lettura ma può scansionare)
  function requireCanScan(req, res, next) {
    if (!hasRole(req.session.user, ...CAN_SCAN)) {
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
    res.locals.currentEdition = _currentEdition;
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
      // Scanner viene diretto subito alla pagina di scan
      const dest = user.role === ROLES.SCANNER ? '/scan' : '/home';
      res.redirect(dest);
    });
  });

  app.post('/logout', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    req.session.destroy(() => {
      logAction(userId, 'logout', 'user', userId, 'Logout eseguito');
      res.redirect('/login');
    });
  });

  
  // -------- API: Dashboard Stats (polling live) --------
  app.get('/api/dashboard-stats', requireAuth, async (req, res) => {
    try {
      const edId  = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      const since = todayMidnight();
      const edFilter2  = edId ? `AND p.edition_id = ${edId}` : '';
      const edFilterAg = edId ? `AND ag.edition_id = ${edId}` : '';

      // ── Query principali (obbligatorie) ──────────────────────────────────
      const [r1, r2, r3, r4] = await Promise.all([
        dbGet('SELECT COUNT(*) as total FROM participants'),
        dbGet('SELECT COUNT(*) as total FROM passes'),
        dbAll('SELECT status, COUNT(*) as count FROM passes GROUP BY status'),
        dbGet(`SELECT COUNT(*) as total FROM participants WHERE id NOT IN
               (SELECT DISTINCT participant_id FROM passes WHERE status!='INVALIDATO')`),
      ]);

      // ── Alert gruppi ──────────────────────────────────────────────────────
      const r5 = await dbAll(`
        SELECT ag.id, ag.name, ag.zone, ag.max_passes,
          COUNT(DISTINCT pa.id) AS participant_count,
          COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0) AS pass_count
        FROM assignment_groups ag
        LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
        LEFT JOIN passes p ON p.participant_id = pa.id
        WHERE (1=1) ${edFilterAg}
        GROUP BY ag.id
        HAVING
          (COUNT(DISTINCT pa.id)>0 AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0)
          OR (ag.max_passes IS NOT NULL AND ag.max_passes>0 AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)<ag.max_passes)
        ORDER BY
          CASE WHEN COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0 AND COUNT(DISTINCT pa.id)>0 THEN 0 ELSE 1 END ASC,
          (CASE WHEN ag.max_passes IS NOT NULL AND ag.max_passes>0 THEN ag.max_passes-COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0) ELSE 0 END) DESC
        LIMIT 12`).catch(() => []);

      // ── Attività recente ──────────────────────────────────────────────────
      const r6 = await dbAll(`
        SELECT al.action, al.details, al.created_at, u.username
        FROM action_logs al LEFT JOIN users u ON u.id = al.user_id
        ORDER BY al.id DESC LIMIT 8`).catch(() => []);

      // ── Query live (opzionali — non bloccano se falliscono) ───────────────
      const [r7, r8, r9, r10, r11, r12] = await Promise.all([
        // Heatmap: scan QR + contatore manuale uniti per ora
        dbAll(`
          SELECT ora, SUM(count) as count, SUM(qr) as qr, SUM(manual) as manual
          FROM (
            SELECT strftime('%H', created_at) as ora, COUNT(*) as count,
                   COUNT(*) as qr, 0 as manual
            FROM scan_attempts
            WHERE created_at >= ? AND result = 'OK'
            GROUP BY ora
            UNION ALL
            SELECT strftime('%H', counted_at) as ora, COUNT(*) as count,
                   0 as qr, COUNT(*) as manual
            FROM visitor_counts
            WHERE direction = 'IN' AND counted_at >= ?
            GROUP BY ora
          )
          GROUP BY ora ORDER BY ora ASC`, [since, since]).catch(() => []),
        // Scan anomali: stesso codice >3 volte nelle ultime 2 ore
        dbAll(`SELECT code, COUNT(*) as hits, MAX(created_at) as last_scan,
                 MAX(participant_name) as participant_name, MAX(group_name) as group_name
               FROM scan_attempts
               WHERE created_at >= datetime('now','-2 hours')
               GROUP BY code HAVING hits > 3
               ORDER BY hits DESC LIMIT 10`).catch(() => []),
        // Pass non consegnati
        dbAll(`SELECT ag.name as group_name, ag.zone, COUNT(p.id) as non_consegnati
               FROM passes p
               LEFT JOIN participants pa ON pa.id = p.participant_id
               LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
               WHERE p.status IN ('STAMPATO','GENERATO') ${edFilter2}
               GROUP BY ag.id
               ORDER BY non_consegnati DESC LIMIT 20`).catch(() => []),
        // Presenze live per area
        dbAll(`SELECT vc.area,
                 SUM(CASE WHEN vc.direction='IN'  THEN 1 ELSE 0 END) as ins,
                 SUM(CASE WHEN vc.direction='OUT' THEN 1 ELSE 0 END) as outs
               FROM visitor_counts vc
               LEFT JOIN (SELECT area, MAX(reset_at) as last_reset FROM visitor_resets GROUP BY area) vr
                 ON vr.area = vc.area
               WHERE vc.counted_at >= COALESCE(vr.last_reset, ?)
                 AND vc.counted_at >= ?
               GROUP BY vc.area`, [since, since]).catch(() => []),
        // Scan totali oggi (QR)
        dbGet(`SELECT COUNT(*) as total FROM scan_attempts
               WHERE result='OK' AND created_at >= ?`, [since]).catch(() => ({ total: 0 })),
        // Totale ingressi manuali oggi (visitor_counts)
        dbGet(`SELECT COUNT(*) as total FROM visitor_counts
               WHERE direction='IN' AND counted_at >= ?`, [since]).catch(() => ({ total: 0 })),
      ]);

      // ── Calcoli ───────────────────────────────────────────────────────────
      const passesByStatus = {};
      (r3 || []).forEach(r => { passesByStatus[r.status] = r.count; });

      const presenze = {};
      (r10 || []).forEach(r => {
        presenze[r.area] = { ins: r.ins||0, outs: r.outs||0, presenti: Math.max(0, (r.ins||0) - (r.outs||0)) };
      });

      const SCHEDULES = [
        { date: '2026-05-15', closingRitiro: '19:30', label: 'ritiro pass 15/05' },
        { date: '2026-05-16', closingRitiro: '09:30', label: 'ritiro pass 16/05' },
        { date: '2026-05-16', closingFiera:  '21:00', label: 'fiera 16/05' },
        { date: '2026-05-17', closingFiera:  '19:30', label: 'fiera 17/05' },
      ];
      function getNextClosing() {
        const now = new Date();
        const todayStr = now.toISOString().slice(0,10);
        const timeStr  = now.toTimeString().slice(0,5);
        for (const s of SCHEDULES) {
          if (s.date !== todayStr) continue;
          const closing = s.closingRitiro || s.closingFiera;
          if (timeStr < closing) {
            const [hh, mm] = closing.split(':').map(Number);
            const cl = new Date(now); cl.setHours(hh, mm, 0, 0);
            const diffMin = Math.floor((cl - now) / 60000);
            return { closing, label: s.label, diffMin, isRitiro: !!s.closingRitiro };
          }
        }
        return null;
      }
      const nextClosing = getNextClosing();
      const alertPassNonRitirati = nextClosing && nextClosing.isRitiro && nextClosing.diffMin <= 120
        ? { closing: nextClosing.closing, label: nextClosing.label, diffMin: nextClosing.diffMin }
        : null;

      res.json({
        stats: {
          totalParticipants: r1 ? r1.total : 0,
          totalPasses:       r2 ? r2.total : 0,
          passesByStatus,
          senzaPass:         r4 ? r4.total : 0,
          ingressiOggi:      (r11 ? r11.total : 0) + (r12 ? r12.total : 0),
        },
        alertGroups:         r5 || [],
        recentActivity:      r6 || [],
        heatmapOre:          r7 || [],
        scanAnomali:         r8 || [],
        passNonConsegnati:   r9 || [],
        presenze,
        alertPassNonRitirati,
        nextClosing,
      });
    } catch(err) {
      console.error('[dashboard-stats] errore:', err.message);
      res.status(500).json({ error: err.message });
    }
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
              db.all(`SELECT ag.id, ag.name, ag.zone, ag.max_passes,
                COUNT(DISTINCT pa.id) AS participant_count,
                COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0) AS pass_count
                FROM assignment_groups ag
                LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
                LEFT JOIN passes p ON p.participant_id = pa.id
                WHERE (1=1) ${edFilter()}
                GROUP BY ag.id
                HAVING
                  (COUNT(DISTINCT pa.id)>0 AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0)
                  OR (ag.max_passes IS NOT NULL AND ag.max_passes>0 AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)<ag.max_passes)
                ORDER BY
                  CASE WHEN COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0 AND COUNT(DISTINCT pa.id)>0 THEN 0 ELSE 1 END ASC,
                  (CASE WHEN ag.max_passes IS NOT NULL AND ag.max_passes>0 THEN ag.max_passes-COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0) ELSE 0 END) DESC
                LIMIT 12`,
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

  // ══════════════════════════════════════════════
  // VOLONTARI — V1
  // ══════════════════════════════════════════════

  app.get('/volunteers', requireAuth, async (req, res) => {
    try {
      const [volunteers, pending, shifts, zones] = await Promise.all([
        dbAll(`SELECT v.*, 
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id) AS assignments_count,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id AND sa.checkin_at IS NOT NULL) AS checkins_count
               FROM volunteers v WHERE (v.status NOT IN ('pending','rejected') OR v.status IS NULL) ORDER BY v.last_name ASC, v.first_name ASC`),
        dbAll(`SELECT * FROM volunteers WHERE status='pending' ORDER BY rowid DESC`),
        dbAll(`SELECT s.*, z.name AS zone_name,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
               FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
               ORDER BY s.start_at ASC, s.name ASC`),
        dbAll('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name')
      ]);
      res.render('volunteers', { volunteers: volunteers||[], pending: pending||[], shifts: shifts||[], zones: zones||[] });
    } catch (err) {
      console.error('[Volunteers]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });


  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const { first_name, last_name, email, phone, notes, availability, skills, tshirt_size, status, birth_date, birth_place, fiscal_code, residence } = req.body;
      const fn = String(first_name || '').trim();
      const ln = String(last_name || '').trim();
      if (!fn || !ln) return res.status(400).send('Nome e cognome obbligatori');

      let edId = null;
      if (_currentEdition && _currentEdition.id) edId = _currentEdition.id;
      if (!edId) {
        const cur = await dbGet('SELECT id FROM editions WHERE is_current=1 LIMIT 1');
        if (cur && cur.id) edId = cur.id;
      }
      if (!edId) {
        const anyEd = await dbGet('SELECT id FROM editions ORDER BY id DESC LIMIT 1');
        if (anyEd && anyEd.id) edId = anyEd.id;
      }
      if (!edId) edId = 1;

      db.run(
        `INSERT INTO volunteers (edition_id, first_name, last_name, email, phone, availability, skills, tshirt_size, status, notes, import_batch_id, active, birth_date, birth_place, fiscal_code, residence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [edId, fn, ln, email || null, phone || null, availability || '', skills || '', tshirt_size || null, status || 'approved', notes || null, null, 1, birth_date||null, birth_place||null, fiscal_code ? String(fiscal_code).toUpperCase().trim() : null, residence||null],
        function(err) {
          if (err) {
            console.error('[Volunteers POST]', err && err.stack ? err.stack : err.message);
            return res.status(500).type('text/plain').send('Errore salvataggio volontario: ' + err.message);
          }
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Volunteers POST catch]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('Errore salvataggio volontario: ' + (err.message || err));
    }
  });

  app.post('/volunteers/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { first_name, last_name, email, phone, notes, availability, skills, active, birth_date, birth_place, fiscal_code, residence } = req.body;
    db.run(
      `UPDATE volunteers SET first_name=?, last_name=?, email=?, phone=?, notes=?, availability=?, skills=?, active=?, birth_date=?, birth_place=?, fiscal_code=?, residence=? WHERE id=?`,
      [first_name.trim(), last_name.trim(), email||null, phone||null, notes||null, availability||'[]', skills||'[]', active ? 1 : 0, birth_date||null, birth_place||null, fiscal_code ? String(fiscal_code).toUpperCase().trim() : null, residence||null, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento volontario');
        logAction(req.session.user.id, 'edit_volunteer', 'volunteer', id, `Volontario #${id} aggiornato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteers/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE volunteer_id=?', [id], function() {
      db.run('DELETE FROM volunteers WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione volontario');
        logAction(req.session.user.id, 'delete_volunteer', 'volunteer', id, `Volontario #${id} eliminato`);
        res.redirect('/volunteers');
      });
    });
  });

  app.post('/volunteer-shifts', requireAuth, requireNotViewer, (req, res) => {
    const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes, active } = req.body;
    if (!name || !start_at || !end_at) return res.status(400).send('Nome turno e orari obbligatori');
    db.run(
      `INSERT INTO shifts (name,zone_id,role_label,start_at,end_at,max_volunteers,notes,active) VALUES (?,?,?,?,?,?,?,?)`,
      [name.trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null, active ? 1 : 0],
      function(err) {
        if (err) return res.status(500).send('Errore salvataggio turno');
        logAction(req.session.user.id, 'create_shift', 'shift', this.lastID, `Turno ${name} creato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-shifts/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes, active } = req.body;
    db.run(
      `UPDATE shifts SET name=?, zone_id=?, role_label=?, start_at=?, end_at=?, max_volunteers=?, notes=?, active=? WHERE id=?`,
      [name.trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null, active ? 1 : 0, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento turno');
        logAction(req.session.user.id, 'edit_shift', 'shift', id, `Turno #${id} aggiornato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-shifts/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE shift_id=?', [id], function() {
      db.run('DELETE FROM shifts WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione turno');
        logAction(req.session.user.id, 'delete_shift', 'shift', id, `Turno #${id} eliminato`);
        res.redirect('/volunteers');
      });
    });
  });

  app.post('/volunteer-assignments', requireAuth, requireNotViewer, (req, res) => {
    const shiftId = parseInt(req.body.shift_id, 10);
    const volunteerId = parseInt(req.body.volunteer_id, 10);
    if (!shiftId || !volunteerId) return res.status(400).send('Turno e volontario obbligatori');
    const code = 'VOLSHIFT-' + shiftId + '-' + volunteerId;
    db.run(
      `INSERT INTO shift_assignments (shift_id, volunteer_id, checkin_code) VALUES (?,?,?)`,
      [shiftId, volunteerId, code],
      function(err) {
        if (err) {
          if (String(err.message||'').includes('UNIQUE')) return res.status(400).send('Volontario già assegnato a questo turno');
          return res.status(500).send('Errore assegnazione volontario');
        }
        logAction(req.session.user.id, 'assign_volunteer', 'shift_assignment', this.lastID, `Volontario #${volunteerId} assegnato al turno #${shiftId}`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-assignments/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE id=?', [id], function(err) {
      if (err) return res.status(500).send('Errore rimozione assegnazione');
      logAction(req.session.user.id, 'delete_shift_assignment', 'shift_assignment', id, `Assegnazione volontario #${id} rimossa`);
      res.redirect('/volunteers');
    });
  });

  app.get('/volunteer-assignments/:shiftId', requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.shiftId, 10);
      const [shift, assignments, volunteers] = await Promise.all([
        dbGet(`SELECT s.*, z.name AS zone_name FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id WHERE s.id=?`, [shiftId]),
        dbAll(`SELECT sa.*, v.first_name, v.last_name, v.email, v.phone
               FROM shift_assignments sa
               JOIN volunteers v ON v.id=sa.volunteer_id
               WHERE sa.shift_id=?
               ORDER BY v.last_name, v.first_name`, [shiftId]),
        dbAll(`SELECT * FROM volunteers WHERE COALESCE(active,1)=1 ORDER BY last_name, first_name`)
      ]);
      if (!shift) return res.status(404).send('Turno non trovato');
      res.render('volunteer_assignments', { shift, assignments: assignments||[], volunteers: volunteers||[] });
    } catch (err) {
      console.error('[VolunteerAssignments]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  // ══════════════════════════════════════════════
  // VOLONTARI — V1
  // ══════════════════════════════════════════════

  app.get('/volunteers', requireAuth, async (req, res) => {
    try {
      const [volunteers, pending, shifts, zones] = await Promise.all([
        dbAll(`SELECT v.*, 
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id) AS assignments_count,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id AND sa.checkin_at IS NOT NULL) AS checkins_count
               FROM volunteers v WHERE (v.status NOT IN ('pending','rejected') OR v.status IS NULL) ORDER BY COALESCE(v.active,1) DESC, v.last_name ASC, v.first_name ASC`),
        dbAll(`SELECT * FROM volunteers WHERE status='pending' ORDER BY rowid DESC`),
        dbAll(`SELECT s.*, z.name AS zone_name,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
               FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
               ORDER BY s.start_at ASC, s.name ASC`),
        dbAll('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name')
      ]);
      res.render('volunteers', { volunteers: volunteers||[], pending: pending||[], shifts: shifts||[], zones: zones||[] });
    } catch (err) {
      console.error('[Volunteers]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  app.post('/volunteers', requireAuth, requireNotViewer, (req, res) => {
    const { first_name, last_name, email, phone, notes, availability, skills, active } = req.body;
    if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');
    db.run(
      `INSERT INTO volunteers (first_name,last_name,email,phone,notes,availability,skills,active) VALUES (?,?,?,?,?,?,?,?)`,
      [String(first_name).trim(), String(last_name).trim(), email||null, phone||null, notes||null, availability||'[]', skills||'[]', active ? 1 : 0],
      function(err) {
        if (err) return res.status(500).send('Errore salvataggio volontario');
        logAction(req.session.user.id, 'create_volunteer', 'volunteer', this.lastID, `Volontario ${first_name} ${last_name} creato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteers/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { first_name, last_name, email, phone, notes, availability, skills, active } = req.body;
    db.run(
      `UPDATE volunteers SET first_name=?, last_name=?, email=?, phone=?, notes=?, availability=?, skills=?, active=? WHERE id=?`,
      [String(first_name||'').trim(), String(last_name||'').trim(), email||null, phone||null, notes||null, availability||'[]', skills||'[]', active ? 1 : 0, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento volontario');
        logAction(req.session.user.id, 'edit_volunteer', 'volunteer', id, `Volontario #${id} aggiornato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteers/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE volunteer_id=?', [id], function() {
      db.run('DELETE FROM volunteers WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione volontario');
        logAction(req.session.user.id, 'delete_volunteer', 'volunteer', id, `Volontario #${id} eliminato`);
        res.redirect('/volunteers');
      });
    });
  });

  app.post('/volunteer-shifts', requireAuth, requireNotViewer, (req, res) => {
    const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes, active } = req.body;
    if (!String(name||'').trim() || !start_at || !end_at) return res.status(400).send('Nome turno e orari obbligatori');
    db.run(
      `INSERT INTO shifts (name,zone_id,role_label,start_at,end_at,max_volunteers,notes,active) VALUES (?,?,?,?,?,?,?,?)`,
      [String(name).trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null, active ? 1 : 0],
      function(err) {
        if (err) return res.status(500).send('Errore salvataggio turno');
        logAction(req.session.user.id, 'create_shift', 'shift', this.lastID, `Turno ${name} creato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-shifts/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes, active } = req.body;
    db.run(
      `UPDATE shifts SET name=?, zone_id=?, role_label=?, start_at=?, end_at=?, max_volunteers=?, notes=?, active=? WHERE id=?`,
      [String(name||'').trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null, active ? 1 : 0, id],
      function(err) {
        if (err) return res.status(500).send('Errore aggiornamento turno');
        logAction(req.session.user.id, 'edit_shift', 'shift', id, `Turno #${id} aggiornato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-shifts/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE shift_id=?', [id], function() {
      db.run('DELETE FROM shifts WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione turno');
        logAction(req.session.user.id, 'delete_shift', 'shift', id, `Turno #${id} eliminato`);
        res.redirect('/volunteers');
      });
    });
  });

  app.post('/volunteer-assignments', requireAuth, requireNotViewer, (req, res) => {
    const shiftId = parseInt(req.body.shift_id, 10);
    const volunteerId = parseInt(req.body.volunteer_id, 10);
    if (!shiftId || !volunteerId) return res.status(400).send('Turno e volontario obbligatori');
    const code = 'VOLSHIFT-' + shiftId + '-' + volunteerId;
    db.run(
      `INSERT INTO shift_assignments (shift_id, volunteer_id, checkin_code) VALUES (?,?,?)`,
      [shiftId, volunteerId, code],
      function(err) {
        if (err) {
          if (String(err.message||'').includes('UNIQUE')) return res.status(400).send('Volontario già assegnato a questo turno');
          return res.status(500).send('Errore assegnazione volontario');
        }
        logAction(req.session.user.id, 'assign_volunteer', 'shift_assignment', this.lastID, `Volontario #${volunteerId} assegnato al turno #${shiftId}`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-assignments/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE id=?', [id], function(err) {
      if (err) return res.status(500).send('Errore rimozione assegnazione');
      logAction(req.session.user.id, 'delete_shift_assignment', 'shift_assignment', id, `Assegnazione volontario #${id} rimossa`);
      res.redirect('/volunteers');
    });
  });

  app.get('/volunteer-assignments/:shiftId', requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.shiftId, 10);
      const [shift, assignments, volunteers] = await Promise.all([
        dbGet(`SELECT s.*, z.name AS zone_name FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id WHERE s.id=?`, [shiftId]),
        dbAll(`SELECT sa.*, v.first_name, v.last_name, v.email, v.phone
               FROM shift_assignments sa
               JOIN volunteers v ON v.id=sa.volunteer_id
               WHERE sa.shift_id=?
               ORDER BY v.last_name, v.first_name`, [shiftId]),
        dbAll(`SELECT * FROM volunteers WHERE COALESCE(active,1)=1 ORDER BY last_name, first_name`)
      ]);
      if (!shift) return res.status(404).send('Turno non trovato');
      res.render('volunteer_assignments', { shift, assignments: assignments||[], volunteers: volunteers||[] });
    } catch (err) {
      console.error('[VolunteerAssignments]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  // ══════════════════════════════════════════════
  // VOLONTARI — V1 compat
  // ══════════════════════════════════════════════

  app.get('/volunteers', requireAuth, async (req, res) => {
    try {
      const [volunteers, pending, shifts, zones] = await Promise.all([
        dbAll(`SELECT v.*, 
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id) AS assignments_count,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id AND sa.checkin_at IS NOT NULL) AS checkins_count
               FROM volunteers v WHERE (v.status NOT IN ('pending','rejected') OR v.status IS NULL) ORDER BY v.last_name ASC, v.first_name ASC`),
        dbAll(`SELECT * FROM volunteers WHERE status='pending' ORDER BY rowid DESC`),
        dbAll(`SELECT s.*, z.name AS zone_name,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
               FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
               ORDER BY s.start_at ASC, s.name ASC`),
        dbAll('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name')
      ]);
      res.render('volunteers', { volunteers: volunteers||[], shifts: shifts||[], zones: zones||[], pending: pending||[] });
    } catch (err) {
      console.error('[Volunteers]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  app.post('/volunteers', requireAuth, requireNotViewer, (req, res) => {
    const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
    if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');
    db.run(
      `INSERT INTO volunteers (first_name,last_name,email,phone,notes,availability,skills) VALUES (?,?,?,?,?,?,?)`,
      [String(first_name).trim(), String(last_name).trim(), email||null, phone||null, notes||null, availability||'', skills||''],
      function(err) {
        if (err) {
          console.error('[Volunteers POST]', err.message);
          return res.status(500).send('Errore salvataggio volontario');
        }
        logAction(req.session.user.id, 'create_volunteer', 'volunteer', this.lastID, `Volontario ${first_name} ${last_name} creato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteers/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
    db.run(
      `UPDATE volunteers SET first_name=?, last_name=?, email=?, phone=?, notes=?, availability=?, skills=? WHERE id=?`,
      [String(first_name||'').trim(), String(last_name||'').trim(), email||null, phone||null, notes||null, availability||'', skills||'', id],
      function(err) {
        if (err) {
          console.error('[Volunteers EDIT]', err.message);
          return res.status(500).send('Errore aggiornamento volontario');
        }
        logAction(req.session.user.id, 'edit_volunteer', 'volunteer', id, `Volontario #${id} aggiornato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteers/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE volunteer_id=?', [id], function() {
      db.run('DELETE FROM volunteers WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione volontario');
        logAction(req.session.user.id, 'delete_volunteer', 'volunteer', id, `Volontario #${id} eliminato`);
        res.redirect('/volunteers');
      });
    });
  });

  app.post('/volunteer-shifts', requireAuth, requireNotViewer, (req, res) => {
    const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes } = req.body;
    if (!String(name||'').trim() || !start_at || !end_at) return res.status(400).send('Nome turno e orari obbligatori');
    db.run(
      `INSERT INTO shifts (name,zone_id,role_label,start_at,end_at,max_volunteers,notes) VALUES (?,?,?,?,?,?,?)`,
      [String(name).trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null],
      function(err) {
        if (err) {
          console.error('[Shifts POST]', err.message);
          return res.status(500).send('Errore salvataggio turno');
        }
        logAction(req.session.user.id, 'create_shift', 'shift', this.lastID, `Turno ${name} creato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-shifts/:id/edit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes } = req.body;
    db.run(
      `UPDATE shifts SET name=?, zone_id=?, role_label=?, start_at=?, end_at=?, max_volunteers=?, notes=? WHERE id=?`,
      [String(name||'').trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null, id],
      function(err) {
        if (err) {
          console.error('[Shifts EDIT]', err.message);
          return res.status(500).send('Errore aggiornamento turno');
        }
        logAction(req.session.user.id, 'edit_shift', 'shift', id, `Turno #${id} aggiornato`);
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-shifts/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE shift_id=?', [id], function() {
      db.run('DELETE FROM shifts WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione turno');
        res.redirect('/volunteers');
      });
    });
  });

  app.post('/volunteer-assignments', requireAuth, requireNotViewer, (req, res) => {
    const shiftId = parseInt(req.body.shift_id, 10);
    const volunteerId = parseInt(req.body.volunteer_id, 10);
    if (!shiftId || !volunteerId) return res.status(400).send('Turno e volontario obbligatori');
    const code = 'VOLSHIFT-' + shiftId + '-' + volunteerId;
    db.run(
      `INSERT INTO shift_assignments (shift_id, volunteer_id, checkin_code) VALUES (?,?,?)`,
      [shiftId, volunteerId, code],
      function(err) {
        if (err) {
          console.error('[Assignments POST]', err.message);
          if (String(err.message||'').includes('UNIQUE')) return res.status(400).send('Volontario già assegnato a questo turno');
          return res.status(500).send('Errore assegnazione volontario');
        }
        res.redirect('/volunteers');
      }
    );
  });

  app.post('/volunteer-assignments/:id/delete', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM shift_assignments WHERE id=?', [id], function(err) {
      if (err) return res.status(500).send('Errore rimozione assegnazione');
      res.redirect('/volunteers');
    });
  });

  app.get('/volunteer-assignments/:shiftId', requireAuth, async (req, res) => {
    try {
      const shiftId = parseInt(req.params.shiftId, 10);
      const [shift, assignments, volunteers] = await Promise.all([
        dbGet(`SELECT s.*, z.name AS zone_name FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id WHERE s.id=?`, [shiftId]),
        dbAll(`SELECT sa.*, v.first_name, v.last_name, v.email, v.phone
               FROM shift_assignments sa
               JOIN volunteers v ON v.id=sa.volunteer_id
               WHERE sa.shift_id=?
               ORDER BY v.last_name, v.first_name`, [shiftId]),
        dbAll(`SELECT * FROM volunteers WHERE (status NOT IN ('pending','rejected') OR status IS NULL) ORDER BY last_name, first_name`)
      ]);
      if (!shift) return res.status(404).send('Turno non trovato');
      res.render('volunteer_assignments', { shift, assignments: assignments||[], volunteers: volunteers||[] });
    } catch (err) {
      console.error('[VolunteerAssignments]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });


  // ══════════════════════════════════════════════
  // VOLONTARI — V1 compat
  // ══════════════════════════════════════════════
  function ensureVolunteerTables(cb) {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS volunteers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        notes TEXT,
        availability TEXT,
        skills TEXT
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        zone_id INTEGER,
        role_label TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        max_volunteers INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        FOREIGN KEY(zone_id) REFERENCES zones(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS shift_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        volunteer_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'assigned',
        checkin_at TEXT,
        checkin_code TEXT,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id),
        FOREIGN KEY(volunteer_id) REFERENCES volunteers(id)
      )`, cb);
    });
  }

  app.get('/volunteers', requireAuth, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const [volunteers, pending, shifts, zones] = await Promise.all([
        dbAll(`SELECT v.*, 
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id) AS assignments_count,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id AND sa.checkin_at IS NOT NULL) AS checkins_count
               FROM volunteers v WHERE (v.status NOT IN ('pending','rejected') OR v.status IS NULL) ORDER BY v.last_name ASC, v.first_name ASC`),
        dbAll(`SELECT * FROM volunteers WHERE status='pending' ORDER BY rowid DESC`),
        dbAll(`SELECT s.*, z.name AS zone_name,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
               FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
               ORDER BY s.start_at ASC, s.name ASC`),
        dbAll('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name')
      ]);
      res.render('volunteers', { volunteers: volunteers||[], shifts: shifts||[], zones: zones||[], pending: pending||[] });
    } catch (err) {
      console.error('[Volunteers]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
      if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');
      db.run(
        `INSERT INTO volunteers (first_name,last_name,email,phone,notes,availability,skills) VALUES (?,?,?,?,?,?,?)`,
        [String(first_name).trim(), String(last_name).trim(), email||null, phone||null, notes||null, availability||'', skills||''],
        function(err) {
          if (err) {
            console.error('[Volunteers POST]', err.message);
            return res.status(500).send('Errore salvataggio volontario');
          }
          logAction(req.session.user.id, 'create_volunteer', 'volunteer', this.lastID, `Volontario ${first_name} ${last_name} creato`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Volunteers POST ensure]', err.message);
      res.status(500).send('Errore salvataggio volontario');
    }
  });

  app.post('/volunteers/:id/edit', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const id = parseInt(req.params.id, 10);
      const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
      db.run(
        `UPDATE volunteers SET first_name=?, last_name=?, email=?, phone=?, notes=?, availability=?, skills=? WHERE id=?`,
        [String(first_name||'').trim(), String(last_name||'').trim(), email||null, phone||null, notes||null, availability||'', skills||'', id],
        function(err) {
          if (err) {
            console.error('[Volunteers EDIT]', err.message);
            return res.status(500).send('Errore aggiornamento volontario');
          }
          logAction(req.session.user.id,'edit_volunteer','volunteer',id,`Volontario #${id} aggiornato`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Volunteers EDIT ensure]', err.message);
      res.status(500).send('Errore aggiornamento volontario');
    }
  });

  app.post('/volunteers/:id/delete', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const id = parseInt(req.params.id, 10);
      db.run('DELETE FROM shift_assignments WHERE volunteer_id=?', [id], function() {
        db.run('DELETE FROM volunteers WHERE id=?', [id], function(err) {
          if (err) return res.status(500).send('Errore eliminazione volontario');
          logAction(req.session.user.id,'delete_volunteer','volunteer',id,'Volontario eliminato');
          res.redirect('/volunteers');
        });
      });
    } catch (err) {
      console.error('[Volunteers DELETE ensure]', err.message);
      res.status(500).send('Errore eliminazione volontario');
    }
  });

  app.post('/volunteer-shifts', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes } = req.body;
      if (!String(name||'').trim() || !start_at || !end_at) return res.status(400).send('Nome turno e orari obbligatori');
      db.run(
        `INSERT INTO shifts (name,zone_id,role_label,start_at,end_at,max_volunteers,notes) VALUES (?,?,?,?,?,?,?)`,
        [String(name).trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null],
        function(err) {
          if (err) {
            console.error('[Shifts POST]', err.message);
            return res.status(500).send('Errore salvataggio turno');
          }
          logAction(req.session.user.id,'create_shift','shift',this.lastID,`Turno creato: ${String(name).trim()}`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Shifts POST ensure]', err.message);
      res.status(500).send('Errore salvataggio turno');
    }
  });

  app.post('/volunteer-shifts/:id/edit', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const id = parseInt(req.params.id, 10);
      const { name, zone_id, role_label, start_at, end_at, max_volunteers, notes } = req.body;
      db.run(
        `UPDATE shifts SET name=?, zone_id=?, role_label=?, start_at=?, end_at=?, max_volunteers=?, notes=? WHERE id=?`,
        [String(name||'').trim(), parseInt(zone_id)||null, role_label||null, start_at, end_at, parseInt(max_volunteers)||1, notes||null, id],
        function(err) {
          if (err) {
            console.error('[Shifts EDIT]', err.message);
            return res.status(500).send('Errore aggiornamento turno');
          }
          logAction(req.session.user.id,'edit_shift','shift',id,`Turno #${id} aggiornato`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Shifts EDIT ensure]', err.message);
      res.status(500).send('Errore aggiornamento turno');
    }
  });

  app.post('/volunteer-shifts/:id/delete', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const id = parseInt(req.params.id, 10);
      db.run('DELETE FROM shift_assignments WHERE shift_id=?', [id], function() {
        db.run('DELETE FROM shifts WHERE id=?', [id], function(err) {
          if (err) return res.status(500).send('Errore eliminazione turno');
          logAction(req.session.user.id,'delete_shift','shift',id,'Turno eliminato');
          res.redirect('/volunteers');
        });
      });
    } catch (err) {
      console.error('[Shifts DELETE ensure]', err.message);
      res.status(500).send('Errore eliminazione turno');
    }
  });

  app.post('/volunteer-assignments', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const shiftId = parseInt(req.body.shift_id, 10);
      const volunteerId = parseInt(req.body.volunteer_id, 10);
      if (!shiftId || !volunteerId) return res.status(400).send('Turno e volontario obbligatori');
      const code = 'VOLSHIFT-' + shiftId + '-' + volunteerId;
      db.run(
        `INSERT INTO shift_assignments (shift_id, volunteer_id, checkin_code) VALUES (?,?,?)`,
        [shiftId, volunteerId, code],
        function(err) {
          if (err) {
            console.error('[Assignments POST]', err.message);
            if (String(err.message||'').includes('UNIQUE')) return res.status(400).send('Volontario già assegnato a questo turno');
            return res.status(500).send('Errore assegnazione volontario');
          }
          logAction(req.session.user.id,'assign_volunteer','shift_assignment',this.lastID,`Volontario #${volunteerId} assegnato al turno #${shiftId}`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Assignments POST ensure]', err.message);
      res.status(500).send('Errore assegnazione volontario');
    }
  });

  app.post('/volunteer-assignments/:id/delete', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const id = parseInt(req.params.id, 10);
      db.run('DELETE FROM shift_assignments WHERE id=?', [id], function(err) {
        if (err) return res.status(500).send('Errore rimozione assegnazione');
        logAction(req.session.user.id,'delete_shift_assignment','shift_assignment',id,'Assegnazione turno rimossa');
        res.redirect('/volunteers');
      });
    } catch (err) {
      console.error('[Assignments DELETE ensure]', err.message);
      res.status(500).send('Errore rimozione assegnazione');
    }
  });

  app.get('/volunteer-assignments/:shiftId', requireAuth, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const shiftId = parseInt(req.params.shiftId, 10);
      const [shift, assignments, volunteers] = await Promise.all([
        dbGet(`SELECT s.*, z.name AS zone_name FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id WHERE s.id=?`, [shiftId]),
        dbAll(`SELECT sa.*, v.first_name, v.last_name, v.email, v.phone
               FROM shift_assignments sa
               JOIN volunteers v ON v.id=sa.volunteer_id
               WHERE sa.shift_id=?
               ORDER BY v.last_name, v.first_name`, [shiftId]),
        dbAll(`SELECT * FROM volunteers WHERE (status NOT IN ('pending','rejected') OR status IS NULL) ORDER BY last_name, first_name`)
      ]);
      if (!shift) return res.status(404).send('Turno non trovato');
      res.render('volunteer_assignments', { shift, assignments: assignments||[], volunteers: volunteers||[] });
    } catch (err) {
      console.error('[VolunteerAssignments]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });


  // ══════════════════════════════════════════════
  // VOLONTARI — diagnostica forte
  // ══════════════════════════════════════════════
  function ensureVolunteerTables(cb) {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS volunteers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        notes TEXT,
        availability TEXT,
        skills TEXT
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        zone_id INTEGER,
        role_label TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        max_volunteers INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        FOREIGN KEY(zone_id) REFERENCES zones(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS shift_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        volunteer_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'assigned',
        checkin_at TEXT,
        checkin_code TEXT,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id),
        FOREIGN KEY(volunteer_id) REFERENCES volunteers(id)
      )`, function(err){
        if (err) console.error('[VOL] ensure create error:', err.message);
        cb(err);
      });
    });
  }

  app.get('/volunteers-debug', requireAuth, (req, res) => {
    ensureVolunteerTables((err) => {
      if (err) return res.status(500).type('text/plain').send('ensure error: ' + err.message);
      db.all("PRAGMA table_info(volunteers)", [], (e1, cols) => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='volunteers'", [], (e2, row) => {
          res.type('application/json').send({
            ok: true,
            dbPath: db.dbPath || null,
            hasTable: !!row,
            pragmaError: e1 ? e1.message : null,
            masterError: e2 ? e2.message : null,
            columns: cols || []
          });
        });
      });
    });
  });

  app.get('/volunteers', requireAuth, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const [volunteers, pending, shifts, zones] = await Promise.all([
        dbAll(`SELECT v.*, 
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id) AS assignments_count,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.volunteer_id=v.id AND sa.checkin_at IS NOT NULL) AS checkins_count
               FROM volunteers v WHERE (v.status NOT IN ('pending','rejected') OR v.status IS NULL) ORDER BY v.last_name ASC, v.first_name ASC`),
        dbAll(`SELECT * FROM volunteers WHERE status='pending' ORDER BY rowid DESC`),
        dbAll(`SELECT s.*, z.name AS zone_name,
               (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
               FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
               ORDER BY s.start_at ASC, s.name ASC`),
        dbAll('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name')
      ]);
      res.render('volunteers', { volunteers: volunteers||[], shifts: shifts||[], zones: zones||[], pending: pending||[] });
    } catch (err) {
      console.error('[Volunteers GET]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('Volunteers GET error: ' + (err.message || err));
    }
  });

  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      await new Promise((resolve, reject) => ensureVolunteerTables(err => err ? reject(err) : resolve()));
      const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
      if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');
      console.log('[VOL POST body]', JSON.stringify({ first_name, last_name, email, phone, notes, availability, skills }));
      db.run(
        `INSERT INTO volunteers (first_name,last_name,email,phone,notes,availability,skills) VALUES (?,?,?,?,?,?,?)`,
        [String(first_name).trim(), String(last_name).trim(), email||null, phone||null, notes||null, availability||'', skills||''],
        function(err) {
          if (err) {
            console.error('[Volunteers POST]', err && err.stack ? err.stack : err.message);
            return res.status(500).type('text/plain').send('Volunteers POST error: ' + err.message);
          }
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Volunteers POST ensure]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('Volunteers POST ensure error: ' + (err.message || err));
    }
  });


  // ══════════════════════════════════════════════
  // VOLONTARI — schema reale Railway
  // ══════════════════════════════════════════════
  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
      if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');

      const edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      if (!edId) {
        console.error('[Volunteers POST] edizione corrente mancante');
        return res.status(500).send('Volunteers POST error: edizione corrente mancante');
      }

      db.run(
        `INSERT INTO volunteers (edition_id, first_name, last_name, email, phone, availability, skills, notes, status, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
        [edId, String(first_name).trim(), String(last_name).trim(), email||null, phone||null, availability||'', skills||'', notes||null],
        function(err) {
          if (err) {
            console.error('[Volunteers POST]', err && err.stack ? err.stack : err.message);
            return res.status(500).type('text/plain').send('Volunteers POST error: ' + err.message);
          }
          logAction(req.session.user.id, 'create_volunteer', 'volunteer', this.lastID, `Volontario ${first_name} ${last_name} creato`);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Volunteers POST catch]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('Volunteers POST catch: ' + (err.message || err));
    }
  });

  app.post('/volunteers/:id/edit', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { first_name, last_name, email, phone, notes, availability, skills, active, status, birth_date, birth_place, fiscal_code, residence } = req.body;
      db.run(
        `UPDATE volunteers
            SET first_name=?, last_name=?, email=?, phone=?, availability=?, skills=?, notes=?,
                active=?, status=?, birth_date=?, birth_place=?, fiscal_code=?, residence=?
          WHERE id=?`,
        [
          String(first_name||'').trim(),
          String(last_name||'').trim(),
          email||null,
          phone||null,
          availability||'',
          skills||'',
          notes||null,
          active ? 1 : 0,
          status || 'pending',
          birth_date||null,
          birth_place||null,
          fiscal_code ? String(fiscal_code).toUpperCase().trim() : null,
          residence||null,
          id
        ],
        function(err) {
          if (err) {
            console.error('[Volunteers EDIT]', err && err.stack ? err.stack : err.message);
            return res.status(500).send('Errore aggiornamento volontario: ' + err.message);
          }
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      console.error('[Volunteers EDIT catch]', err && err.stack ? err.stack : err);
      res.status(500).send('Errore aggiornamento volontario: ' + (err.message || err));
    }
  });


  // ══════════════════════════════════════════════
  // VOLONTARI — debug insert reale
  // ══════════════════════════════════════════════
  app.get('/volunteers-debug', requireAuth, async (req, res) => {
    try {
      const editions = await dbAll('SELECT id, name, year, is_current FROM editions ORDER BY is_current DESC, id DESC');
      const current = _currentEdition || null;
      const count = await dbGet('SELECT COUNT(*) AS n FROM volunteers');
      res.json({
        ok: true,
        dbPath: db.dbPath || null,
        currentEdition: current,
        editions,
        volunteersCount: count ? count.n : 0,
        requiredInsertExample: {
          edition_id: current ? current.id : null,
          first_name: 'Mario',
          last_name: 'Rossi',
          email: 'mario@example.com',
          phone: null,
          availability: '',
          skills: '',
          notes: null,
          status: 'pending',
          active: 1
        }
      });
    } catch (err) {
      console.error('[VOL DEBUG]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('VOL DEBUG error: ' + (err.message || err));
    }
  });

  app.post('/volunteers-test-insert', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      if (!edId) return res.status(500).send('TEST INSERT error: edizione corrente mancante');
      const payload = [edId, 'TEST', 'VOLONTARIO', 'test@example.com', null, '', '', 'debug insert'];
      db.run(
        `INSERT INTO volunteers (edition_id, first_name, last_name, email, phone, availability, skills, notes, status, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
        payload,
        function(err) {
          if (err) {
            console.error('[VOL TEST INSERT]', err && err.stack ? err.stack : err.message);
            return res.status(500).type('text/plain').send('VOL TEST INSERT error: ' + err.message);
          }
          res.type('text/plain').send('OK INSERT id=' + this.lastID);
        }
      );
    } catch (err) {
      console.error('[VOL TEST INSERT catch]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('VOL TEST INSERT catch: ' + (err.message || err));
    }
  });

  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const { first_name, last_name, email, phone, notes, availability, skills } = req.body;
      if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');

      const edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      if (!edId) {
        console.error('[Volunteers POST] edizione corrente mancante');
        return res.status(500).send('Volunteers POST error: edizione corrente mancante');
      }

      const sql = `INSERT INTO volunteers (edition_id, first_name, last_name, email, phone, availability, skills, notes, status, active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`;
      const params = [edId, String(first_name).trim(), String(last_name).trim(), email||null, phone||null, availability||'', skills||'', notes||null];
      console.log('[Volunteers POST SQL]', sql);
      console.log('[Volunteers POST params]', JSON.stringify(params));

      db.run(sql, params, function(err) {
        if (err) {
          console.error('[Volunteers POST]', err && err.stack ? err.stack : err.message);
          return res.status(500).type('text/plain').send('Volunteers POST error: ' + err.message);
        }
        res.redirect('/volunteers');
      });
    } catch (err) {
      console.error('[Volunteers POST catch]', err && err.stack ? err.stack : err);
      res.status(500).type('text/plain').send('Volunteers POST catch: ' + (err.message || err));
    }
  });


  // ══════════════════════════════════════════════
  // VOLONTARI — debug facile via browser
  // ══════════════════════════════════════════════
  app.get('/volunteers-debug', requireAuth, async (req, res) => {
    try {
      const columns = await dbAll('PRAGMA table_info(volunteers)');
      const editions = await dbAll('SELECT id, name, year, is_current FROM editions ORDER BY is_current DESC, id DESC');
      const current = _currentEdition || null;
      const count = await dbGet('SELECT COUNT(*) AS n FROM volunteers');
      res.json({
        ok: true,
        dbPath: db.dbPath || null,
        hasTable: true,
        currentEdition: current,
        editions,
        volunteersCount: count ? count.n : 0,
        columns
      });
    } catch (err) {
      res.status(500).type('text/plain').send('VOL DEBUG error: ' + (err.message || err));
    }
  });

  app.get('/volunteers-test-insert', requireAuth, requireNotViewer, async (req, res) => {
    try {
      let edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      if (!edId) {
        const cur = await dbGet('SELECT id FROM editions WHERE is_current=1 LIMIT 1');
        if (cur && cur.id) edId = cur.id;
      }
      if (!edId) {
        const anyEd = await dbGet('SELECT id FROM editions ORDER BY id DESC LIMIT 1');
        if (anyEd && anyEd.id) edId = anyEd.id;
      }
      if (!edId) return res.status(500).type('text/plain').send('VOL TEST INSERT error: nessuna edizione disponibile');

      db.run(
        `INSERT INTO volunteers (edition_id, first_name, last_name, email, phone, availability, skills, tshirt_size, status, notes, import_batch_id, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [edId, 'TEST', 'VOLONTARIO', 'test@example.com', null, '', '', null, 'pending', 'debug insert', null, 1],
        function(err) {
          if (err) return res.status(500).type('text/plain').send('VOL TEST INSERT error: ' + err.message);
          res.type('text/plain').send('OK INSERT id=' + this.lastID + ' edition_id=' + edId);
        }
      );
    } catch (err) {
      res.status(500).type('text/plain').send('VOL TEST INSERT catch: ' + (err.message || err));
    }
  });

  app.post('/volunteers', requireAuth, requireNotViewer, async (req, res) => {
    try {
      const { first_name, last_name, email, phone, notes, availability, skills, birth_date, birth_place, fiscal_code, residence } = req.body;
      if (!String(first_name||'').trim() || !String(last_name||'').trim()) return res.status(400).send('Nome e cognome obbligatori');

      let edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      if (!edId) {
        const cur = await dbGet('SELECT id FROM editions WHERE is_current=1 LIMIT 1');
        if (cur && cur.id) edId = cur.id;
      }
      if (!edId) {
        const anyEd = await dbGet('SELECT id FROM editions ORDER BY id DESC LIMIT 1');
        if (anyEd && anyEd.id) edId = anyEd.id;
      }
      if (!edId) edId = 1;

      db.run(
        `INSERT INTO volunteers (edition_id, first_name, last_name, email, phone, availability, skills, tshirt_size, status, notes, import_batch_id, active, birth_date, birth_place, fiscal_code, residence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [edId, String(first_name).trim(), String(last_name).trim(), email||null, phone||null, availability||'', skills||'', null, 'pending', notes||null, null, 1, birth_date||null, birth_place||null, fiscal_code ? String(fiscal_code).toUpperCase().trim() : null, residence||null],
        function(err) {
          if (err) return res.status(500).type('text/plain').send('Errore salvataggio volontario: ' + err.message);
          res.redirect('/volunteers');
        }
      );
    } catch (err) {
      res.status(500).type('text/plain').send('Errore salvataggio volontario: ' + (err.message || err));
    }
  });

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
          WHERE (1=1) ${edFilter()}
          GROUP BY ag.id, ag.name, ag.notes, ag.group_id, ag.stand_name, ag.zone, ag.stand_code, ag.max_passes, g.name, g.priority
          ORDER BY g.priority, LOWER(g.name), LOWER(ag.name)
        `;
        db.all(sql, [], (err3, assignmentGroups) => {
          if (err3) return res.status(500).send('Errore DB gruppi assegnatari');
          db.all('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name', [], (err4, zones) => {
            if (err4) return res.status(500).send('Errore DB zone');
            res.render('participants', { categories, types, assignmentGroups, zones: zones || [] });
          });
        });
      });
    });
  });

  app.post('/assignment-groups', requireAuth, requireOrganizer, (req, res) => {
    const { name, group_id, stand_name, zone, stand_code, notes, max_passes, email } = req.body;
    if (!name || !group_id) return res.status(400).send('Nome gruppo e categoria obbligatori');
    const maxVal = max_passes && parseInt(max_passes, 10) > 0 ? parseInt(max_passes, 10) : null;
    db.run(
      'INSERT INTO assignment_groups (name, group_id, stand_name, zone, stand_code, max_passes, notes, email, edition_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, group_id, stand_name || null, zone || null, stand_code || null, maxVal, notes || null, email || null, edVal()],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio gruppo assegnatari');
        logAction(req.session.user.id, 'create_assignment_group', 'assignment_group', this.lastID, `Creato gruppo ${name}`);
        res.redirect('/participants');
      }
    );
  });


  // POST modifica dati gruppo/stand
  app.post('/assignment-groups/:id/edit', requireAuth, requireOrganizer, (req, res) => {
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



  // POST salvataggio profilo ospite — SELECT + INSERT/UPDATE per compatibilità SQLite
  app.post('/assignment-groups/:id/guest-profile', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { bio, photo_url, category, website, social_instagram, sort_order, featured, active } = req.body;
    const vals = [
      bio||null, photo_url||null, category||null, website||null,
      social_instagram||null, parseInt(sort_order)||0,
      featured==='1'?1:0, active==='1'?1:0
    ];
    // Recupera il nome del gruppo (necessario per compatibilità con vecchi DB che hanno name NOT NULL)
    db.get('SELECT ag.name, gp.id AS gp_id FROM assignment_groups ag LEFT JOIN guest_profiles gp ON gp.assignment_group_id = ag.id WHERE ag.id = ?', [id], (err, row) => {
      if (err) { console.error('[GuestProfile] SELECT:', err.message); return res.status(500).send('Errore lettura profilo ospite'); }
      const groupName = (row && row.name) || '';
      if (row && row.gp_id) {
        // UPDATE
        db.run(
          `UPDATE guest_profiles SET name=?,bio=?,photo_url=?,category=?,website=?,social_instagram=?,sort_order=?,featured=?,active=? WHERE assignment_group_id=?`,
          [groupName, ...vals, id],
          (err2) => {
            if (err2) { console.error('[GuestProfile] UPDATE:', err2.message); return res.status(500).send('Errore aggiornamento profilo ospite'); }
            logAction(req.session.user.id, 'edit_guest_profile', 'assignment_group', id, 'Profilo ospite aggiornato');
            res.redirect('/assignment-groups/' + id);
          }
        );
      } else {
        // INSERT — include name per compatibilità con tabelle che hanno name NOT NULL
        db.run(
          `INSERT INTO guest_profiles (assignment_group_id,name,bio,photo_url,category,website,social_instagram,sort_order,featured,active) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, groupName, ...vals],
          (err2) => {
            if (err2) { console.error('[GuestProfile] INSERT:', err2.message); return res.status(500).send('Errore creazione profilo ospite'); }
            logAction(req.session.user.id, 'edit_guest_profile', 'assignment_group', id, 'Profilo ospite creato');
            res.redirect('/assignment-groups/' + id);
          }
        );
      }
    });
  });

  app.post('/assignment-groups/:id/delete', requireAuth, requireOrganizer, (req, res) => {
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
                 (SELECT status FROM passes WHERE participant_id = pa.id AND status!='INVALIDATO' ORDER BY id DESC LIMIT 1) AS last_status,
                 (SELECT id   FROM passes WHERE participant_id = pa.id AND status!='INVALIDATO' ORDER BY id DESC LIMIT 1) AS last_pass_id,
                 (SELECT code FROM passes WHERE participant_id = pa.id AND status!='INVALIDATO' ORDER BY id DESC LIMIT 1) AS ref_code
          FROM participants pa
          WHERE pa.assignment_group_id = ?
          ORDER BY pa.last_name, pa.first_name
        `;
        db.all(sqlParticipants, [id], (err3, participants) => {
          if (err3) return res.status(500).send('Errore DB partecipanti');
          const dupSkipped = req.query.dup_skipped ? parseInt(req.query.dup_skipped, 10) : 0;
        const dupTotal   = req.query.dup_total   ? parseInt(req.query.dup_total,   10) : 0;
        db.all('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name', [], (errZ, zones) => {
          const importOk   = req.query.import_ok   ? parseInt(req.query.import_ok,10)   : null;
          const importSkip = req.query.import_skip ? parseInt(req.query.import_skip,10) : null;
          const importErrs = req.query.import_errs ? decodeURIComponent(req.query.import_errs).split('|') : [];
          const replaceOk  = req.query.replace_ok === '1';
          db.all('SELECT * FROM auto_passes WHERE assignment_group_id=? ORDER BY pass_number',[id],(e_ap,autoPasses)=>{
              // ── CRM data ────────────────────────────────────────────────────
              const _crmQ = (sql, p) => new Promise((ok, ko) => db.all(sql, p, (e, r) => e ? ko(e) : ok(r)));
              Promise.all([
                _crmQ('SELECT * FROM contacts        WHERE assignment_group_id=? ORDER BY is_primary DESC, name', [id]),
                _crmQ('SELECT * FROM payments        WHERE assignment_group_id=? ORDER BY created_at DESC', [id]),
                _crmQ('SELECT * FROM group_documents WHERE assignment_group_id=? ORDER BY uploaded_at DESC', [id]),
                _crmQ('SELECT * FROM guest_profiles  WHERE assignment_group_id=? LIMIT 1', [id]),
                new Promise((ok, ko) => db.get('SELECT * FROM fiscal_data WHERE assignment_group_id=?', [id], (e, r) => e ? ko(e) : ok(r))),
                _crmQ('SELECT * FROM group_material_requests WHERE assignment_group_id=? ORDER BY category, item_name, id', [id]),  // FIX: materials
              ]).then(function([contacts, payments, groupDocs, gpRows, fiscalData, materials]) {
                const guestProfile = gpRows && gpRows[0] ? gpRows[0] : null;
                res.render('assignment_group_detail', {
                  groupInfo, types, participants, PASS_STATUSES,
                  dupSkipped, dupTotal, zones: zones || [],
                  importOk, importSkip, importErrs, replaceOk,
                  autoPasses: autoPasses || [],
                  contacts, payments, groupDocs,
                  guestProfile,
                  fiscalData: fiscalData || null,
                  materials: materials || [],  // FIX: materials
                });
              }).catch(function(err) {
                console.error('detail CRM catch:', err && err.message);
                res.render('assignment_group_detail', {
                  groupInfo, types, participants, PASS_STATUSES,
                  dupSkipped, dupTotal, zones: zones || [],
                  importOk, importSkip, importErrs, replaceOk,
                  autoPasses: autoPasses || [],
                  contacts: [], payments: [], groupDocs: [],
                  guestProfile: null,
                  materials: [],  // FIX: materials
                });
              });
            });
        });
        });
      });
    });
  });


  app.post('/assignment-groups/:id/limit', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { max_passes, admin_password } = req.body;
    if (!admin_password) return res.status(400).send('Password amministratore obbligatoria.');
    db.all("SELECT * FROM users WHERE role = 'admin'", [], (err, adminUsers) => {
      if (err || !adminUsers || !adminUsers.length) return res.status(500).send('Impossibile verificare password amministratore.');
      // ✅ FIX: accetta la password di qualsiasi utente con ruolo 'admin'
      const validAdmin = adminUsers.find(u => bcrypt.compareSync(admin_password, u.password_hash));
      if (!validAdmin) {
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
          db.all("SELECT * FROM users WHERE role = 'admin'", [], (err3, adminUsers) => {
            if (err3 || !adminUsers || !adminUsers.length) return res.status(500).json({ error: 'Impossibile verificare password' });
            const bcrypt = require('bcryptjs');
            // ✅ FIX: accetta la password di qualsiasi utente con ruolo 'admin'
            const validAdmin = adminUsers.find(u => bcrypt.compareSync(admin_password || '', u.password_hash));
            if (!validAdmin) {
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

  app.post('/pass-types', requireAuth, requireOrganizer, upload.single('template'), (req, res) => {
    const { name, description, name_x, name_y, role_x, role_y } = req.body;
    if (!name || !req.file) {
      return res.status(400).send('Nome e PDF template sono obbligatori');
    }
    const templateFile = req.file.filename + path.extname(req.file.originalname || '.pdf');
    const oldPath = req.file.path;
    const newPath = path.join(path.dirname(oldPath), templateFile);
    fs.renameSync(oldPath, newPath);

    db.run(
      `INSERT INTO pass_types (name, description, template_file, name_x, name_y, role_x, role_y, qr_color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        templateFile,
        parseInt(name_x || 100, 10),
        parseInt(name_y || 400, 10),
        parseInt(role_x || 100, 10),
        parseInt(role_y || 370, 10),
        ('#' + (req.body.qr_color || '000000').replace('#','').substring(0,6)),
      ],
      function (err) {
        if (err) return res.status(500).send('Errore salvataggio tipo pass');
        logAction(req.session.user.id, 'create_pass_type', 'pass_type', this.lastID, `Creato tipo pass ${name}`);
        res.redirect('/admin/settings#tipologie');
      }
    );
  });

  app.post('/pass-types/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM pass_types WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).send('Errore eliminazione tipo pass');
      if (this.changes > 0) {
        logAction(req.session.user.id, 'delete_pass_type', 'pass_type', id, 'Tipo pass eliminato');
      }
      res.redirect('/admin/settings#tipologie');
    });
  });

  // ── Colore QR per tipo pass ───────────────────────────────────────
  app.post('/pass-types/:id/qr-color', requireAuth, requireAdmin, (req,res)=>{
    const id    = parseInt(req.params.id,10);
    const color = '#'+(req.body.qr_color||'000000').replace('#','').substring(0,6);
    db.run('UPDATE pass_types SET qr_color=? WHERE id=?',[color,id],function(err){
      if(err) return res.status(500).send('Errore salvataggio colore QR');
      logAction(req.session.user.id,'update_pt_qr_color','pass_type',id,'Colore QR: '+color);
      res.redirect('/admin/settings#tipologie');
    });
  });

  // ── Upload logo QR ─────────────────────────────────────────────
  app.post('/admin/settings/qr-logo', requireAuth, requireAdmin, uploadMemory.single('qr_logo'), (req,res)=>{
    if(!req.file) return res.status(400).send('File richiesto');
    const b64 = req.file.buffer.toString('base64');
    db.run("INSERT OR REPLACE INTO app_settings(key,value) VALUES('qr_logo_b64',?)",[b64],function(err){
      if(err) return res.status(500).send('Errore salvataggio logo QR');
      logAction(req.session.user.id,'update_qr_logo','settings',null,'Logo QR aggiornato');
      res.redirect('/admin/settings#tipologie');
    });
  });

  app.get('/admin/settings/qr-logo/remove', requireAuth, requireAdmin, (req,res)=>{
    db.run("UPDATE app_settings SET value='' WHERE key='qr_logo_b64'",[],function(err){
      if(err) return res.status(500).send('Errore rimozione logo QR');
      logAction(req.session.user.id,'remove_qr_logo','settings',null,'Logo QR rimosso');
      res.redirect('/admin/settings#tipologie');
    });
  });

  app.get('/groups', requireAuth, requireAdmin, (req, res) => {
    res.redirect('/admin/settings#raggruppamenti');
  });

  app.post('/groups', requireAuth, requireOrganizer, (req, res) => {
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
  app.post('/groups/:id/edit', requireAuth, requireOrganizer, (req, res) => {
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

  app.post('/groups/:id/delete', requireAuth, requireOrganizer, (req, res) => {
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
            // ── QR BRANDIZZATO ──────────────────────────
            const qrColorHex = (type.qr_color || '000000').replace('#','');
            const qrLogoRow  = await new Promise(ok =>
              db.get("SELECT value FROM app_settings WHERE key='qr_logo_b64'",[],(_,r)=>ok(r))
            );
            const qrLogoB64 = qrLogoRow && qrLogoRow.value ? qrLogoRow.value : null;

            const png = await bwipjs.toBuffer({
              bcid: 'qrcode',
              text: code,
              scale: 4,
              backgroundcolor: 'FFFFFF',
              barcolor: qrColorHex,
              eclevel: 'H',
            });

            const qrImage = await pdfDoc.embedPng(png);
            const qrSize  = 90;
            const qrX     = centerX - qrSize / 2;
            const qrY     = originY + 65;

            page.drawImage(qrImage, { x:qrX, y:qrY, width:qrSize, height:qrSize });

            // Logo overlay centrato sul QR
            const logoSz = Math.round(qrSize * 0.22);
            const logoX  = qrX + (qrSize - logoSz) / 2;
            const logoY  = qrY + (qrSize - logoSz) / 2;
            // sfondo bianco
            page.drawRectangle({ x:logoX-2, y:logoY-2, width:logoSz+4, height:logoSz+4, color:rgb(1,1,1) });
            if (qrLogoB64) {
              try {
                const logoPng = await pdfDoc.embedPng(Buffer.from(qrLogoB64,'base64'));
                page.drawImage(logoPng, { x:logoX, y:logoY, width:logoSz, height:logoSz });
              } catch(_e) { /* logo non valido — ignora */ }
            } else {
              // fallback: testo "LC" con il colore del QR
              const r16=parseInt(qrColorHex.slice(0,2),16)/255;
              const g16=parseInt(qrColorHex.slice(2,4),16)/255;
              const b16=parseInt(qrColorHex.slice(4,6),16)/255;
              const iFsz=logoSz*0.68;
              const iTxt='LC';
              const iW=boldFont.widthOfTextAtSize(iTxt,iFsz);
              page.drawText(iTxt,{
                x:logoX+(logoSz-iW)/2, y:logoY+(logoSz-iFsz*0.85)/2,
                size:iFsz, font:boldFont, color:rgb(r16,g16,b16)
              });
            }
            // ── Fine QR brandizzato ──

            const codeY = qrY - 18;
            drawCentered(code, 10, regularFont, codeY);

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
                    db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[passId,'GENERATO',userId]);
                    resolve(passId);
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

  
// -------- Trigger: genera pass batch alla chiusura finestra portale --------
async function triggerBatchPassOnClose(groupId) {
  try {
    const group = await dbGet(
      `SELECT ag.id, ag.name, g.passtypeid
       FROM assignmentgroups ag
       LEFT JOIN groups g ON g.id = ag.groupid
       WHERE ag.id = ?`,
      groupId
    );
    if (!group || !group.passtypeid) {
      console.warn(`[batchClose] Gruppo ${groupId} senza passtype — skip`);
      return 0;
    }
    const toGenerate = await dbAll(
      `SELECT id FROM participants
       WHERE assignmentgroupid = ?
         AND id NOT IN (
           SELECT participantid FROM passes WHERE status != 'INVALIDATO'
         )`,
      groupId
    );
    if (!toGenerate.length) return 0;
    let ok = 0, errors = 0;
    for (const p of toGenerate) {
      try {
        await generatePassForParticipant(p.id, group.passtypeid, null);
        ok++;
      } catch (e) {
        console.error(`[batchClose] Errore pass ${p.id}:`, e.message);
        errors++;
      }
    }
    createNotification(
      'batchpass', 'Pass generati automaticamente',
      `Chiusura portale gruppo <strong>${group.name}</strong>: generati <strong>${ok}</strong> pass${errors ? `, ${errors} errori` : ''}.`,
      'assignmentgroup', groupId
    );
    logAction(null, 'batch_pass_on_close', 'assignmentgroup', groupId,
      `Trigger chiusura finestra: ${ok} pass generati, ${errors} errori`);
    return ok;
  } catch (e) {
    console.error('[triggerBatchPassOnClose] Errore:', e.message);
    return 0;
  }
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
    db.get('SELECT pdf_file, status FROM passes WHERE id = ?', [id], (err, pass) => {
      if (err || !pass || !pass.pdf_file) {
        return res.status(404).send('Pass non trovato');
      }
      const filePath = path.join(process.env.DATA_DIR || __dirname, 'generated', pass.pdf_file);
      // Imposta SCARICATO solo se il pass è ancora in stato GENERATO (prima apertura)
      if (pass.status === 'GENERATO') {
        const uid = req.session && req.session.user ? req.session.user.id : null;
        db.run('UPDATE passes SET status=\'SCARICATO\' WHERE id=? AND status=\'GENERATO\'',[id]);
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[id,'SCARICATO',uid]);
      }
      res.sendFile(filePath);
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
    if (status === 'GENERATO') return res.status(400).send('Lo stato GENERATO non può essere riassegnato manualmente.');
    db.run('UPDATE passes SET status = ? WHERE id = ? AND status != \'INVALIDATO\' AND status != \'GENERATO\'', [status, id], function (err) {
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

  // ✅ FIX: refactored con async/await + Promise.all (parallelizza 7 query)
  app.get('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [groups, types, zones, users, smtpRows, scanAttempts, apRows, portalGroups] = await Promise.all([
        dbAll(`SELECT g.id, g.name, g.priority, g.pass_type_id, pt.name AS pass_type_name
               FROM groups g LEFT JOIN pass_types pt ON pt.id = g.pass_type_id
               ORDER BY g.priority ASC, g.name ASC`),
        dbAll('SELECT * FROM pass_types ORDER BY id DESC'),
        dbAll('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name'),
        dbAll('SELECT id, username, role, created_at FROM users ORDER BY username ASC'),
        dbAll("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'"),
        dbAll('SELECT sa.*, u.username FROM scan_attempts sa LEFT JOIN users u ON u.id=sa.user_id ORDER BY sa.id DESC LIMIT 500'),
        dbAll('SELECT * FROM app_settings'),
        dbAll(`SELECT ag.id, ag.name, ag.portal_open_from, ag.portal_open_until,
               (SELECT COUNT(*) FROM participants WHERE assignment_group_id=ag.id) AS n_participants
               FROM assignment_groups ag WHERE ag.portal_enabled=1 ${edFilter()} ORDER BY ag.name`)
      ]);
      const smtp = Object.fromEntries((smtpRows||[]).map(r => [r.key, r.value]));
      const apSettings = Object.fromEntries((apRows||[]).map(r => [r.key, r.value]));
      db.all('SELECT * FROM editions ORDER BY year DESC', [], function(errEd, editions) {
        res.render('admin_settings', { groups, types, zones, users, smtp, scanAttempts: scanAttempts||[], apSettings, portalGroups: portalGroups||[], editions: editions||[] });
      });
    } catch (err) {
      console.error('Errore /admin/settings:', err);
      res.status(500).send('Errore interno del server');
    }
  });


  // -------- Finestra globale Portali Espositori --------

  app.get('/admin/settings/portal-window', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [apRows, groups] = await Promise.all([
        dbAll("SELECT key,value FROM app_settings WHERE key IN ('portal_window_from','portal_window_until')"),
        dbAll(`SELECT ag.id, ag.name, ag.portal_open_from, ag.portal_open_until,
               (SELECT COUNT(*) FROM participants WHERE assignment_group_id=ag.id) AS n_participants
               FROM assignment_groups ag WHERE ag.portal_enabled=1 ${edFilter()} ORDER BY ag.name`)
      ]);
      const pw = Object.fromEntries((apRows||[]).map(r => [r.key, r.value]));
      res.render('portal_window', {
        currentUser: req.session.user,
        pw,
        groups: groups || [],
        saved: req.query.saved === '1'
      });
    } catch (err) {
      console.error('[PortalWindow GET]', err.message);
      res.status(500).send('Errore interno del server');
    }
  });

  app.post('/admin/settings/portal-window', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { portal_window_from, portal_window_until, apply_to_all } = req.body;
      const groupIds = [].concat(req.body.group_ids || []).map(Number).filter(Boolean);
      const fromVal  = portal_window_from  || '';
      const untilVal = portal_window_until || '';

      await dbRun("INSERT OR REPLACE INTO app_settings(key,value) VALUES('portal_window_from',?)",  [fromVal]);
      await dbRun("INSERT OR REPLACE INTO app_settings(key,value) VALUES('portal_window_until',?)", [untilVal]);

      if (apply_to_all === '1') {
        await dbRun(
          `UPDATE assignment_groups SET portal_open_from=?, portal_open_until=? WHERE portal_enabled=1 ${edFilter()}`,
          [fromVal || null, untilVal || null]
        );
        logAction(req.session.user.id, 'portal_window_all', 'settings', null,
          `Finestra portali impostata globalmente: ${fromVal||'—'} → ${untilVal||'—'}`);
      } else if (groupIds.length > 0) {
        const placeholders = groupIds.map(() => '?').join(',');
        await dbRun(
          `UPDATE assignment_groups SET portal_open_from=?, portal_open_until=? WHERE id IN (${placeholders})`,
          [fromVal || null, untilVal || null, ...groupIds]
        );
        logAction(req.session.user.id, 'portal_window_select', 'settings', null,
          `Finestra portali aggiornata per ${groupIds.length} stand: ${fromVal||'—'} → ${untilVal||'—'}`);
      } else {
        logAction(req.session.user.id, 'portal_window_global', 'settings', null,
          `Finestra globale aggiornata: ${fromVal||'—'} → ${untilVal||'—'}`);
      }

      res.redirect('/admin/settings/portal-window?saved=1');
    } catch (err) {
      console.error('[PortalWindow POST]', err.message);
      res.status(500).send('Errore salvataggio finestra portali');
    }
  });

  app.post('/admin/zones', requireAuth, requireOrganizer, (req, res) => {
    const { name, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      'INSERT INTO zones (name, sort_order, zone_scope) VALUES (?, ?, \'internal\')',
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

  app.post('/admin/zones/:id/delete', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run('DELETE FROM zones WHERE id = ?', [id], function(err) {
      if (err) return res.status(500).send('Errore eliminazione zona');
      logAction(req.session.user.id, 'delete_zone', 'zone', id, 'Zona eliminata');
      res.redirect('/admin/settings#zone');
    });
  });



  // -------- Gestione Mappa Pubblica --------

  app.get('/admin/zone-manager', requireAuth, requireOrganizer, (req, res) => {
    db.all("SELECT * FROM zones WHERE zone_scope = 'public' ORDER BY sort_order, name", [], (err, zones) => {
      if (err) return res.status(500).send('Errore DB zone mappa pubblica');
      res.render('admin_map', { zones: zones || [], flash: req.query.flash || null });
    });
  });

  app.post('/admin/mappa-pubblica/zone/new', requireAuth, requireOrganizer, (req, res) => {
    const { name, map_label, map_type, map_lat, map_lng, map_zoom, map_desc, map_address, map_tags, map_color, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Nome zona obbligatorio');
    db.run(
      "INSERT INTO zones (name, sort_order, map_label, map_type, map_lat, map_lng, map_zoom, map_desc, map_address, map_tags, map_color, map_active, zone_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'public')",
      [name.trim(), parseInt(sort_order||0,10), map_label||null, map_type||'area',
       map_lat ? parseFloat(map_lat) : null, map_lng ? parseFloat(map_lng) : null,
       parseInt(map_zoom||16,10), map_desc||null, map_address||null, map_tags||null, map_color||null],
      function(err) {
        if (err) return res.status(500).send('Errore salvataggio zona mappa: ' + err.message);
        logAction(req.session.user.id, 'create_public_zone', 'zone', this.lastID, 'Creata zona pubblica: ' + name.trim());
        res.redirect('/admin/zone-manager?flash=created');
      }
    );
  });

  app.post('/admin/mappa-pubblica/zone/:id', requireAuth, requireOrganizer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const action = req.body._action || 'save';
    if (action === 'delete') {
      db.run('DELETE FROM zones WHERE id = ? AND zone_scope = \'public\'', [id], function(err) {
        if (err) return res.status(500).send('Errore eliminazione zona mappa');
        logAction(req.session.user.id, 'delete_public_zone', 'zone', id, 'Zona mappa pubblica eliminata');
        res.redirect('/admin/zone-manager?flash=deleted');
      });
    } else {
      const { name, map_label, map_type, map_lat, map_lng, map_zoom, map_desc, map_address, map_tags, map_color, map_active, sort_order } = req.body;
      db.run(
        "UPDATE zones SET name=?, sort_order=?, map_label=?, map_type=?, map_lat=?, map_lng=?, map_zoom=?, map_desc=?, map_address=?, map_tags=?, map_color=?, map_active=? WHERE id=? AND zone_scope='public'",
        [name, parseInt(sort_order||0,10), map_label||null, map_type||'area',
         map_lat ? parseFloat(map_lat) : null, map_lng ? parseFloat(map_lng) : null,
         parseInt(map_zoom||16,10), map_desc||null, map_address||null, map_tags||null,
         map_color||null, map_active ? 1 : 0, id],
        function(err) {
          if (err) return res.status(500).send('Errore aggiornamento zona mappa');
          logAction(req.session.user.id, 'edit_public_zone', 'zone', id, 'Zona mappa pubblica aggiornata');
          res.redirect('/admin/zone-manager?flash=saved');
        }
      );
    }
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


  // ══════════════════════════════════════════════
  // IMPORT CSV — flusso Preview → Confirm → Undo
  // ══════════════════════════════════════════════
  function _parseCsvBuffer(buf){var wb=XLSX.read(buf,{type:'buffer'});var rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});return rows.map(function(r){var c={};Object.keys(r).forEach(function(k){c[k.replace(/^\uFEFF/,'')]=r[k];});return c;});}

  app.get('/import',requireAuth,requireOrganizer,function(req,res){
    db.all(`SELECT ag.id,ag.name,g.name AS cat FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id WHERE (1=1) ${edFilter()} ORDER BY g.name,ag.name`,[],function(err,groups){
      db.get("SELECT value FROM app_settings WHERE key='last_import_batch_id'",[],function(e2,bRow){
        db.get("SELECT value FROM app_settings WHERE key='last_import_batch_gid'",[],function(e3,gRow){
          db.get("SELECT value FROM app_settings WHERE key='last_import_batch_ok'",[],function(e4,okRow){
            res.render('import',{groups:groups||[],result:null,lastBatch:bRow?{batchId:bRow.value,gid:gRow&&gRow.value,ok:okRow&&okRow.value}:null});
          });
        });
      });
    });
  });

  app.get('/import/template.csv',requireAuth,function(req,res){res.setHeader('Content-Type','text/csv;charset=utf-8');res.setHeader('Content-Disposition','attachment;filename="template_import.csv"');res.send('cognome;nome;email;ruolo\nRossi;Marco;marco@ex.com;Espositore\n');});

  // PREVIEW — parse + salva temp file + controlla duplicati (nessuna scrittura DB)
  app.post('/import/preview',requireAuth,requireOrganizer,uploadMemory.single('file'),function(req,res){
    var gid=parseInt(req.body.group_id,10);
    if(!gid||!req.file)return res.json({error:'Seleziona gruppo e file'});
    var rows;try{rows=_parseCsvBuffer(req.file.buffer);}catch(e){return res.json({error:'Errore parsing: '+e.message});}
    if(!rows||!rows.length)return res.json({error:'File vuoto o non leggibile'});
    var tempId=require('crypto').randomBytes(12).toString('hex');
    var tempPath=path.join(process.env.DATA_DIR||__dirname,'generated','import_temp_'+tempId);
    try{fs.writeFileSync(tempPath,req.file.buffer);}catch(e){return res.json({error:'Errore salvataggio temp: '+e.message});}
    db.all('SELECT LOWER(first_name) AS fn,LOWER(last_name) AS ln FROM participants WHERE assignment_group_id=?',[gid],function(err,existing){
      var exSet={};if(!err&&existing)existing.forEach(function(e){exSet[e.fn+'|'+e.ln]=1;});
      var seenFile={},total=rows.length,willImport=0,willSkip=0;
      var preview=[];
      rows.forEach(function(r,i){
        var last=(r.cognome||r.Cognome||'').toString().trim();
        var first=(r.nome||r.Nome||'').toString().trim();
        var email=(r.email||r.Email||'').toString().trim();
        var role=(r.ruolo||r.Ruolo||'Espositore').toString().trim();
        var issues=[];
        if(!last&&!first)issues.push('Nome e cognome mancanti');
        else{if(!last)issues.push('Cognome mancante');if(!first)issues.push('Nome mancante');}
        var key=(first+'|'+last).toLowerCase();
        if(seenFile[key])issues.push('Duplicato nel file');else seenFile[key]=1;
        var inDb=exSet[key]||false;
        if(inDb)issues.push('Già presente nel gruppo');
        var willAdd=issues.length===0;
        if(willAdd)willImport++;else willSkip++;
        if(i<10)preview.push({row:i+2,last,first,email,role,issues,ok:willAdd});
      });
      res.json({tempId,gid,total,willImport,willSkip,preview,hasMore:rows.length>10});
    });
  });

  // CONFIRM — legge temp file e importa con batch_id
  app.post('/import/confirm',requireAuth,requireOrganizer,function(req,res){
    var tempId=req.body.temp_id,gid=parseInt(req.body.group_id,10);
    if(!tempId||!gid)return res.status(400).send('Dati mancanti');
    var tempPath=path.join(process.env.DATA_DIR||__dirname,'generated','import_temp_'+tempId);
    if(!fs.existsSync(tempPath))return res.status(400).send('Sessione scaduta: ricaricare il file');
    var buf;try{buf=fs.readFileSync(tempPath);}catch(e){return res.status(500).send('Errore lettura temp');}
    var rows;try{rows=_parseCsvBuffer(buf);}catch(e){return res.status(400).send('Errore parsing: '+e.message);}
    try{fs.unlinkSync(tempPath);}catch(e){}
    if(!rows||!rows.length)return res.status(400).send('File vuoto');
    var batchId=require('crypto').randomBytes(8).toString('hex')+'_'+Date.now();
    var ok=0,skip=0,errors=[],seen={};
    function ins(i){
      if(i>=rows.length){
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('last_import_batch_id',?)",[batchId]);
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('last_import_batch_gid',?)",[String(gid)]);
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('last_import_batch_ok',?)",[String(ok)]);
        if(errors.length){
          var eFile=path.join(process.env.DATA_DIR||__dirname,'generated','import_errors_'+batchId+'.csv');
          try{fs.writeFileSync(eFile,'\xEF\xBB\xBFriga;cognome;nome;email;motivo\n'+errors.map(function(e){return e.csv;}).join('\n'),'utf8');}catch(ex){}
        }
        logAction(req.session.user.id,'import_csv','import',gid,'Import '+ok+' nel gruppo #'+gid+' (batch:'+batchId+')');
        createNotification('import','Import CSV','Importati <strong>'+ok+'</strong> nel gruppo #'+gid+'. Saltati: '+skip+'.','group',gid);
        return db.all(`SELECT ag.id,ag.name,g.name AS cat FROM assignment_groups ag LEFT JOIN groups g ON g.id=ag.group_id WHERE (1=1) ${edFilter()} ORDER BY g.name,ag.name`,[],function(e,groups){
          res.render('import',{groups:groups||[],lastBatch:null,result:{ok,skip,errors:errors.map(function(e){return e.msg;}),batchId,gid,hasErrors:errors.length>0}});
        });
      }
      var r=rows[i];
      var last=(r.cognome||r.Cognome||'').toString().trim(),first=(r.nome||r.Nome||'').toString().trim();
      var email=(r.email||r.Email||'').toString().trim().toLowerCase(),role=(r.ruolo||r.Ruolo||'Espositore').toString().trim();
      if(!last&&!first){errors.push({msg:'Riga '+(i+2)+': nome e cognome mancanti',csv:(i+2)+';;;Nome e cognome mancanti'});skip++;return ins(i+1);}
      var key=(first+'|'+last).toLowerCase();
      if(seen[key]){errors.push({msg:'Riga '+(i+2)+': '+last+' '+first+' — duplicato nel file',csv:(i+2)+';'+last+';'+first+';'+email+';Duplicato nel file'});skip++;return ins(i+1);}
      seen[key]=1;
      db.get('SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',[first.toLowerCase(),last.toLowerCase(),gid],function(e,dup){
        if(dup){errors.push({msg:'Riga '+(i+2)+': '+last+' '+first+' — già presente',csv:(i+2)+';'+last+';'+first+';'+email+';Già presente nel gruppo'});skip++;return ins(i+1);}
        db.run('INSERT INTO participants(first_name,last_name,email,role,assignment_group_id,import_batch_id)VALUES(?,?,?,?,?,?)',[first,last,email||null,role,gid,batchId],function(e2){
          if(e2){errors.push({msg:'Riga '+(i+2)+': errore DB — '+e2.message,csv:(i+2)+';'+last+';'+first+';'+email+';Errore DB: '+e2.message});skip++;}else ok++;
          ins(i+1);
        });
      });
    }
    ins(0);
  });


  // CONFIRM-AJAX — restituisce JSON (usato dal modal nel detail gruppo)
  app.post('/import/confirm-ajax',requireAuth,requireOrganizer,function(req,res){
    var tempId=req.body.temp_id,gid=parseInt(req.body.group_id,10);
    if(!tempId||!gid)return res.json({error:'Dati mancanti'});
    var tempPath=path.join(process.env.DATA_DIR||__dirname,'generated','import_temp_'+tempId);
    if(!fs.existsSync(tempPath))return res.json({error:'Sessione scaduta: ricaricare il file'});
    var buf;try{buf=fs.readFileSync(tempPath);}catch(e){return res.json({error:'Errore lettura temp'});}
    var rows;try{rows=_parseCsvBuffer(buf);}catch(e){return res.json({error:'Errore parsing: '+e.message});}
    try{fs.unlinkSync(tempPath);}catch(e){}
    if(!rows||!rows.length)return res.json({error:'File vuoto'});
    var batchId=require('crypto').randomBytes(8).toString('hex')+'_'+Date.now();
    var ok=0,skip=0,errors=[],seen={};
    function ins(i){
      if(i>=rows.length){
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('last_import_batch_id',?)",[batchId]);
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('last_import_batch_gid',?)",[String(gid)]);
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('last_import_batch_ok',?)",[String(ok)]);
        if(errors.length){var eFile=path.join(process.env.DATA_DIR||__dirname,'generated','import_errors_'+batchId+'.csv');
          try{fs.writeFileSync(eFile,'\xEF\xBB\xBFriga;cognome;nome;email;motivo\n'+errors.map(function(e){return e.csv;}).join('\n'),'utf8');}catch(ex){}}
        logAction(req.session.user.id,'import_csv','import',gid,'Import '+ok+' nel gruppo #'+gid+' (batch:'+batchId+')');
        createNotification('import','Import CSV','Importati <strong>'+ok+'</strong> nel gruppo #'+gid+'. Saltati: '+skip+'.','group',gid);
        return res.json({ok:true,imported:ok,skipped:skip,batchId,hasErrors:errors.length>0,errors:errors.map(function(e){return e.msg;})});
      }
      var r=rows[i];
      var last=(r.cognome||r.Cognome||'').toString().trim(),first=(r.nome||r.Nome||'').toString().trim();
      var email=(r.email||r.Email||'').toString().trim().toLowerCase(),role=(r.ruolo||r.Ruolo||'Espositore').toString().trim();
      if(!last&&!first){errors.push({msg:'Riga '+(i+2)+': nome e cognome mancanti',csv:(i+2)+';;;Nome e cognome mancanti'});skip++;return ins(i+1);}
      var key=(first+'|'+last).toLowerCase();
      if(seen[key]){errors.push({msg:'Riga '+(i+2)+': '+last+' '+first+' duplicato nel file',csv:(i+2)+';'+last+';'+first+';'+email+';Duplicato nel file'});skip++;return ins(i+1);}
      seen[key]=1;
      db.get('SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',[first.toLowerCase(),last.toLowerCase(),gid],function(e,dup){
        if(dup){errors.push({msg:'Riga '+(i+2)+': '+last+' '+first+' già presente',csv:(i+2)+';'+last+';'+first+';'+email+';Già presente nel gruppo'});skip++;return ins(i+1);}
        db.run('INSERT INTO participants(first_name,last_name,email,role,assignment_group_id,import_batch_id)VALUES(?,?,?,?,?,?)',[first,last,email||null,role,gid,batchId],function(e2){
          if(e2){errors.push({msg:'Riga '+(i+2)+': errore DB',csv:(i+2)+';'+last+';'+first+';'+email+';Errore DB: '+e2.message});skip++;}else ok++;
          ins(i+1);
        });
      });
    }
    ins(0);
  });
  // UNDO — cancella tutto l'ultimo batch (inclusi i loro pass)
  app.post('/import/undo',requireAuth,requireOrganizer,function(req,res){
    db.get("SELECT value FROM app_settings WHERE key='last_import_batch_id'",[],function(e,row){
      if(e||!row)return res.json({error:'Nessun import recente da annullare'});
      var batchId=row.value;
      db.all('SELECT id FROM participants WHERE import_batch_id=?',[batchId],function(e2,parts){
        var pids=(parts||[]).map(function(p){return p.id;});
        function finish(){
          db.run('DELETE FROM participants WHERE import_batch_id=?',[batchId],function(e3){
            var deleted=this.changes;
            db.run("DELETE FROM app_settings WHERE key IN ('last_import_batch_id','last_import_batch_gid','last_import_batch_ok')",function(){
              logAction(req.session.user.id,'import_undo','import',null,'Undo batch '+batchId+' — eliminati '+deleted+' partecipanti');
              res.json({ok:true,deleted});
            });
          });
        }
        if(!pids.length)return finish();
        var ph=pids.map(function(){return '?';}).join(',');
        db.run('DELETE FROM passes WHERE participant_id IN ('+ph+')',pids,function(){finish();});
      });
    });
  });

  // ERRORI CSV — scarica file errori dell'ultimo import
  app.get('/import/errors.csv',requireAuth,requireOrganizer,function(req,res){
    db.get("SELECT value FROM app_settings WHERE key='last_import_batch_id'",[],function(e,row){
      if(e||!row)return res.status(404).send('Nessun file errori disponibile');
      var eFile=path.join(process.env.DATA_DIR||__dirname,'generated','import_errors_'+row.value+'.csv');
      if(!fs.existsSync(eFile))return res.status(404).send('File errori non trovato (nessun record saltato?)');
      res.setHeader('Content-Type','text/csv;charset=utf-8');
      res.setHeader('Content-Disposition','attachment;filename="errori_import.csv"');
      res.sendFile(eFile);
    });
  });
  app.post('/passes/:id/replace',requireAuth,requireNotViewer,function(req,res){
    var oldId=parseInt(req.params.id,10);
    db.get(`SELECT p.*,pt.name AS type_name,pa.first_name,pa.last_name,pa.assignment_group_id FROM passes p JOIN pass_types pt ON pt.id=p.pass_type_id JOIN participants pa ON pa.id=p.participant_id WHERE p.id=? AND p.status!='INVALIDATO'`,[oldId],function(err,old){
      if(err||!old)return res.status(404).send('Pass non trovato o già invalidato');
      db.run("UPDATE passes SET status='INVALIDATO' WHERE id=?",[oldId]);
      db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[oldId,'INVALIDATO',req.session.user.id]);
      generatePassForParticipant(old.participant_id,old.pass_type_id,req.session.user.id)
        .then(function(nid){
          db.run('UPDATE passes SET replaced_by=? WHERE id=?',[nid,oldId]);
          logAction(req.session.user.id,'replace_pass','pass',oldId,'Pass #'+oldId+' -> #'+nid);
          createNotification('replace','Pass sostituito','Pass #'+oldId+' di <strong>'+old.first_name+' '+old.last_name+'</strong> → nuovo #'+nid+'.','pass',nid);
          var gid=old.assignment_group_id;
          if(gid) return res.redirect('/assignment-groups/'+gid+'?replace_ok=1');
          res.redirect('/passes?replaced='+nid);
        })
        .catch(function(e){res.status(500).send('Errore generazione pass: '+(e.message||e));});
    });
  });
  app.post('/admin/groups/:id/portal/token',requireAuth,requireNotViewer,function(req,res){var id=parseInt(req.params.id,10),token=require('crypto').randomBytes(24).toString('hex');db.run('UPDATE assignment_groups SET portal_token=?,portal_enabled=1 WHERE id=?',[token,id],function(err){if(err)return res.status(500).json({error:err.message});res.json({token});});});
  app.post('/admin/groups/:id/portal/toggle',requireAuth,requireNotViewer,function(req,res){var id=parseInt(req.params.id,10);db.get('SELECT portal_enabled FROM assignment_groups WHERE id=?',[id],function(e,row){if(!row)return res.status(404).json({error:'not found'});var v=row.portal_enabled?0:1;db.run('UPDATE assignment_groups SET portal_enabled=? WHERE id=?',[v,id],function(){res.json({enabled:v});});});});


  // ── Toggle sezioni portale: nominativi, docs, servizi ──────────────
  app.post('/admin/groups/:id/portal/nom-toggle', requireAuth, requireNotViewer, function(req, res) {
    var id = parseInt(req.params.id, 10);
    db.get('SELECT portal_nom_enabled FROM assignment_groups WHERE id=?', [id], function(e, row) {
      if (!row) return res.status(404).json({ error: 'not found' });
      var v = row.portal_nom_enabled ? 0 : 1;
      db.run('UPDATE assignment_groups SET portal_nom_enabled=? WHERE id=?', [v, id], function() {
        res.json({ enabled: v });
      });
    });
  });

  app.post('/admin/groups/:id/portal/docs-toggle', requireAuth, requireNotViewer, function(req, res) {
    var id = parseInt(req.params.id, 10);
    db.get('SELECT portal_docs_enabled FROM assignment_groups WHERE id=?', [id], function(e, row) {
      if (!row) return res.status(404).json({ error: 'not found' });
      var v = row.portal_docs_enabled ? 0 : 1;
      db.run('UPDATE assignment_groups SET portal_docs_enabled=? WHERE id=?', [v, id], function() {
        res.json({ enabled: v });
      });
    });
  });

  app.post('/admin/groups/:id/portal/service-toggle', requireAuth, requireNotViewer, function(req, res) {
    var id = parseInt(req.params.id, 10);
    db.get('SELECT portal_service_enabled FROM assignment_groups WHERE id=?', [id], function(e, row) {
      if (!row) return res.status(404).json({ error: 'not found' });
      var v = row.portal_service_enabled ? 0 : 1;
      db.run('UPDATE assignment_groups SET portal_service_enabled=? WHERE id=?', [v, id], function() {
        res.json({ enabled: v });
      });
    });
  });
  // ═══════════════════════════════════════════════════════════════
  // BACHECA COMUNICAZIONI
  // ═══════════════════════════════════════════════════════════════

  // GET  /admin/bacheca — pagina di gestione comunicazioni (admin only)

  // ══════════════════════════════════════════════════════════════
  // MODULO 7 — SERVIZI & LOGISTICA
  // ══════════════════════════════════════════════════════════════

  // ── Admin: lista richieste servizi ──────────────────────────
  app.get('/admin/logistica', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const requests   = await dbAll(`
        SELECT sr.*, sr.service_type AS type, ag.name AS group_name
        FROM service_requests sr
        LEFT JOIN assignment_groups ag ON ag.id = sr.assignment_group_id
        ORDER BY sr.requested_at DESC
      `);
      const equipment  = await dbAll(`SELECT * FROM equipment ORDER BY category, name`);
      const loans      = await dbAll(`
        SELECT el.*, e.name AS equipment_name, e.category,
               ag.name AS group_name
        FROM equipment_loans el
        JOIN equipment e ON e.id = el.equipment_id
        LEFT JOIN assignment_groups ag ON ag.id = el.assignment_group_id
        ORDER BY el.loaned_at DESC
      `);
      const groups = await dbAll(`SELECT id, name FROM assignment_groups ORDER BY name`);
      const materialTypes = await dbAll(`SELECT * FROM logistic_categories ORDER BY sort_order, label`);
      const storageLocations = await dbAll(`SELECT * FROM logistic_locations ORDER BY sort_order, label`);
      res.render('admin-logistica', { requests, equipment, loans, groups, materialTypes, storageLocations, saved: req.query.saved || null });
    } catch(err) {
      console.error('Errore /admin/logistica:', err);
      res.status(500).send('Errore interno');
    }
  });

  // ── Admin: aggiorna status richiesta servizio ────────────────
  app.post('/admin/logistica/requests/:id/status', requireAuth, requireOrganizer, async (req, res) => {
    const { status } = req.body;
    const id = parseInt(req.params.id, 10);
    try {
      await dbRun(
        `UPDATE service_requests SET status=?, updated_at=datetime('now','localtime') WHERE id=?`,
        [status, id]
      );
      logAction(req.session.user.id,'update_logistica_request','service_request',id,`Stato richiesta #${id} → ${status}`);
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: elimina richiesta servizio ───────────────────────
  app.delete('/admin/logistica/requests/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM service_requests WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id,'delete_logistica_request','service_request',parseInt(req.params.id,10),'Richiesta servizio eliminata');
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: aggiungi attrezzatura al catalogo ─────────────────
  app.post('/admin/logistica/equipment', requireAuth, requireOrganizer, async (req, res) => {
    const { name, category, total_qty, notes, location, location_custom } = req.body;
    if (!name) return res.redirect('/admin/logistica?saved=err');
    const loc = location || null;
    const locCustom = (location === 'altro' && location_custom) ? location_custom.trim() : null;
    try {
      await dbRun(
        `INSERT INTO equipment (name, category, total_qty, notes, location, location_custom) VALUES (?,?,?,?,?,?)`,
        [name.trim(), category || null, parseInt(total_qty, 10) || 1, notes || null, loc, locCustom]
      );
      logAction(req.session.user.id,'create_equipment','equipment',null,`Attrezzatura aggiunta: ${name.trim()}`);
      res.redirect('/admin/logistica?saved=equipment');
    } catch(err) {
      console.error(err);
      res.redirect('/admin/logistica?saved=err');
    }
  });

  // ── Admin: modifica attrezzatura ─────────────────────────────
  app.post('/admin/logistica/equipment/:id/edit', requireAuth, requireOrganizer, async (req, res) => {
    const { name, category, total_qty, notes, location, location_custom } = req.body;
    const id = parseInt(req.params.id, 10);
    const loc = location || null;
    const locCustom = (location === 'altro' && location_custom) ? location_custom.trim() : null;
    try {
      await dbRun(
        `UPDATE equipment SET name=?, category=?, total_qty=?, notes=?, location=?, location_custom=? WHERE id=?`,
        [name.trim(), category || null, parseInt(total_qty, 10) || 1, notes || null, loc, locCustom, id]
      );
      res.json({ ok: true });
      logAction(req.session.user.id,'edit_equipment','equipment',id,`Attrezzatura #${id} aggiornata`);
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: elimina attrezzatura ──────────────────────────────
  app.delete('/admin/logistica/equipment/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM equipment WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id,'delete_equipment','equipment',parseInt(req.params.id,10),'Attrezzatura eliminata dal catalogo');
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: registra prestito ─────────────────────────────────
  app.post('/admin/logistica/loans', requireAuth, requireOrganizer, async (req, res) => {
    const { equipment_id, assignment_group_id, qty, notes } = req.body;
    if (!equipment_id) return res.redirect('/admin/logistica?saved=err');
    try {
      await dbRun(
        `INSERT INTO equipment_loans (equipment_id, assignment_group_id, qty, loaned_at, notes)
         VALUES (?,?,?,datetime('now','localtime'),?)`,
        [parseInt(equipment_id, 10),
         assignment_group_id ? parseInt(assignment_group_id, 10) : null,
         parseInt(qty, 10) || 1,
         notes || null]
      );
      res.redirect('/admin/logistica?saved=loan');
    } catch(err) {
      console.error(err);
      res.redirect('/admin/logistica?saved=err');
    }
  });

  // ── Admin: segna riconsegna ──────────────────────────────────
  app.post('/admin/logistica/loans/:id/return', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(
        `UPDATE equipment_loans SET returned_at=datetime('now','localtime') WHERE id=?`,
        [parseInt(req.params.id, 10)]
      );
      res.json({ ok: true });
      logAction(req.session.user.id,'return_loan','loan',parseInt(req.params.id,10),'Prestito #'+req.params.id+' riconsegnato');
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: elimina prestito ──────────────────────────────────
  app.delete('/admin/logistica/loans/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM equipment_loans WHERE id=?`, [parseInt(req.params.id, 10)]);
      res.json({ ok: true });
      logAction(req.session.user.id,'delete_loan','loan',parseInt(req.params.id,10),'Prestito #'+req.params.id+' eliminato');
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });


  // ── Admin: impostazioni logistica — tipologie ────────────────
  app.post('/admin/logistica/settings/category', requireAuth, requireOrganizer, async (req, res) => {
    const { label, icon } = req.body;
    const cleanLabel = (label || '').trim();
    if (!cleanLabel) return res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    const key = cleanLabel.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    try {
      const row = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM logistic_categories`);
      await dbRun(
        `INSERT INTO logistic_categories (key_name, label, icon, sort_order) VALUES (?,?,?,?)`,
        [key, cleanLabel, (icon || '📦').trim() || '📦', row.next || 10]
      );
      res.redirect('/admin/logistica?tab=impostazioni&saved=category');
      logAction(req.session.user.id,'create_logistica_category','logistica_category',null,`Tipologia creata: ${cl}`);
    } catch(err) {
      console.error(err);
      res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    }
  });

  app.delete('/admin/logistica/settings/category/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM logistic_categories WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id,'delete_logistica_category','logistica_category',+req.params.id,'Tipologia materiale eliminata');
      res.json({ ok: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin: impostazioni logistica — posizioni ─────────────────
  app.post('/admin/logistica/settings/location', requireAuth, requireOrganizer, async (req, res) => {
    const { label, icon } = req.body;
    const cleanLabel = (label || '').trim();
    if (!cleanLabel) return res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    const key = cleanLabel.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    try {
      const row = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM logistic_locations`);
      await dbRun(
        `INSERT INTO logistic_locations (key_name, label, icon, sort_order) VALUES (?,?,?,?)`,
        [key, cleanLabel, (icon || '📍').trim() || '📍', row.next || 10]
      );
      res.redirect('/admin/logistica?tab=impostazioni&saved=location');
      logAction(req.session.user.id,'create_logistica_location','logistica_location',null,`Posizione creata: ${cl}`);
    } catch(err) {
      console.error(err);
      res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    }
  });

  app.delete('/admin/logistica/settings/location/:id', requireAuth, requireOrganizer, async (req, res) => {
    try {
      await dbRun(`DELETE FROM logistic_locations WHERE id=?`, [parseInt(req.params.id, 10)]);
      logAction(req.session.user.id,'delete_logistica_location','logistica_location',+req.params.id,'Posizione inventario eliminata');
      res.json({ ok: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });


  // ─── Impostazioni logistica ────────────────────────────────────
  app.post('/admin/logistica/settings/category', requireAuth, requireOrganizer, async (req, res) => {
    const { label, icon } = req.body;
    const cl = (label||'').trim();
    if (!cl) return res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    const key = cl.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    try {
      const r = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM logistic_categories`);
      await dbRun(`INSERT INTO logistic_categories (key_name,label,icon,sort_order) VALUES (?,?,?,?)`,
        [key,cl,(icon||'📦').trim()||'📦',r.n||10]);
      res.redirect('/admin/logistica?tab=impostazioni&saved=category');
    } catch(e){ res.redirect('/admin/logistica?tab=impostazioni&saved=err'); }
  });
  app.delete('/admin/logistica/settings/category/:id', requireAuth, requireOrganizer, async (req,res) => {
    try { await dbRun(`DELETE FROM logistic_categories WHERE id=?`,[+req.params.id]); res.json({ok:true}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });
  app.post('/admin/logistica/settings/location', requireAuth, requireOrganizer, async (req, res) => {
    const { label, icon } = req.body;
    const cl = (label||'').trim();
    if (!cl) return res.redirect('/admin/logistica?tab=impostazioni&saved=err');
    const key = cl.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    try {
      const r = await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM logistic_locations`);
      await dbRun(`INSERT INTO logistic_locations (key_name,label,icon,sort_order) VALUES (?,?,?,?)`,
        [key,cl,(icon||'📍').trim()||'📍',r.n||10]);
      res.redirect('/admin/logistica?tab=impostazioni&saved=location');
    } catch(e){ res.redirect('/admin/logistica?tab=impostazioni&saved=err'); }
  });
  app.delete('/admin/logistica/settings/location/:id', requireAuth, requireOrganizer, async (req,res) => {
    try { await dbRun(`DELETE FROM logistic_locations WHERE id=?`,[+req.params.id]); res.json({ok:true}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });

  // ─── Checklist ──────────────────────────────────────────────────
  app.get('/admin/checklist', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const templates = await dbAll(`SELECT * FROM checklist_templates ORDER BY phase,sort_order,title`);
      const items     = await dbAll(`SELECT * FROM checklist_items ORDER BY template_id,sort_order`);
      const runs      = await dbAll(`SELECT cr.*,ct.title AS template_title,ct.phase,ct.area FROM checklist_runs cr JOIN checklist_templates ct ON ct.id=cr.template_id ORDER BY cr.started_at DESC LIMIT 50`);
      const editions  = await dbAll(`SELECT * FROM editions ORDER BY year DESC`);
      res.render('admin-checklist',{templates,items,runs,editions,saved:req.query.saved||null});
    } catch(e){ res.status(500).send('Errore: '+e.message); }
  });
  app.post('/admin/checklist/template', requireAuth, requireOrganizer, async (req, res) => {
    const {title,area,phase}=req.body;
    if(!title) return res.redirect('/admin/checklist?saved=err');
    try {
      const r=await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM checklist_templates WHERE phase=?`,[phase||'montaggio']);
      await dbRun(`INSERT INTO checklist_templates (title,area,phase,sort_order) VALUES (?,?,?,?)`,[title.trim(),area||null,phase||'montaggio',r.n||10]);
      res.redirect('/admin/checklist?saved=ok');
      logAction(req.session.user.id,'create_checklist_template','checklist',null,`Template checklist creato: ${title.trim()}`);
    } catch(e){ res.redirect('/admin/checklist?saved=err'); }
  });
  app.delete('/admin/checklist/template/:id', requireAuth, requireOrganizer, async (req,res) => {
    try {
      await dbRun(`DELETE FROM checklist_items WHERE template_id=?`,[+req.params.id]);
      await dbRun(`DELETE FROM checklist_templates WHERE id=?`,[+req.params.id]);
      logAction(req.session.user.id,'delete_checklist_template','checklist',+req.params.id,'Template checklist eliminato');
      res.json({ok:true});
    } catch(e){ res.status(500).json({error:e.message}); }
  });
  app.post('/admin/checklist/template/:id/item', requireAuth, requireOrganizer, async (req,res) => {
    const text=(req.body.text||'').trim(); const tid=+req.params.id;
    if(!text) return res.json({ok:false});
    try {
      const r=await dbGet(`SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM checklist_items WHERE template_id=?`,[tid]);
      const ins=await dbRun(`INSERT INTO checklist_items (template_id,text,sort_order) VALUES (?,?,?)`,[tid,text,r.n||10]);
      res.json({ok:true,id:ins.lastID,text});
    } catch(e){ res.status(500).json({error:e.message}); }
  });
  app.delete('/admin/checklist/item/:id', requireAuth, requireOrganizer, async (req,res) => {
    try { await dbRun(`DELETE FROM checklist_items WHERE id=?`,[+req.params.id]); res.json({ok:true}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });
  app.post('/admin/checklist/template/:id/run', requireAuth, requireOrganizer, async (req,res) => {
    const tid=+req.params.id; const {edition_id,notes}=req.body;
    try {
      const ins=await dbRun(`INSERT INTO checklist_runs (template_id,edition_id,notes) VALUES (?,?,?)`,[tid,edition_id||null,notes||null]);
      const its=await dbAll(`SELECT * FROM checklist_items WHERE template_id=?`,[tid]);
      for(const it of its) await dbRun(`INSERT INTO checklist_run_items (run_id,item_id) VALUES (?,?)`,[ins.lastID,it.id]);
      res.redirect('/admin/checklist/run/'+ins.lastID);
      logAction(req.session.user.id,'start_checklist_run','checklist',ins.lastID,`Esecuzione avviata per template #${tid}`);
    } catch(e){ res.status(500).send('Errore: '+e.message); }
  });
  app.get('/admin/checklist/run/:id', requireAuth, requireOrganizer, async (req,res) => {
    try {
      const run=await dbGet(`SELECT cr.*,ct.title,ct.phase,ct.area FROM checklist_runs cr JOIN checklist_templates ct ON ct.id=cr.template_id WHERE cr.id=?`,[+req.params.id]);
      if(!run) return res.status(404).send('Run non trovata');
      const runItems=await dbAll(`SELECT cri.*,ci.text,ci.sort_order FROM checklist_run_items cri JOIN checklist_items ci ON ci.id=cri.item_id WHERE cri.run_id=? ORDER BY ci.sort_order`,[+req.params.id]);
      res.render('admin-checklist-run',{run,runItems});
    } catch(e){ res.status(500).send('Errore: '+e.message); }
  });
  app.post('/admin/checklist/run/:runId/item/:itemId/toggle', requireAuth, requireOrganizer, async (req,res) => {
    const isDone=req.body.done?1:0;
    try {
      await dbRun(`UPDATE checklist_run_items SET done=?,done_at=?,done_by=? WHERE id=?`,
        [isDone,isDone?new Date().toISOString().slice(0,19).replace('T',' '):null,
         isDone?req.session.user.username:null,+req.params.itemId]);
      const pending=await dbGet(`SELECT COUNT(*) AS c FROM checklist_run_items WHERE run_id=? AND done=0`,[+req.params.runId]);
      if(pending.c===0) await dbRun(`UPDATE checklist_runs SET completed_at=datetime('now','localtime') WHERE id=? AND completed_at IS NULL`,[+req.params.runId]);
      else await dbRun(`UPDATE checklist_runs SET completed_at=NULL WHERE id=?`,[+req.params.runId]);
      logAction(req.session.user.id,'toggle_checklist_item','checklist',+req.params.itemId,(isDone?'✅ Completata':'↩️ Deselezionata')+' voce checklist run #'+req.params.runId);
      res.json({ok:true});
    } catch(e){ res.status(500).json({error:e.message}); }
  });

  // ─── Catering staff ─────────────────────────────────────────────
  app.get('/admin/catering', requireAuth, requireOrganizer, async (req,res) => {
    try {
      const shifts   = await dbAll(`SELECT * FROM catering_shifts ORDER BY date DESC,meal_type`);
      const orders   = await dbAll(`SELECT * FROM catering_orders ORDER BY shift_id,staff_name`);
      const editions = await dbAll(`SELECT * FROM editions ORDER BY year DESC`);
      res.render('admin-catering',{shifts,orders,editions,req,saved:req.query.saved||null});
    } catch(e){ res.status(500).send('Errore: '+e.message); }
  });
  app.post('/admin/catering/shift', requireAuth, requireOrganizer, async (req,res) => {
    const {label,date,meal_type,edition_id,notes}=req.body;
    if(!label) return res.redirect('/admin/catering?saved=err');
    try {
      await dbRun(`INSERT INTO catering_shifts (label,date,meal_type,edition_id,notes) VALUES (?,?,?,?,?)`,[label.trim(),date||null,meal_type||'pranzo',edition_id||null,notes||null]);
      res.redirect('/admin/catering?saved=ok');
      logAction(req.session.user.id,'create_catering_shift','catering',null,`Turno catering creato: ${label.trim()}`);
    } catch(e){ res.redirect('/admin/catering?saved=err'); }
  });
  app.delete('/admin/catering/shift/:id', requireAuth, requireOrganizer, async (req,res) => {
    try {
      await dbRun(`DELETE FROM catering_orders WHERE shift_id=?`,[+req.params.id]);
      await dbRun(`DELETE FROM catering_shifts WHERE id=?`,[+req.params.id]);
      logAction(req.session.user.id,'delete_catering_shift','catering',+req.params.id,'Turno catering eliminato');
      res.json({ok:true});
    } catch(e){ res.status(500).json({error:e.message}); }
  });
  app.post('/admin/catering/shift/:id/order', requireAuth, requireOrganizer, async (req,res) => {
    const {staff_name,role,menu_choice,dietary,notes}=req.body;
    if(!staff_name) return res.redirect('/admin/catering?saved=err');
    try {
      await dbRun(`INSERT INTO catering_orders (shift_id,staff_name,role,menu_choice,dietary,notes) VALUES (?,?,?,?,?,?)`,[+req.params.id,staff_name.trim(),role||null,menu_choice||null,dietary||null,notes||null]);
      res.redirect('/admin/catering?saved=ok&shift='+req.params.id);
      logAction(req.session.user.id,'create_catering_order','catering',null,`Ordinazione catering: ${staff_name} nel turno #${req.params.id}`);
    } catch(e){ res.redirect('/admin/catering?saved=err'); }
  });
  app.delete('/admin/catering/order/:id', requireAuth, requireOrganizer, async (req,res) => {
    try {
      await dbRun(`DELETE FROM catering_orders WHERE id=?`,[+req.params.id]);
      logAction(req.session.user.id,'delete_catering_order','catering',+req.params.id,'Ordinazione catering eliminata');
      res.json({ok:true});
    } catch(e){ res.status(500).json({error:e.message}); }
  });

  // ─── Fornitori ───────────────────────────────────────────────────
  app.get('/admin/fornitori', requireAuth, requireOrganizer, async (req,res) => {
    try {
      const suppliers = await dbAll(`SELECT * FROM suppliers ORDER BY category,name`);
      const items     = await dbAll(`SELECT * FROM supplier_items ORDER BY supplier_id,created_at DESC`);
      const editions  = await dbAll(`SELECT * FROM editions ORDER BY year DESC`);
      res.render('admin-fornitori',{suppliers,items,editions,saved:req.query.saved||null});
    } catch(e){ res.status(500).send('Errore: '+e.message); }
  });
  app.post('/admin/fornitori', requireAuth, requireOrganizer, async (req,res) => {
    const {name,category,contact_name,phone,email,website,notes}=req.body;
    if(!name) return res.redirect('/admin/fornitori?saved=err');
    try {
      await dbRun(`INSERT INTO suppliers (name,category,contact_name,phone,email,website,notes) VALUES (?,?,?,?,?,?,?)`,[name.trim(),category||null,contact_name||null,phone||null,email||null,website||null,notes||null]);
      res.redirect('/admin/fornitori?saved=ok');
      logAction(req.session.user.id,'create_fornitore','fornitore',null,`Fornitore aggiunto: ${name.trim()}`);
    } catch(e){ res.redirect('/admin/fornitori?saved=err'); }
  });
  app.delete('/admin/fornitori/:id', requireAuth, requireOrganizer, async (req,res) => {
    try {
      await dbRun(`DELETE FROM supplier_items WHERE supplier_id=?`,[+req.params.id]);
      await dbRun(`DELETE FROM suppliers WHERE id=?`,[+req.params.id]);
      logAction(req.session.user.id,'delete_fornitore','fornitore',+req.params.id,'Fornitore eliminato');
      res.json({ok:true});
    } catch(e){ res.status(500).json({error:e.message}); }
  });
  app.post('/admin/fornitori/:id/item', requireAuth, requireOrganizer, async (req,res) => {
    const {description,item_type,quantity,unit_cost,edition_id,notes}=req.body;
    const sid=+req.params.id;
    if(!description) return res.redirect('/admin/fornitori?saved=err');
    const qty=parseInt(quantity,10)||1; const uc=parseFloat(unit_cost)||0;
    try {
      await dbRun(`INSERT INTO supplier_items (supplier_id,description,item_type,quantity,unit_cost,total_cost,edition_id,notes) VALUES (?,?,?,?,?,?,?,?)`,[sid,description.trim(),item_type||'noleggio',qty,uc,qty*uc,edition_id||null,notes||null]);
      res.redirect('/admin/fornitori?saved=ok&sup='+sid);
      logAction(req.session.user.id,'create_fornitore_item','fornitore',sid,`Voce aggiunta al fornitore #${sid}: ${description.trim()}`);
    } catch(e){ res.redirect('/admin/fornitori?saved=err'); }
  });
  app.delete('/admin/fornitori/item/:id', requireAuth, requireOrganizer, async (req,res) => {
    try {
      await dbRun(`DELETE FROM supplier_items WHERE id=?`,[+req.params.id]);
      logAction(req.session.user.id,'delete_fornitore_item','fornitore',+req.params.id,'Voce fornitore eliminata');
      res.json({ok:true});
    } catch(e){ res.status(500).json({error:e.message}); }
  });

  // ── Portale espositore: invia richiesta servizio ─────────────
  app.post('/api/portale/:token/service-request', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet(`SELECT id FROM assignment_groups WHERE portal_token=?`, [token]);
      if (!group) return res.status(404).json({ error: 'Token non valido' });
      const { type, category, quantity, notes } = req.body;
      if (!type) return res.status(400).json({ error: 'Tipo obbligatorio' });
      const edId = _currentEdition ? _currentEdition.id : null;
      const _qty = parseInt(quantity, 10) || 1;
      await dbRun(
        `INSERT INTO service_requests (assignment_group_id, service_type, quantity, notes, edition_id)
         VALUES (?,?,?,?,?)`,
        [group.id, type, _qty, notes || null, edId]
      );
      // FIX: sync → scheda Materiali + resoconto fabbisogni (con category corretta)
      try {
        await dbRun(
          `INSERT INTO group_material_requests
             (assignment_group_id, category, item_name, quantity, notes, status, source, edition_id)
           VALUES (?,?,?,?,?,?,?,?)`,
          [group.id, category || null, type, _qty, notes || null, 'in_attesa', 'portale', edId]
        );
      } catch(eSyncMat) {
        console.warn('[portale] sync group_material_requests:', eSyncMat.message);
      }
      createNotification('service', 'Nuova richiesta servizio',
        `Richiesta <strong>${type}</strong> (x${_qty}) da gruppo ID ${group.id}.`, null, null);
      res.json({ ok: true });
    } catch(err) {
      console.error('Errore richiesta servizio portale:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Portale: lista richieste del gruppo ──────────────────────
  app.get('/api/portale/:token/service-requests', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet(`SELECT id FROM assignment_groups WHERE portal_token=?`, [token]);
      if (!group) return res.status(404).json({ error: 'Token non valido' });
      const rows = await dbAll(
        `SELECT id, service_type AS type, quantity, notes, status, requested_at
         FROM service_requests WHERE assignment_group_id=?
         ORDER BY requested_at DESC`,
        [group.id]
      );
      res.json(rows);
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/portale/:token/participants — aggiunge nominativo dal portale
  app.post('/api/portale/:token/participants', async (req, res) => {
    const token = req.params.token;
    const { firstname, lastname, role } = req.body;
    if (!firstname || !lastname) return res.status(400).json({ error: 'Nome e cognome obbligatori' });
    try {
      const group = await dbGet(
        'SELECT id, max_passes, portal_open_from, portal_open_until FROM assignment_groups WHERE portal_token=? AND portal_enabled=1',
        [token]
      );
      if (!group) return res.status(404).json({ error: 'Portale non disponibile' });
      const now = new Date().toISOString().slice(0, 16);
      if (group.portal_open_from && now < group.portal_open_from)
        return res.status(403).json({ error: 'Portale non ancora aperto' });
      if (group.portal_open_until && now > group.portal_open_until)
        return res.status(403).json({ error: 'Finestra inserimento chiusa' });
      if (group.max_passes !== null) {
        const cnt = await dbGet('SELECT COUNT(*) AS c FROM participants WHERE assignment_group_id=?', [group.id]);
        if (cnt && cnt.c >= group.max_passes)
          return res.status(400).json({ error: 'Limite massimo di pass raggiunto' });
      }
      const dup = await dbGet(
        'SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',
        [firstname.toLowerCase(), lastname.toLowerCase(), group.id]
      );
      if (dup) return res.status(409).json({ error: 'Nominativo già presente' });
      const result = await dbRun(
        'INSERT INTO participants (first_name, last_name, role, assignment_group_id) VALUES (?,?,?,?)',
        [firstname.trim(), lastname.trim(), role || null, group.id]
      );
      logAction(null, 'portal_add_participant', 'participant', result.lastID,
        'Nominativo aggiunto dal portale: ' + firstname + ' ' + lastname);
      res.json({ ok: true, id: result.lastID });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/portale/:token/participants/:pid/delete — rimuove nominativo dal portale
  app.post('/api/portale/:token/participants/:pid/delete', async (req, res) => {
    const token = req.params.token;
    const pid   = parseInt(req.params.pid, 10);
    try {
      const group = await dbGet(
        'SELECT id FROM assignment_groups WHERE portal_token=? AND portal_enabled=1',
        [token]
      );
      if (!group) return res.status(404).json({ error: 'Portale non disponibile' });
      const part = await dbGet(
        'SELECT id FROM participants WHERE id=? AND assignment_group_id=?',
        [pid, group.id]
      );
      if (!part) return res.status(404).json({ error: 'Nominativo non trovato' });
      const hasPass = await dbGet('SELECT id FROM passes WHERE participant_id=? LIMIT 1', [pid]);
      if (hasPass) return res.status(400).json({ error: 'Pass già generato, impossibile rimuovere' });
      await dbRun('DELETE FROM participants WHERE id=?', [pid]);
      logAction(null, 'portal_delete_participant', 'participant', pid, 'Nominativo rimosso dal portale');
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });


  app.get('/admin/bacheca', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const announcements = await dbAll(`
        SELECT a.*, u.username AS author,
               ag.name AS target_group_name
        FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by
        LEFT JOIN assignment_groups ag ON ag.id = a.target_group_id
        ORDER BY a.is_pinned DESC, a.created_at DESC
      `);
      const readCounts = await dbAll(`
        SELECT announcement_id, COUNT(*) AS cnt
        FROM announcement_reads
        GROUP BY announcement_id
      `);
      const readMap = Object.fromEntries(readCounts.map(r => [r.announcement_id, r.cnt]));
      const totalStands = (await dbGet(`SELECT COUNT(*) AS n FROM assignment_groups WHERE portal_enabled=1`)).n || 0;
      const allGroups = await dbAll(`SELECT id, name FROM assignment_groups ORDER BY name ASC`);
      res.render('admin_bacheca', { announcements, readMap, totalStands, allGroups, saved: req.query.saved });
    } catch(err) {
      console.error('Errore /admin/bacheca:', err);
      res.status(500).send('Errore interno');
    }
  });

  // POST /admin/bacheca — crea nuovo annuncio
  app.post('/admin/bacheca', requireAuth, requireOrganizer, async (req, res) => {
    // ✅ FIX: trim prima di validare — evita SQLITE_CONSTRAINT NOT NULL su stringhe di soli spazi
    const title   = (req.body.title   || '').trim();
    const message = (req.body.message || '').trim();
    const { emoji, type, is_pinned, expires_at } = req.body;
    const target_group_id = req.body.target_group_id ? parseInt(req.body.target_group_id, 10) : null;
    if (!title || !message) return res.redirect('/admin/bacheca?saved=err');
    try {
      await dbRun(
        `INSERT INTO announcements (title, message, emoji, type, is_pinned, expires_at, created_by, target_group_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          message,
          emoji || '📣',
          type || 'info',
          is_pinned ? 1 : 0,
          expires_at || null,
          req.session.user.id,
          target_group_id
        ]
      );
      logAction(req.session.user.id, 'create_announcement', 'announcement', null, `"${title}"${target_group_id ? ' → gruppo '+target_group_id : ''}`);
      res.redirect('/admin/bacheca?saved=1');
    } catch(err) {
      console.error('Errore POST /admin/bacheca:', err);
      res.redirect('/admin/bacheca?saved=err');
    }
  });

  // POST /admin/bacheca/:id/pin — toggle pinned
  app.post('/admin/bacheca/:id/pin', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await dbGet('SELECT is_pinned FROM announcements WHERE id=?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const newVal = row.is_pinned ? 0 : 1;
    await dbRun('UPDATE announcements SET is_pinned=? WHERE id=?', [newVal, id]);
    res.json({ pinned: newVal });
  });

  // DELETE /admin/bacheca/:id — elimina annuncio
  app.delete('/admin/bacheca/:id', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await dbRun('DELETE FROM announcements WHERE id=?', [id]);
    logAction(req.session.user.id, 'delete_announcement', 'announcement', id, '');
    res.json({ ok: true });
  });

  // POST /portale/:token/bacheca/read — segna tutti come letti per questo stand
  app.post('/portale/:token/bacheca/read', async (req, res) => {
    const token = req.params.token;
    try {
      const group = await dbGet(
        'SELECT id FROM assignment_groups WHERE portal_token=? AND portal_enabled=1', [token]
      );
      if (!group) return res.status(404).json({ error: 'not found' });

  // ── Controllo finestra temporale portale ────────────────────────────────
  if (group) {
    const _now = new Date().toISOString().slice(0, 16);
    if (group.portal_open_from && _now < group.portal_open_from) {
      const dtA = new Date(group.portal_open_from).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' });
      return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;margin:0}
        .b{background:#fff;border-radius:12px;padding:2.5rem 3rem;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:460px}
        h2{color:#1e2d4e}p{color:#64748b}</style></head>
        <body><div class="b"><div style="font-size:3rem">&#x23F3;</div>
        <h2>Portale non ancora aperto</h2>
        <p>La finestra di accesso apre il <strong>${dtA}</strong></p>
        </div></body></html>`);
    }
    if (group.portal_open_until && _now > group.portal_open_until) {
      // Trigger batch pass alla prima chiusura finestra
      if (group.portal_status !== 'scaduto') {
        triggerBatchPassOnClose(group.id).catch(e => console.error('[batchClose]', e.message));
        try { await dbRun(`UPDATE assignmentgroups SET portal_status='scaduto' WHERE id=?`, group.id); } catch(e2) {}
      }
      const dtC = new Date(group.portal_open_until).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' });
      return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;margin:0}
        .b{background:#fff;border-radius:12px;padding:2.5rem 3rem;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:460px}
        h2{color:#c0392b}p{color:#64748b}</style></head>
        <body><div class="b"><div style="font-size:3rem">&#x1F512;</div>
        <h2>Finestra inserimento chiusa</h2>
        <p>Il termine per i nominativi era il <strong>${dtC}</strong>.<br>Contatta l'organizzazione per un'estensione.</p>
        </div></body></html>`);
    }
  }
  // ── Fine controllo finestra ──────────────────────────────────────────────

      const anns = await dbAll(`SELECT id FROM announcements WHERE expires_at IS NULL OR expires_at > datetime('now','localtime')`);
      for (const a of anns) {
        await dbRun(
          'INSERT OR IGNORE INTO announcement_reads (announcement_id, portal_token) VALUES (?,?)',
          [a.id, token]
        );
      }
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/portale/:token/unread — badge count per polling JS
  app.get('/api/portale/:token/unread', async (req, res) => {
    const token = req.params.token;
    try {
      const row = await dbGet(`
        SELECT COUNT(*) AS cnt
        FROM announcements a
        WHERE (a.expires_at IS NULL OR a.expires_at > datetime('now','localtime'))
          AND (a.target_group_id IS NULL OR a.target_group_id = (
            SELECT id FROM assignment_groups WHERE portal_token=? LIMIT 1
          ))
          AND NOT EXISTS (
            SELECT 1 FROM announcement_reads ar
            WHERE ar.announcement_id = a.id AND ar.portal_token = ?
          )
      `, [token, token, token]);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate').json({ unread: row ? row.cnt : 0 });
    } catch(err) {
      res.set('Cache-Control', 'no-store').json({ unread: 0 });
    }
  });

  app.get('/portale/:token', async function(req, res) {
    const token = req.params.token;
    try {
      const group = await dbGet(
        `SELECT ag.*, g.name AS cat_name FROM assignment_groups ag
         LEFT JOIN groups g ON g.id = ag.group_id
         WHERE ag.portal_token=? AND ag.portal_enabled=1`,
        [token]
      );
      if (!group) return res.status(404).send('<h2 style="font-family:sans-serif;padding:2rem">Portale non disponibile.</h2>');

      const [parts, autoPasses, announcements, unreadRow, zoneInfo, zoneStands, refWRow, refHRow] = await Promise.all([
        dbAll(
          `SELECT pa.id AS participant_id, pa.first_name, pa.last_name, pa.email, pa.role,
                  p.id AS pass_id, p.code, p.status, pt.name AS type_name
           FROM participants pa
           LEFT JOIN passes p ON p.participant_id=pa.id AND p.status!='INVALIDATO'
           LEFT JOIN pass_types pt ON pt.id=p.pass_type_id
           WHERE pa.assignment_group_id=?
           ORDER BY pa.last_name, pa.first_name`,
          [group.id]
        ),
        dbAll(
          `SELECT * FROM auto_passes WHERE assignment_group_id=? AND status!='INVALIDATO' ORDER BY pass_number`,
          [group.id]
        ),
        dbAll(
          `SELECT a.*, CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS is_read
           FROM announcements a
           LEFT JOIN announcement_reads ar ON ar.announcement_id=a.id AND ar.portal_token=?
           WHERE (a.expires_at IS NULL OR a.expires_at > datetime('now','localtime'))
             AND (a.target_group_id IS NULL OR a.target_group_id = (
               SELECT id FROM assignment_groups WHERE portal_token=? LIMIT 1
             ))
           ORDER BY a.is_pinned DESC, a.created_at DESC`,
          [token, token]
        ),
        dbGet(
          `SELECT COUNT(*) AS cnt FROM announcements a
           WHERE (a.expires_at IS NULL OR a.expires_at > datetime('now','localtime'))
             AND NOT EXISTS (
               SELECT 1 FROM announcement_reads ar
               WHERE ar.announcement_id=a.id AND ar.portal_token=?
             )`,
          [token]
        ),
        // NEW: dati zona per la mappa "Dove siete?"
        group.zone ? dbGet(
          `SELECT z.id, z.name, z.background_image FROM zones z WHERE z.name=? LIMIT 1`,
          [group.zone]
        ) : Promise.resolve(null),
        group.zone ? dbAll(
          `SELECT ag.id, ag.name AS stand_name, ag.stand_code,
                  ag.map_x, ag.map_y, ag.map_w, ag.map_h, ag.map_shape
           FROM assignment_groups ag
           WHERE ag.zone=? AND ag.map_x IS NOT NULL AND ag.map_y IS NOT NULL
           ORDER BY ag.name`,
          [group.zone]
        ) : Promise.resolve([]),
        dbGet(`SELECT value FROM app_settings WHERE key='map_ref_w'`, []),
        dbGet(`SELECT value FROM app_settings WHERE key='map_ref_h'`, [])
      ]);

      // ── CRM: carica docs portale e ticket ───────────────────
      const _qpAll = (sql, p) => new Promise((ok, ko) => db.all(sql, p, (e, r) => e ? ko(e) : ok(r)));
      const [portalDocs, ticketsRaw] = await Promise.all([
        _qpAll('SELECT * FROM portal_documents WHERE assignment_group_id=? ORDER BY uploaded_at DESC', [group.id]),
        _qpAll('SELECT * FROM support_tickets  WHERE assignment_group_id=? ORDER BY created_at DESC',  [group.id]),
      ]);
      for (const t of ticketsRaw) {
        t.replies = await _qpAll('SELECT * FROM ticket_replies WHERE ticket_id=? ORDER BY created_at ASC', [t.id]);
      }
      // ── Fine CRM ─────────────────────────────────────────────

      // FIX: categorie logistiche per form servizi dinamico
      const _logCats = await dbAll('SELECT * FROM logistic_categories ORDER BY sort_order, label').catch(() => []);

      res.render('portale', {
        group,
        parts:        parts       || [],
        token,
        autoPasses:   autoPasses  || [],
        announcements: announcements || [],
        unreadCount:  unreadRow ? unreadRow.cnt : 0,
        zoneInfo:     zoneInfo    || null,
        zoneStands:   zoneStands  || [],
        mapRefW:      (refWRow && refWRow.value) ? parseInt(refWRow.value,10) : null,
        mapRefH:      (refHRow && refHRow.value) ? parseInt(refHRow.value,10) : null,
        portalDocs:   portalDocs  || [],
        tickets:      ticketsRaw  || [],
        logisticCategories: _logCats || [],
      });
    } catch(err) {
      console.error('Errore GET /portale/:token:', err);
      res.status(500).send('Errore interno');
    }
  });
  app.get('/portale/:token/download/:passId',function(req,res){db.get(`SELECT ag.portal_enabled FROM assignment_groups ag JOIN participants pa ON pa.assignment_group_id=ag.id JOIN passes p ON p.participant_id=pa.id WHERE ag.portal_token=? AND p.id=?`,[req.params.token,req.params.passId],function(err,row){if(err||!row||!row.portal_enabled)return res.status(403).send('Accesso negato');res.redirect('/passes/'+req.params.passId+'/download?portal_token='+req.params.token);});});
  app.get('/portale/:token/download-auto/:apId',function(req,res){
    db.get(
      `SELECT ag.portal_enabled, ag.id AS group_id, ag.name AS group_name,
              ap.pdf_file, ap.pass_number, ap.total_passes, ap.status
       FROM auto_passes ap
       JOIN assignment_groups ag ON ag.id=ap.assignment_group_id
       WHERE ag.portal_token=? AND ap.id=? AND ap.status!='INVALIDATO'`,
      [req.params.token, req.params.apId],
      function(err,row){
        if(err||!row||!row.portal_enabled) return res.status(403).send('Accesso negato');
        const fpath = path.join(process.env.DATA_DIR||__dirname,'generated',row.pdf_file||'');
        if(!fs.existsSync(fpath)) return res.status(404).send('File non trovato');
        if(row.status==='GENERATO'){
          db.run("UPDATE auto_passes SET status='SCARICATO' WHERE id=?",[req.params.apId]);
          db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[req.params.apId,'SCARICATO',null]);
        }
        logAction(null,'portal_download_auto_pass','auto_pass',req.params.apId,
          'Pass parcheggio n.'+row.pass_number+'/'+row.total_passes+' scaricato dal portale espositore ('+row.group_name+')');
        res.download(fpath,'pass_parcheggio_'+row.pass_number+'_di_'+row.total_passes+'.pdf');
      }
    );
  });
  
  // -------- Mappa interattiva per zone --------
  const bgUpload = multer({
    dest: path.join(process.env.DATA_DIR || __dirname, 'generated'),
    fileFilter: function(req, file, cb){ cb(null, /image\//.test(file.mimetype)); }
  });

  app.get('/zone-bg/:filename', requireAuth, function(req, res) {
    res.sendFile(path.join(process.env.DATA_DIR || __dirname, 'generated', path.basename(req.params.filename)));
  });

  app.get('/mappa', requireAuth, function(req, res) {
    db.all('SELECT * FROM zones WHERE (zone_scope IS NULL OR zone_scope = \'internal\') ORDER BY sort_order, name', [], function(err, zones) {
      if (err) return res.status(500).send('Errore DB');
      db.all(`SELECT ag.id, ag.name AS stand_name, ag.stand_name AS stand_loc, ag.stand_code,
                ag.zone, ag.map_x, ag.map_y, ag.map_w, ag.map_h, ag.map_shape,
                ag.max_passes, ag.notes,
                COUNT(CASE WHEN p.status!='INVALIDATO' THEN 1 END) AS pass_count,
                SUM(CASE WHEN p.status IN('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati
              FROM assignment_groups ag
              LEFT JOIN participants pa ON pa.assignment_group_id = ag.id
              LEFT JOIN passes p ON p.participant_id = pa.id
              WHERE (1=1) ${edFilter()}
              GROUP BY ag.id ORDER BY ag.zone, ag.name`, [], function(err2, groups) {
        if (err2) return res.status(500).send('Errore DB');
        res.render('mappa', { zones: zones||[], groups: groups||[], isAdmin: !!(req.session.user && req.session.user.role==='admin'), canEdit: !!(req.session.user && req.session.user.role !== 'viewer') });
      });
    });
  });

  app.post('/admin/zones/:id/upload-bg', requireAuth, requireAdmin, bgUpload.single('bg_image'), function(req, res) {
    var zoneId = parseInt(req.params.id, 10);
    if (!req.file) return res.redirect('/mappa');
    var ext = (req.file.originalname.match(/\.\w+$/) || ['.jpg'])[0].toLowerCase();
    var newName = 'zone-bg-' + zoneId + '-' + Date.now() + ext;
    var newPath = path.join(process.env.DATA_DIR || __dirname, 'generated', newName);
    db.get('SELECT background_image FROM zones WHERE id=?', [zoneId], function(e, row) {
      if (row && row.background_image) {
        try { fs.unlinkSync(path.join(process.env.DATA_DIR || __dirname, 'generated', row.background_image)); } catch(e2) {}
      }
      fs.renameSync(req.file.path, newPath);
      db.run('UPDATE zones SET background_image=? WHERE id=?', [newName, zoneId], function() { res.redirect('/mappa'); });
    });
  });

  app.post('/admin/zones/:id/delete-bg', requireAuth, requireAdmin, function(req, res) {
    var zoneId = parseInt(req.params.id, 10);
    db.get('SELECT background_image FROM zones WHERE id=?', [zoneId], function(e, row) {
      if (row && row.background_image) {
        try { fs.unlinkSync(path.join(process.env.DATA_DIR || __dirname, 'generated', row.background_image)); } catch(e2) {}
      }
      db.run('UPDATE zones SET background_image=NULL WHERE id=?', [zoneId], function() { res.redirect('/mappa'); });
    });
  });

  app.post('/admin/groups/:id/map-position', requireAuth, requireNotViewer, function(req, res) {
    var id = parseInt(req.params.id, 10),
        row = parseInt(req.body.map_row, 10)||null, col = parseInt(req.body.map_col, 10)||null,
        span = Math.max(1, Math.min(8, parseInt(req.body.map_span, 10)||1));
    db.run('UPDATE assignment_groups SET map_row=?,map_col=?,map_span=? WHERE id=?', [row,col,span,id], function(err) {
      res.json(err ? {error:err.message} : {ok:true});
    });
  });

  app.post('/admin/groups/:id/map-xy', requireAuth, requireNotViewer, function(req, res) {
    var id = parseInt(req.params.id, 10);
    var x = (req.body.map_x !== '' && req.body.map_x != null) ? parseFloat(req.body.map_x) : null;
    var y = (req.body.map_y !== '' && req.body.map_y != null) ? parseFloat(req.body.map_y) : null;
    var w = (req.body.map_w !== '' && req.body.map_w != null) ? parseFloat(req.body.map_w) : null;
    var h = (req.body.map_h !== '' && req.body.map_h != null) ? parseFloat(req.body.map_h) : null;
    var shape = (req.body.map_shape && req.body.map_shape.trim()) ? req.body.map_shape.trim() : null;
    var refW = (req.body.ref_w && !isNaN(parseInt(req.body.ref_w,10))) ? parseInt(req.body.ref_w,10) : null;
    var refH = (req.body.ref_h && !isNaN(parseInt(req.body.ref_h,10))) ? parseInt(req.body.ref_h,10) : null;
    var fields = 'map_x=?, map_y=?';
    var params = [x, y];
    if (w !== null) { fields += ', map_w=?'; params.push(w); }
    if (h !== null) { fields += ', map_h=?'; params.push(h); }
    if (req.body.map_shape !== undefined) { fields += ', map_shape=?'; params.push(shape); }
    params.push(id);
    db.run('UPDATE assignment_groups SET ' + fields + ' WHERE id=?', params, function(err) {
      if (err) return res.json({ ok: false, error: err.message });
      // Salva dimensioni div admin per allineamento portale espositore
      if (refW && refH && x !== null) {
        db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)', ['map_ref_w', String(refW)]);
        db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)', ['map_ref_h', String(refH)]);
      }
      res.json({ ok: true });
    });
  });

app.get('/notifications',requireAuth,requireAdmin,function(req,res){db.run("UPDATE notifications SET read_at=datetime('now','localtime') WHERE read_at IS NULL");db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200',[],function(err,notifs){res.render('notifications',{notifs:notifs||[]});});});
  app.get('/api/notifications/count',requireAuth,requireAdmin,function(req,res){db.get('SELECT COUNT(*) as n FROM notifications WHERE read_at IS NULL',[],function(e,r){res.json({count:r?r.n:0});});});
  app.post('/notifications/read-all',requireAuth,requireAdmin,function(req,res){db.run("UPDATE notifications SET read_at=datetime('now','localtime') WHERE read_at IS NULL",function(){res.redirect('/notifications');});});


// ═══════════════════════════════════════════════════════
// CONTATORE VISITATORI PER AREA
// ═══════════════════════════════════════════════════════

// Config aree e gate
const VISITOR_AREAS = {
  mariambini: { label: 'Mariambini', gates: ['Gate A', 'Gate B'], emoji: '🎡' },
  palazzetto: { label: 'Palazzetto', gates: ['Ingresso'], emoji: '🏟️' },
  la_perla:   { label: 'Cinema La Perla', gates: ['Ingresso'], emoji: '🎬' },
  ludostria:  { label: 'Ludostria', gates: ['Ingresso'], emoji: '🎲' }
};

// Registra un singolo tap (IN o OUT)
app.post('/api/visitors/tap', requireAuth, requireNotViewer, (req, res) => {
  const { area, gate = 'main', direction } = req.body;
  if (!area || !['IN','OUT'].includes(direction)) {
    return res.status(400).json({ error: 'area e direction (IN/OUT) richiesti' });
  }
  const userId = req.session.user?.id || null;
  const edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
  db.run(
    `INSERT INTO visitor_counts (area, gate, direction, user_id, edition_id) VALUES (?,?,?,?,?)`,
    [area, gate || 'main', direction, userId, edId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      logAction(userId, 'VISITOR_TAP', `${direction} area=${area} gate=${gate}`);
      // Ritorna il contatore aggiornato per l'area
      const since = todayMidnight();
      db.get(
        `SELECT
          SUM(CASE WHEN direction='IN'  AND counted_at >= ? THEN 1 ELSE 0 END) as ins,
          SUM(CASE WHEN direction='OUT' AND counted_at >= ? THEN 1 ELSE 0 END) as outs
         FROM visitor_counts WHERE area=? AND (edition_id=? OR edition_id IS NULL)
           AND counted_at >= COALESCE(
             (SELECT reset_at FROM visitor_resets WHERE area=? ORDER BY id DESC LIMIT 1), ?)`,
        [since, since, area, edId, area, since],
        (e, row) => {
          const ins  = row?.ins  || 0;
          const outs = row?.outs || 0;
          res.json({ ok: true, area, ins, outs, presenti: Math.max(0, ins - outs) });
        }
      );
    }
  );
});

// Presenze live per tutte le aree
app.get('/api/visitors/live', requireAuth, (req, res) => {
  const since = todayMidnight();
  const edId  = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
  db.all(
    `SELECT vc.area,
      SUM(CASE WHEN vc.direction='IN'  THEN 1 ELSE 0 END) as ins,
      SUM(CASE WHEN vc.direction='OUT' THEN 1 ELSE 0 END) as outs
     FROM visitor_counts vc
     WHERE vc.counted_at >= COALESCE(
       (SELECT vr.reset_at FROM visitor_resets vr WHERE vr.area=vc.area ORDER BY vr.id DESC LIMIT 1), ?)
       AND vc.counted_at >= ?
       AND (vc.edition_id = ? OR vc.edition_id IS NULL)
     GROUP BY vc.area`,
    [since, since, edId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const result = {};
      (rows || []).forEach(r => {
        result[r.area] = { ins: r.ins, outs: r.outs, presenti: Math.max(0, r.ins - r.outs) };
      });
      // Storico orario oggi (aggregato per ora)
      db.all(
        `SELECT area,
          strftime('%H', counted_at) as ora,
          SUM(CASE WHEN direction='IN'  THEN 1 ELSE 0 END) as ins,
          SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) as outs
         FROM visitor_counts
         WHERE counted_at >= ?
           AND (edition_id = ? OR edition_id IS NULL)
         GROUP BY area, ora
         ORDER BY ora ASC`,
        [since, edId],
        (e2, hist) => {
          res.json({ areas: result, history: hist || [] });
        }
      );
    }
  );
});

// Storico orario per una singola area
app.get('/api/visitors/history/:area', requireAuth, (req, res) => {
  const since = todayMidnight();
  const edId  = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
  db.all(
    `SELECT strftime('%H:00', counted_at) as ora,
      SUM(CASE WHEN direction='IN'  THEN 1 ELSE 0 END) as ins,
      SUM(CASE WHEN direction='OUT' THEN 1 ELSE 0 END) as outs
     FROM visitor_counts
     WHERE area=? AND counted_at >= ?
       AND (edition_id=? OR edition_id IS NULL)
     GROUP BY ora ORDER BY ora ASC`,
    [req.params.area, since, edId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Pagina contatore (view dedicata per volontari su mobile)
app.get('/contatore', requireAuth, (req, res) => {
  res.render('contatore', {
    user: req.session.user,
    areas: VISITOR_AREAS
  });
});

// Reset manuale da admin (una area specifica o tutte)
app.post('/api/visitors/reset', requireAuth, requireAdmin, (req, res) => {
  const { area, note } = req.body;
  const userId = req.session.user?.id || null;
  const areaFilter = area && area !== 'all' ? area : null;
  db.run(
    `INSERT INTO visitor_resets (area, user_id, note) VALUES (?,?,?)`,
    [areaFilter, userId, note || null],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      logAction(userId, 'VISITOR_RESET', `area=${areaFilter || 'TUTTE'} note=${note || ''}`);
      res.json({ ok: true });
    }
  );
});

// Helper: mezzanotte di oggi in formato SQLite
function todayMidnight() {
  const d = new Date();
  d.setHours(0,0,0,0);
  // SQLite datetime locale
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} 00:00:00`;
}
  app.post('/admin/settings/smtp',requireAuth,requireAdmin,function(req,res){var fields=['smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from','smtp_to'],done=0;fields.forEach(function(k){db.run('INSERT OR REPLACE INTO app_settings(key,value)VALUES(?,?)',[k,req.body[k]||''],function(){if(++done===fields.length)res.redirect('/admin/settings#notifiche');});});});
  app.post('/admin/settings/smtp-test',requireAuth,requireAdmin,function(req,res){var c=req.body;if(!c.smtp_host||!c.smtp_to)return res.json({ok:false,error:'Host e destinatario obbligatori'});nodemailer.createTransport({host:c.smtp_host,port:parseInt(c.smtp_port||'587',10),secure:c.smtp_secure==='1',auth:c.smtp_user?{user:c.smtp_user,pass:c.smtp_pass}:undefined,tls:{rejectUnauthorized:false}}).sendMail({from:c.smtp_from||'noreply@ludicomix.it',to:c.smtp_to,subject:'[Ludicomix] Test SMTP',html:'<p>Test OK!</p>'},function(err){res.json(err?{ok:false,error:err.message}:{ok:true});});});


  app.post('/passes/bulk-status', requireAuth, function(req,res){
    var ids = Array.isArray(req.body.pass_ids) ? req.body.pass_ids : (req.body.pass_ids ? [req.body.pass_ids] : []);
    var status = req.body.status, gid = req.body.group_id;
    if(!ids.length || !status) return res.status(400).send('Parametri mancanti');
    var isViewer = req.session.user && req.session.user.role === 'viewer';
    var allowed  = isViewer ? ['SCARICATO','STAMPATO','CONSEGNATO','RICONSEGNATO'] : PASS_STATUSES.filter(function(s){return s!=='GENERATO';});
    if(!allowed.includes(status)) return res.status(403).send('Stato non consentito al tuo ruolo');
    var done=0;
    ids.forEach(function(pid){
      var id=parseInt(pid,10);
      db.run('UPDATE passes SET status=? WHERE id=? AND status!=\'INVALIDATO\'',[status,id],function(){
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[id,status,req.session.user.id]);
        if(++done===ids.length){
          logAction(req.session.user.id,'bulk_status','pass',null,'Stato '+status+' a '+ids.length+' pass nel gruppo #'+gid);
          res.redirect(gid ? '/assignment-groups/'+gid : '/passes');
        }
      });
    });
  });

  app.post('/assignment-groups/:id/import', requireAuth, requireOrganizer, uploadMemory.single('file'), function(req,res){
    var gid=parseInt(req.params.id,10);
    if(!gid||!req.file) return res.redirect('/assignment-groups/'+gid+'?import_errs=File+mancante');
    var rows;
    try{ var wb=XLSX.read(req.file.buffer,{type:'buffer'}); rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false}); }
    catch(e){ return res.redirect('/assignment-groups/'+gid+'?import_errs='+encodeURIComponent('Errore: '+e.message)); }
    if(!rows||!rows.length) return res.redirect('/assignment-groups/'+gid+'?import_errs=File+vuoto');
    var ok=0,skip=0,errors=[];
    function ins(i){
      if(i>=rows.length){
        logAction(req.session.user.id,'import_csv','group',gid,'Import '+ok+' nel gruppo #'+gid);
        createNotification('import','Import CSV completato','Importati <strong>'+ok+'</strong> nel gruppo #'+gid+'. Saltati: '+skip+'.','group',gid);
        var q='/assignment-groups/'+gid+'?import_ok='+ok+'&import_skip='+skip;
        if(errors.length) q+='&import_errs='+encodeURIComponent(errors.slice(0,5).join('|'));
        return res.redirect(q);
      }
      var r=rows[i];
      var last=(r.cognome||r.Cognome||'').toString().trim();
      var first=(r.nome||r.Nome||'').toString().trim();
      var email=(r.email||r.Email||'').toString().trim().toLowerCase();
      var role=(r.ruolo||r.Ruolo||'Espositore').toString().trim();
      if(!last&&!first){skip++;return ins(i+1);}
      db.get('SELECT id FROM participants WHERE LOWER(first_name)=? AND LOWER(last_name)=? AND assignment_group_id=?',
        [first.toLowerCase(),last.toLowerCase(),gid],function(e,dup){
          if(dup){skip++;return ins(i+1);}
          db.run('INSERT INTO participants(first_name,last_name,email,role,assignment_group_id)VALUES(?,?,?,?,?)',
            [first,last,email||null,role,gid],function(e2){
              if(e2) errors.push('Riga '+(i+2)+': '+e2.message); else ok++;
              ins(i+1);
            });
        });
    }
    ins(0);
  });
  // -------- Ricerca & Reports --------

  
  // -------- Scanner QR: API lookup e consegna --------

  app.get('/scan', requireAuth, requireCanScan, (req, res) => {
    res.render('scan', { currentUser: req.session.user });
  });

  app.get('/api/scan/:code', requireAuth, requireCanScan, (req, res) => {
    const code = (req.params.code || '').trim().toUpperCase();
    db.get(`SELECT p.id, p.code, p.status,
               pa.first_name, pa.last_name, pa.email,
               ag.name AS group_name, pt.name AS pass_type_name
            FROM passes p
            JOIN participants pa ON pa.id = p.participant_id
            LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
            LEFT JOIN pass_types pt ON pt.id = p.pass_type_id
            WHERE p.code = ?`, [code], (err, pass) => {
      if (err) return res.status(500).json({ error: 'Errore DB' });
      if (!pass) {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        db.run('INSERT INTO scan_attempts(code,result,user_id,ip) VALUES(?,?,?,?)',
          [code, 'NOT_FOUND', req.session.user.id, ip]);
        return res.status(404).json({ error: 'Pass non trovato', code });
      }
      res.json({ pass });
    });
  });

  app.post('/api/scan/:code/consegna', requireAuth, (req, res) => {
    const code = (req.params.code || '').trim().toUpperCase();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const uid = req.session.user.id;
    db.get(`SELECT p.id, p.status, pa.first_name, pa.last_name, ag.name AS group_name
            FROM passes p
            JOIN participants pa ON pa.id = p.participant_id
            LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
            WHERE p.code = ?`, [code], (err, pass) => {
      if (err || !pass) {
        db.run('INSERT INTO scan_attempts(code,result,user_id,ip) VALUES(?,?,?,?)',
          [code, 'NOT_FOUND', uid, ip]);
        return res.status(404).json({ error: 'Pass non trovato' });
      }
      const pname = pass.first_name + ' ' + pass.last_name;
      if (pass.status === 'INVALIDATO') {
        db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
          [code, 'INVALIDATO', pass.id, pname, pass.group_name, uid, ip]);
        return res.status(400).json({ error: 'Pass invalidato', status: pass.status });
      }
      if (pass.status === 'CONSEGNATO' || pass.status === 'RICONSEGNATO') {
        db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
          [code, 'GIA_' + pass.status, pass.id, pname, pass.group_name, uid, ip]);
        return res.status(409).json({ error: 'Pass gia\u0027 ' + pass.status.toLowerCase(), status: pass.status });
      }
      db.run('UPDATE passes SET status = ? WHERE id = ?', ['CONSEGNATO', pass.id], function(err2) {
        if (err2) return res.status(500).json({ error: 'Errore DB' });
        db.run('INSERT INTO scan_attempts(code,result,pass_id,participant_name,group_name,user_id,ip) VALUES(?,?,?,?,?,?,?)',
          [code, 'SUCCESS', pass.id, pname, pass.group_name, uid, ip]);
        logAction(uid, 'scan_consegna', 'pass', pass.id, 'Pass CONSEGNATO via scanner QR');
        db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)', [pass.id, 'CONSEGNATO', uid]);
        res.json({ success: true, passId: pass.id });
      });
    });
  });

// ── BATCH PDF gruppo ──
  app.get('/assignment-groups/:id/batch-pdf', requireAuth, async (req, res) => {
    const { PDFDocument } = require('pdf-lib');
    const id = parseInt(req.params.id, 10);
    db.get('SELECT name FROM assignment_groups WHERE id = ?', [id], (err, grp) => {
      if (err || !grp) return res.status(404).send('Gruppo non trovato');
      db.all(`SELECT p.pdf_file, pa.first_name, pa.last_name
              FROM passes p
              JOIN participants pa ON pa.id = p.participant_id
              WHERE pa.assignment_group_id = ? AND p.pdf_file IS NOT NULL AND p.status != 'INVALIDATO'
              ORDER BY pa.last_name, pa.first_name`, [id], async (err2, passes) => {
        if (err2 || !passes || !passes.length)
          return res.status(404).send('Nessun PDF disponibile per questo gruppo');
        try {
          const merged = await PDFDocument.create();
          for (const p of passes) {
            const fp = path.join(process.env.DATA_DIR || __dirname, 'generated', p.pdf_file);
            if (!require('fs').existsSync(fp)) continue;
            const bytes = require('fs').readFileSync(fp);
            const doc = await PDFDocument.load(bytes);
            const pages = await merged.copyPages(doc, doc.getPageIndices());
            pages.forEach(pg => merged.addPage(pg));
          }
          const out = await merged.save();
          const safeName = grp.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename="batch_' + safeName + '.pdf"');
          res.send(Buffer.from(out));
          logAction(req.session.user.id, 'batch_pdf', 'assignment_group', id,
            'Batch PDF scaricato (' + passes.length + ' pass)');
          // Aggiorna GENERATO -> SCARICATO per i pass del gruppo inclusi nel batch
          db.all(`SELECT p.id FROM passes p
                  JOIN participants pa ON pa.id=p.participant_id
                  WHERE pa.assignment_group_id=? AND p.status='GENERATO'`,
            [id], function(e2, toUpdate){
              if(!toUpdate||!toUpdate.length) return;
              toUpdate.forEach(function(p){
                db.run("UPDATE passes SET status='SCARICATO' WHERE id=?",[p.id]);
                db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',
                  [p.id,'SCARICATO',req.session.user.id]);
                logAction(req.session.user.id,'batch_pdf_scaricato','pass',p.id,'Stato aggiornato GENERATO->SCARICATO via batch PDF');
              });
            });
        } catch(e) {
          res.status(500).send('Errore generazione PDF: ' + e.message);
        }
      });
    });
  });

  // ── Cronologia tentativi scan ──
  app.get('/scan-attempts', requireAuth, requireAdmin, (req, res) => {
    db.all(`SELECT sa.*, u.username
            FROM scan_attempts sa
            LEFT JOIN users u ON u.id = sa.user_id
            ORDER BY sa.id DESC LIMIT 500`, [], (err, rows) => {
      res.render('scan_attempts', { attempts: rows || [] });
    });
  });

app.get('/api/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ passes: [], participants: [], groups: [] });
    const like = `%${q}%`;
    const sqlP = `SELECT p.id, p.code, p.status, pt.name AS pass_type_name,
             pa.first_name||' '||pa.last_name AS participant_name, ag.stand_name
      FROM passes p
      JOIN pass_types pt ON pt.id=p.pass_type_id
      JOIN participants pa ON pa.id=p.participant_id
      LEFT JOIN assignment_groups ag ON ag.id=pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pt.name LIKE ? OR p.code LIKE ? OR ag.name LIKE ? OR ag.stand_name LIKE ?
      ORDER BY p.id DESC LIMIT 8`;
    const sqlPa = `SELECT pa.id, pa.first_name, pa.last_name, pa.role, ag.stand_name
      FROM participants pa
      LEFT JOIN assignment_groups ag ON ag.id=pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ? OR pa.role LIKE ?
      ORDER BY pa.last_name LIMIT 6`;
    const sqlG = `SELECT ag.id, ag.name, ag.stand_name, ag.zone
      FROM assignment_groups ag
      WHERE (ag.name LIKE ? OR ag.stand_name LIKE ? OR ag.zone LIKE ? OR ag.stand_code LIKE ?) ${edFilter()}
      ORDER BY ag.name LIMIT 5`;
    db.all(sqlP, [like,like,like,like,like,like,like], (e1, passes) => {
      db.all(sqlPa, [like,like,like,like], (e2, participants) => {
        db.all(sqlG, [like,like,like,like], (e3, groups) => {
          res.json({ passes: passes||[], participants: participants||[], groups: groups||[] });
        });
      });
    });
  });

app.get('/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    const tab = req.query.tab || 'all';
    if (!q) return res.render('search', { q:'', tab, passes:[], participants:[], groups:[] });
    const like = `%${q}%`;
    const sqlP = `SELECT p.id, p.created_at, p.pdf_file, p.code, p.status,
             pt.name AS pass_type_name,
             pa.first_name||' '||pa.last_name AS participant_name,
             ag.name AS group_name, ag.stand_name
      FROM passes p
      JOIN pass_types pt ON pt.id=p.pass_type_id
      JOIN participants pa ON pa.id=p.participant_id
      LEFT JOIN assignment_groups ag ON ag.id=pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pt.name LIKE ? OR p.code LIKE ? OR ag.name LIKE ? OR ag.stand_name LIKE ?
      ORDER BY p.id DESC LIMIT 300`;
    const sqlPa = `SELECT pa.id, pa.first_name, pa.last_name, pa.email, pa.role, pa.ref_code,
             ag.name AS group_name, ag.stand_name,
             (SELECT COUNT(*) FROM passes pp WHERE pp.participant_id=pa.id AND pp.status!='INVALIDATO') AS pass_count
      FROM participants pa
      LEFT JOIN assignment_groups ag ON ag.id=pa.assignment_group_id
      WHERE pa.first_name LIKE ? OR pa.last_name LIKE ? OR pa.email LIKE ?
         OR pa.role LIKE ? OR pa.ref_code LIKE ?
      ORDER BY pa.last_name, pa.first_name LIMIT 100`;
    const sqlG = `SELECT ag.id, ag.name, ag.stand_name, ag.zone, ag.stand_code,
             g.name AS category_name, ag.max_passes,
             COUNT(DISTINCT pa.id) AS participant_count,
             SUM(CASE WHEN p.status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS consegnati,
             COUNT(DISTINCT p.id) AS pass_count
      FROM assignment_groups ag
      LEFT JOIN groups g ON g.id=ag.group_id
      LEFT JOIN participants pa ON pa.assignment_group_id=ag.id
      LEFT JOIN passes p ON p.participant_id=pa.id AND p.status!='INVALIDATO'
      WHERE (ag.name LIKE ? OR ag.stand_name LIKE ? OR ag.zone LIKE ? OR ag.stand_code LIKE ?) ${edFilter()}
      GROUP BY ag.id ORDER BY ag.name LIMIT 80`;
    db.all(sqlP, [like,like,like,like,like,like,like], (e1, passes) => {
      db.all(sqlPa, [like,like,like,like,like], (e2, participants) => {
        db.all(sqlG, [like,like,like,like], (e3, groups) => {
          res.render('search', { q, tab, passes:passes||[], participants:participants||[], groups:groups||[] });
        });
      });
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
        WHERE (1=1) ${edFilter()}
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
      WHERE (1=1) ${edFilter()}
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


  // GET /admin/users/:id/edit — form modifica utente
  app.get('/admin/users/:id/edit', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const user = await dbGet('SELECT id, username, role, created_at FROM users WHERE id=?', [id]);
    if (!user) return res.status(404).send('Utente non trovato');
    res.render('admin_user_edit', {
      editUser: user,
      currentUser: req.session.user,
      saved: req.query.saved,
      error: req.query.error,
      ROLES
    });
  });

  // POST /admin/users/:id — aggiorna username e/o ruolo
  app.post('/admin/users/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { username, role } = req.body;
    const validRoles = Object.values(ROLES);
    if (!username || !role || !validRoles.includes(role)) {
      return res.redirect('/admin/users/'+id+'/edit?error=invalid');
    }
    // Impedisci di degradare l'unico admin
    if (id === req.session.user.id && role !== ROLES.ADMIN) {
      return res.redirect('/admin/users/'+id+'/edit?error=self-demote');
    }
    try {
      const existing = await dbGet('SELECT id FROM users WHERE username=? AND id!=?', [username, id]);
      if (existing) return res.redirect('/admin/users/'+id+'/edit?error=username-taken');
      await dbRun('UPDATE users SET username=?, role=? WHERE id=?', [username.trim(), role, id]);
      logAction(req.session.user.id, 'edit_user', 'user', id,
        `Username: ${username.trim()}, Ruolo: ${role}`);
      res.redirect('/admin/users/'+id+'/edit?saved=1');
    } catch(err) {
      console.error('Errore edit user:', err);
      res.redirect('/admin/users/'+id+'/edit?error=db');
    }
  });

  // POST /admin/users/:id/reset-password — reset password da parte dell'admin
  app.post('/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { new_password, confirm_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.redirect('/admin/users/'+id+'/edit?error=pwd-short');
    }
    if (new_password !== confirm_password) {
      return res.redirect('/admin/users/'+id+'/edit?error=pwd-mismatch');
    }
    try {
      const hash = bcrypt.hashSync(new_password, 10);
      await dbRun('UPDATE users SET password_hash=? WHERE id=?', [hash, id]);
      logAction(req.session.user.id, 'reset_user_password', 'user', id, 'Password reimpostata da admin');
      res.redirect('/admin/users/'+id+'/edit?saved=pwd');
    } catch(err) {
      console.error('Errore reset password:', err);
      res.redirect('/admin/users/'+id+'/edit?error=db');
    }
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


  // ── Gestione Materiali per Gruppo ────────────────────────────────────

  app.get('/assignment-groups/:id/materiali', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const [group, materials] = await Promise.all([
        dbGet(`SELECT ag.id, ag.name, ag.zone, ag.stand_code, ag.stand_name, g.name AS category_name
               FROM assignment_groups ag JOIN groups g ON g.id=ag.group_id WHERE ag.id=?`, [id]),
        dbAll(`SELECT * FROM group_material_requests WHERE assignment_group_id=? ORDER BY category, item_name, id`, [id])
      ]);
      if (!group) return res.status(404).send('Gruppo non trovato');
      res.render('group-materiali', { group, materials, MATERIAL_CATALOG, saved: req.query.saved || null, currentUser: req.session.user });
    } catch(err) {
      console.error('GMR GET:', err.message);
      res.status(500).send('Errore: ' + err.message);
    }
  });

  app.post('/assignment-groups/:id/materiali', requireAuth, requireNotViewer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { category, item_name, item_name_custom, subcategory, quantity, notes } = req.body;
    const finalItem = (item_name === 'custom' ? item_name_custom : item_name)?.trim();
    if (!finalItem) return res.redirect(`/assignment-groups/${id}/materiali?saved=err`);
    const edId = (_currentEdition) ? _currentEdition.id : null;
    try {
      await dbRun(
        `INSERT INTO group_material_requests (assignment_group_id, category, item_name, subcategory, quantity, notes, source, edition_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, category||'altro', finalItem, subcategory||null, parseInt(quantity,10)||1, notes||null, 'admin', edId]
      );
      logAction(req.session.user.id, 'create_gmr', 'group_material_request', id, `Materiale ${finalItem} x${quantity||1} aggiunto al gruppo ${id}`);
      res.redirect(`/assignment-groups/${id}/materiali?saved=ok`);
    } catch(err) {
      console.error('GMR POST:', err.message);
      res.redirect(`/assignment-groups/${id}/materiali?saved=err`);
    }
  });

  app.post('/assignment-groups/:id/materiali/:rid/status', requireAuth, requireNotViewer, async (req, res) => {
    const rid = parseInt(req.params.rid, 10);
    const { status, confirmed_qty, delivered_qty } = req.body;
    try {
      await dbRun(
        `UPDATE group_material_requests SET status=?, confirmed_qty=?, delivered_qty=?, updated_at=datetime('now','localtime') WHERE id=?`,
        [status||'richiesto', parseInt(confirmed_qty,10)||0, parseInt(delivered_qty,10)||0, rid]
      );
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/assignment-groups/:id/materiali/:rid', requireAuth, requireNotViewer, async (req, res) => {
    const rid = parseInt(req.params.rid, 10);
    try {
      await dbRun(`DELETE FROM group_material_requests WHERE id=?`, [rid]);
      logAction(req.session.user.id, 'delete_gmr', 'group_material_request', rid, `Richiesta materiale ${rid} eliminata`);
      res.json({ ok: true });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Resoconto Fabbisogni Logistica ────────────────────────────────────

  app.get('/admin/logistica/resoconto', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const [byItem, byGroup, inventory] = await Promise.all([
        dbAll(`SELECT category, item_name, subcategory,
                      COUNT(DISTINCT assignment_group_id) AS num_groups,
                      SUM(quantity)       AS tot_requested,
                      SUM(confirmed_qty)  AS tot_confirmed,
                      SUM(delivered_qty)  AS tot_delivered
               FROM group_material_requests
               GROUP BY category, item_name, subcategory
               ORDER BY category, item_name`),
        dbAll(`SELECT ag.id, ag.name AS group_name, ag.zone, ag.stand_code,
                      COUNT(gmr.id)           AS num_items,
                      SUM(gmr.quantity)       AS tot_requested,
                      SUM(gmr.confirmed_qty)  AS tot_confirmed,
                      GROUP_CONCAT(gmr.item_name||' x'||gmr.quantity, ', ') AS sommario
               FROM assignment_groups ag
               JOIN group_material_requests gmr ON gmr.assignment_group_id=ag.id
               GROUP BY ag.id ORDER BY ag.name`),
        dbAll(`SELECT name, category, total_qty FROM equipment ORDER BY category, name`)
      ]);
      const kpi = {
        num_gruppi:    byGroup.length,
        tot_richieste: byItem.reduce((s,r) => s+(r.tot_requested||0), 0),
        tot_confermate:byItem.reduce((s,r) => s+(r.tot_confirmed||0), 0),
        tot_consegnate:byItem.reduce((s,r) => s+(r.tot_delivered||0), 0),
      };
      res.render('logistica-resoconto', { byItem, byGroup, inventory, kpi, MATERIAL_CATALOG });
    } catch(err) {
      console.error('Resoconto GET:', err.message);
      res.status(500).send('Errore: ' + err.message);
    }
  });

  app.get('/admin/logistica/resoconto/export.csv', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const rows = await dbAll(`
        SELECT ag.name AS gruppo, ag.zone AS zona, ag.stand_code AS stand,
               gmr.category AS categoria, gmr.item_name AS articolo, gmr.subcategory AS sottocategoria,
               gmr.quantity AS richiesti, gmr.confirmed_qty AS confermati, gmr.delivered_qty AS consegnati,
               gmr.status AS stato, gmr.notes AS note, gmr.created_at AS data_richiesta
        FROM group_material_requests gmr
        JOIN assignment_groups ag ON ag.id=gmr.assignment_group_id
        ORDER BY ag.name, gmr.category, gmr.item_name`);
      const esc = v => '"'+String(v||'').replace(/"/g,'""')+'"';
      const hdr = 'Gruppo,Zona,Stand,Categoria,Articolo,Sottocategoria,Richiesti,Confermati,Consegnati,Stato,Note,Data';
      const body = rows.map(r => [r.gruppo,r.zona,r.stand,r.categoria,r.articolo,
        r.sottocategoria,r.richiesti,r.confermati||0,r.consegnati||0,
        r.stato,r.note||'',r.data_richiesta?r.data_richiesta.substring(0,16):''].map(esc).join(',')).join('\n');
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename=fabbisogni-logistica.csv');
      res.send(hdr+'\n'+body);
    } catch(err) {
      res.status(500).send('Errore export: '+err.message);
    }
  });

  app.get('/admin/logs', requireAdmin, (req, res) => {
    // ── filtri ──────────────────────────────────────────────────────────────
    const fUser    = (req.query.u    || '').trim();
    const fAction  = (req.query.a    || '').trim();
    const fEntity  = (req.query.e    || '').trim();
    const fDateFrom= (req.query.d1   || '').trim();
    const fDateTo  = (req.query.d2   || '').trim();
    const fText    = (req.query.q    || '').trim();
    const fPage    = Math.max(1, parseInt(req.query.p, 10) || 1);
    const PAGE_SIZE = 200;
    const offset    = (fPage - 1) * PAGE_SIZE;

    // costruzione WHERE dinamica
    const conditions = [];
    const params     = [];
    if (fUser)     { conditions.push("u.username = ?");         params.push(fUser); }
    if (fAction)   { conditions.push("l.action LIKE ?");        params.push('%'+fAction+'%'); }
    if (fEntity)   { conditions.push("l.entity_type = ?");      params.push(fEntity); }
    if (fDateFrom) { conditions.push("date(l.created_at) >= ?");params.push(fDateFrom); }
    if (fDateTo)   { conditions.push("date(l.created_at) <= ?");params.push(fDateTo); }
    if (fText)     { conditions.push("l.details LIKE ?");       params.push('%'+fText+'%'); }
    const WHERE = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
             u.username,
             CASE WHEN l.entity_type='participant' THEN
               (SELECT pa2.last_name||' '||pa2.first_name FROM participants pa2 WHERE pa2.id=l.entity_id)
             WHEN l.entity_type='pass' THEN
               (SELECT pa3.last_name||' '||pa3.first_name FROM participants pa3
                JOIN passes pp ON pp.participant_id=pa3.id WHERE pp.id=l.entity_id LIMIT 1)
             ELSE NULL END AS participant_name,
             CASE WHEN l.entity_type='assignment_group' THEN
               (SELECT ag2.stand_name||' / '||ag2.name FROM assignment_groups ag2 WHERE ag2.id=l.entity_id)
             WHEN l.entity_type='pass' THEN
               (SELECT ag3.name FROM assignment_groups ag3
                JOIN participants pa4 ON pa4.assignment_group_id=ag3.id
                JOIN passes pp2 ON pp2.participant_id=pa4.id WHERE pp2.id=l.entity_id LIMIT 1)
             ELSE NULL END AS group_name
      FROM action_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${WHERE}
      ORDER BY l.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;
    const sqlCount = `SELECT COUNT(*) AS total FROM action_logs l LEFT JOIN users u ON u.id=l.user_id ${WHERE}`;

    // utenti distinti per la select filtro
    const sqlUsers = `SELECT DISTINCT u2.username FROM action_logs l2 LEFT JOIN users u2 ON u2.id=l2.user_id WHERE u2.username IS NOT NULL ORDER BY u2.username`;

    // anomaly detection: deletions cluster (5+ delete in 5 min per stesso utente)
    const sqlAnomalyDel = `
      SELECT l.user_id, u.username,
             strftime('%Y-%m-%d %H:%M', datetime(l.created_at)) AS minute,
             COUNT(*) AS cnt
      FROM action_logs l LEFT JOIN users u ON u.id=l.user_id
      WHERE l.action LIKE 'delete%'
        AND l.created_at >= datetime('now', '-30 days')
      GROUP BY l.user_id, strftime('%Y-%m-%d %H:%M', datetime(l.created_at))
      HAVING cnt >= 5
      ORDER BY cnt DESC LIMIT 20`;

    // anomaly detection: login_failed cluster (3+ in 10 min)
    const sqlAnomalyLogin = `
      SELECT l.details,
             strftime('%Y-%m-%d %H:%M', datetime(l.created_at)) AS minute,
             COUNT(*) AS cnt
      FROM action_logs l
      WHERE l.action = 'login_failed'
        AND l.created_at >= datetime('now', '-7 days')
      GROUP BY l.details, strftime('%Y-%m-%d %H:%M', datetime(l.created_at))
      HAVING cnt >= 3
      ORDER BY cnt DESC LIMIT 10`;

    db.all(sql, params, (err, logs) => {
      if (err) return res.status(500).send('Errore lettura log azioni: ' + err.message);
      db.get(sqlCount, params, (e2, countRow) => {
        db.all(sqlUsers, [], (e3, users) => {
          db.all(sqlAnomalyDel, [], (e4, anomalyDel) => {
            db.all(sqlAnomalyLogin, [], (e5, anomalyLogin) => {
              // set di id anomali per highlight
              const anomalySet = new Set();
              (anomalyDel||[]).forEach(a => {
                (logs||[]).forEach(l => {
                  if (l.username === a.username && l.action && l.action.startsWith('delete') &&
                      l.created_at && l.created_at.startsWith(a.minute)) {
                    anomalySet.add(l.id);
                  }
                });
              });
              (anomalyLogin||[]).forEach(a => {
                (logs||[]).forEach(l => {
                  if (l.action === 'login_failed' && l.created_at && l.created_at.startsWith(a.minute)) {
                    anomalySet.add(l.id);
                  }
                });
              });
              res.render('logs', {
                logs: logs||[],
                total: countRow ? countRow.total : 0,
                page: fPage, pageSize: PAGE_SIZE,
                users: users||[],
                filters: { u: fUser, a: fAction, e: fEntity, d1: fDateFrom, d2: fDateTo, q: fText },
                anomalyDel: anomalyDel||[],
                anomalyLogin: anomalyLogin||[],
                anomalyIds: Array.from(anomalySet)
              });
            });
          });
        });
      });
    });
  });


  app.get('/account/security', requireAuth, (req, res) => {
    res.render('security');
  });


  // ════════════════════════════════════════════════
  // AUTO-PASS (pass parcheggio per gruppo)
  // ════════════════════════════════════════════════

  // Funzione generazione PDF auto-pass
  async function generateAutoPass(group, passNumber, totalPasses, apSettings) {
    const templatePath = path.join(process.env.DATA_DIR || __dirname, 'templates', apSettings.ap_template || 'auto_pass_template.pdf');
    if (!require('fs').existsSync(templatePath)) throw new Error('Template auto-pass non trovato. Caricalo nelle Impostazioni > Pass Auto.');
    const templateBytes = require('fs').readFileSync(templatePath);
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const standName = sanitizeForPdf((group.stand_name || group.name || '').toUpperCase());
    const N = parseInt(apSettings.ap_esp_size||20,10);
    // Nome espositore
    page.drawText(standName, { x: parseInt(apSettings.ap_esp_x||350,10), y: parseInt(apSettings.ap_esp_y||125,10), size: N, font: boldFont, color: rgb(0,0,0) });
    // n. X
    page.drawText(String(passNumber), { x: parseInt(apSettings.ap_num_x||95,10), y: parseInt(apSettings.ap_num_y||125,10), size: N, font: boldFont, color: rgb(0,0,0) });
    // di Y
    page.drawText(String(totalPasses), { x: parseInt(apSettings.ap_tot_x||95,10), y: parseInt(apSettings.ap_tot_y||95,10), size: N, font: boldFont, color: rgb(0,0,0) });
    // QR tracking
    const code = generateRandomCode(18);
    const bwipjs = require('bwip-js');
    const qrPng = await bwipjs.toBuffer({ bcid:'qrcode', text:code, scale:4, backgroundcolor:'FFFFFF' });
    const qrImg = await pdfDoc.embedPng(qrPng);
    const qrSz = parseInt(apSettings.ap_qr_size||80,10);
    page.drawImage(qrImg, { x: parseInt(apSettings.ap_qr_x||660,10), y: parseInt(apSettings.ap_qr_y||45,10), width: qrSz, height: qrSz });
    const pdfBytes = await pdfDoc.save();
    return { pdfBytes, code };
  }

  // Aggiorna o imposta max_auto_passes per il gruppo
  app.post('/assignment-groups/:id/max-auto-passes', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const val = Math.max(0, parseInt(req.body.max_auto_passes||0,10));
    db.run('UPDATE assignment_groups SET max_auto_passes=? WHERE id=?',[val,id], err=>{
      if(err) return res.status(500).json({ok:false});
      logAction(req.session.user.id,'set_max_auto_passes','assignment_group',id,'Limite auto-pass impostato a '+val);
      res.redirect('/assignment-groups/'+id);
    });
  });

  // Genera auto-pass per il gruppo
  app.post('/assignment-groups/:id/auto-passes/generate', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get('SELECT ag.*, g.name AS category_name FROM assignment_groups ag JOIN groups g ON g.id=ag.group_id WHERE ag.id=?',[id],(err,group)=>{
      if(err||!group) return res.status(404).send('Gruppo non trovato');
      const total = group.max_auto_passes||0;
      if(total<1) return res.status(400).send('Imposta prima il numero massimo di pass auto per questo gruppo.');
      db.all('SELECT * FROM app_settings',[],async(e2,rows)=>{
        const S = {};
        (rows||[]).forEach(r=>{ S[r.key]=r.value; });
        // Invalida vecchi (se presenti)
        db.run("UPDATE auto_passes SET status='INVALIDATO' WHERE assignment_group_id=?",[id],async()=>{
          // Cancella PDF vecchi
          db.all('SELECT pdf_file FROM auto_passes WHERE assignment_group_id=?',[id],(e3,oldPasses)=>{
            (oldPasses||[]).forEach(op=>{ if(op.pdf_file){ try{ require('fs').unlinkSync(path.join(process.env.DATA_DIR||__dirname,'generated',op.pdf_file)); }catch(_){} } });
          });
          db.run('DELETE FROM auto_passes WHERE assignment_group_id=?',[id],async()=>{
            const generated = [];
            try {
              for(let i=1;i<=total;i++){
                const {pdfBytes, code} = await generateAutoPass(group, i, total, S);
                const filename = 'autopass_'+id+'_'+i+'_'+Date.now()+'.pdf';
                require('fs').writeFileSync(path.join(process.env.DATA_DIR||__dirname,'generated',filename),pdfBytes);
                await new Promise((resolve,reject)=>{
                  db.run('INSERT INTO auto_passes(assignment_group_id,code,status,pdf_file,pass_number,total_passes)VALUES(?,?,?,?,?,?)',
                    [id,code,'GENERATO',filename,i,total],function(e4){ if(e4)reject(e4); else resolve(this.lastID); });
                });
                logAction(req.session.user.id,'generate_auto_pass','assignment_group',id,'Auto-pass '+i+'/'+total+' generato per '+group.name);
              }
              res.redirect('/assignment-groups/'+id+'?ap_ok=1');
            } catch(ex) {
              res.status(500).send('Errore generazione: '+ex.message);
            }
          });
        });
      });
    });
  });

  // Download PDF singolo auto-pass
  app.get('/auto-passes/:id/pdf', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.get('SELECT ap.*, ag.name AS group_name FROM auto_passes ap JOIN assignment_groups ag ON ag.id=ap.assignment_group_id WHERE ap.id=?',[id],(err,ap)=>{
      if(err||!ap||!ap.pdf_file) return res.status(404).send('Pass non trovato');
      const fpath = path.join(process.env.DATA_DIR||__dirname,'generated',ap.pdf_file);
      if(!require('fs').existsSync(fpath)) return res.status(404).send('File non trovato');
      db.run("UPDATE auto_passes SET status='SCARICATO' WHERE id=? AND status='GENERATO'",[id]);
      db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[id,'SCARICATO',req.session.user.id]);
      logAction(req.session.user.id,'download_auto_pass','auto_pass',id,'Auto-pass scaricato');
      res.download(fpath, 'pass_auto_'+ap.group_name+'_'+ap.pass_number+'.pdf');
    });
  });

  // Batch PDF auto-pass gruppo
  app.get('/assignment-groups/:id/auto-passes/batch-pdf', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.all("SELECT * FROM auto_passes WHERE assignment_group_id=? AND status!='INVALIDATO' ORDER BY pass_number",[id],async(err,passes)=>{
      if(err||!passes.length) return res.status(404).send('Nessun auto-pass disponibile');
      const { PDFDocument } = require('pdf-lib');
      const merged = await PDFDocument.create();
      for(const p of passes){
        const fpath = path.join(process.env.DATA_DIR||__dirname,'generated',p.pdf_file||'');
        if(!require('fs').existsSync(fpath)) continue;
        const bytes = require('fs').readFileSync(fpath);
        const src = await PDFDocument.load(bytes);
        const [page] = await merged.copyPages(src,[0]);
        merged.addPage(page);
        if(p.status==='GENERATO') db.run("UPDATE auto_passes SET status='SCARICATO' WHERE id=?",[p.id]);
      }
      const out = await merged.save();
      db.get('SELECT name FROM assignment_groups WHERE id=?',[id],(e2,g)=>{
        logAction(req.session.user.id,'batch_auto_pass','assignment_group',id,'Batch auto-pass scaricato');
        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Disposition','attachment; filename="autopass_batch_'+encodeURIComponent(g?g.name:'gruppo')+'.pdf"');
        res.send(Buffer.from(out));
      });
    });
  });

  // Aggiorna stato auto-pass
  app.post('/auto-passes/:id/status', requireAuth, requireNotViewer, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const {status} = req.body;
    const valid = ['SCARICATO','STAMPATO','CONSEGNATO','RICONSEGNATO'];
    if(!valid.includes(status)) return res.status(400).send('Stato non valido');
    db.run("UPDATE auto_passes SET status=? WHERE id=? AND status!='INVALIDATO'",[status,id], err=>{
      if(err) return res.status(500).send('Errore DB');
      db.run('INSERT INTO pass_status_history(pass_id,status,user_id)VALUES(?,?,?)',[id,status,req.session.user.id]);
      logAction(req.session.user.id,'status_auto_pass','auto_pass',id,'Stato auto-pass aggiornato a '+status);
      db.get('SELECT assignment_group_id FROM auto_passes WHERE id=?',[id],(e2,ap)=>{
        res.redirect('/assignment-groups/'+(ap?ap.assignment_group_id:'')); });
    });
  });

  // Invalida auto-pass
  app.post('/auto-passes/:id/invalidate', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.run("UPDATE auto_passes SET status='INVALIDATO' WHERE id=?",[id], err=>{
      if(err) return res.status(500).send('Errore DB');
      logAction(req.session.user.id,'invalidate_auto_pass','auto_pass',id,'Auto-pass invalidato');
      db.get('SELECT assignment_group_id FROM auto_passes WHERE id=?',[id],(e2,ap)=>{
        res.redirect('/assignment-groups/'+(ap?ap.assignment_group_id:'')); });
    });
  });

  // Upload template PDF auto-pass (admin only)
  app.post('/admin/settings/auto-pass-template', requireAuth, requireAdmin,
    require('multer')({dest: path.join(process.env.DATA_DIR||__dirname,'uploads','tmp')}).single('auto_pass_template'),
    (req, res) => {
      if(!req.file) return res.status(400).send('File richiesto');
      const ext = path.extname(req.file.originalname).toLowerCase();
      if(ext!=='.pdf') { require('fs').unlinkSync(req.file.path); return res.status(400).send('Solo file PDF'); }
      const dest = path.join(process.env.DATA_DIR||__dirname,'templates','auto_pass_template.pdf');
      require('fs').mkdirSync(path.dirname(dest),{recursive:true});
      require('fs').copyFileSync(req.file.path, dest);
      require('fs').unlinkSync(req.file.path);
      db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES('ap_template','auto_pass_template.pdf')",()=>{
        logAction(req.session.user.id,'upload_auto_pass_template','settings',0,'Template auto-pass aggiornato');
        res.redirect('/admin/settings?tab=auto_pass&saved=1');
      });
    });

  // Salva coordinate auto-pass
  app.post('/admin/settings/auto-pass-coords', requireAuth, requireAdmin, (req, res) => {
    const keys = ['ap_esp_x','ap_esp_y','ap_esp_size','ap_num_x','ap_num_y','ap_tot_x','ap_tot_y','ap_qr_x','ap_qr_y','ap_qr_size'];
    let done = 0;
    keys.forEach(k=>{
      if(req.body[k]!==undefined){
        db.run("INSERT OR REPLACE INTO app_settings(key,value)VALUES(?,?)",[k,parseInt(req.body[k],10)||0],()=>{
          if(++done===keys.length) res.redirect('/admin/settings?tab=auto_pass&saved=1');
        });
      } else { if(++done===keys.length) res.redirect('/admin/settings?tab=auto_pass&saved=1'); }
    });
  });


  // ════════════════════════════════════════════════
  // AUTO-PASS (pass parcheggio per gruppo)
  // ════════════════════════════════════════════════

  async function generateAutoPass(group, passNumber, totalPasses, apSettings) {
    const templatePath = path.join(process.env.DATA_DIR || __dirname, 'templates', apSettings.ap_template || 'auto_pass_template.pdf');
    if (!fs.existsSync(templatePath)) throw new Error('Template auto-pass non trovato. Caricalo in Impostazioni > Pass Auto.');
    const templateBytes = fs.readFileSync(templatePath);
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const standName = sanitizeForPdf((group.stand_name || group.name || '').toUpperCase());
    const N = parseInt(apSettings.ap_esp_size||20,10);
    page.drawText(standName,    { x:parseInt(apSettings.ap_esp_x||350,10), y:parseInt(apSettings.ap_esp_y||125,10), size:N, font:boldFont, color:rgb(0,0,0) });
    page.drawText(String(passNumber), { x:parseInt(apSettings.ap_num_x||95,10), y:parseInt(apSettings.ap_num_y||125,10), size:N, font:boldFont, color:rgb(0,0,0) });
    page.drawText(String(totalPasses),{ x:parseInt(apSettings.ap_tot_x||95,10), y:parseInt(apSettings.ap_tot_y||95,10), size:N, font:boldFont, color:rgb(0,0,0) });
    const code = generateRandomCode(18);
    const bwipjs = require('bwip-js');
    const qrPng = await bwipjs.toBuffer({ bcid:'qrcode', text:code, scale:4, backgroundcolor:'FFFFFF' });
    const qrImg = await pdfDoc.embedPng(qrPng);
    const qrSz  = parseInt(apSettings.ap_qr_size||80,10);
    page.drawImage(qrImg, { x:parseInt(apSettings.ap_qr_x||660,10), y:parseInt(apSettings.ap_qr_y||45,10), width:qrSz, height:qrSz });
    return { pdfBytes: await pdfDoc.save(), code };
  }



  // ════════════════════════════════════════════════════════
  // MOD.5 — ACCREDITAMENTO ESPOSITORI
  // ════════════════════════════════════════════════════════

  // GET — form pubblica (no auth)

  // ══════════════════════════════════════════════════════
  // EDIZIONI — gestione multi-anno
  // ══════════════════════════════════════════════════════

  // Crea nuova edizione
  app.post('/admin/editions', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, year } = req.body;
      if (!name || !name.trim()) return res.redirect('/admin/settings?tab=edizioni&err=nome');
      const yearInt = parseInt(year, 10);
      if (!yearInt || isNaN(yearInt)) return res.redirect('/admin/settings?tab=edizioni&err=anno');
      await dbRun('INSERT INTO editions (name, year, is_current) VALUES (?,?,0)', name.trim(), yearInt);
      logAction(req.session.user.id, 'create_edition', 'edition', null, `Creata edizione: ${name.trim()}`);
      res.redirect('/admin/settings?tab=edizioni&saved=1');
    } catch(e) {
      console.error('Errore creazione edizione:', e.message);
      res.redirect('/admin/settings?tab=edizioni&err=db');
    }
  });

  // Imposta edizione corrente
  app.post('/admin/editions/:id/set-current', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await dbRun('UPDATE editions SET is_current=0');
      await dbRun('UPDATE editions SET is_current=1 WHERE id=?', id);
      refreshCurrentEdition(function() {
        if (_currentEdition) {
          db.run('UPDATE assignment_groups SET edition_id=? WHERE edition_id IS NULL', [_currentEdition.id]);
        }
      });
      logAction(req.session.user.id, 'set_current_edition', 'edition', id, 'Edizione corrente aggiornata');
      res.redirect('/admin/settings?tab=edizioni&saved=1');
    } catch(e) {
      console.error('Errore set-current edizione:', e.message);
      res.redirect('/admin/settings?tab=edizioni&err=db');
    }
  });

  // Elimina edizione (solo se non corrente e senza gruppi associati)
  app.post('/admin/editions/:id/delete', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const ed  = await dbGet('SELECT * FROM editions WHERE id=?', id);
      if (!ed) return res.redirect('/admin/settings?tab=edizioni&err=notfound');
      if (ed.is_current) return res.redirect('/admin/settings?tab=edizioni&err=current');
      const cnt = await dbGet('SELECT COUNT(*) AS n FROM assignment_groups WHERE edition_id=?', id);
      if (cnt && cnt.n > 0) return res.redirect('/admin/settings?tab=edizioni&err=inuse');
      await dbRun('DELETE FROM editions WHERE id=?', id);
      logAction(req.session.user.id, 'delete_edition', 'edition', id, `Eliminata edizione ${ed.name}`);
      res.redirect('/admin/settings?tab=edizioni&saved=1');
    } catch(e) {
      console.error('Errore delete edizione:', e.message);
      res.redirect('/admin/settings?tab=edizioni&err=db');
    }
  });

  app.get('/richiesta-accreditamento', (req, res) => {
    res.render('accreditation-request', {
      sent:  req.query.sent  || null,
      error: req.query.error || null
    });
  });

  app.get('/richiesta-accreditamento/espositori', (req, res) => {
    res.render('accreditation-request-espositori', {
      sent:  req.query.sent  || null,
      error: req.query.error || null
    });
  });

  app.get('/richiesta-accreditamento/media', (req, res) => {
    res.render('accreditation-request-media', {
      sent:  req.query.sent  || null,
      error: req.query.error || null
    });
  });

  // POST — invio richiesta
  app.post('/richiesta-accreditamento', async (req, res) => {
    const { company_name, contact_name, email, phone,
            stand_type, stand_size, accreditation_type,
            media_outlet, press_role, publisher, genre,
            channel_url, platform, subscribers, notes } = req.body;
    if (!company_name || !contact_name || !email) {
      return res.redirect('/richiesta-accreditamento?error=campi_obbligatori');
    }
    try {
      await dbRun(
        `INSERT INTO accreditation_requests
          (company_name, contact_name, email, phone, stand_type, stand_size,
           accreditation_type, media_outlet, press_role, publisher, genre,
           channel_url, platform, subscribers, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        company_name.trim(), contact_name.trim(), email.trim().toLowerCase(),
        phone || null, stand_type || null, stand_size || null,
        accreditation_type || 'espositore',
        media_outlet || null, press_role || null, publisher || null, genre || null,
        channel_url || null, platform || null, subscribers || null,
        notes || null
      );
      createNotification(
        'accreditation', 'Nuova richiesta accreditamento',
        `<strong>${company_name}</strong> (${contact_name}) ha inviato una richiesta di accreditamento.`,
        null, null
      );
      const accTypeLabel = {espositore:'🏪 Espositore',stampa:'📰 Stampa/Media',autore:'✍️ Autore',content_creator:'🎥 Content Creator'};
      trySendEmail(
        'Nuova richiesta accreditamento — ' + (accTypeLabel[accreditation_type||'espositore']||accreditation_type),
        '<p>' + (accTypeLabel[accreditation_type||'espositore']||'') + ' <strong>' + company_name + '</strong> — ' + contact_name + ' (' + email + ')</p>' +
        (stand_type ? '<p>Stand: ' + stand_type + ' — ' + (stand_size||'n/d') + '</p>' : '') +
        (media_outlet ? '<p>Testata: ' + media_outlet + (press_role ? ' (' + press_role + ')' : '') + '</p>' : '') +
        (channel_url ? '<p>Canale: <a href="' + channel_url + '">' + channel_url + '</a> (' + (platform||'?') + ', ' + (subscribers||'?') + ' follower)</p>' : '') +
        (publisher ? '<p>Editore: ' + publisher + (genre ? ' — ' + genre : '') + '</p>' : '') +
        (notes ? '<p>Note: ' + notes + '</p>' : '') +
        '<p><a href="' + (process.env.BASE_URL || '') + '/admin/accreditamento">→ Gestisci richieste</a></p>'
      );
      res.redirect('/richiesta-accreditamento?sent=1');
    } catch (e) {
      console.error('Errore invio accreditamento:', e.message);
      res.redirect('/richiesta-accreditamento?error=db');
    }
  });

  app.post('/richiesta-accreditamento/espositori', async (req, res) => {
    const { company_name, contact_name, email, phone,
            stand_type, stand_size, accreditation_type, notes } = req.body;
    if (!company_name || !contact_name || !email) {
      return res.redirect('/richiesta-accreditamento/espositori?error=campi_obbligatori');
    }
    try {
      await dbRun(
        `INSERT INTO accreditation_requests
          (company_name, contact_name, email, phone, stand_type, stand_size,
           accreditation_type, media_outlet, press_role, publisher, genre,
           channel_url, platform, subscribers, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [company_name.trim(), contact_name.trim(), email.trim().toLowerCase(),
        phone||null, stand_type||null, stand_size||null,
        accreditation_type||'espositore',
        null, null, null, null, null, null, null,
        notes||null]
      );
      const accTypeLabel = {espositore:'🏪 Espositore',stampa:'📰 Stampa/Media',autore:'✍️ Autore',content_creator:'🎥 Content Creator'};
      createNotification('accreditation','Nuova richiesta accreditamento',`<strong>${company_name}</strong> (${contact_name}) ha inviato una richiesta di accreditamento.`,null,null);
      trySendEmail(
        'Nuova richiesta — '+(accTypeLabel[accreditation_type||'espositore']||accreditation_type),
        '<p>'+(accTypeLabel[accreditation_type||'espositore']||'')+' <strong>'+company_name+'</strong> — '+contact_name+' ('+email+')</p>'+
        (stand_type?'<p>Stand: '+stand_type+' — '+(stand_size||'n/d')+'</p>':'')+
        (notes?'<p>Note: '+notes+'</p>':'')+
        '<p><a href="'+(process.env.BASE_URL||'')+'/admin/accreditamento">→ Gestisci richieste</a></p>'
      );
      res.redirect('/richiesta-accreditamento/espositori?sent=1');
    } catch (e) {
      console.error('Errore invio accreditamento espositori:', e.message);
      res.redirect('/richiesta-accreditamento/espositori?error=db');
    }
  });

  app.post('/richiesta-accreditamento/media', async (req, res) => {
    const { company_name, contact_name, email, phone,
            accreditation_type, media_outlet, press_role,
            publisher, genre, channel_url, platform, subscribers, notes } = req.body;
    if (!company_name || !contact_name || !email) {
      return res.redirect('/richiesta-accreditamento/media?error=campi_obbligatori');
    }
    try {
      await dbRun(
        `INSERT INTO accreditation_requests
          (company_name, contact_name, email, phone, stand_type, stand_size,
           accreditation_type, media_outlet, press_role, publisher, genre,
           channel_url, platform, subscribers, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [company_name.trim(), contact_name.trim(), email.trim().toLowerCase(),
        phone||null, null, null,
        accreditation_type||'stampa',
        media_outlet||null, press_role||null, publisher||null, genre||null,
        channel_url||null, platform||null, subscribers||null,
        notes||null]
      );
      const accTypeLabel = {espositore:'🏪 Espositore',stampa:'📰 Stampa/Media',autore:'✍️ Autore',content_creator:'🎥 Content Creator'};
      createNotification('accreditation','Nuova richiesta accreditamento',`<strong>${company_name}</strong> (${contact_name}) ha inviato una richiesta di accreditamento.`,null,null);
      trySendEmail(
        'Nuova richiesta — '+(accTypeLabel[accreditation_type||'stampa']||accreditation_type),
        '<p>'+(accTypeLabel[accreditation_type||'stampa']||'')+' <strong>'+company_name+'</strong> — '+contact_name+' ('+email+')</p>'+
        (media_outlet?'<p>Testata: '+media_outlet+(press_role?' ('+press_role+')':'')+' </p>':'')+
        (channel_url?'<p>Canale: <a href="'+channel_url+'">'+channel_url+'</a> ('+(platform||'?')+', '+(subscribers||'?')+' follower)</p>':'')+
        (publisher?'<p>Editore: '+publisher+(genre?' — '+genre:'')+' </p>':'')+
        (notes?'<p>Note: '+notes+'</p>':'')+
        '<p><a href="'+(process.env.BASE_URL||'')+'/admin/accreditamento">→ Gestisci richieste</a></p>'
      );
      res.redirect('/richiesta-accreditamento/media?sent=1');
    } catch (e) {
      console.error('Errore invio accreditamento media:', e.message);
      res.redirect('/richiesta-accreditamento/media?error=db');
    }
  });

  // GET — dashboard admin
  
// ── Admin Hub ─────────────────────────────────────────────────────────
app.get('/admin/hub', requireAuth, requireOrganizer, function(req, res) {
  res.render('admin_hub', { currentUser: req.session.user });
});

app.get('/admin/accreditamento', requireAuth, requireOrganizer, async (req, res) => {
    try {
      const requests = await dbAll(
        `SELECT ar.*, u.username AS reviewer_name
         FROM accreditation_requests ar
         LEFT JOIN users u ON u.id = ar.reviewed_by
         ORDER BY CASE ar.status WHEN 'in_attesa' THEN 0 ELSE 1 END, ar.created_at DESC`
      );
      const groups = await dbAll(`SELECT id, name FROM groups ORDER BY priority, name`);
      res.render('admin-accreditamento', { requests, groups, saved: req.query.saved || null });
    } catch (e) {
      res.status(500).send('Errore interno: ' + e.message);
    }
  });

  // POST — approva → crea assignment_group + contatto + email
  app.post('/admin/accreditamento/:id/approva', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { group_id, zone, stand_name, max_passes } = req.body;
    try {
      const request = await dbGet(`SELECT * FROM accreditation_requests WHERE id=?`, id);
      if (!request) return res.status(404).send('Richiesta non trovata');
      const crypto = require('crypto');
      const portalToken = crypto.randomBytes(24).toString('hex');

      // Espositori e associazioni → hanno stand/zona; tutti gli altri no
      const isExhibitor = ['espositore','associazione'].includes(
        (request.accreditation_type || 'espositore').toLowerCase()
      );
      const resolvedStand  = isExhibitor ? (stand_name || request.company_name) : null;
      const resolvedZone   = isExhibitor ? (zone || null) : null;
      const resolvedPasses = max_passes ? parseInt(max_passes, 10) : (isExhibitor ? null : 1);

      const result = await dbRun(
        `INSERT INTO assignment_groups
          (name, group_id, zone, stand_name, max_passes, email, portal_token, portal_enabled, contract_status, edition_id)
         VALUES (?,?,?,?,?,?,?,1,'bozza',?)`,
        request.company_name,
        group_id ? parseInt(group_id, 10) : null,
        resolvedZone,
        resolvedStand,
        resolvedPasses,
        request.email,
        portalToken,
        edVal()
      );
      const newGroupId = result.lastID;
      await dbRun(
        `INSERT INTO contacts (assignment_group_id, name, email, phone, role, is_primary)
         VALUES (?,?,?,?,?,1)`,
        newGroupId, request.contact_name, request.email, request.phone || null, 'referente'
      );
      await dbRun(
        `UPDATE accreditation_requests
         SET status='portale_attivato', reviewed_by=?, reviewed_at=datetime('now','localtime'), assignment_group_id=?
         WHERE id=?`,
        req.session.user.id, newGroupId, id
      );
      const portalUrl = (process.env.BASE_URL || '') + '/portale/' + portalToken;
      trySendEmail(
        'Accreditamento approvato — accedi al tuo portale',
        '<p>Gentile <strong>' + request.contact_name + '</strong>,</p>' +
        '<p>La tua richiesta di accreditamento per <strong>' + request.company_name + '</strong> è stata <strong>approvata</strong>!</p>' +
        '<p style="margin:1.5rem 0"><a href="' + portalUrl + '" style="background:#1e2d4e;color:#f5c842;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700">Accedi al tuo Portale</a></p>' +
        '<p>Link diretto: <a href="' + portalUrl + '">' + portalUrl + '</a></p>' +
        '<p><em>Conserva questo link — è il tuo accesso personale.</em></p>'
      );
      logAction(req.session.user.id, 'approve_accreditation', 'accreditation_request', id,
        'Approvata richiesta ' + request.company_name + ' → gruppo ' + newGroupId);
      createNotification('accreditation', 'Richiesta approvata',
        'Accreditamento <strong>' + request.company_name + '</strong> approvato. Portale attivato.', null, null);
      res.redirect('/admin/accreditamento?saved=approvato');
    } catch (e) {
      console.error('Errore approvazione accreditamento:', e.message);
      res.status(500).send('Errore: ' + e.message);
    }
  });

  // POST — rifiuta con motivazione
  app.post('/admin/accreditamento/:id/rifiuta', requireAuth, requireOrganizer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rejection_reason } = req.body;
    try {
      const request = await dbGet(`SELECT * FROM accreditation_requests WHERE id=?`, id);
      if (!request) return res.status(404).send('Richiesta non trovata');
      await dbRun(
        `UPDATE accreditation_requests
         SET status='rifiutato', reviewed_by=?, reviewed_at=datetime('now','localtime'), rejection_reason=?
         WHERE id=?`,
        req.session.user.id, rejection_reason || null, id
      );
      trySendEmail(
        'Aggiornamento sulla tua richiesta di accreditamento',
        '<p>Gentile <strong>' + request.contact_name + '</strong>,</p>' +
        '<p>La richiesta di accreditamento per <strong>' + request.company_name + '</strong> non ha potuto essere accettata.</p>' +
        (rejection_reason ? '<p>Motivazione: ' + rejection_reason + '</p>' : '') +
        '<p>Per informazioni puoi rispondere a questa email.</p>'
      );
      logAction(req.session.user.id, 'reject_accreditation', 'accreditation_request', id,
        'Rifiutata richiesta ' + request.company_name);
      res.redirect('/admin/accreditamento?saved=rifiutato');
    } catch (e) {
      console.error('Errore rifiuto accreditamento:', e.message);
      res.status(500).send('Errore: ' + e.message);
    }
  });


  // ══════════════════════════════════════════════════════════════════════
  // CANDIDATURA VOLONTARIO — form pubblico + gestione candidature
  // ══════════════════════════════════════════════════════════════════════

  // Form pubblico (no auth)
  app.get('/candidatura-volontario', async (req, res) => {
    try {
      const settings = {};
      const rows = await dbAll("SELECT key,value FROM app_settings");
      rows.forEach(r => { settings[r.key] = r.value; });
      const eventName = settings.event_name || 'Ludicomix';
      res.render('candidatura_volontario', { eventName, sent: false, error: null });
    } catch (e) {
      res.render('candidatura_volontario', { eventName: 'Ludicomix', sent: false, error: null });
    }
  });

  // Submit form pubblico
  app.post('/candidatura-volontario', async (req, res) => {
    try {
      const settings = {};
      const rows = await dbAll("SELECT key,value FROM app_settings");
      rows.forEach(r => { settings[r.key] = r.value; });
      const eventName = settings.event_name || 'Ludicomix';

      const {
        first_name, last_name, email, phone,
        birth_date, birth_place, fiscal_code, residence,
        skills, availability, notes, privacy
      } = req.body;

      if (!String(first_name||'').trim() || !String(last_name||'').trim()) {
        return res.render('candidatura_volontario', { eventName, sent: false, error: 'Nome e cognome sono obbligatori.' });
      }
      if (!email || !String(email).includes('@')) {
        return res.render('candidatura_volontario', { eventName, sent: false, error: 'Inserisci un indirizzo email valido.' });
      }
      if (!privacy) {
        return res.render('candidatura_volontario', { eventName, sent: false, error: 'Devi accettare il trattamento dei dati personali per procedere.' });
      }

      // Determina edition_id corrente
      let edId = (_currentEdition && _currentEdition.id) ? _currentEdition.id : null;
      if (!edId) {
        const cur = await dbGet('SELECT id FROM editions WHERE is_current=1 LIMIT 1');
        if (cur) edId = cur.id;
      }
      if (!edId) {
        const any = await dbGet('SELECT id FROM editions ORDER BY id DESC LIMIT 1');
        if (any) edId = any.id;
      }
      if (!edId) edId = 1;

      const fn = String(first_name).trim();
      const ln = String(last_name).trim();
      const fc = fiscal_code ? String(fiscal_code).toUpperCase().trim() : null;

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO volunteers
            (edition_id, first_name, last_name, email, phone, availability, skills, status, notes,
             birth_date, birth_place, fiscal_code, residence, active, import_batch_id, tshirt_size)
           VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?,1,NULL,NULL)`,
          [edId, fn, ln, email||null, phone||null, availability||'', skills||'', notes||null,
           birth_date||null, birth_place||null, fc, residence||null],
          function(err) { err ? reject(err) : resolve(this.lastID); }
        );
      });

      // Email di conferma al candidato
      if (email) {
        db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'", [], function(e, smtpRows) {
          if (e || !smtpRows) return;
          const c = {};
          smtpRows.forEach(r => { c[r.key] = r.value; });
          if (!c.smtp_host) return;
          nodemailer.createTransport({
            host: c.smtp_host, port: parseInt(c.smtp_port||'587',10),
            secure: c.smtp_secure==='1',
            auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
            tls: { rejectUnauthorized: false }
          }).sendMail({
            from: c.smtp_from || 'noreply@ludicomix.it',
            to: email,
            subject: `[${eventName}] Candidatura volontario ricevuta`,
            html: `<div style="font-family:sans-serif;max-width:560px">
              <h2 style="color:#1e2d4e">Grazie, ${fn}!</h2>
              <p>Abbiamo ricevuto la tua candidatura come volontario per <strong>${eventName}</strong>.</p>
              <p>La valuteremo al più presto e ti contatteremo a questo indirizzo email.</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:1.5rem 0">
              <p style="font-size:.85rem;color:#64748b">Non rispondere a questa email — per info scrivi agli organizzatori.</p>
            </div>`
          }, err2 => { if (err2) console.error('[Candidatura email candidato]', err2.message); });
        });
      }

      // Notifica agli organizzatori
      trySendEmail(
        `Nuova candidatura volontario — ${fn} ${ln}`,
        `<p>Nuova candidatura ricevuta dal form pubblico:</p>
         <table style="border-collapse:collapse;font-size:.9rem">
           <tr><td style="padding:.3rem .75rem;color:#64748b">Nome</td><td style="padding:.3rem .75rem;font-weight:600">${fn} ${ln}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Email</td><td style="padding:.3rem .75rem">${email||'—'}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Telefono</td><td style="padding:.3rem .75rem">${phone||'—'}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Competenze</td><td style="padding:.3rem .75rem">${skills||'—'}</td></tr>
           <tr><td style="padding:.3rem .75rem;color:#64748b">Disponibilità</td><td style="padding:.3rem .75rem">${availability||'—'}</td></tr>
         </table>
         <p style="margin-top:1rem"><a href="/volunteers" style="background:#1e2d4e;color:#f5c842;padding:.5rem 1rem;border-radius:6px;text-decoration:none;font-weight:700">Vai alle candidature →</a></p>`
      );

      res.render('candidatura_volontario', { eventName, sent: true, error: null });
    } catch (err) {
      console.error('[Candidatura POST]', err.message);
      res.render('candidatura_volontario', { eventName: 'Ludicomix', sent: false, error: 'Errore interno — riprova tra qualche istante.' });
    }
  });

  // Accetta candidatura (admin/organizer)
  app.post('/volunteers/:id/accept', requireAuth, requireNotViewer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const vol = await dbGet('SELECT * FROM volunteers WHERE id=?', [id]);
      if (!vol) return res.status(404).send('Volontario non trovato');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE volunteers SET status='approved', active=1,
           reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?`,
          [req.session.user.id, id],
          err => err ? reject(err) : resolve());
      });
      logAction(req.session.user.id, 'accept_volunteer', 'volunteer', id, `Candidatura #${id} accettata`);
      // Email al candidato
      if (vol.email) {
        const settings = {};
        const rows = await dbAll("SELECT key,value FROM app_settings");
        rows.forEach(r => { settings[r.key] = r.value; });
        const eventName = settings.event_name || 'Ludicomix';
        db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'", [], function(e, smtpRows) {
          if (e || !smtpRows) return;
          const c = {};
          smtpRows.forEach(r => { c[r.key] = r.value; });
          if (!c.smtp_host) return;
          nodemailer.createTransport({
            host: c.smtp_host, port: parseInt(c.smtp_port||'587',10),
            secure: c.smtp_secure==='1',
            auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
            tls: { rejectUnauthorized: false }
          }).sendMail({
            from: c.smtp_from || 'noreply@ludicomix.it',
            to: vol.email,
            subject: `[${eventName}] Candidatura accettata 🎉`,
            html: `<div style="font-family:sans-serif;max-width:560px">
              <h2 style="color:#065f46">Benvenuto/a nel team, ${vol.first_name}!</h2>
              <p>La tua candidatura come volontario per <strong>${eventName}</strong> è stata <strong>accettata</strong>.</p>
              <p>Ti contatteremo presto con maggiori dettagli sui turni e le attività.</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:1.5rem 0">
              <p style="font-size:.85rem;color:#64748b">Non rispondere a questa email — per info scrivi agli organizzatori.</p>
            </div>`
          }, err2 => { if (err2) console.error('[Accept email]', err2.message); });
        });
      }
      res.redirect('/volunteers#candidature');
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  // Rifiuta candidatura
  app.post('/volunteers/:id/reject', requireAuth, requireNotViewer, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rejection_reason } = req.body;
    try {
      const vol = await dbGet('SELECT * FROM volunteers WHERE id=?', [id]);
      if (!vol) return res.status(404).send('Volontario non trovato');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE volunteers SET status='rejected', active=0,
           reviewed_by=?, reviewed_at=datetime('now','localtime'),
           rejection_reason=? WHERE id=?`,
          [req.session.user.id, rejection_reason||null, id],
          err => err ? reject(err) : resolve());
      });
      logAction(req.session.user.id, 'reject_volunteer', 'volunteer', id, `Candidatura #${id} rifiutata`);
      if (vol.email) {
        const settings = {};
        const rows = await dbAll("SELECT key,value FROM app_settings");
        rows.forEach(r => { settings[r.key] = r.value; });
        const eventName = settings.event_name || 'Ludicomix';
        db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'", [], function(e, smtpRows) {
          if (e || !smtpRows) return;
          const c = {};
          smtpRows.forEach(r => { c[r.key] = r.value; });
          if (!c.smtp_host) return;
          nodemailer.createTransport({
            host: c.smtp_host, port: parseInt(c.smtp_port||'587',10),
            secure: c.smtp_secure==='1',
            auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
            tls: { rejectUnauthorized: false }
          }).sendMail({
            from: c.smtp_from || 'noreply@ludicomix.it',
            to: vol.email,
            subject: `[${eventName}] Aggiornamento sulla tua candidatura`,
            html: `<div style="font-family:sans-serif;max-width:560px">
              <h2 style="color:#1e2d4e">Gentile ${vol.first_name},</h2>
              <p>Grazie per esserti candidato/a come volontario per <strong>${eventName}</strong>.</p>
              <p>Purtroppo, in questa edizione non saremo in grado di accettare la tua candidatura.</p>
              ${rejection_reason ? `<p><em>Note: ${rejection_reason}</em></p>` : ''}
              <p>Speriamo di rivederti nelle prossime edizioni!</p>
            </div>`
          }, err2 => { if (err2) console.error('[Reject email]', err2.message); });
        });
      }
      res.redirect('/volunteers#candidature');
    } catch (err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  // ── GET storico candidature ──
  app.get('/volunteers/storico', requireAuth, async (req, res) => {
    try {
      const history = await dbAll(`
        SELECT v.*,
               u.username AS reviewed_by_name
        FROM volunteers v
        LEFT JOIN users u ON u.id = v.reviewed_by
        WHERE v.status IN ('approved','rejected')
        ORDER BY v.reviewed_at DESC, v.id DESC
      `);
      res.render('volunteers_storico', { history: history||[] });
    } catch(err) {
      res.status(500).send('Errore: ' + err.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`Server avviato su http://localhost:${PORT}`);
  });
