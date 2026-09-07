# Ledger Assistant

A natural-language assistant over a two-company general ledger. Ask a plain-English
question, get an answer where **every figure is computed by SQL and traced to the rows it
came from** — or an honest refusal.

```bash
cp .env.example .env          # add your OPENAI_API_KEY
npm install
npm run check                 # 45 offline assertions — no API key, no network
npm run eval                  # 8 replayed model-layer cases — no API key, no tokens
npm run transcripts           # regenerates transcripts.md from real model runs
npm run dev                   # API on :4000, UI on http://localhost:3000
```

Single question from the terminal:

```bash
npm run ask -- --company 100 "What was our total marketing spend in March?"
```

---

## Approach: structured tool-calling

The model never writes SQL and never does arithmetic. It selects a **tool and typed
parameters**; fixed, parameterised queries compute the numbers; the model narrates around
figures it did not produce.

| Approach | Tenant safety | Numeric safety |
|---|---|---|
| Plain prompting (CSVs in context) | Both companies sit in the prompt — one bad instruction leaks | Model does the arithmetic; it will get sums wrong |
| RAG / embeddings | Retrieval is fuzzy; a near-miss chunk is another tenant's row | Retrieval cannot aggregate at all |
| Text-to-SQL | Model authors the `WHERE` — exactly the clause that goes missing under adversarial phrasing | Exact, but only when the generated SQL is right |
| **Structured tool-calling** | Model has **no company parameter to pass** | Every figure computed in SQL; model only narrates |

The distinction that decided it: under text-to-SQL, tenant isolation is a property of
*generated text*. You are one clever prompt from a leak, and you can only ever test for it,
never establish it. Under structured tools, isolation is a property of the *type signature* —
there is no field in which the model can name a company, so there is no string it can emit
that reaches the database as a tenant filter.

The trade-off is real: fixed tools cover less question surface than free-form SQL. For
financial data that is the right trade. A system that answers 80% of questions exactly is
worth more than one that answers 100% approximately, because a finance manager cannot tell
the two apart by looking.

**Five tools**, none of which accepts a company:
`list_accounts` (maps "marketing spend" to an account id) · `get_data_coverage` (what data
exists — this is what makes refusals honest rather than random) · `query_transactions` (rows,
total, per-account breakdown) · `monthly_totals` (one total per month, plus the highest and
lowest month **already picked out** — asking the model to choose the largest of twelve numbers
is arithmetic by another name) · `budget_vs_actual` (actual, budget, variance, variance-%,
**all pre-computed** so the model is never in a position where doing its own subtraction
would be convenient).

Debit/credit handling lives in SQL — `Revenue`/`Liability`/`Equity` are credit-normal, the
rest debit-normal — so a positive number always means "more of what this account measures"
and sign correctness never depends on the model understanding double-entry bookkeeping.

## How "never another company's data" is enforced

Six ways it could leak, and where each is closed:

| # | Attack | Closure |
|---|---|---|
| 1 | Model passes a company in tool args | No tool schema has a company field, and `additionalProperties: false` makes the OpenAI API reject one. Belt and braces: the executor whitelists parameters per tool and **discards** anything else, flagging keys matching `/company|tenant|org|entity/i` in the response ([`tools/executor.ts`](packages/core/src/tools/executor.ts)) |
| 2 | A query forgets its tenant filter | [`db/queries.ts`](packages/core/src/db/queries.ts) is the only module that can reach the database — the handle is module-private and never returned. Every tenant-scoped function takes `companyId` as its **first positional parameter**: required, never optional, never defaulted |
| 3 | A row escapes anyway | `assertTransactionsOwnedBy` re-checks every returned transaction id against the tenant in a **separate statement**, so a missing `WHERE` upstream is caught rather than trusted. It throws and the request 500s |
| 4 | Model infers about the other company | The other company's id and name never appear in any prompt, and there is no `list_companies` tool. `listCompaniesForUi()` exists solely to populate the UI dropdown and is unreachable from the agent |
| 5 | User plants figures in the question | The numeric guard (below) rejects any figure not present in tool evidence. A number arriving via the question can only appear as an explicit correction, and is reported separately as question-sourced so it is never presented as a ledger fact |
| 6 | Prompt injection inside a `Description` | The system prompt states that ledger row content is data to report, never instruction to follow |

