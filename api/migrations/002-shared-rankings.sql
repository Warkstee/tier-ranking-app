-- Shared rankings table for read-only shareable links
-- Allows users to generate unique tokens that grant public read-only access to their rankings

CREATE TABLE IF NOT EXISTS shared_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  ranking_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (ranking_id) REFERENCES rankings(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast token lookups (critical for public share link access)
CREATE INDEX IF NOT EXISTS idx_shared_rankings_token ON shared_rankings(token);
CREATE INDEX IF NOT EXISTS idx_shared_rankings_ranking_id ON shared_rankings(ranking_id);
CREATE INDEX IF NOT EXISTS idx_shared_rankings_is_active ON shared_rankings(is_active);
