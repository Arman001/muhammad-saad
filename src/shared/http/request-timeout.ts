import type { RequestHandler } from 'express';
import { RequestTimeoutError } from '../errors/index.js';

/**
 * Global request timeout. If no response has been sent within `ms`, the
 * client receives 503 REQUEST_TIMEOUT.
 *
 * Note: JavaScript cannot cancel work that is already running. This frees the
 * client and the connection; it does not stop the handler's CPU or I/O.
 */
export function requestTimeout(ms: number): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.locals.timedOut = true;
        next(new RequestTimeoutError());
      }
    }, ms);

    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}
