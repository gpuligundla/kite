-- BLOB columns hold AES-GCM sealed values (see crypto.py).

CREATE TABLE IF NOT EXISTS family (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  wrapped_key BLOB            -- NULL once the family is shredded
);

CREATE TABLE IF NOT EXISTS kid (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES family(id),
  display_name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 12),
  school_start_year INTEGER NOT NULL,
  settings BLOB
);

CREATE TABLE IF NOT EXISTS device (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  kind TEXT NOT NULL CHECK (kind IN ('os', 'handheld', 'parent', 'counselor')),
  token_hash TEXT NOT NULL UNIQUE,
  UNIQUE (kid_id, kind)
);

CREATE TABLE IF NOT EXISTS contact (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  name BLOB NOT NULL,
  phone BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_event (
  id TEXT PRIMARY KEY,        -- ULID
  kid_id TEXT NOT NULL REFERENCES kid(id),
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 12),
  at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('concept_evidence', 'curiosity_signal', 'profile_fact', 'moment')),
  concept_id TEXT,
  topic TEXT,
  source_turn_id TEXT,
  payload BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_event_kid_grade ON learning_event(kid_id, grade);

CREATE TABLE IF NOT EXISTS moment_vector (
  event_id TEXT PRIMARY KEY REFERENCES learning_event(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS session_turn (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  session_id TEXT NOT NULL,
  device TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('kid', 'kite')),
  at TEXT NOT NULL,
  expires_at TEXT NOT NULL,   -- real insert time + 30 days, never simulated
  text BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS alert (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  kinds TEXT NOT NULL,        -- JSON array of AlertKind
  routed_to TEXT NOT NULL CHECK (routed_to IN ('parent', 'counselor')),
  at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  excerpt BLOB NOT NULL,
  location BLOB,              -- SOS only
  source_turn_id TEXT,        -- the kid's turn that raised it; NULL for SOS
  session_id TEXT             -- that turn's session, so the counselor's context never matches by time
);

-- The counselor's case log for a counselor-routed alert, one row per change. The latest row is the
-- status; an alert with no row is new. Notes are sealed with the family key.
CREATE TABLE IF NOT EXISTS alert_case (
  id TEXT PRIMARY KEY,        -- ULID
  alert_id TEXT NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  status TEXT NOT NULL CHECK (status IN ('new', 'reviewing', 'met_with_student', 'reported', 'closed')),
  at TEXT NOT NULL,
  note BLOB
);
CREATE INDEX IF NOT EXISTS alert_case_alert ON alert_case(alert_id);

CREATE TABLE IF NOT EXISTS big_question_card (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 12),
  at TEXT NOT NULL,
  topic TEXT NOT NULL,
  source_turn_id TEXT,
  summary BLOB NOT NULL,
  starter BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS policy (
  family_id TEXT NOT NULL REFERENCES family(id),
  topic TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('answer', 'answer_and_tell', 'ask_parent')),
  PRIMARY KEY (family_id, topic)
);

CREATE TABLE IF NOT EXISTS assignment (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL REFERENCES kid(id),
  title TEXT NOT NULL,
  description BLOB NOT NULL,
  is_quiz INTEGER NOT NULL CHECK (is_quiz IN (0, 1)),
  unlock_at TEXT,
  due_at TEXT,
  lock_at TEXT,
  concept_id TEXT NOT NULL,
  topic TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_item (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text BLOB NOT NULL,
  embedding BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS access_receipt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,
  kid_id TEXT NOT NULL,
  what TEXT NOT NULL,
  at TEXT NOT NULL
);

-- The kid's last "New topic". Recall's history and the session start again after it; learning stays.
CREATE TABLE IF NOT EXISTS fresh_start (
  kid_id TEXT PRIMARY KEY REFERENCES kid(id),
  at TEXT NOT NULL
);
