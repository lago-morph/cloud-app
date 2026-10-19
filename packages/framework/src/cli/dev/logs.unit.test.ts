import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevLogCapture } from "./logs.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const entry = { time: "2026-10-19T23:59:59.000Z", app: "one", stage: "local", target: "local", component: "one", severity: "info", message: "hi" };

describe("dev's log capture (LOG-REQ-003, DEC-0066)", () => {
  it("[LOG-AC-003] appends marked Worker lines to .logs/<UTC day>.log and forwards every other line", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-logs-"));
    dirs.push(dir);
    const forwarded: string[] = [];
    const capture = createDevLogCapture(dir, (line) => forwarded.push(line));
    capture.push(`[wrangler:info] Ready\n[prototype-framework:log] ${JSON.stringify(entry)}\n`);
    capture.push(`[prototype-framework:log] ${JSON.stringify({ ...entry, time: "2026-10-20T00:00:01.000Z" })}`);
    capture.end();
    expect(forwarded).toEqual(["[wrangler:info] Ready"]);
    expect(readFileSync(join(dir, ".logs", "2026-10-19.log"), "utf8")).toBe(`${JSON.stringify(entry)}\n`);
    expect(JSON.parse(readFileSync(join(dir, ".logs", "2026-10-20.log"), "utf8"))).toMatchObject({ message: "hi" });
  });
});
