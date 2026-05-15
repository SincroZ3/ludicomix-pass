/**
 * server.js — Bootstrap Ludicomix Pass (v2 — fix parametri route)
 */
'use strict';

process.env.TZ = 'Europe/Rome'; // Timezone italiana — fix log 2h indietro

const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const multer      = require('multer');
const session     = require('express-session');
const bcrypt      = require('bcryptjs');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);
const { promisify } = require('util');

const db           = require('./db');
const crmRoutes    = require('./routes/crm');
const agendaRoutes = require('./agenda_routes');

// ── Route modules ────────────────────────────────────────────────
const registerScan           = require('./routes/scan');
const registerContatore      = require('./routes/contatore');
const registerNotifications  = require('./routes/notifications');
const registerReports        = require('./routes/reports');
const registerUsers          = require('./routes/users');
const registerLogs           = require('./routes/logs');
const registerBacheca        = require('./routes/bacheca');
const registerMappa          = require('./routes/mappa');
const registerSettings       = require('./routes/settings');
const registerAccreditamento = require('./routes/accreditamento');
const registerAutoPass       = require('./routes/auto-passes');
const registerPortale        = require('./routes/portale');
const registerParticipants   = require('./routes/participants');
const registerPasses         = require('./routes/passes');
const registerVolunteers     = require('./routes/volunteers');
const registerLogistica      = require('./routes/logistica');

// ── DB helpers ──────────────────────────────────────────────────
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

// ── Cache edizione corrente ──────────────────────────────────────
let _currentEdition = null;
function refreshCurrentEdition(cb) {
  db.get('SELECT * FROM editions WHERE is_current=1 LIMIT 1', [], (_e, row) => {
    _currentEdition = row || null;
    if (cb) cb();
  });
}
function getCurrent() { return _currentEdition; }
function edFilter()   { return _currentEdition ? `AND ag.edition_id = ${_currentEdition.id}` : ''; }
function edVal()      { return _currentEdition ? _currentEdition.id : null; }
refreshCurrentEdition();

// ── Email & Notifiche ────────────────────────────────────────────
function trySendEmail(subj, html) {
  db.all("SELECT key,value FROM app_settings WHERE key LIKE 'smtp_%'", [], (_e, rows) => {
    if (!rows) return;
    const c = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (!c.smtp_host || !c.smtp_to) return;
    require('nodemailer').createTransport({
      host: c.smtp_host, port: parseInt(c.smtp_port || '587', 10),
      secure: c.smtp_secure === '1',
      auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_pass } : undefined,
      tls: { rejectUnauthorized: false },
    }).sendMail({
      from: c.smtp_from || 'noreply@ludicomix.it',
      to: c.smtp_to,
      subject: '[Ludicomix] ' + subj,
      html: '<div style="font-family:sans-serif">' + html + '</div>',
    }, err2 => { if (err2) console.error('[Email]', err2.message); });
  });
}

function createNotification(type, title, message, rT, rI) {
  db.run(
    'INSERT INTO notifications(type,title,message,related_type,related_id) VALUES(?,?,?,?,?)',
    [type, title, message, rT || null, rI || null],
    () => trySendEmail(title, message)
  );
}

function logAction(userId, action, entityType, entityId, details) {
  db.run(
    'INSERT INTO action_logs(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',
    [userId || null, action, entityType || null, entityId || null, details || null],
    err => { if (err) console.error('[logAction]', err.message); }
  );
}

// ── Migrations ──────────────────────────────────────────────────
function runMigration(sql, label) {
  db.run(sql, err => {
    if (err && !err.message.includes('duplicate column'))
      console.warn('[Migration] ' + label + ':', err.message);
  });
}
runMigration("ALTER TABLE assignment_groups ADD COLUMN portal_nom_enabled INTEGER DEFAULT 1",     'portal_nom_enabled');
runMigration("ALTER TABLE assignment_groups ADD COLUMN portal_docs_enabled INTEGER DEFAULT 1",    'portal_docs_enabled');
runMigration("ALTER TABLE assignment_groups ADD COLUMN portal_service_enabled INTEGER DEFAULT 1", 'portal_service_enabled');
runMigration("ALTER TABLE assignment_groups ADD COLUMN map_rot REAL DEFAULT 0",                   'map_rot');
runMigration("ALTER TABLE zones ADD COLUMN zone_scope TEXT DEFAULT 'internal'",                   'zone_scope');
['portal_nom_enabled','portal_docs_enabled','portal_service_enabled'].forEach(col =>
  db.run(`UPDATE assignment_groups SET ${col}=1 WHERE ${col} IS NULL`)
);
db.run("UPDATE zones SET zone_scope='internal' WHERE zone_scope IS NULL");
runMigration("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL", 'user_permissions');

