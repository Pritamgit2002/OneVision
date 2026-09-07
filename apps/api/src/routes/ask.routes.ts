import { Router } from 'express';
import * as askController from '../controllers/ask.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';

/** Mounted at /api/ask. */
export const askRouter = Router();

askRouter.post('/', asyncHandler(askController.create));
askRouter.post('/stream', asyncHandler(askController.stream));
