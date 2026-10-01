import type { Actor } from '../shared/kernel/actor.js';

/** Identity of the authenticated caller, set by the auth middleware. */
export interface AuthContext extends Actor {
  readonly authSub: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
