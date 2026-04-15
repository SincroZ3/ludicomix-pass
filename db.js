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

  // ═══════════════════════════════════════════════════════
  // MODULO PASS — tabelle originali
  // ═══════════════════════════════════════════════════════

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
    import_batch_id TEXT,
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
    role_y INTEGER DEFAULT 370,
    qr_color TEXT DEFAULT '#000000'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS passes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL,
    pass_type_id INTEGER NOT NULL,
    code TEXT,
    status TEXT DEFAULT 'GENERATO',
    pdf_file TEXT,
    replaced_by INTEGER,
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
    email TEXT,
    portal_token TEXT,
    portal_enabled INTEGER DEFAULT 0,
    portal_open_from TEXT,
    portal_open_until TEXT,
    portal_status TEXT DEFAULT 'chiuso',
    contract_status TEXT DEFAULT 'bozza',
    map_row INTEGER,
    map_col INTEGER,
    map_span INTEGER DEFAULT 1,
    map_x REAL,
    map_y REAL,
    map_w REAL,
    map_h REAL,
    map_shape TEXT,
    max_auto_passes INTEGER DEFAULT 0,
    edition_id INTEGER,
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

  db.run(`CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    background_image TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_type TEXT,
    related_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    read_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);

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

  // ═══════════════════════════════════════════════════════
  // BACHECA COMUNICAZIONI
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    emoji TEXT DEFAULT '📣',
    type TEXT DEFAULT 'info',
    is_pinned INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
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

  // ═══════════════════════════════════════════════════════
  // CRM — contatti, pagamenti, documenti
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    phone TEXT,
    is_primary INTEGER DEFAULT 0,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'da_pagare',
    due_date TEXT,
    paid_at TEXT,
    notes TEXT,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS group_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    doc_type TEXT,
    notes TEXT,
    uploaded_by INTEGER,
    uploaded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  // ═══════════════════════════════════════════════════════
  // PORTALE ESPOSITORE
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE TABLE IF NOT EXISTS portal_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    status TEXT DEFAULT 'ricevuto',
    uploaded_at TEXT DEFAULT (datetime('now')),
    reviewed_by INTEGER,
    reviewed_at TEXT,
    review_notes TEXT,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_group_id INTEGER NOT NULL,
    portal_token TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'aperto',
    created_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT,
    FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ticket_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    author_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
  )`);

  // ═══════════════════════════════════════════════════════
  // ACCREDITAMENTO
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE TABLE IF NOT EXISTS accreditation_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    stand_type TEXT,
    stand_size TEXT,
    notes TEXT,
    status TEXT DEFAULT 'in_attesa',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    rejection_reason TEXT,
    assignment_group_id INTEGER,
    accreditation_type TEXT,
    media_outlet TEXT,
    press_role TEXT,
    publisher TEXT,
    genre TEXT,
    channel_url TEXT,
    platform TEXT,
    subscribers TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══════════════════════════════════════════════════════
  // MULTI-EDIZIONE
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE TABLE IF NOT EXISTS editions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    year INTEGER,
    is_current INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ═══════════════════════════════════════════════════════
  // MODULO AGENDA PALINSESTO
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE TABLE IF NOT EXISTS spaces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    description TEXT,
    capacity    INTEGER NOT NULL DEFAULT 0,
    location    TEXT,
    color       TEXT    DEFAULT '#4f98a3',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS speakers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    bio        TEXT,
    photo_url  TEXT,
    email      TEXT,
    phone      TEXT,
    social_url TEXT,
    notes      TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT,
    space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
    date        TEXT    NOT NULL,
    start_time  TEXT    NOT NULL,
    end_time    TEXT    NOT NULL,
    max_seats   INTEGER DEFAULT 0,
    event_type  TEXT    DEFAULT 'panel',
    is_public            INTEGER NOT NULL DEFAULT 1,
    published            INTEGER NOT NULL DEFAULT 0,
    registrations_open   INTEGER NOT NULL DEFAULT 0,
    image_url   TEXT,
    tags        TEXT,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (end_time > start_time)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS event_speakers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL REFERENCES events(id)   ON DELETE CASCADE,
    speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
    role       TEXT    DEFAULT 'speaker',
    order_num  INTEGER DEFAULT 0,
    UNIQUE(event_id, speaker_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS registrations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    first_name    TEXT    NOT NULL,
    last_name     TEXT    NOT NULL,
    email         TEXT    NOT NULL,
    phone         TEXT,
    pass_id       INTEGER REFERENCES passes(id) ON DELETE SET NULL,
    status        TEXT    NOT NULL DEFAULT 'confirmed',
    notes         TEXT,
    registered_at TEXT    NOT NULL DEFAULT (datetime('now')),
    cancelled_at  TEXT,
    UNIQUE(event_id, email)
  )`);

  // ═══════════════════════════════════════════════════════
  // INDEXES — performance
  // ═══════════════════════════════════════════════════════

  db.run(`CREATE INDEX IF NOT EXISTS idx_passes_participant    ON passes(participant_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_passes_status         ON passes(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_participants_group    ON participants(assignment_group_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pass_history_pass     ON pass_status_history(pass_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_scan_attempts_code    ON scan_attempts(code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_action_logs_user      ON action_logs(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ann_reads_token       ON announcement_reads(portal_token)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ann_pinned            ON announcements(is_pinned, created_at)`);
  // Migrazione: aggiunge la colonna se il DB esiste già (no-op se già presente)
  db.run(`ALTER TABLE events ADD COLUMN registrations_open INTEGER NOT NULL DEFAULT 0`, () => {});

  db.run(`CREATE INDEX IF NOT EXISTS idx_events_date           ON events(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_space_date     ON events(space_id, date, start_time)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_published      ON events(published, is_public)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_speakers_event  ON event_speakers(event_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_speakers_speaker ON event_speakers(speaker_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_registrations_event   ON registrations(event_id, status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_registrations_email   ON registrations(email)`);

  // ═══════════════════════════════════════════════════════
  // VIEWS — agenda
  // ═══════════════════════════════════════════════════════

  // Ricrea sempre la view per aggiornare la definizione dopo migrazioni
  db.run(`DROP VIEW IF EXISTS v_public_program`, () => {
  db.run(`CREATE VIEW IF NOT EXISTS v_public_program AS
    SELECT
      e.id, e.title, e.description, e.date, e.start_time, e.end_time,
      e.event_type, e.image_url, e.tags, e.max_seats, e.registrations_open,
      s.name  AS space_name,
      s.color AS space_color,
      s.capacity AS space_capacity,
      COUNT(r.id) AS seats_taken,
      CASE
        WHEN e.max_seats = 0 THEN 'open'
        WHEN COUNT(r.id) >= e.max_seats THEN 'full'
        ELSE 'available'
      END AS availability,
      GROUP_CONCAT(sp.name, ', ') AS speakers_list
    FROM events e
    JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r  ON r.event_id  = e.id  AND r.status = 'confirmed'
    LEFT JOIN event_speakers es ON es.event_id = e.id
    LEFT JOIN speakers sp       ON sp.id       = es.speaker_id
    WHERE e.published = 1 AND e.is_public = 1
    GROUP BY e.id
    ORDER BY e.date, e.start_time`); });

  // ═══════════════════════════════════════════════════════
  // APP SETTINGS — seed valori default
  // ═══════════════════════════════════════════════════════

  [
    ['ap_template',''], ['ap_esp_x','350'], ['ap_esp_y','125'], ['ap_esp_size','20'],
    ['ap_num_x','95'],  ['ap_num_y','125'], ['ap_tot_x','95'],  ['ap_tot_y','95'],
    ['ap_qr_x','660'],  ['ap_qr_y','45'],  ['ap_qr_size','80']
  ].forEach(function(p) {
    db.run('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)', p);
  });

  db.run("INSERT OR IGNORE INTO app_settings(key,value) VALUES('qr_logo_b64','')");

  // ═══════════════════════════════════════════════════════
  // SEED — edizione corrente
  // ═══════════════════════════════════════════════════════

  db.get('SELECT COUNT(*) AS n FROM editions', [], function(err, row) {
    if (!err && row && row.n === 0) {
      db.run(
        "INSERT INTO editions (name, year, is_current) VALUES ('Ludicomix 2026', 2026, 1)",
        [],
        function(e2) {
          if (!e2) {
            db.run('UPDATE assignment_groups SET edition_id = ? WHERE edition_id IS NULL', [this.lastID]);
          }
        }
      );
    } else {
      db.get('SELECT id FROM editions WHERE is_current=1 LIMIT 1', [], function(e3, ed) {
        if (!e3 && ed) {
          db.run('UPDATE assignment_groups SET edition_id = ? WHERE edition_id IS NULL', [ed.id]);
        }
      });
    }
  });

  // ═══════════════════════════════════════════════════════
  // SEED — utente admin
  // ═══════════════════════════════════════════════════════

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

db.dbPath = dbPath;
module.exports = db;
