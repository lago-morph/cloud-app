import { describe, expect, it } from "vitest";
import { createDeployment } from "../core/identity.js";
import { buildEntry } from "./entry.js";
import { createLogCapture, logFilePath, parseLogLine } from "./capture.js";
import { formatLogLine, LOG_LINE_MARKER } from "./local.js";

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });
const entry = buildEntry({ deployment, requestId: "r-1", now: () => new Date("2026-10-19T23:59:59.999Z") }, "notes", "info", "a\nb");

describe("parseLogLine", () => {
  it("returns the entry of a marked line", () => {
    expect(parseLogLine(formatLogLine(entry))).toEqual(entry);
  });

  it("finds the marker after a prefix Wrangler or a terminal adds, and ignores a trailing CR", () => {
    expect(parseLogLine(`\u001b[2m[wrangler:inf]\u001b[0m ${formatLogLine(entry)}\r`)).toEqual(entry);
  });

  it("returns undefined for ordinary output, broken JSON, and entries the schema refuses", () => {
    expect(parseLogLine("Ready on http://localhost:8787")).toBeUndefined();
    expect(parseLogLine(`${LOG_LINE_MARKER}{"time":`)).toBeUndefined();
    expect(parseLogLine(LOG_LINE_MARKER + JSON.stringify({ ...entry, severity: "fatal" }))).toBeUndefined();
  });
});

describe("logFilePath", () => {
  it("names the entry's UTC day under .logs/", () => {
    expect(logFilePath(entry)).toBe(".logs/2026-10-19.log");
  });
});

describe("createLogCapture", () => {
  function capture() {
    const appended: [string, string][] = [];
    const other: string[] = [];
    const c = createLogCapture({ append: (path, text) => void appended.push([path, text]), other: (line) => void other.push(line) });
    return { c, appended, other };
  }

  it("appends marked lines as JSON lines to the day's file and passes other lines on, across chunk boundaries", () => {
    const { c, appended, other } = capture();
    const output = `starting\n${formatLogLine(entry)}\nready\n`;
    const cut = output.indexOf("\"app\"");
    c.push(output.slice(0, cut));
    c.push(output.slice(cut));
    expect(appended).toEqual([[".logs/2026-10-19.log", `${JSON.stringify(entry)}\n`]]);
    expect(other).toEqual(["starting", "ready"]);
  });

  it("handles the last line without a newline on end()", () => {
    const { c, appended, other } = capture();
    c.push(`tail\n${formatLogLine(entry)}`);
    expect(appended).toEqual([]);
    c.end();
    expect(appended).toEqual([[".logs/2026-10-19.log", `${JSON.stringify(entry)}\n`]]);
    expect(other).toEqual(["tail"]);
  });
});
