import cron from 'node-cron';
import type { Logger } from 'pino';
import type { MaintenanceResult } from './maintenance-jobs.js';

/** Runs maintenance on a cron schedule. Returns a function that stops it. */
export function startScheduler(
  schedule: string,
  runMaintenance: () => Promise<MaintenanceResult>,
  logger: Logger,
): () => void {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid BILLING_CRON schedule: "${schedule}"`);
  }

  const task = cron.schedule(schedule, async () => {
    try {
      const result = await runMaintenance();
      if (result.skipped) {
        logger.warn('Maintenance run skipped: previous run still in progress');
      } else {
        logger.info({ job: 'maintenance', ...result }, 'Maintenance run completed');
      }
    } catch (err) {
      logger.error({ err, job: 'maintenance' }, 'Maintenance run failed');
    }
  });

  logger.info({ schedule }, 'Scheduler started');
  return () => {
    void task.stop();
  };
}
