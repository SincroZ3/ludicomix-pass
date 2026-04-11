const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const dbPath = path.join(DATA_DIR, 'ludicomix.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('DB connection error:', err.message);
  else console.log('DB connesso:', dbPath);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT, last_name TEXT, email TEXT,
    role TEXT, stand TEXT, zona TEXT,
    ref_code TEXT, import_batch_id TEXT,
    assignment_group_id INTEGER,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pass_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_path TEXT,
    name_x REAL, name_y REAL,
    role_x REAL, role_y REAL,
    qr_x REAL, qr_y REAL, qr_size REAL,
    qr_color TEXT DEFAULT '#000000',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS passes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL,
    pass_type_id INTEGER,
    code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'GENERATO',
    pdf_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(participant_id) REFERENCES participants(id),
    FOREIGN KEY(pass_type_id) REFERENCES pass_types(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
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
    max_passes INTEGER DEFAULT 0,
    email TEXT,
    portal_token TEXT UNIQUE,
    portal_enabled INTEGER DEFAULT 0,
    map_row INTEGER,
    map_col INTEGER,
    map_span INTEGER DEFAULT 1,
    map_x REAL, map_y REAL, map_w REAL, map_h REAL,
    map_shape TEXT,
    max_auto_passes INTEGER DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES groups(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'viewer',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pass_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by INTEGER,
    changed_at TEXT DEFAULT (datetime('now')),
    notes TEXT,
    FOREIGN KEY(pass_id) REFERENCES passes(id),
    FOREIGN KEY(changed_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    bg_image_path TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run("ALTER TABLE assignment_groups ADD COLUMN email TEXT", function(err) { /* ignora se esiste */ });

  const alterCols = [
    'ALTER TABLE assignment_groups ADD COLUMN portal_token TEXT',
    'ALTER TABLE assignment_groups ADD COLUMN portal_enabled INTEGER DEFAULT 0',
    'ALTER TABLE assignment_groups ADD COLUMN map_row INTEGER',
    'ALTER TABLE assignment_groups ADD COLUMN map_col INTEGER',
    'ALTER TABLE assignment_groups ADD COLUMN map_span INTEGER DEFAULT 1',
    'ALTER TABLE assignment_groups ADD COLUMN map_x REAL',
    'ALTER TABLE assignment_groups ADD COLUMN map_y REAL',
    'ALTER TABLE assignment_groups ADD COLUMN map_w REAL',
    'ALTER TABLE assignment_groups ADD COLUMN map_h REAL',
    'ALTER TABLE assignment_groups ADD COLUMN map_shape TEXT',
    'ALTER TABLE assignment_groups ADD COLUMN max_auto_passes INTEGER DEFAULT 0',
  ];
  alterCols.forEach(sql => db.run(sql, function() {}));
});

db.run(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT, title TEXT, message TEXT, entity_type TEXT, entity_id INTEGER,
  read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
)`);
db.run(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);

const defaultSettings = [
  ['smtp_host',''],['smtp_port','587'],['smtp_user',''],['smtp_pass',''],
  ['smtp_from',''],['auto_pass_type_id',''],['site_logo_b64','']
];
defaultSettings.forEach(function(p) { db.run('INSERT OR IGNORE INTO app_settings(key,value)VALUES(?,?)', p); });
db.run("INSERT OR IGNORE INTO app_settings(key,value) VALUES('qr_logo_b64','')");

db.run(`CREATE TABLE IF NOT EXISTS auto_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_group_id INTEGER NOT NULL,
  pass_id INTEGER NOT NULL,
  pass_number INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id),
  FOREIGN KEY(pass_id) REFERENCES passes(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS scan_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  scanned_by INTEGER,
  scanned_at TEXT DEFAULT (datetime('now')),
  result TEXT,
  pass_status_before TEXT,
  pass_status_after TEXT,
  participant_name TEXT,
  stand_name TEXT,
  FOREIGN KEY(scanned_by) REFERENCES users(id)
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_passes_participant  ON passes(participant_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_passes_status       ON passes(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_participants_group  ON participants(assignment_group_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_pass_history_pass   ON pass_status_history(pass_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_scan_attempts_code  ON scan_attempts(code)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_action_logs_user    ON action_logs(user_id)`);

db.serialize(function() {
  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    is_pinned INTEGER DEFAULT 0,
    expires_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS announcement_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    announcement_id INTEGER NOT NULL,
    portal_token TEXT NOT NULL,
    read_at TEXT DEFAULT (datetime('now')),
    UNIQUE(announcement_id, portal_token),
    FOREIGN KEY(announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_ann_reads_token ON announcement_reads(portal_token)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ann_pinned     ON announcements(is_pinned, created_at)`);
});

db.dbPath = dbPath;

// ── CRM: Drop + Ricrea (fix volume Railway con schema incompleto) ─────────────
// Il DROP è necessario perché un deploy precedente potrebbe aver creato le
// tabelle con schema sbagliato sul volume persistente Railway.
db.serialize(function() {

  db.run('DROP TABLE IF EXISTS ticket_replies');
  db.run('DROP TABLE IF EXISTS support_tickets');
  db.run('DROP TABLE IF EXISTS portal_documents');
  db.run('DROP TABLE IF EXISTS group_documents');
  db.run('DROP TABLE IF EXISTS payments');
  db.run('DROP TABLE IF EXISTS contacts');

  db.run(`CREATE TABLE contacts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    name                TEXT    NOT NULL,
    role                TEXT,
    email               TEXT,
    phone               TEXT,
    is_primary          INTEGER DEFAULT 0,
    created_at          TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE payments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    description         TEXT    NOT NULL,
    amount              REAL    NOT NULL,
    status              TEXT    DEFAULT 'da_pagare',
    due_date            TEXT,
    paid_at             TEXT,
    notes               TEXT,
    created_at          TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE group_documents (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    filename            TEXT    NOT NULL,
    original_name       TEXT,
    doc_type            TEXT    DEFAULT 'altro',
    uploaded_by         INTEGER,
    uploaded_at         TEXT    DEFAULT (datetime('now')),
    notes               TEXT,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE,
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE portal_documents (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    doc_type            TEXT    NOT NULL,
    filename            TEXT    NOT NULL,
    original_name       TEXT,
    status              TEXT    DEFAULT 'ricevuto',
    uploaded_at         TEXT    DEFAULT (datetime('now')),
    reviewed_by         INTEGER,
    reviewed_at         TEXT,
    review_notes        TEXT,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE support_tickets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    portal_token        TEXT    NOT NULL,
    subject             TEXT    NOT NULL,
    message             TEXT    NOT NULL,
    status              TEXT    DEFAULT 'aperto',
    created_at          TEXT    DEFAULT (datetime('now')),
    closed_at           TEXT,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id)
  )`);

  db.run(`CREATE TABLE ticket_replies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL,
    message     TEXT    NOT NULL,
    is_admin    INTEGER DEFAULT 0,
    author_name TEXT,
    created_at  TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_contacts_group    ON contacts(assignment_group_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_payments_group    ON payments(assignment_group_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_group_docs_group  ON group_documents(assignment_group_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_portal_docs_group ON portal_documents(assignment_group_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tickets_group     ON support_tickets(assignment_group_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ticket_replies    ON ticket_replies(ticket_id)');

  ['portal_open_from TEXT', 'portal_open_until TEXT', "contract_status TEXT DEFAULT 'bozza'"].forEach(function(col) {
    db.run('ALTER TABLE assignment_groups ADD COLUMN ' + col, function() {});
  });

});

// Seed admin se non esiste
db.get("SELECT id FROM users WHERE username='admin'", function(err, row) {
  if (!row) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO users (username,password,role) VALUES ('admin',?,'admin')", [hash]);
  }
});

module.exports = db;
