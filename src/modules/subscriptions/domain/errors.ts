import { DomainError, NotFoundError } from '../../../shared/errors/index.js';

/**
 * Also used when the subscription exists but belongs to someone else,
 * so callers cannot discover other users' subscription IDs.
 */
export class SubscriptionNotFoundError extends NotFoundError {
  constructor() {
    super('Subscription not found.');
  }
}

export class SubscriptionAlreadyCancelledError extends DomainError {
  override readonly code = 'SUBSCRIPTION_ALREADY_CANCELLED';
  constructor() {
    super('This subscription has already been cancelled.');
  }
}

export class SubscriptionInactiveError extends DomainError {
  override readonly code = 'SUBSCRIPTION_INACTIVE';
  constructor() {
    super('This subscription is no longer active.');
  }
}

export class PaymentFailedError extends DomainError {
  override readonly code = 'PAYMENT_FAILED';
  constructor(reason: string) {
    super('Payment could not be processed. The subscription was not created.', { reason });
  }
}
