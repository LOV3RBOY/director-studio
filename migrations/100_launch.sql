-- The launch-week offer shown in the strip above the nav (src/content/site.ts, `promo`).
-- 100 credits per account, redeemable until 2026-11-20 08:00 UTC. The end time here and
-- `promo.endsAt` must stay the same, so the countdown on screen is the real deadline.
INSERT OR IGNORE INTO account_promo_codes (code, credits, max_uses, expires_at, created_at)
VALUES ('LAUNCH-WEEK', 100000, NULL, 1795161600000, 0);