// ── Express app ──────────────────────────────────────────────────
const app      = express();
const PORT     = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || __dirname;

app.set('trust proxy', 1);

['templates', 'generated'].forEach(dir => {
  const p = path.join(DATA_DIR, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/generated', express.static(path.join(DATA_DIR, 'generated')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'ludicomix-secret-changeme-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use('/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: 'Troppi tentativi di accesso. Riprova tra 15 minuti.',
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false },
}));

// ── Ruoli & middleware auth ──────────────────────────────────────
const ROLES = {
  ADMIN:     'admin',
  ORGANIZER: 'organizer',
  OPERATOR:  'operator',
  SCANNER:   'scanner',
  VIEWER:    'viewer',
  CUSTOM:    'custom',
};

// Mappa middleware → permesso custom richiesto per quel livello di accesso
const PERM_MAP = {
  admin:       'system.admin',      // requireAdmin
  organizer:   'org.manage',        // requireOrganizer
  notviewer:   'participants.view', // requireNotViewer
  scan:        'scan.scan',         // requireCanScan
};

// Parsea i permessi dal campo JSON del DB
function parsePerms(user) {
  if (!user || user.role !== ROLES.CUSTOM) return [];
  try { return JSON.parse(user.permissions || '[]'); } catch(e) { return []; }
}

// Controlla se un utente custom ha uno specifico permesso
function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role !== ROLES.CUSTOM) return false;
  const perms = parsePerms(user);
  return perms.includes(perm);
}

// hasRole esteso: supporta ruolo custom tramite hasPerm
function hasRole(user, ...roles) {
  if (!user) return false;
  if (roles.includes(user.role)) return true;
  // Se custom, controlla se ha almeno uno dei permessi equivalenti ai ruoli richiesti
  if (user.role === ROLES.CUSTOM) {
    const perms = parsePerms(user);
    // Mappa ogni ruolo richiesto al suo permesso custom equivalente
    const rolePermMap = {
      admin:     ['system.admin'],
      organizer: ['org.manage'],
      operator:  ['participants.edit', 'scan.scan'],
      scanner:   ['scan.scan'],
      viewer:    ['participants.view'],
    };
    return roles.some(r => {
      const needed = rolePermMap[r] || [];
      return needed.some(p => perms.includes(p));
    });
  }
  return false;
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const u = req.session.user;
  // Utenti scanner puri (o custom con solo perm scan) → redirige a /scan
  const isScanOnly = u.role === ROLES.SCANNER ||
    (u.role === ROLES.CUSTOM && (() => {
      const p = parsePerms(u);
      return p.includes('scan.scan') && !p.includes('participants.view') && !p.includes('org.manage');
    })());
  if (isScanOnly &&
      !req.path.startsWith('/scan') &&
      !req.path.startsWith('/api/scan') &&
      !req.path.startsWith('/contatore') &&
      !req.path.startsWith('/api/visitors') &&
      !req.path.startsWith('/logout') &&
      !req.path.startsWith('/account')) {
    return res.redirect('/scan');
  }
  next();
}

function requireAdmin(req, res, next) {
  hasRole(req.session.user, ROLES.ADMIN)
    ? next()
    : res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
}

function requireOrganizer(req, res, next) {
  hasRole(req.session.user, ROLES.ADMIN, ROLES.ORGANIZER)
    ? next()
    : res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
}

