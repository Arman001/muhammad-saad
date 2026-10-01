import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  DomainError,
  InvalidJsonError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../errors/index.js';

/**
 * The only place that knows how error codes map to HTTP statuses.
 * Domain code throws errors with codes; it never chooses a status.
 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  UNAUTHORIZED: 401,
  QUOTA_EXCEEDED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  REQUEST_TIMEOUT: 503,
};

interface BodyParserError {
  type: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof (err as { type: unknown }).type === 'string'
  );
}

/** Converts known error shapes into AppErrors. Returns null for unexpected errors. */
function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    // Report where and why validation failed, never the submitted values.
    return new ValidationError('Request validation failed.', {
      issues: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  if (isBodyParserError(err)) {
    switch (err.type) {
      case 'entity.too.large':
        return new PayloadTooLargeError();
      case 'entity.parse.failed':
        return new InvalidJsonError();
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return new UnsupportedMediaTypeError('Unsupported request encoding.');
      default:
        return null;
    }
  }

  return null;
}

/** Unknown routes. Mounted after authentication, so anonymous callers get 401 instead. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found.'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = toAppError(err);

  if (!appError) {
    // Full details go to the log; the client gets a generic message only.
    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: req.requestId,
      },
    });
    return;
  }

  const status = STATUS_BY_CODE[appError.code] ?? (appError instanceof DomainError ? 422 : 500);
  if (status >= 500) {
    req.log.error({ err: appError }, appError.message);
  }

  res.status(status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: req.requestId,
    },
  });
};
