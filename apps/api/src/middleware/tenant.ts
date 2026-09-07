/**
 * Resolves `:companyId` once, for every route nested under a company.
 *
 * This is the HTTP-layer counterpart of the rule the agent layer enforces: the tenant is
 * established from server-side context before anything else runs, and controllers read it
 * from here rather than re-parsing the request. In production this middleware is where the
 * company would come from the authenticated session instead of the path.
 */
import type { Request, RequestHandler, Response } from 'express';
import { findCompany } from '../services/company.service.js';
import { parseIntegerParam } from '../validators/common.js';

export interface Tenant {
  companyId: number;
  companyName: string;
}

const TENANT_KEY = 'tenant';

export const resolveTenant: RequestHandler = (req: Request, res: Response, next) => {
  try {
    const companyId = parseIntegerParam(req.params['companyId'], 'companyId');
    const company = findCompany(companyId);
    res.locals[TENANT_KEY] = {
      companyId: company.company_id,
      companyName: company.company_name,
    } satisfies Tenant;
    next();
  } catch (err) {
    next(err);
  }
};

/** Typed read of what `resolveTenant` stashed. Only valid downstream of that middleware. */
export function tenantOf(res: Response): Tenant {
  const tenant = res.locals[TENANT_KEY] as Tenant | undefined;
  if (!tenant) throw new Error('resolveTenant middleware did not run for this route.');
  return tenant;
}
