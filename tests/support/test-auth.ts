import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

/**
 * Stand-in for the identity provider. Tokens are real RS256 JWTs signed with a
 * key generated per test run; the app verifies them with its normal verifier.
 * The provider is mocked, verification is not bypassed.
 */
export const TEST_ISSUER = 'https://test-issuer.example.com/';
export const TEST_AUDIENCE = 'https://chat-api.test';
export const TEST_HEALTH_KEY = 'test-health-key-0123456789';

const KEY_ID = 'test-key-1';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'RS256', use: 'sig' };

/** The provider's "JWKS endpoint", served locally. */
export const testKeySet = createLocalJWKSet({ keys: [publicJwk] });

/** A second key pair the app does not trust, for forged-signature tests. */
export const untrustedKeys = await generateKeyPair('RS256');

export interface TokenOptions {
  sub?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  signingKey?: CryptoKey;
}

export async function signTestToken(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ email: 'user@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setSubject(options.sub ?? 'auth0|test-user')
    .setIssuer(options.issuer ?? TEST_ISSUER)
    .setAudience(options.audience ?? TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.signingKey ?? privateKey);
}

/** Headers for a fully authenticated request: token plus fresh replay-protection values. */
export async function authHeaders(options: TokenOptions = {}): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await signTestToken(options)}`,
    'X-Request-Timestamp': String(Date.now()),
    'X-Request-Nonce': randomUUID(),
  };
}
