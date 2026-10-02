import 'dotenv/config';
import { config } from './config/env.js';
import { createApp } from './app.js';
import { buildRuntime } from './composition-root.js';
import { startScheduler } from './jobs/scheduler.js';
import { prisma } from './shared/db/prisma.js';
import { logger } from './shared/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const runtime = buildRuntime();
const app = createApp(runtime.app);
const stopScheduler = config.JOBS_ENABLED
  ? startScheduler(config.BILLING_CRON, runtime.runMaintenance, logger)
  : () => undefined;
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Server listening');
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  stopScheduler();

  // If connections refuse to close, exit anyway rather than hang.
  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Stop accepting new connections and let in-flight requests finish.
  server.close((closeError) => {
    prisma
      .$disconnect()
      .catch((err: unknown) => logger.error({ err }, 'Error disconnecting from database'))
      .finally(() => {
        logger.info('Shutdown complete');
        process.exit(closeError ? 1 : 0);
      });
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
