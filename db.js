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
  created_at TEXT DEFAULT (datetime('now','localtime')),
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
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS action_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(user_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS pass_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pass_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now','localtime')),
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
  created_at TEXT DEFAULT (datetime('now','localtime')),
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
  created_at TEXT DEFAULT (datetime('now','localtime')),
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
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);


// ═══════════════════════════════════════════════════════
// CONTATORE VISITATORI PER AREA
// ═══════════════════════════════════════════════════════

db.run(`CREATE TABLE IF NOT EXISTS visitor_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  gate TEXT NOT NULL DEFAULT 'main',
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  user_id INTEGER,
  counted_at TEXT DEFAULT (datetime('now','localtime')),
  edition_id INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
)`);

// Reset manuale: tabella log dei reset
db.run(`CREATE TABLE IF NOT EXISTS visitor_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT,
  reset_at TEXT DEFAULT (datetime('now','localtime')),
  user_id INTEGER,
  note TEXT
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
  created_at TEXT DEFAULT (datetime('now','localtime')),
  expires_at TEXT,
  FOREIGN KEY(created_by) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS announcement_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL,
  portal_token TEXT NOT NULL,
  read_at TEXT DEFAULT (datetime('now','localtime')),
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
  uploaded_at TEXT DEFAULT (datetime('now','localtime')),
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
  uploaded_at TEXT DEFAULT (datetime('now','localtime')),
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
  created_at TEXT DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
)`);

