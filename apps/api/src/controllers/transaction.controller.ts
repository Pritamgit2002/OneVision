import type { Request, RequestHandler, Response } from 'express';
import type { MonthlyFilters, TransactionFilters } from '@gl/core';
import { tenantOf } from '../middleware/tenant.js';
import * as transactionService from '../services/transaction.service.js';
import {
  assertOrderedRange,
  parseAccountIds,
  parseAccountType,
  parseDate,
  parseIntegerParam,
  requireMonth,
} from '../validators/common.js';

/** GET /api/companies/:companyId/transactions?account_ids=&account_type=&start_date=&end_date= */
export const index: RequestHandler = (req: Request, res: Response) => {
  const { companyId } = tenantOf(res);
  const accountIds = parseAccountIds(req.query['account_ids']);
  const accountType = parseAccountType(req.query['account_type']);
  const startDate = parseDate(req.query['start_date'], 'start_date');
  const endDate = parseDate(req.query['end_date'], 'end_date');

  if (startDate && endDate) assertOrderedRange(startDate, endDate, 'start_date', 'end_date');

  // Built key by key rather than spread so `exactOptionalPropertyTypes`-style filters never
  // receive an explicit `undefined` the query layer would treat as a present filter.
  const filters: TransactionFilters = {};
  if (accountIds) filters.account_ids = accountIds;
  if (accountType) filters.account_type = accountType;
  if (startDate) filters.start_date = startDate;
  if (endDate) filters.end_date = endDate;

  res.json(transactionService.listTransactions(companyId, filters));
};

/** GET /api/companies/:companyId/transactions/monthly?start_month=&end_month= */
export const monthly: RequestHandler = (req: Request, res: Response) => {
  const { companyId } = tenantOf(res);
  const startMonth = requireMonth(req.query['start_month'], 'start_month');
  const endMonth = requireMonth(req.query['end_month'], 'end_month');
  assertOrderedRange(startMonth, endMonth, 'start_month', 'end_month');

  const accountIds = parseAccountIds(req.query['account_ids']);
  const accountType = parseAccountType(req.query['account_type']);

  const filters: MonthlyFilters = { start_month: startMonth, end_month: endMonth };
  if (accountIds) filters.account_ids = accountIds;
  if (accountType) filters.account_type = accountType;

  res.json(transactionService.listMonthlyTotals(companyId, filters));
};

/** GET /api/companies/:companyId/transactions/:transactionId */
export const show: RequestHandler = (req: Request, res: Response) => {
  const { companyId } = tenantOf(res);
  const transactionId = parseIntegerParam(req.params['transactionId'], 'transactionId');
  res.json(transactionService.findTransaction(companyId, transactionId));
};
