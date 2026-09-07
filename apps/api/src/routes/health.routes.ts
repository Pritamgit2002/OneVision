import { Router } from 'express';
import type { LoadSummary } from '@gl/core';
import { healthController } from '../controllers/health.controller.js';

/** Mounted twice: at /health for probes, and at /api/health alongside the rest. */
export function createHealthRouter(summary: LoadSummary): Router {
  const healthRouter = Router();
  healthRouter.get('/', healthController(summary));
  return healthRouter;
}
