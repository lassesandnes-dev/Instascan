/** Error carrying a stable machine-readable code and an HTTP status hint. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, id: string) {
    super("not_found", `${what} not found: ${id}`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("validation_error", message, 400, details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
