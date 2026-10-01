import { DomainError } from './app-error.js';

export class ForbiddenError extends DomainError {
  override readonly code = 'FORBIDDEN';
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  override readonly code = 'NOT_FOUND';
}

export class ConflictError extends DomainError {
  override readonly code = 'CONFLICT';
}
