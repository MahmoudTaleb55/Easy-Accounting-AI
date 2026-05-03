-- Purchase Portal — task #368.
--
-- Mirrors the Sales Portal (migration 0019). Introduces vendors,
-- purchase_invoices (BILL-####), purchase_invoice_lines, purchase_payments
-- (APPAY-####) plus a multi-bill purchase_payment_allocations join.
--
-- Each table follows the workspace-isolation defense-in-depth recipe (see
-- docs/design/workspace-isolation-defense-in-depth.md): a NOT NULL
-- company_id with no column default, a UNIQUE (id, company_id) on every
-- parent so children can hang composite FKs off it, and explicit composite
-- FKs on every cross-table reference.
--
-- RLS policies for these tables are installed at boot by
-- server/db-bootstrap-rls.ts, which reads the RLS_TABLES allow-list. The
-- five new table names were appended there in the same patch as this file.
-- Keep this migration purely structural so a re-run is a no-op.
--
-- The whole file is idempotent: each CREATE uses IF NOT EXISTS; each
-- constraint is wrapped in a DO $$ ... pg_constraint guard so re-running
-- after `drizzle-kit push` already materialised the schema is safe.

-- 1. vendors ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "vendors" (
  "id"          serial PRIMARY KEY,
  "company_id"  integer NOT NULL,
  "code"        text    NOT NULL,
  "name_ar"     text    NOT NULL,
  "name_en"     text    NOT NULL DEFAULT '',
  "email"       text    NOT NULL DEFAULT '',
  "phone"       text    NOT NULL DEFAULT '',
  "tax_number"  text    NOT NULL DEFAULT '',
  "address"     text    NOT NULL DEFAULT '',
  "notes"       text    NOT NULL DEFAULT '',
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_id_company_uq'
  ) THEN
    ALTER TABLE "vendors"
      ADD CONSTRAINT "vendors_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_code_company_uq'
  ) THEN
    ALTER TABLE "vendors"
      ADD CONSTRAINT "vendors_code_company_uq" UNIQUE ("company_id", "code");
  END IF;
END $$;
--> statement-breakpoint

-- 2. purchase_invoices ------------------------------------------------------

CREATE TABLE IF NOT EXISTS "purchase_invoices" (
  "id"                serial PRIMARY KEY,
  "company_id"        integer NOT NULL,
  "number"            text    NOT NULL,
  "vendor_id"         integer NOT NULL,
  "invoice_date"      text    NOT NULL,
  "due_date"          text,
  "status"            text    NOT NULL DEFAULT 'draft',
  "payment_method"    text    NOT NULL DEFAULT 'credit',
  "vendor_reference"  text    NOT NULL DEFAULT '',
  "subtotal"          numeric(14, 2) NOT NULL DEFAULT 0,
  "vat_amount"        numeric(14, 2) NOT NULL DEFAULT 0,
  "total_amount"      numeric(14, 2) NOT NULL DEFAULT 0,
  "paid_amount"       numeric(14, 2) NOT NULL DEFAULT 0,
  "notes"             text    NOT NULL DEFAULT '',
  "journal_entry_id"  integer,
  "created_at"        timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_id_company_uq'
  ) THEN
    ALTER TABLE "purchase_invoices"
      ADD CONSTRAINT "purchase_invoices_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_number_company_uq'
  ) THEN
    ALTER TABLE "purchase_invoices"
      ADD CONSTRAINT "purchase_invoices_number_company_uq" UNIQUE ("company_id", "number");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_vendor_company_fk'
  ) THEN
    ALTER TABLE "purchase_invoices"
      ADD CONSTRAINT "purchase_invoices_vendor_company_fk"
      FOREIGN KEY ("vendor_id", "company_id")
      REFERENCES "vendors" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_journal_entry_company_fk'
  ) THEN
    ALTER TABLE "purchase_invoices"
      ADD CONSTRAINT "purchase_invoices_journal_entry_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id")
      REFERENCES "journal_entries" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "purchase_invoices_vendor_idx"
  ON "purchase_invoices" ("company_id", "vendor_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "purchase_invoices_status_idx"
  ON "purchase_invoices" ("company_id", "status");
--> statement-breakpoint

-- 3. purchase_invoice_lines -------------------------------------------------

CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
  "id"                    serial PRIMARY KEY,
  "company_id"            integer NOT NULL,
  "invoice_id"            integer NOT NULL,
  "product_id"            integer,
  "description"           text    NOT NULL DEFAULT '',
  "quantity"              numeric(14, 4) NOT NULL DEFAULT 1,
  "unit_cost"             numeric(14, 2) NOT NULL DEFAULT 0,
  "vat_rate"              numeric(5, 4)  NOT NULL DEFAULT 0,
  "line_subtotal"         numeric(14, 2) NOT NULL DEFAULT 0,
  "line_vat"              numeric(14, 2) NOT NULL DEFAULT 0,
  "line_total"            numeric(14, 2) NOT NULL DEFAULT 0,
  "expense_account_code"  text NOT NULL DEFAULT ''
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoice_lines_invoice_company_fk'
  ) THEN
    ALTER TABLE "purchase_invoice_lines"
      ADD CONSTRAINT "purchase_invoice_lines_invoice_company_fk"
      FOREIGN KEY ("invoice_id", "company_id")
      REFERENCES "purchase_invoices" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoice_lines_product_company_fk'
  ) THEN
    ALTER TABLE "purchase_invoice_lines"
      ADD CONSTRAINT "purchase_invoice_lines_product_company_fk"
      FOREIGN KEY ("product_id", "company_id")
      REFERENCES "products" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "purchase_invoice_lines_invoice_idx"
  ON "purchase_invoice_lines" ("invoice_id");
