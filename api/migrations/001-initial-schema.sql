-- Complete schema for tier-ranking-app
-- Normalized data model with proper relationships

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  min_score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 10,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id INTEGER NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  min_score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 10,
  FOREIGN KEY (ranking_id) REFERENCES rankings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id INTEGER NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  FOREIGN KEY (ranking_id) REFERENCES rankings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id INTEGER NOT NULL,
  client_id TEXT,
  tier_id INTEGER,
  name TEXT NOT NULL,
  image TEXT,
  description TEXT,
  notes TEXT,
  FOREIGN KEY (ranking_id) REFERENCES rankings(id) ON DELETE CASCADE,
  FOREIGN KEY (tier_id) REFERENCES tiers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  criteria_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE,
  UNIQUE(candidate_id, criteria_id)
);

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

CREATE TABLE IF NOT EXISTS ahp_comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_id INTEGER NOT NULL,
  criterion_a_id TEXT NOT NULL,
  criterion_b_id TEXT NOT NULL,
  favored_id TEXT,
  degree INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (ranking_id) REFERENCES rankings(id) ON DELETE CASCADE,
  UNIQUE(ranking_id, criterion_a_id, criterion_b_id)
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_rankings_user_id ON rankings(user_id);
CREATE INDEX IF NOT EXISTS idx_rankings_updated_at ON rankings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tiers_ranking_id ON tiers(ranking_id);
CREATE INDEX IF NOT EXISTS idx_criteria_ranking_id ON criteria(ranking_id);
CREATE INDEX IF NOT EXISTS idx_candidates_ranking_id ON candidates(ranking_id);
CREATE INDEX IF NOT EXISTS idx_candidates_tier_id ON candidates(tier_id);
CREATE INDEX IF NOT EXISTS idx_scores_candidate_id ON scores(candidate_id);
CREATE INDEX IF NOT EXISTS idx_scores_criteria_id ON scores(criteria_id);
CREATE INDEX IF NOT EXISTS idx_shared_rankings_token ON shared_rankings(token);
CREATE INDEX IF NOT EXISTS idx_shared_rankings_ranking_id ON shared_rankings(ranking_id);
CREATE INDEX IF NOT EXISTS idx_shared_rankings_is_active ON shared_rankings(is_active);
CREATE INDEX IF NOT EXISTS idx_ahp_comparisons_ranking_id ON ahp_comparisons(ranking_id);