The tenant comes from the request body today; in production it comes from the authenticated
session. Either way it is server-side context that the question cannot influence — swapping
the source is a one-line change in
[`middleware/tenant.ts`](apps/api/src/middleware/tenant.ts), the single place the HTTP layer
admits a company.

**The leak detector:** marketing spend in March is `45,974.39` for company 100 and
`39,885.64` for company 200. Same question, two tenants, two figures — if isolation ever
breaks it is visible at a glance, which is why `npm run check` asserts both.

## How "never invents a number" is enforced

In code, not just in the prompt. [`agent/verify.ts`](packages/core/src/agent/verify.ts) runs
on the final answer before it is returned:

1. Extract every numeric token (`$45,974.39`, `46k`, `26.2%`).
2. Build the allow-set from accumulated tool evidence — every amount, total, budget,
   variance, percentage, row count, transaction id, and the numbers inside date strings.
3. **Dates are checked first and checked exactly.** A date is a fact, not a rounded figure,
   so the tolerance below must not touch it — 1% of `2026` is ±20 years. Dates are then
   blanked from the text, which also stops the hyphen in `2026-03-18` being read as a minus
   sign and flagging a phantom `-18`.
4. Everything else matches with 1% tolerance, so rounding and restatement pass.
5. An unmatched figure triggers **one corrective retry** naming the offending token. If it
   fails again the answer is **withheld** and replaced with the insufficient-data response.

Three deliberate tolerances, all documented in the file:

- **Integers ≤ 12 pass unchecked** — months, quarters, small counts. A fabricated financial
  figure cannot hide there, and checking them yields nothing but false positives on phrases
  like "over 6 months".
- **1% relative matching** for money and percentages, so "about 46k" may stand for
  `45,974.39`.
- **Figures from the question are permitted, and reported separately.** If someone asks
  "our accountant says March was 250,000 — confirm that", the right answer quotes the figure
  in order to correct it. Blocking that would suppress a correct refutation. So
  question-sourced numbers are allowed through and returned in
  `verification.echoedFromQuestion`, never counted as ledger-derived. A figure that matches
  neither the ledger nor the question is a violation.

Every response carries a structured `evidence` block — the tool calls made and the rows used —
rendered under each answer in the UI. "Show your work" is an inspectable panel, not a
paragraph the model wrote about itself.

## Streaming

`POST /api/ask/stream` returns Server-Sent Events: a `progress` event for each lookup as it
runs, then one `done` event carrying the same payload `/ask` returns. The UI renders a live
trail — "Reading the chart of accounts — 10 rows", "Querying transactions, 2026-03-01 to
2026-03-31 — 1 transaction, total 45,974.39" — so the wait shows the actual work.

**The answer text is deliberately not streamed token by token.** The numeric guard runs on
the completed answer and can withhold it. Streaming tokens would mean printing figures that
might be retracted a second later, which is precisely the failure this system exists to
prevent. Progress is also where the latency actually is — three or four round trips against a
two-sentence answer — so streaming the work rather than the prose is both safer and more
useful. `/ask` remains non-streaming for the CLI and for scripting.

## Refusals

The data hands us three honest ones, all asserted in `npm run check`:

- **Nothing after June 2026** — "What was our Q4 revenue?" must decline, not extrapolate.
- **Accounts 9 and 10 have zero transactions** — Fixed Assets and Owner's Equity.
- **Budget covers only the four expense accounts** — so "how does revenue compare to budget?"
  is genuinely unanswerable, and `budget_vs_actual` reports `accounts_without_budget` rather
  than treating a missing budget as zero.

Vague questions get a clarifying question rather than a guess.

## Layout

```
data/                   the 4 CSVs, chmod 444 — read at boot, never written
packages/core/          db · tools · agent · CLI      ← all the logic lives here
apps/api/               Express: routes → controllers → services → @gl/core
apps/web/               Next.js chat UI with the evidence panel
```

