-- ScholarDesk license & subscription database (Cloudflare D1 / SQLite)
-- One system for both products: SCHOOL (ScholarDesk Pro) and COACHING.

CREATE TABLE schools (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  name_bn           TEXT,
  contact_person    TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  district          TEXT,
  notes             TEXT,
  students_estimate INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE licenses (
  id                 TEXT PRIMARY KEY,
  school_id          TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  license_key        TEXT NOT NULL UNIQUE,
  product            TEXT NOT NULL DEFAULT 'SCHOOL' CHECK (product IN ('SCHOOL','COACHING')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED','PENDING')),
  billing_cycle      TEXT NOT NULL DEFAULT 'YEARLY' CHECK (billing_cycle IN ('MONTHLY','YEARLY','LIFETIME','TRIAL')),
  price_bdt          REAL NOT NULL DEFAULT 0,
  valid_until        TEXT NOT NULL,           -- YYYY-MM-DD
  max_students       INTEGER NOT NULL DEFAULT 2000,
  machine_id         TEXT,
  activated_at       TEXT,
  last_seen_at       TEXT,
  last_app_version   TEXT,
  last_student_count INTEGER,
  last_ip            TEXT,
  suspend_reason     TEXT,
  payment_notice     TEXT,
  source             TEXT NOT NULL DEFAULT 'admin',   -- 'admin' | 'app'
  requested_at       TEXT,
  requested_plan     TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_licenses_school ON licenses(school_id);
CREATE INDEX idx_licenses_status ON licenses(status, valid_until);
CREATE INDEX idx_licenses_machine ON licenses(machine_id);

CREATE TABLE payment_logs (
  id              TEXT PRIMARY KEY,
  license_id      TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  amount_bdt      REAL NOT NULL CHECK (amount_bdt >= 0),
  method          TEXT NOT NULL,
  transaction_ref TEXT,
  period_from     TEXT,
  period_to       TEXT,
  extended_to     TEXT,
  note            TEXT,
  paid_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_license ON payment_logs(license_id, paid_at);

-- Heartbeats are sampled (status change or at most every 6 h per PC) to stay far below D1's free write limit.
CREATE TABLE heartbeat_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id     TEXT REFERENCES licenses(id) ON DELETE CASCADE,
  license_key    TEXT NOT NULL,
  machine_id     TEXT,
  app_version    TEXT,
  student_count  INTEGER,
  client_utc     INTEGER,
  server_utc     INTEGER NOT NULL,
  clock_skew_sec INTEGER,
  result_status  TEXT NOT NULL,
  ip             TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_heartbeats_license ON heartbeat_logs(license_id, created_at);

CREATE TABLE owner_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO owner_settings(key, value) VALUES ('payment_instructions',
 'Please renew your subscription.' || char(10) ||
 'bKash (Personal): 01XXXXXXXXX  |  Nagad: 01XXXXXXXXX' || char(10) ||
 'Use your License Key as the payment reference, then press "Verify Payment & Sync Online Now".' || char(10) ||
 'Support: +880 1XXX-XXXXXX');

CREATE TABLE admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Fixed-window counters for login / registration / verify rate limits (Workers have no shared memory).
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