function requireNotViewer(req, res, next) {
  hasRole(req.session.user, ROLES.ADMIN, ROLES.ORGANIZER, ROLES.OPERATOR)
    ? next()
    : res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
}

function requireCanScan(req, res, next) {
  hasRole(req.session.user, ROLES.ADMIN, ROLES.ORGANIZER, ROLES.OPERATOR, ROLES.SCANNER, ROLES.VIEWER)
    ? next()
    : res.status(403).sendFile(path.join(__dirname, 'views', '403.html'));
}

// ── Locals globali ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.currentUser    = req.session.user || null;
  res.locals.currentEdition = _currentEdition;
  next();
});

// ── Multer shared ────────────────────────────────────────────────
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ── CRM & Agenda (legacy) ────────────────────────────────────────
crmRoutes(app, db, {
  requireAuth, requireNotViewer, requireOrganizer, logAction, uploadMemory, hasPerm, parsePerms,
});
app.use('/', agendaRoutes(logAction));

// ── Oggetto middlewares completo (passato a tutti i moduli) ──────
const middlewares = {
  requireAuth,
  requireAdmin,
  requireOrganizer,
  requireNotViewer,
  requireCanScan,
  logAction,
  createNotification,
  trySendEmail,
  edFilter,
  edVal,
  getCurrent,
  refreshCurrentEdition,
  uploadMemory,
  ROLES,
  getCurrentEdition: () => _currentEdition,
};

// ── Registra moduli — generatePassForParticipant è condiviso ─────
// passes.js viene registrato PRIMA di participants e portale
// perché questi due usano generatePassForParticipant
registerPasses(app, db, middlewares);

// Recupera le funzioni esportate da passes dopo la prima chiamata
const {
  generatePassForParticipant,
  triggerBatchPassOnClose,
} = require('./routes/passes');

// Inietta le funzioni nei moduli che ne hanno bisogno
registerScan          (app, db, middlewares);
registerContatore     (app, db, middlewares);
registerNotifications (app, db, middlewares);
registerReports       (app, db, middlewares);
registerUsers         (app, db, middlewares);
registerLogs          (app, db, middlewares);
registerBacheca       (app, db, middlewares);
registerMappa         (app, db, middlewares);
registerSettings      (app, db, middlewares);
registerAccreditamento(app, db, middlewares);
registerAutoPass      (app, db, middlewares);
const { generateAutoPass } = require('./routes/auto-passes');

registerPortale       (app, db, { ...middlewares, triggerBatchPassOnClose });
registerParticipants  (app, db, { ...middlewares, generateAutoPass, getCurrent });
registerVolunteers    (app, db, middlewares);
registerLogistica     (app, db, middlewares);

// ── Auth routes ──────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect(req.session.user ? '/home' : '/login'));

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/home');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.render('login', { error: 'Inserisci username e password.' });
  db.get('SELECT * FROM users WHERE username=?', [username], (err, user) => {
    if (err) return res.render('login', { error: 'Errore di sistema.' });
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      logAction(null, 'login_failed', 'user', null, `Tentativo login: ${username}`);
      return res.render('login', { error: 'Credenziali non valide.' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    logAction(user.id, 'login', 'user', user.id, 'Login eseguito');
    res.redirect(user.role === ROLES.SCANNER ? '/scan' : '/home');
  });
});

app.post('/logout', requireAuth, (req, res) => {
  const uid = req.session.user.id;
  req.session.destroy(() => {
    logAction(uid, 'logout', 'user', uid, 'Logout');
    res.redirect('/login');
  });
});