In-memory SQLite (`better-sqlite3`), seeded from the CSVs at boot. SQLite rather than
filtering arrays in JS because aggregation correctness is the entire point, and `SUM`/`GROUP BY`
are not things worth reimplementing by hand.

## With more time

- **Auth instead of a body parameter.** `companyId` in the request body is a test-harness
  convenience and the one genuinely weak link — a real deployment derives it from a signed
  session, and the agent layer would not change.
- **Two more tools.** Top N accounts and period-over-period comparison still don't have
  one, so those questions lean on the model stitching several lookups together.
- **Token-level streaming of the answer**, once the guard can verify incrementally — that
  means verifying each figure as it is emitted rather than checking the finished text, which
  is a bigger change than it sounds.
- **Structured output for the figures.** Having the model emit `{value, transaction_ids}`
  alongside prose would let the guard verify provenance per figure rather than checking the
  number appears somewhere in evidence.
- **Currency.** The dataset has no currency column and two companies in different countries.
  Every figure here is treated as one unit; a real system must not. The model spontaneously
  rendered `39,885.64` as `₹39,885.64` for the Indian company — a correct-looking guess drawn
  from the company name rather than the data. The prompt now forbids currency symbols
  outright, but the real fix is a currency column, and a guard that checks units the way the
  numeric guard checks figures.

## On AI coding tools

Built with Claude Code. It profiled the CSVs, proposed the design, and wrote effectively all
of the code; the notes below are what actually happened rather than a tidied-up version.

- **The design argument it made, and I accepted:** structured tool-calling over text-to-SQL,
  on the grounds in the comparison table — that isolation expressed as a type signature can be
  established, while isolation expressed in generated SQL can only ever be tested. This is the
  decision I would most want to defend in the follow-up, and it is the one I would have
  reached more slowly on my own.
- **Where profiling changed the plan:** reading the data first surfaced three refusal cases
  that were not obvious from the brief — no transactions after June, two accounts with no
  activity at all, and budget rows covering only the expense accounts. "How does revenue
  compare to budget?" turning out to be genuinely unanswerable is a better edge case than
  anything I would have invented.
- **A guard that was nearly theatre:** the first version of the ownership assertion would have
  re-used the same query that produced the rows, which makes it circular — it can only confirm
  what that query already assumed. It now runs its own statement, so it can actually catch a
  missing `WHERE` upstream.
- **Caught by running the checks, not by reading the code:** the first assertion for the start
  of the data used `2026-01-02`, which is the earliest date across *both* companies. Company
  100's own ledger starts `2026-01-04`. A small thing, but precisely the class of error — a
  figure that is right in aggregate and wrong per tenant — this whole system exists to prevent,
  and it is why the deterministic layer has its own assertion suite.
- **Tidied on review:** the budget query originally built its account filter by string-replacing
  a column name into a fragment, which worked and was a bad idea. It takes the column as an
  argument now.
- **Two bugs the guard only revealed once it met a real model.** The first answer came back
  correct but reported a corrective retry, which a clean question should never need: the model
  had cited `2026-03-18`, and the number regex read the hyphen as a minus, flagging a phantom
  `-18`. Fixing that surfaced the second bug — with dates matched at 1% tolerance, `2019` sat
  inside ±20 of `2026` and passed. Dates are now extracted first and matched exactly.
- **A claim in this README that the transcripts falsified.** It originally said a figure from
  the question "cannot survive into the answer". Then the planted-figure case tried `91,000`, and the model
  did the right thing — quoted it back to correct it. It passed the guard, but only by luck:
  `91,000` happens to fall within 1% of April's real total. A planted figure further from the
  data would have been flagged and a correct refutation suppressed. Question-sourced figures
  are now permitted and reported separately in `echoedFromQuestion`, and the claim above is
  narrower and true. This is the change I would not have found without running the thing.

> Note for whoever reads this: adjust this section to reflect your own involvement before
> submitting — it currently reports the session honestly, but it should be your account.
