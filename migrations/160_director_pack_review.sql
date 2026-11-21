CREATE TABLE director_pack_reviews (
  snapshot_id TEXT PRIMARY KEY REFERENCES director_packs(id) ON DELETE CASCADE,
  reviewed_at INTEGER NOT NULL
);
