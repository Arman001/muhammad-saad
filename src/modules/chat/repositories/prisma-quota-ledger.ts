import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  FREE_MESSAGES_PER_MONTH,
  periodKey,
  type QuotaReservation,
} from '../domain/entities/quota.js';
import type { QuotaLedger, UsageSummary } from '../domain/ports.js';

/** Attempts before concluding no bundle has quota (see reserveFromBundle). */
const MAX_BUNDLE_ATTEMPTS = 5;

/**
 * Atomic quota accounting in PostgreSQL.
 *
 * Every deduction is a single conditional UPDATE ("... + 1 WHERE used < limit").
 * Postgres locks the row and re-checks the condition after any concurrent
 * update commits, so two requests can never both take the last message.
 * There is no read-then-write gap in application code.
 *
 * Timestamps are passed as UTC strings and cast to `timestamp`, matching how
 * Prisma stores DateTime columns, so comparisons never depend on the session time zone.
 */
export class PrismaQuotaLedger implements QuotaLedger {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(userId: string, now: Date): Promise<QuotaReservation | null> {
    return this.prisma.$transaction(async (tx) => {
      const period = periodKey(now);

      // 1. Free monthly quota. The row is created on first use in a month;
      //    a new month means a new row, which is the automatic reset.
      await tx.$executeRaw`
        INSERT INTO "MonthlyUsage" ("id", "userId", "period", "freeUsed")
        VALUES (${randomUUID()}, ${userId}, ${period}, 0)
        ON CONFLICT ("userId", "period") DO NOTHING`;

      const free = await tx.$queryRaw<{ freeUsed: number }[]>`
        UPDATE "MonthlyUsage"
        SET "freeUsed" = "freeUsed" + 1
        WHERE "userId" = ${userId} AND "period" = ${period} AND "freeUsed" < ${FREE_MESSAGES_PER_MONTH}
        RETURNING "freeUsed"`;
      if (free.length === 1) {
        return { source: 'FREE', period } as const;
      }

      // 2. Subscription bundles.
      return this.reserveFromBundle(tx, userId, now.toISOString());
    });
  }

  /**
   * Takes one message from the usable bundle with the latest start date.
   *
   * The inner SELECT ... FOR UPDATE picks and locks that bundle. If a concurrent
   * request used its last message first, Postgres re-checks the conditions after
   * the lock is released and the UPDATE affects no row. In that case we look again,
   * because a different bundle may still have quota.
   */
  private async reserveFromBundle(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    userId: string,
    nowIso: string,
  ): Promise<QuotaReservation | null> {
    for (let attempt = 0; attempt < MAX_BUNDLE_ATTEMPTS; attempt += 1) {
      const updated = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "Subscription"
        SET "usedMessages" = "usedMessages" + 1, "updatedAt" = NOW()
        WHERE "id" = (
          SELECT "id" FROM "Subscription"
          WHERE "userId" = ${userId}
            AND "status" = 'ACTIVE'
            AND "startDate" <= ${nowIso}::timestamp
            AND "endDate" > ${nowIso}::timestamp
            AND ("maxMessages" IS NULL OR "usedMessages" < "maxMessages")
          ORDER BY "startDate" DESC, "createdAt" DESC
          LIMIT 1
          FOR UPDATE
        )
        AND ("maxMessages" IS NULL OR "usedMessages" < "maxMessages")
        RETURNING "id"`;

      const row = updated[0];
      if (row) {
        return { source: 'SUBSCRIPTION', subscriptionId: row.id };
      }

      const remaining = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS "count" FROM "Subscription"
        WHERE "userId" = ${userId}
          AND "status" = 'ACTIVE'
          AND "startDate" <= ${nowIso}::timestamp
          AND "endDate" > ${nowIso}::timestamp
          AND ("maxMessages" IS NULL OR "usedMessages" < "maxMessages")`;
      if ((remaining[0]?.count ?? 0n) === 0n) {
        return null;
      }
    }
    return null;
  }

  async release(userId: string, reservation: QuotaReservation): Promise<void> {
    if (reservation.source === 'FREE') {
      await this.prisma.$executeRaw`
        UPDATE "MonthlyUsage" SET "freeUsed" = "freeUsed" - 1
        WHERE "userId" = ${userId} AND "period" = ${reservation.period} AND "freeUsed" > 0`;
      return;
    }
    await this.prisma.$executeRaw`
      UPDATE "Subscription" SET "usedMessages" = "usedMessages" - 1, "updatedAt" = NOW()
      WHERE "id" = ${reservation.subscriptionId} AND "userId" = ${userId} AND "usedMessages" > 0`;
  }

  async usage(userId: string, now: Date): Promise<UsageSummary> {
    const period = periodKey(now);
    const [monthly, bundles] = await Promise.all([
      this.prisma.monthlyUsage.findUnique({ where: { userId_period: { userId, period } } }),
      this.prisma.subscription.findMany({
        where: { userId, status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    return {
      period,
      freeUsed: monthly?.freeUsed ?? 0,
      bundles: bundles.map((b) => ({
        subscriptionId: b.id,
        tier: b.tier,
        remaining: b.maxMessages === null ? null : Math.max(0, b.maxMessages - b.usedMessages),
        endDate: b.endDate,
      })),
    };
  }
}
