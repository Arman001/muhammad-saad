import { describe, expect, it } from 'vitest';
import { Subscription } from '../../../src/modules/subscriptions/domain/entities/subscription.js';
import {
  SubscriptionAlreadyCancelledError,
  SubscriptionInactiveError,
} from '../../../src/modules/subscriptions/domain/errors.js';

const NOW = new Date('2026-10-01T12:00:00Z');

function newSubscription(overrides: Partial<Parameters<typeof Subscription.create>[0]> = {}) {
  return Subscription.create(
    {
      id: 'sub-1',
      userId: 'user-1',
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
      ...overrides,
    },
    NOW,
  );
}

describe('Subscription.create', () => {
  it('copies allowance and price from the catalog', () => {
    const s = newSubscription({ tier: 'PRO', billingCycle: 'YEARLY' }).snapshot();
    expect(s.maxMessages).toBe(100);
    expect(s.priceCents).toBe(29_900);
  });

  it('starts now, ends one period later, and renews at the end', () => {
    const s = newSubscription().snapshot();
    expect(s.startDate).toEqual(NOW);
    expect(s.endDate.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(s.renewalDate).toEqual(s.endDate);
    expect(s.status).toBe('ACTIVE');
    expect(s.usedMessages).toBe(0);
    expect(s.cancelledAt).toBeNull();
  });

  it('gives Enterprise unlimited messages', () => {
    const s = newSubscription({ tier: 'ENTERPRISE' });
    expect(s.snapshot().maxMessages).toBeNull();
    expect(s.remainingMessages()).toBeNull();
    expect(s.hasRemainingMessages()).toBe(true);
  });
});

describe('usability', () => {
  it('is usable within its period while messages remain', () => {
    expect(newSubscription().isUsable(NOW)).toBe(true);
  });

  it('is not usable once all messages are used', () => {
    const s = Subscription.restore({ ...newSubscription().snapshot(), usedMessages: 10 });
    expect(s.remainingMessages()).toBe(0);
    expect(s.isUsable(NOW)).toBe(false);
  });

  it('is not usable after its end date', () => {
    const s = newSubscription();
    expect(s.isUsable(new Date('2026-11-01T12:00:00Z'))).toBe(false);
  });

  it('is not usable when inactive', () => {
    const s = newSubscription();
    s.deactivate(NOW);
    expect(s.isUsable(NOW)).toBe(false);
  });

  it('stays usable until the period ends even after cancellation', () => {
    const s = newSubscription();
    s.cancel(NOW);
    expect(s.isUsable(new Date('2026-10-20T00:00:00Z'))).toBe(true);
  });
});

describe('cancel', () => {
  it('turns off auto-renew and records the time, but stays active', () => {
    const s = newSubscription();
    s.cancel(NOW);
    const snap = s.snapshot();
    expect(snap.autoRenew).toBe(false);
    expect(snap.cancelledAt).toEqual(NOW);
    expect(snap.status).toBe('ACTIVE');
    expect(s.shouldRenew()).toBe(false);
  });

  it('cannot be cancelled twice', () => {
    const s = newSubscription();
    s.cancel(NOW);
    expect(() => s.cancel(NOW)).toThrow(SubscriptionAlreadyCancelledError);
  });

  it('cannot cancel an inactive subscription', () => {
    const s = newSubscription();
    s.deactivate(NOW);
    expect(() => s.cancel(NOW)).toThrow(SubscriptionInactiveError);
  });
});

describe('setAutoRenew', () => {
  it('toggles auto-renew', () => {
    const s = newSubscription();
    s.setAutoRenew(false, NOW);
    expect(s.shouldRenew()).toBe(false);
    s.setAutoRenew(true, NOW);
    expect(s.shouldRenew()).toBe(true);
  });

  it('refuses to re-enable auto-renew after cancellation', () => {
    const s = newSubscription();
    s.cancel(NOW);
    expect(() => s.setAutoRenew(true, NOW)).toThrow(SubscriptionAlreadyCancelledError);
  });

  it('refuses changes on an inactive subscription', () => {
    const s = newSubscription();
    s.deactivate(NOW);
    expect(() => s.setAutoRenew(false, NOW)).toThrow(SubscriptionInactiveError);
  });
});

describe('renew', () => {
  it('starts the next back-to-back period and resets usage', () => {
    const s = Subscription.restore({ ...newSubscription().snapshot(), usedMessages: 7 });
    const renewalTime = new Date('2026-11-01T12:05:00Z');

    s.renew(renewalTime);
    const snap = s.snapshot();

    expect(snap.startDate.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(snap.endDate.toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(snap.renewalDate).toEqual(snap.endDate);
    expect(snap.usedMessages).toBe(0);
  });

  it('starts from now if renewal ran so late the next period would already be over', () => {
    const s = newSubscription();
    const veryLate = new Date('2027-03-01T00:00:00Z');

    s.renew(veryLate);

    expect(s.snapshot().startDate).toEqual(veryLate);
    expect(s.snapshot().endDate.toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });

  it('refuses to renew a cancelled subscription', () => {
    const s = newSubscription();
    s.cancel(NOW);
    expect(() => s.renew(NOW)).toThrow(SubscriptionAlreadyCancelledError);
  });

  it('is due for renewal only once the renewal date has passed', () => {
    const s = newSubscription();
    expect(s.isDueForRenewal(new Date('2026-10-31T23:59:59Z'))).toBe(false);
    expect(s.isDueForRenewal(new Date('2026-11-01T12:00:00Z'))).toBe(true);
  });
});
