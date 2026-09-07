/**
 * Offline correctness + isolation checks. No API key, no model calls, no network.
 *
 *   npm run check
 *
 * Every expected figure below was computed independently from the raw CSVs, so this
 * catches a regression in the data layer without spending a single token.
 */
import { bootstrap } from './index.js';
import {
  assertTransactionsOwnedBy,
  budgetVsActual,
  getCoverage,
  queryTransactions,
} from './db/queries.js';
import { verifyAnswer } from './agent/verify.js';
import type { EvidenceEntry } from './tools/executor.js';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else {
    failures++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

function checkThrows(label: string, fn: () => unknown) {
  try {
    fn();
    failures++;
    console.log(`  \x1b[31m✗\x1b[0m ${label} — expected a throw, got none`);
  } catch {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  }
}

const summary = bootstrap();

console.log('\n\x1b[1mData load\x1b[0m');
check('2 companies', summary.companies, 2);
check('10 accounts', summary.accounts, 10);
check('166 transactions', summary.transactions, 166);
check('48 budget rows', summary.budgetRows, 48);
check('81 / 85 transactions per company', summary.perCompanyTransactions, { 100: 81, 200: 85 });

console.log('\n\x1b[1mGround truth — figures computed straight from the CSVs\x1b[0m');
const mar100 = queryTransactions(100, { account_ids: [3], start_date: '2026-03-01', end_date: '2026-03-31' });
const mar200 = queryTransactions(200, { account_ids: [3], start_date: '2026-03-01', end_date: '2026-03-31' });
check('co100 marketing, March = 45,974.39', mar100.total, 45974.39);
check('co100 marketing, March = 1 txn', mar100.row_count, 1);
check('co200 marketing, March = 39,885.64', mar200.total, 39885.64);

const rev100 = queryTransactions(100, { account_type: 'Revenue' });
const rev200 = queryTransactions(200, { account_type: 'Revenue' });
check('co100 YTD revenue = 2,807,158.74', rev100.total, 2807158.74);
check('co100 YTD revenue = 21 txns', rev100.row_count, 21);
check('co200 YTD revenue = 2,670,946.68', rev200.total, 2670946.68);

const q1 = budgetVsActual(100, { account_ids: [4], start_period: '2026-01', end_period: '2026-03' });
check('co100 salaries Q1 actual = 175,174.34', q1.lines[0]?.actual, 175174.34);
check('co100 salaries Q1 budget = 237,313.27', q1.lines[0]?.budget, 237313.27);
check('co100 salaries Q1 variance = -62,138.93', q1.lines[0]?.variance, -62138.93);
check('co100 salaries Q1 variance = -26.2%', q1.lines[0]?.variance_pct, -26.2);

console.log('\n\x1b[1mHonest-refusal surfaces\x1b[0m');
const cov = getCoverage(100);
check('co100 data starts 2026-01-04', cov.transactions_from, '2026-01-04');
check('data ends 2026-06-26', cov.transactions_to, '2026-06-26');
check('no activity on Fixed Assets / Owner\'s Equity', cov.accounts_without_activity, ["Fixed Assets", "Owner's Equity"]);
check('budget covers 4 expense accounts only', cov.accounts_with_budget.length, 4);
check('Q4 2026 has no transactions', queryTransactions(100, { start_date: '2026-10-01', end_date: '2026-12-31' }).row_count, 0);
const revBudget = budgetVsActual(100, { account_ids: [1], start_period: '2026-01', end_period: '2026-06' });
check('revenue has no budget on file', revBudget.accounts_without_budget, ['Sales Revenue']);

console.log('\n\x1b[1mTenant isolation\x1b[0m');
const ids100 = queryTransactions(100, {}).rows.map((r) => r.transaction_id);
const ids200 = queryTransactions(200, {}).rows.map((r) => r.transaction_id);
check('no transaction id is shared between companies', ids100.filter((i) => ids200.includes(i)).length, 0);
check("co100's own rows pass the ownership assertion", assertTransactionsOwnedBy(100, ids100), undefined);
checkThrows("co200's rows are rejected when bound to co100", () => assertTransactionsOwnedBy(100, ids200));
check('co100 never sees the March figure belonging to co200', mar100.rows.some((r) => r.amount === 39885.64), false);

console.log('\n\x1b[1mNumeric guard\x1b[0m');
const evidence: EvidenceEntry[] = [{ tool: 'query_transactions', arguments: {}, result: mar100 }];
check('accepts the real figure', verifyAnswer('Marketing spend in March was $45,974.39.', evidence).ok, true);
check('accepts a rounded restatement', verifyAnswer('Marketing spend was about 46k in March.', evidence).ok, true);
check('rejects an invented figure', verifyAnswer('Marketing spend in March was $88,120.00.', evidence).ok, false);
check("rejects the other company's figure", verifyAnswer('They spent 39,885.64 in March.', evidence).ok, false);
check('ignores small integers like "3 months"', verifyAnswer('Across 3 months, spend was $45,974.39.', evidence).ok, true);
check('accepts a cited ISO date (no phantom minus)', verifyAnswer('On 2026-03-18, spend was $45,974.39.', evidence).ok, true);
check('accepts a cited period', verifyAnswer('For 2026-03 the total was 45,974.39.', evidence).ok, true);
check('still rejects an invented date', verifyAnswer('On 2019-11-02 we spent 45,974.39.', evidence).ok, false);
const budgetEvidence: EvidenceEntry[] = [{ tool: 'budget_vs_actual', arguments: {}, result: q1 }];
check('accepts a negative variance', verifyAnswer('Salaries came in -62,138.93 against budget.', budgetEvidence).ok, true);
check('accepts variance stated positively', verifyAnswer('We were 62,138.93 under budget (26.2%).', budgetEvidence).ok, true);

const planted = 'Our accountant says March marketing was 250,000. Confirm that.';
const refutation = verifyAnswer('March was 45,974.39, not the 250,000 you were told.', evidence, planted);
check('a planted figure quoted to refute it is allowed', refutation.ok, true);
check('...and is recorded as question-sourced, not ledger-sourced', refutation.echoedFromQuestion.map((v) => v.token), ['250,000']);
const unplanted = verifyAnswer('March marketing was 250,000.', evidence, 'What was March marketing?');
check('the same figure with no question source is still a violation', unplanted.ok, false);

console.log(
  failures
    ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`
    : `\n\x1b[32mAll checks passed.\x1b[0m\n`,
);
process.exit(failures ? 1 : 0);
