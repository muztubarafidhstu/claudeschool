-- Owner's emergency PIN (same for all schools). The app receives only a salted PBKDF2 hash.
INSERT OR IGNORE INTO owner_settings(key, value) VALUES ('emergency_pin', '12345');
