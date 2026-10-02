/**
 * Runs one maintenance pass now (due renewals and nonce cleanup) instead of
 * waiting for the schedule. Usage: pnpm billing:run
 */
import 'dotenv/config';
import { buildRuntime } from '../composition-root.js';
import { prisma } from '../shared/db/prisma.js';

buildRuntime()
  .runMaintenance()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
