import { Router } from 'express';
import * as accountController from '../controllers/account.controller.js';

/** Mounted at /api/accounts. Reference data — no tenant dimension exists on it. */
export const accountRouter = Router();

accountRouter.get('/', accountController.index);
accountRouter.get('/:accountId', accountController.show);
