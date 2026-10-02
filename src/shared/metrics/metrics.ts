/** System-wide figures for administrators. */
export interface SystemMetrics {
  readonly generatedAt: string;
  readonly users: { readonly total: number; readonly admins: number };
  readonly subscriptions: {
    readonly active: number;
    readonly inactive: number;
    readonly cancelledButActive: number;
    readonly activeByTier: Readonly<Record<string, number>>;
  };
  readonly messages: {
    readonly total: number;
    readonly last24h: number;
    readonly bySource: Readonly<Record<string, number>>;
    readonly totalTokens: number;
  };
  readonly freeQuota: {
    readonly period: string;
    readonly messagesUsed: number;
    readonly users: number;
  };
  readonly payments: {
    readonly succeeded: number;
    readonly failed: number;
    readonly revenue: string;
    readonly currency: 'USD';
  };
}

export interface MetricsSource {
  collect(now: Date): Promise<SystemMetrics>;
}
