import type {
  PaymentGateway,
  PaymentRequest,
  PaymentResult,
} from '../../src/modules/subscriptions/domain/ports.js';

/** Payment gateway with scripted outcomes. Records every charge for assertions. */
export class FakePaymentGateway implements PaymentGateway {
  readonly charges: PaymentRequest[] = [];
  private queued: PaymentResult[] = [];
  private fallback: PaymentResult = { success: true };

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    this.charges.push(request);
    return this.queued.shift() ?? this.fallback;
  }

  alwaysSucceed(): void {
    this.fallback = { success: true };
  }

  alwaysFail(reason = 'Card declined (test)'): void {
    this.fallback = { success: false, reason };
  }

  /** The next charge fails; later ones use the fallback. */
  failNext(reason = 'Card declined (test)'): void {
    this.queued.push({ success: false, reason });
  }
}
