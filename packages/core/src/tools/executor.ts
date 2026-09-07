/**
 * ★ The single point where a model-chosen tool becomes a database call. ★
 *
 * `companyId` arrives as a constructor argument from the HTTP request body and is
 * closed over. It is never read from the model's arguments, so the model cannot
 * influence which tenant is queried — only what is asked about that tenant.
 */
import {
  assertTransactionsOwnedBy,
  budgetVsActual,
  getCoverage,
  listAccounts,
  queryTransactions,
  type AccountType,
} from '../db/queries.js';
import { TOOL_NAMES } from './definitions.js';

/** Whitelist of parameters each tool accepts. Anything else the model sends is dropped. */
const ALLOWED_ARGS: Record<string, string[]> = {
  list_accounts: [],
  get_data_coverage: [],
  query_transactions: ['account_ids', 'account_type', 'start_date', 'end_date'],
  budget_vs_actual: ['account_ids', 'start_period', 'end_period'],
};

/** Keys that would represent an attempt to steer the tenant. Recorded loudly, never honoured. */
const TENANT_KEY = /company|tenant|org|entity/i;

export interface EvidenceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  /** Non-whitelisted keys that were discarded before execution. */
  dropped_arguments?: string[];
  /** Discarded keys that looked like an attempt to select a different company. */
  blocked_tenant_arguments?: string[];
  result: unknown;
}

export type ExecOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export class ToolExecutor {
  readonly evidence: EvidenceEntry[] = [];
  /** True if the model ever tried to pass a company/tenant argument. Surfaced in the API response. */
  tenantArgumentAttempted = false;

  constructor(private readonly companyId: number) {}

  execute(name: string, rawArgs: string): ExecOutcome {
    if (!TOOL_NAMES.includes(name)) {
      return { ok: false, error: `Unknown tool "${name}".` };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = rawArgs?.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, error: 'Arguments were not valid JSON. Retry with valid JSON.' };
    }

    const allowed = ALLOWED_ARGS[name] ?? [];
    const args: Record<string, unknown> = {};
    const dropped: string[] = [];
    const blocked: string[] = [];

    for (const [key, value] of Object.entries(parsed)) {
      if (allowed.includes(key)) args[key] = value;
      else {
        dropped.push(key);
        if (TENANT_KEY.test(key)) {
          blocked.push(key);
          this.tenantArgumentAttempted = true;
        }
      }
    }

    let result: unknown;
    try {
      result = this.dispatch(name, args);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    this.evidence.push({
      tool: name,
      arguments: args,
      ...(dropped.length ? { dropped_arguments: dropped } : {}),
      ...(blocked.length ? { blocked_tenant_arguments: blocked } : {}),
      result,
    });

    return { ok: true, result };
  }

  private dispatch(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case 'list_accounts':
        return listAccounts();

      case 'get_data_coverage':
        return getCoverage(this.companyId);

      case 'query_transactions': {
        const res = queryTransactions(this.companyId, {
          account_ids: intArray(args['account_ids']),
          account_type: args['account_type'] as AccountType | undefined,
          start_date: str(args['start_date']),
          end_date: str(args['end_date']),
        });
        assertTransactionsOwnedBy(this.companyId, res.rows.map((r) => r.transaction_id));
        return res;
      }

      case 'budget_vs_actual': {
        const start = str(args['start_period']);
        const end = str(args['end_period']);
        if (!start || !end) throw new Error('start_period and end_period are both required (YYYY-MM).');
        const res = budgetVsActual(this.companyId, {
          account_ids: intArray(args['account_ids']),
          start_period: start,
          end_period: end,
        });
        assertTransactionsOwnedBy(this.companyId, res.lines.flatMap((l) => l.transaction_ids));
        return res;
      }

      default:
        throw new Error(`Unhandled tool "${name}".`);
    }
  }
}

function intArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const nums = v.map(Number).filter((n) => Number.isInteger(n));
  return nums.length ? nums : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
