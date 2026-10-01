import type { AuthContext } from '../shared/auth/auth-context.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
