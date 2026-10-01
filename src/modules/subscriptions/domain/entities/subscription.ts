import { SubscriptionAlreadyCancelledError, SubscriptionInactiveError } from '../errors.js';
import { addBillingPeriod } from './billing-period.js';
import { TIER_CATALOG, type BillingCycle, type Tier } from './tier-catalog.js';

export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE';

export interface SubscriptionProps {
  readonly id: string;
  readonly userId: string;
  readonly tier: Tier;
  readonly billingCycle: BillingCycle;
  /** null means unlimited (Enterprise). */
  readonly maxMessages: number | null;
  usedMessages: number;
  readonly priceCents: number;
  startDate: Date;
  endDate: Date;
  renewalDate: Date;
  autoRenew: boolean;
  status: SubscriptionStatus;
  cancelledAt: Date | null;
  readonly createdAt: Date;
  updatedAt: Date;
}

export interface NewSubscription {
  readonly id: string;
  readonly userId: string;
  readonly tier: Tier;
  readonly billingCycle: BillingCycle;
  readonly autoRenew: boolean;
}

/**
 * A subscription bundle and its lifecycle rules. All state changes go through
 * methods here, so the rules live in one place and are unit-testable.
 */
export class Subscription {
  private constructor(private readonly props: SubscriptionProps) {}

  /** Starts a new bundle now. Message allowance and price are copied from the catalog. */
  static create(input: NewSubscription, now: Date): Subscription {
    const definition = TIER_CATALOG[input.tier];
    const endDate = addBillingPeriod(now, input.billingCycle);
    return new Subscription({
      id: input.id,
      userId: input.userId,
      tier: input.tier,
      billingCycle: input.billingCycle,
      maxMessages: definition.maxMessages,
      usedMessages: 0,
      priceCents: definition.priceCents[input.billingCycle],
      startDate: now,
      endDate,
      renewalDate: endDate,
      autoRenew: input.autoRenew,
      status: 'ACTIVE',
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Rebuilds an existing subscription from storage. */
  static restore(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get priceCents(): number {
    return this.props.priceCents;
  }
  get renewalDate(): Date {
    return this.props.renewalDate;
  }
  get status(): SubscriptionStatus {
    return this.props.status;
  }
  get isCancelled(): boolean {
    return this.props.cancelledAt !== null;
  }

  /** A read-only copy of the current state, for persistence and API responses. */
  snapshot(): Readonly<SubscriptionProps> {
    return { ...this.props };
  }

  /** Messages left in the current period. null means unlimited. */
  remainingMessages(): number | null {
    if (this.props.maxMessages === null) return null;
    return Math.max(0, this.props.maxMessages - this.props.usedMessages);
  }

  hasRemainingMessages(): boolean {
    const remaining = this.remainingMessages();
    return remaining === null || remaining > 0;
  }

  /** Can this bundle pay for a chat message right now? */
  isUsable(now: Date): boolean {
    return (
      this.props.status === 'ACTIVE' &&
      now >= this.props.startDate &&
      now < this.props.endDate &&
      this.hasRemainingMessages()
    );
  }

  isDueForRenewal(now: Date): boolean {
    return this.props.status === 'ACTIVE' && now >= this.props.renewalDate;
  }

  /** Renews only if auto-renew is on and the subscription was not cancelled. */
  shouldRenew(): boolean {
    return this.props.autoRenew && !this.isCancelled;
  }

  /**
   * Cancels: stops future renewals but keeps the subscription usable until the
   * end of the current period. History is never deleted.
   */
  cancel(now: Date): void {
    if (this.isCancelled) throw new SubscriptionAlreadyCancelledError();
    if (this.props.status !== 'ACTIVE') throw new SubscriptionInactiveError();
    this.props.autoRenew = false;
    this.props.cancelledAt = now;
    this.props.updatedAt = now;
  }

  setAutoRenew(enabled: boolean, now: Date): void {
    if (this.props.status !== 'ACTIVE') throw new SubscriptionInactiveError();
    if (enabled && this.isCancelled) throw new SubscriptionAlreadyCancelledError();
    this.props.autoRenew = enabled;
    this.props.updatedAt = now;
  }

  /** Starts the next billing period after a successful payment. */
  renew(now: Date): void {
    if (this.props.status !== 'ACTIVE') throw new SubscriptionInactiveError();
    if (!this.shouldRenew()) throw new SubscriptionAlreadyCancelledError();

    // Periods are back-to-back. If renewal ran very late, start from now instead
    // of creating a period that is already over.
    let start = this.props.endDate;
    let end = addBillingPeriod(start, this.props.billingCycle);
    if (end <= now) {
      start = now;
      end = addBillingPeriod(now, this.props.billingCycle);
    }

    this.props.startDate = start;
    this.props.endDate = end;
    this.props.renewalDate = end;
    this.props.usedMessages = 0;
    this.props.updatedAt = now;
  }

  /** Ends the subscription: period over without renewal, or payment failed. */
  deactivate(now: Date): void {
    this.props.status = 'INACTIVE';
    this.props.updatedAt = now;
  }
}
