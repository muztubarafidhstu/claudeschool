-- ScholarDesk Pro — local schema v2
--  * students.class_no now holds a Class (school, 1–10) OR a Batch number (coaching, 1–99)
--  * coaching exams (any number per batch, with note) + marks
--  * teacher pay types (monthly / daily / per class)
--  * SMS log
-- Runs with foreign keys OFF (see db.rs) so rebuilding `students` never touches related rows.

CREATE TABLE students_v2 (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     TEXT NOT NULL UNIQUE,
  admission_year INTEGER NOT NULL,
  admission_date TEXT NOT NULL,
  class_no       INTEGER NOT NULL CHECK (class_no BETWEEN 1 AND 99),
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
  photo          TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','graduated','left','promoting')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO students_v2 SELECT id, student_id, admission_year, admission_date, class_no, section, stream, roll, name_en, name_bn, gender, dob,
  blood_group, birth_cert_no, father_name, father_mobile, mother_name, mother_mobile, address, monthly_fee, admission_fee, photo, status,
  created_at, updated_at FROM students;
DROP TABLE students;
ALTER TABLE students_v2 RENAME TO students;
CREATE UNIQUE INDEX ux_students_class_roll ON students(class_no, roll) WHERE status = 'active';
CREATE INDEX ix_students_class_section ON students(class_no, section, roll);
CREATE INDEX ix_students_father_mobile ON students(father_mobile);
CREATE INDEX ix_students_mother_mobile ON students(mother_mobile);

-- Teacher pay: MONTHLY (salary), DAILY (rate × days), PER_CLASS (rate × classes taken)
ALTER TABLE staff ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE staff ADD COLUMN pay_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE salary_ledger ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE salary_ledger ADD COLUMN units REAL;
ALTER TABLE salary_ledger ADD COLUMN unit_rate REAL;

-- Coaching exams: any number per batch (weekly test, model test…), one total mark per exam
CREATE TABLE coaching_exams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_no   INTEGER NOT NULL,             -- batch number
  name       TEXT NOT NULL,
  exam_date  TEXT NOT NULL,                -- YYYY-MM-DD
  note       TEXT,
  full_marks REAL NOT NULL CHECK (full_marks > 0),
  pass_marks REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_cexams_class ON coaching_exams(class_no, exam_date);

CREATE TABLE coaching_marks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id    INTEGER NOT NULL REFERENCES coaching_exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  obtained   REAL,
  absent     INTEGER NOT NULL DEFAULT 0,
  remark     TEXT,
  sms_sent_at TEXT,
  UNIQUE (exam_id, student_id)
);

CREATE TABLE sms_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_number  TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL,                -- SENT | FAILED
  response   TEXT,
  purpose    TEXT,                          -- RESULT | TEST | …
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_sms_created ON sms_log(created_at)
