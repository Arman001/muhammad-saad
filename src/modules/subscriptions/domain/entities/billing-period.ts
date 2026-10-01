import type { BillingCycle } from './tier-catalog.js';

/**
 * Adds one billing period in UTC, keeping the time of day.
 * Month ends are clamped: Jan 31 + 1 month = Feb 28 (or 29), not Mar 3.
 */
export function addBillingPeriod(date: Date, cycle: BillingCycle): Date {
  const months = cycle === 'MONTHLY' ? 1 : 12;
  const originalDay = date.getUTCDate();

  const result = new Date(date.getTime());
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}
