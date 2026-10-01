import {
  Subscription,
  type SubscriptionProps,
} from '../../src/modules/subscriptions/domain/entities/subscription.js';
import type {
  PaymentRecord,
  RenewalOutcome,
  SubscriptionRepository,
} from '../../src/modules/subscriptions/domain/ports.js';

/**
 * In-memory repository with the same semantics as the Prisma one, including
 * the guarded renewal update and settings updates that never touch usage.
 * Stores copies, so tests cannot accidentally share mutable state.
 */
export class InMemorySubscriptionRepository implements SubscriptionRepository {
  readonly rows = new Map<string, SubscriptionProps>();
  readonly payments: (PaymentRecord & { subscriptionId: string })[] = [];

  async create(subscription: Subscription, payment: PaymentRecord): Promise<void> {
    const s = subscription.snapshot();
    this.rows.set(s.id, { ...s });
    this.payments.push({ ...payment, subscriptionId: s.id });
  }

  async findById(id: string): Promise<Subscription | null> {
    const row = this.rows.get(id);
    return row ? Subscription.restore(row) : null;
  }

  async listByUser(userId: string): Promise<Subscription[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).map(Subscription.restore);
  }

  async listAll(limit: number): Promise<Subscription[]> {
    return [...this.rows.values()].slice(0, limit).map(Subscription.restore);
  }

  async updateSettings(subscription: Subscription): Promise<void> {
    const s = subscription.snapshot();
    const row = this.rows.get(s.id);
    if (!row) throw new Error('Subscription not found');
    this.rows.set(s.id, {
      ...row,
      autoRenew: s.autoRenew,
      cancelledAt: s.cancelledAt,
      status: s.status,
    });
  }

  async findDueForRenewal(now: Date, limit: number): Promise<Subscription[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === 'ACTIVE' && r.renewalDate <= now)
      .slice(0, limit)
      .map(Subscription.restore);
  }

  async applyRenewalResult(
    subscription: Subscription,
    expectedRenewalDate: Date,
    outcome: RenewalOutcome,
  ): Promise<boolean> {
    const s = subscription.snapshot();
    const row = this.rows.get(s.id);
    if (
      !row ||
      row.status !== 'ACTIVE' ||
      row.renewalDate.getTime() !== expectedRenewalDate.getTime()
    ) {
      return false;
    }
    this.rows.set(s.id, {
      ...row,
      status: s.status,
      startDate: s.startDate,
      endDate: s.endDate,
      renewalDate: s.renewalDate,
      usedMessages: outcome.renewed ? 0 : row.usedMessages,
    });
    if (outcome.payment) this.payments.push({ ...outcome.payment, subscriptionId: s.id });
    return true;
  }

  /** Test helper: simulate messages being used. */
  setUsedMessages(id: string, used: number): void {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, usedMessages: used });
  }
}
