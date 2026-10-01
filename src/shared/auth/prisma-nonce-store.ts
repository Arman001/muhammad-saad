import { Prisma, type PrismaClient } from '@prisma/client';
import type { NonceStore } from './ports.js';

export class PrismaNonceStore implements NonceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async consume(nonce: string, userId: string): Promise<boolean> {
    try {
      // The primary key makes this atomic: a second insert of the same nonce fails.
      await this.prisma.requestNonce.create({ data: { nonce, userId } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async pruneOlderThan(date: Date): Promise<number> {
    const result = await this.prisma.requestNonce.deleteMany({
      where: { createdAt: { lt: date } },
    });
    return result.count;
  }
}
