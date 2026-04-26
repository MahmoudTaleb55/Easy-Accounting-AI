-- Task #257: best-effort backfill of `asset_balance_delta` for impairment,
-- revaluation, and disposal rows that were posted before migration 0015
-- introduced the snapshot column.
--
-- Background
-- ----------
-- Task #157 added a per-event JSON snapshot (`asset_balance_delta`) to
-- `impairment_events`, `revaluation_events`, and `disposals` so the matching
-- DELETE routes can roll the asset row back precisely (accumImpairment,
-- cost/accumDep/accumImp, revalSurplus, accumRevalLoss, status). Task #208
-- then closed a silent-corruption gap in those delete paths: any row whose
-- snapshot is NULL (i.e. posted before 0015) is now refused with a 409
-- (`LegacyAssetEventBalanceMissingError`) instead of silently reversing only
-- the journal entry while leaving the asset sub-ledger stale.
--
-- That guard is correct, but it leaves users with no in-app way to remove
-- those legacy rows — they have to ask an engineer to clean them up by hand.
-- This migration writes a *best-effort* snapshot on every NULL row using the
-- columns each row already carries, restoring the standard delete path for
-- the bulk of historical data.
--
-- The reconstruction is honest about what it can and can't recover. The
-- delete-side rollback helpers (`reverseImpairmentBalanceDelta`,
-- `reverseRevaluationBalanceDelta`, `reverseDisposalBalanceDelta` in
-- `server/storage.ts`) only touch fields that are actually present in the
-- snapshot, so omitting an unrecoverable field means the delete leaves it
-- alone — exactly the right behaviour when we don't know the original delta.
--
-- The 409 refusal in the delete path stays in place as a defence-in-depth
-- net for any row this backfill cannot recover (e.g. someone manually
-- writing NULL back, or a future column nuance we missed).
--
-- Reconstruction rules
-- --------------------
-- 1. impairment_events
--    The create handler (server/routes.ts) stores
--      { asset: { accumImpairment: signedDelta }, components: [...] }
--    where `signedDelta == loss_amount` (positive for a loss, negative for a
--    reversal). We can recover the asset-level delta exactly from
--    `loss_amount`.
--    The per-component breakdown was computed by allocating the loss
--    proportionally to each component's *carrying amount at the time*, then
--    clamped at zero. None of those inputs survive on the row, so the
--    component split is NOT recoverable. We backfill `components: []`,
--    which means a delete will roll the asset-level `accumImpairment` back
--    correctly but will NOT touch any per-component `accumImpairment`. For
--    legacy rows on assets that have components, the user may need to
--    nudge the per-component values by hand after the delete.
--
-- 2. revaluation_events
--    The create handler stores
--      { asset: { cost, accumDepreciation, accumImpairment,
--                 revalSurplus, accumRevalLoss } }
--    Of these only `revalSurplus` (== `surplus_delta`) and `accumRevalLoss`
--    (≈ `max(0,-pl_impact) - max(0, pl_impact)` modulo a clamp at zero) are
--    derivable from the row. The cost / accumDepreciation / accumImpairment
--    deltas come from the IFRS revaluation calculator and depend on the
--    pre-event asset state, which is not on the row. We omit those keys so
--    the rollback leaves them alone.
--    The accumRevalLoss recovery is best-effort: the create handler clamps
--    the new value at zero, so for a row whose downward revaluation hit the
--    clamp the recovered delta will be slightly off. Rare in practice
--    (requires the prior accumRevalLoss to already be larger than the
--    incoming positive plImpact) and the clamp on the rollback side keeps
--    the value non-negative either way.
--
-- 3. disposals
--    The create handler stores
--      { asset: { revalSurplus: -surplus_transferred,
--                 statusBefore: <prior status>,
--                 statusAfter: 'disposed' } }
--    `revalSurplus` is recoverable from `surplus_transferred`. The prior
--    `status` is NOT on the row. We assume `statusBefore: 'active'`, which
--    is the only status from which a disposal can be posted today (the POST
--    handler in routes.ts refuses if `status === 'disposed'`), so this
--    assumption is safe for any row that went through the public route.
--    `statusAfter` is always `'disposed'`. The rollback helper only restores
--    `statusBefore` if the current status still equals `statusAfter`, so an
--    asset that has been manually nudged out of `disposed` since the legacy
--    row was posted will simply skip the status restore.
--
-- Idempotency
-- -----------
-- Every UPDATE filters on `asset_balance_delta IS NULL`, so re-running this
-- migration on a database that has already been backfilled is a no-op. New
-- rows posted after migration 0015 already carry a snapshot and will be
-- skipped. The migration runner records this filename in the
-- `schema_migrations` ledger after the first successful apply, but the NULL
-- gate is the real correctness guarantee — dev DBs that short-circuit
-- through `drizzle-kit push` will still execute the file at least once.

-- 1. impairment_events -----------------------------------------------------
UPDATE "impairment_events"
   SET "asset_balance_delta" = jsonb_build_object(
         'asset',      jsonb_build_object('accumImpairment', "loss_amount"::numeric),
         'components', '[]'::jsonb
       )
 WHERE "asset_balance_delta" IS NULL;
--> statement-breakpoint

-- 2. revaluation_events ----------------------------------------------------
-- accumRevalLoss delta = max(0, -pl_impact) - max(0, pl_impact)
--   plImpact < 0 (downward, P&L loss):  +|pl_impact|  → accumRevalLoss grew
--   plImpact > 0 (upward reversal):     -pl_impact    → accumRevalLoss shrank
--   plImpact = 0:                        0            → no change
UPDATE "revaluation_events"
   SET "asset_balance_delta" = jsonb_build_object(
         'asset', jsonb_build_object(
           'revalSurplus',   "surplus_delta"::numeric,
           'accumRevalLoss', GREATEST(0::numeric, -("pl_impact"::numeric))
                             - GREATEST(0::numeric,  "pl_impact"::numeric)
         )
       )
 WHERE "asset_balance_delta" IS NULL;
--> statement-breakpoint

-- 3. disposals -------------------------------------------------------------
UPDATE "disposals"
   SET "asset_balance_delta" = jsonb_build_object(
         'asset', jsonb_build_object(
           'revalSurplus', -("surplus_transferred"::numeric),
           'statusBefore', 'active',
           'statusAfter',  'disposed'
         )
       )
 WHERE "asset_balance_delta" IS NULL;
