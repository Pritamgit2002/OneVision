import type { Request, RequestHandler, Response } from 'express';
import type { BudgetFilters } from '@gl/core';
import { tenantOf } from '../middleware/tenant.js';
import * as budgetService from '../services/budget.service.js';
import { assertOrderedRange, parseAccountIds, requireMonth } from '../validators/common.js';

/** GET /api/companies/:companyId/budget?start_period=&end_period=&account_ids= */
export const index: RequestHandler = (req: Request, res: Response) => {
  const { companyId } = tenantOf(res);
  const startPeriod = requireMonth(req.query['start_period'], 'start_period');
  const endPeriod = requireMonth(req.query['end_period'], 'end_period');
  assertOrderedRange(startPeriod, endPeriod, 'start_period', 'end_period');

  const accountIds = parseAccountIds(req.query['account_ids']);
  const filters: BudgetFilters = { start_period: startPeriod, end_period: endPeriod };
  if (accountIds) filters.account_ids = accountIds;

  res.json(budgetService.getBudgetVsActual(companyId, filters));
};
