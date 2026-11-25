-- ScholarDesk Pro — Central License & Subscription Server schema (PostgreSQL / Supabase)
-- Idempotent: safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  name_bn         TEXT,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  district        TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE license_status AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE billing_cycle AS ENUM ('MONTHLY', 'YEARLY', 'LIFETIME', 'TRIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS licenses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  license_key        TEXT NOT NULL UNIQUE,
  status             license_status NOT NULL DEFAULT 'ACTIVE',
  billing_cycle      billing_cycle NOT NULL DEFAULT 'YEARLY',
  price_bdt          NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_until        DATE NOT NULL,
  max_students       INTEGER NOT NULL DEFAULT 2000,
  machine_id         TEXT,                  -- bound on first activation
  activated_at       TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  last_app_version   TEXT,
  last_student_count INTEGER,
  last_ip            TEXT,
  suspend_reason     TEXT,
  payment_notice     TEXT,                  -- per-school override for the lock screen
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_licenses_school ON licenses(school_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status, valid_until);

CREATE TABLE IF NOT EXISTS payment_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id     UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  amount_bdt     NUMERIC(12,2) NOT NULL CHECK (amount_bdt >= 0),
  method         TEXT NOT NULL,             -- bKash / Nagad / Bank / Gateway / Cash
  transaction_ref TEXT,
  period_from    DATE,
  period_to      DATE,
  extended_to    DATE,                      -- valid_until after this payment
  note           TEXT,
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_license ON payment_logs(license_id, paid_at DESC);

-- Every desktop heartbeat (useful for support & anti-abuse)
CREATE TABLE IF NOT EXISTS heartbeat_logs (
  id              BIGSERIAL PRIMARY KEY,
  license_id      UUID REFERENCES licenses(id) ON DELETE CASCADE,
  license_key     TEXT NOT NULL,
  machine_id      TEXT,
  app_version     TEXT,
  student_count   INTEGER,
  client_utc      BIGINT,
  server_utc      BIGINT NOT NULL,
  clock_skew_sec  BIGINT,
  result_status   TEXT NOT NULL,
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_license ON heartbeat_logs(license_id, created_at DESC);

-- Owner-wide settings (payment instructions shown on every lock screen, etc.)
CREATE TABLE IF NOT EXISTS owner_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO owner_settings(key, value) VALUES
  ('payment_instructions',
   'Please renew your ScholarDesk Pro subscription.' || chr(10) ||
   'bKash (Personal): 01XXXXXXXXX  |  Nagad: 01XXXXXXXXX' || chr(10) ||
   'Bank: ABC Bank Ltd, A/C 0000000000, Branch: Dhaka' || chr(10) ||
   'Use your License Key as the payment reference, then press "Verify Payment & Sync Online Now".' || chr(10) ||
   'Support: +880 1XXX-XXXXXX')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_audit (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