// ── Home ─────────────────────────────────────────────────────────
app.get('/home', requireAuth, async (req, res) => {
  try {
    const [r1, r2, r3, r4, alertGroups, recentActivity] = await Promise.all([
      dbGet('SELECT COUNT(*) as total FROM participants'),
      dbGet('SELECT COUNT(*) as total FROM passes'),
      dbAll('SELECT status, COUNT(*) as count FROM passes GROUP BY status'),
      dbGet(`SELECT COUNT(*) as total FROM participants
             WHERE id NOT IN (SELECT DISTINCT participant_id FROM passes WHERE status!='INVALIDATO')`),
      dbAll(`
        SELECT ag.id, ag.name, ag.zone, ag.max_passes,
               COUNT(DISTINCT pa.id) AS participant_count,
               COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0) AS pass_count
        FROM assignment_groups ag
        LEFT JOIN participants pa ON pa.assignment_group_id=ag.id
        LEFT JOIN passes p ON p.participant_id=pa.id
        WHERE (1=1) ${edFilter()}
        GROUP BY ag.id
        HAVING
          (COUNT(DISTINCT pa.id)>0
            AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0)
          OR (ag.max_passes IS NOT NULL AND ag.max_passes>0
            AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)<ag.max_passes)
        ORDER BY
          CASE WHEN COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0
               AND COUNT(DISTINCT pa.id)>0 THEN 0 ELSE 1 END ASC,
          (CASE WHEN ag.max_passes IS NOT NULL AND ag.max_passes>0
                THEN ag.max_passes - COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)
                ELSE 0 END) DESC
        LIMIT 12`),
      dbAll(`
        SELECT al.action, al.details, al.created_at, u.username
        FROM action_logs al LEFT JOIN users u ON u.id=al.user_id
        ORDER BY al.id DESC LIMIT 8`),
    ]);
    const passesByStatus = {};
    (r3 || []).forEach(r => { passesByStatus[r.status] = r.count; });
    res.render('home', {
      stats: {
        totalParticipants: r1?.total || 0,
        totalPasses:       r2?.total || 0,
        passesByStatus,
        senzaPass:         r4?.total || 0,
      },
      alertGroups:    alertGroups    || [],
      recentActivity: recentActivity || [],
    });
  } catch (err) {
    console.error('[/home]', err.message);
    res.status(500).send('Errore caricamento home: ' + err.message);
  }
});

