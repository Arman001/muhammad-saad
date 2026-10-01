import type { Subscription } from './entities/subscription.js';

export interface PaymentRecord {
  readonly amountCents: number;
  readonly success: boolean;
  readonly failureReason: string | null;
}

export interface RenewalOutcome {
  /** True when a new period started, so the message count is reset. */
  readonly renewed: boolean;
  /** Payment attempt to record, or null when no charge was made (expiry). */
  readonly payment: PaymentRecord | null;
}

export interface SubscriptionRepository {
  /** Stores a new subscription together with its initial payment, atomically. */
  create(subscription: Subscription, payment: PaymentRecord): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  listByUser(userId: string): Promise<Subscription[]>;
  listAll(limit: number): Promise<Subscription[]>;
  /**
   * Persists user-driven changes (auto-renew, cancellation).
   * Never writes the message count, which only changes through atomic usage
   * updates and renewal, so concurrent chat requests cannot be overwritten.
   */
  updateSettings(subscription: Subscription): Promise<void>;
  findDueForRenewal(now: Date, limit: number): Promise<Subscription[]>;
  /**
   * Applies a renewal result and records the payment in one transaction.
   * Only applies if the subscription is still ACTIVE with the expected
   * renewal date, so two billing runs cannot process the same renewal twice.
   * Returns false if it was already handled.
   */
  applyRenewalResult(
    subscription: Subscription,
    expectedRenewalDate: Date,
    outcome: RenewalOutcome,
  ): Promise<boolean>;
}

export interface PaymentRequest {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly amountCents: number;
  /** Lets a real gateway refuse to charge the same thing twice. */
  readonly idempotencyKey: string;
}

export type PaymentResult =
  { readonly success: true } | { readonly success: false; readonly reason: string };

export interface PaymentGateway {
  charge(request: PaymentRequest): Promise<PaymentResult>;
}
