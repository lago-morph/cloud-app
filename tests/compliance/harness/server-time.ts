/**
 * Time windows on the server's clock. A criterion that compares a cloud log entry's or stored
 * record's timestamp with "when the test sent the request" must not use this machine's clock: the
 * sandbox's clock can be off from the platform's by more than the margin. Each request's window is
 * taken from its response's `Date` header instead (RFC 9110 §6.6.1, one-second resolution):
 * from D − duration − 1 s to D + 1 s, where D is the header's time and duration the request's
 * round trip measured here. The server wrote anything it wrote during the request between those.
 */

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/** One second either side: the `Date` header's resolution (it is truncated to the second). */
export const DATE_HEADER_SLACK_MS = 1_000;

/**
 * The server-clock window of one request. `date` is its response's `Date` header; `durationMs`
 * the round trip measured by the client. Without a parseable `Date` (some local servers send
 * none), `receivedAt` (this machine's clock when the response arrived) stands in for D: that only
 * happens for a server on this machine, whose clock is this machine's.
 */
export function serverWindow(date: string | null | undefined, durationMs: number, receivedAt: number): TimeWindow {
  const parsed = date === null || date === undefined ? Number.NaN : Date.parse(date);
  const d = Number.isNaN(parsed) ? receivedAt : parsed;
  return { from: new Date(d - Math.max(0, durationMs) - DATE_HEADER_SLACK_MS), to: new Date(d + DATE_HEADER_SLACK_MS) };
}

/** Whether `time` (an ISO timestamp or ms) falls in `window`, inclusive. */
export function inWindow(time: string | number, window: TimeWindow): boolean {
  const t = typeof time === "number" ? time : Date.parse(time);
  return !Number.isNaN(t) && t >= window.from.getTime() && t <= window.to.getTime();
}

/** Runs one request and returns its response with its server-clock window. */
export async function timed<R extends { readonly headers: Headers }>(send: () => Promise<R>): Promise<{ readonly response: R; readonly window: TimeWindow }> {
  const start = performance.now();
  const response = await send();
  const durationMs = performance.now() - start;
  return { response, window: serverWindow(response.headers.get("date"), durationMs, Date.now()) };
}
