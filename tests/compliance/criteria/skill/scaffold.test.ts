/**
 * SKILL-AC-005: "Scaffolding into a directory with existing files stops without changing them."
 * (docs/components/skill.md §4, SKILL-REQ-005; Where: Local.)
 *
 * Runs the real `skill/scripts/scaffold` (argv parsing, `npm pack` of the framework, the version
 * check against the real template pin, the refusal, the exit status) into a non-empty directory,
 * without `--force`. Two targets (root-cause record 2026-10-20-E2E-004, "Review (revised C)"):
 * - one holding a file the template also has (`src/app.ts`) beside one it does not;
 * - one holding only files the template does not have, so a scaffolder that refused only on
 *   clashes, and copied the template beside the user's files, would fail here.
 * Each must exit 1 with a message naming the target and saying nothing was changed (a version-pin
 * mismatch also exits 1; only the message tells the two apart), and leave the tree byte-identical:
 * the same paths, contents and modification times, with no `vendor/`, `package.json` or
 * `node_modules` created.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal, REPO_ROOT } from "../core/support/repo.js";

const SCAFFOLD = join(REPO_ROOT, "skill", "scripts", "scaffold");
const TIMEOUT = 10 * 60_000;

interface Entry {
  readonly path: string;
  readonly kind: "dir" | "file";
  readonly content?: string;
  readonly mtimeMs: number;
}

/** Every path under `dir` with its kind, content (files) and modification time, sorted. */
function snapshot(dir: string, prefix = ""): Entry[] {
  const out: Entry[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    const stat = lstatSync(full);
    if (stat.isDirectory()) {
      out.push({ path: rel, kind: "dir", mtimeMs: stat.mtimeMs });
      out.push(...snapshot(full, rel));
    } else {
      out.push({ path: rel, kind: "file", content: readFileSync(full, "utf8"), mtimeMs: stat.mtimeMs });
    }
  }
  return out;
}

function runScaffold(target: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCAFFOLD, target], { cwd: REPO_ROOT, encoding: "utf8", timeout: TIMEOUT - 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

if (isLocal()) {
  describe("SKILL: scaffolding into a non-empty directory", () => {
    const roots: string[] = [];

    afterAll(() => {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    });

    function target(label: string, files: Record<string, string>): string {
      const root = mkdtempSync(join(tmpdir(), `skill-ac-005-${label}-`));
      roots.push(root);
      const dir = join(root, "app");
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(join(dir, rel, ".."), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      return dir;
    }

    function expectRefusedUnchanged(dir: string): void {
      const before = snapshot(dir);
      const result = runScaffold(dir);
      const shown = `exit ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
      expect(result.status, shown).toBe(1);
      expect(result.stderr, shown).toContain(`scaffold: target directory ${dir} is not empty`);
      expect(result.stderr, shown).toMatch(/nothing was changed/);
      expect(result.stdout, shown).not.toMatch(/Scaffolded/);
      expect(snapshot(dir)).toEqual(before);
      for (const created of ["vendor", "package.json", "node_modules"]) {
        expect(existsSync(join(dir, created)), `${created} was created`).toBe(false);
      }
    }

    it(
      tag("SKILL-AC-005", "scaffold into a directory holding a file the template also has stops with exit 1 and changes nothing"),
      () => {
        expectRefusedUnchanged(target("clash", { "src/app.ts": "mine\n", "notes.txt": "keep\n" }));
      },
      TIMEOUT,
    );

    it(
      tag("SKILL-AC-005", "scaffold into a directory holding only files the template does not have stops with exit 1 and changes nothing"),
      () => {
        expectRefusedUnchanged(target("no-clash", { "notes.txt": "keep\n", ".keep": "", "mine/plan.md": "# mine\n" }));
      },
      TIMEOUT,
    );
  });
}
