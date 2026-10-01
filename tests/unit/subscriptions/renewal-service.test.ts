import { beforeEach, describe, expect, it } from 'vitest';
import { Subscription } from '../../../src/modules/subscriptions/domain/entities/subscription.js';
import { RenewalService } from '../../../src/modules/subscriptions/domain/services/renewal-service.js';
import { FakePaymentGateway } from '../../support/fake-payment-gateway.js';
import { FixedClock } from '../../support/fixed-clock.js';
import { InMemorySubscriptionRepository } from '../../support/in-memory-subscription-repository.js';

const START = new Date('2026-10-01T12:00:00Z');
const AFTER_FIRST_PERIOD = new Date('2026-11-01T12:01:00Z');

describe('RenewalService', () => {
  let repository: InMemorySubscriptionRepository;
  let payments: FakePaymentGateway;
  let clock: FixedClock;
  let service: RenewalService;

  async function seed(options: { autoRenew?: boolean; cancel?: boolean; used?: number } = {}) {
    const s = Subscription.create(
      {
        id: crypto.randomUUID(),
        userId: 'user-1',
        tier: 'BASIC',
        billingCycle: 'MONTHLY',
        autoRenew: options.autoRenew ?? true,
      },
      START,
    );
    if (options.cancel) s.cancel(START);
    await repository.create(s, { amountCents: 999, success: true, failureReason: null });
    if (options.used) repository.setUsedMessages(s.id, options.used);
    return s.id;
  }

  beforeEach(() => {
    repository = new InMemorySubscriptionRepository();
    payments = new FakePaymentGateway();
    clock = new FixedClock(START);
    service = new RenewalService(repository, payments, clock);
  });

  it('does nothing before the renewal date', async () => {
    await seed();
    const summary = await service.processDueRenewals();
    expect(summary.renewed).toBe(0);
    expect(payments.charges).toHaveLength(0);
  });

  it('renews with a successful payment: new period, usage reset, payment recorded', async () => {
    const id = await seed({ used: 8 });
    clock.set(AFTER_FIRST_PERIOD);

    const summary = await service.processDueRenewals();

    expect(summary).toMatchObject({ renewed: 1, paymentFailed: 0, expired: 0 });
    const row = repository.rows.get(id)!;
    expect(row.status).toBe('ACTIVE');
    expect(row.usedMessages).toBe(0);
    expect(row.endDate.toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(repository.payments.at(-1)).toMatchObject({
      subscriptionId: id,
      success: true,
      amountCents: 999,
    });
  });

  it('deactivates on a failed payment and records the failure reason', async () => {
    const id = await seed({ used: 3 });
    clock.set(AFTER_FIRST_PERIOD);
    payments.failNext('Insufficient funds (test)');

    const summary = await service.processDueRenewals();

    expect(summary.paymentFailed).toBe(1);
    const row = repository.rows.get(id)!;
    expect(row.status).toBe('INACTIVE');
    expect(row.usedMessages).toBe(3);
    expect(repository.payments.at(-1)).toMatchObject({
      success: false,
      failureReason: 'Insufficient funds (test)',
    });
  });

  it('lets a cancelled subscription expire without charging', async () => {
    const id = await seed({ cancel: true });
    clock.set(AFTER_FIRST_PERIOD);

    const summary = await service.processDueRenewals();

    expect(summary.expired).toBe(1);
    expect(repository.rows.get(id)!.status).toBe('INACTIVE');
    expect(payments.charges).toHaveLength(0);
  });

  it('lets a subscription with auto-renew off expire without charging', async () => {
    const id = await seed({ autoRenew: false });
    clock.set(AFTER_FIRST_PERIOD);

    await service.processDueRenewals();

    expect(repository.rows.get(id)!.status).toBe('INACTIVE');
    expect(payments.charges).toHaveLength(0);
  });

  it('never processes the same renewal twice', async () => {
    await seed();
    clock.set(AFTER_FIRST_PERIOD);

    await service.processDueRenewals();
    const second = await service.processDueRenewals();

    expect(second.renewed).toBe(0);
    expect(payments.charges).toHaveLength(1);
  });

  it('sends an idempotency key unique to the subscription and period', async () => {
    const id = await seed();
    clock.set(AFTER_FIRST_PERIOD);

    await service.processDueRenewals();

    expect(payments.charges[0]?.idempotencyKey).toBe(`renew:${id}:2026-11-01T12:00:00.000Z`);
  });

  it('continues the batch when one subscription fails unexpectedly', async () => {
    await seed();
    await seed();
    clock.set(AFTER_FIRST_PERIOD);
    let calls = 0;
    payments.charge = async () => {
      calls += 1;
      if (calls === 1) throw new Error('Gateway timeout');
      return { success: true };
    };

    const summary = await service.processDueRenewals();

    expect(summary.errors).toBe(1);
    expect(summary.renewed).toBe(1);
  });
});
