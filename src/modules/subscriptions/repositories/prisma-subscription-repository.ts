import { Prisma, type PrismaClient, type Subscription as SubscriptionRow } from '@prisma/client';
import { Subscription } from '../domain/entities/subscription.js';
import type { PaymentRecord, RenewalOutcome, SubscriptionRepository } from '../domain/ports.js';

const toDecimal = (cents: number) => new Prisma.Decimal(cents).div(100);
const toCents = (amount: Prisma.Decimal) => amount.mul(100).toNumber();

function toDomain(row: SubscriptionRow): Subscription {
  return Subscription.restore({
    id: row.id,
    userId: row.userId,
    tier: row.tier,
    billingCycle: row.billingCycle,
    maxMessages: row.maxMessages,
    usedMessages: row.usedMessages,
    priceCents: toCents(row.price),
    startDate: row.startDate,
    endDate: row.endDate,
    renewalDate: row.renewalDate,
    autoRenew: row.autoRenew,
    status: row.status,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(subscription: Subscription, payment: PaymentRecord): Promise<void> {
    const s = subscription.snapshot();
    await this.prisma.$transaction([
      this.prisma.subscription.create({
        data: {
          id: s.id,
          userId: s.userId,
          tier: s.tier,
          billingCycle: s.billingCycle,
          maxMessages: s.maxMessages,
          usedMessages: s.usedMessages,
          price: toDecimal(s.priceCents),
          startDate: s.startDate,
          endDate: s.endDate,
          renewalDate: s.renewalDate,
          autoRenew: s.autoRenew,
          status: s.status,
          cancelledAt: s.cancelledAt,
          createdAt: s.createdAt,
        },
      }),
      this.prisma.paymentAttempt.create({
        data: {
          subscriptionId: s.id,
          amount: toDecimal(payment.amountCents),
          success: payment.success,
          failureReason: payment.failureReason,
        },
      }),
    ]);
  }

  async findById(id: string): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listByUser(userId: string): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async listAll(limit: number): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async updateSettings(subscription: Subscription): Promise<void> {
    const s = subscription.snapshot();
    // Deliberately excludes usedMessages: see the port's documentation.
    await this.prisma.subscription.update({
      where: { id: s.id },
      data: { autoRenew: s.autoRenew, cancelledAt: s.cancelledAt, status: s.status },
    });
  }

  async findDueForRenewal(now: Date, limit: number): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', renewalDate: { lte: now } },
      orderBy: { renewalDate: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async applyRenewalResult(
    subscription: Subscription,
    expectedRenewalDate: Date,
    outcome: RenewalOutcome,
  ): Promise<boolean> {
    const s = subscription.snapshot();

    return this.prisma.$transaction(async (tx) => {
      // Optimistic guard: only the run that still sees the expected state wins.
      const { count } = await tx.subscription.updateMany({
        where: { id: s.id, status: 'ACTIVE', renewalDate: expectedRenewalDate },
        data: {
          status: s.status,
          startDate: s.startDate,
          endDate: s.endDate,
          renewalDate: s.renewalDate,
          ...(outcome.renewed ? { usedMessages: 0 } : {}),
        },
      });
      if (count === 0) return false;

      if (outcome.payment) {
        await tx.paymentAttempt.create({
          data: {
            subscriptionId: s.id,
            amount: toDecimal(outcome.payment.amountCents),
            success: outcome.payment.success,
            failureReason: outcome.payment.failureReason,
          },
        });
      }
      return true;
    });
  }
}
