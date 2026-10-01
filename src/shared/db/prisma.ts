import { PrismaClient } from '@prisma/client';
import { config } from '../../config/env.js';

/**
 * Single Prisma client for the whole process.
 * Only repository implementations should import this; domain code never does.
 */
export const prisma = new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
