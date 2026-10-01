export type ErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Base for every error the application throws on purpose.
 * Carries a stable machine-readable code; never an HTTP status.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly details: ErrorDetails | undefined;

  constructor(message: string, details?: ErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** Business-rule violations raised by the domain layer. */
export abstract class DomainError extends AppError {}
