-- Sales Portal — task #301.
--
-- Introduces customers, products, sales_invoices, sales_invoice_lines.
-- Each table follows the workspace-isolation defense-in-depth recipe (see
-- docs/design/workspace-isolation-defense-in-depth.md): a NOT NULL
-- company_id with no column default, a UNIQUE (id, company_id) on every
-- parent so child tables can hang composite FKs off it, and explicit
-- composite FKs on every cross-table reference (FK pairs both columns to
-- the parent's UNIQUE (id, company_id)).
--
-- RLS policies for these tables are installed at boot by
-- server/db-bootstrap-rls.ts, which reads the RLS_TABLES allow-list. The
-- four new table names were appended there in the same patch as this file.
-- Keep this migration purely structural so a re-run is a no-op.
--
-- The whole file is idempotent. Each CREATE uses IF NOT EXISTS; each
-- constraint is wrapped in a DO $$ ... pg_constraint guard so re-running
-- (or running after `drizzle-kit push` already materialised the schema)
-- is safe.

-- 1. customers ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customers" (
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
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_id_company_uq'
  ) THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_code_company_uq'
  ) THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_code_company_uq" UNIQUE ("company_id", "code");
  END IF;
END $$;
--> statement-breakpoint

-- 2. products ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "products" (
  "id"          serial PRIMARY KEY,
  "company_id"  integer NOT NULL,
  "sku"         text    NOT NULL,
  "name_ar"     text    NOT NULL,
  "name_en"     text    NOT NULL DEFAULT '',
  "description" text    NOT NULL DEFAULT '',
  "unit_price"  numeric(14, 2) NOT NULL DEFAULT 0,
  "unit_cost"   numeric(14, 2) NOT NULL DEFAULT 0,
  "vat_rate"    numeric(5, 4),
  "stock_qty"   numeric(14, 4) NOT NULL DEFAULT 0,
  "is_service"  boolean NOT NULL DEFAULT false,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_id_company_uq'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_sku_company_uq'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_sku_company_uq" UNIQUE ("company_id", "sku");
  END IF;
END $$;
--> statement-breakpoint

-- 3. sales_invoices ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sales_invoices" (
  "id"                serial PRIMARY KEY,
  "company_id"        integer NOT NULL,
  "number"            text    NOT NULL,
  "customer_id"       integer NOT NULL,
  "invoice_date"      text    NOT NULL,
  "due_date"          text,
  "status"            text    NOT NULL DEFAULT 'draft',
  "payment_method"    text    NOT NULL DEFAULT 'credit',
  "subtotal"          numeric(14, 2) NOT NULL DEFAULT 0,
  "vat_amount"        numeric(14, 2) NOT NULL DEFAULT 0,
  "total_amount"      numeric(14, 2) NOT NULL DEFAULT 0,
  "cogs_amount"       numeric(14, 2) NOT NULL DEFAULT 0,
  "paid_amount"       numeric(14, 2) NOT NULL DEFAULT 0,
  "notes"             text    NOT NULL DEFAULT '',
  "journal_entry_id"  integer,
  "created_at"        timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_id_company_uq'
  ) THEN
    ALTER TABLE "sales_invoices"
      ADD CONSTRAINT "sales_invoices_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_number_company_uq'
  ) THEN
    ALTER TABLE "sales_invoices"
      ADD CONSTRAINT "sales_invoices_number_company_uq" UNIQUE ("company_id", "number");
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_customer_company_fk'
  ) THEN
    ALTER TABLE "sales_invoices"
      ADD CONSTRAINT "sales_invoices_customer_company_fk"
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
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_journal_entry_company_fk'
  ) THEN
    ALTER TABLE "sales_invoices"
      ADD CONSTRAINT "sales_invoices_journal_entry_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id")
      REFERENCES "journal_entries" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_invoices_customer_idx"
  ON "sales_invoices" ("company_id", "customer_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_invoices_status_idx"
  ON "sales_invoices" ("company_id", "status");
--> statement-breakpoint

-- 4. sales_invoice_lines ----------------------------------------------------

CREATE TABLE IF NOT EXISTS "sales_invoice_lines" (
  "id"            serial PRIMARY KEY,
  "company_id"    integer NOT NULL,
  "invoice_id"    integer NOT NULL,
  "product_id"    integer,
  "description"   text    NOT NULL DEFAULT '',
  "quantity"      numeric(14, 4) NOT NULL DEFAULT 1,
  "unit_price"    numeric(14, 2) NOT NULL DEFAULT 0,
  "vat_rate"      numeric(5, 4)  NOT NULL DEFAULT 0,
  "line_subtotal" numeric(14, 2) NOT NULL DEFAULT 0,
  "line_vat"      numeric(14, 2) NOT NULL DEFAULT 0,
  "line_total"    numeric(14, 2) NOT NULL DEFAULT 0,
  "unit_cost"     numeric(14, 2) NOT NULL DEFAULT 0,
  "cost_amount"   numeric(14, 2) NOT NULL DEFAULT 0
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_lines_invoice_company_fk'
  ) THEN
    ALTER TABLE "sales_invoice_lines"
      ADD CONSTRAINT "sales_invoice_lines_invoice_company_fk"
      FOREIGN KEY ("invoice_id", "company_id")
      REFERENCES "sales_invoices" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_lines_product_company_fk'
  ) THEN
    ALTER TABLE "sales_invoice_lines"
      ADD CONSTRAINT "sales_invoice_lines_product_company_fk"
      FOREIGN KEY ("product_id", "company_id")
      REFERENCES "products" ("id", "company_id")
      MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_invoice_lines_invoice_idx"
  ON "sales_invoice_lines" ("invoice_id");
