-- Auth tables were generated from src/auth-config.ts via better-auth's getMigrations(), with the `approved` default added by hand.

CREATE TABLE "user" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "email"         TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image"         TEXT,
  "createdAt"     DATE NOT NULL,
  "updatedAt"     DATE NOT NULL,
  "approved"      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "session" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token"     TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId"    TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "accountId"             TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "userId"                TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  DATE,
  "refreshTokenExpiresAt" DATE,
  "scope"                 TEXT,
  "password"              TEXT,
  "createdAt"             DATE NOT NULL,
  "updatedAt"             DATE NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expiresAt"  DATE NOT NULL,
  "createdAt"  DATE NOT NULL,
  "updatedAt"  DATE NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE tracks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  creator_name     TEXT NOT NULL,
  uploaded_by_id   TEXT NOT NULL REFERENCES "user" ("id"),
  uploaded_by_name TEXT NOT NULL,
  created_date     TEXT NOT NULL,   -- YYYY-MM-DD, set by the uploader
  uploaded_at      TEXT NOT NULL,   -- ISO timestamp, set by the server
  lev_key          TEXT NOT NULL,
  lev_size         INTEGER NOT NULL,
  lev_sha256       TEXT NOT NULL,
  vrm_key          TEXT,
  vrm_size         INTEGER,
  vrm_sha256       TEXT,
  sca_key          TEXT,
  sca_size         INTEGER,
  sca_sha256       TEXT
);
CREATE INDEX idx_tracks_uploaded_at ON tracks(uploaded_at DESC);