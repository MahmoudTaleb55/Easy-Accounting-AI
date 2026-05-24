-- Performance indexes for core workspace-scoped tables.
-- Every query in the application filters by company_id first; without a
-- dedicated index the planner must scan the whole table even when the
-- company only owns a small fraction of rows.
-- Note: plain CREATE INDEX (not CONCURRENTLY) so this can run inside the
-- migrations runner transaction block.

CREATE INDEX IF NOT EXISTS je_company_idx
  ON journal_entries (company_id);

CREATE INDEX IF NOT EXISTS jl_company_idx
  ON journal_lines (company_id);

-- Composite index covering both the workspace filter and the date range
-- used by computeCashFlow and generateAlerts.
CREATE INDEX IF NOT EXISTS txn_company_date_idx
  ON transactions (company_id, date);

CREATE INDEX IF NOT EXISTS acct_company_idx
  ON accounts (company_id);
