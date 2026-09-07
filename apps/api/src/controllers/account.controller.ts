import type { Request, RequestHandler, Response } from 'express';
import * as accountService from '../services/account.service.js';
import { parseIntegerParam } from '../validators/common.js';

export const index: RequestHandler = (_req: Request, res: Response) => {
  res.json({ accounts: accountService.listAllAccounts() });
};

export const show: RequestHandler = (req: Request, res: Response) => {
  const accountId = parseIntegerParam(req.params['accountId'], 'accountId');
  res.json(accountService.findAccount(accountId));
};
