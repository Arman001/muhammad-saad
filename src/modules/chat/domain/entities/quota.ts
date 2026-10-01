/** Free messages every user gets per calendar month (UTC). */
export const FREE_MESSAGES_PER_MONTH = 3;

/** Usage period key, e.g. "2026-10". A new month means a new key, which is the reset. */
export function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** When the free quota resets: the 1st of next month, 00:00 UTC. */
export function nextPeriodStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/** The quota-relevant view of a subscription bundle. */
export interface QuotaBundle {
  readonly id: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly startDate: Date;
  readonly endDate: Date;
  readonly createdAt: Date;
  /** null means unlimited. */
  readonly maxMessages: number | null;
  readonly usedMessages: number;
}

export type QuotaReservation =
  | { readonly source: 'FREE'; readonly period: string }
  | { readonly source: 'SUBSCRIPTION'; readonly subscriptionId: string };

export function bundleHasQuota(bundle: QuotaBundle, now: Date): boolean {
  return (
    bundle.status === 'ACTIVE' &&
    bundle.startDate <= now &&
    now < bundle.endDate &&
    (bundle.maxMessages === null || bundle.usedMessages < bundle.maxMessages)
  );
}

/**
 * The quota rule, as a pure function:
 *  1. free monthly messages first;
 *  2. then the usable bundle with the latest start date (the "latest remaining quota");
 *  3. otherwise nothing is available.
 * The database ledger implements exactly this rule atomically in SQL.
 */
export function selectQuotaSource(
  freeUsed: number,
  bundles: readonly QuotaBundle[],
  now: Date,
): QuotaReservation | null {
  if (freeUsed < FREE_MESSAGES_PER_MONTH) {
    return { source: 'FREE', period: periodKey(now) };
  }
  const chosen = bundles
    .filter((bundle) => bundleHasQuota(bundle, now))
    .sort(
      (a, b) =>
        b.startDate.getTime() - a.startDate.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
  return chosen ? { source: 'SUBSCRIPTION', subscriptionId: chosen.id } : null;
}
