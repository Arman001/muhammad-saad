import { randomUUID } from 'node:crypto';
import type { Role } from '../../src/shared/kernel/actor.js';
import type { IdentityRecord, IdentityStore, NonceStore } from '../../src/shared/auth/ports.js';

export class InMemoryIdentityStore implements IdentityStore {
  readonly users = new Map<string, IdentityRecord>();

  async findOrCreate(authSub: string): Promise<IdentityRecord> {
    let user = this.users.get(authSub);
    if (!user) {
      user = { id: randomUUID(), role: 'USER' };
      this.users.set(authSub, user);
    }
    return user;
  }

  setRole(authSub: string, role: Role): void {
    const user = this.users.get(authSub) ?? { id: randomUUID(), role };
    this.users.set(authSub, { ...user, role });
  }
}

export class InMemoryNonceStore implements NonceStore {
  readonly used = new Map<string, Date>();

  async consume(nonce: string): Promise<boolean> {
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, new Date());
    return true;
  }

  async pruneOlderThan(date: Date): Promise<number> {
    let removed = 0;
    for (const [nonce, createdAt] of this.used) {
      if (createdAt < date) {
        this.used.delete(nonce);
        removed += 1;
      }
    }
    return removed;
  }
}
