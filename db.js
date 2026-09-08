// Database connection and schema for the MediBook prototype.
// Uses the SQLite driver built into Node 22+ (node:sqlite) so the prototype
// has no native build dependencies. The SRS targets PostgreSQL for production;
// the schema below keeps the same shape so migration is straightforward.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'medibook.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS patients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  given_name    TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  dob           TEXT NOT NULL,
  mobile        TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  medicare_no   TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS staff (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('reception','manager')),
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinicians (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  specialty TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS appointment_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  colour       TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

-- A slot exists whether or not it is booked (SRS s2.4.3). Booking reserves it;
-- cancellation releases it back to the pool (FR-08).
CREATE TABLE IF NOT EXISTS slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinician_id    INTEGER NOT NULL REFERENCES clinicians(id),
  start_time      TEXT NOT NULL,           -- 'YYYY-MM-DD HH:MM' local clinic time
  duration_min    INTEGER NOT NULL DEFAULT 15,
  is_reserved     INTEGER NOT NULL DEFAULT 0,
  lock_expires_at TEXT,                    -- FR-04 five-minute selection lock
  locked_by       INTEGER,
  UNIQUE (clinician_id, start_time)
);

CREATE TABLE IF NOT EXISTS appointments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id         INTEGER NOT NULL UNIQUE REFERENCES slots(id),
  patient_id      INTEGER NOT NULL REFERENCES patients(id),
  clinician_id    INTEGER NOT NULL REFERENCES clinicians(id),
  type_id         INTEGER NOT NULL REFERENCES appointment_types(id),
  start_time      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked','arrived','attended','dna','cancelled')),
  booking_channel TEXT NOT NULL DEFAULT 'online' CHECK (booking_channel IN ('online','phone')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  -- FR-05: two appointments for the same clinician at the same time are impossible
  UNIQUE (clinician_id, start_time)
);

-- FR-14: append-only audit trail of staff-initiated changes
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type  TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  action     TEXT NOT NULL,
  record_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

module.exports = db;
