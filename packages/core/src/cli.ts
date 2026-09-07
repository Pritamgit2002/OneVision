/**
 * Ask a question from the terminal — used to produce transcripts.md.
 *
 *   npm run ask -- --company 100 "What was our total marketing spend in March?"
 *   npm run ask -- --company 100 --json "What's our year-to-date revenue?"
 */
import { ask, bootstrap } from './index.js';

function parseArgs(argv: string[]) {
  let companyId: number | undefined;
  let json = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--company' || a === '-c') companyId = Number(argv[++i]);
    else if (a.startsWith('--company=')) companyId = Number(a.slice('--company='.length));
    else if (a === '--json') json = true;
    else rest.push(a);
  }
  return { companyId, json, question: rest.join(' ').trim() };
}

const { companyId, json, question } = parseArgs(process.argv.slice(2));

if (!companyId || !question) {
  console.error('Usage: npm run ask -- --company <id> [--json] "<question>"');
  process.exit(1);
}

bootstrap();

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  const result = await ask(companyId, question);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n\x1b[1mCompany:\x1b[0m  ${result.company_name} (${result.company_id})`);
    console.log(`\x1b[1mQuestion:\x1b[0m ${result.question}\n`);
    console.log(result.answer);

    console.log(`\n\x1b[2m--- evidence ---\x1b[0m`);
    if (!result.evidence.length) console.log('\x1b[2m(no tools called)\x1b[0m');
    for (const e of result.evidence) {
      console.log(`\x1b[2m• ${e.tool}(${JSON.stringify(e.arguments)})\x1b[0m`);
      const r = e.result as Record<string, unknown>;
      if (r && typeof r === 'object' && 'total' in r) {
        console.log(`\x1b[2m  total ${money(r['total'] as number)} across ${r['row_count']} txn(s)\x1b[0m`);
        for (const row of (r['rows'] as { transaction_id: number; date: string; account_name: string; amount: number }[]) ?? []) {
          console.log(`\x1b[2m    #${row.transaction_id} ${row.date} ${row.account_name} ${money(row.amount)}\x1b[0m`);
        }
      } else if (r && typeof r === 'object' && 'lines' in r) {
        for (const l of r['lines'] as { account_name: string; actual: number; budget: number | null; variance: number | null; variance_pct: number | null; transaction_ids: number[] }[]) {
          console.log(
            `\x1b[2m    ${l.account_name}: actual ${money(l.actual)} | budget ${l.budget === null ? 'none' : money(l.budget)}` +
              `${l.variance === null ? '' : ` | var ${money(l.variance)} (${l.variance_pct}%)`}` +
              ` | txns ${l.transaction_ids.join(',') || 'none'}\x1b[0m`,
          );
        }
      }
      if (e.blocked_tenant_arguments?.length) {
        console.log(`\x1b[31m  ⚠ blocked tenant arguments: ${e.blocked_tenant_arguments.join(', ')}\x1b[0m`);
      }
    }

    const v = result.verification;
    if (v.echoedFromQuestion.length) {
      console.log(
        `\x1b[33m  quoted from the question, not the ledger: ${v.echoedFromQuestion.map((x) => `"${x.token}"`).join(', ')}\x1b[0m`,
      );
    }
    if (v.first_pass_violations.length) {
      console.log(
        `\x1b[33m  first pass flagged: ${v.first_pass_violations.map((x) => `"${x.token}"`).join(', ')}\x1b[0m`,
      );
    }
    const status = v.withheld ? '\x1b[31mWITHHELD\x1b[0m' : v.ok ? '\x1b[32mpassed\x1b[0m' : '\x1b[31mfailed\x1b[0m';
    console.log(
      `\x1b[2m--- numeric guard: ${status}\x1b[0m\x1b[2m ` +
        `(${v.allowedValueCount} values from evidence${v.retried ? ', 1 corrective retry' : ''})\x1b[0m\n`,
    );
  }
} catch (err) {
  console.error(`\n\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
