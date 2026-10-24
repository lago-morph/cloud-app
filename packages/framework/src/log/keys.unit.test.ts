/**
 * The shared log bucket's object keys (LOG-REQ-004):
 * `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json`, date and time the entry's
 * UTC time, `<id>` the request ID or a random value.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import type { LogEntry } from "./entry.js";
import { logObjectKey } from "./keys.js";

const base: LogEntry = {
  time: "2026-10-20T03:04:05.067Z",
  app: "notes",
  stage: "test-abc",
  target: "cloudflare",
  component: "CORE",
  severity: "error",
  message: "m",
};

describe("logObjectKey", () => {
  it(tag("LOG-AC-004", "unit: an entry with a request ID is keyed by its UTC time, severity and request ID"), () => {
    expect(logObjectKey({ ...base, requestId: "4c1f0c5e-0d0b-4bb2-9d1a-6f7c3b0f8e21" })).toBe(
      "notes/test-abc/2026/10/20/030405.067-error-4c1f0c5e-0d0b-4bb2-9d1a-6f7c3b0f8e21.json",
    );
  });

  it("uses the entry's UTC time even when the time carries an offset", () => {
    expect(logObjectKey({ ...base, time: "2026-10-20T01:30:00.500+02:00", severity: "warn", requestId: "r1" })).toBe(
      "notes/test-abc/2026/10/19/233000.500-warn-r1.json",
    );
  });

  it(tag("LOG-AC-004", "unit (LOG-REQ-004 random-value rule): an entry without a request ID gets a random final part, different per entry"), () => {
    const first = logObjectKey(base);
    const second = logObjectKey(base);
    const layout = /^notes\/test-abc\/2026\/10\/20\/030405\.067-error-([0-9a-f-]{36})\.json$/;
    expect(first).toMatch(layout);
    expect(second).toMatch(layout);
    expect(first).not.toBe(second);
  });

  it("takes the random part from the given source", () => {
    expect(logObjectKey(base, () => "fixed")).toBe("notes/test-abc/2026/10/20/030405.067-error-fixed.json");
  });
});
