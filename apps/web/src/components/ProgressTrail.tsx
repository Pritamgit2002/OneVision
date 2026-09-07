'use client';

export interface ProgressLine {
  label: string;
  summary?: string;
  done: boolean;
  kind?: 'lookup' | 'verify' | 'retry';
}

/** Live view of the work as it happens: each lookup, what it returned, then verification. */
export function ProgressTrail({ lines, thinking }: { lines: ProgressLine[]; thinking: boolean }) {
  return (
    <ul className="trail">
      {lines.map((line, i) => (
        <li key={i} className={`trail-line ${line.kind ?? 'lookup'} ${line.done ? 'done' : 'active'}`}>
          <span className="trail-mark" aria-hidden />
          <span className="trail-label">
            {line.label}
            {line.summary && <span className="trail-summary"> — {line.summary}</span>}
          </span>
        </li>
      ))}
      {thinking && (
        <li className="trail-line active">
          <span className="trail-mark" aria-hidden />
          <span className="trail-label">
            Thinking<span className="dots" />
          </span>
        </li>
      )}
    </ul>
  );
}
