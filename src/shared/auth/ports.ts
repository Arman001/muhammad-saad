import type { Role } from '../kernel/actor.js';

/** Result of a successfully verified access token. */
export interface VerifiedToken {
  readonly sub: string;
  readonly email: string | undefined;
}

/** Verifies an access token issued by the external identity provider. */
export interface TokenVerifier {
  /** Resolves with the verified claims, or rejects if the token is invalid in any way. */
  verify(token: string): Promise<VerifiedToken>;
}

export interface IdentityRecord {
  readonly id: string;
  readonly role: Role;
}

/** Maps an external identity to an internal user, creating it on first sight. */
export interface IdentityStore {
  findOrCreate(authSub: string, email: string | undefined): Promise<IdentityRecord>;
}

/** One-time nonces for replay protection. */
export interface NonceStore {
  /** Records the nonce. Returns false if it was already used. Must be atomic. */
  consume(nonce: string, userId: string): Promise<boolean>;
  /** Deletes nonces older than the given date. Returns how many were removed. */
  pruneOlderThan(date: Date): Promise<number>;
}
