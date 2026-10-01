import type { PaymentGateway, PaymentRequest, PaymentResult } from '../domain/ports.js';

const FAILURE_REASONS = ['Card declined', 'Insufficient funds', 'Card expired'] as const;

/**
 * Stand-in for a real payment provider. Fails randomly at the configured rate.
 * The random source is injectable so tests can make outcomes deterministic.
 */
export class SimulatedPaymentGateway implements PaymentGateway {
  constructor(
    private readonly failureRate: number,
    private readonly random: () => number = Math.random,
  ) {}

  async charge(_request: PaymentRequest): Promise<PaymentResult> {
    if (this.random() < this.failureRate) {
      const reason =
        FAILURE_REASONS[Math.floor(this.random() * FAILURE_REASONS.length)] ?? 'Card declined';
      return { success: false, reason: `${reason} (simulated)` };
    }
    return { success: true };
  }
}
