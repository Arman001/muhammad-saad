import { randomUUID } from 'node:crypto';
import { isAdmin, type Actor } from '../../../../shared/kernel/actor.js';
import type { Clock } from '../../../../shared/kernel/clock.js';
import { Subscription } from '../entities/subscription.js';
import type { BillingCycle, Tier } from '../entities/tier-catalog.js';
import { PaymentFailedError, SubscriptionNotFoundError } from '../errors.js';
import { canAccessSubscription } from '../policies/subscription-policy.js';
import type { PaymentGateway, SubscriptionRepository } from '../ports.js';

export interface CreateSubscriptionInput {
  readonly tier: Tier;
  readonly billingCycle: BillingCycle;
  readonly autoRenew: boolean;
}

const ADMIN_LIST_LIMIT = 100;

/** Use cases for managing subscription bundles. */
export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly payments: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  /** Creates a bundle for the caller. The first period is charged up front. */
  async create(actor: Actor, input: CreateSubscriptionInput): Promise<Subscription> {
    const now = this.clock.now();
    const subscription = Subscription.create(
      { id: randomUUID(), userId: actor.userId, ...input },
      now,
    );

    const payment = await this.payments.charge({
      subscriptionId: subscription.id,
      userId: actor.userId,
      amountCents: subscription.priceCents,
      idempotencyKey: `create:${subscription.id}`,
    });
    if (!payment.success) {
      throw new PaymentFailedError(payment.reason);
    }

    await this.repository.create(subscription, {
      amountCents: subscription.priceCents,
      success: true,
      failureReason: null,
    });
    return subscription;
  }

  /** Users see their own subscriptions; admins see all (newest first, capped). */
  async list(actor: Actor): Promise<Subscription[]> {
    return isAdmin(actor)
      ? this.repository.listAll(ADMIN_LIST_LIMIT)
      : this.repository.listByUser(actor.userId);
  }

  async get(actor: Actor, id: string): Promise<Subscription> {
    return this.loadAccessible(actor, id);
  }

  async setAutoRenew(actor: Actor, id: string, enabled: boolean): Promise<Subscription> {
    const subscription = await this.loadAccessible(actor, id);
    subscription.setAutoRenew(enabled, this.clock.now());
    await this.repository.updateSettings(subscription);
    return subscription;
  }

  async cancel(actor: Actor, id: string): Promise<Subscription> {
    const subscription = await this.loadAccessible(actor, id);
    subscription.cancel(this.clock.now());
    await this.repository.updateSettings(subscription);
    return subscription;
  }

  /** Not found and not allowed look identical to the caller. */
  private async loadAccessible(actor: Actor, id: string): Promise<Subscription> {
    const subscription = await this.repository.findById(id);
    if (!subscription || !canAccessSubscription(actor, subscription)) {
      throw new SubscriptionNotFoundError();
    }
    return subscription;
  }
}
