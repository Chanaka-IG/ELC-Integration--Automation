/**
 * Generic async polling — the two eventual-consistency points in this pipeline
 * (change-event recorded after consumer run; Celigo job completion) must be
 * polled, never slept on.
 */

/**
 * An error that must abort a poll loop instead of being retried — retrying
 * would make the situation worse (e.g. OHRM has temporarily blocked access, and
 * every further request extends the block).
 */
export class NonRetryableError extends Error {}

export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  opts: { timeoutMs: number; intervalMs?: number; label?: string },
): Promise<T> {
  const interval = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + opts.timeoutMs;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastErr = err; // transient API errors are tolerated until the deadline
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `pollUntil timed out after ${opts.timeoutMs}ms${opts.label ? ` waiting for: ${opts.label}` : ''}` +
      (lastErr ? ` (last error: ${String(lastErr)})` : ''),
  );
}
