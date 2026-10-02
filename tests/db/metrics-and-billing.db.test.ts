import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createMaintenanceRunner } from '../../src/jobs/maintenance-jobs.js';
import { PrismaQuotaLedger } from '../../src/modules/chat/repositories/prisma-quota-ledger.js';
import { Subscription } from '../../src/modules/subscriptions/domain/entities/subscription.js';
import { RenewalService } from '../../src/modules/subscriptions/domain/services/renewal-service.js';
import { PrismaSubscriptionRepository } from '../../src/modules/subscriptions/repositories/prisma-subscription-repository.js';
import { PrismaNonceStore } from '../../src/shared/auth/prisma-nonce-store.js';
import { PrismaMetricsSource } from '../../src/shared/metrics/prisma-metrics-source.js';
import { FakePaymentGateway } from '../support/fake-payment-gateway.js';
import { FixedClock } from '../support/fixed-clock.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('billing job and metrics against PostgreSQL', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const subscriptions = new PrismaSubscriptionRepository(prisma);
  const START = new Date('2026-10-01T12:00:00Z');
  let userId: string;

  async function addBundle(autoRenew = true) {
    const s = Subscription.create(
      { id: crypto.randomUUID(), userId, tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew },
      START,
    );
    await subscriptions.create(s, {
      amountCents: s.priceCents,
      success: true,
      failureReason: null,
    });
    return s.id;
  }

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ChatMessage", "PaymentAttempt", "Subscription", "MonthlyUsage", "RequestNonce", "User" CASCADE',
    );
    userId = (await prisma.user.create({ data: { authSub: `auth0|${crypto.randomUUID()}` } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('renews, fails and expires subscriptions, and prunes old nonces, in one run', async () => {
    const renewing = await addBundle(true);
    const failing = await addBundle(true);
    const expiring = await addBundle(false);
    await prisma.requestNonce.create({
      data: { nonce: 'old-nonce', userId, createdAt: new Date('2026-10-01T00:00:00Z') },
    });

    const clock = new FixedClock(new Date('2026-11-01T12:05:00Z'));
    const payments = new FakePaymentGateway();
    // Due renewals are processed oldest renewal date first; all share one date, so fail by id.
    payments.charge = async (request) =>
      request.subscriptionId === failing
        ? { success: false, reason: 'Card declined (test)' }
        : { success: true };

    const run = createMaintenanceRunner({
      renewals: new RenewalService(subscriptions, payments, clock),
      nonces: new PrismaNonceStore(prisma),
      clock,
      nonceRetentionSeconds: 600,
    });
    const result = await run();

    expect(result.renewals).toMatchObject({ renewed: 1, paymentFailed: 1, expired: 1, errors: 0 });
    expect(result.noncesPruned).toBe(1);

    const rows = await prisma.subscription.findMany();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[renewing]?.status).toBe('ACTIVE');
    expect(byId[renewing]?.endDate.toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(byId[failing]?.status).toBe('INACTIVE');
    expect(byId[expiring]?.status).toBe('INACTIVE');

    const failedPayment = await prisma.paymentAttempt.findFirst({
      where: { subscriptionId: failing, success: false },
    });
    expect(failedPayment?.failureReason).toBe('Card declined (test)');
  });

  it('aggregates metrics in the database', async () => {
    await addBundle(true);
    const ledger = new PrismaQuotaLedger(prisma);
    const now = new Date('2026-10-15T12:00:00Z');
    for (let i = 0; i < 4; i += 1) await ledger.reserve(userId, now);

    const metrics = await new PrismaMetricsSource(prisma).collect(now);

    expect(metrics.users).toEqual({ total: 1, admins: 0 });
    expect(metrics.subscriptions).toMatchObject({ active: 1, activeByTier: { BASIC: 1 } });
    expect(metrics.freeQuota).toEqual({ period: '2026-10', messagesUsed: 3, users: 1 });
    expect(metrics.payments).toEqual({ succeeded: 1, failed: 0, revenue: '9.99', currency: 'USD' });
  });
});