db.run(`CREATE TABLE IF NOT EXISTS ticket_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  author_name TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
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
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ═══════════════════════════════════════════════════════
// MULTI-EDIZIONE
// ═══════════════════════════════════════════════════════

db.run(`CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  year INTEGER,
  is_current INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ═══════════════════════════════════════════════════════
// MODULO AGENDA PALINSESTO
// ═══════════════════════════════════════════════════════

db.run(`CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  color TEXT DEFAULT '#4f98a3',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bio TEXT,
  photo_url TEXT,
  email TEXT,
  phone TEXT,
  social_url TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

// ═══════════════════════════════════════════════════════
// OSPITI FESTIVAL
// ═══════════════════════════════════════════════════════

db.run(`CREATE TABLE IF NOT EXISTS guests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  bio           TEXT,
  photo_url     TEXT,
  category      TEXT,
  stand_location TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  featured      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  max_seats INTEGER DEFAULT 0,
  event_type TEXT DEFAULT 'panel',
  is_public INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 0,
  registrations_open INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (end_time > start_time)
)`);

db.run(`CREATE TABLE IF NOT EXISTS event_speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'speaker',
  order_num INTEGER DEFAULT 0,
  UNIQUE(event_id, speaker_id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  pass_id INTEGER REFERENCES passes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cancelled_at TEXT,
  UNIQUE(event_id, email)
)`);

// ═══════════════════════════════════════════════════════
// INDEXES — performance
// ═══════════════════════════════════════════════════════

db.run(`CREATE INDEX IF NOT EXISTS idx_passes_participant ON passes(participant_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_passes_status ON passes(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_participants_group ON participants(assignment_group_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_pass_history_pass ON pass_status_history(pass_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_scan_attempts_code ON scan_attempts(code)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_action_logs_user ON action_logs(user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_ann_reads_token ON announcement_reads(portal_token)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_ann_pinned ON announcements(is_pinned, created_at)`);

// Migrazione: aggiunge la colonna se il DB esiste già (no-op se già presente)
db.run(`ALTER TABLE events ADD COLUMN registrations_open INTEGER NOT NULL DEFAULT 0`, () => {});
db.run(`ALTER TABLE events ADD COLUMN featured INTEGER NOT NULL DEFAULT 0`, () => {});
db.run(`ALTER TABLE events ADD COLUMN location_text TEXT`, () => {});

db.run(`CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_space_date ON events(space_id, date, start_time)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_events_published ON events(published, is_public)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_event_speakers_event ON event_speakers(event_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_event_speakers_speaker ON event_speakers(speaker_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id, status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email)`);
// ── Migrazioni tabella guests (aggiunge colonne se mancano in DB precedenti) ──
db.serialize(function() {
  ['ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0',
   'ADD COLUMN featured INTEGER NOT NULL DEFAULT 0',
   'ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
  ].forEach(function(col) {
    db.run('ALTER TABLE guests ' + col, function(err) {
      // silenzioso: errore atteso se la colonna esiste già
    });
  });
  // Indici guests: creati DOPO le migrazioni grazie a db.serialize()
  db.run('CREATE INDEX IF NOT EXISTS idx_guests_featured ON guests(featured)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_guests_featured:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_guests_active ON guests(active, sort_order)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_guests_active:', err.message);
  });

  // ── Tabella guest_profiles ──
  db.run(`CREATE TABLE IF NOT EXISTS guest_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_group_id INTEGER NOT NULL UNIQUE,
  bio TEXT,
  photo_url TEXT,
  category TEXT,
  website TEXT,
  social_instagram TEXT,
  sort_order INTEGER DEFAULT 0,
  featured INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(assignment_group_id) REFERENCES assignment_groups(id) ON DELETE CASCADE
)`, function(err) {
    if (err) console.warn('[DB] guest_profiles create:', err.message);
  });

  // Migrazioni guest_profiles (per DB già esistenti con schema incompleto)
  ['ADD COLUMN assignment_group_id INTEGER',
   'ADD COLUMN bio TEXT',
   'ADD COLUMN photo_url TEXT',
   'ADD COLUMN category TEXT',
   'ADD COLUMN website TEXT',
   'ADD COLUMN social_instagram TEXT',
   'ADD COLUMN sort_order INTEGER DEFAULT 0',
   'ADD COLUMN featured INTEGER DEFAULT 0',
   'ADD COLUMN active INTEGER DEFAULT 1',
  ].forEach(function(col) {
    db.run('ALTER TABLE guest_profiles ' + col, function(err) {
      // silenzioso: errore atteso se la colonna esiste già
    });
  });

  db.run('CREATE INDEX IF NOT EXISTS idx_guest_profiles_featured ON guest_profiles(featured, active)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_guest_profiles_featured:', err.message);
  });
});


// ═══════════════════════════════════════════════════════
// VIEWS — agenda
// ═══════════════════════════════════════════════════════

// Ricrea sempre la view per aggiornare la definizione dopo migrazioni
db.run(`DROP VIEW IF EXISTS v_public_program`, () => {
  db.run(`CREATE VIEW v_public_program AS
    SELECT
      e.id, e.title, e.description, e.date, e.start_time, e.end_time,
      e.event_type, e.image_url, e.tags, e.max_seats, e.registrations_open,
      e.featured,
      e.featured AS isfeatured,
      e.location_text,
      COALESCE(e.location_text, s.name) AS space_name,
      s.color AS space_color,
      s.capacity AS space_capacity,
      COUNT(DISTINCT r.id) AS seats_taken,
      CASE
        WHEN e.max_seats = 0 THEN 'open'
        WHEN COUNT(DISTINCT r.id) >= e.max_seats THEN 'full'
        ELSE 'available'
      END AS availability,
      (SELECT GROUP_CONCAT(sp2.name, ', ')
       FROM event_speakers es2
       JOIN speakers sp2 ON sp2.id = es2.speaker_id
       WHERE es2.event_id = e.id) AS speakers_list
    FROM events e
    JOIN spaces s ON s.id = e.space_id
    LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
    WHERE e.published = 1 AND e.is_public = 1
    GROUP BY e.id
    ORDER BY e.date, e.start_time`);
});

// ═══════════════════════════════════════════════════════
// APP SETTINGS — seed valori default
// ═══════════════════════════════════════════════════════

[
  ['ap_template',''], ['ap_esp_x','350'], ['ap_esp_y','125'], ['ap_esp_size','20'],
  ['ap_num_x','95'], ['ap_num_y','125'], ['ap_tot_x','95'], ['ap_tot_y','95'],
  ['ap_qr_x','660'], ['ap_qr_y','45'], ['ap_qr_size','80']
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

  // ── Modulo Volontari ───────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS volunteers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edition_id INTEGER,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    availability TEXT,
    skills TEXT,
    tshirt_size TEXT,
    status TEXT NOT NULL DEFAULT 'approved',
    import_batch_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    birth_date TEXT,
    birth_place TEXT,
    fiscal_code TEXT,
    residence TEXT
  )`, function(err) {
    if (err) console.warn('[DB] volunteers create:', err.message);
  });

  db.run(`CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    zone_id INTEGER,
    role_label TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    max_volunteers INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(zone_id) REFERENCES zones(id)
  )`, function(err) {
    if (err) console.warn('[DB] shifts create:', err.message);
  });

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
  )`, function(err) {
    if (err) console.warn('[DB] shift_assignments create:', err.message);
  });

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignments_unique ON shift_assignments(shift_id, volunteer_id)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shift_assignments_unique:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift ON shift_assignments(shift_id)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shift_assignments_shift:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_shift_assignments_volunteer ON shift_assignments(volunteer_id)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shift_assignments_volunteer:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_shifts_start ON shifts(start_at)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shifts_start:', err.message);
  });


// ── Modulo Volontari ───────────────────────────────────────
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
  )`, function(err) {
    if (err) console.warn('[DB] volunteers create:', err.message);
  });

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
  )`, function(err) {
    if (err) console.warn('[DB] shifts create:', err.message);
  });

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
  )`, function(err) {
    if (err) console.warn('[DB] shift_assignments create:', err.message);
  });

  [
    'ALTER TABLE volunteers ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE volunteers ADD COLUMN created_at TEXT DEFAULT (datetime('now','localtime'))',
    'ALTER TABLE shifts ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE volunteers ADD COLUMN birth_date TEXT',
    'ALTER TABLE volunteers ADD COLUMN birth_place TEXT',
    'ALTER TABLE volunteers ADD COLUMN fiscal_code TEXT',
    'ALTER TABLE volunteers ADD COLUMN residence TEXT',
    "ALTER TABLE volunteers ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'",
    'ALTER TABLE volunteers ADD COLUMN edition_id INTEGER',
    'ALTER TABLE volunteers ADD COLUMN tshirt_size TEXT',
    'ALTER TABLE volunteers ADD COLUMN import_batch_id TEXT',
    'ALTER TABLE volunteers ADD COLUMN reviewed_by INTEGER',
    'ALTER TABLE volunteers ADD COLUMN reviewed_at TEXT',
    'ALTER TABLE volunteers ADD COLUMN rejection_reason TEXT'
  ].forEach(sql => {
    db.run(sql, function(err) {
      if (err && !String(err.message || '').includes('duplicate column name')) {
        console.warn('[DB] volunteer alter:', err.message);
      }
    });
  });

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignments_unique ON shift_assignments(shift_id, volunteer_id)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shift_assignments_unique:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift ON shift_assignments(shift_id)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shift_assignments_shift:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_shift_assignments_volunteer ON shift_assignments(volunteer_id)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shift_assignments_volunteer:', err.message);
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_shifts_start ON shifts(start_at)', function(err) {
    if (err && !err.message.includes('already exists')) console.warn('[DB] idx_shifts_start:', err.message);
  });
});


