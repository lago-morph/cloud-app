/**
 * LOG on the real local target: entries written while `dev` runs are appended to
 * `.logs/<yyyy-mm-dd>.log` as JSON lines (LOG-REQ-003, DEC-0066).
 * Criteria: docs/components/log.md §4.
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  devFixtureFiles,
  logEntryViolations,
  makeTempApp,
  REPO_ROOT,
  startDev,
  uniqueValue,
  waitFor,
  type DevServer,
  type TempApp,
} from "../core/harness/harness.js";

const run = promisify(execFile);

interface StoredLine {
  readonly file: string;
  readonly raw: string;
  readonly entry: Record<string, unknown> | undefined;
}

async function readLogLines(appDir: string): Promise<StoredLine[]> {
  const dir = join(appDir, ".logs");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const lines: StoredLine[] = [];
  for (const name of names.sort()) {
    const text = await readFile(join(dir, name), "utf8");
    for (const raw of text.split("\n")) {
      if (raw.trim() === "") continue;
      let entry: Record<string, unknown> | undefined;
      try {
        entry = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        entry = undefined;
      }
      lines.push({ file: name, raw, entry });
    }
  }
  return lines;
}

let app: TempApp | undefined;
let devStart: Promise<DevServer> | undefined;

/** Starts `dev` on first use, so a failing start fails each test rather than skipping them. */
function server(): Promise<DevServer> {
  devStart ??= makeTempApp(devFixtureFiles({ name: "bt1logapp" })).then((a) => {
    app = a;
    return startDev(a.dir);
  });
  return devStart;
}

afterAll(async () => {
  await devStart?.then((d) => d.stop(), () => undefined);
  await app?.remove();
}, 60_000);

describe("LOG on dev", { timeout: 240_000 }, () => {
  it(tag("LOG-AC-003", "after dev, entries written by the app appear in .logs/<yyyy-mm-dd>.log as JSON lines"), async () => {
    const dev = await server();
    const message = uniqueValue("bt1devlog");
    const res = await fetch(`${dev.baseUrl}/api/log?message=${message}`);
    expect(res.status).toBe(200);

    const line = await waitFor("the entry in .logs/", async () => (await readLogLines(app!.dir)).find((l) => l.raw.includes(message)));
    // One JSON object per line, in a file named after the entry's UTC date.
    expect(line.entry, line.raw).toBeDefined();
    expect(line.entry!["message"]).toBe(message);
    expect(line.entry!["component"]).toBe("bt1app");
    expect(line.entry!["severity"]).toBe("info");
    expect(line.file).toMatch(/^\d{4}-\d{2}-\d{2}\.log$/);
    expect(line.file).toBe(`${new Date(String(line.entry!["time"])).toISOString().slice(0, 10)}.log`);
    // Every line in .logs/ is one JSON entry.
    for (const l of await readLogLines(app!.dir)) expect(l.entry, `${l.file}: ${l.raw}`).toBeDefined();
  });

  it(tag("LOG-AC-003", ".logs/ is ignored by git in apps of this repository"), async () => {
    for (const path of ["apps/template/.logs/2026-01-01.log", "apps/reference/.logs/2026-01-01.log", "apps/demo/.logs/2026-01-01.log"]) {
      // `git check-ignore` exits 0 when the path is ignored, 1 when it is not.
      const { stdout } = await run("git", ["check-ignore", "--no-index", path], { cwd: REPO_ROOT });
      expect(stdout.trim()).toBe(path);
    }
  });

  it(tag("LOG-AC-002", "local: stored entries validate against the schema and carry the request ID from the matching error response"), async () => {
    const dev = await server();
    const res = await fetch(`${dev.baseUrl}/api/throw/plain`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("CORE.INTERNAL");
    const requestId = body.error.requestId;

    const line = await waitFor("the error entry in .logs/", async () =>
      (await readLogLines(app!.dir)).find((l) => l.entry?.["requestId"] === requestId && l.entry?.["severity"] === "error"),
    );
    expect(line.entry!["app"]).toBe("bt1logapp");
    expect(line.entry!["target"]).toBe("local");
    for (const l of await readLogLines(app!.dir)) expect(logEntryViolations(l.entry), l.raw).toEqual([]);
  });
});
