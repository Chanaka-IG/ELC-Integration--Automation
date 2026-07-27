/**
 * Generic async polling — the two eventual-consistency points in this pipeline
 * (change-event recorded after consumer run; Celigo job completion) must be
 * polled, never slept on.
 */
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
      lastErr = err; // transient API errors are tolerated until the deadline
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `pollUntil timed out after ${opts.timeoutMs}ms${opts.label ? ` waiting for: ${opts.label}` : ''}` +
      (lastErr ? ` (last error: ${String(lastErr)})` : ''),
  );
}
