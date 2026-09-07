import OpenAI from 'openai';
import type { ResponseInput, ResponseInputItem } from 'openai/resources/responses/responses';
import { getCompanyName } from '../db/queries.js';
import { TOOLS } from '../tools/definitions.js';
import { ToolExecutor, type EvidenceEntry } from '../tools/executor.js';
import { INSUFFICIENT_DATA, buildSystemPrompt } from './prompt.js';
import { correctionMessage, verifyAnswer, type VerificationResult } from './verify.js';

const MAX_TOOL_ROUNDS = 6;

/**
 * Progress emitted while an answer is being produced.
 *
 * Note what is NOT streamed: the answer text. The numeric guard runs on the completed
 * answer and can withhold it, so streaming tokens would mean showing figures that might
 * be retracted a second later — the exact failure this system exists to prevent. What is
 * streamed instead is the work: each lookup as it happens, which is where the latency
 * actually is (three or four round trips) and which is the more useful thing to watch.
 */
export type AgentEvent =
  | { type: 'thinking'; round: number }
  | { type: 'tool'; tool: string; label: string; arguments: Record<string, unknown> }
  | { type: 'tool_done'; tool: string; label: string; summary: string }
  | { type: 'verifying' }
  | { type: 'retrying'; violations: string[] };

export type EventSink = (event: AgentEvent) => void;

/** Human-readable label for a tool call, used by the progress stream. */
function describe(tool: string, args: Record<string, unknown>): string {
  const range = [args['start_date'] ?? args['start_period'], args['end_date'] ?? args['end_period']]
    .filter(Boolean)
    .join(' to ');
  switch (tool) {
    case 'list_accounts':
      return 'Reading the chart of accounts';
    case 'get_data_coverage':
      return 'Checking what data exists';
    case 'query_transactions':
      return range ? `Querying transactions, ${range}` : 'Querying transactions';
    case 'budget_vs_actual':
      return range ? `Comparing actual to budget, ${range}` : 'Comparing actual to budget';
    default:
      return tool;
  }
}

/** One-line summary of a tool result, so the progress line says what came back. */
function summarise(result: unknown): string {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return 'done';
  if ('row_count' in r) {
    const n = r['row_count'] as number;
    return n ? `${n} transaction${n === 1 ? '' : 's'}, total ${(r['total'] as number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'no matching transactions';
  }
  if ('lines' in r) {
    const n = (r['lines'] as unknown[]).length;
    return `${n} account${n === 1 ? '' : 's'} compared`;
  }
  if ('accounts_with_activity' in r) {
    return `${(r['accounts_with_activity'] as unknown[]).length} accounts with activity`;
  }
  if (Array.isArray(r)) return `${r.length} rows`;
  return 'done';
}

export interface AskResult {
  company_id: number;
  company_name: string;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  verification: VerificationResult & {
    retried: boolean;
    withheld: boolean;
    /** What tripped the guard on the first pass, if anything — kept for auditing. */
    first_pass_violations: { token: string; value: number }[];
  };
  /** True if the model attempted to pass a company/tenant argument to a tool. */
  tenant_argument_attempted: boolean;
  model: string;
}

export async function ask(
  companyId: number,
  question: string,
  onEvent: EventSink = () => {},
): Promise<AskResult> {
  const companyName = getCompanyName(companyId);
  if (!companyName) throw new Error(`Unknown company id ${companyId}.`);
  if (!question.trim()) throw new Error('Question is empty.');

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.');

  const model = process.env['OPENAI_MODEL'] || 'gpt-4o';
  const client = new OpenAI({ apiKey });
  const executor = new ToolExecutor(companyId);
  const instructions = buildSystemPrompt(companyId);

  const input: ResponseInput = [{ role: 'user', content: question }];

  let answer = await converse(client, model, instructions, input, executor, onEvent);
  onEvent({ type: 'verifying' });
  let verification = verifyAnswer(answer, executor.evidence, question);
  const firstPassViolations = verification.violations;
  let retried = false;
  let withheld = false;

  // One corrective pass. If the model still cites figures the ledger cannot support,
  // the answer is withheld rather than shipped with an unverifiable number in it.
  if (!verification.ok) {
    retried = true;
    onEvent({ type: 'retrying', violations: verification.violations.map((v) => v.token) });
    input.push({ role: 'user', content: correctionMessage(verification.violations) });
    answer = await converse(client, model, instructions, input, executor, onEvent);
    onEvent({ type: 'verifying' });
    verification = verifyAnswer(answer, executor.evidence, question);

    if (!verification.ok) {
      withheld = true;
      answer =
        `${INSUFFICIENT_DATA} A draft answer cited ` +
        `${verification.violations.map((v) => `"${v.token}"`).join(', ')}, which could not be traced ` +
        `to any ledger record, so it was withheld rather than shown to you.`;
    }
  }

  return {
    company_id: companyId,
    company_name: companyName,
    question,
    answer,
    evidence: executor.evidence,
    verification: { ...verification, retried, withheld, first_pass_violations: firstPassViolations },
    tenant_argument_attempted: executor.tenantArgumentAttempted,
    model,
  };
}

/**
 * Run the tool-calling loop until the model produces prose instead of another tool call.
 *
 * This uses the Responses API rather than Chat Completions because reasoning models —
 * `gpt-5.6-luna` among them — reject function tools on /v1/chat/completions unless
 * reasoning is disabled outright. /v1/responses supports tools and reasoning together,
 * and works for non-reasoning models too, so the model id stays a pure config value.
 *
 * Every output item is fed back into the next turn, reasoning items included: reasoning
 * models need their own prior traces returned to them or they lose the thread across
 * tool calls.
 */
async function converse(
  client: OpenAI,
  model: string,
  instructions: string,
  input: ResponseInput,
  executor: ToolExecutor,
  onEvent: EventSink,
): Promise<string> {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    onEvent({ type: 'thinking', round });
    const response = await client.responses.create({
      model,
      instructions,
      input,
      tools: TOOLS,
      tool_choice: 'auto',
      store: false,
    });

    input.push(...(response.output as ResponseInputItem[]));

    const calls = response.output.filter((item) => item.type === 'function_call');
    if (!calls.length) return (response.output_text ?? '').trim();

    for (const call of calls) {
      const parsedArgs = safeParse(call.arguments);
      const label = describe(call.name, parsedArgs);
      onEvent({ type: 'tool', tool: call.name, label, arguments: parsedArgs });

      const outcome = executor.execute(call.name, call.arguments);
      onEvent({
        type: 'tool_done',
        tool: call.name,
        label,
        summary: outcome.ok ? summarise(outcome.result) : `error: ${outcome.error}`,
      });

      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
      });
    }
  }

  return `${INSUFFICIENT_DATA} I could not resolve this question within the allowed number of lookups.`;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return raw?.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
