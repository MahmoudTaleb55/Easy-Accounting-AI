-- Inventory & Costing Portal — task #346.
--
-- Extends `products` with item-master fields (unit, minimum stock, category,
-- per-item costing method) and `settings` with the workspace-default
-- costing method, then introduces the inventory schema:
--
--   inventory_categories         — user-managed item categories
--   inventory_locations          — user-managed warehouses / sites
--   inventory_stock_levels       — canonical (qty, avg_cost) per (item × location)
--   inventory_transactions       — header for purchase/sale/adjustment/transfer
--   inventory_transaction_lines  — per-item movement rows (signed quantity)
--   inventory_cost_layers        — FIFO layer queue (one row per inbound layer)
--
-- Follows the workspace-isolation defense-in-depth recipe (see
-- docs/design/workspace-isolation-defense-in-depth.md): every table carries
-- a NOT-NULL company_id with no column default, every parent declares
-- UNIQUE (id, company_id), every child uses composite FKs. RLS policies
-- are installed at boot by `server/db-bootstrap-rls.ts` — the new table
-- names are appended to RLS_TABLES in the same patch as this migration.
--
-- Backfill section at the bottom seeds a "Main warehouse" per existing
-- workspace and migrates current `products.stock_qty` into stock levels +
-- an opening FIFO cost layer at the existing `products.unit_cost`. Idempotent.

