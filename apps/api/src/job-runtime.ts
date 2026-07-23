export interface JobRunOptions {
  leaseOwner: string;
  leaseDurationMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export const inlineJobOptions: JobRunOptions = {
  leaseOwner: `api-${process.pid}`,
  leaseDurationMs: 120_000,
  maxAttempts: 3,
  retryBaseDelayMs: 1_000,
};

export function leaseExpiry(options: JobRunOptions): Date {
  return new Date(Date.now() + options.leaseDurationMs);
}

export function isRetryableJobError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = Number(error.status);
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function runWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: Pick<JobRunOptions, "maxAttempts" | "retryBaseDelayMs">,
  onRetry?: (error: unknown, attempt: number, delayMs: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= options.maxAttempts || !isRetryableJobError(error)) throw error;
      const delayMs = options.retryBaseDelayMs * 2 ** (attempt - 1);
      await onRetry?.(error, attempt, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Retry loop ended unexpectedly");
}
