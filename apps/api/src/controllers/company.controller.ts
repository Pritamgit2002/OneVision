import type { Request, RequestHandler, Response } from 'express';
import { tenantOf } from '../middleware/tenant.js';
import * as companyService from '../services/company.service.js';

/**
 * Populates the UI's company switcher. The agent never calls this, and the list is
 * deliberately never rendered into a prompt — see packages/core/src/db/queries.ts.
 */
export const index: RequestHandler = (_req: Request, res: Response) => {
  res.json({ companies: companyService.listCompanies() });
};

export const show: RequestHandler = (_req: Request, res: Response) => {
  const { companyId, companyName } = tenantOf(res);
  res.json({ company_id: companyId, company_name: companyName });
};

/** What data exists for one company — drives the "what can I ask?" hint in the UI. */
export const coverage: RequestHandler = (_req: Request, res: Response) => {
  res.json(companyService.findCoverage(tenantOf(res).companyId));
};
