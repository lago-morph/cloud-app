import { describe, expect, it } from "vitest";
import { createDeployment } from "../core/identity.js";
import { buildEntry } from "./entry.js";
import { formatLogLine, LOG_LINE_MARKER, workerOutputSink } from "./local.js";

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });
const now = () => new Date("2026-10-19T08:09:10.123Z");

describe("local Worker output sink", () => {
  it("formats an entry as one marked line holding its JSON", () => {
    const entry = buildEntry({ deployment, requestId: "r-1", now }, "notes", "info", "multi\nline\r\nmessage");
    const line = formatLogLine(entry);
    expect(line.startsWith(LOG_LINE_MARKER)).toBe(true);
    expect(line).not.toMatch(/[\r\n]/);
    expect(JSON.parse(line.slice(LOG_LINE_MARKER.length))).toEqual(entry);
  });

  it("prints each entry as a single marked line on the Worker's output", () => {
    const printed: string[] = [];
    const sink = workerOutputSink((line) => void printed.push(line));
    const entry = buildEntry({ deployment, now }, "KV", "error", "x");
    sink(entry);
    expect(printed).toEqual([formatLogLine(entry)]);
  });
});