--> statement-breakpoint

-- 4. purchase_payments ------------------------------------------------------

CREATE TABLE IF NOT EXISTS "purchase_payments" (
  "id"                serial PRIMARY KEY,
  "company_id"        integer NOT NULL,
  "number"            text    NOT NULL,
  "vendor_id"         integer NOT NULL,
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
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_payments_id_company_uq'
  ) THEN
    ALTER TABLE "purchase_payments"
      ADD CONSTRAINT "purchase_payments_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_payments_number_company_uq'
  ) THEN
    ALTER TABLE "purchase_payments"
      ADD CONSTRAINT "purchase_payments_number_company_uq" UNIQUE ("company_id", "number");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_payments_vendor_company_fk'
  ) THEN
    ALTER TABLE "purchase_payments"
      ADD CONSTRAINT "purchase_payments_vendor_company_fk"
      FOREIGN KEY ("vendor_id", "company_id")
      REFERENCES "vendors" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_payments_journal_entry_company_fk'
  ) THEN
    ALTER TABLE "purchase_payments"
      ADD CONSTRAINT "purchase_payments_journal_entry_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id")
      REFERENCES "journal_entries" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "purchase_payments_vendor_idx"
  ON "purchase_payments" ("company_id", "vendor_id");
--> statement-breakpoint

-- 5. purchase_payment_allocations -------------------------------------------

CREATE TABLE IF NOT EXISTS "purchase_payment_allocations" (
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
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_payment_allocations_payment_company_fk'
  ) THEN
    ALTER TABLE "purchase_payment_allocations"
      ADD CONSTRAINT "purchase_payment_allocations_payment_company_fk"
      FOREIGN KEY ("payment_id", "company_id")
      REFERENCES "purchase_payments" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_payment_allocations_invoice_company_fk'
  ) THEN
    ALTER TABLE "purchase_payment_allocations"
      ADD CONSTRAINT "purchase_payment_allocations_invoice_company_fk"
      FOREIGN KEY ("invoice_id", "company_id")
      REFERENCES "purchase_invoices" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "purchase_payment_allocations_payment_idx"
  ON "purchase_payment_allocations" ("payment_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "purchase_payment_allocations_invoice_idx"
  ON "purchase_payment_allocations" ("invoice_id");
--> statement-breakpoint

-- 6. inventory_transactions.source_purchase_invoice_id ----------------------
--
-- Mirror of `source_invoice_id` (which links sale-side inventory txns to
-- their sales_invoice). The bill-cancel flow uses this column to find the
-- inbound it created when the bill was posted, so it can walk it back via
-- `reversePurchaseInbound` without re-deriving from the (possibly edited)
-- bill lines.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'source_purchase_invoice_id'
  ) THEN
    ALTER TABLE "inventory_transactions"
      ADD COLUMN "source_purchase_invoice_id" integer;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_source_purchase_invoice_company_fk'
  ) THEN
    ALTER TABLE "inventory_transactions"
      ADD CONSTRAINT "inventory_transactions_source_purchase_invoice_company_fk"
      FOREIGN KEY ("source_purchase_invoice_id", "company_id")
      REFERENCES "purchase_invoices" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inventory_transactions_source_purchase_invoice_idx"
  ON "inventory_transactions" ("company_id", "source_purchase_invoice_id");
