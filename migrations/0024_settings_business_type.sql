-- Workspace business type — drives which sections appear in the IFRS reports.
--
-- Background: a service company has no inventory and therefore no Cost of
-- Goods Sold, while a trading or manufacturing company does. Hard-coding a
-- COGS section into the income statement makes the report look broken
-- ("لا توجد تكلفة بضائع مسجلة" forever) for service workspaces, and forces
-- trading workspaces to live with a section that never collapses even when
-- empty. This column lets each workspace declare its model once, and the
-- /reports renderer reads it to decide which rows to draw.
--
-- Allowed values are enforced at the application layer by the
-- `upsertSettingsSchema` enum in shared/schema.ts:
--   service       — default; suppresses the COGS block on the income statement
--   trading       — full income statement with COGS
--   manufacturing — full income statement with COGS (WIP is future work)
--
-- Default "service" is the safest assumption for an unconfigured workspace
-- because it never implies inventory the owner does not actually track. The
-- existing seed flow (`seedSettingsForCompany`) keeps writing the same
-- defaults for new workspaces; this column simply gives them a value to
-- read instead of `undefined`.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "business_type" text NOT NULL DEFAULT 'service';
