/**
 * Bounded waits (compliance.md "Time limits"): every cloud wait has a timeout derived from the
 * platform behaviour it waits for. Polls; never waits without a bound.
 */

export const CLOUD_WAITS = {
  /** PAR-210: reaching the database, including resume from pause. */
  databaseResumeMs: 45_000,
  /** DEC-0090: a `workers.dev` route turned on or off is visible within this bound. */
  routeToggleMs: 30_000,
  /** PAR-270: the longest one response may take. */
  requestMs: 55_000,
  /**
   * DEC-0092: a Worker secret set or deleted reaches requests once the new Worker version it
   * rolls out serves them, a few seconds later; this bound is twice the route toggle's.
   */
  secretRolloutMs: 60_000,
} as const;

export interface WaitOptions {
  /** What is awaited, for the timeout message. */
  readonly what: string;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Calls `probe` until it resolves to a value other than `undefined`, or the bound passes. */
export async function waitFor<T>(probe: () => Promise<T | undefined>, options: WaitOptions): Promise<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error(`waitFor(${options.what}): the timeout must be bounded and positive`);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.intervalMs ?? 1000;
  const deadline = now() + options.timeoutMs;
  let last = "no probe completed";
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
      last = "not ready";
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    const left = deadline - now();
    if (left <= 0) break;
    await sleep(Math.min(interval, left));
  }
  throw new Error(`timed out after ${String(Math.round(options.timeoutMs / 1000))} s waiting for ${options.what}; last probe: ${last}`);
}
