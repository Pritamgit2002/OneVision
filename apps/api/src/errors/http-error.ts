/**
 * Controllers and services throw these; the error middleware turns them into responses.
 *
 * Anything thrown that is *not* an HttpError is treated as a 500, which is the behaviour
 * we want for a tripped isolation assertion — a server-side fault, never a bad request.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A tripped tenant assertion is a bug in us, never a client mistake — always a 500. */
export const ISOLATION_VIOLATION_PREFIX = 'TENANT ISOLATION VIOLATION';

export function isIsolationViolation(err: unknown): boolean {
  return messageOf(err).startsWith(ISOLATION_VIOLATION_PREFIX);
}
