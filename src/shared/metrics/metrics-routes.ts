import { Router } from 'express';
import { requireRole } from '../auth/require-role.js';
import type { Clock } from '../kernel/clock.js';
import type { MetricsSource } from './metrics.js';

/** Admin-only, system-wide metrics. */
export function createMetricsRouter(source: MetricsSource, clock: Clock): Router {
  const router = Router();
  router.get('/metrics', requireRole('ADMIN'), async (_req, res) => {
    res.json(await source.collect(clock.now()));
  });
  return router;
}
