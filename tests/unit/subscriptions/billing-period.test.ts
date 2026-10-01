import { describe, expect, it } from 'vitest';
import { addBillingPeriod } from '../../../src/modules/subscriptions/domain/entities/billing-period.js';

describe('addBillingPeriod', () => {
  it('adds one month, keeping day and time', () => {
    const result = addBillingPeriod(new Date('2026-03-15T10:30:00Z'), 'MONTHLY');
    expect(result.toISOString()).toBe('2026-04-15T10:30:00.000Z');
  });

  it('adds one year', () => {
    const result = addBillingPeriod(new Date('2026-03-15T10:30:00Z'), 'YEARLY');
    expect(result.toISOString()).toBe('2027-03-15T10:30:00.000Z');
  });

  it('clamps to the last day of a shorter month', () => {
    expect(addBillingPeriod(new Date('2026-01-31T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('handles leap years', () => {
    expect(addBillingPeriod(new Date('2028-01-31T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(addBillingPeriod(new Date('2028-02-29T00:00:00Z'), 'YEARLY').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });

  it('rolls over the year from December', () => {
    expect(addBillingPeriod(new Date('2026-12-10T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2027-01-10T00:00:00.000Z',
    );
  });
});
