import { ask, type AgentEvent, type AskResult, type EventSink } from '@gl/core';
import { BadRequestError, isIsolationViolation, messageOf } from '../errors/http-error.js';

export type { AgentEvent };

/**
 * The one call that matters.
 *
 * `companyId` is server-side context resolved before this runs and passed to the agent as
 * an argument — never something the question can influence. See middleware/tenant.ts.
 *
 * A failure inside the agent is a bad request (an unanswerable question, a model error)
 * *unless* it is a tripped isolation assertion, which is ours and must surface as a 500.
 */
export async function askQuestion(
  companyId: number,
  question: string,
  onEvent?: EventSink,
): Promise<AskResult> {
  try {
    return await ask(companyId, question, onEvent);
  } catch (err) {
    if (isIsolationViolation(err)) throw err;
    throw new BadRequestError(messageOf(err));
  }
}
