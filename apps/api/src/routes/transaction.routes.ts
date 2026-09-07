import { Router } from 'express';
import * as transactionController from '../controllers/transaction.controller.js';

/**
 * Mounted at /api/companies/:companyId/transactions.
 *
 * `mergeParams` is what lets this router see `:companyId` from its parent — the tenant is
 * already resolved by then, so nothing in here parses it again.
 */
export const transactionRouter = Router({ mergeParams: true });

transactionRouter.get('/', transactionController.index);
// Ahead of /:transactionId, or "monthly" would be parsed as an id.
transactionRouter.get('/monthly', transactionController.monthly);
transactionRouter.get('/:transactionId', transactionController.show);