-- 1. Extend products with item-master fields ---------------------------------

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "unit"            text    NOT NULL DEFAULT 'pcs';
--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "minimum_stock"   numeric(14, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "category_id"     integer;
--> statement-breakpoint
-- NULL means "use workspace default"; populated values are 'fifo' or 'avg'.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "costing_method"  text;
--> statement-breakpoint

-- 2. Extend settings with the workspace-default costing method ---------------

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "default_costing_method" text NOT NULL DEFAULT 'avg';
--> statement-breakpoint

-- 3. inventory_categories ---------------------------------------------------

CREATE TABLE IF NOT EXISTS "inventory_categories" (
  "id"                          serial PRIMARY KEY,
  "company_id"                  integer NOT NULL,
  "name_ar"                     text    NOT NULL,
  "name_en"                     text    NOT NULL DEFAULT '',
  "default_income_account_id"   integer,
  "default_cogs_account_id"     integer,
  "is_active"                   boolean NOT NULL DEFAULT true,
  "created_at"                  timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_categories_id_company_uq') THEN
    ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_categories_name_company_uq') THEN
    ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_name_company_uq" UNIQUE ("company_id", "name_ar");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_categories_income_account_company_fk') THEN
    ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_income_account_company_fk"
      FOREIGN KEY ("default_income_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_categories_cogs_account_company_fk') THEN
    ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_cogs_account_company_fk"
      FOREIGN KEY ("default_cogs_account_id", "company_id")
      REFERENCES "accounts" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

-- 4. inventory_locations -----------------------------------------------------

CREATE TABLE IF NOT EXISTS "inventory_locations" (
  "id"          serial PRIMARY KEY,
  "company_id"  integer NOT NULL,
  "name_ar"     text    NOT NULL,
  "name_en"     text    NOT NULL DEFAULT '',
  "address"     text    NOT NULL DEFAULT '',
  "is_default"  boolean NOT NULL DEFAULT false,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_locations_id_company_uq') THEN
    ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_locations_name_company_uq') THEN
    ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_name_company_uq" UNIQUE ("company_id", "name_ar");
  END IF;
END $$;
--> statement-breakpoint

-- 5. Now that inventory_categories exists, wire products.category_id to it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_category_company_fk') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_category_company_fk"
      FOREIGN KEY ("category_id", "company_id")
      REFERENCES "inventory_categories" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

-- 6. inventory_stock_levels --------------------------------------------------

CREATE TABLE IF NOT EXISTS "inventory_stock_levels" (
  "id"           serial PRIMARY KEY,
  "company_id"   integer NOT NULL,
  "product_id"   integer NOT NULL,
  "location_id"  integer NOT NULL,
  "qty"          numeric(18, 4) NOT NULL DEFAULT 0,
  "avg_cost"     numeric(14, 4) NOT NULL DEFAULT 0,
  "updated_at"   timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_levels_pair_uq') THEN
    ALTER TABLE "inventory_stock_levels" ADD CONSTRAINT "inventory_stock_levels_pair_uq"
      UNIQUE ("company_id", "product_id", "location_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_levels_product_company_fk') THEN
    ALTER TABLE "inventory_stock_levels" ADD CONSTRAINT "inventory_stock_levels_product_company_fk"
      FOREIGN KEY ("product_id", "company_id")
      REFERENCES "products" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_levels_location_company_fk') THEN
    ALTER TABLE "inventory_stock_levels" ADD CONSTRAINT "inventory_stock_levels_location_company_fk"
      FOREIGN KEY ("location_id", "company_id")
      REFERENCES "inventory_locations" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inventory_stock_levels_product_idx"
  ON "inventory_stock_levels" ("company_id", "product_id");
--> statement-breakpoint

-- 7. inventory_transactions --------------------------------------------------

CREATE TABLE IF NOT EXISTS "inventory_transactions" (
  "id"                  serial PRIMARY KEY,
  "company_id"          integer NOT NULL,
  "number"              text    NOT NULL,
  "type"                text    NOT NULL,
  "txn_date"            text    NOT NULL,
  "location_id"         integer,
  "dest_location_id"    integer,
  "reference"           text    NOT NULL DEFAULT '',
  "vendor_name"         text    NOT NULL DEFAULT '',
  "reason"              text    NOT NULL DEFAULT '',
  "notes"               text    NOT NULL DEFAULT '',
  "status"              text    NOT NULL DEFAULT 'posted',
  "total_amount"        numeric(14, 2) NOT NULL DEFAULT 0,
  "journal_entry_id"    integer,
  "source_invoice_id"   integer,
  "reversal_of_id"      integer,
  "created_at"          timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_id_company_uq') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_id_company_uq" UNIQUE ("id", "company_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_number_company_uq') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_number_company_uq" UNIQUE ("company_id", "number");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_location_company_fk') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_location_company_fk"
      FOREIGN KEY ("location_id", "company_id")
      REFERENCES "inventory_locations" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_dest_location_company_fk') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_dest_location_company_fk"
      FOREIGN KEY ("dest_location_id", "company_id")
      REFERENCES "inventory_locations" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_journal_entry_company_fk') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_journal_entry_company_fk"
      FOREIGN KEY ("journal_entry_id", "company_id")
      REFERENCES "journal_entries" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_source_invoice_company_fk') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_source_invoice_company_fk"
      FOREIGN KEY ("source_invoice_id", "company_id")
      REFERENCES "sales_invoices" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_reversal_company_fk') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reversal_company_fk"
      FOREIGN KEY ("reversal_of_id", "company_id")
      REFERENCES "inventory_transactions" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inventory_transactions_type_idx"
  ON "inventory_transactions" ("company_id", "type", "txn_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inventory_transactions_date_idx"
  ON "inventory_transactions" ("company_id", "txn_date");
--> statement-breakpoint

-- 8. inventory_transaction_lines --------------------------------------------

CREATE TABLE IF NOT EXISTS "inventory_transaction_lines" (
  "id"               serial PRIMARY KEY,
  "company_id"       integer NOT NULL,
  "transaction_id"   integer NOT NULL,
  "product_id"       integer NOT NULL,
  "description"      text    NOT NULL DEFAULT '',
  "quantity"         numeric(18, 4) NOT NULL,
  "unit_cost"        numeric(14, 4) NOT NULL DEFAULT 0,
  "cost_amount"      numeric(14, 2) NOT NULL DEFAULT 0
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transaction_lines_txn_company_fk') THEN
    ALTER TABLE "inventory_transaction_lines" ADD CONSTRAINT "inventory_transaction_lines_txn_company_fk"
      FOREIGN KEY ("transaction_id", "company_id")
      REFERENCES "inventory_transactions" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transaction_lines_product_company_fk') THEN
    ALTER TABLE "inventory_transaction_lines" ADD CONSTRAINT "inventory_transaction_lines_product_company_fk"
      FOREIGN KEY ("product_id", "company_id")
      REFERENCES "products" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inventory_transaction_lines_txn_idx"
  ON "inventory_transaction_lines" ("transaction_id");
--> statement-breakpoint

-- 9. inventory_cost_layers --------------------------------------------------

CREATE TABLE IF NOT EXISTS "inventory_cost_layers" (
  "id"                          serial PRIMARY KEY,
  "company_id"                  integer NOT NULL,
  "product_id"                  integer NOT NULL,
  "location_id"                 integer NOT NULL,
  "original_qty"                numeric(18, 4) NOT NULL,
  "remaining_qty"               numeric(18, 4) NOT NULL,
  "unit_cost"                   numeric(14, 4) NOT NULL,
  "source_transaction_id"       integer,
  "source_transaction_line_id"  integer,
  "created_at"                  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_cost_layers_product_company_fk') THEN
    ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_product_company_fk"
      FOREIGN KEY ("product_id", "company_id")
      REFERENCES "products" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_cost_layers_location_company_fk') THEN
    ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_location_company_fk"
      FOREIGN KEY ("location_id", "company_id")
      REFERENCES "inventory_locations" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_cost_layers_source_txn_company_fk') THEN
    ALTER TABLE "inventory_cost_layers" ADD CONSTRAINT "inventory_cost_layers_source_txn_company_fk"
      FOREIGN KEY ("source_transaction_id", "company_id")
      REFERENCES "inventory_transactions" ("id", "company_id") MATCH SIMPLE
      ON UPDATE NO ACTION ON DELETE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inventory_cost_layers_queue_idx"
  ON "inventory_cost_layers" ("company_id", "product_id", "location_id", "created_at", "id");
--> statement-breakpoint

-- 10. Backfill: seed "Main warehouse" + opening stock for every workspace --

DO $$
DECLARE
  c_id integer;
  loc_id integer;
  prod RECORD;
  qty_num numeric;
  cost_num numeric;
BEGIN
  FOR c_id IN SELECT id FROM companies LOOP
    -- Seed (or fetch) the workspace's default Main warehouse. Idempotent:
    -- skip the insert when one already exists, then resolve its id.
    SELECT id INTO loc_id
      FROM inventory_locations
     WHERE company_id = c_id AND is_default = true
     LIMIT 1;

    IF loc_id IS NULL THEN
      INSERT INTO inventory_locations (company_id, name_ar, name_en, address, is_default, is_active)
      VALUES (c_id, 'المستودع الرئيسي', 'Main Warehouse', '', true, true)
      ON CONFLICT ON CONSTRAINT inventory_locations_name_company_uq DO NOTHING
      RETURNING id INTO loc_id;

      IF loc_id IS NULL THEN
        SELECT id INTO loc_id
          FROM inventory_locations
         WHERE company_id = c_id AND name_ar = 'المستودع الرئيسي'
         LIMIT 1;
      END IF;
    END IF;

    -- Seed opening stock per existing product. Skip rows that already have a
    -- stock_level row for this (product, location) pair so re-runs are no-ops.
    FOR prod IN
      SELECT id, stock_qty, unit_cost
        FROM products
       WHERE company_id = c_id
         AND is_service = false
    LOOP
      qty_num := COALESCE(prod.stock_qty, 0);
      cost_num := COALESCE(prod.unit_cost, 0);

      IF NOT EXISTS (
        SELECT 1 FROM inventory_stock_levels
         WHERE company_id = c_id AND product_id = prod.id AND location_id = loc_id
      ) THEN
        INSERT INTO inventory_stock_levels (company_id, product_id, location_id, qty, avg_cost)
        VALUES (c_id, prod.id, loc_id, qty_num, cost_num);

        -- Opening FIFO layer; harmless for WAvg items (their consumption
        -- path uses stock_levels.avg_cost, not the layer queue).
        IF qty_num > 0 THEN
          INSERT INTO inventory_cost_layers
            (company_id, product_id, location_id, original_qty, remaining_qty, unit_cost)
          VALUES (c_id, prod.id, loc_id, qty_num, qty_num, cost_num);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