// ═══════════════════════════════════════════════════════
// MODULO VOLONTARI — schema compatibile
// ═══════════════════════════════════════════════════════
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
  )`, function(err) {
    if (err) console.warn('[DB] volunteers create:', err.message);
  });

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
  )`, function(err) {
    if (err) console.warn('[DB] shifts create:', err.message);
  });

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
  )`, function(err) {
    if (err) console.warn('[DB] shift_assignments create:', err.message);
  });

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignments_unique ON shift_assignments(shift_id, volunteer_id)`, function(err) {
    if (err && !String(err.message||'').includes('already exists')) console.warn('[DB] idx_shift_assignments_unique:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift ON shift_assignments(shift_id)`, function(err) {
    if (err && !String(err.message||'').includes('already exists')) console.warn('[DB] idx_shift_assignments_shift:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_shift_assignments_volunteer ON shift_assignments(volunteer_id)`, function(err) {
    if (err && !String(err.message||'').includes('already exists')) console.warn('[DB] idx_shift_assignments_volunteer:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_start ON shifts(start_at)`, function(err) {
    if (err && !String(err.message||'').includes('already exists')) console.warn('[DB] idx_shifts_start:', err.message);
  });
});

// ── Migrazione bacheca: target per gruppo specifico ──────────────────────────
db.run(`ALTER TABLE announcements ADD COLUMN target_group_id INTEGER REFERENCES assignment_groups(id)`, () => {});

