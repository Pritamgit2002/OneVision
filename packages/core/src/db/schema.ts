/**
 * Table definitions for the in-memory ledger.
 *
 * `company_id` is NOT NULL on every tenant-scoped table and is the leading column
 * of every index, so a query that forgets to filter on it is both wrong *and* slow —
 * the kind of mistake that shows up rather than hides.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE companies (
  company_id   INTEGER PRIMARY KEY,
  company_name TEXT    NOT NULL
);

CREATE TABLE accounts (
  account_id   INTEGER PRIMARY KEY,
  account_name TEXT    NOT NULL,
  account_type TEXT    NOT NULL
    CHECK (account_type IN ('Revenue','Expense','Asset','Liability','Equity'))
);

CREATE TABLE transactions (
  transaction_id INTEGER PRIMARY KEY,
  date           TEXT    NOT NULL,           -- YYYY-MM-DD
  company_id     INTEGER NOT NULL REFERENCES companies(company_id),
  account_id     INTEGER NOT NULL REFERENCES accounts(account_id),
  debit          REAL    NOT NULL DEFAULT 0,
  credit         REAL    NOT NULL DEFAULT 0,
  description    TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE budget (
  company_id    INTEGER NOT NULL REFERENCES companies(company_id),
  account_id    INTEGER NOT NULL REFERENCES accounts(account_id),
  period        TEXT    NOT NULL,            -- YYYY-MM
  budget_amount REAL    NOT NULL,
  PRIMARY KEY (company_id, account_id, period)
);

CREATE INDEX idx_txn_tenant ON transactions (company_id, account_id, date);
CREATE INDEX idx_budget_tenant ON budget (company_id, account_id, period);
`;

/**
 * Signed amount in "natural" terms for the account type: a positive number always
 * means "more of what this account measures".
 *
 * Revenue, Liability and Equity are credit-normal; Expense and Asset are debit-normal.
 * Deriving this in SQL means sign handling never depends on the model understanding
 * double-entry bookkeeping.
 */
export const SIGNED_AMOUNT_SQL = `
  CASE WHEN a.account_type IN ('Revenue','Liability','Equity')
       THEN t.credit - t.debit
       ELSE t.debit  - t.credit
  END`;
