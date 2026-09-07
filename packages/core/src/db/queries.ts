/**
 * ★ THE ONLY MODULE THAT TOUCHES THE DATABASE. ★
 *
 * Two rules hold here, and holding them here is what makes them hold everywhere:
 *
 *  1. The `Database` handle is module-private. It is created here and never returned,
 *     exported, or passed out, so no other file can issue a statement of its own.
 *  2. Every tenant-scoped query takes `companyId` as its FIRST POSITIONAL PARAMETER —
 *     required, never optional, never defaulted — and every statement that reads
 *     `transactions` or `budget` carries `WHERE company_id = ?`.
 *
 * Auditing the tenant guarantee therefore means reading one file.
 */
import type { Database as Db } from 'better-sqlite3';
import { createDatabase, type LoadSummary } from './load.js';
import { SIGNED_AMOUNT_SQL } from './schema.js';

let _db: Db | null = null;

function db(): Db {
  if (!_db) throw new Error('Database not initialised — call initDb() first.');
  return _db;
}

/** Load the CSVs into memory. Idempotent per process. */
export function initDb(dataDir: string): LoadSummary {
  const { db: handle, summary } = createDatabase(dataDir);
  _db = handle;
  return summary;
}

/** Money is rounded at the edge so float noise never reaches the model or the answer. */
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type AccountType = 'Revenue' | 'Expense' | 'Asset' | 'Liability' | 'Equity';

export interface Account {
  account_id: number;
  account_name: string;
  account_type: AccountType;
}

export interface TransactionRow {
  transaction_id: number;
  date: string;
  account_id: number;
  account_name: string;
  account_type: AccountType;
  amount: number;
  description: string;
}

export interface TransactionResult {
  rows: TransactionRow[];
  total: number;
  row_count: number;
  by_account: { account_id: number; account_name: string; total: number; count: number }[];
}

export interface BudgetLine {
  account_id: number;
  account_name: string;
  actual: number;
  budget: number | null;
  variance: number | null;
  variance_pct: number | null;
  transaction_ids: number[];
}

export interface BudgetResult {
  period_start: string;
  period_end: string;
  lines: BudgetLine[];
  accounts_without_budget: string[];
  totals: { actual: number; budget: number; variance: number; variance_pct: number | null } | null;
}

export interface Coverage {
  company_name: string;
  transactions_from: string | null;
  transactions_to: string | null;
  transaction_count: number;
  accounts_with_activity: { account_id: number; account_name: string; count: number }[];
  accounts_without_activity: string[];
  budget_periods: string[];
  accounts_with_budget: string[];
}

/* ------------------------------------------------------------------ *
 * Reference data — no tenant dimension exists on these tables at all. *
 * ------------------------------------------------------------------ */

export function listAccounts(): Account[] {
  return db()
    .prepare('SELECT account_id, account_name, account_type FROM accounts ORDER BY account_id')
    .all() as Account[];
}

export function getCompanyName(companyId: number): string | null {
  const row = db()
    .prepare('SELECT company_name FROM companies WHERE company_id = ?')
    .get(companyId) as { company_name: string } | undefined;
  return row?.company_name ?? null;
}

/**
 * Populates the UI's company switcher, and nothing else.
 *
 * Deliberately NOT exposed as a tool and never rendered into a prompt: the assistant
 * must not be able to learn that any other company exists. See tools/definitions.ts.
 */
export function listCompaniesForUi(): { company_id: number; company_name: string }[] {
  return db()
    .prepare('SELECT company_id, company_name FROM companies ORDER BY company_id')
    .all() as { company_id: number; company_name: string }[];
}

/* ---------------------------------------------------- *
 * Tenant-scoped queries. companyId is always argument 1 *
 * ---------------------------------------------------- */

export function getCoverage(companyId: number): Coverage {
  const span = db()
    .prepare(
      `SELECT MIN(date) lo, MAX(date) hi, COUNT(*) n
         FROM transactions
        WHERE company_id = ?`,
    )
    .get(companyId) as { lo: string | null; hi: string | null; n: number };

  const active = db()
    .prepare(
      `SELECT a.account_id, a.account_name, COUNT(*) count
         FROM transactions t
         JOIN accounts a ON a.account_id = t.account_id
        WHERE t.company_id = ?
     GROUP BY a.account_id, a.account_name
     ORDER BY a.account_id`,
    )
    .all(companyId) as { account_id: number; account_name: string; count: number }[];

  const activeIds = new Set(active.map((r) => r.account_id));

  const budgetPeriods = (
    db()
      .prepare('SELECT DISTINCT period FROM budget WHERE company_id = ? ORDER BY period')
      .all(companyId) as { period: string }[]
  ).map((r) => r.period);

  const budgetAccounts = (
    db()
      .prepare(
        `SELECT DISTINCT a.account_name
           FROM budget b
           JOIN accounts a ON a.account_id = b.account_id
          WHERE b.company_id = ?
       ORDER BY a.account_id`,
      )
      .all(companyId) as { account_name: string }[]
  ).map((r) => r.account_name);

  return {
    company_name: getCompanyName(companyId) ?? 'Unknown',
    transactions_from: span.lo,
    transactions_to: span.hi,
    transaction_count: span.n,
    accounts_with_activity: active,
    accounts_without_activity: listAccounts()
      .filter((a) => !activeIds.has(a.account_id))
      .map((a) => a.account_name),
    budget_periods: budgetPeriods,
    accounts_with_budget: budgetAccounts,
  };
}

