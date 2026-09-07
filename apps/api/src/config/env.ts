/** Every environment knob the HTTP layer reads, resolved once at import time. */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const env = {
  port: int('PORT', 4000),
  /** Comma-separated allowlist; unset means "reflect any origin", which is the dev default. */
  corsOrigin: process.env['CORS_ORIGIN']?.split(',').map((s) => s.trim()) ?? true,
  bodyLimit: process.env['BODY_LIMIT'] ?? '64kb',
  /** Longest question the agent will accept, in characters. */
  maxQuestionLength: int('MAX_QUESTION_LENGTH', 2000),
} as const;
