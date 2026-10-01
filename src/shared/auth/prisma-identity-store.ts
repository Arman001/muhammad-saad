import { Prisma, type PrismaClient } from '@prisma/client';
import type { IdentityRecord, IdentityStore } from './ports.js';

export class PrismaIdentityStore implements IdentityStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreate(authSub: string, email: string | undefined): Promise<IdentityRecord> {
    try {
      // Role is never taken from the token; new users always start as USER.
      const user = await this.prisma.user.upsert({
        where: { authSub },
        create: { authSub, email: email ?? null },
        update: {},
        select: { id: true, role: true },
      });
      return user;
    } catch (error) {
      // Two first-time requests at once can race on the unique authSub. The loser reads the winner's row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.user.findUniqueOrThrow({
          where: { authSub },
          select: { id: true, role: true },
        });
      }
      throw error;
    }
  }
}
