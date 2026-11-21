CREATE TABLE director_render_reviews (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES director_jobs(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('resume', 'release', 'charge')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX director_render_reviews_job ON director_render_reviews (job_id, created_at);
