import cors from 'cors';
import express, { type Express } from 'express';
import type { LoadSummary } from '@gl/core';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createApiRouter } from './routes/index.js';
import { createHealthRouter } from './routes/health.routes.js';

/**
 * Assembles the app without starting it, so it can be exercised from a test or a script
 * without binding a port. `index.ts` owns the listening.
 */
export function createApp(summary: LoadSummary): Express {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: env.bodyLimit }));

  app.use('/health', createHealthRouter(summary));
  app.use('/api', createApiRouter(summary));

  // Order matters: unmatched route first, then the single place that renders an error.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
