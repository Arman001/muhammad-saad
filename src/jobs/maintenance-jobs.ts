import type {
  RenewalService,
  RenewalSummary,
} from '../modules/subscriptions/domain/services/renewal-service.js';
import type { NonceStore } from '../shared/auth/ports.js';
import type { Clock } from '../shared/kernel/clock.js';

export interface MaintenanceResult {
  readonly skipped: boolean;
  readonly renewals?: RenewalSummary;
  readonly noncesPruned?: number;
}

export interface MaintenanceDependencies {
  readonly renewals: RenewalService;
  readonly nonces: NonceStore;
  readonly clock: Clock;
  /** Nonces older than this are useless: their timestamps would be rejected anyway. */
  readonly nonceRetentionSeconds: number;
}

/**
 * One maintenance run: process due subscription renewals, then delete expired
 * nonces. Runs never overlap: if a run is still going when the next tick
 * arrives, that tick is skipped.
 */
export function createMaintenanceRunner(deps: MaintenanceDependencies) {
  let running = false;

  return async function runMaintenance(): Promise<MaintenanceResult> {
    if (running) return { skipped: true };
    running = true;
    try {
      const renewals = await deps.renewals.processDueRenewals();
      const cutoff = new Date(deps.clock.now().getTime() - deps.nonceRetentionSeconds * 1000);
      const noncesPruned = await deps.nonces.pruneOlderThan(cutoff);
      return { skipped: false, renewals, noncesPruned };
    } finally {
      running = false;
    }
  };
}
