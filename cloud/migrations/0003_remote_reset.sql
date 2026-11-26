-- Owner can wipe a school's app data remotely (applied on the app's next online check).
ALTER TABLE licenses ADD COLUMN reset_id TEXT;
ALTER TABLE licenses ADD COLUMN reset_requested_at TEXT;
