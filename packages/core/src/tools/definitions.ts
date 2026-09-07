import type { FunctionTool } from 'openai/resources/responses/responses';

/**
 * The tools the assistant may call.
 *
 * Note what is absent: there is no company parameter on any tool, and no
 * `list_companies` tool. The tenant is supplied by the executor from the HTTP request,
 * so there is no string the model can emit that reaches the database as a tenant
 * filter. `additionalProperties: false` means the OpenAI API itself rejects an
 * invented `company_id` argument before it ever reaches our code.
 *
 * Declared in Responses API shape — flat `name`/`parameters` rather than nested under
 * `function`. See agent/run.ts for why this project is on /v1/responses.
 */
export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'list_accounts',
    strict: false,
    description:
      'List the chart of accounts (id, name, type). Call this first to map everyday ' +
      'wording in the question ("marketing spend", "payroll", "sales") onto real account ids.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'get_data_coverage',
    strict: false,
    description:
      'Report what data actually exists for this company: the first and last transaction ' +
      'dates, which accounts have activity, which have none, and which periods and accounts ' +
      'the budget covers. Call this whenever the question mentions a period or account you ' +
      'are not certain is covered, so you can decline instead of guessing.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'query_transactions',
    strict: false,
    description:
      'Fetch ledger transactions and their exact total. Returns the individual rows ' +
      '(with transaction ids), the total, and a per-account breakdown. Amounts are already ' +
      'signed correctly for the account type — a positive number always means more revenue ' +
      'or more expense. Use the returned totals directly; never add the rows up yourself.',
    parameters: {
      type: 'object',
      properties: {
        account_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Account ids to include. Omit for all accounts.',
        },
        account_type: {
          type: 'string',
          enum: ['Revenue', 'Expense', 'Asset', 'Liability', 'Equity'],
          description: 'Restrict to one account type, e.g. Revenue for a total-revenue question.',
        },
        start_date: { type: 'string', description: 'Inclusive start date, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'budget_vs_actual',
    strict: false,
    description:
      'Compare actual spend against budget over a range of monthly periods. Returns actual, ' +
      'budget, variance and variance percentage per account, all pre-computed, plus the ' +
      'contributing transaction ids. Accounts listed in accounts_without_budget have no ' +
      'budget on file — say so rather than treating their budget as zero.',
    parameters: {
      type: 'object',
      properties: {
        account_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Account ids to compare. Omit for all accounts with activity or budget.',
        },
        start_period: { type: 'string', description: 'Inclusive first period, YYYY-MM.' },
        end_period: { type: 'string', description: 'Inclusive last period, YYYY-MM.' },
      },
      required: ['start_period', 'end_period'],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
