import { getCompanyName, getCoverage, listCompaniesForUi, type Coverage } from '@gl/core';
import { NotFoundError } from '../errors/http-error.js';

export interface CompanySummary {
  company_id: number;
  company_name: string;
}

export function listCompanies(): CompanySummary[] {
  return listCompaniesForUi();
}

export function findCompany(companyId: number): CompanySummary {
  const name = getCompanyName(companyId);
  if (name === null) throw new NotFoundError(`No company with id ${companyId}.`);
  return { company_id: companyId, company_name: name };
}

/** What data exists for one company — drives the "what can I ask?" hint in the UI. */
export function findCoverage(companyId: number): Coverage {
  return getCoverage(companyId);
}
