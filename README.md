# Ledger Assistant

Ask a plain-English question about one company's books and get an answer where every
figure comes from the data, with the rows it came from shown underneath. If the data
can't support an answer, it says so instead of guessing.

```bash
cp .env.example .env      # add your OPENAI_API_KEY
npm install
npm run check             # 45 offline checks on the data layer — no API key, no network
npm run eval              # 8 model-layer cases, replayed — no API key, no tokens
npm run dev               # API on :4000, UI on http://localhost:3000
```

One question from the terminal:

```bash
npm run ask -- --company 100 "What was our total marketing spend in March?"
```

Eleven worked examples are in [transcripts.md](transcripts.md), all real captured output.
Worth skimming: **6** answers "which month was highest, which was lightest" from a single
lookup, and in **11** the model is asked to combine two months, finds that no tool returns
a combined figure, and goes and fetches one rather than adding the two numbers itself.

## The approach, and why

The four CSVs load into an in-memory SQLite database at startup. The model never writes
SQL and never does arithmetic. It picks one of five tools and fills in typed parameters;
the SQL behind each tool computes the totals, variances and percentages; the model just
writes a sentence around numbers it didn't produce.

I looked at text-to-SQL and decided against it. There, tenant isolation lives in a `WHERE`
clause the model writes, which means you can test that it's safe but never really know.
With fixed tools there's no company field anywhere in the schema, so there's no string the
model can emit that reaches the database as a tenant filter. Fixed tools cover fewer kinds
of question, and for financial data I think that's the right trade — a finance manager
can't tell an exact answer from an approximate one by looking at it.

The same logic applies to the numbers. `budget_vs_actual` returns variance and variance %
already computed, and `monthly_totals` returns the highest and lowest month already picked
out, so the model is never in a position where doing its own subtraction — or its own
ranking — would be convenient. Then there's a check after the fact:
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
transcripts 7 and 8 cover a question that name-drops the other company and a straight
"ignore all previous instructions" injection. Both are refused.

## Tests

Two suites, both free to run.

`npm run check` covers the data layer: 45 assertions on totals, variances, month-by-month
figures and the tenant guards, every expected number worked out from the raw CSVs. No model
involved, so it never flakes and never costs anything.

`npm run eval` covers everything above that. The model is replaced by a recorded script of
its own turns, but the tools, the database and the guards are all real, so the numbers are
still computed live underneath the script. That's what makes the useful cases possible:
replaying company 100's answer text under company 200 forces the guard to catch a foreign
figure, and a scripted `company_id: 200` argument shows it being dropped. Both are hard to
trigger by asking questions by hand.

`npm run eval -- --live` runs the same expectations against the real model, for when I want
to know the prompt still holds up and not just the plumbing.

They're not decorative — putting `OR company_id = 200` into one query makes `npm run eval`
fail on four assertions.

## With more time

- **Real auth.** The company id arrives in the request body, which is fine for a test but
  is the weak link. In production it should come from the signed session — a small change
  in [tenant.ts](apps/api/src/middleware/tenant.ts) and
  [ask.validator.ts](apps/api/src/validators/ask.validator.ts), and nothing in the agent
  layer moves.
- **Two more tools.** Top N accounts and period-over-period comparison still don't have
  one, so those questions lean on the model stitching several lookups together.
- **Currency.** There's no currency column in the data. At one point the model rendered a
  figure as `₹39,885.64` for the Indian company — a sensible guess from the company name,
  not from the ledger. The prompt now bans currency symbols outright, but the proper fix is
  a currency column plus a unit check sitting alongside the number check.
