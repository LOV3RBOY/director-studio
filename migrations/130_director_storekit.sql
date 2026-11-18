CREATE TABLE director_store_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE
);

CREATE TABLE director_store_transactions (
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  transaction_id TEXT NOT NULL,
  original_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'credits')),
  granted INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  signed_at INTEGER NOT NULL,
  PRIMARY KEY (environment, transaction_id)
);
CREATE INDEX director_store_entitlements ON director_store_transactions (environment, user_id, kind, expires_at);