// ── Helper: mezzanotte locale in formato SQLite ─────────────────
function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} 00:00:00`;
}

// ── API: dashboard-stats (polling live dalla home) ───────────────
app.get('/api/dashboard-stats', requireAuth, async (req, res) => {
  try {
    const edId       = _currentEdition ? _currentEdition.id : null;
    const since      = todayMidnight();
    const edFilter2  = edId ? `AND p.edition_id = ${edId}` : '';
    const edFilterAg = edId ? `AND ag.edition_id = ${edId}` : '';

    const [r1, r2, r3, r4] = await Promise.all([
      dbGet('SELECT COUNT(*) as total FROM participants'),
      dbGet('SELECT COUNT(*) as total FROM passes'),
      dbAll('SELECT status, COUNT(*) as count FROM passes GROUP BY status'),
      dbGet(`SELECT COUNT(*) as total FROM participants WHERE id NOT IN
             (SELECT DISTINCT participant_id FROM passes WHERE status!='INVALIDATO')`),
    ]);

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
        OR (ag.max_passes IS NOT NULL AND ag.max_passes>0
          AND COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)<ag.max_passes)
      ORDER BY
        CASE WHEN COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)=0
             AND COUNT(DISTINCT pa.id)>0 THEN 0 ELSE 1 END ASC,
        (CASE WHEN ag.max_passes IS NOT NULL AND ag.max_passes>0
              THEN ag.max_passes - COALESCE(SUM(CASE WHEN p.status!='INVALIDATO' THEN 1 ELSE 0 END),0)
              ELSE 0 END) DESC
      LIMIT 12`).catch(() => []);

    const r6 = await dbAll(`
      SELECT al.action, al.details, al.created_at, u.username
      FROM action_logs al LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.id DESC LIMIT 8`).catch(() => []);

    const [r7, r8, r9, r10, r11, r12] = await Promise.all([
      dbAll(`
        SELECT ora, SUM(count) as count, SUM(qr) as qr, SUM(manual) as manual
        FROM (
          SELECT strftime('%H', created_at) as ora, COUNT(*) as count, COUNT(*) as qr, 0 as manual
          FROM scan_attempts WHERE created_at >= ? AND result = 'OK' GROUP BY ora
          UNION ALL
          SELECT strftime('%H', counted_at) as ora, COUNT(*) as count, 0 as qr, COUNT(*) as manual
          FROM visitor_counts WHERE direction = 'IN' AND counted_at >= ? GROUP BY ora
        )
        GROUP BY ora ORDER BY ora ASC`, [since, since]).catch(() => []),
      dbAll(`
        SELECT code, COUNT(*) as hits, MAX(created_at) as last_scan,
               MAX(participant_name) as participant_name, MAX(group_name) as group_name
        FROM scan_attempts
        WHERE created_at >= datetime('now','-2 hours')
        GROUP BY code HAVING hits > 3
        ORDER BY hits DESC LIMIT 10`).catch(() => []),
      dbAll(`
        SELECT ag.name as group_name, ag.zone, COUNT(p.id) as non_consegnati
        FROM passes p
        LEFT JOIN participants pa ON pa.id = p.participant_id
        LEFT JOIN assignment_groups ag ON ag.id = pa.assignment_group_id
        WHERE p.status IN ('STAMPATO','GENERATO') ${edFilter2}
        GROUP BY ag.id ORDER BY non_consegnati DESC LIMIT 20`).catch(() => []),
      dbAll(`
        SELECT vc.area,
          SUM(CASE WHEN vc.direction='IN'  THEN 1 ELSE 0 END) as ins,
          SUM(CASE WHEN vc.direction='OUT' THEN 1 ELSE 0 END) as outs
        FROM visitor_counts vc
        LEFT JOIN (SELECT area, MAX(reset_at) as last_reset FROM visitor_resets GROUP BY area) vr
          ON vr.area = vc.area
        WHERE vc.counted_at >= COALESCE(vr.last_reset, ?) AND vc.counted_at >= ?
        GROUP BY vc.area`, [since, since]).catch(() => []),
      dbGet(`SELECT COUNT(*) as total FROM scan_attempts WHERE result='OK' AND created_at >= ?`, [since]).catch(() => ({ total: 0 })),
      dbGet(`SELECT COUNT(*) as total FROM visitor_counts WHERE direction='IN' AND counted_at >= ?`, [since]).catch(() => ({ total: 0 })),
    ]);

    const passesByStatus = {};
    (r3 || []).forEach(r => { passesByStatus[r.status] = r.count; });

    const presenze = {};
    (r10 || []).forEach(r => {
      presenze[r.area] = { ins: r.ins||0, outs: r.outs||0, presenti: Math.max(0, (r.ins||0)-(r.outs||0)) };
    });

    const SCHEDULES = [
      { date: '2026-05-15', closingRitiro: '19:30', label: 'ritiro pass 15/05' },
      { date: '2026-05-16', closingRitiro: '09:30', label: 'ritiro pass 16/05' },
      { date: '2026-05-16', closingFiera:  '21:00', label: 'fiera 16/05' },
      { date: '2026-05-17', closingFiera:  '19:30', label: 'fiera 17/05' },
    ];
    function getNextClosing() {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const timeStr  = now.toTimeString().slice(0, 5);
      for (const s of SCHEDULES) {
        if (s.date !== todayStr) continue;
        const closing = s.closingRitiro || s.closingFiera;
        if (timeStr < closing) {
          const [hh, mm] = closing.split(':').map(Number);
          const cl = new Date(now); cl.setHours(hh, mm, 0, 0);
          return { closing, label: s.label, diffMin: Math.floor((cl - now) / 60000), isRitiro: !!s.closingRitiro };
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
        totalParticipants: r1?.total || 0,
        totalPasses:       r2?.total || 0,
        passesByStatus,
        senzaPass:         r4?.total || 0,
        ingressiOggi:      (r11?.total || 0) + (r12?.total || 0),
      },
      alertGroups:       r5 || [],
      recentActivity:    r6 || [],
      heatmapOre:        r7 || [],
      scanAnomali:       r8 || [],
      passNonConsegnati: r9 || [],
      presenze,
      alertPassNonRitirati,
      nextClosing,
    });
  } catch (err) {
    console.error('[dashboard-stats] errore:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`✅  Ludicomix Pass avviato su http://localhost:${PORT}`)
);

module.exports = app;
