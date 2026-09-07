/** Mirrors the /api/ask response. Kept local so the web app never imports the DB package. */
export interface EvidenceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  dropped_arguments?: string[];
  blocked_tenant_arguments?: string[];
  result: unknown;
}

export interface AskResult {
  company_id: number;
  company_name: string;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  verification: {
    ok: boolean;
    retried: boolean;
    withheld: boolean;
    violations: { token: string; value: number }[];
    /** Figures quoted from the question rather than the ledger — shown as such, never as fact. */
    echoedFromQuestion: { token: string; value: number }[];
    first_pass_violations: { token: string; value: number }[];
    allowedValueCount: number;
  };
  tenant_argument_attempted: boolean;
  model: string;
}

export interface Company {
  company_id: number;
  company_name: string;
}

export interface TransactionRow {
  transaction_id: number;
  date: string;
  account_name: string;
  amount: number;
  description: string;
}

export interface TransactionResult {
  rows: TransactionRow[];
  total: number;
  row_count: number;
}

export interface BudgetLine {
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
}

/** Progress events from POST /api/ask/stream. Mirrors AgentEvent in @gl/core. */
export type AgentEvent =
  | { type: 'thinking'; round: number }
  | { type: 'tool'; tool: string; label: string; arguments: Record<string, unknown> }
  | { type: 'tool_done'; tool: string; label: string; summary: string }
  | { type: 'verifying' }
  | { type: 'retrying'; violations: string[] };
