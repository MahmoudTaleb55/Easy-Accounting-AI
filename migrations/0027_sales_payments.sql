-- Customer Receipt Vouchers (سند قبض) — AR mirror of purchase_payments.
--
-- Two tables follow the same workspace-isolation defense-in-depth recipe
-- as migration 0025 (Purchase Portal):
--   1. NOT NULL company_id with no default.
--   2. UNIQUE (id, company_id) so children can hang composite FKs off the
--      parent.
--   3. Explicit composite FKs on every cross-table reference.
--
-- RLS policies for `sales_payments` and `sales_payment_allocations` are
-- installed at boot by server/db-bootstrap-rls.ts (the two new table
-- names were appended to RLS_TABLES in the same patch as this file).
--
-- The whole file is idempotent: each CREATE uses IF NOT EXISTS; each
-- constraint is wrapped in a DO $$ ... pg_constraint guard so re-running
-- after `drizzle-kit push` already materialised the schema is safe.

-- 1. sales_payments ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sales_payments" (
  "id"                serial PRIMARY KEY,
  "company_id"        integer NOT NULL,
  "number"            text    NOT NULL,
  "customer_id"       integer NOT NULL,
  "payment_date"      text    NOT NULL,
  "amount"            numeric(14, 2) NOT NULL DEFAULT 0,
  "notes"             text    NOT NULL DEFAULT '',
  "status"            text    NOT NULL DEFAULT 'posted',
  "journal_entry_id"  integer,
  "created_at"        timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payments_id_company_uq'
  ) THEN
    ALTER TABLE "sales_payments"
      ADD CONSTRAINT "sales_payments_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payments_number_company_uq'
  ) THEN
    ALTER TABLE "sales_payments"
      ADD CONSTRAINT "sales_payments_number_company_uq" UNIQUE ("company_id", "number");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payments_customer_company_fk'
  ) THEN
    ALTER TABLE "sales_payments"
      ADD CONSTRAINT "sales_payments_customer_company_fk"
      FOREIGN KEY ("customer_id", "company_id")
      REFERENCES "customers" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payments_journal_entry_company_fk'
  ) THEN
    ALTER TABLE "sales_payments"
      ADD CONSTRAINT "sales_payments_journal_entry_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id")
      REFERENCES "journal_entries" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_payments_customer_idx"
  ON "sales_payments" ("company_id", "customer_id");
--> statement-breakpoint

-- 2. sales_payment_allocations ---------------------------------------------

CREATE TABLE IF NOT EXISTS "sales_payment_allocations" (
  "id"          serial PRIMARY KEY,
  "company_id"  integer NOT NULL,
  "payment_id"  integer NOT NULL,
  "invoice_id"  integer NOT NULL,
  "amount"      numeric(14, 2) NOT NULL DEFAULT 0
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payment_allocations_payment_company_fk'
  ) THEN
    ALTER TABLE "sales_payment_allocations"
      ADD CONSTRAINT "sales_payment_allocations_payment_company_fk"
      FOREIGN KEY ("payment_id", "company_id")
      REFERENCES "sales_payments" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payment_allocations_invoice_company_fk'
  ) THEN
    ALTER TABLE "sales_payment_allocations"
      ADD CONSTRAINT "sales_payment_allocations_invoice_company_fk"
      FOREIGN KEY ("invoice_id", "company_id")
      REFERENCES "sales_invoices" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_payment_allocations_payment_idx"
  ON "sales_payment_allocations" ("payment_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_payment_allocations_invoice_idx"
  ON "sales_payment_allocations" ("invoice_id");
