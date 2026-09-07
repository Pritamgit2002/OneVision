import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_SQL } from './schema.js';

/** Minimal RFC-4180-ish parser. The dataset has no quoted commas, but quotes are cheap to support. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  if (!header) throw new Error('empty CSV');
  return rows
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const read = (dir: string, file: string) => parseCsv(readFileSync(join(dir, file), 'utf8'));

export interface LoadSummary {
  companies: number;
  accounts: number;
  transactions: number;
  budgetRows: number;
  perCompanyTransactions: Record<number, number>;
}

/**
 * Build a fresh in-memory database from the CSVs. The source files are only ever read.
 *
 * Called exactly once, from `db/queries.ts` — the returned handle never leaves that
 * module, which is what makes "every query is tenant-filtered" a checkable claim
 * rather than a convention.
 */
export function createDatabase(dataDir: string): { db: Database.Database; summary: LoadSummary } {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);

  const insertCompany = db.prepare('INSERT INTO companies VALUES (?, ?)');
  const insertAccount = db.prepare('INSERT INTO accounts VALUES (?, ?, ?)');
  const insertTxn = db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertBudget = db.prepare('INSERT INTO budget VALUES (?, ?, ?, ?)');

  const num = (v: string | undefined) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) throw new Error(`non-numeric value in CSV: ${String(v)}`);
    return n;
  };

  db.transaction(() => {
    for (const r of read(dataDir, 'companies.csv')) {
      insertCompany.run(num(r['CompanyID']), r['CompanyName']);
    }
    for (const r of read(dataDir, 'accounts.csv')) {
      insertAccount.run(num(r['AccountID']), r['AccountName'], r['AccountType']);
    }
    for (const r of read(dataDir, 'transactions.csv')) {
      insertTxn.run(
        num(r['TransactionID']), r['Date'], num(r['CompanyID']), num(r['AccountID']),
        num(r['Debit']), num(r['Credit']), r['Description'] ?? '',
      );
    }
    for (const r of read(dataDir, 'budget.csv')) {
      insertBudget.run(num(r['CompanyID']), num(r['AccountID']), r['Period'], num(r['BudgetAmount']));
    }
  })();

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  const perCompany = db
    .prepare('SELECT company_id, COUNT(*) n FROM transactions GROUP BY company_id')
    .all() as { company_id: number; n: number }[];

  return {
    db,
    summary: {
      companies: count('companies'),
      accounts: count('accounts'),
      transactions: count('transactions'),
      budgetRows: count('budget'),
      perCompanyTransactions: Object.fromEntries(perCompany.map((r) => [r.company_id, r.n])),
    },
  };
}
