import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/index.js';
import type { IdentityStore, NonceStore, TokenVerifier } from './ports.js';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;
const MAX_AUTH_HEADER_LENGTH = 8_192;
const TIMESTAMP_PATTERN = /^\d{13}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthenticateOptions {
  readonly verifier: TokenVerifier;
  readonly identities: IdentityStore;
  readonly nonces: NonceStore;
  /** Maximum age (and future skew) of X-Request-Timestamp, in seconds. */
  readonly replayWindowSeconds: number;
  readonly now?: () => number;
}

/**
 * Authenticates every request that reaches it. Fails closed: anything
 * unexpected results in 401, never in a request being let through.
 *
 * 1. Bearer token verified server-side (signature, issuer, audience, expiry).
 * 2. Replay protection: X-Request-Timestamp must be recent and
 *    X-Request-Nonce must never have been used before. A captured request
 *    cannot be replayed, so possessing a token alone is not enough.
 * 3. The internal user and role are loaded from our database. The role is
 *    never read from the token.
 */
export function authenticate(options: AuthenticateOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const windowMs = options.replayWindowSeconds * 1000;

  return async (req, _res, next) => {
    // 1. Access token
    const header = req.headers.authorization;
    if (header === undefined) {
      throw new UnauthorizedError();
    }
    const match = header.length <= MAX_AUTH_HEADER_LENGTH ? BEARER_PATTERN.exec(header) : null;
    if (!match?.[1]) {
      throw new UnauthorizedError('Invalid or expired access token.');
    }

    let claims;
    try {
      claims = await options.verifier.verify(match[1]);
    } catch (error) {
      // Log the real reason for operators; the client gets a deliberately vague message.
      req.log.warn({ reason: (error as { code?: string }).code ?? 'unknown' }, 'Token rejected');
      throw new UnauthorizedError('Invalid or expired access token.');
    }

    // 2. Replay protection headers (cheap checks before touching the database)
    const timestamp = req.headers['x-request-timestamp'];
    const nonce = req.headers['x-request-nonce'];
    if (
      typeof timestamp !== 'string' ||
      !TIMESTAMP_PATTERN.test(timestamp) ||
      typeof nonce !== 'string' ||
      !UUID_PATTERN.test(nonce)
    ) {
      throw new UnauthorizedError(
        'X-Request-Timestamp (Unix ms) and X-Request-Nonce (UUID) headers are required.',
      );
    }
    if (Math.abs(now() - Number(timestamp)) > windowMs) {
      throw new UnauthorizedError('Request timestamp is outside the allowed window.');
    }

    // 3. Internal identity
    const identity = await options.identities.findOrCreate(claims.sub, claims.email);

    if (!(await options.nonces.consume(nonce.toLowerCase(), identity.id))) {
      req.log.warn({ userId: identity.id }, 'Replayed nonce rejected');
      throw new UnauthorizedError('Request nonce has already been used.');
    }

    req.auth = { userId: identity.id, role: identity.role, authSub: claims.sub };
    next();
  };
}
