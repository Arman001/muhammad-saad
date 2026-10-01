import type { Actor } from '../kernel/actor.js';

/** Identity of the authenticated caller, set by the authentication middleware. */
export interface AuthContext extends Actor {
  /** Subject ("sub") claim from the identity provider, e.g. "auth0|abc123". */
  readonly authSub: string;
}
