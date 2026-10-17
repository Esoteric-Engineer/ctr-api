CREATE TABLE users (
  discord_id    TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  approved      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE tracks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  creator_name     TEXT NOT NULL,
  uploaded_by_id   TEXT NOT NULL REFERENCES users(discord_id),
  uploaded_by_name TEXT NOT NULL,
  created_date     TEXT NOT NULL,   -- YYYY-MM-DD, set by the uploader
  uploaded_at      TEXT NOT NULL,   -- ISO timestamp, set by the server
  lev_key          TEXT NOT NULL,
  vrm_key          TEXT NOT NULL,
  sca_key          TEXT NOT NULL
);
CREATE INDEX idx_tracks_uploaded_at ON tracks(uploaded_at DESC);