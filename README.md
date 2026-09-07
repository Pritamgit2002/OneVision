# Ledger Assistant

Ask a plain-English question about one company's books and get an answer where every
figure comes from the data, with the rows it came from shown underneath. If the data
can't support an answer, it says so instead of guessing.

```bash
cp .env.example .env      # add your OPENAI_API_KEY
npm install
npm run check             # offline checks — no API key, no network
npm run dev               # API on :4000, UI on http://localhost:3000
```

One question from the terminal:

```bash
npm run ask -- --company 100 "What was our total marketing spend in March?"
```

Ten worked examples, including refusals and an injection attempt, are in
[transcripts.md](transcripts.md) — all real captured output.

## The approach, and why

The four CSVs load into an in-memory SQLite database at startup. The model never writes
SQL and never does arithmetic. It picks one of four tools and fills in typed parameters;
the SQL behind each tool computes the totals, variances and percentages; the model just
writes a sentence around numbers it didn't produce.

I looked at text-to-SQL and decided against it. There, tenant isolation lives in a `WHERE`
clause the model writes, which means you can test that it's safe but never really know.
With fixed tools there's no company field anywhere in the schema, so there's no string the
model can emit that reaches the database as a tenant filter. Fixed tools cover fewer kinds
of question, and for financial data I think that's the right trade — a finance manager
can't tell an exact answer from an approximate one by looking at it.

The same logic applies to the numbers. `budget_vs_actual` returns variance and variance %
already computed, so the model is never in a position where doing its own subtraction
would be convenient. Then there's a check after the fact:
[verify.ts](packages/core/src/agent/verify.ts) pulls every number out of the finished
answer and matches it against the numbers the tools actually returned. Anything unmatched
gets one corrective retry, and if it fails again the answer is withheld rather than shown.

## Keeping the two companies apart

- **No tool takes a company.** There's no `list_companies` either. The company id comes
  from the request and is closed over in the executor, so the model can decide _what_ to
  ask, never _whose_ books to ask about.
- **Arguments are whitelisted per tool** and anything else is dropped. Keys matching
  `company|tenant|org|entity` are flagged in the response, so an attempt is visible rather
  than silently ignored ([executor.ts](packages/core/src/tools/executor.ts)).
- **One file talks to the database.** The handle in
  [queries.ts](packages/core/src/db/queries.ts) is module-private and never handed out.
  Every tenant-scoped function takes `companyId` as its first argument, required. Auditing
  isolation means reading one file.
- **A second, independent check.** After each query, `assertTransactionsOwnedBy` re-checks
  the returned transaction ids in a separate statement. If a `WHERE` ever went missing
  upstream, that catches it instead of trusting the code that produced the rows.
- **The other company is never mentioned.** Its name and id don't appear in any prompt, so
  there's nothing to leak even if the prompt itself fails.

Easy way to spot a leak: March marketing is `45,974.39` for company 100 and `39,885.64`
for company 200. Same question, two different numbers. `npm run check` asserts both, and
transcripts 6 and 7 cover a question that name-drops the other company and a straight
"ignore all previous instructions" injection. Both are refused.

## With more time

- **Real auth.** The company id arrives in the request body, which is fine for a test but
  is the weak link. In production it should come from the signed session — a small change
  in [ask.ts](apps/api/src/routes/ask.ts), and nothing in the agent layer moves.
- **Tests for the model layer.** The deterministic side has 38 assertions; the model side
  is only covered by the transcripts. I'd snapshot answers against fixed tool traces so a
  prompt edit can't quietly regress behaviour.
- **More tools** — period-over-period, top N accounts, trend by month. "Which month was
  worst?" currently takes several round trips and doesn't always land.
- **Currency.** There's no currency column in the data. At one point the model rendered a
  figure as `₹39,885.64` for the Indian company — a sensible guess from the company name,
  not from the ledger. The prompt now bans currency symbols outright, but the proper fix is
  a currency column plus a unit check sitting alongside the number check.
