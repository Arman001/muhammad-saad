import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/env.js';
import { RateLimitedError, UnauthorizedError } from '../errors/index.js';

export type RouteGroup = 'auth' | 'chat' | 'subscriptions';

interface LimiterOptions {
  readonly windowMs: number;
  readonly limit: number;
  readonly scope: string;
  readonly perUser: boolean;
}

function createLimiter({ windowMs, limit, scope, perUser }: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    // Standard RateLimit / RateLimit-Policy headers; Retry-After when limited.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: scope,
    // Per-user limits are keyed by the internal user ID from the verified token,
    // so switching IP addresses does not reset them. Per-IP limits use the
    // library's default key, which also groups IPv6 addresses by subnet.
    ...(perUser
      ? {
          keyGenerator: (req) => {
            if (!req.auth) throw new UnauthorizedError();
            return `${scope}:user:${req.auth.userId}`;
          },
        }
      : {}),
    handler: (_req, _res, next) => next(new RateLimitedError()),
  });
}

/**
 * Builds a fresh set of limiters for one app instance. In-memory store: correct
 * for a single instance. With several instances, a shared store such as Redis
 * would be used instead (documented in the README).
 */
export function createRateLimiters(config: AppConfig) {
  const windowMs = config.RATE_LIMIT_WINDOW_MS;
  const perIp: Record<RouteGroup, number> = {
    auth: config.RATE_LIMIT_AUTH_PER_IP,
    chat: config.RATE_LIMIT_CHAT_PER_IP,
    subscriptions: config.RATE_LIMIT_SUBSCRIPTIONS_PER_IP,
  };
  const perUser: Record<RouteGroup, number> = {
    auth: config.RATE_LIMIT_AUTH_PER_USER,
    chat: config.RATE_LIMIT_CHAT_PER_USER,
    subscriptions: config.RATE_LIMIT_SUBSCRIPTIONS_PER_USER,
  };

  const groups = ['auth', 'chat', 'subscriptions'] as const;
  const build = (user: boolean) =>
    Object.fromEntries(
      groups.map((group) => [
        group,
        createLimiter({
          windowMs,
          limit: user ? perUser[group] : perIp[group],
          scope: `${group}-${user ? 'user' : 'ip'}`,
          perUser: user,
        }),
      ]),
    ) as Record<RouteGroup, RequestHandler>;

  return {
    /** Runs before authentication on every request. */
    globalPerIp: createLimiter({
      windowMs,
      limit: config.RATE_LIMIT_GLOBAL_PER_IP,
      scope: 'global-ip',
      perUser: false,
    }),
    /** Run before authentication, per route group. */
    perIp: build(false),
    /** Run after authentication, per route group. */
    perUser: build(true),
  };
}
