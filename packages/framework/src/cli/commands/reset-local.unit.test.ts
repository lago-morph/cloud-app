import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { resetLocalCommand } from "./reset-local.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function app(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "reset-local-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe("reset-local (LOCAL-REQ-002)", () => {
  it("removes the persisted local state (Wrangler's state and the local log) and keeps sources, config and .dev.vars", async () => {
    const dir = app({
      ".wrangler/state/v3/d1/db.sqlite": "x",
      ".logs/2026-01-01.log": "{}\n",
      ".mail/20261025T101112123Z-ab.json": "{}\n",
      ".dev.vars": "SECRET_API_KEY=kept\n",
      "src/app.ts": "export {};\n",
      "config/local.json": "{}\n",
      "migrations/checksums.json": "{}\n",
    });
    const io = captureIo(dir);
    expect(await resetLocalCommand()([], io)).toBe(0);
    expect(existsSync(join(dir, ".wrangler"))).toBe(false);
    expect(existsSync(join(dir, ".logs"))).toBe(false);
    expect(existsSync(join(dir, ".mail"))).toBe(false);
    for (const kept of [".dev.vars", "src/app.ts", "config/local.json", "migrations/checksums.json"]) expect(existsSync(join(dir, kept)), kept).toBe(true);
    expect(io.out).toMatch(/\.wrangler/);
  });

  it("succeeds when there is nothing to clear, and takes no arguments", async () => {
    const dir = app({ "src/app.ts": "" });
    expect(await resetLocalCommand()([], captureIo(dir))).toBe(0);
    await expect(resetLocalCommand()(["--all"], captureIo(dir))).rejects.toThrow(UsageError);
  });
});
