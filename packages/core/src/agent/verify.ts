/**
 * ★ The numeric guard. ★
 *
 * "Never invents a number" is enforced in code, not merely requested in the prompt:
 * every figure in the final answer must trace back to something a tool actually
 * returned, or the answer does not ship.
 */
import type { EvidenceEntry } from '../tools/executor.js';

export interface Violation {
  /** The literal text found in the answer. */
  token: string;
  /** Its parsed numeric value. */
  value: number;
}

export interface VerificationResult {
  ok: boolean;
  violations: Violation[];
  /**
   * Figures that appear in the answer but came from the *question*, not the ledger —
   * almost always the assistant quoting a claim back in order to correct it. Permitted,
   * but recorded separately so a question-sourced number is never silently presented
   * as a ledger fact.
   */
  echoedFromQuestion: Violation[];
  /** How many distinct values the answer was checked against. */
  allowedValueCount: number;
}

/**
 * Integers 0-12 pass unchecked: months, quarters, small counts and list positions.
 * A fabricated financial figure cannot hide in this range, and checking it produces
 * nothing but false positives on phrases like "over 6 months".
 */
const SMALL_INT_CEILING = 12;

/** 1% relative, or 0.05 absolute for small values — so "~46k", "45,974" and "26%" all match 45974.39 / 26.2. */
function withinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(b) * 0.01, 0.05);
}

const NUMBER_RE = /-?\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:%|k\b|m\b|bn\b)?/gi;

/** ISO dates and periods: 2026-03-18, 2026-03. */
const ISO_DATE_RE = /\b\d{4}-\d{2}(?:-\d{2})?\b/g;

/** Parse "$45,974.39", "46k", "26.2%" into a number. */
function parseToken(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  const mult = t.endsWith('bn') ? 1e9 : t.endsWith('m') ? 1e6 : /k$/.test(t) ? 1e3 : 1;
  const n = Number(t.replace(/[$,%\s]/g, '').replace(/(k|m|bn)$/, ''));
  return Number.isFinite(n) ? n * mult : null;
}

/** Every number a tool actually produced, including those embedded in date and period strings. */
function collectAllowedValues(evidence: EvidenceEntry[]): Set<number> {
  const allowed = new Set<number>();

  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    allowed.add(n);
    allowed.add(Math.abs(n));               // "26.2% under" for a variance of -26.2
    allowed.add(Math.round(n));
    allowed.add(Math.round(n * 100) / 100);
  };

  const walk = (v: unknown): void => {
    if (typeof v === 'number') add(v);
    else if (typeof v === 'string') {
      // Pulls 2026, 3 and 15 out of "2026-03-15" so dates and periods are quotable.
      for (const part of v.match(/\d+(?:\.\d+)?/g) ?? []) add(Number(part));
    } else if (Array.isArray(v)) {
      add(v.length);                        // "3 transactions" for a 3-row result
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };

  evidence.forEach((e) => walk(e.result));
  return allowed;
}

export function verifyAnswer(
  answer: string,
  evidence: EvidenceEntry[],
  question = '',
): VerificationResult {
  const allowed = collectAllowedValues(evidence);
  const allowedList = [...allowed];
  // Numbers the user themselves put in the question. Quoting one back to deny it —
  // "March was 45,974.39, not the 91,000 you were told" — is desirable behaviour, so
  // these are permitted; they are reported separately rather than treated as ledger data.
  const fromQuestion = new Set(
    (question.match(NUMBER_RE) ?? []).map(parseToken).filter((n): n is number => n !== null),
  );
  const violations: Violation[] = [];
  const echoedFromQuestion: Violation[] = [];
  const seen = new Set<string>();

  const flag = (token: string, value: number) => {
    if (seen.has(token)) return;
    seen.add(token);
    if ([...fromQuestion].some((q) => withinTolerance(value, q))) {
      echoedFromQuestion.push({ token, value });
      return;
    }
    violations.push({ token, value });
  };

  // Dates are checked first, and checked EXACTLY: a date is a fact, not a rounded figure,
  // so the tolerance below must not apply to it (1% of 2026 is ±20 years). Blanking each
  // date out afterwards also stops the hyphen in "2026-03-18" being read as a minus sign,
  // which would otherwise flag a phantom "-18" and burn a corrective retry.
  const scrubbed = answer.replace(ISO_DATE_RE, (date) => {
    const parts = date.split('-').map(Number);
    if (!parts.every((n) => allowed.has(n))) flag(date, parts[0] ?? 0);
    return ' '.repeat(date.length);
  });

  for (const match of scrubbed.match(NUMBER_RE) ?? []) {
    const value = parseToken(match);
    if (value === null) continue;
    if (Number.isInteger(value) && Math.abs(value) <= SMALL_INT_CEILING) continue;
    if (allowedList.some((a) => withinTolerance(value, a))) continue;
    flag(match.trim(), value);
  }

  return {
    ok: violations.length === 0,
    violations,
    echoedFromQuestion,
    allowedValueCount: allowed.size,
  };
}

/** The corrective message sent on the single retry a failed answer gets. */
export function correctionMessage(violations: Violation[]): string {
  const list = violations.map((v) => `"${v.token}"`).join(', ');
  return (
    `Your answer contained ${list}, which no tool result supports. ` +
    `Rewrite it using only figures returned by the tools you called — call another tool if ` +
    `you need a number you do not have. If the data cannot support the answer, say so instead.`
  );
}
