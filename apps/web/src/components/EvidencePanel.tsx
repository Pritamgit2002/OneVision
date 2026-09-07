'use client';

import type {
  AskResult, BudgetResult, EvidenceEntry, TransactionResult,
} from './types';

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isTransactions = (r: unknown): r is TransactionResult =>
  !!r && typeof r === 'object' && 'rows' in r && 'total' in r;

const isBudget = (r: unknown): r is BudgetResult =>
  !!r && typeof r === 'object' && 'lines' in r;

/**
 * Renders exactly what the assistant looked at: which tools ran, with which arguments,
 * and every row behind every figure. "Show your work" as an inspectable panel rather
 * than a paragraph the model wrote about itself.
 */
export function EvidencePanel({ result }: { result: AskResult }) {
  const { evidence, verification } = result;
  const guardLabel = verification.withheld
    ? 'answer withheld'
    : verification.ok
      ? `verified against ${verification.allowedValueCount} ledger values`
      : 'unverified figures';

  return (
    <details className="evidence">
      <summary>
        <span>
          {evidence.length
            ? `${evidence.length} lookup${evidence.length === 1 ? '' : 's'} · show working`
            : 'no lookups performed'}
        </span>
        <span className={`guard ${verification.ok && !verification.withheld ? 'pass' : 'fail'}`}>
          {guardLabel}
        </span>
      </summary>

      <div className="evidence-body">
        {evidence.map((entry, i) => (
          <Call key={i} entry={entry} />
        ))}
        {!evidence.length && (
          <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
            The assistant answered without querying the ledger — expected for a refusal.
          </p>
        )}
      </div>
    </details>
  );
}

function Call({ entry }: { entry: EvidenceEntry }) {
  return (
    <div className="call">
      <div className="call-head">
        <b>{entry.tool}</b>({JSON.stringify(entry.arguments)})
      </div>

      {entry.blocked_tenant_arguments?.length ? (
        <div className="banner" style={{ margin: '8px 0 0' }}>
          Blocked tenant argument{entry.blocked_tenant_arguments.length === 1 ? '' : 's'}:{' '}
          <code>{entry.blocked_tenant_arguments.join(', ')}</code> — discarded before the query ran.
        </div>
      ) : null}

      {isTransactions(entry.result) && <TransactionTable result={entry.result} />}
      {isBudget(entry.result) && <BudgetTable result={entry.result} />}
    </div>
  );
}

function TransactionTable({ result }: { result: TransactionResult }) {
  if (!result.row_count) {
    return <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>No matching transactions.</p>;
  }
  return (
    <div className="scroll-x">
      <table className="rows">
        <thead>
          <tr>
            <th>txn</th><th>date</th><th>account</th><th>description</th><th className="num">amount</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.transaction_id}>
              <td>#{r.transaction_id}</td>
              <td>{r.date}</td>
              <td>{r.account_name}</td>
              <td>{r.description}</td>
              <td className="num">{money(r.amount)}</td>
            </tr>
          ))}
          <tr className="total">
            <td colSpan={4}>total · {result.row_count} transaction{result.row_count === 1 ? '' : 's'}</td>
            <td className="num">{money(result.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BudgetTable({ result }: { result: BudgetResult }) {
  return (
    <>
      <div className="scroll-x">
        <table className="rows">
          <thead>
            <tr>
              <th>account</th>
              <th className="num">actual</th>
              <th className="num">budget</th>
              <th className="num">variance</th>
              <th>txns</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((l) => (
              <tr key={l.account_name}>
                <td>{l.account_name}</td>
                <td className="num">{money(l.actual)}</td>
                <td className="num">{l.budget === null ? '—' : money(l.budget)}</td>
                <td className="num">
                  {l.variance === null ? '—' : `${money(l.variance)} (${l.variance_pct}%)`}
                </td>
                <td>{l.transaction_ids.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.accounts_without_budget.length > 0 && (
        <p style={{ color: 'var(--muted)', margin: '8px 0 0' }}>
          No budget on file for: {result.accounts_without_budget.join(', ')}.
        </p>
      )}
    </>
  );
}
