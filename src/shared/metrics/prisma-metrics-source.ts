import { Prisma, type PrismaClient } from '@prisma/client';
import { periodKey } from '../../modules/chat/domain/entities/quota.js';
import type { MetricsSource, SystemMetrics } from './metrics.js';

/** Aggregates computed in the database, so the endpoint stays cheap as data grows. */
export class PrismaMetricsSource implements MetricsSource {
  constructor(private readonly prisma: PrismaClient) {}

  async collect(now: Date): Promise<SystemMetrics> {
    const period = periodKey(now);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      users,
      admins,
      byStatus,
      activeByTier,
      cancelledButActive,
      messagesBySource,
      messagesLast24h,
      tokens,
      freeUsage,
      paymentsByOutcome,
      revenue,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.groupBy({
        by: ['tier'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', cancelledAt: { not: null } } }),
      this.prisma.chatMessage.groupBy({ by: ['source'], _count: { _all: true } }),
      this.prisma.chatMessage.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.chatMessage.aggregate({ _sum: { totalTokens: true } }),
      this.prisma.monthlyUsage.aggregate({
        where: { period },
        _sum: { freeUsed: true },
        _count: { _all: true },
      }),
      this.prisma.paymentAttempt.groupBy({ by: ['success'], _count: { _all: true } }),
      this.prisma.paymentAttempt.aggregate({ where: { success: true }, _sum: { amount: true } }),
    ]);

    const toCounts = <T>(rows: (T & { _count: { _all: number } })[], key: (row: T) => string) =>
      Object.fromEntries(rows.map((row) => [key(row), row._count._all]));
    const statusCounts = toCounts(byStatus, (r) => r.status);
    const bySource = toCounts(messagesBySource, (r) => r.source);

    return {
      generatedAt: now.toISOString(),
      users: { total: users, admins },
      subscriptions: {
        active: statusCounts.ACTIVE ?? 0,
        inactive: statusCounts.INACTIVE ?? 0,
        cancelledButActive,
        activeByTier: toCounts(activeByTier, (r) => r.tier),
      },
      messages: {
        total: Object.values(bySource).reduce((sum, n) => sum + n, 0),
        last24h: messagesLast24h,
        bySource,
        totalTokens: tokens._sum.totalTokens ?? 0,
      },
      freeQuota: {
        period,
        messagesUsed: freeUsage._sum.freeUsed ?? 0,
        users: freeUsage._count._all,
      },
      payments: {
        succeeded: paymentsByOutcome.find((p) => p.success)?._count._all ?? 0,
        failed: paymentsByOutcome.find((p) => !p.success)?._count._all ?? 0,
        revenue: (revenue._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        currency: 'USD',
      },
    };
  }
}
