import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaQuotaLedger } from '../../src/modules/chat/repositories/prisma-quota-ledger.js';
import { Subscription } from '../../src/modules/subscriptions/domain/entities/subscription.js';
import { PrismaSubscriptionRepository } from '../../src/modules/subscriptions/repositories/prisma-subscription-repository.js';

/**
 * Runs against a real PostgreSQL database, because only a real database can
 * prove that quota deduction is atomic under concurrent requests.
 * Skipped unless TEST_DATABASE_URL is set (see `pnpm test:db` in the README).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PrismaQuotaLedger against PostgreSQL', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const ledger = new PrismaQuotaLedger(prisma);
  const subscriptions = new PrismaSubscriptionRepository(prisma);
  const NOW = new Date('2026-10-15T12:00:00Z');
  let userId: string;

  async function addBundle(
    tier: 'BASIC' | 'PRO' | 'ENTERPRISE',
    startedAt = new Date('2026-10-01T00:00:00Z'),
  ): Promise<string> {
    const s = Subscription.create(
      { id: crypto.randomUUID(), userId, tier, billingCycle: 'MONTHLY', autoRenew: true },
      startedAt,
    );
    await subscriptions.create(s, {
      amountCents: s.priceCents,
      success: true,
      failureReason: null,
    });
    return s.id;
  }

  async function reserveConcurrently(count: number) {
    return Promise.all(Array.from({ length: count }, () => ledger.reserve(userId, NOW)));
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

  it('grants exactly 3 free messages to 20 simultaneous requests', async () => {
    const results = await reserveConcurrently(20);

    expect(results.filter((r) => r?.source === 'FREE')).toHaveLength(3);
    expect(results.filter((r) => r === null)).toHaveLength(17);
    const usage = await prisma.monthlyUsage.findUniqueOrThrow({
      where: { userId_period: { userId, period: '2026-10' } },
    });
    expect(usage.freeUsed).toBe(3);
  });

  it('never oversells a bundle: 3 free + 10 Basic out of 30 simultaneous requests', async () => {
    const basic = await addBundle('BASIC');

    const results = await reserveConcurrently(30);

    expect(results.filter((r) => r?.source === 'FREE')).toHaveLength(3);
    expect(results.filter((r) => r?.source === 'SUBSCRIPTION')).toHaveLength(10);
    expect(results.filter((r) => r === null)).toHaveLength(17);
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: basic } });
    expect(row.usedMessages).toBe(10);
  });

  it('drains the newest bundle first, then older ones, under concurrency', async () => {
    const older = await addBundle('BASIC', new Date('2026-10-01T00:00:00Z'));
    const newer = await addBundle('BASIC', new Date('2026-10-05T00:00:00Z'));

    const results = await reserveConcurrently(25);

    const paid = results.filter((r) => r?.source === 'SUBSCRIPTION');
    expect(paid).toHaveLength(20);
    expect(results.filter((r) => r === null)).toHaveLength(2);
    const [olderRow, newerRow] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { id: older } }),
      prisma.subscription.findUniqueOrThrow({ where: { id: newer } }),
    ]);
    expect(newerRow.usedMessages).toBe(10);
    expect(olderRow.usedMessages).toBe(10);
  });

  it('takes from the newest bundle while it has quota', async () => {
    await addBundle('BASIC', new Date('2026-10-01T00:00:00Z'));
    const newer = await addBundle('PRO', new Date('2026-10-05T00:00:00Z'));
    for (let i = 0; i < 3; i += 1) await ledger.reserve(userId, NOW);

    const reservation = await ledger.reserve(userId, NOW);

    expect(reservation).toEqual({ source: 'SUBSCRIPTION', subscriptionId: newer });
  });

  it('treats Enterprise as unlimited', async () => {
    const enterprise = await addBundle('ENTERPRISE');

    const results = await reserveConcurrently(40);

    expect(results.every((r) => r !== null)).toBe(true);
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: enterprise } });
    expect(row.usedMessages).toBe(37);
  });

  it('ignores inactive and expired bundles', async () => {
    const inactive = await addBundle('PRO');
    await prisma.subscription.update({ where: { id: inactive }, data: { status: 'INACTIVE' } });
    await addBundle('PRO', new Date('2026-08-01T00:00:00Z')); // ended 2026-09-01

    for (let i = 0; i < 3; i += 1) await ledger.reserve(userId, NOW);
    expect(await ledger.reserve(userId, NOW)).toBeNull();
  });

  it('resets free quota in a new calendar month', async () => {
    for (let i = 0; i < 3; i += 1) await ledger.reserve(userId, NOW);
    expect(await ledger.reserve(userId, NOW)).toBeNull();

    const nextMonth = await ledger.reserve(userId, new Date('2026-11-01T00:00:00Z'));

    expect(nextMonth).toEqual({ source: 'FREE', period: '2026-11' });
  });

  it('releases a reservation back to its source', async () => {
    const basic = await addBundle('BASIC');
    for (let i = 0; i < 3; i += 1) await ledger.reserve(userId, NOW);
    const paid = (await ledger.reserve(userId, NOW))!;

    await ledger.release(userId, paid);
    await ledger.release(userId, { source: 'FREE', period: '2026-10' });

    const usage = await ledger.usage(userId, NOW);
    expect(usage.freeUsed).toBe(2);
    expect(usage.bundles).toEqual([
      expect.objectContaining({ subscriptionId: basic, remaining: 10 }),
    ]);
  });

  it('keeps concurrent usage when a settings change is saved from a stale copy', async () => {
    const basic = await addBundle('BASIC');
    const stale = (await subscriptions.findById(basic))!;
    for (let i = 0; i < 3; i += 1) await ledger.reserve(userId, NOW);
    await Promise.all([ledger.reserve(userId, NOW), ledger.reserve(userId, NOW)]);

    stale.cancel(NOW);
    await subscriptions.updateSettings(stale);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: basic } });
    expect(row.usedMessages).toBe(2);
    expect(row.autoRenew).toBe(false);
  });
});
