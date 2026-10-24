/**
 * Object keys in the account's shared log bucket (LOG-REQ-004):
 * `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json`. The date and time are the
 * entry's UTC time; `<id>` is the entry's request ID, or a random value when it has none (no
 * framework path writes outside a request today, DEC-0314; the rule is kept). Shared by the Cloudflare and AWS sinks. Workers-compatible.
 */
import type { LogEntry } from "./entry.js";

/** A fresh random final part (a UUID, like request IDs). */
export const randomKeyPart = (): string => crypto.randomUUID();

export function logObjectKey(entry: LogEntry, random: () => string = randomKeyPart): string {
  const iso = new Date(entry.time).toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ, UTC
  const [yyyy, mm, dd] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
  const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}.${iso.slice(20, 23)}`;
  const id = entry.requestId ?? random();
  return `${entry.app}/${entry.stage}/${yyyy}/${mm}/${dd}/${time}-${entry.severity}-${id}.json`;
}