export interface TransactionFilters {
  account_ids?: number[];
  account_type?: AccountType;
  start_date?: string;
  end_date?: string;
}

export function queryTransactions(companyId: number, f: TransactionFilters = {}): TransactionResult {
  const where: string[] = ['t.company_id = ?'];
  const params: unknown[] = [companyId];

  if (f.account_ids?.length) {
    where.push(`t.account_id IN (${f.account_ids.map(() => '?').join(',')})`);
    params.push(...f.account_ids);
  }
  if (f.account_type) { where.push('a.account_type = ?'); params.push(f.account_type); }
  if (f.start_date) { where.push('t.date >= ?'); params.push(f.start_date); }
  if (f.end_date) { where.push('t.date <= ?'); params.push(f.end_date); }

  const rows = (
    db()
      .prepare(
        `SELECT t.transaction_id, t.date, t.account_id, a.account_name, a.account_type,
                ${SIGNED_AMOUNT_SQL} AS amount, t.description
           FROM transactions t
           JOIN accounts a ON a.account_id = t.account_id
          WHERE ${where.join(' AND ')}
       ORDER BY t.date, t.transaction_id`,
      )
      .all(...params) as TransactionRow[]
  ).map((r) => ({ ...r, amount: money(r.amount) }));

  const byAccount = new Map<number, { account_id: number; account_name: string; total: number; count: number }>();
  for (const r of rows) {
    const acc = byAccount.get(r.account_id) ?? {
      account_id: r.account_id, account_name: r.account_name, total: 0, count: 0,
    };
    acc.total += r.amount;
    acc.count += 1;
    byAccount.set(r.account_id, acc);
  }

  return {
    rows,
    total: money(rows.reduce((s, r) => s + r.amount, 0)),
    row_count: rows.length,
    by_account: [...byAccount.values()].map((a) => ({ ...a, total: money(a.total) })),
  };
}

export interface BudgetFilters {
  account_ids?: number[];
  start_period: string; // YYYY-MM
  end_period: string;   // YYYY-MM
}

/**
 * Actual vs budget per account. Variance and variance-% are computed HERE, in SQL/TS,
 * precisely so the model is never in a position where doing its own subtraction or
 * division would be convenient.
 */
export function budgetVsActual(companyId: number, f: BudgetFilters): BudgetResult {
  const ids = f.account_ids ?? [];
  const accountFilter = (col: string) =>
    ids.length ? ` AND ${col} IN (${ids.map(() => '?').join(',')})` : '';

  const actuals = db()
    .prepare(
      `SELECT t.account_id, a.account_name,
              SUM(${SIGNED_AMOUNT_SQL}) AS actual,
              GROUP_CONCAT(t.transaction_id) AS ids
         FROM transactions t
         JOIN accounts a ON a.account_id = t.account_id
        WHERE t.company_id = ?
          AND substr(t.date, 1, 7) BETWEEN ? AND ?
          ${accountFilter('t.account_id')}
     GROUP BY t.account_id, a.account_name`,
    )
    .all(companyId, f.start_period, f.end_period, ...ids) as
    { account_id: number; account_name: string; actual: number; ids: string | null }[];

  const budgets = db()
    .prepare(
      `SELECT b.account_id, a.account_name, SUM(b.budget_amount) AS budget
         FROM budget b
         JOIN accounts a ON a.account_id = b.account_id
        WHERE b.company_id = ?
          AND b.period BETWEEN ? AND ?
          ${accountFilter('b.account_id')}
     GROUP BY b.account_id, a.account_name`,
    )
    .all(companyId, f.start_period, f.end_period, ...ids) as
    { account_id: number; account_name: string; budget: number }[];

  const budgetMap = new Map(budgets.map((b) => [b.account_id, b.budget]));
  const names = new Map<number, string>();
  for (const r of [...actuals, ...budgets]) names.set(r.account_id, r.account_name);

  const lines: BudgetLine[] = [...names.keys()]
    .sort((a, b) => a - b)
    .map((id) => {
      const a = actuals.find((x) => x.account_id === id);
      const actual = money(a?.actual ?? 0);
      const raw = budgetMap.get(id);
      const budget = raw === undefined ? null : money(raw);
      const variance = budget === null ? null : money(actual - budget);
      return {
        account_id: id,
        account_name: names.get(id) ?? `Account ${id}`,
        actual,
        budget,
        variance,
        variance_pct:
          budget === null || budget === 0 || variance === null
            ? null
            : Math.round((variance / budget) * 1000) / 10,
        transaction_ids: a?.ids ? a.ids.split(',').map(Number).sort((x, y) => x - y) : [],
      };
    });

  const budgeted = lines.filter((l) => l.budget !== null);
  const sumActual = money(budgeted.reduce((s, l) => s + l.actual, 0));
  const sumBudget = money(budgeted.reduce((s, l) => s + (l.budget ?? 0), 0));
  const sumVariance = money(sumActual - sumBudget);

  return {
    period_start: f.start_period,
    period_end: f.end_period,
    lines,
    accounts_without_budget: lines.filter((l) => l.budget === null).map((l) => l.account_name),
    totals: budgeted.length
      ? {
          actual: sumActual,
          budget: sumBudget,
          variance: sumVariance,
          variance_pct: sumBudget === 0 ? null : Math.round((sumVariance / sumBudget) * 1000) / 10,
        }
      : null,
  };
}

