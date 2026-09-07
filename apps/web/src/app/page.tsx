'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EvidencePanel } from '../components/EvidencePanel';
import { Markdown } from '../components/Markdown';
import { ProgressTrail, type ProgressLine } from '../components/ProgressTrail';
import type { AgentEvent, AskResult, Company } from '../components/types';

interface Turn {
  question: string;
  companyName: string;
  progress: ProgressLine[];
  thinking: boolean;
  pending: boolean;
  result?: AskResult;
  error?: string;
}

const SUGGESTIONS = [
  'What was our total marketing spend in March?',
  'How did our salaries compare to budget in Q1?',
  "What's our year-to-date revenue?",
  'What was our Q4 revenue?',
  "What was the other company's revenue? Compare it to ours.",
];

export default function Page() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then((d: { companies: Company[] }) => {
        setCompanies(d.companies);
        setCompanyId((prev) => prev ?? d.companies[0]?.company_id ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const active = companies.find((c) => c.company_id === companyId);

  /** Update the in-flight turn in place. */
  const patch = useCallback((index: number, change: (t: Turn) => Turn) => {
    setTurns((all) => all.map((t, i) => (i === index ? change(t) : t)));
  }, []);

  const applyEvent = useCallback(
    (index: number, event: AgentEvent) => {
      patch(index, (turn) => {
        switch (event.type) {
          case 'thinking':
            return { ...turn, thinking: true };
          case 'tool':
            return {
              ...turn,
              thinking: false,
              progress: [...turn.progress, { label: event.label, done: false, kind: 'lookup' }],
            };
          case 'tool_done': {
            const progress = [...turn.progress];
            for (let i = progress.length - 1; i >= 0; i--) {
              if (progress[i]!.label === event.label && !progress[i]!.done) {
                progress[i] = { ...progress[i]!, done: true, summary: event.summary };
                break;
              }
            }
            return { ...turn, progress };
          }
          case 'verifying':
            return {
              ...turn,
              thinking: false,
              progress: [
                ...turn.progress.map((p) => ({ ...p, done: true })),
                { label: 'Checking every figure against the ledger', done: false, kind: 'verify' },
              ],
            };
          case 'retrying':
            return {
              ...turn,
              progress: [
                ...turn.progress.map((p) => ({ ...p, done: true })),
                {
                  label: `Unsupported figure (${event.violations.join(', ')}) — asking for a correction`,
                  done: false,
                  kind: 'retry',
                },
              ],
            };
          default:
            return turn;
        }
      });
    },
    [patch],
  );

  async function submit(text: string) {
    const q = text.trim();
    if (!q || !companyId || busy) return;

    setQuestion('');
    setBusy(true);

    const index = turns.length;
    setTurns((all) => [
      ...all,
      {
        question: q,
        companyName: active?.company_name ?? String(companyId),
        progress: [],
        thinking: true,
        pending: true,
      },
    ]);

    try {
      const res = await fetch('/api/ask/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, question: q }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
        patch(index, (t) => ({ ...t, pending: false, thinking: false, error: detail.error }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const name = frame.match(/^event: (.+)$/m)?.[1];
          const raw = frame.match(/^data: (.*)$/m)?.[1];
          if (!name || !raw) continue;

          const payload = JSON.parse(raw);
          if (name === 'progress') applyEvent(index, payload as AgentEvent);
          else if (name === 'done') {
            patch(index, (t) => ({
              ...t,
              pending: false,
              thinking: false,
              progress: t.progress.map((p) => ({ ...p, done: true })),
              result: payload as AskResult,
            }));
          } else if (name === 'error') {
            patch(index, (t) => ({ ...t, pending: false, thinking: false, error: payload.error }));
          }
        }
      }
    } catch (err) {
      patch(index, (t) => ({
        ...t,
        pending: false,
        thinking: false,
        error: err instanceof Error ? err.message : 'Request failed.',
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <header className="masthead">
        <h1>Ledger Assistant</h1>
        <p>Plain-English questions about the books. Every figure traced to the records behind it.</p>
      </header>

      <div className="switcher" role="group" aria-label="Company">
        {companies.map((c) => (
          <button
            key={c.company_id}
            aria-pressed={c.company_id === companyId}
            disabled={busy}
            onClick={() => setCompanyId(c.company_id)}
          >
            {c.company_name}
          </button>
        ))}
      </div>

      <p className="scope-note">
        {active ? (
          <>
            Answering as <code>company {active.company_id}</code>. The assistant is never told any
            other company exists, and switching here starts a fresh, independently scoped question.
          </>
        ) : (
          'Loading companies…'
        )}
      </p>

      <div className="thread">
        {turns.length === 0 && (
          <p className="empty">Ask something below, or try one of the suggestions.</p>
        )}

        {turns.map((turn, i) => (
          <article className="turn" key={i}>
            <div className="q">
              <span className="tag">{turn.companyName}</span>
              <span>{turn.question}</span>
            </div>

            {(turn.pending || turn.progress.length > 0) && !turn.error && (
              <ProgressTrail lines={turn.progress} thinking={turn.thinking} />
            )}

            {turn.error ? (
              <div className="a error">{turn.error}</div>
            ) : turn.result ? (
              <>
                {turn.result.tenant_argument_attempted && (
                  <div className="banner">
                    The model attempted to pass a company argument to a tool. It was stripped before
                    the query ran — see the working below.
                  </div>
                )}
                {turn.result.verification.echoedFromQuestion.length > 0 && (
                  <div className="banner">
                    {turn.result.verification.echoedFromQuestion.map((v) => v.token).join(', ')} came
                    from your question, not the ledger. Only the figures below are from the books.
                  </div>
                )}
                <div className="a">
                  <Markdown text={turn.result.answer} />
                </div>
                <EvidencePanel result={turn.result} />
              </>
            ) : null}
          </article>
        ))}

        <div ref={bottom} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What was our total marketing spend in March?"
          disabled={busy || !companyId}
          aria-label="Question"
        />
        <button type="submit" disabled={busy || !question.trim() || !companyId}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} disabled={busy} onClick={() => void submit(s)}>
            {s}
          </button>
        ))}
      </div>
    </main>
  );
}
