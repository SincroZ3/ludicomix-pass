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
  ['ALTER TABLE assignment_groups ADD COLUMN portal_token TEXT',
   'ALTER TABLE assignment_groups ADD COLUMN portal_enabled INTEGER DEFAULT 0',
   'ALTER TABLE assignment_groups ADD COLUMN map_row INTEGER',
   'ALTER TABLE assignment_groups ADD COLUMN map_col INTEGER',
   'ALTER TABLE assignment_groups ADD COLUMN map_span INTEGER DEFAULT 1',
   'ALTER TABLE passes ADD COLUMN replaced_by INTEGER',
   'ALTER TABLE zones ADD COLUMN background_image TEXT',
   'ALTER TABLE assignment_groups ADD COLUMN map_x REAL',
   'ALTER TABLE assignment_groups ADD COLUMN map_y REAL'
  ].forEach(function(sql){db.run(sql,function(err){
    if(err&&!err.message.includes('duplicate column name'))console.warn('migrate:',err.message);});});
db.dbPath = dbPath;
module.exports = db;
