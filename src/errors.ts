import type { PackageError } from './types';
import { extractErrorMessage } from 'foxts/extract-error-message';

const DEFAULT_ERROR_STATUS = 400;

export class HttpError extends Error {
  readonly status: number;
  readonly statusCode: number;

  constructor(message: string, options: ErrorOptions & {
    status: number
  }) {
    super(message, options);
    this.name = 'HttpError';
    this.status = options.status;
    this.statusCode = options.status;
  }
}

export function toPackageError(error: unknown, name: string): PackageError {
  const errorWithStatus = error as {
    status?: number,
    statusCode?: number
  };
  return {
    status: errorWithStatus.statusCode
      ?? errorWithStatus.status
      ?? DEFAULT_ERROR_STATUS,
    name,
    error: retrieveErrorMessage(error)
  };
}

// matches upstream `retrieveErrorMessage`: bare message, no error-name prefix
function retrieveErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  return extractErrorMessage(error, false)
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- mirror upstream String(error) fallback
    ?? (error ? String(error) : 'Unknown error');
}
