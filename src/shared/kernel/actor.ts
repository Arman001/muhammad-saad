/**
 * Shared kernel: the minimal identity the domain needs to make decisions.
 * Framework-free on purpose, so domain policies can depend on it.
 */
export type Role = 'USER' | 'ADMIN';

export interface Actor {
  readonly userId: string;
  readonly role: Role;
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === 'ADMIN';
}
