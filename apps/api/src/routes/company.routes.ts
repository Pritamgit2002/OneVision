import { Router } from 'express';
import * as companyController from '../controllers/company.controller.js';
import { resolveTenant } from '../middleware/tenant.js';
import { budgetRouter } from './budget.routes.js';
import { transactionRouter } from './transaction.routes.js';

/** Mounted at /api/companies. */
export const companyRouter = Router();

companyRouter.get('/', companyController.index);

// Everything below is tenant-scoped: one middleware admits the company, and every nested
// router inherits it. Adding a resource under a company cannot forget the check.
companyRouter.use('/:companyId', resolveTenant);

companyRouter.get('/:companyId', companyController.show);
companyRouter.get('/:companyId/coverage', companyController.coverage);
companyRouter.use('/:companyId/transactions', transactionRouter);
companyRouter.use('/:companyId/budget', budgetRouter);
