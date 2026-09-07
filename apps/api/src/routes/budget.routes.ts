import { Router } from 'express';
import * as budgetController from '../controllers/budget.controller.js';

/** Mounted at /api/companies/:companyId/budget. */
export const budgetRouter = Router({ mergeParams: true });

budgetRouter.get('/', budgetController.index);
