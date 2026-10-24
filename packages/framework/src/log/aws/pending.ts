/**
 * Pending log writes of one Lambda invocation (log.md §2 "AWS"; LOG-REQ-001). Lambda freezes
 * the execution environment once the handler returns, which would lose writes still in flight,
 * and there is no `waitUntil`. So the S3 sink hands each write to this tracker, and the handler
 * (G-05) awaits `settle()` before it returns the response. `settle()` waits until every tracked
 * write has finished, writes started while it waits included, but never longer than PAR-260
 * from the moment it is called; it never rejects. A write that is still running at the bound is
 * abandoned (it may finish if the environment thaws; nothing waits for it).
 */

/** PAR-260: the longest a response waits for pending log writes. */
export const LOG_WRITE_WAIT_MS = 2000;

export interface PendingWrites {
  /** Adds one write; its result and failure are ignored. */
  track(write: PromiseLike<unknown>): void;
  /** Resolves once nothing is pending, or after the bound, whichever is first. Never rejects. */
  settle(): Promise<void>;
  /** Writes not yet finished. */
  readonly size: number;
}

export interface PendingWritesOptions {
  /** The bound in milliseconds (default PAR-260). */
  readonly boundMs?: number;
}

function ignore(): void {}

export function createPendingWrites(options: PendingWritesOptions = {}): PendingWrites {
  const boundMs = options.boundMs ?? LOG_WRITE_WAIT_MS;
  const pending = new Set<Promise<void>>();
  return {
    track(write) {
      let settled: Promise<void>;
      try {
        settled = Promise.resolve(write).then(ignore, ignore);
      } catch {
        return;
      }
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
    },
    get size() {
      return pending.size;
    },
    async settle() {
      if (pending.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const bound = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, boundMs);
      });
      try {
        // Writes may start while earlier ones finish (an entry logged late); wait for those too.
        while (pending.size > 0 && !timedOut) await Promise.race([Promise.all([...pending]), bound]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
