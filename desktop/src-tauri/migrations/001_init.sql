-- ScholarDesk Pro — local SQLite schema v1
-- Indexed for up to 200 students per class (2,000 per school) with years of attendance history.

CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,              -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     TEXT NOT NULL UNIQUE,   -- YYCCRR (roll >= 100 => YYCCRRR)
  admission_year INTEGER NOT NULL,
  admission_date TEXT NOT NULL,          -- YYYY-MM-DD
  class_no       INTEGER NOT NULL CHECK (class_no BETWEEN 1 AND 10),
  section        TEXT NOT NULL DEFAULT 'A',
  stream         TEXT CHECK (stream IN ('Science','Arts','Commerce') OR stream IS NULL),
  roll           INTEGER NOT NULL CHECK (roll BETWEEN 1 AND 200),
  name_en        TEXT NOT NULL,
  name_bn        TEXT,
  gender         TEXT,
  dob            TEXT,
  blood_group    TEXT,
  birth_cert_no  TEXT,
  father_name    TEXT,
  father_mobile  TEXT,
  mother_name    TEXT,
  mother_mobile  TEXT,
  address        TEXT,
  monthly_fee    REAL NOT NULL DEFAULT 0,
  admission_fee  REAL NOT NULL DEFAULT 0,
  photo          TEXT,                   -- small JPEG data URL (~25 KB)
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','graduated','left','promoting')), -- 'promoting' only exists inside the promotion transaction
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_students_class_roll ON students(class_no, roll) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_students_class_section ON students(class_no, section, roll);
CREATE INDEX IF NOT EXISTS ix_students_father_mobile ON students(father_mobile);
CREATE INDEX IF NOT EXISTS ix_students_mother_mobile ON students(mother_mobile);

CREATE TABLE IF NOT EXISTS fee_ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  receipt_no     TEXT NOT NULL UNIQUE,
  fee_type       TEXT NOT NULL CHECK (fee_type IN ('ADMISSION','MONTHLY','EXAM','OTHER')),
  period         TEXT NOT NULL,          -- 'ADMISSION' | 'YYYY-MM' | 'HALF_YEARLY-YYYY' | 'FINAL-YYYY'
  regular_amount REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_after      REAL NOT NULL DEFAULT 0, -- remaining due on this head right after this payment
  paid_on        TEXT NOT NULL,          -- YYYY-MM-DD
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_fee_student_period ON fee_ledger(student_id, period);
CREATE INDEX IF NOT EXISTS ix_fee_paid_on ON fee_ledger(paid_on);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  class_no   INTEGER NOT NULL,
  section    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('P','A')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS ix_att_date_class ON attendance_logs(date, class_no, section);

CREATE TABLE IF NOT EXISTS exam_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year INTEGER NOT NULL,
  exam          TEXT NOT NULL CHECK (exam IN ('HALF_YEARLY','FINAL')),
  class_no      INTEGER NOT NULL,
  section       TEXT,
  stream        TEXT,
  marks_json    TEXT NOT NULL,           -- [{subject, full, obtained}]
  total_full    REAL NOT NULL,
  obtained      REAL NOT NULL,
  percentage    REAL NOT NULL,
  gpa           REAL NOT NULL,
  grade         TEXT NOT NULL,
  passed        INTEGER NOT NULL,
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, academic_year, exam)
);
CREATE INDEX IF NOT EXISTS ix_results_class ON exam_results(academic_year, exam, class_no);

CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_code     TEXT NOT NULL UNIQUE,
  name_en        TEXT NOT NULL,
  name_bn        TEXT,
  designation    TEXT NOT NULL,
  mobile         TEXT NOT NULL UNIQUE,
  join_date      TEXT,
  monthly_salary REAL NOT NULL DEFAULT 0,
  address        TEXT,
  photo          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS salary_ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id       INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  slip_no        TEXT NOT NULL UNIQUE,
  period         TEXT NOT NULL,          -- YYYY-MM
  regular_amount REAL NOT NULL,
  paid_amount    REAL NOT NULL CHECK (paid_amount >= 0),
  due_after      REAL NOT NULL DEFAULT 0,
  paid_on        TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_salary_staff_period ON salary_ledger(staff_id, period)
