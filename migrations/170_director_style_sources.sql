CREATE TABLE director_style_sources (
  style_id TEXT NOT NULL REFERENCES director_styles(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
  PRIMARY KEY (style_id, ordinal)
);

INSERT INTO director_style_sources (style_id, asset_id, ordinal)
SELECT id, asset_id, 0 FROM director_styles;
