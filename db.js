const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// Su Railway usa /data (volume persistente), in locale usa la cartella dell'app
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'data.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    stand_name TEXT,
    zone TEXT,
    ref_code TEXT,
    notes TEXT,
    assignment_group_id INTEGER,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pass_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    template_file TEXT NOT NULL,
    name_x INTEGER DEFAULT 100,
    name_y INTEGER DEFAULT 400,
    role_x INTEGER DEFAULT 100,
    role_y INTEGER DEFAULT 370
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS passes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL,
    pass_type_id INTEGER NOT NULL,
    code TEXT,
    status TEXT DEFAULT 'GENERATO',
    pdf_file TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(participant_id) REFERENCES participants(id),
    FOREIGN KEY(pass_type_id) REFERENCES pass_types(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    pass_type_id INTEGER,
    FOREIGN KEY(pass_type_id) REFERENCES pass_types(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS assignment_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    group_id INTEGER NOT NULL,
    stand_name TEXT,
    zone TEXT,
    stand_code TEXT,
    max_passes INTEGER,
    notes TEXT,
    FOREIGN KEY(group_id) REFERENCES groups(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pass_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    changed_at TEXT DEFAULT (datetime('now')),
    user_id INTEGER,
    FOREIGN KEY(pass_id) REFERENCES passes(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Zone/padiglioni configurabili dall'admin
  db.run(`CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  )`);

  // Migrazione: aggiungi colonne mancanti se non esistono
  db.run("ALTER TABLE assignment_groups ADD COLUMN email TEXT", function(err) { /* ignora se esiste già */ });

  // Seed admin
  db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
    if (err) { console.error('Errore controllo utenti:', err); return; }
    if (!row || row.count === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        ['admin', hash, 'admin'],
        (err2) => {
          if (err2) console.error('Errore creazione utente admin:', err2);
          else console.log('Utente admin creato. Credenziali: admin / admin123');
        }
      );
    }
  });
});

db.run(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
  related_type TEXT, related_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')), read_at TEXT)`);

db.run(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);

[
  'ALTER TABLE assignment_groups ADD COLUMN portal_token TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN portal_enabled INTEGER DEFAULT 0',
  'ALTER TABLE assignment_groups ADD COLUMN map_row INTEGER',
  'ALTER TABLE assignment_groups ADD COLUMN map_col INTEGER',
  'ALTER TABLE assignment_groups ADD COLUMN map_span INTEGER DEFAULT 1',
  'ALTER TABLE passes ADD COLUMN replaced_by INTEGER',
  'ALTER TABLE zones ADD COLUMN background_image TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN map_x REAL',
  'ALTER TABLE assignment_groups ADD COLUMN map_y REAL',
  'ALTER TABLE assignment_groups ADD COLUMN map_w REAL',
  'ALTER TABLE assignment_groups ADD COLUMN map_h REAL',
  'ALTER TABLE assignment_groups ADD COLUMN map_shape TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN max_auto_passes INTEGER DEFAULT 0',
  "ALTER TABLE pass_types ADD COLUMN qr_color TEXT DEFAULT '#000000'",
  'ALTER TABLE participants ADD COLUMN import_batch_id TEXT'
].forEach(function(sql) {
  db.run(sql, function(err) {
    if (err && !err.message.includes('duplicate column name')) console.warn('migrate:', err.message);
  });
});

// ✅ FIX: rimosso blocco CREATE TABLE auto_passes duplicato
db.run(`CREATE TABLE IF NOT EXISTS auto_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_group_id INTEGER NOT NULL,
  code TEXT UNIQUE,
  status TEXT DEFAULT 'GENERATO',
  pdf_file TEXT,
  pass_number INTEGER,
  total_passes INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id)
)`);

[
  ['ap_template',''], ['ap_esp_x','350'], ['ap_esp_y','125'], ['ap_esp_size','20'],
  ['ap_num_x','95'],  ['ap_num_y','125'], ['ap_tot_x','95'],  ['ap_tot_y','95'],
  ['ap_qr_x','660'],  ['ap_qr_y','45'],  ['ap_qr_size','80']
].forEach(function(p) { db.run('INSERT OR IGNORE INTO app_settings(key,value)VALUES(?,?)', p); });

db.run("INSERT OR IGNORE INTO app_settings(key,value) VALUES('qr_logo_b64','')");

db.run(`CREATE TABLE IF NOT EXISTS scan_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  result TEXT NOT NULL,
  pass_id INTEGER,
  participant_name TEXT,
  group_name TEXT,
  user_id INTEGER,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// ✅ Performance indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_passes_participant  ON passes(participant_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_passes_status       ON passes(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_participants_group  ON participants(assignment_group_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_pass_history_pass   ON pass_status_history(pass_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_scan_attempts_code  ON scan_attempts(code)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_action_logs_user    ON action_logs(user_id)`);

// ═══════════════════════════════════════════════════════
// BACHECA COMUNICAZIONI — tabelle
// ═══════════════════════════════════════════════════════

// Comunicazioni dell'organizzazione verso i portali espositore
db.run(`CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  emoji       TEXT    DEFAULT '📣',
  type        TEXT    DEFAULT 'info',     -- info | warning | urgent
  is_pinned   INTEGER DEFAULT 0,
  created_by  INTEGER,
  created_at  TEXT    DEFAULT (datetime('now')),
  expires_at  TEXT,
  FOREIGN KEY(created_by) REFERENCES users(id)
)`);

// Traccia quali stand hanno letto quale messaggio
db.run(`CREATE TABLE IF NOT EXISTS announcement_reads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL,
  portal_token    TEXT    NOT NULL,
  read_at         TEXT    DEFAULT (datetime('now')),
  UNIQUE(announcement_id, portal_token),
  FOREIGN KEY(announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_ann_reads_token ON announcement_reads(portal_token)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_ann_pinned     ON announcements(is_pinned, created_at)`);


// -------- Mod.1/2: colonne aggiuntive assignment_groups --------
[
  'ALTER TABLE assignment_groups ADD COLUMN email TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN portal_token TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN portal_enabled INTEGER DEFAULT 0',
  'ALTER TABLE assignment_groups ADD COLUMN portal_open_from TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN portal_open_until TEXT',
  'ALTER TABLE assignment_groups ADD COLUMN portal_status TEXT DEFAULT \'chiuso\'',
  "ALTER TABLE assignment_groups ADD COLUMN contract_status TEXT DEFAULT 'bozza'",
].forEach(function(sql) { db.run(sql, function() {}); });

// -------- Mod.5: Accreditamento --------
db.run(`CREATE TABLE IF NOT EXISTS accreditation_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name        TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  email               TEXT NOT NULL,
  phone               TEXT,
  stand_type          TEXT,
  stand_size          TEXT,
  notes               TEXT,
  status              TEXT    DEFAULT 'in_attesa',
  reviewed_by         INTEGER,
  reviewed_at         TEXT,
  rejection_reason    TEXT,
  assignment_group_id INTEGER,
  created_at          TEXT    DEFAULT (datetime('now'))
)`);

db.dbPath = dbPath;
module.exports = db;
