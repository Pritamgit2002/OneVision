import { budgetVsActual, type BudgetFilters, type BudgetResult } from '@gl/core';

/** Variance and variance-% are computed in the query layer, never here and never by a model. */
export function getBudgetVsActual(companyId: number, filters: BudgetFilters): BudgetResult {
  return budgetVsActual(companyId, filters);
}
