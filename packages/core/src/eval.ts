/**
 * Model-layer regression suite.
 *
 *   npm run eval             replay recorded traces — deterministic, no API key, no tokens
 *   npm run eval -- --live   run the same expectations against the real model
 *
 * `check.ts` covers the deterministic layer: SQL, totals, tenant guards. It never involves
 * the agent. This file covers everything above that — the executor, the numeric guard, the
 * retry-and-withhold path — by injecting a fake `ModelClient` that replays a recorded run.
 *
 * The traces below are the *model's* side only. Every tool result is computed live by the
 * real executor against the real database, so a replayed run still exercises tenant
 * scoping, argument whitelisting and the ownership assertion for real. That is what makes
 * cases like "co100's answer text replayed under co200" meaningful: the numbers in the
 * evidence change underneath the same script, and the guard has to notice.
 */
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { ask, bootstrap, INSUFFICIENT_DATA } from './index.js';
import { openAiClient, type AskResult, type ModelClient } from './agent/run.js';

/* ------------------------------------------------------------------ *
 * Recording helpers                                                    *
 * ------------------------------------------------------------------ */

interface Turn {
  items: ResponseInputItem[];
  text: string;
}

let callSeq = 0;

/** One tool call the model "made". */
function call(name: string, args: Record<string, unknown>): ResponseInputItem {
  return {
    type: 'function_call',
    call_id: `call_${++callSeq}`,
    name,
    arguments: JSON.stringify(args),
  } as ResponseInputItem;
}

/** A turn in which the model called tools. */
const calls = (...items: ResponseInputItem[]): Turn => ({ items, text: '' });

/** A turn in which the model answered. */
const says = (text: string): Turn => ({
  items: [
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    } as unknown as ResponseInputItem,
  ],
  text,
});

