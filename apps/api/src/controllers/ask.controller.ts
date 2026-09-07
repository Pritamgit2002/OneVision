import type { Request, Response } from 'express';
import { isIsolationViolation, messageOf } from '../errors/http-error.js';
import { askQuestion, type AgentEvent } from '../services/ask.service.js';
import { parseAskInput } from '../validators/ask.validator.js';

/** POST /api/ask */
export async function create(req: Request, res: Response): Promise<void> {
  const { companyId, question } = parseAskInput(req.body);
  res.json(await askQuestion(companyId, question));
}

/**
 * POST /api/ask/stream — the same answer, as Server-Sent Events.
 *
 * Emits a `progress` event for each lookup as it runs, then a single `done` event carrying
 * the payload /ask returns. The answer text is deliberately not streamed token by token —
 * see the note on AgentEvent in packages/core/src/agent/run.ts.
 *
 * Once the headers are out this handler owns its own failures: an error after that point
 * has to be an `error` event, not a status code the error middleware can no longer set.
 */
export async function stream(req: Request, res: Response): Promise<void> {
  const { companyId, question } = parseAskInput(req.body);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // If the client navigates away mid-question, stop writing into a dead socket.
  //
  // This must listen on the RESPONSE, not the request: `req`'s 'close' fires as soon as the
  // request body has been read, which is immediately — listening there silently drops every
  // event after the first.
  let aborted = false;
  res.on('close', () => {
    aborted = true;
  });

  try {
    const result = await askQuestion(companyId, question, (event: AgentEvent) => {
      if (!aborted) send('progress', event);
    });
    if (!aborted) send('done', result);
  } catch (err) {
    if (isIsolationViolation(err)) console.error(messageOf(err));
    if (!aborted) send('error', { error: messageOf(err) });
  } finally {
    res.end();
  }
}
