CREATE TABLE IF NOT EXISTS visit_counters (
  period TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
);
