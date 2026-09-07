import { env } from '../config/env.js';
import { requireInteger, requireNonEmptyString } from './common.js';

export interface AskInput {
  companyId: number;
  question: string;
}

/**
 * `companyId` comes from the request body here rather than the path, because that is what
 * the UI sends and what the README documents. It is still server-side context as far as the
 * agent is concerned: it is passed as an argument, never exposed to the question.
 */
export function parseAskInput(body: unknown): AskInput {
  const { companyId, question } = (body ?? {}) as Record<string, unknown>;
  return {
    companyId: requireInteger(companyId, 'companyId'),
    question: requireNonEmptyString(question, 'question', env.maxQuestionLength),
  };
}
