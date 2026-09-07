/**
 * The API surface, in one place.
 *
 *   GET  /api/health
 *   GET  /api/companies
 *   GET  /api/companies/:companyId
 *   GET  /api/companies/:companyId/coverage
 *   GET  /api/companies/:companyId/transactions
 *   GET  /api/companies/:companyId/transactions/monthly
 *   GET  /api/companies/:companyId/transactions/:transactionId
 *   GET  /api/companies/:companyId/budget
 *   GET  /api/accounts
 *   GET  /api/accounts/:accountId
 *   POST /api/ask
 *   POST /api/ask/stream
 *
 * Read-only by design: the ledger is loaded from CSV into an in-memory database at boot,
 * so there is no write path to expose. Adding one means adding it to the query layer first.
 */
import { Router } from 'express';
import type { LoadSummary } from '@gl/core';
import { accountRouter } from './account.routes.js';
import { askRouter } from './ask.routes.js';
import { companyRouter } from './company.routes.js';
import { createHealthRouter } from './health.routes.js';

export function createApiRouter(summary: LoadSummary): Router {
  const api = Router();

  api.use('/health', createHealthRouter(summary));
  api.use('/companies', companyRouter);
  api.use('/accounts', accountRouter);
  api.use('/ask', askRouter);

  return api;
}
