import { describe, expect, it } from 'vitest';
import {
  FREE_MESSAGES_PER_MONTH,
  nextPeriodStart,
  periodKey,
  selectQuotaSource,
  type QuotaBundle,
} from '../../../src/modules/chat/domain/entities/quota.js';

const NOW = new Date('2026-10-15T12:00:00Z');

function bundle(overrides: Partial<QuotaBundle> & { id: string }): QuotaBundle {
  return {
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    maxMessages: 10,
    usedMessages: 0,
    ...overrides,
  };
}

describe('period helpers', () => {
  it('uses a UTC year-month key', () => {
    expect(periodKey(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(periodKey(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });

  it('resets on the 1st of next month at 00:00 UTC, including across years', () => {
    expect(nextPeriodStart(NOW).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(nextPeriodStart(new Date('2026-12-20T00:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('selectQuotaSource', () => {
  it(`uses free quota first, up to ${FREE_MESSAGES_PER_MONTH} per month`, () => {
    const bundles = [bundle({ id: 'pro' })];
    expect(selectQuotaSource(0, bundles, NOW)).toEqual({ source: 'FREE', period: '2026-10' });
    expect(selectQuotaSource(2, bundles, NOW)).toEqual({ source: 'FREE', period: '2026-10' });
    expect(selectQuotaSource(3, bundles, NOW)).toEqual({
      source: 'SUBSCRIPTION',
      subscriptionId: 'pro',
    });
  });

  it('returns null when free quota is used and there are no bundles', () => {
    expect(selectQuotaSource(3, [], NOW)).toBeNull();
  });

  it('picks the bundle with the latest start date', () => {
    const older = bundle({ id: 'older', startDate: new Date('2026-10-01T00:00:00Z') });
    const newer = bundle({ id: 'newer', startDate: new Date('2026-10-10T00:00:00Z') });
    expect(selectQuotaSource(3, [older, newer], NOW)).toEqual({
      source: 'SUBSCRIPTION',
      subscriptionId: 'newer',
    });
  });

  it('falls back to an older bundle when the newest is used up', () => {
    const older = bundle({ id: 'older', startDate: new Date('2026-10-01T00:00:00Z') });
    const newer = bundle({
      id: 'newer',
      startDate: new Date('2026-10-10T00:00:00Z'),
      usedMessages: 10,
    });
    expect(selectQuotaSource(3, [older, newer], NOW)).toEqual({
      source: 'SUBSCRIPTION',
      subscriptionId: 'older',
    });
  });

  it('treats Enterprise (null) as unlimited', () => {
    const enterprise = bundle({ id: 'ent', maxMessages: null, usedMessages: 1_000_000 });
    expect(selectQuotaSource(3, [enterprise], NOW)).toEqual({
      source: 'SUBSCRIPTION',
      subscriptionId: 'ent',
    });
  });

  it('ignores inactive, expired and not-yet-started bundles', () => {
    const bundles = [
      bundle({ id: 'inactive', status: 'INACTIVE' }),
      bundle({ id: 'expired', endDate: new Date('2026-10-15T12:00:00Z') }),
      bundle({
        id: 'future',
        startDate: new Date('2026-10-20T00:00:00Z'),
        endDate: new Date('2026-11-20T00:00:00Z'),
      }),
    ];
    expect(selectQuotaSource(3, bundles, NOW)).toBeNull();
  });

  it('breaks start-date ties by the most recently created bundle', () => {
    const a = bundle({ id: 'a', createdAt: new Date('2026-10-01T00:00:00Z') });
    const b = bundle({ id: 'b', createdAt: new Date('2026-10-01T00:00:01Z') });
    expect(selectQuotaSource(3, [a, b], NOW)).toEqual({
      source: 'SUBSCRIPTION',
      subscriptionId: 'b',
    });
  });
});
