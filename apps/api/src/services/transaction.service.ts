import {
  monthlyTotals,
  queryTransactions,
  type MonthlyFilters,
  type MonthlyTotalsResult,
  type TransactionFilters,
  type TransactionResult,
  type TransactionRow,
} from '@gl/core';
import { NotFoundError } from '../errors/http-error.js';

/**
 * Every function here takes `companyId` as its first argument and passes it straight
 * through as the first argument of the query — the same shape the tool executor uses,
 * so there is no path by which a filter can widen the tenant.
 */

export function listTransactions(companyId: number, filters: TransactionFilters): TransactionResult {
  return queryTransactions(companyId, filters);
}

export function findTransaction(companyId: number, transactionId: number): TransactionRow {
  const row = queryTransactions(companyId).rows.find((r) => r.transaction_id === transactionId);
  // A transaction belonging to another company is "not found" here, deliberately: the
  // response must not distinguish "does not exist" from "is not yours".
  if (!row) throw new NotFoundError(`No transaction with id ${transactionId} for this company.`);
  return row;
}

export function listMonthlyTotals(companyId: number, filters: MonthlyFilters): MonthlyTotalsResult {
  return monthlyTotals(companyId, filters);
}