export interface MonthlyFilters {
  account_ids?: number[];
  account_type?: AccountType;
  start_month: string; // YYYY-MM
  end_month: string;   // YYYY-MM
}

export interface MonthlyTotalsResult {
  period_start: string;
  period_end: string;
  months: { period: string; total: number; row_count: number; transaction_ids: number[] }[];
  /** Calendar months in the range with no transactions at all — not the same as a zero total. */
  months_without_activity: string[];
  /** Picked here, not by the model: "which month was worst" is a comparison over ledger data. */
  highest: { period: string; total: number } | null;
  lowest: { period: string; total: number } | null;
}

/** Every month between two YYYY-MM bounds, inclusive. */
function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  if (!sy || !sm || !ey || !em) return [];
  const out: string[] = [];
  for (let y = sy, m = sm; (y < ey || (y === ey && m <= em)) && out.length < 240; ) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * One total per calendar month, plus the highest and lowest month.
 *
 * Exists so "which month was worst?" is a single lookup instead of one call per month
 * against a six-round budget — and so the comparison happens in SQL. Asking the model to
 * pick the largest of twelve numbers is asking it to do arithmetic by another name.
 */
export function monthlyTotals(companyId: number, f: MonthlyFilters): MonthlyTotalsResult {
  const ids = f.account_ids ?? [];
  const where: string[] = ['t.company_id = ?', 'substr(t.date, 1, 7) BETWEEN ? AND ?'];
  const params: unknown[] = [companyId, f.start_month, f.end_month];

  if (ids.length) {
    where.push(`t.account_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (f.account_type) { where.push('a.account_type = ?'); params.push(f.account_type); }

  const rows = (
    db()
      .prepare(
        `SELECT substr(t.date, 1, 7) AS period,
                SUM(${SIGNED_AMOUNT_SQL}) AS total,
                COUNT(*) AS row_count,
                GROUP_CONCAT(t.transaction_id) AS ids
           FROM transactions t
           JOIN accounts a ON a.account_id = t.account_id
          WHERE ${where.join(' AND ')}
       GROUP BY period
       ORDER BY period`,
      )
      .all(...params) as { period: string; total: number; row_count: number; ids: string | null }[]
  ).map((r) => ({
    period: r.period,
    total: money(r.total),
    row_count: r.row_count,
    transaction_ids: r.ids ? r.ids.split(',').map(Number).sort((a, b) => a - b) : [],
  }));

  const seen = new Set(rows.map((r) => r.period));
  const ranked = [...rows].sort((a, b) => b.total - a.total);
  const top = ranked[0];
  const bottom = ranked.at(-1);

  return {
    period_start: f.start_month,
    period_end: f.end_month,
    months: rows,
    months_without_activity: monthsBetween(f.start_month, f.end_month).filter((m) => !seen.has(m)),
    highest: top ? { period: top.period, total: top.total } : null,
    lowest: bottom ? { period: bottom.period, total: bottom.total } : null,
  };
}

/**
 * Independent second look: confirm every transaction id in a result really belongs to
 * `companyId`. Deliberately its own statement rather than a reuse of the query above —
 * if a `WHERE company_id = ?` ever went missing up there, this catches it instead of
 * trusting the same code that produced the rows.
 */
export function assertTransactionsOwnedBy(companyId: number, ids: number[]): void {
  if (!ids.length) return;
  const foreign = db()
    .prepare(
      `SELECT transaction_id, company_id
         FROM transactions
        WHERE transaction_id IN (${ids.map(() => '?').join(',')})
          AND company_id != ?`,
    )
    .all(...ids, companyId) as { transaction_id: number; company_id: number }[];

  if (foreign.length) {
    throw new Error(
      `TENANT ISOLATION VIOLATION: ${foreign.length} row(s) not owned by company ${companyId} ` +
        `(e.g. transaction ${foreign[0]!.transaction_id} belongs to ${foreign[0]!.company_id}). ` +
        `Request aborted.`,
    );
  }
}
