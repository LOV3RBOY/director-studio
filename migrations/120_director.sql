CREATE TABLE director_styles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  mode TEXT NOT NULL CHECK (mode IN ('mock', 'live')),
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX director_styles_owner ON director_styles (user_id, created_at);

CREATE TABLE director_style_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  style_id TEXT NOT NULL REFERENCES director_styles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  saved INTEGER NOT NULL CHECK (saved IN (0, 1)),
  profile TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (style_id, version)
);
CREATE INDEX director_style_versions_owner ON director_style_versions (user_id, style_id, version);

CREATE TABLE director_projects (
  id TEXT PRIMARY KEY REFERENCES cinema_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  style_version_id TEXT NOT NULL REFERENCES director_style_versions(id),
  mode TEXT NOT NULL CHECK (mode IN ('mock', 'live')),
  brief TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX director_projects_owner ON director_projects (user_id, created_at);

CREATE TABLE director_packs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES director_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, version)
);
CREATE INDEX director_packs_owner ON director_packs (user_id, project_id, version);

CREATE TABLE director_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('analysis', 'plan', 'chat', 'export', 'render')),
  mode TEXT NOT NULL CHECK (mode IN ('mock', 'live')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'submitting', 'polling', 'review', 'succeeded', 'failed')),
  project_id TEXT REFERENCES director_projects(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES director_packs(id) ON DELETE CASCADE,
  request_key TEXT,
  input TEXT NOT NULL,
  result TEXT,
  provider_id TEXT,
  error TEXT,
  reserved INTEGER NOT NULL DEFAULT 0,
  spent INTEGER NOT NULL DEFAULT 0,
  released INTEGER NOT NULL DEFAULT 0,
  next_run INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, mode, kind, request_key)
);
CREATE INDEX director_jobs_due ON director_jobs (mode, state, next_run);
CREATE INDEX director_jobs_owner ON director_jobs (user_id, project_id, created_at);

CREATE TABLE director_images (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES director_packs(id) ON DELETE CASCADE,
  prompt_index INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_key)
);
CREATE INDEX director_images_pack ON director_images (user_id, snapshot_id, created_at);
