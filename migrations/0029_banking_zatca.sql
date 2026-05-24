-- Banking simulation: bank accounts and transactions
CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  iban TEXT,
  account_type TEXT NOT NULL DEFAULT 'checking',
  currency TEXT NOT NULL DEFAULT 'SAR',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  linked_account_id INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_id_company_uq
  ON bank_accounts(id, company_id);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_accounts_isolation ON bank_accounts
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::int);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  bank_account_id INTEGER NOT NULL,
  reference TEXT NOT NULL,
  txn_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT NOT NULL,
  counterpart_bank_account_id INTEGER,
  counterpart_account_id INTEGER,
  txn_date TIMESTAMP NOT NULL DEFAULT NOW(),
  journal_entry_id INTEGER,
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_id_company_uq
  ON bank_transactions(id, company_id);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_transactions_isolation ON bank_transactions
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::int);

-- ZATCA e-invoicing configuration
CREATE TABLE IF NOT EXISTS zatca_configs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  vat_number TEXT NOT NULL,
  seller_name_ar TEXT NOT NULL,
  seller_name_en TEXT NOT NULL,
  city_ar TEXT NOT NULL DEFAULT 'الرياض',
  city_en TEXT NOT NULL DEFAULT 'Riyadh',
  environment TEXT NOT NULL DEFAULT 'sandbox',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS zatca_configs_company_uq
  ON zatca_configs(company_id);

ALTER TABLE zatca_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY zatca_configs_isolation ON zatca_configs
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::int);
