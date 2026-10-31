/**
 * Role freshness for sessions whose level the provider confirmed at sign-in (plan-v0.2.0 §4.1
 * step 5; DEC-0668, DEC-0669): the session keeps its level for PAR-425 without calling the
 * provider; after that, AUTH asks again, retrying a failed read PAR-426 times PAR-427 apart within
 * the same request. If every try fails, AUTH fails closed (runtime.ts). Workers-compatible.
 */
import type { SessionRole } from "./session.js";

/** PAR-425: how long a confirmed level is used without asking the provider again, in seconds. */
export const ROLE_REFRESH_INTERVAL_SECONDS = 5 * 60;
/** PAR-426: retries after a failed role read, within the same request. */
export const ROLE_REFRESH_RETRIES = 2;
/** PAR-427: delay before each retry, in ms. */
export const ROLE_REFRESH_RETRY_DELAY_MS = 200;

/** True once more than PAR-425 has passed since the level was confirmed (exactly PAR-425 is still current). */
export function refreshDue(role: SessionRole, nowSeconds: number): boolean {
  return nowSeconds - role.checkedAt > ROLE_REFRESH_INTERVAL_SECONDS;
}

export type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls `read` until it resolves, at most 1 + PAR-426 times, waiting PAR-427 before each retry.
 * Any resolved value (`null` included) is an answer and is not retried.
 */
export async function readWithRetries<T>(read: () => Promise<T>, options: { readonly sleep?: (ms: number) => Promise<void> } = {}): Promise<ReadResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  let error: unknown;
  for (let attempt = 0; attempt <= ROLE_REFRESH_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(ROLE_REFRESH_RETRY_DELAY_MS);
    try {
      return { ok: true, value: await read() };
    } catch (thrown) {
      error = thrown;
    }
  }
  return { ok: false, error };
}