// ── Modulo 7: Servizi & Logistica ────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS service_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_group_id INTEGER REFERENCES assignment_groups(id),
  type                TEXT NOT NULL,
  quantity            INTEGER DEFAULT 1,
  notes               TEXT,
  status              TEXT DEFAULT 'in_attesa',
  requested_at        TEXT DEFAULT (datetime('now','localtime')),
  updated_at          TEXT DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS equipment (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  category  TEXT,
  total_qty INTEGER DEFAULT 1,
  notes     TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS equipment_loans (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id        INTEGER NOT NULL REFERENCES equipment(id),
  assignment_group_id INTEGER REFERENCES assignment_groups(id),
  qty                 INTEGER DEFAULT 1,
  loaned_at           TEXT DEFAULT (datetime('now','localtime')),
  returned_at         TEXT,
  notes               TEXT
)`);

// ── Migrazioni Modulo 7: colonne mancanti su DB esistenti ────────────────────
db.run(`ALTER TABLE service_requests ADD COLUMN requested_at TEXT DEFAULT (datetime('now','localtime'))`, () => {});
db.run(`ALTER TABLE service_requests ADD COLUMN updated_at   TEXT DEFAULT (datetime('now','localtime'))`, () => {});
db.run(`ALTER TABLE equipment        ADD COLUMN category     TEXT`,                           () => {});
db.run(`ALTER TABLE equipment        ADD COLUMN total_qty    INTEGER DEFAULT 1`,              () => {});
db.run(`ALTER TABLE equipment        ADD COLUMN notes        TEXT`,                           () => {});
db.run(`ALTER TABLE equipment        ADD COLUMN location       TEXT`,                           () => {});
db.run(`ALTER TABLE equipment        ADD COLUMN location_custom TEXT`,                          () => {});

db.run(`ALTER TABLE equipment        ADD COLUMN location       TEXT`,                           () => {});
db.run(`ALTER TABLE equipment        ADD COLUMN location_custom TEXT`,                          () => {});
db.run(`ALTER TABLE equipment_loans  ADD COLUMN loaned_at    TEXT DEFAULT (datetime('now','localtime'))`, () => {});
db.run(`ALTER TABLE equipment_loans  ADD COLUMN returned_at  TEXT`,                          () => {});
db.run(`ALTER TABLE equipment_loans  ADD COLUMN notes        TEXT`,                          () => {});

db.run(`ALTER TABLE service_requests ADD COLUMN edition_id    INTEGER`, () => {});
db.run(`ALTER TABLE service_requests ADD COLUMN service_type  TEXT`,    () => {});


db.run(`CREATE TABLE IF NOT EXISTS logistic_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_name   TEXT UNIQUE NOT NULL,
  label      TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS logistic_locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_name   TEXT UNIQUE NOT NULL,
  label      TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER DEFAULT 0
)`);

db.run(`INSERT OR IGNORE INTO logistic_categories (key_name, label, icon, sort_order) VALUES
  ('tavolo',   'Tavolo',   '🪑', 10),
  ('sedia',    'Sedia',    '🪑', 20),
  ('prolunga', 'Prolunga', '⚡', 30),
  ('gazebo',   'Gazebo',   '⛺', 40),
  ('altro',    'Altro',    '📦', 999)
`);

db.run(`INSERT OR IGNORE INTO logistic_locations (key_name, label, icon, sort_order) VALUES
  ('segreteria_palazzetto', 'Segreteria Palazzetto', '🏛️', 10),
  ('segreteria_mariambini', 'Segreteria Mariambini', '⛪', 20),
  ('vanvere',               'Vanvere',               '🏚️', 30),
  ('uffici_ludicomix',      'Uffici Ludicomix',      '🏢', 40),
  ('altro',                 'Altro',                 '📍', 999)
`);


// ── Impostazioni logistica ────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS logistic_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL, icon TEXT, sort_order INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE IF NOT EXISTS logistic_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key_name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL, icon TEXT, sort_order INTEGER DEFAULT 0)`);
db.run(`INSERT OR IGNORE INTO logistic_categories (key_name,label,icon,sort_order) VALUES
  ('tavolo','Tavolo','🪑',10),('sedia','Sedia','🪑',20),
  ('prolunga','Prolunga','⚡',30),('gazebo','Gazebo','⛺',40),('altro','Altro','📦',999)`);
db.run(`INSERT OR IGNORE INTO logistic_locations (key_name,label,icon,sort_order) VALUES
  ('segreteria_palazzetto','Segreteria Palazzetto','🏛️',10),
  ('segreteria_mariambini','Segreteria Mariambini','⛪',20),
  ('vanvere','Vanvere','🏚️',30),('uffici_ludicomix','Uffici Ludicomix','🏢',40),
  ('altro','Altro','📍',999)`);

// ── Checklist ─────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, area TEXT,
  phase TEXT NOT NULL DEFAULT 'montaggio', sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')))`);
db.run(`CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  text TEXT NOT NULL, sort_order INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE IF NOT EXISTS checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
  edition_id INTEGER, started_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT, notes TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS checklist_run_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES checklist_runs(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES checklist_items(id),
  done INTEGER DEFAULT 0, done_at TEXT, done_by TEXT)`);

// ── Catering staff ─────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS catering_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, date TEXT,
  meal_type TEXT NOT NULL DEFAULT 'pranzo', edition_id INTEGER,
  notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`);
db.run(`CREATE TABLE IF NOT EXISTS catering_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES catering_shifts(id) ON DELETE CASCADE,
  staff_name TEXT NOT NULL, role TEXT, menu_choice TEXT,
  dietary TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`);

// ── Fornitori ──────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
  contact_name TEXT, phone TEXT, email TEXT, website TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')))`);
db.run(`CREATE TABLE IF NOT EXISTS supplier_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  description TEXT NOT NULL, item_type TEXT DEFAULT 'noleggio',
  quantity INTEGER DEFAULT 1, unit_cost REAL, total_cost REAL,
  edition_id INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`);

// ── Migrazioni equipment ───────────────────────────────────────
db.run(`ALTER TABLE equipment ADD COLUMN location TEXT`,        () => {});
db.run(`ALTER TABLE equipment ADD COLUMN location_custom TEXT`, () => {});

module.exports = db;