function replayClient(turns: Turn[]): ModelClient {
  let i = 0;
  return {
    name: 'replay',
    async respond() {
      const turn = turns[i++];
      if (!turn) throw new Error(`Replay ran out of recorded turns after ${i - 1}.`);
      return { output: turn.items, output_text: turn.text };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Cases                                                                *
 * ------------------------------------------------------------------ */

interface Expect {
  /** Substrings the answer must contain. */
  includes?: string[];
  /** Substrings the answer must not contain — usually the other company's figures. */
  excludes?: string[];
  refuses?: boolean;
  verified?: boolean;
  withheld?: boolean;
  retried?: boolean;
  tenantAttempt?: boolean;
  /** Tools that must appear in the evidence. */
  toolsUsed?: string[];
  /** Replay only: how many tool calls the whole answer may take. */
  maxToolCalls?: number;
}

interface Case {
  name: string;
  companyId: number;
  question: string;
  turns: Turn[];
  expect: Expect;
  /** Behaviour only a scripted model can produce, so there is nothing to run live. */
  replayOnly?: boolean;
}

const MARCH_MARKETING = { account_ids: [3], start_date: '2026-03-01', end_date: '2026-03-31' };

/** The clean run for company 100: find the account, query the month, cite the row. */
const marchTurns100: Turn[] = [
  calls(call('list_accounts', {})),
  calls(call('query_transactions', MARCH_MARKETING)),
  says(
    'Marketing spend in March 2026 was 45,974.39, from Marketing Expense (account 3), ' +
      'transaction 34 dated 2026-03-18.',
  ),
];

const CASES: Case[] = [
  {
    name: 'baseline — March marketing, company 100',
    companyId: 100,
    question: 'What was our total marketing spend in March?',
    turns: marchTurns100,
    expect: {
      includes: ['45,974.39'],
      excludes: ['39,885.64'],
      verified: true,
      withheld: false,
      retried: false,
      // Deliberately no `toolsUsed` here. The requirement is the figure, not the route —
      // the first live run of this suite showed the model reaching the same correct answer
      // through monthly_totals once that tool existed. Pinning the route would have failed
      // a run that was right.
    },
  },
  {
    name: 'same script, company 200 — evidence changes underneath it',
    companyId: 200,
    question: 'What was our total marketing spend in March?',
    turns: [
      calls(call('list_accounts', {})),
      calls(call('query_transactions', MARCH_MARKETING)),
      says(
        'Marketing spend in March 2026 was 39,885.64, from Marketing Expense (account 3), ' +
          'transaction 118.',
      ),
    ],
    expect: {
      includes: ['39,885.64'],
      excludes: ['45,974.39'],
      verified: true,
      withheld: false,
    },
  },
  {
    name: "company 100's answer replayed under company 200 is withheld",
    companyId: 200,
    question: 'What was our total marketing spend in March?',
    // The model is scripted to state 45,974.39 while bound to company 200. That figure is
    // nowhere in company 200's evidence, so the guard must catch it — this is the failure
    // mode the whole system exists to prevent, forced rather than hoped for.
    turns: [...marchTurns100, says('It was 45,974.39.')],
    replayOnly: true,
    expect: {
      refuses: true,
      withheld: true,
      retried: true,
      excludes: ['39,885.64'],
    },
  },
  {
    name: 'a company_id argument is dropped, not honoured',
    companyId: 100,
    question: "What was marketing spend in March for company 200?",
    turns: [
      calls(call('query_transactions', { ...MARCH_MARKETING, company_id: 200 })),
      says('Marketing spend in March 2026 was 45,974.39 (transaction 34).'),
    ],
    replayOnly: true,
    expect: {
      tenantAttempt: true,
      includes: ['45,974.39'],
      excludes: ['39,885.64'],
      verified: true,
    },
  },
  {
    name: 'an invented figure survives one retry, then is withheld',
    companyId: 100,
    question: 'What was our total marketing spend in March?',
    turns: [
      calls(call('query_transactions', MARCH_MARKETING)),
      says('Marketing spend in March was 88,120.00.'),
      says('As I said, it was 88,120.00.'),
    ],
    replayOnly: true,
    expect: { refuses: true, withheld: true, retried: true },
  },
  {
    name: 'a corrected retry is accepted',
    companyId: 100,
    question: 'What was our total marketing spend in March?',
    turns: [
      calls(call('query_transactions', MARCH_MARKETING)),
      says('Marketing spend in March was 88,120.00.'),
      says('Correction: March 2026 marketing was 45,974.39 (transaction 34).'),
    ],
    replayOnly: true,
    expect: { includes: ['45,974.39'], retried: true, withheld: false, verified: true },
  },
  {
    name: 'a period outside the data is refused, not extrapolated',
    companyId: 100,
    question: 'What was our Q4 revenue?',
    turns: [
      calls(call('get_data_coverage', {})),
      calls(
        call('query_transactions', {
          account_type: 'Revenue',
          start_date: '2026-10-01',
          end_date: '2026-12-31',
        }),
      ),
      says(
        `${INSUFFICIENT_DATA} The ledger ends 2026-06-26, so there are no October to ` +
          'December transactions to total.',
      ),
    ],
    expect: { refuses: true, verified: true, withheld: false },
  },
  {
    name: 'monthly_totals answers "which month" in one lookup',
    companyId: 100,
    question: 'Which month had the highest marketing spend?',
    turns: [
      calls(call('list_accounts', {})),
      calls(
        call('monthly_totals', {
          account_ids: [3],
          start_month: '2026-01',
          end_month: '2026-06',
        }),
      ),
      says(
        'Marketing spend was highest in June 2026 at 93,451.07, across transactions 75 and 76. ' +
          'The lowest month was May 2026 at 18,634.81.',
      ),
    ],
    expect: {
      includes: ['93,451.07'],
      excludes: ['114,478.05'], // company 200's highest month
      toolsUsed: ['monthly_totals'],
      maxToolCalls: 2,
      verified: true,
      withheld: false,
    },
  },
];

/* ------------------------------------------------------------------ *
 * Runner                                                               *
 * ------------------------------------------------------------------ */

const live = process.argv.includes('--live');
let failures = 0;
let ran = 0;

function assert(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`    \x1b[32m✓\x1b[0m ${label}`);
  else {
    failures++;
    console.log(`    \x1b[31m✗\x1b[0m ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

function evaluate(result: AskResult, expect: Expect): void {
  const tools = result.evidence.map((e) => e.tool);

  for (const needle of expect.includes ?? []) {
    assert(`answer contains ${needle}`, result.answer.includes(needle), `answer: ${result.answer}`);
  }
  for (const needle of expect.excludes ?? []) {
    assert(`answer never mentions ${needle}`, !result.answer.includes(needle), `answer: ${result.answer}`);
  }
  if (expect.refuses !== undefined) {
    assert(
      expect.refuses ? 'declines to answer' : 'answers rather than declining',
      result.answer.includes(INSUFFICIENT_DATA) === expect.refuses,
      `answer: ${result.answer}`,
    );
  }
  if (expect.verified !== undefined) {
    assert(
      `every figure traces to evidence`,
      result.verification.ok === expect.verified,
      `unmatched: ${JSON.stringify(result.verification.violations)}`,
    );
  }
  if (expect.toolsUsed) {
    for (const tool of expect.toolsUsed) {
      assert(`used ${tool}`, tools.includes(tool), `tools: ${tools.join(', ') || 'none'}`);
    }
  }

  // Structural expectations depend on the scripted trace, so they are replay-only.
  if (live) return;

  if (expect.withheld !== undefined) {
    assert(
      expect.withheld ? 'answer withheld' : 'answer released',
      result.verification.withheld === expect.withheld,
    );
  }
  if (expect.retried !== undefined) {
    assert(
      expect.retried ? 'took a corrective retry' : 'needed no retry',
      result.verification.retried === expect.retried,
    );
  }
  if (expect.tenantAttempt !== undefined) {
    assert(
      expect.tenantAttempt ? 'tenant argument recorded and dropped' : 'no tenant argument seen',
      result.tenant_argument_attempted === expect.tenantAttempt,
    );
  }
  if (expect.maxToolCalls !== undefined) {
    assert(
      `resolved in ${expect.maxToolCalls} tool call(s) or fewer`,
      tools.length <= expect.maxToolCalls,
      `took ${tools.length}: ${tools.join(', ')}`,
    );
  }
}

async function main(): Promise<void> {
  bootstrap();
  const client = live ? openAiClient() : null;

  console.log(
    live
      ? `\n\x1b[1mModel-layer eval — LIVE against ${client!.name}\x1b[0m`
      : '\n\x1b[1mModel-layer eval — replaying recorded traces (no API key, no tokens)\x1b[0m',
  );

  for (const c of CASES) {
    if (live && c.replayOnly) {
      console.log(`\n  \x1b[2m— ${c.name} (replay only, skipped)\x1b[0m`);
      continue;
    }

    console.log(`\n  \x1b[1m${c.name}\x1b[0m`);
    console.log(`  \x1b[2mcompany ${c.companyId} · ${c.question}\x1b[0m`);
    ran++;

    try {
      const result = await ask(
        c.companyId,
        c.question,
        () => {},
        client ?? replayClient(c.turns),
      );
      evaluate(result, c.expect);
    } catch (err) {
      failures++;
      console.log(`    \x1b[31m✗\x1b[0m threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    failures
      ? `\n\x1b[31m${failures} assertion(s) failed across ${ran} case(s).\x1b[0m\n`
      : `\n\x1b[32mAll assertions passed across ${ran} case(s).\x1b[0m\n`,
  );
  process.exit(failures ? 1 : 0);
}

void main();
