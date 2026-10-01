import express, { type RequestHandler } from 'express';
import { UnsupportedMediaTypeError } from '../errors/index.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

function hasBody(headers: express.Request['headers']): boolean {
  const length = headers['content-length'];
  return headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

/**
 * Strict content-type validation: any request that carries a body must declare
 * it as application/json, otherwise 415. Requests without a body pass, so
 * body-less actions (like cancelling a subscription) need no Content-Type.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  if (!METHODS_WITH_BODY.has(req.method) || !hasBody(req.headers)) {
    next();
    return;
  }
  if (!req.is('application/json')) {
    next(new UnsupportedMediaTypeError());
    return;
  }
  next();
};

/**
 * JSON body parser with a size limit. Oversized bodies become 413 and
 * malformed JSON becomes 400 (mapped in the error handler).
 * `strict` only accepts objects and arrays at the top level.
 */
export function jsonBodyParser(limit: string): RequestHandler {
  return express.json({ limit, strict: true, type: 'application/json' });
}
