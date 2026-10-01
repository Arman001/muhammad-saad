import type { Clock } from '../../../../shared/kernel/clock.js';
import type { Subscription } from '../entities/subscription.js';
import type { PaymentGateway, SubscriptionRepository } from '../ports.js';

export interface RenewalSummary {
  renewed: number;
  paymentFailed: number;
  expired: number;
  skipped: number;
  errors: number;
}

/**
 * Billing simulation. Called on a schedule; processes every ACTIVE subscription
 * whose renewal date has passed:
 *  - cancelled or auto-renew off: deactivated at the end of its period
 *  - otherwise charged: success starts a new period, failure deactivates it
 */
export class RenewalService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly payments: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  async processDueRenewals(batchSize = 100): Promise<RenewalSummary> {
    const now = this.clock.now();
    const summary: RenewalSummary = {
      renewed: 0,
      paymentFailed: 0,
      expired: 0,
      skipped: 0,
      errors: 0,
    };
    const due = await this.repository.findDueForRenewal(now, batchSize);

    for (const subscription of due) {
      try {
        const result = await this.processOne(subscription, now);
        summary[result] += 1;
      } catch {
        // One broken subscription must not stop the rest of the batch.
        summary.errors += 1;
      }
    }
    return summary;
  }

  private async processOne(
    subscription: Subscription,
    now: Date,
  ): Promise<'renewed' | 'paymentFailed' | 'expired' | 'skipped'> {
    if (!subscription.isDueForRenewal(now)) return 'skipped';
    const expectedRenewalDate = subscription.renewalDate;

    if (!subscription.shouldRenew()) {
      subscription.deactivate(now);
      const applied = await this.repository.applyRenewalResult(subscription, expectedRenewalDate, {
        renewed: false,
        payment: null,
      });
      return applied ? 'expired' : 'skipped';
    }

    const payment = await this.payments.charge({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      amountCents: subscription.priceCents,
      idempotencyKey: `renew:${subscription.id}:${expectedRenewalDate.toISOString()}`,
    });

    if (payment.success) {
      subscription.renew(now);
      const applied = await this.repository.applyRenewalResult(subscription, expectedRenewalDate, {
        renewed: true,
        payment: { amountCents: subscription.priceCents, success: true, failureReason: null },
      });
      return applied ? 'renewed' : 'skipped';
    }

    subscription.deactivate(now);
    const applied = await this.repository.applyRenewalResult(subscription, expectedRenewalDate, {
      renewed: false,
      payment: {
        amountCents: subscription.priceCents,
        success: false,
        failureReason: payment.reason,
      },
    });
    return applied ? 'paymentFailed' : 'skipped';
  }
}
