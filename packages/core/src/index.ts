import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db/queries.js';

/** Repo root, from either src/ (tsx) or dist/ (built). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// npm workspaces run scripts with cwd set to the *package* directory, so dotenv's
// default cwd lookup misses a .env at the repo root. Check the root first, then cwd.
// Variables already present in the environment always win — dotenv does not override.
for (const candidate of [join(REPO_ROOT, '.env'), join(process.cwd(), '.env')]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate });
    break;
  }
}
export type { LoadSummary } from './db/load.js';
import type { LoadSummary } from './db/load.js';

export { ask, type AskResult, type AgentEvent, type EventSink } from './agent/run.js';
export { INSUFFICIENT_DATA } from './agent/prompt.js';
export { verifyAnswer, type VerificationResult, type Violation } from './agent/verify.js';
export {
  listCompaniesForUi,
  getCompanyName,
  getCoverage,
  listAccounts,
  queryTransactions,
  budgetVsActual,
  monthlyTotals,
} from './db/queries.js';
export type {
  Account,
  AccountType,
  BudgetFilters,
  BudgetLine,
  BudgetResult,
  Coverage,
  MonthlyFilters,
  MonthlyTotalsResult,
  TransactionFilters,
  TransactionResult,
  TransactionRow,
} from './db/queries.js';
export type { EvidenceEntry } from './tools/executor.js';

/** Repo-root `data/`, overridable with GL_DATA_DIR. Works from both src/ (tsx) and dist/. */
export function defaultDataDir(): string {
  const env = process.env['GL_DATA_DIR'];
  if (env) return resolve(env);
  return join(REPO_ROOT, 'data');
}

let loaded: LoadSummary | null = null;

/** Load the CSVs once per process and sanity-check what came back. */
export function bootstrap(dataDir = defaultDataDir()): LoadSummary {
  if (loaded) return loaded;
  const summary = initDb(dataDir);
  if (!summary.companies || !summary.transactions) {
    throw new Error(`No data loaded from ${dataDir} — check the CSVs are present.`);
  }
  loaded = summary;
  return summary;
}
