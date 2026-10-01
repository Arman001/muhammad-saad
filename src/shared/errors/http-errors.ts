import { AppError } from './app-error.js';

/** Errors raised by the transport layer (middleware, controllers). */

export class UnauthorizedError extends AppError {
  override readonly code = 'UNAUTHORIZED';
  constructor(message = 'Authentication is required.') {
    super(message);
  }
}

export class ValidationError extends AppError {
  override readonly code = 'VALIDATION_FAILED';
}

export class InvalidJsonError extends AppError {
  override readonly code = 'INVALID_JSON';
  constructor() {
    super('Request body is not valid JSON.');
  }
}

export class PayloadTooLargeError extends AppError {
  override readonly code = 'PAYLOAD_TOO_LARGE';
  constructor() {
    super('Request body is too large.');
  }
}

export class UnsupportedMediaTypeError extends AppError {
  override readonly code = 'UNSUPPORTED_MEDIA_TYPE';
  constructor(message = 'Content-Type must be application/json.') {
    super(message);
  }
}

export class RateLimitedError extends AppError {
  override readonly code = 'RATE_LIMITED';
  constructor(message = 'Too many requests. Please try again later.') {
    super(message);
  }
}

export class RequestTimeoutError extends AppError {
  override readonly code = 'REQUEST_TIMEOUT';
  constructor() {
    super('The request took too long to process.');
  }
}
