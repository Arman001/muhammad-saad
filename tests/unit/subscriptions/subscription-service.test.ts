import { beforeEach, describe, expect, it } from 'vitest';
import {
  PaymentFailedError,
  SubscriptionNotFoundError,
} from '../../../src/modules/subscriptions/domain/errors.js';
import { SubscriptionService } from '../../../src/modules/subscriptions/domain/services/subscription-service.js';
import type { Actor } from '../../../src/shared/kernel/actor.js';
import { FakePaymentGateway } from '../../support/fake-payment-gateway.js';
import { FixedClock } from '../../support/fixed-clock.js';
import { InMemorySubscriptionRepository } from '../../support/in-memory-subscription-repository.js';

const alice: Actor = { userId: 'alice', role: 'USER' };
const bob: Actor = { userId: 'bob', role: 'USER' };
const admin: Actor = { userId: 'admin', role: 'ADMIN' };

describe('SubscriptionService', () => {
  let repository: InMemorySubscriptionRepository;
  let payments: FakePaymentGateway;
  let service: SubscriptionService;

  beforeEach(() => {
    repository = new InMemorySubscriptionRepository();
    payments = new FakePaymentGateway();
    service = new SubscriptionService(
      repository,
      payments,
      new FixedClock(new Date('2026-10-01T00:00:00Z')),
    );
  });

  it('charges the first period and stores the subscription with its payment', async () => {
    const created = await service.create(alice, {
      tier: 'PRO',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });

    expect(payments.charges[0]).toMatchObject({ userId: 'alice', amountCents: 2_999 });
    expect(repository.rows.has(created.id)).toBe(true);
    expect(repository.payments).toHaveLength(1);
  });

  it('creates nothing when the first payment fails', async () => {
    payments.failNext();

    await expect(
      service.create(alice, { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true }),
    ).rejects.toThrow(PaymentFailedError);
    expect(repository.rows.size).toBe(0);
  });

  it('lets users list only their own subscriptions', async () => {
    await service.create(alice, { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    await service.create(bob, { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });

    const list = await service.list(alice);
    expect(list).toHaveLength(1);
    expect(list[0]?.userId).toBe('alice');
  });

  it('lets admins list every subscription', async () => {
    await service.create(alice, { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    await service.create(bob, { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });

    expect(await service.list(admin)).toHaveLength(2);
  });

  it("hides another user's subscription as not found (domain policy)", async () => {
    const created = await service.create(alice, {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });

    await expect(service.get(bob, created.id)).rejects.toThrow(SubscriptionNotFoundError);
    await expect(service.cancel(bob, created.id)).rejects.toThrow(SubscriptionNotFoundError);
    await expect(service.setAutoRenew(bob, created.id, false)).rejects.toThrow(
      SubscriptionNotFoundError,
    );
  });

  it('lets an admin access any subscription', async () => {
    const created = await service.create(alice, {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    await expect(service.get(admin, created.id)).resolves.toBeDefined();
  });

  it('never overwrites usage recorded concurrently while settings change', async () => {
    const created = await service.create(alice, {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });

    // A settings change loads the subscription (usage 0)...
    const stale = (await repository.findById(created.id))!;
    // ...meanwhile chat requests use 4 messages...
    repository.setUsedMessages(created.id, 4);
    // ...then the settings change is saved from the stale copy.
    stale.setAutoRenew(false, new Date('2026-10-01T00:00:00Z'));
    await repository.updateSettings(stale);

    expect(repository.rows.get(created.id)?.usedMessages).toBe(4);
  });
});
