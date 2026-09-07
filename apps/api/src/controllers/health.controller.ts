import type { Request, RequestHandler, Response } from 'express';
import type { LoadSummary } from '@gl/core';

/**
 * Reports what the CSV load produced. The summary is captured at boot and injected, so the
 * controller never reaches back into the loader.
 */
export function healthController(summary: LoadSummary): RequestHandler {
  return (_req: Request, res: Response) => {
    res.json({ ok: true, ...summary });
  };
}
