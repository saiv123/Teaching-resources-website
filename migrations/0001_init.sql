-- Published resources. Only the admin (via approvals or the admin API) writes here.
CREATE TABLE resources (
  id                   TEXT PRIMARY KEY,               -- stable slug, e.g. "teaching-to-transgress"
  type                 TEXT NOT NULL,                  -- see TYPES in src/shared.js
  section              TEXT NOT NULL,                  -- theme heading, e.g. "Literacy & the Science of Reading"
  title                TEXT NOT NULL,
  url                  TEXT,                           -- optional (books often have none)
  description          TEXT NOT NULL,
  citation             TEXT NOT NULL,                  -- APA 7; *asterisks* mark italics
  citation_approximate INTEGER NOT NULL DEFAULT 0,     -- 1 = "(details approximate)"
  status               TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_resources_status ON resources (status, type, section);

-- Public suggestions and reports, waiting for review. Nothing here is shown on the site.
CREATE TABLE submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('suggest', 'report')),
  resource_id TEXT,                                    -- reports only
  reason      TEXT,                                    -- reports only
  payload     TEXT NOT NULL,                           -- JSON: proposed fields
  note        TEXT,                                    -- private note to the reviewer
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash     TEXT,                                    -- for rate limiting only
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX idx_submissions_status ON submissions (status, created_at);
CREATE INDEX idx_submissions_ip ON submissions (ip_hash, created_at);
