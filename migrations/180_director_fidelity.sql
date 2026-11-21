-- Phase C: score each delivered take against its pinned style, and keep graded copies.
-- Scoring runs in its own queue instead of a new director_jobs kind. Adding a kind
-- would mean rebuilding director_jobs, and dropping that table inside the migration
-- transaction would cascade-delete director_render_reviews rows.
CREATE TABLE director_fidelity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES director_jobs(id) ON DELETE CASCADE,
  style_version_id TEXT NOT NULL REFERENCES director_style_versions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  report TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX director_fidelity_job ON director_fidelity (job_id, created_at);
CREATE INDEX director_fidelity_due ON director_fidelity (state, next_run);

CREATE TABLE director_grades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES director_jobs(id) ON DELETE CASCADE,
  source_asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  strength REAL NOT NULL CHECK (strength > 0 AND strength <= 1),
  lut_sha256 TEXT NOT NULL,
  report TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX director_grades_job ON director_grades (job_id, created_at);
