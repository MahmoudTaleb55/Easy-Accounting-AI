-- Task #157: store the per-asset balance deltas applied by impairment,
-- revaluation, and disposal events so the matching DELETE routes can roll
-- the asset row back precisely (in addition to reversing the linked JE).
--
-- Idempotent: every column add uses IF NOT EXISTS so re-running the migration
-- on already-patched databases (drizzle push, hot-reload, etc) is a no-op.
ALTER TABLE impairment_events
  ADD COLUMN IF NOT EXISTS asset_balance_delta jsonb;
ALTER TABLE revaluation_events
  ADD COLUMN IF NOT EXISTS asset_balance_delta jsonb;
ALTER TABLE disposals
  ADD COLUMN IF NOT EXISTS asset_balance_delta jsonb;
