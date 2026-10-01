import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { TokenVerifier, VerifiedToken } from './ports.js';

export interface JwtVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  /** Resolves the signing key for a token. Remote JWKS in production, local keys in tests. */
  readonly getKey: JWTVerifyGetKey;
}

/**
 * Verifies access tokens server-side: signature (RS256 only, so "none" and
 * HMAC tokens are rejected), issuer, audience, expiry and required claims.
 */
export function createJwtVerifier(options: JwtVerifierOptions): TokenVerifier {
  return {
    async verify(token: string): Promise<VerifiedToken> {
      const { payload } = await jwtVerify(token, options.getKey, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('Token has no subject');
      }

      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    },
  };
}

/** The provider's public signing keys, fetched from its JWKS endpoint and cached. */
export function createRemoteKeySet(issuer: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL('.well-known/jwks.json', issuer), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });
}
