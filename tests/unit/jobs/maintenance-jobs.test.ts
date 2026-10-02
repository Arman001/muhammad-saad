import { describe, expect, it } from 'vitest';
import { createMaintenanceRunner } from '../../../src/jobs/maintenance-jobs.js';
import type { RenewalService } from '../../../src/modules/subscriptions/domain/services/renewal-service.js';
import { FixedClock } from '../../support/fixed-clock.js';
import { InMemoryNonceStore } from '../../support/in-memory-stores.js';

const summary = { renewed: 1, paymentFailed: 0, expired: 0, skipped: 0, errors: 0 };

describe('maintenance runner', () => {
  it('processes renewals and prunes only expired nonces', async () => {
    const clock = new FixedClock(new Date('2026-10-01T12:00:00Z'));
    const nonces = new InMemoryNonceStore();
    nonces.used.set('old', new Date('2026-10-01T11:00:00Z'));
    nonces.used.set('fresh', new Date('2026-10-01T11:59:00Z'));
    const renewals = { processDueRenewals: async () => summary } as unknown as RenewalService;

    const run = createMaintenanceRunner({ renewals, nonces, clock, nonceRetentionSeconds: 600 });
    const result = await run();

    expect(result).toEqual({ skipped: false, renewals: summary, noncesPruned: 1 });
    expect([...nonces.used.keys()]).toEqual(['fresh']);
  });

  it('never runs two passes at the same time', async () => {
    let release!: () => void;
    const renewals = {
      processDueRenewals: () => new Promise((resolve) => (release = () => resolve(summary))),
    } as unknown as RenewalService;
    const run = createMaintenanceRunner({
      renewals,
      nonces: new InMemoryNonceStore(),
      clock: new FixedClock(new Date()),
      nonceRetentionSeconds: 600,
    });

    const first = run();
    const second = await run();
    release();

    expect(second).toEqual({ skipped: true });
    expect((await first).skipped).toBe(false);
  });

  it('allows a new pass after the previous one failed', async () => {
    let fail = true;
    const renewals = {
      processDueRenewals: async () => {
        if (fail) throw new Error('database down');
        return summary;
      },
    } as unknown as RenewalService;
    const run = createMaintenanceRunner({
      renewals,
      nonces: new InMemoryNonceStore(),
      clock: new FixedClock(new Date()),
      nonceRetentionSeconds: 600,
    });

    await expect(run()).rejects.toThrow('database down');
    fail = false;
    expect((await run()).skipped).toBe(false);
  });
});
