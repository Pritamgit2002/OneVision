# Practical Test — GenAI / Agent Developer

**Time expectation:** ~3 hours. Don't over-engineer — a working, well-reasoned
solution beats a polished but incomplete one.

## Context

You're building a natural-language assistant for a finance/ERP system.
Finance managers should be able to ask plain-English questions about
company books (revenue, expenses, budget variance) and get accurate,
well-grounded answers.

You're given a small multi-tenant general ledger dataset (two companies
sharing one database — a common ERP pattern). Your assistant will always
be told which company it's answering for.

## Files provided

- `companies.csv` — CompanyID, CompanyName
- `accounts.csv` — AccountID, AccountName, AccountType (Revenue/Expense/Asset/Liability/Equity)
- `transactions.csv` — TransactionID, Date, CompanyID, AccountID, Debit, Credit, Description
- `budget.csv` — CompanyID, AccountID, Period (YYYY-MM), BudgetAmount

Load these into whatever you like (SQLite, an in-memory store, plain
pandas/LINQ — your call).

## What to build

A service (CLI, API endpoint, or simple script — your choice) that:

1. Takes a `CompanyID` and a natural-language question, and returns an
   answer.
2. Uses an LLM of your choice (bring your own API key — OpenAI, Azure
   OpenAI, Anthropic, whatever you have access to).
3. **Never invents a number.** Every figure in the answer must come
   directly from the dataset — show your work (which transactions/records
   were used).
4. **Never answers with another company's data**, even if the question
   tries to get it to. This must hold even under an adversarial or
   confusingly-worded question.
5. Says "I don't have enough data to answer that" when the data genuinely
   doesn't support a confident answer, instead of guessing.

You're free to use plain prompting, RAG, text-to-SQL, function/tool
calling, or a hybrid — pick what you think is right for *financial* data
specifically, and be ready to explain why.

## Deliverables

- Source code
- A short README (half a page is fine) covering:
  - The approach you chose and why
  - How you enforced the "never leak another company's data" requirement
  - Anything you'd do differently with more time
- 3–5 example question/answer transcripts from your own testing, including
  at least one edge case (ambiguous question, or a question your system
  correctly declines to answer)

## Using AI coding tools

You're welcome to use AI coding tools (Claude Code, Copilot, ChatGPT, etc.)
as part of your workflow — that's a normal part of the job. If you do, add
a couple of lines to your README on how you used them and what, if
anything, you changed or rejected from their suggestions.

## Submission

Zip your code + README + transcripts, or share a repo link. After you
submit, we'll do a short (15–20 min) live follow-up where you walk through
your design choices and make a small change to the code live.

## A few questions you can test with (not exhaustive — try your own too)

- "What was our total marketing spend in March?"
- "How do our salaries compare to budget this quarter?"
- "What's our year-to-date revenue?"
- Try at least one question that a careless system might answer with the
  *wrong* company's numbers, and confirm yours doesn't.
