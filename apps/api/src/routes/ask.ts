import { Router } from 'express';
import { ask, listCompaniesForUi, getCoverage, type AgentEvent } from '@gl/core';

export const router = Router();

/** Populates the UI's company switcher. The agent never calls this. */
router.get('/companies', (_req, res) => {
  res.json({ companies: listCompaniesForUi() });
});

/** What data exists for one company — drives the "what can I ask?" hint in the UI. */
router.get('/companies/:id/coverage', (req, res) => {
  const companyId = Number(req.params.id);
  if (!Number.isInteger(companyId)) {
    res.status(400).json({ error: 'companyId must be an integer.' });
    return;
  }
  try {
    res.json(getCoverage(companyId));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * The one endpoint that matters.
 *
 * `companyId` is taken from the request body and passed to the agent as an argument.
 * In production this would come from the authenticated session instead — see the README —
 * but either way it is server-side context, never something the question can influence.
 */
router.post('/ask', async (req, res) => {
  const { companyId, question } = req.body ?? {};

  if (!Number.isInteger(companyId)) {
    res.status(400).json({ error: 'companyId is required and must be an integer.' });
    return;
  }
  if (typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: 'question is required.' });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: 'question is too long (2000 character limit).' });
    return;
  }

  try {
    res.json(await ask(companyId, question));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A tripped isolation assertion is a server-side fault, not a bad request.
    const status = message.startsWith('TENANT ISOLATION VIOLATION') ? 500 : 400;
    if (status === 500) console.error(message);
    res.status(status).json({ error: message });
  }
});

/**
 * Streaming variant of /ask, as Server-Sent Events.
 *
 * Emits `progress` events for each lookup as it runs, then a single `done` event carrying
 * the same payload /ask returns. The answer text is deliberately not streamed token by
 * token — see the note on AgentEvent in packages/core/src/agent/run.ts.
 */
router.post('/ask/stream', async (req, res) => {
  const { companyId, question } = req.body ?? {};

  if (!Number.isInteger(companyId) || typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: 'companyId (integer) and question (string) are both required.' });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: 'question is too long (2000 character limit).' });
    return;
  }

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
    const result = await ask(companyId, question, (event: AgentEvent) => {
      if (!aborted) send('progress', event);
    });
    if (!aborted) send('done', result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('TENANT ISOLATION VIOLATION')) console.error(message);
    if (!aborted) send('error', { error: message });
  } finally {
    res.end();
  }
});
